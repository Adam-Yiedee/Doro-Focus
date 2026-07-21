import { Task, TimerMode, TimerPreset, TimerRuntimePhase, TimerRuntimeSnapshot, TimerSettings } from '../types';

export const TIMER_RUNTIME_VERSION = 2 as const;
export const LONG_GRACE_SESSION_TIMEOUT_SECONDS = 3 * 60 * 60;
export const LONG_GRACE_SESSION_TIMEOUT_MS = LONG_GRACE_SESSION_TIMEOUT_SECONDS * 1000;
export const TIMER_LOCK_AUTO_UNLOCK_MS = 4 * 60 * 60 * 1000;

export const TIMER_PRESETS: Record<Exclude<TimerPreset, 'custom'>, Pick<TimerSettings, 'workDuration' | 'shortBreakDuration' | 'longBreakDuration' | 'longBreakInterval'>> = {
  classic: {
    workDuration: 25 * 60,
    shortBreakDuration: 5 * 60,
    longBreakDuration: 15 * 60,
    longBreakInterval: 4,
  },
  compact: {
    workDuration: 15 * 60,
    shortBreakDuration: 3 * 60,
    longBreakDuration: 9 * 60,
    longBreakInterval: 4,
  },
};

export const getMatchingTimerPreset = (
  settings: Pick<TimerSettings, 'workDuration' | 'shortBreakDuration' | 'longBreakDuration' | 'longBreakInterval'>,
): TimerPreset => {
  const entries = Object.entries(TIMER_PRESETS) as Array<[Exclude<TimerPreset, 'custom'>, typeof TIMER_PRESETS.classic]>;
  const match = entries.find(([, preset]) => (
    settings.workDuration === preset.workDuration
    && settings.shortBreakDuration === preset.shortBreakDuration
    && settings.longBreakDuration === preset.longBreakDuration
    && settings.longBreakInterval === preset.longBreakInterval
  ));

  return match ? match[0] : 'custom';
};

export const shouldAutoStartTwoInARowFocus = (
  completedPomoCount: number,
  settings: Pick<TimerSettings, 'timerPreset' | 'twoInARowMode'>,
) => {
  const safeCompletedPomoCount = Number.isFinite(completedPomoCount)
    ? Math.max(0, Math.floor(completedPomoCount))
    : 0;

  return (
    settings.timerPreset === 'compact'
    && settings.twoInARowMode
    && safeCompletedPomoCount > 0
    && safeCompletedPomoCount % 2 === 1
  );
};

export const getTimerLockAutoUnlockDelay = (
  lockedAtMs: number | null | undefined,
  nowMs: number,
  maxLockMs: number = TIMER_LOCK_AUTO_UNLOCK_MS,
) => {
  const safeMaxLockMs = typeof maxLockMs === 'number' && Number.isFinite(maxLockMs) && maxLockMs > 0
    ? maxLockMs
    : TIMER_LOCK_AUTO_UNLOCK_MS;

  if (
    typeof lockedAtMs !== 'number'
    || !Number.isFinite(lockedAtMs)
    || typeof nowMs !== 'number'
    || !Number.isFinite(nowMs)
  ) {
    return safeMaxLockMs;
  }

  return Math.max(0, safeMaxLockMs - Math.max(0, nowMs - lockedAtMs));
};

export const isTimerLockExpired = (
  lockedAtMs: number | null | undefined,
  nowMs: number,
  maxLockMs: number = TIMER_LOCK_AUTO_UNLOCK_MS,
) => getTimerLockAutoUnlockDelay(lockedAtMs, nowMs, maxLockMs) <= 0;

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
  lockedTimerMode?: 'work' | 'break' | null;
  lockedTimerStartedAtMs?: number | null;
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
  | 'lockedTimerMode'
  | 'lockedTimerStartedAtMs'
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
  lockedTimerMode: null;
  lockedTimerStartedAtMs: null;
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
    lockedTimerMode: null,
    lockedTimerStartedAtMs: null,
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

export interface PomodoroCycleProgress {
  completedPomoCount: number;
  longBreakInterval: number;
  completedInCycle: number;
  untilLongBreak: number;
  nextPomoCount: number;
  nextPomoTriggersLongBreak: boolean;
}

export interface TaskFinishProjectionInput {
  remainingPomodoros: number;
  pomodoroCount: number;
  workTime: number;
  breakTime: number;
  activeMode: TimerMode;
  isIdle: boolean;
  graceOpen: boolean;
  graceContext: 'afterWork' | 'afterBreak' | null;
  settings: Pick<TimerSettings,
    | 'workDuration'
    | 'shortBreakDuration'
    | 'longBreakDuration'
    | 'longBreakInterval'
    | 'timerPreset'
    | 'twoInARowMode'
  >;
}

