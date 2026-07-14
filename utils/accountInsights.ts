import { Category, LogEntry } from '../types';
import { getCategoryMapById, resolveLogEntryCategory } from './categoryTracking';
import { LONG_GRACE_SESSION_TIMEOUT_SECONDS } from './timerRuntime';
import { getAccountStatsPomodoroEquivalent } from './pomodoroAccounting';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const SESSION_SPLIT_GRACE_SECONDS = LONG_GRACE_SESSION_TIMEOUT_SECONDS;
const QUIT_TIME_BUCKET_MINUTES = 30;
const DAILY_TREND_DAYS = 14;
const SESSION_LANE_DAYS = 7;

export const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const WEEKDAY_SHORT_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const DAY_PART_LABELS = ['morning', 'afternoon', 'night'] as const;

export type DayPartKey = typeof DAY_PART_LABELS[number];

export interface AccountCategorySlice {
  name: string;
  minutes: number;
  share: number;
}

export interface AccountTodayStats {
  focusMinutes: number;
  pomodoros: number;
  sessions: number;
  firstStartMinutes: number | null;
  peakHour: number | null;
  topCategoryName: string | null;
}

export interface AccountWeekSummary {
  focusMinutes: number;
  pomodoros: number;
  sessions: number;
}

export interface AccountWeekComparison {
  thisWeek: AccountWeekSummary;
  lastWeek: AccountWeekSummary;
  focusDeltaMinutes: number;
  focusDeltaPct: number | null;
  pomoDelta: number;
  pomoDeltaPct: number | null;
  sessionDelta: number;
  sessionDeltaPct: number | null;
}

export interface AccountInsightSession {
  startMs: number;
  endMs: number | null;
  closed: boolean;
  activeDurationMinutes: number;
}

export interface AccountDailyTrendPoint {
  dateKey: string;
  focusMinutes: number;
  pomodoros: number;
  sessions: number;
}

export interface AccountSessionLaneEntry {
  id: string;
  startMs: number;
  endMs: number | null;
  closed: boolean;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
}

export interface AccountSessionLane {
  dateKey: string;
  weekday: number;
  totalFocusMinutes: number;
  sessions: AccountSessionLaneEntry[];
}

export interface AccountInsights {
  today: AccountTodayStats;
  mostProductiveHours: {
    hours: number[];
    focusMinutes: number;
  };
  mostProductiveWeekdays: {
    weekdays: number[];
    averageFocusMinutes: number;
  };
  topCategory: {
    name: string;
    minutes: number;
    share: number;
  } | null;
  categorySlices: AccountCategorySlice[];
  hasCategorizedWork: boolean;
  averageStartMinutes: number | null;
  mostCommonQuitTimes: {
    bucketMinutes: number[];
    count: number;
    sourceBucketCount: number;
  };
  dayPartTotals: Record<DayPartKey, number>;
  dominantDayParts: DayPartKey[];
  hourlyFocusMinutes: number[];
  todayHourlyFocusMinutes: number[];
  weekdayHourHeatmap: number[][];
  heatmapMaxMinutes: number;
  sessions: AccountInsightSession[];
  dailyFocusTrend: AccountDailyTrendPoint[];
  sessionLanes: AccountSessionLane[];
  weekComparison: AccountWeekComparison;
}

interface NormalizedLogWindow {
  entry: LogEntry;
  startMs: number;
  endMs: number;
}

const isPauseCreditedWorkLog = (entry: LogEntry): boolean => {
  if (entry.type !== 'work') return false;
  const reason = (entry.reason || '').trim().toLowerCase();
  return reason.startsWith('paused') || reason.includes('pause credit');
};

const isGraceLike = (entry: LogEntry) => {
  return entry.type === 'grace' || (typeof entry.reason === 'string' && entry.reason.startsWith('Grace Period'));
};

const isNeutralGraceBoundary = (entry: LogEntry) => {
  const reason = (entry.reason || '').trim().toLowerCase();
  return isGraceLike(entry) && reason === 'grace period' && Number.isFinite(entry.duration) && entry.duration > SESSION_SPLIT_GRACE_SECONDS;
};

