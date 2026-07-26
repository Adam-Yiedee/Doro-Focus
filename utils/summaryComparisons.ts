import { SessionRecord } from '../types';
import { formatPomodoroCount, getSessionPomodoroEquivalent } from './pomodoroAccounting';

export interface SummaryComparisonStatsLike {
  sessionStartTime?: string | null;
  sessionEndTime?: string | null;
  totalWorkMinutes: number;
  pomosCompleted: number;
}

export interface SummaryPomoComparisonResult {
  summaryDateKey: string;
  summaryDayPomos: number;
  previousDayKey: string;
  previousDayPomos: number;
  previousDayDelta: number;
  previousDayTargetLabel: string;
  weeklyComparisonDays: Array<[string, number]>;
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

const getRelativeSummaryDateKey = (dateKey: string, offsetDays: number) => {
  const date = getSummaryDateFromKey(dateKey);
  date.setDate(date.getDate() + offsetDays);
  return getSummaryDateKey(date);
};

export const formatSummaryDeltaValue = (value: number) => {
  const safeValue = Math.abs(value);
  if (safeValue < 0.05) return '0';
  return formatPomodoroCount(safeValue);
};

export const getSummaryPomoDeltaLabel = (delta: number, targetLabel: string) => {
  if (Math.abs(delta) < 0.05) return `Same Pomos As ${targetLabel}`;
  return delta > 0
    ? `More Pomos Than ${targetLabel}`
    : `Fewer Pomos Than ${targetLabel}`;
};

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

  const previousDayKey = getRelativeSummaryDateKey(summaryDateKey, -1);
  const previousDayPomos = dailyPomoTotals.get(previousDayKey) || 0;
  const previousDayDelta = summaryDayPomos - previousDayPomos;
  const previousDayTargetLabel = 'Yesterday';

  const weeklyComparisonDays = Array.from({ length: 7 }, (_, index): [string, number] => {
    const dateKey = getRelativeSummaryDateKey(summaryDateKey, index - 7);
    return [dateKey, dailyPomoTotals.get(dateKey) || 0];
  });
  const weeklyAveragePomos = weeklyComparisonDays.reduce((total, [, pomos]) => total + pomos, 0) / weeklyComparisonDays.length;
  const weeklyAverageDelta = summaryDayPomos - weeklyAveragePomos;

  return {
    summaryDateKey,
    summaryDayPomos,
    previousDayKey,
    previousDayPomos,
    previousDayDelta,
    previousDayTargetLabel,
    weeklyComparisonDays,
    weeklyAveragePomos,
    weeklyAverageDelta,
  };
};
