import { LogEntry, SessionRecord } from '../types';
import {
  ACCOUNT_STATS_POMODORO_SECONDS,
  getSessionPomodoroEquivalent,
} from './pomodoroAccounting';

export interface AccountPauseWindow {
  startMs: number;
  endMs: number;
}

export interface AccountSessionTotals {
  workMinutes: number;
  sessionMinutes: number;
  pomodoros: number;
  pauseMinutes: number;
  maximumCreditedMinutes: number | null;
}

const MS_PER_MINUTE = 60_000;
const SECONDS_PER_MINUTE = 60;

const getFiniteMs = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getPositiveMinutes = (value: unknown) => {
  const minutes = Number(value || 0);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
};

const getPositiveDurationSeconds = (value: unknown) => {
  const seconds = typeof value === 'number' ? value : Number(value || 0);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
};

const getRawSessionWorkMinutes = (session: SessionRecord) => (
  getPositiveMinutes(session.stats?.totalWorkMinutes)
);

const getRawSessionBreakMinutes = (session: SessionRecord) => (
  getPositiveMinutes(session.stats?.totalBreakMinutes)
);

const getRawSessionTotalMinutes = (session: SessionRecord) => (
  getRawSessionWorkMinutes(session) + getRawSessionBreakMinutes(session)
);

const getPauseWindow = (entry: LogEntry): AccountPauseWindow | null => {
  if (entry.type !== 'allpause') return null;

  const startMs = getFiniteMs(entry.start);
  if (startMs === null) return null;

  const durationSeconds = getPositiveDurationSeconds(entry.duration);
  const durationEndMs = durationSeconds > 0 ? startMs + (durationSeconds * 1000) : null;
  const parsedEndMs = getFiniteMs(entry.end);
  const endMs = Math.max(
    startMs,
    durationEndMs ?? startMs,
    parsedEndMs ?? startMs,
  );

  return endMs > startMs ? { startMs, endMs } : null;
};

export const buildAccountPauseWindows = (logs: LogEntry[]): AccountPauseWindow[] => (
  (Array.isArray(logs) ? logs : [])
    .map(getPauseWindow)
    .filter((window): window is AccountPauseWindow => Boolean(window))
);

const getSessionPauseMinutes = (
  sessionStartMs: number,
  sessionEndMs: number,
  pauseWindows: AccountPauseWindow[],
) => (
  pauseWindows.reduce((totalMs, window) => {
    const overlapStartMs = Math.max(sessionStartMs, window.startMs);
    const overlapEndMs = Math.min(sessionEndMs, window.endMs);
    return overlapEndMs > overlapStartMs
      ? totalMs + (overlapEndMs - overlapStartMs)
      : totalMs;
  }, 0) / MS_PER_MINUTE
);

export const getAccountSessionTotals = (
  session: SessionRecord,
  pauseWindows: AccountPauseWindow[],
): AccountSessionTotals => {
  const rawWorkMinutes = getRawSessionWorkMinutes(session);
  const rawBreakMinutes = getRawSessionBreakMinutes(session);
  const rawSessionMinutes = getRawSessionTotalMinutes(session);
  const sessionStartMs = getFiniteMs(session.startTime);
  const sessionEndMs = getFiniteMs(session.endTime);

  let pauseMinutes = 0;
  let maximumCreditedMinutes: number | null = null;

  if (sessionStartMs !== null && sessionEndMs !== null && sessionEndMs > sessionStartMs) {
    pauseMinutes = getSessionPauseMinutes(sessionStartMs, sessionEndMs, pauseWindows);
    if (pauseMinutes > 0.01) {
      const wallMinutes = (sessionEndMs - sessionStartMs) / MS_PER_MINUTE;
      maximumCreditedMinutes = Math.max(0, wallMinutes - pauseMinutes);
    }
  }

  const sessionMinutes = maximumCreditedMinutes === null
    ? rawSessionMinutes
    : Math.min(rawSessionMinutes, maximumCreditedMinutes);
  const breakMinutes = maximumCreditedMinutes === null
    ? rawBreakMinutes
    : Math.min(rawBreakMinutes, sessionMinutes);
  const workMinutes = maximumCreditedMinutes === null
    ? rawWorkMinutes
    : Math.min(rawWorkMinutes, Math.max(0, sessionMinutes - breakMinutes), maximumCreditedMinutes);
  const maxPomos = maximumCreditedMinutes === null
    ? Number.POSITIVE_INFINITY
    : maximumCreditedMinutes / (ACCOUNT_STATS_POMODORO_SECONDS / SECONDS_PER_MINUTE);
  const fallbackPomos = getSessionPomodoroEquivalent(session);
  const pomodoros = workMinutes > 0
    ? workMinutes / (ACCOUNT_STATS_POMODORO_SECONDS / SECONDS_PER_MINUTE)
    : Math.min(fallbackPomos, maxPomos);

  return {
    workMinutes,
    sessionMinutes,
    pomodoros,
    pauseMinutes,
    maximumCreditedMinutes,
  };
};

const getRawSessionCategoryMinutes = (session: SessionRecord) => {
  const categoryDetails = Array.isArray(session.stats?.categoryDetails)
    ? session.stats.categoryDetails
    : [];

  if (categoryDetails.length > 0) {
    return categoryDetails.reduce((total, detail) => total + getPositiveMinutes(detail.minutes), 0);
  }

  if (session.stats?.categoryStats && typeof session.stats.categoryStats === 'object') {
    return Object.values(session.stats.categoryStats)
      .reduce((total, minutes) => total + getPositiveMinutes(minutes), 0);
  }

  return 0;
};

export const getAccountSessionCategoryScale = (
  session: SessionRecord,
  creditedWorkMinutes: number,
) => {
  const rawCategoryMinutes = getRawSessionCategoryMinutes(session);
  if (rawCategoryMinutes <= 0) return 1;
  if (creditedWorkMinutes <= 0) return 0;
  return Math.min(1, creditedWorkMinutes / rawCategoryMinutes);
};
