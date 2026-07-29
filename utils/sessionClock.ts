import { ACCOUNT_STATS_POMODORO_SECONDS } from './pomodoroAccounting';

const MINI_POMODORO_SECONDS = 15 * 60;
const MS_PER_SECOND = 1000;

export type SessionClockFocusWindowInput = {
  segmentStartMs: number;
  segmentEndMs: number;
  reasonCompletionWeight?: number;
  isMiniPomo?: boolean;
};

export type SessionClockBreakWindowInput = {
  segmentStartMs: number;
  segmentEndMs: number;
};

export type SessionClockCycleOverlayWindow = {
  index: number;
  startMs: number;
  endMs: number;
};

type SessionClockEvent =
  | (SessionClockFocusWindowInput & { kind: 'focus' })
  | (SessionClockBreakWindowInput & { kind: 'break' });

const isFiniteRange = (startMs: number, endMs: number) => (
  Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
);

const getCycleDurationMs = (window: SessionClockFocusWindowInput) => (
  (window.isMiniPomo ? MINI_POMODORO_SECONDS : ACCOUNT_STATS_POMODORO_SECONDS) * MS_PER_SECOND
);

export const buildSessionClockCycleOverlayWindows = ({
  focusWindows,
  breakWindows,
  sessionStartMs,
  sessionEndMs,
}: {
  focusWindows: SessionClockFocusWindowInput[];
  breakWindows: SessionClockBreakWindowInput[];
  sessionStartMs: number;
  sessionEndMs: number;
}): SessionClockCycleOverlayWindow[] => {
  if (!isFiniteRange(sessionStartMs, sessionEndMs)) return [];

  const events: SessionClockEvent[] = [
    ...focusWindows.map((window) => ({ ...window, kind: 'focus' as const })),
    ...breakWindows.map((window) => ({ ...window, kind: 'break' as const })),
  ]
    .map((event) => ({
      ...event,
      segmentStartMs: Math.max(sessionStartMs, event.segmentStartMs),
      segmentEndMs: Math.min(sessionEndMs, event.segmentEndMs),
    }))
    .filter((event) => isFiniteRange(event.segmentStartMs, event.segmentEndMs))
    .sort((left, right) => (
      left.segmentStartMs - right.segmentStartMs
      || left.segmentEndMs - right.segmentEndMs
      || (left.kind === 'focus' ? -1 : 1)
    ));

  const overlays: SessionClockCycleOverlayWindow[] = [];
  let currentCycleStartMs: number | null = null;
  let currentCycleDurationMs = ACCOUNT_STATS_POMODORO_SECONDS * MS_PER_SECOND;
  let lastCompletedCycle: SessionClockCycleOverlayWindow | null = null;

  const completeCycle = (startMs: number, endMs: number) => {
    const clippedStartMs = Math.max(sessionStartMs, startMs);
    const clippedEndMs = Math.min(sessionEndMs, endMs);
    if (!isFiniteRange(clippedStartMs, clippedEndMs)) return null;

    const cycle: SessionClockCycleOverlayWindow = {
      index: overlays.length + 1,
      startMs: clippedStartMs,
      endMs: clippedEndMs,
    };
    overlays.push(cycle);
    lastCompletedCycle = cycle;
    return cycle;
  };

  events.forEach((event) => {
    if (event.kind === 'break') {
      if (currentCycleStartMs !== null) return;
      if (!lastCompletedCycle) return;
      if (event.segmentEndMs <= lastCompletedCycle.endMs) return;

      lastCompletedCycle.endMs = Math.min(sessionEndMs, event.segmentEndMs);
      return;
    }

    if (currentCycleStartMs === null) {
      currentCycleStartMs = event.segmentStartMs;
      currentCycleDurationMs = getCycleDurationMs(event);
    }

    lastCompletedCycle = null;

    if (event.isMiniPomo) {
      currentCycleDurationMs = getCycleDurationMs(event);
    }

    if ((event.reasonCompletionWeight || 0) > 0) {
      completeCycle(currentCycleStartMs, event.segmentEndMs);
      currentCycleStartMs = null;
      return;
    }

    while (
      currentCycleStartMs !== null
      && event.segmentEndMs - currentCycleStartMs >= currentCycleDurationMs
    ) {
      completeCycle(currentCycleStartMs, currentCycleStartMs + currentCycleDurationMs);
      currentCycleStartMs += currentCycleDurationMs;
    }

    if (currentCycleStartMs !== null && currentCycleStartMs >= event.segmentEndMs) {
      currentCycleStartMs = null;
    }
  });

  return overlays;
};
