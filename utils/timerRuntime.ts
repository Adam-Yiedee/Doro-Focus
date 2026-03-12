import { TimerRuntimePhase, TimerRuntimeSnapshot, TimerSettings } from '../types';

export const TIMER_RUNTIME_VERSION = 2 as const;
const RESTORED_GRACE_MAX_AGE_MS = 60 * 60 * 1000;

export interface RuntimeDerivedValues {
  workTime: number;
  breakTime: number;
  allPauseTime: number;
  graceTotal: number;
}

export interface RuntimeBoundaryCrossing {
  mode: 'work' | 'break';
  overflowSeconds: number;
}

export const getTimerStateFreshnessStamp = ({
  runtime,
  payloadUpdatedAtMs = 0,
}: {
  runtime?: TimerRuntimeSnapshot | null;
  payloadUpdatedAtMs?: number;
}) => {
  if (runtime && typeof runtime.updatedAtMs === 'number' && Number.isFinite(runtime.updatedAtMs)) {
    return runtime.updatedAtMs;
  }
  return Math.max(0, payloadUpdatedAtMs);
};

export const shouldApplyIncomingRuntime = ({
  incomingRuntime,
  lastAppliedAtMs,
}: {
  incomingRuntime?: TimerRuntimeSnapshot | null;
  lastAppliedAtMs: number;
}) => {
  if (!incomingRuntime || typeof incomingRuntime.updatedAtMs !== 'number' || !Number.isFinite(incomingRuntime.updatedAtMs)) {
    return false;
  }
  return incomingRuntime.updatedAtMs > lastAppliedAtMs;
};

export const getCompletedPhaseDuration = ({
  snapshot,
  mode,
  nowMs,
  overflowSeconds = 0,
  activityStartIso = null,
  fallbackDuration = 0,
}: {
  snapshot?: TimerRuntimeSnapshot | null;
  mode: 'work' | 'break';
  nowMs: number;
  overflowSeconds?: number;
  activityStartIso?: string | null;
  fallbackDuration?: number;
}) => {
  const phase = mode === 'work' ? 'running-work' : 'running-break';
  const runtimeStartDuration = snapshot?.phase === phase
    ? (mode === 'work' ? snapshot.phaseStartWorkTime : snapshot.phaseStartBreakTime)
    : null;
  if (typeof runtimeStartDuration === 'number' && Number.isFinite(runtimeStartDuration) && runtimeStartDuration > 0) {
    return Math.max(0, runtimeStartDuration);
  }

  if (typeof activityStartIso === 'string' && activityStartIso) {
    const activityStartMs = Date.parse(activityStartIso);
    if (Number.isFinite(activityStartMs)) {
      return Math.max(0, ((nowMs - activityStartMs) / 1000) - Math.max(0, overflowSeconds));
    }
  }

  return Math.max(0, fallbackDuration);
};

export type GraceContext = 'afterWork' | 'afterBreak' | null;

interface RuntimeSnapshotInput {
  sourceTabId: string;
  phase: TimerRuntimePhase;
  nowMs: number;
  workTime: number;
  breakTime: number;
  allPauseTime: number;
  graceTotal: number;
  activityStartIso?: string | null;
}

const getElapsedSeconds = (phaseStartedAtMs: number | null, nowMs: number): number => {
  if (!phaseStartedAtMs) return 0;
  return Math.max(0, (nowMs - phaseStartedAtMs) / 1000);
};

const clampZero = (val: number) => (val < 0 ? 0 : val);

export const createRuntimeSnapshot = ({
  sourceTabId,
  phase,
  nowMs,
  workTime,
  breakTime,
  allPauseTime,
  graceTotal,
  activityStartIso = null,
}: RuntimeSnapshotInput): TimerRuntimeSnapshot => {
  return {
    version: TIMER_RUNTIME_VERSION,
    updatedAtMs: nowMs,
    sourceTabId,
    phase,
    phaseStartedAtMs: phase === 'idle' ? null : nowMs,
    phaseStartWorkTime: workTime,
    phaseStartBreakTime: breakTime,
    phaseStartAllPauseTime: allPauseTime,
    phaseStartGraceTotal: graceTotal,
    activityStartIso,
  };
};

