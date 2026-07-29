export const APP_OPEN_STREAK_STORAGE_KEY = 'doro_app_open_streak_v1';
export const WEEKLY_STREAK_FREEZES = 2;
const STREAK_HISTORY_RETENTION_DAYS = 120;

export type AppOpenStreakDayStatus = 'active' | 'frozen';

export interface AppOpenStreakDaySnapshot {
  dateKey: string;
  weekdayLabel: string;
  status: AppOpenStreakDayStatus | null;
}

export interface AppOpenStreakState {
  currentStreak: number;
  bestStreak: number;
  lastOpenDate: string | null;
  freezeUsageByWeek: Record<string, number>;
  historyByDate: Record<string, AppOpenStreakDayStatus>;
}

export interface AppOpenStreakSnapshot extends AppOpenStreakState {
  todayDate: string;
  currentWeekKey: string;
  freezesUsedThisWeek: number;
  freezesAvailableThisWeek: number;
  missedDays: number;
  preservedMissedDays: number;
  streakBroken: boolean;
  openedToday: boolean;
  rollingDays: AppOpenStreakDaySnapshot[];
}

type EarnedStreakStats = {
  currentStreak?: unknown;
  bestStreak?: unknown;
  lastActiveDate?: unknown;
} | null | undefined;

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const getLocalDateKey = (value: Date | number = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateKey = (dateKey: string) => {
  if (!DATE_KEY_PATTERN.test(dateKey)) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
};

export const getLocalWeekKey = (dateKey: string) => {
  const date = parseDateKey(dateKey);
  if (!date) return getLocalDateKey();
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - date.getDay());
  return getLocalDateKey(weekStart);
};

const addLocalDays = (dateKey: string, days: number) => {
  const date = parseDateKey(dateKey);
  if (!date) return null;
  date.setDate(date.getDate() + days);
  return getLocalDateKey(date);
};

const diffLocalDateKeys = (fromDateKey: string, toDateKey: string) => {
  const fromDate = parseDateKey(fromDateKey);
  const toDate = parseDateKey(toDateKey);
  if (!fromDate || !toDate) return null;
  const fromUtc = Date.UTC(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const toUtc = Date.UTC(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
  return Math.round((toUtc - fromUtc) / 86_400_000);
};

const clampFreezeUsage = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(WEEKLY_STREAK_FREEZES, Math.floor(value)));
};

const getNonNegativeStreakInt = (value: unknown) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tues', 'Wed', 'Thurs', 'Fri', 'Sat'];

const getWeekdayLabel = (dateKey: string) => {
  const date = parseDateKey(dateKey);
  return date ? WEEKDAY_LABELS[date.getDay()] : '';
};

const sanitizeHistoryByDate = (value: unknown) => (
  Object.entries(value && typeof value === 'object' ? value as Record<string, unknown> : {}).reduce<Record<string, AppOpenStreakDayStatus>>(
    (history, [dateKey, status]) => {
      if (parseDateKey(dateKey) && (status === 'active' || status === 'frozen')) {
        history[dateKey] = status;
      }
      return history;
    },
    {},
  )
);

const pruneHistoryByDate = (
  historyByDate: Record<string, AppOpenStreakDayStatus>,
  todayDate: string,
) => (
  Object.entries(historyByDate).reduce<Record<string, AppOpenStreakDayStatus>>((history, [dateKey, status]) => {
    const daysAgo = diffLocalDateKeys(dateKey, todayDate);
    if (daysAgo !== null && daysAgo >= 0 && daysAgo <= STREAK_HISTORY_RETENTION_DAYS) {
      history[dateKey] = status;
    }
    return history;
  }, {})
);

const buildRollingDays = (
  todayDate: string,
  historyByDate: Record<string, AppOpenStreakDayStatus>,
) => (
  Array.from({ length: 7 }, (_, index) => {
    const dateKey = addLocalDays(todayDate, index - 6) ?? todayDate;
    return {
      dateKey,
      weekdayLabel: getWeekdayLabel(dateKey),
      status: historyByDate[dateKey] ?? null,
    };
  })
);

