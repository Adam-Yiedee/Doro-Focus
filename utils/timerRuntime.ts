import { TimerRuntimePhase, TimerRuntimeSnapshot, TimerSettings } from '../types';

export const TIMER_RUNTIME_VERSION = 2 as const;
export const LONG_GRACE_SESSION_TIMEOUT_SECONDS = 3 * 60 * 60;
export const LONG_GRACE_SESSION_TIMEOUT_MS = LONG_GRACE_SESSION_TIMEOUT_SECONDS * 1000;

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

export interface ResetPersistedTimerSessionStateOptions {
  sourceTabId: string;
  nowMs: number;
  fallbackWorkDuration: number;
  scheduleStartTime: string;
}

type ResettablePersistedTimerSessionState = {
  settings?: Pick<TimerSettings, 'workDuration'> | null;
  workTime?: number;
  breakTime?: number;
  activeMode?: 'work' | 'break';
  timerStarted?: boolean;
  isIdle?: boolean;
  pomodoroCount?: number;
  allPauseActive?: boolean;
  allPauseTime?: number;
  allPauseReason?: string;
  allPauseStartTime?: number | null;
  graceOpen?: boolean;
  graceContext?: GraceContext;
  graceTotal?: number;
  sessionStartTime?: string | null;
  scheduleStartTime?: string;
  runtime?: TimerRuntimeSnapshot | null;
};

type ResetPersistedTimerSessionStateResult<T> = Omit<T,
  | 'runtime'
  | 'workTime'
  | 'breakTime'
  | 'activeMode'
  | 'timerStarted'
  | 'isIdle'
  | 'pomodoroCount'
  | 'allPauseActive'
  | 'allPauseTime'
  | 'allPauseReason'
  | 'allPauseStartTime'
  | 'graceOpen'
  | 'graceContext'
  | 'graceTotal'
  | 'sessionStartTime'
  | 'scheduleStartTime'
> & {
  runtime: TimerRuntimeSnapshot;
  workTime: number;
  breakTime: number;
  activeMode: 'work';
  timerStarted: false;
  isIdle: true;
  pomodoroCount: number;
  allPauseActive: false;
  allPauseTime: number;
  allPauseReason: string;
  allPauseStartTime: null;
  graceOpen: false;
  graceContext: null;
  graceTotal: 0;
  sessionStartTime: null;
  scheduleStartTime: string;
};

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

export const resetPersistedTimerSessionState = <T extends ResettablePersistedTimerSessionState>(
  payload: T,
  {
    sourceTabId,
    nowMs,
    fallbackWorkDuration,
    scheduleStartTime,
  }: ResetPersistedTimerSessionStateOptions,
): ResetPersistedTimerSessionStateResult<T> => {
  const configuredWorkDuration = payload?.settings?.workDuration;
  const payloadWorkTime = payload?.workTime;
  const nextWorkDuration = (
    typeof configuredWorkDuration === 'number' && Number.isFinite(configuredWorkDuration) && configuredWorkDuration > 0
      ? configuredWorkDuration
      : typeof payloadWorkTime === 'number' && Number.isFinite(payloadWorkTime) && payloadWorkTime > 0
        ? payloadWorkTime
        : fallbackWorkDuration
  );

  return {
    ...payload,
    runtime: createRuntimeSnapshot({
      sourceTabId,
      phase: 'idle',
      nowMs,
      workTime: nextWorkDuration,
      breakTime: 0,
      allPauseTime: 0,
      graceTotal: 0,
      activityStartIso: null,
    }),
    workTime: nextWorkDuration,
    breakTime: 0,
    activeMode: 'work',
    timerStarted: false,
    isIdle: true,
    pomodoroCount: 0,
    allPauseActive: false,
    allPauseTime: 0,
    allPauseReason: '',
    allPauseStartTime: null,
    graceOpen: false,
    graceContext: null,
    graceTotal: 0,
    sessionStartTime: null,
    scheduleStartTime,
  };
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
  maxAgeMs,
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
  if (typeof maxAgeMs !== 'number' || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return false;
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

export const resolveGraceBreakBank = ({
  breakTime,
  graceContext,
  runtimeSnapshot,
  adjustBreakBalance = 0,
}: {
  breakTime: number;
  graceContext: GraceContext;
  runtimeSnapshot?: TimerRuntimeSnapshot | null;
  adjustBreakBalance?: number;
}) => {
  const safeBreakTime = Number.isFinite(breakTime) ? breakTime : 0;
  const safeAdjustment = Number.isFinite(adjustBreakBalance) ? adjustBreakBalance : 0;
  const runtimeBreakTime = (
    graceContext === 'afterWork'
    && runtimeSnapshot?.phase === 'grace'
    && typeof runtimeSnapshot.phaseStartBreakTime === 'number'
    && Number.isFinite(runtimeSnapshot.phaseStartBreakTime)
  )
    ? runtimeSnapshot.phaseStartBreakTime
    : null;
  const baseBreakTime = runtimeBreakTime === null
    ? safeBreakTime
    : Math.max(safeBreakTime, runtimeBreakTime);

  return {
    // Only after-work grace should recover an earned bank from runtime state.
    // Continuing or manually starting a break at zero/debt should stay at zero/debt
    // so the timer can intentionally run negative.
    baseBreakTime,
    nextBreakTime: baseBreakTime - safeAdjustment,
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
