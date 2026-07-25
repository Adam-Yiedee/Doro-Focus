import { Category, LogEntry, SessionCategoryStat, TimerMode, TimerSettings } from '../types';
import { resolveLogEntryCategory } from './categoryTracking';
import {
  getPomodoroCompletionStatsFromLogs,
  getStandardPomodoroCountForTimer,
} from './pomodoroAccounting';

export interface EndSessionPendingActivityWindow {
  startMs: number;
  endMs: number;
  durationSeconds: number;
}

export interface EndSessionPendingActivity {
  mode: TimerMode;
  durationSeconds: number;
  categoryId?: number | null;
  categoryName?: string;
  categoryColor?: string;
  categoryIcon?: string;
}

export interface EndSessionStatsResult {
  totalWorkMinutes: number;
  totalBreakMinutes: number;
  tasksCompleted: number;
  pomosCompleted: number;
  miniPomosCompleted?: number;
  categoryStats: Record<string, number>;
  categoryDetails: SessionCategoryStat[];
}

const getFiniteNumber = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
);

export const isPauseCreditedWorkLog = (entry: Pick<LogEntry, 'type' | 'reason'>): boolean => {
  if (entry.type !== 'work') return false;
  const reason = (entry.reason || '').trim().toLowerCase();
  return reason.startsWith('paused') || reason.includes('pause credit');
};

export const getEndSessionPendingActivityWindow = ({
  isIdle,
  timerStarted,
  activityStartMs,
  effectiveEndMs,
  allPauseActive,
  allPauseStartTime,
}: {
  isIdle: boolean;
  timerStarted?: boolean;
  activityStartMs?: number | null;
  effectiveEndMs: number;
  allPauseActive: boolean;
  allPauseStartTime?: number | null;
}): EndSessionPendingActivityWindow | null => {
  const safeStartMs = getFiniteNumber(activityStartMs);
  const safeEndMs = getFiniteNumber(effectiveEndMs);
  if (isIdle || safeStartMs === null || safeEndMs === null) return null;
  if (!timerStarted && !allPauseActive) return null;

  const safePauseStartMs = getFiniteNumber(allPauseStartTime);
  const cappedEndMs = allPauseActive && safePauseStartMs !== null
    ? Math.min(safeEndMs, safePauseStartMs)
    : safeEndMs;
  const durationSeconds = (cappedEndMs - safeStartMs) / 1000;

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0.5) return null;

  return {
    startMs: safeStartMs,
    endMs: cappedEndMs,
    durationSeconds,
  };
};

const getSessionStartMs = (sessionStartTime: string | null | undefined) => {
  if (!sessionStartTime) return null;
  const parsed = Date.parse(sessionStartTime);
  return Number.isFinite(parsed) ? parsed : null;
};

const getSessionEndMs = (sessionEndTime: string | null | undefined) => {
  if (!sessionEndTime) return null;
  const parsed = Date.parse(sessionEndTime);
  return Number.isFinite(parsed) ? parsed : null;
};

const isTimerLog = (entry: Pick<LogEntry, 'source'>) => entry.source !== 'manual';

const getPositiveSeconds = (value: unknown) => {
  const seconds = typeof value === 'number' ? value : Number(value || 0);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
};

const getLogStartMs = (entry: Pick<LogEntry, 'start'>) => {
  const parsed = Date.parse(entry.start);
  return Number.isFinite(parsed) ? parsed : null;
};

const getLogEndMs = (entry: Pick<LogEntry, 'start' | 'end' | 'duration'>) => {
  const startMs = getLogStartMs(entry);
  if (startMs === null) return null;

  const durationSeconds = getPositiveSeconds(entry.duration);
  if (durationSeconds > 0) return startMs + (durationSeconds * 1000);

  const parsedEnd = Date.parse(entry.end);
  return Number.isFinite(parsedEnd) ? parsedEnd : startMs;
};