const isNeutralGraceWindow = (entry: LogEntry) => {
  const reason = (entry.reason || '').trim().toLowerCase();
  return isGraceLike(entry) && reason === 'grace period';
};

const isSessionEndLog = (entry: LogEntry) => {
  return (entry.reason || '').trim().toLowerCase() === 'session end';
};

const startOfLocalDay = (ms: number) => {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const startOfLocalWeek = (ms: number) => {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - date.getDay());
  return date.getTime();
};

const getMinutesOfDay = (ms: number) => {
  const date = new Date(ms);
  return date.getHours() * 60 + date.getMinutes() + (date.getSeconds() / 60);
};

const getOverlapMinutes = (startMs: number, endMs: number, rangeStartMs: number, rangeEndMs: number) => {
  const overlapStart = Math.max(startMs, rangeStartMs);
  const overlapEnd = Math.min(endMs, rangeEndMs);
  if (overlapEnd <= overlapStart) return 0;
  return (overlapEnd - overlapStart) / 60_000;
};

const getChangePct = (current: number, previous: number) => {
  if (previous <= 0) return current > 0 ? null : 0;
  return ((current - previous) / previous) * 100;
};

const getLocalDateKey = (ms: number) => {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getDayPart = (hour: number): DayPartKey => {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'night';
};

const normalizeLogWindow = (entry: LogEntry): NormalizedLogWindow | null => {
  const startMs = Date.parse(entry.start);
  if (!Number.isFinite(startMs)) return null;

  let endMs = Date.parse(entry.end);
  if (!Number.isFinite(endMs) || endMs <= startMs) {
    if (!Number.isFinite(entry.duration) || entry.duration <= 0) return null;
    endMs = startMs + (entry.duration * 1000);
  }

  if (endMs <= startMs) return null;
  return { entry, startMs, endMs };
};

const countWeekdayOccurrences = (joinedAtMs: number, nowMs: number) => {
  const counts = new Array<number>(7).fill(0);
  let cursor = startOfLocalDay(Math.min(joinedAtMs, nowMs));
  const end = startOfLocalDay(nowMs);

  while (cursor <= end) {
    counts[new Date(cursor).getDay()] += 1;
    cursor += DAY_MS;
  }

  return counts;
};

const averageTimeOfDayMinutes = (values: number[]) => {
  if (values.length === 0) return null;

  const angleStep = (Math.PI * 2) / 1440;
  let sinSum = 0;
  let cosSum = 0;

  values.forEach((minutes) => {
    const angle = minutes * angleStep;
    sinSum += Math.sin(angle);
    cosSum += Math.cos(angle);
  });

  if (sinSum === 0 && cosSum === 0) return values[0] ?? null;

  let angle = Math.atan2(sinSum / values.length, cosSum / values.length);
  if (angle < 0) angle += Math.PI * 2;
  return (angle / (Math.PI * 2)) * 1440;
};

const averageClockMinutes = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const linearRange = sorted[sorted.length - 1] - sorted[0];
  if (linearRange <= 12 * 60) {
    return sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  }
  return averageTimeOfDayMinutes(sorted);
};

