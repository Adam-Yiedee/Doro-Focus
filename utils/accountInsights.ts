import { Category, LogEntry, SessionCategoryStat, SessionRecord } from '../types';
import { getCategoryMapById, resolveLogEntryCategory } from './categoryTracking';
import { LONG_GRACE_SESSION_TIMEOUT_SECONDS } from './timerRuntime';
import {
  getAccountStatsFocusSeconds,
  getAccountStatsPomodoroEquivalent,
  getAccountStatsSessionPomodoroEquivalent,
} from './pomodoroAccounting';
import { isProductiveFocusLog } from './logClassification';

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
  totalDurationMinutes: number;
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

export interface AccountLogWindow {
  startMs: number;
  endMs: number;
}

interface NormalizedLogWindow extends AccountLogWindow {
  entry: LogEntry;
}

type AccountInsightDayTotals = {
  focusMinutes: number;
  pomodoros: number;
  sessions: number;
  categoryMinutes: Map<string, number>;
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

const isTotalSessionDurationLog = (entry: LogEntry) => {
  if (entry.type === 'break') return true;
  return isProductiveFocusLog(entry);
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

const getLocalDateKeyStartMs = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) return null;
  return new Date(year, (month || 1) - 1, day || 1).getTime();
};

const getDayPart = (hour: number): DayPartKey => {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'night';
};

const getPositiveDurationSeconds = (duration: unknown) => {
  const seconds = typeof duration === 'number' ? duration : Number(duration || 0);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
};

const createDayTotals = (): AccountInsightDayTotals => ({
  focusMinutes: 0,
  pomodoros: 0,
  sessions: 0,
  categoryMinutes: new Map<string, number>(),
});

const getDayTotals = (map: Map<string, AccountInsightDayTotals>, dateKey: string) => {
  const existing = map.get(dateKey);
  if (existing) return existing;
  const created = createDayTotals();
  map.set(dateKey, created);
  return created;
};

const addCategoryMinutes = (
  totals: AccountInsightDayTotals,
  categoryName: string,
  minutes: number,
) => {
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  const safeCategoryName = categoryName || 'Uncategorized';
  totals.categoryMinutes.set(
    safeCategoryName,
    (totals.categoryMinutes.get(safeCategoryName) || 0) + minutes,
  );
};

const addSessionCategoryMinutes = (
  totals: AccountInsightDayTotals,
  session: SessionRecord,
  categoriesById: ReturnType<typeof getCategoryMapById>,
) => {
  const categoryDetails = Array.isArray(session.stats?.categoryDetails)
    ? session.stats.categoryDetails
    : [];

  if (categoryDetails.length > 0) {
    categoryDetails.forEach((detail) => {
      const safeDetail = detail as SessionCategoryStat;
      const minutes = Number(safeDetail.minutes);
      if (!Number.isFinite(minutes) || minutes <= 0) return;
      addCategoryMinutes(totals, resolveLogEntryCategory(safeDetail, categoriesById).name || 'Uncategorized', minutes);
    });
    return;
  }

  if (session.stats?.categoryStats && typeof session.stats.categoryStats === 'object') {
    Object.entries(session.stats.categoryStats).forEach(([name, minutes]) => {
      addCategoryMinutes(totals, name, Number(minutes));
    });
  }
};

const getSessionWorkMinutes = (session: SessionRecord) => {
  const minutes = Number(session.stats?.totalWorkMinutes || 0);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
};

export const normalizeAccountLogWindow = (entry: LogEntry): AccountLogWindow | null => {
  const startMs = Date.parse(entry.start);
  if (!Number.isFinite(startMs)) return null;

  const durationSeconds = isProductiveFocusLog(entry)
    ? getAccountStatsFocusSeconds(entry)
    : getPositiveDurationSeconds(entry.duration);
  const durationEndMs = durationSeconds > 0 ? startMs + (durationSeconds * 1000) : null;
  const parsedEndMs = Date.parse(entry.end);
  const endMs = durationEndMs ?? (Number.isFinite(parsedEndMs) ? parsedEndMs : null);

  if (endMs === null || endMs <= startMs) return null;
  return { startMs, endMs };
};

