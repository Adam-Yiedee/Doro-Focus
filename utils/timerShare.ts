import { TimerMode, TimerRuntimeSnapshot, TimerSettings, TimerSpectatorState } from '../types';
import { deriveRuntimeValues } from './timerRuntime';

export const TIMER_SHARE_BASE_URL = (import.meta.env.VITE_PUBLIC_SITE_URL || 'https://dorofocus.netlify.app').replace(/\/+$/, '');
export const TIMER_SHARE_PREVIEW_VERSION = '6';

export interface TimerShareEstimateInput {
  activeMode: TimerMode;
  timerStarted: boolean;
  isIdle: boolean;
  workTime: number;
  breakTime: number;
  allPauseActive?: boolean;
  graceOpen?: boolean;
}

export interface TimerShareEstimate {
  remainingSeconds: number | null;
  endMs: number | null;
  status: 'running' | 'idle' | 'paused' | 'grace' | 'overdue';
}

export type TimerShareEndKind = 'phase' | 'finish';

export const getTimerShareModeLabel = (mode: TimerMode) => (mode === 'break' ? 'Break Bank' : 'Focus');

const getSafeSeconds = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) ? value : 0
);

export const getTimerShareEstimate = (
  input: TimerShareEstimateInput,
  nowMs: number = Date.now(),
): TimerShareEstimate => {
  if (input.graceOpen) {
    return { remainingSeconds: null, endMs: null, status: 'grace' };
  }

  if (input.allPauseActive) {
    return { remainingSeconds: null, endMs: null, status: 'paused' };
  }

  if (input.isIdle || !input.timerStarted) {
    return { remainingSeconds: null, endMs: null, status: 'idle' };
  }

  const remainingSeconds = input.activeMode === 'break'
    ? getSafeSeconds(input.breakTime)
    : getSafeSeconds(input.workTime);

  if (input.activeMode === 'break' && remainingSeconds <= 0) {
    return { remainingSeconds: Math.abs(remainingSeconds), endMs: null, status: 'overdue' };
  }

  const safeRemaining = Math.max(0, remainingSeconds);
  return {
    remainingSeconds: safeRemaining,
    endMs: nowMs + (safeRemaining * 1000),
    status: 'running',
  };
};

export const getTimerShareEstimateFromSpectatorState = (
  state: TimerSpectatorState | null,
  nowMs: number = Date.now(),
): TimerShareEstimate => {
  if (!state) {
    return { remainingSeconds: null, endMs: null, status: 'idle' };
  }

  if (state.runtime) {
    const derived = deriveRuntimeValues(state.runtime, nowMs);
    return getTimerShareEstimate({
      activeMode: state.runtime.phase === 'running-break' ? 'break' : state.activeMode,
      timerStarted: state.runtime.phase === 'running-work' || state.runtime.phase === 'running-break',
      isIdle: state.runtime.phase === 'idle',
      workTime: derived.workTime,
      breakTime: derived.breakTime,
      allPauseActive: state.runtime.phase === 'all-pause',
      graceOpen: state.runtime.phase === 'grace',
    }, nowMs);
  }

  return getTimerShareEstimate(state, nowMs);
};

export const formatTimerShareDuration = (seconds: number | null) => {
  if (seconds === null || !Number.isFinite(seconds)) return '--';
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

export const formatTimerShareEndLabel = (endMs: number | null, fallback = 'Not running') => {
  if (endMs === null || !Number.isFinite(endMs)) return fallback;
  return new Date(endMs).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
};

export const getTimerShareStatusLabel = (estimate: TimerShareEstimate, _mode: TimerMode) => {
  if (estimate.status === 'running') return 'Time Finished';
  if (estimate.status === 'paused') return 'Timer paused';
  if (estimate.status === 'grace') return 'Grace window open';
  if (estimate.status === 'overdue') return 'Break bank overdue';
  return 'Timer not running';
};

export const buildTimerSpectatorUrl = (
  sessionId: string,
  options: {
    activeMode?: TimerMode;
    endMs?: number | null;
    endLabel?: string;
    remainingSeconds?: number | null;
    timezoneOffset?: number | null;
    endKind?: TimerShareEndKind;
  } = {},
) => {
  const normalizedSession = sessionId.trim().toUpperCase();
  const params = new URLSearchParams();
  params.set('preview', TIMER_SHARE_PREVIEW_VERSION);
  const endKind = options.endKind || 'finish';

  if (options.activeMode) params.set('mode', options.activeMode);
  if (endKind === 'finish') params.set('endKind', endKind);
  if (typeof options.endMs === 'number' && Number.isFinite(options.endMs)) params.set('end', String(Math.round(options.endMs)));
  if (options.endLabel) params.set('endLabel', options.endLabel);
  if (typeof options.remainingSeconds === 'number' && Number.isFinite(options.remainingSeconds)) {
    params.set('remaining', String(Math.max(0, Math.round(options.remainingSeconds))));
  }
  if (typeof options.timezoneOffset === 'number' && Number.isFinite(options.timezoneOffset)) {
    params.set('tzOffset', String(Math.round(options.timezoneOffset)));
  }

  const query = params.toString();
  return `${TIMER_SHARE_BASE_URL}/share/${encodeURIComponent(normalizedSession)}${query ? `?${query}` : ''}`;
};

export const buildTimerSpectatorAppUrl = (
  sessionId: string,
  options: {
    activeMode?: TimerMode;
    endMs?: number | null;
    endLabel?: string;
    remainingSeconds?: number | null;
    timezoneOffset?: number | null;
    endKind?: TimerShareEndKind;
  } = {},
) => {
  const normalizedSession = sessionId.trim().toUpperCase();
  const params = new URLSearchParams({ spectate: normalizedSession });
  const endKind = options.endKind || 'finish';

  if (options.activeMode) params.set('mode', options.activeMode);
  if (endKind === 'finish') params.set('endKind', endKind);
  if (typeof options.endMs === 'number' && Number.isFinite(options.endMs)) params.set('end', String(Math.round(options.endMs)));
  if (options.endLabel) params.set('endLabel', options.endLabel);
  if (typeof options.remainingSeconds === 'number' && Number.isFinite(options.remainingSeconds)) {
    params.set('remaining', String(Math.max(0, Math.round(options.remainingSeconds))));
  }
  if (typeof options.timezoneOffset === 'number' && Number.isFinite(options.timezoneOffset)) {
    params.set('tzOffset', String(Math.round(options.timezoneOffset)));
  }

  return `${TIMER_SHARE_BASE_URL}/?${params.toString()}`;
};

export const getSpectatorSettingsFallback = (): TimerSpectatorState['settings'] => ({
  workDuration: 25 * 60,
  shortBreakDuration: 5 * 60,
  longBreakDuration: 15 * 60,
  longBreakInterval: 4,
  timerPreset: 'classic',
  twoInARowMode: false,
  miniPomoAutoStartBlock: 1,
});

export const pickTimerSpectatorSettings = (
  settings: TimerSettings | TimerSpectatorState['settings'] | undefined | null,
): TimerSpectatorState['settings'] => ({
  ...getSpectatorSettingsFallback(),
  ...(settings || {}),
});