const buildAnalyticsSessions = (windows: NormalizedLogWindow[]): AccountInsightSession[] => {
  const sessions: AccountInsightSession[] = [];
  let currentStartMs: number | null = null;
  let currentLastEndMs: number | null = null;
  let currentActiveDurationMs = 0;
  let pendingStartMs: number | null = null;

  windows.forEach((window) => {
    if (isNeutralGraceBoundary(window.entry)) {
      if (currentStartMs !== null && window.startMs > currentStartMs) {
        sessions.push({
          startMs: currentStartMs,
          endMs: window.startMs,
          closed: true,
          activeDurationMinutes: Math.max(1, currentActiveDurationMs / 60_000),
        });
      }
      currentStartMs = null;
      currentLastEndMs = null;
      currentActiveDurationMs = 0;
      pendingStartMs = window.endMs;
      return;
    }

    if (isNeutralGraceWindow(window.entry)) {
      return;
    }

    if (currentStartMs === null) {
      currentStartMs = pendingStartMs ?? window.startMs;
    }
    pendingStartMs = null;
    currentLastEndMs = Math.max(currentLastEndMs ?? window.endMs, window.endMs);
    currentActiveDurationMs += Math.max(0, window.endMs - window.startMs);

    if (isSessionEndLog(window.entry) && currentStartMs !== null && currentLastEndMs > currentStartMs) {
      sessions.push({
        startMs: currentStartMs,
        endMs: currentLastEndMs,
        closed: true,
        activeDurationMinutes: Math.max(1, currentActiveDurationMs / 60_000),
      });
      currentStartMs = null;
      currentLastEndMs = null;
      currentActiveDurationMs = 0;
    }
  });

  if (currentStartMs !== null && currentLastEndMs !== null && currentLastEndMs > currentStartMs) {
    sessions.push({
      startMs: currentStartMs,
      endMs: currentLastEndMs,
      closed: false,
      activeDurationMinutes: Math.max(1, currentActiveDurationMs / 60_000),
    });
  }

  return sessions;
};

const distributeByHour = (
  startMs: number,
  endMs: number,
  onSlice: (date: Date, minutes: number) => void,
) => {
  let cursor = startMs;
  while (cursor < endMs) {
    const sliceDate = new Date(cursor);
    const nextBoundary = new Date(sliceDate);
    nextBoundary.setMinutes(0, 0, 0);
    nextBoundary.setHours(sliceDate.getHours() + 1);
    const nextMs = Math.min(endMs, nextBoundary.getTime());
    const minutes = (nextMs - cursor) / 60_000;
    onSlice(sliceDate, minutes);
    cursor = nextMs;
  }
};

const distributeByDay = (
  startMs: number,
  endMs: number,
  onSlice: (dateKey: string, minutes: number) => void,
) => {
  let cursor = startMs;
  while (cursor < endMs) {
    const dayStartMs = startOfLocalDay(cursor);
    const nextDayStartMs = dayStartMs + DAY_MS;
    const nextMs = Math.min(endMs, nextDayStartMs);
    const minutes = (nextMs - cursor) / 60_000;
    onSlice(getLocalDateKey(cursor), minutes);
    cursor = nextMs;
  }
};