const backfillEarnedActiveDays = (
  historyByDate: Record<string, AppOpenStreakDayStatus>,
  todayDate: string,
  earnedCurrentStreak: number,
  earnedLastActiveDate: unknown,
) => {
  if (earnedCurrentStreak <= 0) return historyByDate;

  const candidateEndDate = typeof earnedLastActiveDate === 'string' && parseDateKey(earnedLastActiveDate)
    ? earnedLastActiveDate
    : todayDate;
  const diffToToday = diffLocalDateKeys(candidateEndDate, todayDate);
  const endDate = diffToToday !== null && diffToToday >= 0 && diffToToday <= 1
    ? candidateEndDate
    : todayDate;
  let nextHistory = historyByDate;

  for (let dayOffset = 0; dayOffset < Math.min(earnedCurrentStreak, 7); dayOffset += 1) {
    const dateKey = addLocalDays(endDate, -dayOffset);
    if (!dateKey) continue;
    const daysAgo = diffLocalDateKeys(dateKey, todayDate);
    if (daysAgo === null || daysAgo < 0 || daysAgo > STREAK_HISTORY_RETENTION_DAYS) continue;
    if (nextHistory[dateKey] === 'active') continue;
    if (nextHistory === historyByDate) nextHistory = { ...historyByDate };
    nextHistory[dateKey] = 'active';
  }

  return nextHistory;
};

export const createEmptyAppOpenStreakState = (): AppOpenStreakState => ({
  currentStreak: 0,
  bestStreak: 0,
  lastOpenDate: null,
  freezeUsageByWeek: {},
  historyByDate: {},
});

export const sanitizeAppOpenStreakState = (value: unknown): AppOpenStreakState => {
  if (!value || typeof value !== 'object') return createEmptyAppOpenStreakState();

  const candidate = value as Partial<AppOpenStreakState>;
  const currentStreak = typeof candidate.currentStreak === 'number' && Number.isFinite(candidate.currentStreak)
    ? Math.max(0, Math.floor(candidate.currentStreak))
    : 0;
  const bestStreak = typeof candidate.bestStreak === 'number' && Number.isFinite(candidate.bestStreak)
    ? Math.max(0, Math.floor(candidate.bestStreak))
    : currentStreak;
  const lastOpenDate = typeof candidate.lastOpenDate === 'string' && parseDateKey(candidate.lastOpenDate)
    ? candidate.lastOpenDate
    : null;
  const freezeUsageByWeek = Object.entries(candidate.freezeUsageByWeek ?? {}).reduce<Record<string, number>>(
    (usage, [weekKey, used]) => {
      if (parseDateKey(weekKey)) usage[weekKey] = clampFreezeUsage(used);
      return usage;
    },
    {},
  );
  const historyByDate = sanitizeHistoryByDate(candidate.historyByDate);

  return {
    currentStreak,
    bestStreak: Math.max(bestStreak, currentStreak),
    lastOpenDate,
    freezeUsageByWeek,
    historyByDate,
  };
};

export const resolveAppOpenStreak = (
  value: unknown,
  nowMs: number = Date.now(),
): AppOpenStreakSnapshot => {
  const previous = sanitizeAppOpenStreakState(value);
  const todayDate = getLocalDateKey(nowMs);
  const currentWeekKey = getLocalWeekKey(todayDate);
  const freezeUsageByWeek = { ...previous.freezeUsageByWeek };
  const historyByDate = { ...previous.historyByDate };
  let currentStreak = previous.currentStreak;
  let bestStreak = previous.bestStreak;
  let lastOpenDate = previous.lastOpenDate;
  let missedDays = 0;
  let preservedMissedDays = 0;
  let streakBroken = false;
  let openedToday = false;

  if (!lastOpenDate) {
    currentStreak = 1;
    lastOpenDate = todayDate;
    historyByDate[todayDate] = 'active';
  } else {
    const elapsedDays = diffLocalDateKeys(lastOpenDate, todayDate);

    if (elapsedDays === null || elapsedDays < 0) {
      currentStreak = 1;
      lastOpenDate = todayDate;
      historyByDate[todayDate] = 'active';
    } else if (elapsedDays === 0) {
      openedToday = true;
      currentStreak = Math.max(1, currentStreak);
      historyByDate[todayDate] = 'active';
    } else {
      missedDays = Math.max(0, elapsedDays - 1);

      for (let dayOffset = 1; dayOffset < elapsedDays; dayOffset += 1) {
        const missedDate = addLocalDays(lastOpenDate, dayOffset);
        if (!missedDate) continue;
        const missedWeekKey = getLocalWeekKey(missedDate);
        const usedThisWeek = freezeUsageByWeek[missedWeekKey] ?? 0;

        if (usedThisWeek >= WEEKLY_STREAK_FREEZES) {
          streakBroken = true;
          break;
        }

        freezeUsageByWeek[missedWeekKey] = usedThisWeek + 1;
        historyByDate[missedDate] = 'frozen';
        preservedMissedDays += 1;
      }

      currentStreak = streakBroken ? 1 : Math.max(0, currentStreak) + 1;
      lastOpenDate = todayDate;
      historyByDate[todayDate] = 'active';
    }
  }

  bestStreak = Math.max(bestStreak, currentStreak);
  const freezesUsedThisWeek = freezeUsageByWeek[currentWeekKey] ?? 0;
  const prunedHistoryByDate = pruneHistoryByDate(historyByDate, todayDate);

  return {
    currentStreak,
    bestStreak,
    lastOpenDate,
    freezeUsageByWeek,
    historyByDate: prunedHistoryByDate,
    todayDate,
    currentWeekKey,
    freezesUsedThisWeek,
    freezesAvailableThisWeek: Math.max(0, WEEKLY_STREAK_FREEZES - freezesUsedThisWeek),
    missedDays,
    preservedMissedDays,
    streakBroken,
    openedToday,
    rollingDays: buildRollingDays(todayDate, prunedHistoryByDate),
  };
};

