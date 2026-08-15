import { LogEntry, SessionRecord, Task, TimerSettings } from '../types';
import { isProductiveFocusLog } from './logClassification';
import { TIMER_PRESETS } from './timerRuntime';

export const POMODORO_COMPLETE_REASON = 'Pomodoro Complete';
export const MINI_POMODORO_COMPLETE_REASON = 'Mini-Pomodoro Complete';
export const MINI_POMODORO_WEIGHT = 0.5;
export const ACCOUNT_STATS_POMODORO_SECONDS = TIMER_PRESETS.classic.workDuration;
export const MINI_POMODORO_SECONDS = TIMER_PRESETS.compact.workDuration;

const getTaskPomodoroUnitMultiplier = (
  settings: Pick<TimerSettings, 'timerPreset'>,
) => settings.timerPreset === 'compact' ? 2 : 1;

const convertTaskPomodoroValue = (value: number, factor: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, value * factor) * 1000) / 1000;
};

export const convertTaskPomodoroUnits = (
  tasks: Task[],
  previousSettings: Pick<TimerSettings, 'timerPreset'>,
  nextSettings: Pick<TimerSettings, 'timerPreset'>,
): Task[] => {
  const factor = getTaskPomodoroUnitMultiplier(nextSettings) / getTaskPomodoroUnitMultiplier(previousSettings);
  if (factor === 1) return tasks;

  return tasks.map(task => ({
    ...task,
    estimated: convertTaskPomodoroValue(task.estimated, factor),
    completed: convertTaskPomodoroValue(task.completed, factor),
    subtasks: convertTaskPomodoroUnits(task.subtasks, previousSettings, nextSettings),
  }));
};

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
  entry: Pick<LogEntry, 'type' | 'reason' | 'source'>,
) => (
  entry.type === 'work' && entry.source !== 'manual' ? getPomodoroEquivalentWeightForReason(entry.reason) : 0
);

const getPositiveDurationSeconds = (duration: unknown) => {
  const seconds = typeof duration === 'number' ? duration : Number(duration || 0);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
};

export const getAccountStatsPomodoroEquivalent = (
  entry: Pick<LogEntry, 'type' | 'reason' | 'duration' | 'source'>,
) => {
  if (!isProductiveFocusLog(entry)) return 0;

  return getAccountStatsFocusSeconds(entry) / ACCOUNT_STATS_POMODORO_SECONDS;
};

export const getAccountStatsFocusSeconds = (
  entry: Pick<LogEntry, 'type' | 'reason' | 'duration' | 'source'>,
) => {
  if (!isProductiveFocusLog(entry)) return 0;

  if (entry.source !== 'manual' && isMiniPomodoroCompleteReason(entry.reason)) {
    return MINI_POMODORO_SECONDS;
  }

  return getPositiveDurationSeconds(entry.duration);
};

export const isCompletedPomodoroLog = (entry: Pick<LogEntry, 'type' | 'reason' | 'source'>) => (
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
  entries: Array<Pick<LogEntry, 'type' | 'reason' | 'source'>>,
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

export const getAccountStatsSessionPomodoroEquivalent = (session: SessionRecord) => {
  const workMinutes = Number(session.stats?.totalWorkMinutes || 0);
  if (Number.isFinite(workMinutes) && workMinutes > 0) {
    return workMinutes / (ACCOUNT_STATS_POMODORO_SECONDS / 60);
  }

  return getSessionPomodoroEquivalent(session);
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