export const computeAccountInsights = ({
  logs,
  categories,
  joinedAt,
  nowMs = Date.now(),
}: {
  logs: LogEntry[];
  categories: Category[];
  joinedAt: string;
  nowMs?: number;
}): AccountInsights => {
  const categoriesById = getCategoryMapById(categories);

  const normalizedLogs = logs
    .map(normalizeLogWindow)
    .filter((entry): entry is NormalizedLogWindow => Boolean(entry))
    .filter((entry) => entry.entry.type !== 'task-complete')
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const productiveWindows = normalizedLogs.filter((window) => (
    window.entry.type === 'work' && !isPauseCreditedWorkLog(window.entry)
  ));
  const completedPomos = productiveWindows
    .map((window) => ({
      ...window,
      pomodoroWeight: getAccountStatsPomodoroEquivalent(window.entry),
    }))
    .filter((window) => window.pomodoroWeight > 0);
  const sessions = buildAnalyticsSessions(normalizedLogs);

  const todayStartMs = startOfLocalDay(nowMs);
  const tomorrowStartMs = todayStartMs + DAY_MS;
  const thisWeekStartMs = startOfLocalWeek(nowMs);
  const lastWeekStartMs = thisWeekStartMs - WEEK_MS;
  const joinedAtMsRaw = Date.parse(joinedAt);
  const joinedAtMs = Number.isFinite(joinedAtMsRaw)
    ? Math.min(joinedAtMsRaw, nowMs)
    : (normalizedLogs[0]?.startMs ?? nowMs);
  const weekdayOccurrences = countWeekdayOccurrences(joinedAtMs, nowMs);
  const dailyTrendStartMs = todayStartMs - ((DAILY_TREND_DAYS - 1) * DAY_MS);
  const sessionLaneStartMs = todayStartMs - ((SESSION_LANE_DAYS - 1) * DAY_MS);
  const dailyTrend = Array.from({ length: DAILY_TREND_DAYS }, (_, index) => {
    const dayMs = dailyTrendStartMs + (index * DAY_MS);
    return {
      dateKey: getLocalDateKey(dayMs),
      focusMinutes: 0,
      pomodoros: 0,
      sessions: 0,
    };
  });
  const dailyTrendMap = new Map(dailyTrend.map((point) => [point.dateKey, point]));
  const sessionLanes = Array.from({ length: SESSION_LANE_DAYS }, (_, index) => {
    const dayMs = sessionLaneStartMs + (index * DAY_MS);
    return {
      dateKey: getLocalDateKey(dayMs),
      weekday: new Date(dayMs).getDay(),
      totalFocusMinutes: 0,
      sessions: [] as AccountSessionLaneEntry[],
    };
  });
  const sessionLaneMap = new Map(sessionLanes.map((lane) => [lane.dateKey, lane]));

  const hourlyFocusMinutes = new Array<number>(24).fill(0);
  const weekdayFocusMinutes = new Array<number>(7).fill(0);
  const todayHourlyFocusMinutes = new Array<number>(24).fill(0);
  const weekdayHourHeatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const dayPartTotals: Record<DayPartKey, number> = {
    morning: 0,
    afternoon: 0,
    night: 0,
  };
  const categoryMinutes = new Map<string, number>();
  const todayCategoryMinutes = new Map<string, number>();

  let todayFocusMinutes = 0;
  let thisWeekFocusMinutes = 0;
  let lastWeekFocusMinutes = 0;

  productiveWindows.forEach((window) => {
    const categoryName = resolveLogEntryCategory(window.entry, categoriesById).name || 'Uncategorized';
    const totalMinutes = (window.endMs - window.startMs) / 60_000;

    categoryMinutes.set(categoryName, (categoryMinutes.get(categoryName) || 0) + totalMinutes);

    const todayOverlapMinutes = getOverlapMinutes(window.startMs, window.endMs, todayStartMs, tomorrowStartMs);
    if (todayOverlapMinutes > 0) {
      todayFocusMinutes += todayOverlapMinutes;
      todayCategoryMinutes.set(categoryName, (todayCategoryMinutes.get(categoryName) || 0) + todayOverlapMinutes);
    }

    thisWeekFocusMinutes += getOverlapMinutes(window.startMs, window.endMs, thisWeekStartMs, thisWeekStartMs + WEEK_MS);
    lastWeekFocusMinutes += getOverlapMinutes(window.startMs, window.endMs, lastWeekStartMs, thisWeekStartMs);

    distributeByDay(window.startMs, window.endMs, (dateKey, minutes) => {
      const trendPoint = dailyTrendMap.get(dateKey);
      if (trendPoint) {
        trendPoint.focusMinutes += minutes;
      }
      const lane = sessionLaneMap.get(dateKey);
      if (lane) {
        lane.totalFocusMinutes += minutes;
      }
    });

    distributeByHour(window.startMs, window.endMs, (date, minutes) => {
      const hour = date.getHours();
      const weekday = date.getDay();
      hourlyFocusMinutes[hour] += minutes;
      weekdayFocusMinutes[weekday] += minutes;
      weekdayHourHeatmap[weekday][hour] += minutes;
      dayPartTotals[getDayPart(hour)] += minutes;
      if (date.getTime() >= todayStartMs && date.getTime() < tomorrowStartMs) {
        todayHourlyFocusMinutes[hour] += minutes;
      }
    });
  });

  let todayPomos = 0;
  let thisWeekPomos = 0;
  let lastWeekPomos = 0;

  completedPomos.forEach((window) => {
    const endDateKey = getLocalDateKey(window.endMs);
    const trendPoint = dailyTrendMap.get(endDateKey);
    if (trendPoint) trendPoint.pomodoros += window.pomodoroWeight;
    if (window.endMs >= todayStartMs && window.endMs < tomorrowStartMs) todayPomos += window.pomodoroWeight;
    if (window.endMs >= thisWeekStartMs && window.endMs < thisWeekStartMs + WEEK_MS) thisWeekPomos += window.pomodoroWeight;
    else if (window.endMs >= lastWeekStartMs && window.endMs < thisWeekStartMs) lastWeekPomos += window.pomodoroWeight;
  });

  const sessionStartMinutes = sessions.map((session) => getMinutesOfDay(session.startMs));
  const averageStartMinutes = averageTimeOfDayMinutes(sessionStartMinutes);

  const quitBucketCounts = new Map<number, number>();
  sessions.forEach((session) => {
    if (!session.closed || session.endMs === null) return;
    const bucket = Math.round(getMinutesOfDay(session.endMs) / QUIT_TIME_BUCKET_MINUTES) * QUIT_TIME_BUCKET_MINUTES;
    const normalizedBucket = ((bucket % 1440) + 1440) % 1440;
    quitBucketCounts.set(normalizedBucket, (quitBucketCounts.get(normalizedBucket) || 0) + 1);
  });

  const quitCountMax = Math.max(0, ...Array.from(quitBucketCounts.values()));
  const rawMostCommonQuitBuckets = quitCountMax > 0
    ? Array.from(quitBucketCounts.entries())
        .filter(([, count]) => count === quitCountMax)
        .map(([bucket]) => bucket)
        .sort((a, b) => a - b)
    : [];
  const mostCommonQuitBuckets = rawMostCommonQuitBuckets.length > 2
    ? [Math.round(averageClockMinutes(rawMostCommonQuitBuckets) ?? rawMostCommonQuitBuckets[0] ?? 0)]
    : rawMostCommonQuitBuckets;

  const mostProductiveHourFocusMinutes = Math.max(0, ...hourlyFocusMinutes);
  const mostProductiveHours = mostProductiveHourFocusMinutes > 0
    ? hourlyFocusMinutes
        .map((minutes, hour) => ({ minutes, hour }))
        .filter((item) => item.minutes === mostProductiveHourFocusMinutes)
        .map((item) => item.hour)
    : [];

  const weekdayAverages = weekdayFocusMinutes.map((minutes, weekday) => {
    const occurrences = weekdayOccurrences[weekday] || 0;
    return occurrences > 0 ? minutes / occurrences : 0;
  });
  const mostProductiveWeekdayAverage = Math.max(0, ...weekdayAverages);
  const mostProductiveWeekdays = mostProductiveWeekdayAverage > 0
    ? weekdayAverages
        .map((averageFocusMinutes, weekday) => ({ averageFocusMinutes, weekday }))
        .filter((item) => item.averageFocusMinutes === mostProductiveWeekdayAverage)
        .map((item) => item.weekday)
    : [];

  const totalCategorizedMinutes = Array.from(categoryMinutes.values()).reduce((acc, value) => acc + value, 0);
  const categorySlices = Array.from(categoryMinutes.entries())
    .filter(([, minutes]) => minutes > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, minutes]) => ({
      name,
      minutes,
      share: totalCategorizedMinutes > 0 ? minutes / totalCategorizedMinutes : 0,
    }));
  const topCategory = categorySlices.find((slice) => slice.name !== 'Uncategorized') || null;
  const hasCategorizedWork = categorySlices.some((slice) => slice.name !== 'Uncategorized');

  const dominantDayPartMinutes = Math.max(0, ...DAY_PART_LABELS.map((key) => dayPartTotals[key]));
  const dominantDayParts = dominantDayPartMinutes > 0
    ? DAY_PART_LABELS.filter((key) => dayPartTotals[key] === dominantDayPartMinutes)
    : [];

  const peakTodayMinutes = Math.max(0, ...todayHourlyFocusMinutes);
  const peakHourToday = peakTodayMinutes > 0 ? todayHourlyFocusMinutes.findIndex((minutes) => minutes === peakTodayMinutes) : -1;
  const todayTopCategoryName = Array.from(todayCategoryMinutes.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const todaySessions = sessions.filter((session) => session.startMs >= todayStartMs && session.startMs < tomorrowStartMs);
  const thisWeekSessions = sessions.filter((session) => session.startMs >= thisWeekStartMs && session.startMs < thisWeekStartMs + WEEK_MS);
  const lastWeekSessions = sessions.filter((session) => session.startMs >= lastWeekStartMs && session.startMs < thisWeekStartMs);
  const todayFirstStartMinutes = todaySessions.length > 0
    ? Math.min(...todaySessions.map((session) => getMinutesOfDay(session.startMs)))
    : null;

  sessions.forEach((session) => {
    const dateKey = getLocalDateKey(session.startMs);
    const trendPoint = dailyTrendMap.get(dateKey);
    if (trendPoint) trendPoint.sessions += 1;

    const lane = sessionLaneMap.get(dateKey);
    if (!lane) return;
    const sessionEndMs = session.endMs;
    const sessionEndDate = sessionEndMs !== null ? new Date(sessionEndMs) : null;
    const startMinutes = getMinutesOfDay(session.startMs);
    const endMinutes = sessionEndDate && getLocalDateKey(sessionEndMs as number) === dateKey
      ? getMinutesOfDay(sessionEndMs as number)
      : 1440;
    lane.sessions.push({
      id: `${session.startMs}:${sessionEndMs ?? 'open'}`,
      startMs: session.startMs,
      endMs: sessionEndMs,
      closed: session.closed,
      startMinutes,
      endMinutes: Math.max(startMinutes + 1, endMinutes),
      durationMinutes: Math.max(1, session.activeDurationMinutes),
    });
  });

  const heatmapMaxMinutes = weekdayHourHeatmap.reduce((max, row) => {
    const rowMax = row.reduce((rowAcc, value) => Math.max(rowAcc, value), 0);
    return Math.max(max, rowMax);
  }, 0);

  return {
    today: {
      focusMinutes: todayFocusMinutes,
      pomodoros: todayPomos,
      sessions: todaySessions.length,
      firstStartMinutes: todayFirstStartMinutes,
      peakHour: peakHourToday >= 0 ? peakHourToday : null,
      topCategoryName: todayTopCategoryName,
    },
    mostProductiveHours: {
      hours: mostProductiveHours,
      focusMinutes: mostProductiveHourFocusMinutes,
    },
    mostProductiveWeekdays: {
      weekdays: mostProductiveWeekdays,
      averageFocusMinutes: mostProductiveWeekdayAverage,
    },
    topCategory: topCategory
      ? {
          name: topCategory.name,
          minutes: topCategory.minutes,
          share: topCategory.share,
        }
      : null,
    categorySlices,
    hasCategorizedWork,
    averageStartMinutes,
    mostCommonQuitTimes: {
      bucketMinutes: mostCommonQuitBuckets,
      count: quitCountMax,
      sourceBucketCount: rawMostCommonQuitBuckets.length,
    },
    dayPartTotals,
    dominantDayParts,
    hourlyFocusMinutes,
    todayHourlyFocusMinutes,
    weekdayHourHeatmap,
    heatmapMaxMinutes,
    sessions,
    dailyFocusTrend: dailyTrend,
    sessionLanes,
    weekComparison: {
      thisWeek: {
        focusMinutes: thisWeekFocusMinutes,
        pomodoros: thisWeekPomos,
        sessions: thisWeekSessions.length,
      },
      lastWeek: {
        focusMinutes: lastWeekFocusMinutes,
        pomodoros: lastWeekPomos,
        sessions: lastWeekSessions.length,
      },
      focusDeltaMinutes: thisWeekFocusMinutes - lastWeekFocusMinutes,
      focusDeltaPct: getChangePct(thisWeekFocusMinutes, lastWeekFocusMinutes),
      pomoDelta: thisWeekPomos - lastWeekPomos,
      pomoDeltaPct: getChangePct(thisWeekPomos, lastWeekPomos),
      sessionDelta: thisWeekSessions.length - lastWeekSessions.length,
      sessionDeltaPct: getChangePct(thisWeekSessions.length, lastWeekSessions.length),
    },
  };
};