const normalizeLogWindow = (entry: LogEntry): NormalizedLogWindow | null => {
  const window = normalizeAccountLogWindow(entry);
  return window ? { entry, ...window } : null;
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
  let currentTotalDurationMs = 0;
  let pendingStartMs: number | null = null;

  windows.forEach((window) => {
    if (isNeutralGraceBoundary(window.entry)) {
      if (currentStartMs !== null && window.startMs > currentStartMs) {
        sessions.push({
          startMs: currentStartMs,
          endMs: window.startMs,
          closed: true,
          totalDurationMinutes: Math.max(1, currentTotalDurationMs / 60_000),
        });
      }
      currentStartMs = null;
      currentLastEndMs = null;
      currentTotalDurationMs = 0;
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
    if (isTotalSessionDurationLog(window.entry)) {
      currentTotalDurationMs += Math.max(0, window.endMs - window.startMs);
    }

    if (isSessionEndLog(window.entry) && currentStartMs !== null && currentLastEndMs > currentStartMs) {
      sessions.push({
        startMs: currentStartMs,
        endMs: currentLastEndMs,
        closed: true,
        totalDurationMinutes: Math.max(1, currentTotalDurationMs / 60_000),
      });
      currentStartMs = null;
      currentLastEndMs = null;
      currentTotalDurationMs = 0;
    }
  });

  if (currentStartMs !== null && currentLastEndMs !== null && currentLastEndMs > currentStartMs) {
    sessions.push({
      startMs: currentStartMs,
      endMs: currentLastEndMs,
      closed: false,
      totalDurationMinutes: Math.max(1, currentTotalDurationMs / 60_000),
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
  sessions: sessionRecords = [],
  categories,
  joinedAt,
  nowMs = Date.now(),
}: {
  logs: LogEntry[];
  sessions?: SessionRecord[];
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

  const productiveWindows = normalizedLogs.filter((window) => isProductiveFocusLog(window.entry));
  const completedPomos = productiveWindows
    .map((window) => ({
      ...window,
      pomodoroWeight: getAccountStatsPomodoroEquivalent(window.entry),
    }))
    .filter((window) => window.pomodoroWeight > 0);
  const analyticsSessions = buildAnalyticsSessions(normalizedLogs);

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
  const logDayTotals = new Map<string, AccountInsightDayTotals>();
  const sessionDayTotals = new Map<string, AccountInsightDayTotals>();

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
      const logDay = getDayTotals(logDayTotals, dateKey);
      logDay.focusMinutes += minutes;
      addCategoryMinutes(logDay, categoryName, minutes);

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
    const logDay = getDayTotals(logDayTotals, endDateKey);
    logDay.pomodoros += window.pomodoroWeight;

    const trendPoint = dailyTrendMap.get(endDateKey);
    if (trendPoint) trendPoint.pomodoros += window.pomodoroWeight;
    if (window.endMs >= todayStartMs && window.endMs < tomorrowStartMs) todayPomos += window.pomodoroWeight;
    if (window.endMs >= thisWeekStartMs && window.endMs < thisWeekStartMs + WEEK_MS) thisWeekPomos += window.pomodoroWeight;
    else if (window.endMs >= lastWeekStartMs && window.endMs < thisWeekStartMs) lastWeekPomos += window.pomodoroWeight;
  });

  const safeSessionRecords = Array.isArray(sessionRecords) ? sessionRecords : [];
  safeSessionRecords.forEach((session) => {
    const sessionStartMs = Date.parse(session.startTime);
    if (!Number.isFinite(sessionStartMs)) return;
    const dateKey = getLocalDateKey(sessionStartMs);
    const totals = getDayTotals(sessionDayTotals, dateKey);
    totals.focusMinutes += getSessionWorkMinutes(session);
    totals.pomodoros += getAccountStatsSessionPomodoroEquivalent(session);
    totals.sessions += 1;
    addSessionCategoryMinutes(totals, session, categoriesById);
  });

  const todayDateKey = getLocalDateKey(todayStartMs);
  sessionDayTotals.forEach((sessionTotals, dateKey) => {
    const logTotals = logDayTotals.get(dateKey) || createDayTotals();
    const dateStartMs = getLocalDateKeyStartMs(dateKey);
    const hasLoggedFocus = logTotals.focusMinutes > 0.01;
    const focusAdjustment = hasLoggedFocus
      ? 0
      : Math.max(0, sessionTotals.focusMinutes - logTotals.focusMinutes);
    const pomoAdjustment = hasLoggedFocus
      ? 0
      : Math.max(0, sessionTotals.pomodoros - logTotals.pomodoros);

    if (focusAdjustment > 0) {
      const trendPoint = dailyTrendMap.get(dateKey);
      if (trendPoint) trendPoint.focusMinutes += focusAdjustment;

      const lane = sessionLaneMap.get(dateKey);
      if (lane) lane.totalFocusMinutes += focusAdjustment;

      if (dateKey === todayDateKey) {
        todayFocusMinutes += focusAdjustment;
      }
      if (dateStartMs !== null && dateStartMs >= thisWeekStartMs && dateStartMs < thisWeekStartMs + WEEK_MS) {
        thisWeekFocusMinutes += focusAdjustment;
      } else if (dateStartMs !== null && dateStartMs >= lastWeekStartMs && dateStartMs < thisWeekStartMs) {
        lastWeekFocusMinutes += focusAdjustment;
      }

      let categoryAdjustmentTotal = 0;
      sessionTotals.categoryMinutes.forEach((minutes, categoryName) => {
        const adjustment = Math.max(0, minutes - (logTotals.categoryMinutes.get(categoryName) || 0));
        if (adjustment <= 0) return;
        categoryAdjustmentTotal += adjustment;
        categoryMinutes.set(categoryName, (categoryMinutes.get(categoryName) || 0) + adjustment);
        if (dateKey === todayDateKey) {
          todayCategoryMinutes.set(categoryName, (todayCategoryMinutes.get(categoryName) || 0) + adjustment);
        }
      });

      if (categoryAdjustmentTotal < focusAdjustment - 0.01) {
        const adjustment = focusAdjustment - categoryAdjustmentTotal;
        categoryMinutes.set('Uncategorized', (categoryMinutes.get('Uncategorized') || 0) + adjustment);
        if (dateKey === todayDateKey) {
          todayCategoryMinutes.set('Uncategorized', (todayCategoryMinutes.get('Uncategorized') || 0) + adjustment);
        }
      }
    }

    if (pomoAdjustment > 0) {
      const trendPoint = dailyTrendMap.get(dateKey);
      if (trendPoint) trendPoint.pomodoros += pomoAdjustment;
      if (dateKey === todayDateKey) todayPomos += pomoAdjustment;
      if (dateStartMs !== null && dateStartMs >= thisWeekStartMs && dateStartMs < thisWeekStartMs + WEEK_MS) {
        thisWeekPomos += pomoAdjustment;
      } else if (dateStartMs !== null && dateStartMs >= lastWeekStartMs && dateStartMs < thisWeekStartMs) {
        lastWeekPomos += pomoAdjustment;
      }
    }
  });

  const sessionStartMinutes = analyticsSessions.map((session) => getMinutesOfDay(session.startMs));
  const averageStartMinutes = averageTimeOfDayMinutes(sessionStartMinutes);

  const quitBucketCounts = new Map<number, number>();
  analyticsSessions.forEach((session) => {
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

  const todaySessions = analyticsSessions.filter((session) => session.startMs >= todayStartMs && session.startMs < tomorrowStartMs);
  const thisWeekSessions = analyticsSessions.filter((session) => session.startMs >= thisWeekStartMs && session.startMs < thisWeekStartMs + WEEK_MS);
  const lastWeekSessions = analyticsSessions.filter((session) => session.startMs >= lastWeekStartMs && session.startMs < thisWeekStartMs);
  const getArchivedSessionCountInRange = (startMs: number, endMs: number) => {
    let count = 0;
    sessionDayTotals.forEach((totals, dateKey) => {
      const dateStartMs = getLocalDateKeyStartMs(dateKey);
      if (dateStartMs !== null && dateStartMs >= startMs && dateStartMs < endMs) {
        count += totals.sessions;
      }
    });
    return count;
  };
  const todaySessionCount = Math.max(todaySessions.length, getArchivedSessionCountInRange(todayStartMs, tomorrowStartMs));
  const thisWeekSessionCount = Math.max(
    thisWeekSessions.length,
    getArchivedSessionCountInRange(thisWeekStartMs, thisWeekStartMs + WEEK_MS),
  );
  const lastWeekSessionCount = Math.max(
    lastWeekSessions.length,
    getArchivedSessionCountInRange(lastWeekStartMs, thisWeekStartMs),
  );
  const archivedTodayStartMinutes = safeSessionRecords
    .map((session) => Date.parse(session.startTime))
    .filter((startMs) => Number.isFinite(startMs) && startMs >= todayStartMs && startMs < tomorrowStartMs)
    .map(getMinutesOfDay);
  const todayFirstStartMinutes = todaySessions.length > 0
    ? Math.min(...todaySessions.map((session) => getMinutesOfDay(session.startMs)))
    : (archivedTodayStartMinutes.length > 0 ? Math.min(...archivedTodayStartMinutes) : null);

  analyticsSessions.forEach((session) => {
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
      durationMinutes: Math.max(1, session.totalDurationMinutes),
    });
  });

  sessionDayTotals.forEach((totals, dateKey) => {
    const trendPoint = dailyTrendMap.get(dateKey);
    if (trendPoint) trendPoint.sessions = Math.max(trendPoint.sessions, totals.sessions);
  });

  const heatmapMaxMinutes = weekdayHourHeatmap.reduce((max, row) => {
    const rowMax = row.reduce((rowAcc, value) => Math.max(rowAcc, value), 0);
    return Math.max(max, rowMax);
  }, 0);

  return {
    today: {
      focusMinutes: todayFocusMinutes,
      pomodoros: todayPomos,
      sessions: todaySessionCount,
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
    sessions: analyticsSessions,
    dailyFocusTrend: dailyTrend,
    sessionLanes,
    weekComparison: {
      thisWeek: {
        focusMinutes: thisWeekFocusMinutes,
        pomodoros: thisWeekPomos,
        sessions: thisWeekSessionCount,
      },
      lastWeek: {
        focusMinutes: lastWeekFocusMinutes,
        pomodoros: lastWeekPomos,
        sessions: lastWeekSessionCount,
      },
      focusDeltaMinutes: thisWeekFocusMinutes - lastWeekFocusMinutes,
      focusDeltaPct: getChangePct(thisWeekFocusMinutes, lastWeekFocusMinutes),
      pomoDelta: thisWeekPomos - lastWeekPomos,
      pomoDeltaPct: getChangePct(thisWeekPomos, lastWeekPomos),
      sessionDelta: thisWeekSessionCount - lastWeekSessionCount,
      sessionDeltaPct: getChangePct(thisWeekSessionCount, lastWeekSessionCount),
    },
  };
};