export const getPomodoroCycleProgress = (
  pomodoroCount: number,
  longBreakInterval: number,
): PomodoroCycleProgress => {
  const safeCompletedPomoCount = Number.isFinite(pomodoroCount) ? Math.max(0, Math.floor(pomodoroCount)) : 0;
  const safeLongBreakInterval = Number.isFinite(longBreakInterval) && longBreakInterval > 0
    ? Math.max(1, Math.floor(longBreakInterval))
    : 4;
  const completedInCycle = safeCompletedPomoCount % safeLongBreakInterval;
  const nextPomoCount = safeCompletedPomoCount + 1;

  return {
    completedPomoCount: safeCompletedPomoCount,
    longBreakInterval: safeLongBreakInterval,
    completedInCycle,
    untilLongBreak: completedInCycle === 0 ? safeLongBreakInterval : safeLongBreakInterval - completedInCycle,
    nextPomoCount,
    nextPomoTriggersLongBreak: nextPomoCount % safeLongBreakInterval === 0,
  };
};

const getSafePositiveSeconds = (value: number, fallback = 0) => (
  Number.isFinite(value) ? Math.max(0, value) : fallback
);

const getSafeSignedSeconds = (value: number, fallback = 0) => (
  Number.isFinite(value) ? value : fallback
);

export const getRemainingPomodorosForTask = (task: Task): number => {
  if (task.checked) return 0;
  if (task.subtasks.length > 0) {
    return task.subtasks.reduce((acc, subtask) => acc + getRemainingPomodorosForTask(subtask), 0);
  }
  return Math.max(0, task.estimated - task.completed);
};

export const getRemainingPomodorosForActiveTasks = (tasks: Task[], todayKey?: string): number => {
  const activeTasks = tasks.filter(task => (
    !task.isFuture
    && (!todayKey || !task.scheduledDate || task.scheduledDate <= todayKey)
  ));

  return activeTasks.reduce((acc, task) => acc + getRemainingPomodorosForTask(task), 0);
};

export const computeWorkCompletion = (
  pomodoroCount: number,
  breakTime: number,
  settings: Pick<TimerSettings, 'shortBreakDuration' | 'longBreakDuration' | 'longBreakInterval'>
): WorkCompletionResult => {
  const cycleProgress = getPomodoroCycleProgress(pomodoroCount, settings.longBreakInterval);
  const isLongBreak = cycleProgress.nextPomoTriggersLongBreak;
  const reward = isLongBreak ? settings.longBreakDuration : settings.shortBreakDuration;

  return {
    nextPomoCount: cycleProgress.nextPomoCount,
    reward,
    isLongBreak,
    nextBreakTime: breakTime + reward,
  };
};

export const getProjectedTaskFinishSeconds = ({
  remainingPomodoros,
  pomodoroCount,
  workTime,
  breakTime,
  activeMode,
  isIdle,
  graceOpen,
  graceContext,
  settings,
}: TaskFinishProjectionInput) => {
  const remaining = Number.isFinite(remainingPomodoros)
    ? Math.max(0, Math.floor(remainingPomodoros))
    : 0;
  if (remaining <= 0) return 0;

  const safeSettings = {
    ...settings,
    workDuration: getSafePositiveSeconds(settings.workDuration),
    shortBreakDuration: getSafePositiveSeconds(settings.shortBreakDuration),
    longBreakDuration: getSafePositiveSeconds(settings.longBreakDuration),
    longBreakInterval: Number.isFinite(settings.longBreakInterval) && settings.longBreakInterval > 0
      ? Math.max(1, Math.floor(settings.longBreakInterval))
      : 4,
  };
  let projectedSeconds = 0;
  let virtualPomoCount = Number.isFinite(pomodoroCount) ? Math.max(0, Math.floor(pomodoroCount)) : 0;
  let futureBreakBank = Math.max(0, getSafeSignedSeconds(breakTime));

  const shouldUseCurrentWorkFirst = (
    !isIdle
    && activeMode === 'work'
    && !(graceOpen && graceContext === 'afterWork')
  );

  for (let i = 0; i < remaining; i += 1) {
    projectedSeconds += i === 0 && shouldUseCurrentWorkFirst
      ? getSafePositiveSeconds(workTime, safeSettings.workDuration)
      : safeSettings.workDuration;

    const completion = computeWorkCompletion(virtualPomoCount, 0, safeSettings);
    virtualPomoCount = completion.nextPomoCount;
    futureBreakBank += completion.reward;
  }

  return projectedSeconds + futureBreakBank;
};

export const getBreakBankBaseForWorkCompletion = ({
  breakTime,
  runtimeSnapshot,
  nowMs,
}: {
  breakTime: number;
  runtimeSnapshot?: TimerRuntimeSnapshot | null;
  nowMs: number;
}) => {
  const fallbackBreakTime = Number.isFinite(breakTime) ? breakTime : 0;
  if (!runtimeSnapshot || runtimeSnapshot.phase !== 'running-work') return fallbackBreakTime;

  const derivedBreakTime = deriveRuntimeValues(runtimeSnapshot, nowMs).breakTime;
  return Number.isFinite(derivedBreakTime) ? derivedBreakTime : fallbackBreakTime;
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
