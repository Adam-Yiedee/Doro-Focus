import { LogEntry, TimerMode } from '../types';
import { isProductiveFocusLog } from './logClassification';

const getLogStartMs = (entry: Pick<LogEntry, 'start'>) => {
  const startMs = Date.parse(entry.start);
  return Number.isFinite(startMs) ? startMs : null;
};

const getLogEndMs = (entry: Pick<LogEntry, 'start' | 'end' | 'duration'>) => {
  const startMs = getLogStartMs(entry);
  if (startMs === null) return null;

  const durationSeconds = typeof entry.duration === 'number' ? entry.duration : Number(entry.duration || 0);
  if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
    return startMs + (durationSeconds * 1000);
  }

  const endMs = Date.parse(entry.end);
  return Number.isFinite(endMs) ? endMs : startMs;
};

export const getSessionTimerFocusSeconds = (
  logs: LogEntry[],
  sessionStartTime: string | null,
  nowMs: number,
) => {
  if (!sessionStartTime) return 0;

  const sessionStartMs = Date.parse(sessionStartTime);
  if (!Number.isFinite(sessionStartMs)) return 0;

  return logs.reduce((totalSeconds, entry) => {
    if (!isProductiveFocusLog(entry)) return totalSeconds;
    if (entry.source === 'manual') return totalSeconds;

    const startMs = getLogStartMs(entry);
    const endMs = getLogEndMs(entry);
    if (startMs === null || endMs === null) return totalSeconds;

    const boundedStartMs = Math.max(startMs, sessionStartMs);
    const boundedEndMs = Math.min(endMs, nowMs);
    const seconds = (boundedEndMs - boundedStartMs) / 1000;
    return Number.isFinite(seconds) && seconds > 0 ? totalSeconds + seconds : totalSeconds;
  }, 0);
};

export const getCurrentTimerActivityStartMs = (
  logs: LogEntry[],
  sessionStartTime: string | null,
  nowMs: number,
) => {
  if (!sessionStartTime) return null;

  const sessionStartMs = Date.parse(sessionStartTime);
  if (!Number.isFinite(sessionStartMs)) return null;

  return logs.reduce((latestEndMs: number, entry) => {
    if (entry.source === 'manual' || entry.type === 'task-complete') return latestEndMs;

    const endMs = getLogEndMs(entry);
    if (endMs === null || endMs > nowMs || endMs <= sessionStartMs) return latestEndMs;

    return Math.max(latestEndMs, endMs);
  }, sessionStartMs);
};

export const getFocusTimerDisplaySeconds = ({
  logs,
  sessionStartTime,
  nowMs,
  timerStarted,
  isIdle,
  activeMode,
  currentActivityStartTime = null,
  workTime,
  workDuration,
  allPauseActive = false,
  graceOpen = false,
}: {
  logs: LogEntry[];
  sessionStartTime: string | null;
  nowMs: number;
  timerStarted: boolean;
  isIdle: boolean;
  activeMode: TimerMode;
  currentActivityStartTime?: string | null;
  workTime?: number;
  workDuration?: number;
  allPauseActive?: boolean;
  graceOpen?: boolean;
}) => {
  const sessionStartMs = sessionStartTime ? Date.parse(sessionStartTime) : NaN;
  const hasValidSessionStart = Number.isFinite(sessionStartMs);
  const loggedFocusSeconds = getSessionTimerFocusSeconds(logs, sessionStartTime, nowMs);
  const currentActivityStartMs = getCurrentTimerActivityStartMs(logs, sessionStartTime, nowMs);
  let activeFocusSeconds = 0;

  if (!isIdle && activeMode === 'work') {
    if (timerStarted) {
      const liveActivityStartMs = typeof currentActivityStartTime === 'string'
        ? Date.parse(currentActivityStartTime)
        : NaN;
      const activeStartMs = hasValidSessionStart && Number.isFinite(liveActivityStartMs) && liveActivityStartMs <= nowMs
        ? Math.max(liveActivityStartMs, sessionStartMs)
        : currentActivityStartMs;
      activeFocusSeconds = Math.max(0, (nowMs - (activeStartMs ?? nowMs)) / 1000);
    } else if (!allPauseActive && !graceOpen) {
      const safeWorkDuration = typeof workDuration === 'number' && Number.isFinite(workDuration)
        ? Math.max(0, workDuration)
        : 0;
      const safeWorkTime = typeof workTime === 'number' && Number.isFinite(workTime)
        ? Math.max(0, workTime)
        : safeWorkDuration;
      activeFocusSeconds = Math.max(0, safeWorkDuration - safeWorkTime);
    }
  }

  return loggedFocusSeconds + activeFocusSeconds;
};
