import { Category, LogEntry, SessionCategoryStat, SessionRecord, User } from '../types';
import { getCategoryMapById, resolveLogEntryCategory } from './categoryTracking';
import {
  getPomodoroEquivalentWeight,
  getSessionPomodoroEquivalent,
} from './pomodoroAccounting';

export const EMPTY_LIFETIME_STATS: User['lifetimeStats'] = {
  totalFocusHours: 0,
  totalSessions: 0,
  totalPomos: 0,
  activeDays: 0,
  currentStreak: 0,
  bestStreak: 0,
  lastActiveDate: null,
  categoryBreakdown: {},
};

const getDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const isPauseCreditedWorkLog = (entry: LogEntry): boolean => {
  if (entry.type !== 'work') return false;
  const reason = (entry.reason || '').trim().toLowerCase();
  return reason.startsWith('paused') || reason.includes('pause credit');
};

const getSessionWorkMinutes = (session: SessionRecord): number => {
  const minutes = Number(session.stats?.totalWorkMinutes || 0);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
};

const getLocalDateKeyFromIso = (iso: string): string | null => {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return getDateKey(dt);
};

const parseDateKey = (value: string): Date | null => {
  const parts = value.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
};

const getDayDiff = (fromKey: string, toKey: string): number | null => {
  const from = parseDateKey(fromKey);
  const to = parseDateKey(toKey);
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
};

export const calculateLifetimeStatsFromData = (
  sessions: SessionRecord[],
  currentLogs: LogEntry[],
  categories: Category[],
): User['lifetimeStats'] => {
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const safeLogs = Array.isArray(currentLogs) ? currentLogs : [];
  const safeCategories = Array.isArray(categories) ? categories : [];

  const productiveLogs = safeLogs.filter((entry) => {
    if (entry.type !== 'work') return false;
    if (!Number.isFinite(entry.duration) || entry.duration <= 0) return false;
    return !isPauseCreditedWorkLog(entry);
  });
  const completedPomodoroWeightFromLogs = productiveLogs.reduce(
    (acc, entry) => acc + getPomodoroEquivalentWeight(entry),
    0,
  );

  const workSecondsFromLogs = productiveLogs.reduce((acc, entry) => acc + Math.max(0, entry.duration), 0);
  const workHoursFromLogs = workSecondsFromLogs / 3600;
  const productiveLogDateKeys = new Set<string>();
  productiveLogs.forEach((entry) => {
    const key = getLocalDateKeyFromIso(entry.start);
    if (key) productiveLogDateKeys.add(key);
  });

  const fallbackSessions = safeSessions.filter((session) => {
    const sessionDateKey = getLocalDateKeyFromIso(session.startTime);
    return !sessionDateKey || !productiveLogDateKeys.has(sessionDateKey);
  });

  const workMinutesFromFallbackSessions = fallbackSessions.reduce(
    (acc, session) => acc + getSessionWorkMinutes(session),
    0,
  );
  const totalFocusHours = workHoursFromLogs + (workMinutesFromFallbackSessions / 60);

  const totalPomosFromFallbackSessions = fallbackSessions.reduce(
    (acc, session) => acc + getSessionPomodoroEquivalent(session),
    0,
  );

  const categoryMap = getCategoryMapById(safeCategories);

  const categoryBreakdown: Record<string, number> = {};
  productiveLogs.forEach((entry) => {
    const minutes = Math.max(0, entry.duration / 60);
    if (minutes <= 0) return;
    const key = resolveLogEntryCategory(entry, categoryMap).name || 'Uncategorized';
    categoryBreakdown[key] = (categoryBreakdown[key] || 0) + minutes;
  });
  fallbackSessions.forEach((session) => {
    const categoryDetails = Array.isArray(session.stats?.categoryDetails)
      ? session.stats.categoryDetails
      : [];
    if (categoryDetails.length > 0) {
      categoryDetails.forEach((detail) => {
        const safeDetail = detail as SessionCategoryStat;
        const safeMinutes = Number(safeDetail.minutes);
        if (!Number.isFinite(safeMinutes) || safeMinutes <= 0) return;
        const key = resolveLogEntryCategory(safeDetail, categoryMap).name || 'Uncategorized';
        categoryBreakdown[key] = (categoryBreakdown[key] || 0) + safeMinutes;
      });
      return;
    }
    if (!session.stats?.categoryStats) return;
    Object.entries(session.stats.categoryStats).forEach(([name, minutes]) => {
      const safeMinutes = Number(minutes);
      if (!name || !Number.isFinite(safeMinutes) || safeMinutes <= 0) return;
      categoryBreakdown[name] = (categoryBreakdown[name] || 0) + safeMinutes;
    });
  });

  const productiveDates = new Set<string>();
  productiveLogs.forEach((entry) => {
    const key = getLocalDateKeyFromIso(entry.start);
    if (key) productiveDates.add(key);
  });
  fallbackSessions.forEach((session) => {
    const minutes = getSessionWorkMinutes(session);
    if (minutes <= 0) return;
    const key = getLocalDateKeyFromIso(session.startTime);
    if (key) productiveDates.add(key);
  });

  const sortedDates = Array.from(productiveDates).sort();
  const activeDays = sortedDates.length;

  let bestStreak = 0;
  let runningStreak = 0;
  for (let i = 0; i < sortedDates.length; i += 1) {
    if (i === 0) {
      runningStreak = 1;
    } else {
      const diff = getDayDiff(sortedDates[i - 1], sortedDates[i]);
      runningStreak = diff === 1 ? runningStreak + 1 : 1;
    }
    if (runningStreak > bestStreak) bestStreak = runningStreak;
  }

  let currentStreak = 0;
  if (sortedDates.length > 0) {
    const todayKey = getDateKey(new Date());
    const lastKey = sortedDates[sortedDates.length - 1];
    const diffToToday = getDayDiff(lastKey, todayKey);
    if (diffToToday !== null && diffToToday <= 1) {
      currentStreak = 1;
      for (let i = sortedDates.length - 1; i > 0; i -= 1) {
        const diff = getDayDiff(sortedDates[i - 1], sortedDates[i]);
        if (diff === 1) currentStreak += 1;
        else break;
      }
    }
  }

  return {
    ...EMPTY_LIFETIME_STATS,
    totalFocusHours,
    totalSessions: safeSessions.length,
    totalPomos: completedPomodoroWeightFromLogs + totalPomosFromFallbackSessions,
    activeDays,
    currentStreak,
    bestStreak,
    lastActiveDate: sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : null,
    categoryBreakdown,
  };
};