export const deriveRuntimeValues = (snapshot: TimerRuntimeSnapshot, nowMs: number): RuntimeDerivedValues => {
  const elapsedSeconds = getElapsedSeconds(snapshot.phaseStartedAtMs, nowMs);

  switch (snapshot.phase) {
    case 'running-work':
      return {
        workTime: clampZero(snapshot.phaseStartWorkTime - elapsedSeconds),
        breakTime: snapshot.phaseStartBreakTime,
        allPauseTime: snapshot.phaseStartAllPauseTime,
        graceTotal: snapshot.phaseStartGraceTotal,
      };
    case 'running-break':
      return {
        workTime: snapshot.phaseStartWorkTime,
        breakTime: snapshot.phaseStartBreakTime - elapsedSeconds,
        allPauseTime: snapshot.phaseStartAllPauseTime,
        graceTotal: snapshot.phaseStartGraceTotal,
      };
    case 'all-pause':
      return {
        workTime: snapshot.phaseStartWorkTime,
        breakTime: snapshot.phaseStartBreakTime,
        allPauseTime: snapshot.phaseStartAllPauseTime + elapsedSeconds,
        graceTotal: snapshot.phaseStartGraceTotal,
      };
    case 'grace':
      return {
        workTime: snapshot.phaseStartWorkTime,
        breakTime: snapshot.phaseStartBreakTime,
        allPauseTime: snapshot.phaseStartAllPauseTime,
        graceTotal: snapshot.phaseStartGraceTotal + elapsedSeconds,
      };
    case 'idle':
    default:
      return {
        workTime: snapshot.phaseStartWorkTime,
        breakTime: snapshot.phaseStartBreakTime,
        allPauseTime: snapshot.phaseStartAllPauseTime,
        graceTotal: snapshot.phaseStartGraceTotal,
      };
  }
};

export const detectRuntimeBoundaryCrossing = (snapshot: TimerRuntimeSnapshot, nowMs: number): RuntimeBoundaryCrossing | null => {
  const elapsedSeconds = getElapsedSeconds(snapshot.phaseStartedAtMs, nowMs);

  if (snapshot.phase === 'running-work') {
    const start = Math.max(0, snapshot.phaseStartWorkTime);
    if (elapsedSeconds >= start) {
      return { mode: 'work', overflowSeconds: Math.max(0, elapsedSeconds - start) };
    }
  }

  if (snapshot.phase === 'running-break') {
    const start = snapshot.phaseStartBreakTime;
    if (start > 0 && elapsedSeconds >= start) {
      return { mode: 'break', overflowSeconds: Math.max(0, elapsedSeconds - start) };
    }
  }

  return null;
};

export const normalizeGraceWindow = ({
  graceOpenCandidate,
  rawGraceContext,
  fallbackMode,
}: {
  graceOpenCandidate: boolean;
  rawGraceContext?: unknown;
  fallbackMode: 'work' | 'break';
}): {
  graceOpen: boolean;
  graceContext: GraceContext;
} => {
  const graceOpen = Boolean(graceOpenCandidate);
  if (!graceOpen) {
    return {
      graceOpen: false,
      graceContext: null as GraceContext,
    };
  }
  if (rawGraceContext === 'afterWork' || rawGraceContext === 'afterBreak') {
    return {
      graceOpen: true,
      graceContext: rawGraceContext,
    };
  }
  return {
    graceOpen: true,
    graceContext: fallbackMode === 'break' ? 'afterBreak' : 'afterWork',
  };
};

export const shouldDiscardRestoredGrace = ({
  snapshot,
  sessionStartTime,
  graceOpen = false,
  nowMs,
  maxAgeMs = RESTORED_GRACE_MAX_AGE_MS,
}: {
  snapshot?: TimerRuntimeSnapshot | null;
  sessionStartTime?: string | null;
  graceOpen?: boolean;
  nowMs: number;
  maxAgeMs?: number;
}) => {
  const hasSessionAnchor = typeof sessionStartTime === 'string' && sessionStartTime.trim().length > 0;
  if (graceOpen && !hasSessionAnchor) return true;
  if (!snapshot || snapshot.phase !== 'grace') return false;
  if (!hasSessionAnchor) return true;
  if (typeof snapshot.phaseStartedAtMs !== 'number') return true;
  return nowMs - snapshot.phaseStartedAtMs > maxAgeMs;
};

export interface WorkCompletionResult {
  nextPomoCount: number;
  reward: number;
  isLongBreak: boolean;
  nextBreakTime: number;
}

export const computeWorkCompletion = (
  pomodoroCount: number,
  breakTime: number,
  settings: Pick<TimerSettings, 'shortBreakDuration' | 'longBreakDuration' | 'longBreakInterval'>
): WorkCompletionResult => {
  const nextPomoCount = pomodoroCount + 1;
  const isLongBreak = nextPomoCount % settings.longBreakInterval === 0;
  const reward = isLongBreak ? settings.longBreakDuration : settings.shortBreakDuration;

  return {
    nextPomoCount,
    reward,
    isLongBreak,
    nextBreakTime: breakTime + reward,
  };
};

export const getPauseCompensation = (allPauseTime: number) => ({
  addToBankAmount: allPauseTime / 5,
  deductFromBankAmount: allPauseTime,
});

export const getGraceCompensation = (graceTotal: number) => ({
  addToBankAmount: graceTotal / 5,
  deductFromBankAmount: graceTotal,
});
