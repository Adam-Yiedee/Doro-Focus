import { Category, LogEntry, SessionCategoryStat, SessionRecord, User } from '../types';
import { getCategoryMapById, resolveLogEntryCategory } from './categoryTracking';
import {
  getAccountStatsPomodoroEquivalent,
  getAccountStatsSessionPomodoroEquivalent,
} from './pomodoroAccounting';
import { isProductiveFocusLog } from './logClassification';

export const EMPTY_LIFETIME_STATS: User['lifetimeStats'] = {
  totalFocusHours: 0,
  totalSessionHours: 0,
  manualFocusHours: 0,
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

const isManualFocusLog = (entry: LogEntry): boolean => (
  entry.type === 'work' && entry.source === 'manual'
);

const isTimerSessionDurationLog = (entry: LogEntry): boolean => {
  if (entry.source === 'manual') return false;
  if (entry.type === 'break') return true;
  return isProductiveFocusLog(entry);
};

const getSessionWorkMinutes = (session: SessionRecord): number => {
  const minutes = Number(session.stats?.totalWorkMinutes || 0);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
};

const getSessionTotalMinutes = (session: SessionRecord): number => {
  const workMinutes = Number(session.stats?.totalWorkMinutes || 0);
  const breakMinutes = Number(session.stats?.totalBreakMinutes || 0);
  const totalMinutes = Math.max(0, Number.isFinite(workMinutes) ? workMinutes : 0)
    + Math.max(0, Number.isFinite(breakMinutes) ? breakMinutes : 0);
  return totalMinutes > 0 ? totalMinutes : 0;
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
  const categoryMap = getCategoryMapById(safeCategories);

  const productiveLogs = safeLogs.filter((entry) => {
    if (!isProductiveFocusLog(entry)) return false;
    if (!Number.isFinite(entry.duration) || entry.duration <= 0) return false;
    return true;
  });
  const timerSessionDurationLogs = safeLogs.filter((entry) => {
    if (!Number.isFinite(entry.duration) || entry.duration <= 0) return false;
    return isTimerSessionDurationLog(entry);
  });

  type DayTotals = {
    focusMinutes: number;
    sessionMinutes: number;
    pomos: number;
    categoryBreakdown: Record<string, number>;
    canOverrideLogDay: boolean;
  };

  const createDayTotals = (): DayTotals => ({
    focusMinutes: 0,
    sessionMinutes: 0,
    pomos: 0,
    categoryBreakdown: {},
    canOverrideLogDay: false,
  });

  const getDayTotals = (map: Map<string, DayTotals>, key: string) => {
    const existing = map.get(key);
    if (existing) return existing;
    const created = createDayTotals();
    map.set(key, created);
    return created;
  };

  const addCategoryMinutes = (
    breakdown: Record<string, number>,
    name: string,
    minutes: number,
  ) => {
    const safeMinutes = Number(minutes);
    if (!Number.isFinite(safeMinutes) || safeMinutes <= 0) return;
    const key = name || 'Uncategorized';
    breakdown[key] = (breakdown[key] || 0) + safeMinutes;
  };

  const addBreakdown = (
    target: Record<string, number>,
    source: Record<string, number>,
  ) => {
    Object.entries(source).forEach(([name, minutes]) => {
      addCategoryMinutes(target, name, minutes);
    });
  };

  const getCategoryMinutesTotal = (breakdown: Record<string, number>) => (
    Object.values(breakdown).reduce((total, minutes) => {
      const safeMinutes = Number(minutes);
      return total + (Number.isFinite(safeMinutes) && safeMinutes > 0 ? safeMinutes : 0);
    }, 0)
  );

  const ensureCategoryCoverage = (totals: DayTotals) => {
    const untrackedMinutes = totals.focusMinutes - getCategoryMinutesTotal(totals.categoryBreakdown);
    if (untrackedMinutes > 0.01) {
      addCategoryMinutes(totals.categoryBreakdown, 'Uncategorized', untrackedMinutes);
    }
  };

  const timerLogDays = new Map<string, DayTotals>();
  const sessionDays = new Map<string, DayTotals>();
  const manualCategoryBreakdown: Record<string, number> = {};
  const undatedTimerTotals = createDayTotals();
  const productiveDates = new Set<string>();
  let manualWorkSecondsFromLogs = 0;
  let manualPomosFromLogs = 0;

  productiveLogs.forEach((entry) => {
    const minutes = Math.max(0, entry.duration / 60);
    if (minutes <= 0) return;
    const pomos = getAccountStatsPomodoroEquivalent(entry);
    const categoryName = resolveLogEntryCategory(entry, categoryMap).name || 'Uncategorized';
    const dateKey = getLocalDateKeyFromIso(entry.start);

    if (isManualFocusLog(entry)) {
      manualWorkSecondsFromLogs += Math.max(0, entry.duration);
      manualPomosFromLogs += pomos;
      addCategoryMinutes(manualCategoryBreakdown, categoryName, minutes);
      if (dateKey) productiveDates.add(dateKey);
      return;
    }

    const totals = dateKey ? getDayTotals(timerLogDays, dateKey) : undatedTimerTotals;
    totals.focusMinutes += minutes;
    totals.pomos += pomos;
    addCategoryMinutes(totals.categoryBreakdown, categoryName, minutes);
    if (dateKey) productiveDates.add(dateKey);
  });

  timerSessionDurationLogs.forEach((entry) => {
    const minutes = Math.max(0, entry.duration / 60);
    if (minutes <= 0) return;
    const dateKey = getLocalDateKeyFromIso(entry.start);
    const totals = dateKey ? getDayTotals(timerLogDays, dateKey) : undatedTimerTotals;
    totals.sessionMinutes += minutes;
  });

  safeSessions.forEach((session, index) => {
    const dateKey = getLocalDateKeyFromIso(session.startTime) || `__session_${index}`;
    const totals = getDayTotals(sessionDays, dateKey);
    totals.focusMinutes += getSessionWorkMinutes(session);
    totals.sessionMinutes += getSessionTotalMinutes(session);
    totals.pomos += getAccountStatsSessionPomodoroEquivalent(session);
    const miniPomosCompleted = Number(session.stats?.miniPomosCompleted || 0);
    if (Number.isFinite(miniPomosCompleted) && miniPomosCompleted > 0) {
      totals.canOverrideLogDay = true;
    }

    const categoryDetails = Array.isArray(session.stats?.categoryDetails)
      ? session.stats.categoryDetails
      : [];
    if (categoryDetails.length > 0) {
      categoryDetails.forEach((detail) => {
        const safeDetail = detail as SessionCategoryStat;
        const safeMinutes = Number(safeDetail.minutes);
        if (!Number.isFinite(safeMinutes) || safeMinutes <= 0) return;
        const key = resolveLogEntryCategory(safeDetail, categoryMap).name || 'Uncategorized';
        addCategoryMinutes(totals.categoryBreakdown, key, safeMinutes);
      });
    } else if (session.stats?.categoryStats) {
      Object.entries(session.stats.categoryStats).forEach(([name, minutes]) => {
        addCategoryMinutes(totals.categoryBreakdown, name, Number(minutes));
      });
    }

    if (!dateKey.startsWith('__') && totals.focusMinutes > 0) {
      productiveDates.add(dateKey);
    }
  });

  ensureCategoryCoverage(undatedTimerTotals);
  const categoryBreakdown: Record<string, number> = {};
  addBreakdown(categoryBreakdown, manualCategoryBreakdown);
  addBreakdown(categoryBreakdown, undatedTimerTotals.categoryBreakdown);

  let reconciledFocusMinutes = manualWorkSecondsFromLogs / 60 + undatedTimerTotals.focusMinutes;
  let reconciledSessionMinutes = undatedTimerTotals.sessionMinutes;
  let reconciledPomos = manualPomosFromLogs + undatedTimerTotals.pomos;

  const datedKeys = new Set<string>([
    ...Array.from(timerLogDays.keys()),
    ...Array.from(sessionDays.keys()),
  ]);

  datedKeys.forEach((dateKey) => {
    const timerTotals = timerLogDays.get(dateKey) || createDayTotals();
    const sessionTotals = sessionDays.get(dateKey) || createDayTotals();
    ensureCategoryCoverage(timerTotals);
    ensureCategoryCoverage(sessionTotals);

    const hasTimerFocus = timerTotals.focusMinutes > 0.01;
    const hasTimerSession = timerTotals.sessionMinutes > 0.01;
    const canUseSessionOverLogs = !hasTimerFocus || sessionTotals.canOverrideLogDay;
    const shouldUseSessionFocus = (
      sessionTotals.focusMinutes > timerTotals.focusMinutes + 0.01
      && canUseSessionOverLogs
    );
    const chosenFocusTotals = shouldUseSessionFocus ? sessionTotals : timerTotals;
    const reconciledDayFocusMinutes = shouldUseSessionFocus
      ? sessionTotals.focusMinutes
      : timerTotals.focusMinutes;
    const reconciledDaySessionMinutes = (
      sessionTotals.sessionMinutes > timerTotals.sessionMinutes + 0.01
      && (!hasTimerSession || sessionTotals.canOverrideLogDay)
    )
      ? sessionTotals.sessionMinutes
      : timerTotals.sessionMinutes;
    const reconciledDayPomos = (
      sessionTotals.pomos > timerTotals.pomos + 0.0001
      && canUseSessionOverLogs
    )
      ? sessionTotals.pomos
      : timerTotals.pomos;

    reconciledFocusMinutes += reconciledDayFocusMinutes;
    reconciledSessionMinutes += reconciledDaySessionMinutes;
    reconciledPomos += reconciledDayPomos;
    addBreakdown(categoryBreakdown, chosenFocusTotals.categoryBreakdown);

    if (!dateKey.startsWith('__') && reconciledDayFocusMinutes > 0) {
      productiveDates.add(dateKey);
    }
  });

  const totalFocusHours = reconciledFocusMinutes / 60;
  const totalSessionHours = reconciledSessionMinutes / 60;

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
    totalSessionHours,
    manualFocusHours: manualWorkSecondsFromLogs / 3600,
    totalSessions: safeSessions.length,
    totalPomos: reconciledPomos,
    activeDays,
    currentStreak,
    bestStreak,
    lastActiveDate: sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : null,
    categoryBreakdown,
  };
};
