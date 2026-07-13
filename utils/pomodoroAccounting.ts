import { LogEntry, SessionRecord, TimerSettings } from '../types';

export const POMODORO_COMPLETE_REASON = 'Pomodoro Complete';
export const MINI_POMODORO_COMPLETE_REASON = 'Mini-Pomodoro Complete';
export const MINI_POMODORO_WEIGHT = 0.5;

const normalizeReason = (reason: unknown) => (
  typeof reason === 'string' ? reason.trim().toLowerCase() : ''
);

export const getCompletionReasonForSettings = (
  settings: Pick<TimerSettings, 'timerPreset'>,
) => (
  settings.timerPreset === 'compact'
    ? MINI_POMODORO_COMPLETE_REASON
    : POMODORO_COMPLETE_REASON
);

export const getPomodoroEquivalentWeightForReason = (reason: unknown) => {
  const normalized = normalizeReason(reason);
  if (normalized === POMODORO_COMPLETE_REASON.toLowerCase()) return 1;
  if (normalized === MINI_POMODORO_COMPLETE_REASON.toLowerCase()) return MINI_POMODORO_WEIGHT;
  return 0;
};

export const isMiniPomodoroCompleteReason = (reason: unknown) => (
  normalizeReason(reason) === MINI_POMODORO_COMPLETE_REASON.toLowerCase()
);

export const getPomodoroEquivalentWeight = (
  entry: Pick<LogEntry, 'type' | 'reason'>,
) => (
  entry.type === 'work' ? getPomodoroEquivalentWeightForReason(entry.reason) : 0
);

export const isCompletedPomodoroLog = (entry: Pick<LogEntry, 'type' | 'reason'>) => (
  getPomodoroEquivalentWeight(entry) > 0
);

export const getStandardPomodoroCountForTimer = (
  completedCount: number,
  settings: Pick<TimerSettings, 'timerPreset'>,
) => {
  const safeCompletedCount = Number.isFinite(completedCount)
    ? Math.max(0, completedCount)
    : 0;
  return settings.timerPreset === 'compact'
    ? safeCompletedCount * MINI_POMODORO_WEIGHT
    : safeCompletedCount;
};

export const getPomodoroCompletionStatsFromLogs = (
  entries: Array<Pick<LogEntry, 'type' | 'reason'>>,
) => {
  let standardPomosCompleted = 0;
  let miniPomosCompleted = 0;
  let classicPomosCompleted = 0;

  entries.forEach((entry) => {
    const weight = getPomodoroEquivalentWeight(entry);
    if (weight <= 0) return;

    standardPomosCompleted += weight;
    if (isMiniPomodoroCompleteReason(entry.reason)) {
      miniPomosCompleted += 1;
    } else {
      classicPomosCompleted += 1;
    }
  });

  const completedLogs = miniPomosCompleted + classicPomosCompleted;

  return {
    completedLogs,
    standardPomosCompleted,
    miniPomosCompleted: miniPomosCompleted > 0 && classicPomosCompleted === 0
      ? miniPomosCompleted
      : undefined,
  };
};

export const getSessionPomodoroEquivalent = (session: SessionRecord) => {
  const pomos = Number(session.stats?.pomosCompleted || 0);
  if (Number.isFinite(pomos) && pomos >= 0) return pomos;

  const miniPomos = Number(session.stats?.miniPomosCompleted || 0);
  return Number.isFinite(miniPomos) && miniPomos > 0
    ? miniPomos * MINI_POMODORO_WEIGHT
    : 0;
};

export const formatPomodoroCount = (value: number) => {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (Number.isInteger(safeValue)) return `${safeValue}`;
  return safeValue.toFixed(1).replace(/\.0$/, '');
};

export const getSessionPomoDisplay = (
  stats: Pick<SessionRecord['stats'], 'pomosCompleted' | 'miniPomosCompleted'>,
) => {
  const miniPomos = Number(stats.miniPomosCompleted || 0);
  if (Number.isFinite(miniPomos) && miniPomos > 0) {
    return {
      value: formatPomodoroCount(miniPomos),
      label: miniPomos === 1 ? 'Mini-Pomo' : 'Mini-Pomos',
    };
  }

  const pomos = Number(stats.pomosCompleted || 0);
  return {
    value: formatPomodoroCount(pomos),
    label: pomos === 1 ? 'Pomo' : 'Pomos',
  };
};

export const getTimerPomoUnitLabel = (
  settings: Pick<TimerSettings, 'timerPreset'>,
  plural = true,
) => {
  if (settings.timerPreset === 'compact') return plural ? 'Mini-Pomos' : 'Mini-Pomo';
  return plural ? 'Pomos' : 'Pomo';
};