const getSessionLogDurationSeconds = (
  entry: Pick<LogEntry, 'start' | 'end' | 'duration'>,
  sessionStartMs: number,
  sessionEndMs: number | null,
) => {
  const entryStartMs = getLogStartMs(entry);
  const entryEndMs = getLogEndMs(entry);
  if (entryStartMs === null || entryEndMs === null) return 0;

  const overlapStartMs = Math.max(entryStartMs, sessionStartMs);
  const overlapEndMs = sessionEndMs === null ? entryEndMs : Math.min(entryEndMs, sessionEndMs);
  const seconds = (overlapEndMs - overlapStartMs) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
};

const getCompletionLogsInsideSession = (
  entries: LogEntry[],
  sessionStartMs: number | null,
  sessionEndMs: number | null,
) => {
  if (sessionStartMs === null) return [];

  return entries.filter((entry) => {
    const completedAtMs = getLogEndMs(entry);
    if (completedAtMs === null) return false;
    if (completedAtMs <= sessionStartMs) return false;
    if (sessionEndMs !== null && completedAtMs > sessionEndMs) return false;
    return true;
  });
};

const getLogsForSession = (
  logs: LogEntry[],
  sessionStartTime: string | null | undefined,
  sessionEndTime?: string | null,
) => {
  const sessionStartMs = getSessionStartMs(sessionStartTime);
  if (sessionStartMs === null) return [];
  const sessionEndMs = getSessionEndMs(sessionEndTime);

  return logs.filter((entry) => {
    const entryStartMs = getLogStartMs(entry);
    const entryEndMs = getLogEndMs(entry);
    if (entryStartMs === null || entryEndMs === null) return false;
    const durationSeconds = getPositiveSeconds(entry.duration);
    if (durationSeconds > 0) {
      if (entryEndMs <= sessionStartMs) return false;
      if (sessionEndMs !== null && entryStartMs >= sessionEndMs) return false;
    } else {
      if (entryStartMs < sessionStartMs) return false;
      if (sessionEndMs !== null && entryStartMs > sessionEndMs) return false;
    }
    return isTimerLog(entry);
  });
};

export const getSessionTaskCompletionIdsFromLogs = (
  logs: LogEntry[],
  sessionStartTime: string | null | undefined,
  sessionEndTime?: string | null,
) => {
  const completionIds = new Set<number>();
  getLogsForSession(logs, sessionStartTime, sessionEndTime).forEach((entry) => {
    if (entry.type !== 'task-complete') return;
    const taskId = entry.task?.id;
    if (typeof taskId === 'number' && Number.isFinite(taskId)) {
      completionIds.add(taskId);
    }
  });
  return completionIds;
};

const getCategoryKey = (
  entry: Pick<LogEntry, 'categoryId'>,
  resolvedName: string,
) => (
  typeof entry.categoryId === 'number' && Number.isFinite(entry.categoryId)
    ? `id:${entry.categoryId}`
    : `name:${resolvedName}`
);

