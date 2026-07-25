import { SessionRecord } from '../types';
import { formatPomodoroCount, getSessionPomodoroEquivalent } from './pomodoroAccounting';

const SUMMARY_DAY_MS = 24 * 60 * 60 * 1000;
const SUMMARY_WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface SummaryComparisonStatsLike {
  sessionStartTime?: string | null;
  sessionEndTime?: string | null;
  totalWorkMinutes: number;
  pomosCompleted: number;
}

export interface SummaryPomoComparisonResult {
  summaryDateKey: string;
  summaryDayPomos: number;
  lastFocusDay: [string, number] | null;
  lastFocusDelta: number;
  lastFocusTargetLabel: string;
  weeklyFocusDays: Array<[string, number]>;
  weeklyAveragePomos: number;
  weeklyAverageDelta: number;
}

export const getSummaryDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getSummaryDateKeyFromIso = (iso: string | null | undefined) => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return getSummaryDateKey(date);
};

const getSummaryDateFromKey = (dateKey: string) => new Date(`${dateKey}T12:00:00`);

const getSummaryDayStartMs = (dateKey: string) => new Date(`${dateKey}T00:00:00`).getTime();

const getSummaryLastFocusLabel = (lastFocusDateKey: string, summaryDateKey: string) => {
  const summaryStartMs = getSummaryDayStartMs(summaryDateKey);
  const lastFocusStartMs = getSummaryDayStartMs(lastFocusDateKey);
  const diffDays = Math.round((summaryStartMs - lastFocusStartMs) / SUMMARY_DAY_MS);

  if (diffDays === 1) return 'yesterday';
  if (diffDays > 1 && diffDays <= 7) {
    return SUMMARY_WEEKDAY_LABELS[getSummaryDateFromKey(lastFocusDateKey).getDay()];
  }
  return 'last focus';
};

export const formatSummaryDeltaValue = (value: number) => {
  const safeValue = Math.abs(value);
  if (safeValue < 0.05) return '0';
  return formatPomodoroCount(safeValue);
};

export const formatSummaryComparisonTargetLabel = (value: string) => (
  value
    .split(' ')
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(' ')
);

const getCurrentSummaryPomos = (sessionStats: SummaryComparisonStatsLike) => Math.max(
  0,
  Number(sessionStats.pomosCompleted || 0),
);

const isCurrentSummarySession = (
  session: SessionRecord,
  sessionStats: SummaryComparisonStatsLike,
) => (
  Boolean(sessionStats.sessionStartTime)
  && Boolean(sessionStats.sessionEndTime)
  && session.startTime === sessionStats.sessionStartTime
  && session.endTime === sessionStats.sessionEndTime
);

export const getSummaryPomoComparison = ({
  pastSessions,
  sessionStats,
  now = new Date(),
}: {
  pastSessions: SessionRecord[];
  sessionStats: SummaryComparisonStatsLike;
  now?: Date;
}): SummaryPomoComparisonResult => {
  const fallbackDateKey = getSummaryDateKey(now);
  const summaryDateKey = getSummaryDateKeyFromIso(sessionStats.sessionStartTime)
    || getSummaryDateKeyFromIso(sessionStats.sessionEndTime)
    || fallbackDateKey;
  const summaryStartMs = getSummaryDayStartMs(summaryDateKey);
  const dailyPomoTotals = new Map<string, number>();

  pastSessions.forEach((session) => {
    if (isCurrentSummarySession(session, sessionStats)) return;

    const dateKey = getSummaryDateKeyFromIso(session.startTime) || getSummaryDateKeyFromIso(session.endTime);
    if (!dateKey) return;

    const pomos = getSessionPomodoroEquivalent(session);
    if (!Number.isFinite(pomos) || pomos <= 0) return;
    dailyPomoTotals.set(dateKey, (dailyPomoTotals.get(dateKey) || 0) + pomos);
  });

  const currentSummaryPomos = getCurrentSummaryPomos(sessionStats);
  const summaryDayPomos = (dailyPomoTotals.get(summaryDateKey) || 0) + currentSummaryPomos;
  if (summaryDayPomos > 0) dailyPomoTotals.set(summaryDateKey, summaryDayPomos);

  const previousFocusDays = Array.from(dailyPomoTotals.entries())
    .filter(([dateKey, pomos]) => dateKey < summaryDateKey && pomos > 0)
    .sort(([leftDateKey], [rightDateKey]) => rightDateKey.localeCompare(leftDateKey));
  const lastFocusDay = previousFocusDays[0] || null;
  const lastFocusDelta = lastFocusDay ? summaryDayPomos - lastFocusDay[1] : 0;
  const lastFocusLabel = lastFocusDay ? getSummaryLastFocusLabel(lastFocusDay[0], summaryDateKey) : 'last focus';
  const lastFocusTargetLabel = formatSummaryComparisonTargetLabel(lastFocusLabel);

  const weeklyFocusDays = Array.from(dailyPomoTotals.entries())
    .filter(([dateKey, pomos]) => {
      if (dateKey >= summaryDateKey || pomos <= 0) return false;
      const dayStartMs = getSummaryDayStartMs(dateKey);
      return dayStartMs >= summaryStartMs - (7 * SUMMARY_DAY_MS) && dayStartMs < summaryStartMs;
    });
  const weeklyAveragePomos = weeklyFocusDays.length > 0
    ? weeklyFocusDays.reduce((total, [, pomos]) => total + pomos, 0) / weeklyFocusDays.length
    : 0;
  const weeklyAverageDelta = summaryDayPomos - weeklyAveragePomos;

  return {
    summaryDateKey,
    summaryDayPomos,
    lastFocusDay,
    lastFocusDelta,
    lastFocusTargetLabel,
    weeklyFocusDays,
    weeklyAveragePomos,
    weeklyAverageDelta,
  };
};
