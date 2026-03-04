import { TimerRuntimePhase, TimerRuntimeSnapshot, TimerSettings } from '../types';

export const TIMER_RUNTIME_VERSION = 2 as const;

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
    // Break can run in debt; only trigger depletion when crossing from a positive bank.
    if (start > 0 && elapsedSeconds >= start) {
      return { mode: 'break', overflowSeconds: Math.max(0, elapsedSeconds - start) };
    }
  }

  return null;
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