export const buildEndSessionStats = ({
  logs,
  sessionStartTime,
  sessionEndTime,
  categories,
  pendingActivity,
  pomodoroCount,
  settings,
  tasksCompleted,
}: {
  logs: LogEntry[];
  sessionStartTime: string | null | undefined;
  sessionEndTime?: string | null;
  categories: Category[];
  pendingActivity?: EndSessionPendingActivity | null;
  pomodoroCount: number;
  settings: Pick<TimerSettings, 'timerPreset'>;
  tasksCompleted: number;
}): EndSessionStatsResult => {
  const sessionStartMs = getSessionStartMs(sessionStartTime);
  const sessionEndMs = getSessionEndMs(sessionEndTime);
  const sessionLogs = getLogsForSession(logs, sessionStartTime, sessionEndTime);
  const workLogs = sessionLogs.filter((entry) => (
    entry.type === 'work' && !isPauseCreditedWorkLog(entry)
  ));
  const breakLogs = sessionLogs.filter((entry) => entry.type === 'break');
  const getBoundedLogDurationSeconds = (entry: LogEntry) => (
    sessionStartMs === null
      ? 0
      : getSessionLogDurationSeconds(entry, sessionStartMs, sessionEndMs)
  );
  const pendingWorkSeconds = pendingActivity?.mode === 'work'
    ? getPositiveSeconds(pendingActivity.durationSeconds)
    : 0;
  const pendingBreakSeconds = pendingActivity?.mode === 'break'
    ? getPositiveSeconds(pendingActivity.durationSeconds)
    : 0;

  const totalWorkMinutes = (
    workLogs.reduce((acc, entry) => acc + getBoundedLogDurationSeconds(entry), 0)
    + pendingWorkSeconds
  ) / 60;
  const totalBreakMinutes = (
    breakLogs.reduce((acc, entry) => acc + getBoundedLogDurationSeconds(entry), 0)
    + pendingBreakSeconds
  ) / 60;

  const categoryDetailsByKey = new Map<string, SessionCategoryStat>();
  const addSessionCategoryMinutes = (
    entry: Pick<LogEntry, 'categoryId' | 'categoryName' | 'categoryColor' | 'categoryIcon'>,
    rawMinutes: number,
  ) => {
    const safeMinutes = Number(rawMinutes);
    if (!Number.isFinite(safeMinutes) || safeMinutes <= 0) return;

    const resolvedCategory = resolveLogEntryCategory(entry, categories);
    const resolvedName = resolvedCategory.name || 'Uncategorized';
    const detailKey = getCategoryKey(entry, resolvedName);
    const existing = categoryDetailsByKey.get(detailKey);

    if (existing) {
      existing.minutes += safeMinutes;
      if (!existing.categoryName && resolvedName) existing.categoryName = resolvedName;
      if (!existing.categoryColor && resolvedCategory.color) existing.categoryColor = resolvedCategory.color;
      if (!existing.categoryIcon && resolvedCategory.icon) existing.categoryIcon = resolvedCategory.icon;
      return;
    }

    categoryDetailsByKey.set(detailKey, {
      categoryId: typeof entry.categoryId === 'number' && Number.isFinite(entry.categoryId) ? entry.categoryId : null,
      categoryName: resolvedName,
      categoryColor: resolvedCategory.color || undefined,
      categoryIcon: resolvedCategory.icon || undefined,
      minutes: safeMinutes,
    });
  };

  workLogs.forEach((entry) => {
    addSessionCategoryMinutes(entry, getBoundedLogDurationSeconds(entry) / 60);
  });

  if (pendingWorkSeconds > 0 && pendingActivity) {
    addSessionCategoryMinutes(pendingActivity, pendingWorkSeconds / 60);
  }

  const categoryDetails = Array.from(categoryDetailsByKey.values());
  const categoryStats = categoryDetails.reduce<Record<string, number>>((acc, detail) => {
    const key = detail.categoryName || 'Uncategorized';
    acc[key] = (acc[key] || 0) + detail.minutes;
    return acc;
  }, {});

  const loggedCompletionStats = getPomodoroCompletionStatsFromLogs(
    getCompletionLogsInsideSession(workLogs, sessionStartMs, sessionEndMs),
  );
  const pomosCompleted = loggedCompletionStats.completedLogs > 0
    ? loggedCompletionStats.standardPomosCompleted
    : getStandardPomodoroCountForTimer(pomodoroCount, settings);
  const miniPomosCompleted = loggedCompletionStats.completedLogs > 0
    ? loggedCompletionStats.miniPomosCompleted
    : (settings.timerPreset === 'compact' ? pomodoroCount : undefined);

  return {
    totalWorkMinutes,
    totalBreakMinutes,
    tasksCompleted: Number.isFinite(tasksCompleted) ? Math.max(0, tasksCompleted) : 0,
    pomosCompleted,
    ...(miniPomosCompleted !== undefined ? { miniPomosCompleted } : {}),
    categoryStats,
    categoryDetails,
  };
};
