import { TimerMode, TimerPreset } from '../types';

export const FOCUS_TIMER_BREAK_AUTO_END_MS = 90 * 60 * 1000;

export const getFocusTimerBreakAutoEndMs = ({
  timerPreset,
  activeMode,
  timerStarted,
  isIdle,
  allPauseActive,
  graceOpen,
  activityStartMs,
  nowMs,
  alreadyAutoEndedActivityStartMs = null,
}: {
  timerPreset: TimerPreset;
  activeMode: TimerMode;
  timerStarted: boolean;
  isIdle: boolean;
  allPauseActive: boolean;
  graceOpen: boolean;
  activityStartMs: number | null | undefined;
  nowMs: number;
  alreadyAutoEndedActivityStartMs?: number | null;
}) => {
  if (timerPreset !== 'focus') return null;
  if (activeMode !== 'break') return null;
  if (!timerStarted || isIdle || allPauseActive || graceOpen) return null;
  if (typeof activityStartMs !== 'number' || !Number.isFinite(activityStartMs)) return null;
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return null;
  if (alreadyAutoEndedActivityStartMs === activityStartMs) return null;

  const autoEndMs = activityStartMs + FOCUS_TIMER_BREAK_AUTO_END_MS;
  return nowMs > autoEndMs ? autoEndMs : null;
};