export const readAppOpenStreakState = (storage: Pick<Storage, 'getItem'>): AppOpenStreakState => {
  try {
    const stored = storage.getItem(APP_OPEN_STREAK_STORAGE_KEY);
    return sanitizeAppOpenStreakState(stored ? JSON.parse(stored) : null);
  } catch {
    return createEmptyAppOpenStreakState();
  }
};

export const recordAppOpenStreak = (
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  nowMs: number = Date.now(),
) => {
  const snapshot = resolveAppOpenStreak(readAppOpenStreakState(storage), nowMs);
  storage.setItem(APP_OPEN_STREAK_STORAGE_KEY, JSON.stringify({
    currentStreak: snapshot.currentStreak,
    bestStreak: snapshot.bestStreak,
    lastOpenDate: snapshot.lastOpenDate,
    freezeUsageByWeek: snapshot.freezeUsageByWeek,
    historyByDate: snapshot.historyByDate,
  }));
  return snapshot;
};

const writeAppOpenStreakSnapshot = (
  storage: Pick<Storage, 'setItem'>,
  snapshot: AppOpenStreakSnapshot,
) => {
  storage.setItem(APP_OPEN_STREAK_STORAGE_KEY, JSON.stringify({
    currentStreak: snapshot.currentStreak,
    bestStreak: snapshot.bestStreak,
    lastOpenDate: snapshot.lastOpenDate,
    freezeUsageByWeek: snapshot.freezeUsageByWeek,
    historyByDate: snapshot.historyByDate,
  }));
};

const preserveEarnedStreakInSnapshot = (
  snapshot: AppOpenStreakSnapshot,
  earnedStats: EarnedStreakStats,
): AppOpenStreakSnapshot => {
  const earnedCurrent = getNonNegativeStreakInt(earnedStats?.currentStreak);
  const earnedBest = getNonNegativeStreakInt(earnedStats?.bestStreak);
  const currentStreak = Math.max(snapshot.currentStreak, earnedCurrent);
  const bestStreak = Math.max(snapshot.bestStreak, earnedBest, currentStreak);
  const historyByDate = backfillEarnedActiveDays(
    snapshot.historyByDate,
    snapshot.todayDate,
    earnedCurrent,
    earnedStats?.lastActiveDate,
  );

  if (
    currentStreak === snapshot.currentStreak
    && bestStreak === snapshot.bestStreak
    && historyByDate === snapshot.historyByDate
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    currentStreak,
    bestStreak,
    historyByDate,
    rollingDays: buildRollingDays(snapshot.todayDate, historyByDate),
  };
};

export const recordAppOpenStreakWithEarnedStats = (
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  earnedStats: EarnedStreakStats,
  nowMs: number = Date.now(),
) => {
  const recorded = recordAppOpenStreak(storage, nowMs);
  const preserved = preserveEarnedStreakInSnapshot(recorded, earnedStats);
  if (preserved !== recorded) writeAppOpenStreakSnapshot(storage, preserved);
  return preserved;
};

export const preserveAppOpenStreakWithEarnedStats = (
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  earnedStats: EarnedStreakStats,
  nowMs: number = Date.now(),
) => {
  const snapshot = resolveAppOpenStreak(readAppOpenStreakState(storage), nowMs);
  const preserved = preserveEarnedStreakInSnapshot(snapshot, earnedStats);
  if (preserved !== snapshot) writeAppOpenStreakSnapshot(storage, preserved);
  return preserved;
};

export const getAppOpenStreakSnapshot = (
  storage: Pick<Storage, 'getItem'>,
  nowMs: number = Date.now(),
) => resolveAppOpenStreak(readAppOpenStreakState(storage), nowMs);
