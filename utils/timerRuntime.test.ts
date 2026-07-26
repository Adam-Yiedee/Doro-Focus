import { describe, expect, it } from 'vitest';
import {
  computeWorkCompletion,
  createRuntimeSnapshot,
  deriveRuntimeValues,
  detectRuntimeBoundaryCrossing,
  getBreakBankBaseForWorkCompletion,
  getMatchingTimerPreset,
  getCompletedPhaseDuration,
  getPomodoroCycleProgress,
  getProjectedTaskFinishSeconds,
  getTimerLockAutoUnlockDelay,
  resolveGraceBreakBank,
  isTimerLockExpired,
  TIMER_PRESETS,
  TIMER_LOCK_AUTO_UNLOCK_MS,
  getTimerStateFreshnessStamp,
  getGraceCompensation,
  getPauseCompensation,
  normalizeGraceWindow,
  resetPersistedTimerSessionState,
  shouldApplyIncomingRuntime,
  shouldAutoStartTwoInARowFocus,
  shouldDiscardRestoredGrace,
} from './timerRuntime';

const BASE_NOW = 1_700_000_000_000;
const TAB_ID = 'test-tab';

describe('timer runtime derivation', () => {
  it('derives running work countdown from wall-clock time', () => {
    const snapshot = createRuntimeSnapshot({
      sourceTabId: TAB_ID,
      phase: 'running-work',
      nowMs: BASE_NOW,
      workTime: 1500,
      breakTime: 120,
      allPauseTime: 0,
      graceTotal: 0,
    });

    const derived = deriveRuntimeValues(snapshot, BASE_NOW + 30_000);
    expect(derived.workTime).toBeCloseTo(1470, 2);
    expect(derived.breakTime).toBe(120);
  });

  it('lets a break started at zero continue into debt', () => {
    const snapshot = createRuntimeSnapshot({
      sourceTabId: TAB_ID,
      phase: 'running-break',
      nowMs: BASE_NOW,
      workTime: 1500,
      breakTime: 0,
      allPauseTime: 0,
      graceTotal: 0,
    });

    const derived = deriveRuntimeValues(snapshot, BASE_NOW + 45_000);
    expect(derived.breakTime).toBeCloseTo(-45, 2);
  });

  it('keeps a debt break counting downward when it resumes below zero', () => {
    const snapshot = createRuntimeSnapshot({
      sourceTabId: TAB_ID,
      phase: 'running-break',
      nowMs: BASE_NOW,
      workTime: 1500,
      breakTime: -30,
      allPauseTime: 0,
      graceTotal: 0,
    });

    const derived = deriveRuntimeValues(snapshot, BASE_NOW + 45_000);
    expect(derived.breakTime).toBeCloseTo(-75, 2);
  });

  it('derives pause and grace elapsed totals from wall-clock time', () => {
    const pauseSnapshot = createRuntimeSnapshot({
      sourceTabId: TAB_ID,
      phase: 'all-pause',
      nowMs: BASE_NOW,
      workTime: 600,
      breakTime: 90,
      allPauseTime: 12,
      graceTotal: 0,
    });
    const graceSnapshot = createRuntimeSnapshot({
      sourceTabId: TAB_ID,
      phase: 'grace',
      nowMs: BASE_NOW,
      workTime: 0,
      breakTime: 300,
      allPauseTime: 0,
      graceTotal: 5,
    });

    expect(deriveRuntimeValues(pauseSnapshot, BASE_NOW + 7_000).allPauseTime).toBeCloseTo(19, 2);
    expect(deriveRuntimeValues(graceSnapshot, BASE_NOW + 9_000).graceTotal).toBeCloseTo(14, 2);
  });

  it('keeps legacy migration snapshots stopped while preserving remaining times', () => {
    const migrated = createRuntimeSnapshot({
      sourceTabId: TAB_ID,
      phase: 'idle',
      nowMs: BASE_NOW,
      workTime: 321,
      breakTime: -14,
      allPauseTime: 0,
      graceTotal: 0,
    });

    const derivedLater = deriveRuntimeValues(migrated, BASE_NOW + 120_000);
    expect(derivedLater.workTime).toBe(321);
    expect(derivedLater.breakTime).toBe(-14);
    expect(detectRuntimeBoundaryCrossing(migrated, BASE_NOW + 120_000)).toBeNull();
  });
});

describe('boundary catch-up policy', () => {
  it('crosses work boundary once and reports overflow only', () => {
    const snapshot = createRuntimeSnapshot({
      sourceTabId: TAB_ID,
      phase: 'running-work',
      nowMs: BASE_NOW,
      workTime: 5,
      breakTime: 0,
      allPauseTime: 0,
      graceTotal: 0,
    });

    const crossing = detectRuntimeBoundaryCrossing(snapshot, BASE_NOW + 31_000);
    expect(crossing).toEqual({ mode: 'work', overflowSeconds: 26 });
  });

  it('reports break boundary crossing from positive bank without changing modes', () => {
    const snapshot = createRuntimeSnapshot({
      sourceTabId: TAB_ID,
      phase: 'running-break',
      nowMs: BASE_NOW,
      workTime: 1500,
      breakTime: 10,
      allPauseTime: 0,
      graceTotal: 0,
    });

    const crossing = detectRuntimeBoundaryCrossing(snapshot, BASE_NOW + 45_000);
    expect(crossing).toEqual({ mode: 'break', overflowSeconds: 35 });
  });

  it('does not cross break boundary when break starts at zero', () => {
    const snapshot = createRuntimeSnapshot({
      sourceTabId: TAB_ID,
      phase: 'running-break',
      nowMs: BASE_NOW,
      workTime: 1500,
      breakTime: 0,
      allPauseTime: 0,
      graceTotal: 0,
    });

    const crossing = detectRuntimeBoundaryCrossing(snapshot, BASE_NOW + 45_000);
    expect(crossing).toBeNull();
  });

  it('does not cross break boundary when break starts in debt', () => {
    const snapshot = createRuntimeSnapshot({
      sourceTabId: TAB_ID,
      phase: 'running-break',
      nowMs: BASE_NOW,
      workTime: 1500,
      breakTime: -30,
      allPauseTime: 0,
      graceTotal: 0,
    });

    const crossing = detectRuntimeBoundaryCrossing(snapshot, BASE_NOW + 45_000);
    expect(crossing).toBeNull();
  });

  it('uses the runtime phase start duration when logging a completed work block', () => {
    const snapshot = createRuntimeSnapshot({
      sourceTabId: TAB_ID,
      phase: 'running-work',
      nowMs: BASE_NOW,
      workTime: 900,
      breakTime: 300,
      allPauseTime: 0,
      graceTotal: 0,
    });

    expect(getCompletedPhaseDuration({
      snapshot,
      mode: 'work',
      nowMs: BASE_NOW + 960_000,
      overflowSeconds: 60,
      activityStartIso: new Date(BASE_NOW).toISOString(),
      fallbackDuration: 1500,
    })).toBe(900);
  });

  it('falls back to elapsed activity time when the runtime snapshot is unavailable', () => {
    expect(getCompletedPhaseDuration({
      snapshot: null,
      mode: 'work',
      nowMs: BASE_NOW + 1_520_000,
      overflowSeconds: 20,
      activityStartIso: new Date(BASE_NOW).toISOString(),
      fallbackDuration: 1500,
    })).toBeCloseTo(1500, 2);
  });
});

describe('runtime freshness policy', () => {
  it('prefers runtime timestamps over payload updatedAt when comparing timer state freshness', () => {
    const runtime = createRuntimeSnapshot({
      sourceTabId: TAB_ID,
      phase: 'running-work',
      nowMs: BASE_NOW,
      workTime: 1500,
      breakTime: 0,
      allPauseTime: 0,
      graceTotal: 0,
    });

    expect(getTimerStateFreshnessStamp({
      runtime,
      payloadUpdatedAtMs: BASE_NOW + 60_000,
    })).toBe(BASE_NOW);
  });

  it('falls back to payload updatedAt when a timer payload has no runtime snapshot', () => {
    expect(getTimerStateFreshnessStamp({
      runtime: null,
      payloadUpdatedAtMs: BASE_NOW + 45_000,
    })).toBe(BASE_NOW + 45_000);
  });

  it('rejects stale incoming runtimes for sync application', () => {
    const incoming = createRuntimeSnapshot({
      sourceTabId: TAB_ID,
      phase: 'running-break',
      nowMs: BASE_NOW,
      workTime: 1200,
      breakTime: 300,
      allPauseTime: 0,
      graceTotal: 0,
    });

    expect(shouldApplyIncomingRuntime({
      incomingRuntime: incoming,
      lastAppliedAtMs: BASE_NOW,
    })).toBe(false);
    expect(shouldApplyIncomingRuntime({
      incomingRuntime: incoming,
      lastAppliedAtMs: BASE_NOW - 1,
    })).toBe(true);
  });
});

describe('restored grace sanitization', () => {
  it('discards restored grace when no active session anchor exists', () => {
    const snapshot = createRuntimeSnapshot({
      sourceTabId: TAB_ID,
      phase: 'grace',
      nowMs: BASE_NOW,
      workTime: 0,
      breakTime: 300,
      allPauseTime: 0,
      graceTotal: 5,
    });

    expect(shouldDiscardRestoredGrace({
      snapshot,
      sessionStartTime: null,
      nowMs: BASE_NOW + 1_000,
    })).toBe(true);
  });

  it('keeps restored grace by default so abandoned sessions can be finalized explicitly', () => {
    const snapshot = createRuntimeSnapshot({
      sourceTabId: TAB_ID,
      phase: 'grace',
      nowMs: BASE_NOW,
      workTime: 0,
      breakTime: 300,
      allPauseTime: 0,
      graceTotal: 5,
    });

    expect(shouldDiscardRestoredGrace({
      snapshot,
      sessionStartTime: '2026-03-07T10:00:00.000Z',
      nowMs: BASE_NOW + (60 * 60 * 1000) + 1,
    })).toBe(false);
  });

  it('keeps fresh restored grace when the session is still active', () => {
    const snapshot = createRuntimeSnapshot({
      sourceTabId: TAB_ID,
      phase: 'grace',
      nowMs: BASE_NOW,
      workTime: 0,
      breakTime: 300,
      allPauseTime: 0,
      graceTotal: 5,
    });

    expect(shouldDiscardRestoredGrace({
      snapshot,
      sessionStartTime: '2026-03-07T10:00:00.000Z',
      nowMs: BASE_NOW + 30 * 60 * 1000,
    })).toBe(false);
  });

  it('still supports explicit max-age pruning when a caller opts into it', () => {
    const snapshot = createRuntimeSnapshot({
      sourceTabId: TAB_ID,
      phase: 'grace',
      nowMs: BASE_NOW,
      workTime: 0,
      breakTime: 300,
      allPauseTime: 0,
      graceTotal: 5,
    });

    expect(shouldDiscardRestoredGrace({
      snapshot,
      sessionStartTime: '2026-03-07T10:00:00.000Z',
      nowMs: BASE_NOW + (60 * 60 * 1000) + 1,
      maxAgeMs: 60 * 60 * 1000,
    })).toBe(true);
  });
});

describe('timer lock guard', () => {
  it('reports the remaining lock duration until the guard expires', () => {
    const lockedAtMs = BASE_NOW;

    expect(getTimerLockAutoUnlockDelay(lockedAtMs, BASE_NOW)).toBe(TIMER_LOCK_AUTO_UNLOCK_MS);
    expect(getTimerLockAutoUnlockDelay(lockedAtMs, BASE_NOW + 90_000)).toBe(TIMER_LOCK_AUTO_UNLOCK_MS - 90_000);
  });

  it('expires timer locks once the maximum lock duration has elapsed', () => {
    const lockedAtMs = BASE_NOW;

    expect(isTimerLockExpired(lockedAtMs, BASE_NOW + TIMER_LOCK_AUTO_UNLOCK_MS - 1)).toBe(false);
    expect(isTimerLockExpired(lockedAtMs, BASE_NOW + TIMER_LOCK_AUTO_UNLOCK_MS)).toBe(true);
    expect(getTimerLockAutoUnlockDelay(lockedAtMs, BASE_NOW + TIMER_LOCK_AUTO_UNLOCK_MS + 30_000)).toBe(0);
  });
});

describe('persisted session reset', () => {
  it('clears transient timer and grace state while preserving durable payload data', () => {
    const payload = {
      settings: { workDuration: 1800 },
      workTime: 42,
      breakTime: 300,
      activeMode: 'break' as const,
      timerStarted: true,
      isIdle: false,
      lockedTimerMode: 'break' as const,
      lockedTimerStartedAtMs: BASE_NOW - 60000,
      pomodoroCount: 7,
      allPauseActive: true,
      allPauseTime: 55,
      allPauseReason: 'Away',
      allPauseStartTime: BASE_NOW - 5000,
      graceOpen: true,
      graceContext: 'afterBreak' as const,
      graceTotal: 7200,
      sessionStartTime: '2026-03-12T09:00:00.000Z',
      scheduleStartTime: '09:00',
      focusTimerDisplayOffsetSeconds: 2700,
      tasks: [{ id: 1, name: 'Preserved' }],
    };

    const reset = resetPersistedTimerSessionState(payload, {
      sourceTabId: TAB_ID,
      nowMs: BASE_NOW,
      fallbackWorkDuration: 1500,
      scheduleStartTime: '13:37',
    });

    expect(reset.tasks).toEqual(payload.tasks);
    expect(reset.runtime?.phase).toBe('idle');
    expect(reset.workTime).toBe(1800);
    expect(reset.breakTime).toBe(0);
    expect(reset.activeMode).toBe('work');
    expect(reset.timerStarted).toBe(false);
    expect(reset.isIdle).toBe(true);
    expect(reset.lockedTimerMode).toBeNull();
    expect(reset.lockedTimerStartedAtMs).toBeNull();
    expect(reset.pomodoroCount).toBe(0);
    expect(reset.allPauseActive).toBe(false);
    expect(reset.allPauseTime).toBe(0);
    expect(reset.allPauseReason).toBe('');
    expect(reset.allPauseStartTime).toBeNull();
    expect(reset.graceOpen).toBe(false);
    expect(reset.graceContext).toBeNull();
    expect(reset.graceTotal).toBe(0);
    expect(reset.sessionStartTime).toBeNull();
    expect(reset.scheduleStartTime).toBe('13:37');
    expect(reset.focusTimerDisplayOffsetSeconds).toBe(0);
  });

  it('falls back to the provided work duration when persisted work time is invalid', () => {
    const reset = resetPersistedTimerSessionState({
      settings: { workDuration: 0 },
      workTime: -20,
    }, {
      sourceTabId: TAB_ID,
      nowMs: BASE_NOW,
      fallbackWorkDuration: 1500,
      scheduleStartTime: '08:15',
    });

    expect(reset.workTime).toBe(1500);
    expect(reset.runtime?.phaseStartWorkTime).toBe(1500);
    expect(reset.scheduleStartTime).toBe('08:15');
  });
});

describe('grace context normalization', () => {
  it('keeps explicit after-break grace state intact', () => {
    expect(normalizeGraceWindow({
      graceOpenCandidate: true,
      rawGraceContext: 'afterBreak',
      fallbackMode: 'break',
    })).toEqual({
      graceOpen: true,
      graceContext: 'afterBreak',
    });
  });

  it('infers legacy break grace from break mode when context is missing', () => {
    expect(normalizeGraceWindow({
      graceOpenCandidate: true,
      rawGraceContext: null,
      fallbackMode: 'break',
    })).toEqual({
      graceOpen: true,
      graceContext: 'afterBreak',
    });
  });

  it('clears grace context when grace is not open', () => {
    expect(normalizeGraceWindow({
      graceOpenCandidate: false,
      rawGraceContext: 'afterWork',
      fallbackMode: 'work',
    })).toEqual({
      graceOpen: false,
      graceContext: null,
    });
  });
});

describe('behavior-locked transition math', () => {
  it('defines compact timers at the same break ratio as classic timers', () => {
    expect(TIMER_PRESETS.compact).toEqual({
      workDuration: 900,
      shortBreakDuration: 180,
      longBreakDuration: 540,
      longBreakInterval: 4,
    });
    expect(TIMER_PRESETS.focus).toEqual(TIMER_PRESETS.classic);
    expect(TIMER_PRESETS.classic.workDuration / TIMER_PRESETS.classic.shortBreakDuration).toBe(5);
    expect(TIMER_PRESETS.compact.workDuration / TIMER_PRESETS.compact.shortBreakDuration).toBe(5);
    expect(TIMER_PRESETS.compact.longBreakDuration / TIMER_PRESETS.compact.shortBreakDuration).toBe(3);
  });

  it('detects classic, compact, and custom timer presets from duration settings', () => {
    expect(getMatchingTimerPreset(TIMER_PRESETS.classic)).toBe('classic');
    expect(getMatchingTimerPreset(TIMER_PRESETS.compact)).toBe('compact');
    expect(getMatchingTimerPreset(TIMER_PRESETS.focus)).toBe('classic');
    expect(getMatchingTimerPreset({
      workDuration: 1200,
      shortBreakDuration: 240,
      longBreakDuration: 720,
      longBreakInterval: 4,
    })).toBe('custom');
  });

  it('tracks how many pomodoros remain until the next long break', () => {
    expect(getPomodoroCycleProgress(0, 4)).toMatchObject({
      completedInCycle: 0,
      untilLongBreak: 4,
      nextPomoCount: 1,
      nextPomoTriggersLongBreak: false,
    });
    expect(getPomodoroCycleProgress(3, 4)).toMatchObject({
      completedInCycle: 3,
      untilLongBreak: 1,
      nextPomoCount: 4,
      nextPomoTriggersLongBreak: true,
    });
    expect(getPomodoroCycleProgress(4, 4)).toMatchObject({
      completedInCycle: 0,
      untilLongBreak: 4,
      nextPomoCount: 5,
      nextPomoTriggersLongBreak: false,
    });
  });

  it('keeps short-break reward logic exact', () => {
    const result = computeWorkCompletion(1, 120, {
      shortBreakDuration: 300,
      longBreakDuration: 900,
      longBreakInterval: 4,
    });

    expect(result.nextPomoCount).toBe(2);
    expect(result.isLongBreak).toBe(false);
    expect(result.reward).toBe(300);
    expect(result.nextBreakTime).toBe(420);
  });

  it('keeps long-break reward logic exact', () => {
    const result = computeWorkCompletion(3, 60, {
      shortBreakDuration: 300,
      longBreakDuration: 900,
      longBreakInterval: 4,
    });

    expect(result.nextPomoCount).toBe(4);
    expect(result.isLongBreak).toBe(true);
    expect(result.reward).toBe(900);
    expect(result.nextBreakTime).toBe(960);
  });

  it('uses the compact long-break reward after every four compact pomodoros', () => {
    const result = computeWorkCompletion(3, 0, TIMER_PRESETS.compact);

    expect(result.nextPomoCount).toBe(4);
    expect(result.isLongBreak).toBe(true);
    expect(result.reward).toBe(540);
    expect(result.nextBreakTime).toBe(540);
  });

  it('projects classic task finish time with every earned break banked into the finish', () => {
    expect(getProjectedTaskFinishSeconds({
      remainingPomodoros: 4,
      pomodoroCount: 0,
      workTime: TIMER_PRESETS.classic.workDuration,
      breakTime: 0,
      activeMode: 'work',
      isIdle: true,
      graceOpen: false,
      graceContext: null,
      settings: { ...TIMER_PRESETS.classic, timerPreset: 'classic', twoInARowMode: false },
    })).toBe((4 * 25 + 5 + 5 + 5 + 15) * 60);
  });

  it('projects classic long and short rewards when the next completion crosses the long-break boundary', () => {
    expect(getProjectedTaskFinishSeconds({
      remainingPomodoros: 2,
      pomodoroCount: 3,
      workTime: TIMER_PRESETS.classic.workDuration,
      breakTime: 0,
      activeMode: 'work',
      isIdle: true,
      graceOpen: false,
      graceContext: null,
      settings: { ...TIMER_PRESETS.classic, timerPreset: 'classic', twoInARowMode: false },
    })).toBe((25 + 15 + 25 + 5) * 60);
  });

  it('projects compact mini-pomos with all compact short and long rewards', () => {
    expect(getProjectedTaskFinishSeconds({
      remainingPomodoros: 5,
      pomodoroCount: 0,
      workTime: TIMER_PRESETS.compact.workDuration,
      breakTime: 0,
      activeMode: 'work',
      isIdle: true,
      graceOpen: false,
      graceContext: null,
      settings: { ...TIMER_PRESETS.compact, timerPreset: 'compact', twoInARowMode: false },
    })).toBe((5 * 15 + 3 + 3 + 3 + 9 + 3) * 60);
  });

  it('uses the current partial work timer for the first remaining classic pomodoro', () => {
    expect(getProjectedTaskFinishSeconds({
      remainingPomodoros: 2,
      pomodoroCount: 0,
      workTime: 10 * 60,
      breakTime: 0,
      activeMode: 'work',
      isIdle: false,
      graceOpen: false,
      graceContext: null,
      settings: { ...TIMER_PRESETS.classic, timerPreset: 'classic', twoInARowMode: false },
    })).toBe((10 + 5 + 25 + 5) * 60);
  });

  it('includes the current positive break bank when the timer is already in break mode', () => {
    expect(getProjectedTaskFinishSeconds({
      remainingPomodoros: 2,
      pomodoroCount: 1,
      workTime: TIMER_PRESETS.classic.workDuration,
      breakTime: 4 * 60,
      activeMode: 'break',
      isIdle: false,
      graceOpen: false,
      graceContext: null,
      settings: { ...TIMER_PRESETS.classic, timerPreset: 'classic', twoInARowMode: false },
    })).toBe((4 + 25 + 5 + 25 + 5) * 60);
  });

  it('projects compact two-in-a-row with all banked pair rewards included', () => {
    expect(getProjectedTaskFinishSeconds({
      remainingPomodoros: 4,
      pomodoroCount: 0,
      workTime: TIMER_PRESETS.compact.workDuration,
      breakTime: 0,
      activeMode: 'work',
      isIdle: true,
      graceOpen: false,
      graceContext: null,
      settings: { ...TIMER_PRESETS.compact, timerPreset: 'compact', twoInARowMode: true },
    })).toBe((4 * 15 + 3 + 3 + 3 + 9) * 60);
  });

  it('keeps already banked compact two-in-a-row break time in the finish estimate', () => {
    expect(getProjectedTaskFinishSeconds({
      remainingPomodoros: 2,
      pomodoroCount: 1,
      workTime: 10 * 60,
      breakTime: 3 * 60,
      activeMode: 'work',
      isIdle: false,
      graceOpen: false,
      graceContext: null,
      settings: { ...TIMER_PRESETS.compact, timerPreset: 'compact', twoInARowMode: true },
    })).toBe((10 + 3 + 15 + 3 + 3) * 60);
  });

  it('keeps the finish stable as normal positive break bank is spent', () => {
    const beforeBreakSeconds = getProjectedTaskFinishSeconds({
      remainingPomodoros: 3,
      pomodoroCount: 1,
      workTime: TIMER_PRESETS.classic.workDuration,
      breakTime: 5 * 60,
      activeMode: 'break',
      isIdle: false,
      graceOpen: false,
      graceContext: null,
      settings: { ...TIMER_PRESETS.classic, timerPreset: 'classic', twoInARowMode: false },
    });
    const twoMinutesIntoBreakSeconds = getProjectedTaskFinishSeconds({
      remainingPomodoros: 3,
      pomodoroCount: 1,
      workTime: TIMER_PRESETS.classic.workDuration,
      breakTime: 3 * 60,
      activeMode: 'break',
      isIdle: false,
      graceOpen: false,
      graceContext: null,
      settings: { ...TIMER_PRESETS.classic, timerPreset: 'classic', twoInARowMode: false },
    });
    const afterBreakSeconds = getProjectedTaskFinishSeconds({
      remainingPomodoros: 3,
      pomodoroCount: 1,
      workTime: TIMER_PRESETS.classic.workDuration,
      breakTime: 0,
      activeMode: 'work',
      isIdle: false,
      graceOpen: false,
      graceContext: null,
      settings: { ...TIMER_PRESETS.classic, timerPreset: 'classic', twoInARowMode: false },
    });

    expect(beforeBreakSeconds - twoMinutesIntoBreakSeconds).toBe(2 * 60);
    expect(beforeBreakSeconds - afterBreakSeconds).toBe(5 * 60);
  });

  it('lets negative break debt move the finish later instead of offsetting future rewards', () => {
    expect(getProjectedTaskFinishSeconds({
      remainingPomodoros: 3,
      pomodoroCount: 1,
      workTime: TIMER_PRESETS.classic.workDuration,
      breakTime: -2 * 60,
      activeMode: 'break',
      isIdle: false,
      graceOpen: false,
      graceContext: null,
      settings: { ...TIMER_PRESETS.classic, timerPreset: 'classic', twoInARowMode: false },
    })).toBe((3 * 25 + 5 + 5 + 15) * 60);
  });

  it('uses the running-work runtime break bank when completing an auto-started compact pair', () => {
    const runtime = createRuntimeSnapshot({
      sourceTabId: TAB_ID,
      phase: 'running-work',
      nowMs: BASE_NOW,
      workTime: TIMER_PRESETS.compact.workDuration,
      breakTime: TIMER_PRESETS.compact.shortBreakDuration,
      allPauseTime: 0,
      graceTotal: 0,
    });
    const baseBreakBank = getBreakBankBaseForWorkCompletion({
      breakTime: 0,
      runtimeSnapshot: runtime,
      nowMs: BASE_NOW + 30_000,
    });
    const result = computeWorkCompletion(1, baseBreakBank, TIMER_PRESETS.compact);

    expect(baseBreakBank).toBe(180);
    expect(result.reward).toBe(180);
    expect(result.nextBreakTime).toBe(360);
  });

  it('auto-starts only the first completed pomodoro in each compact two-in-a-row pair', () => {
    const compactTwoInARow = { timerPreset: 'compact' as const, twoInARowMode: true };

    expect(shouldAutoStartTwoInARowFocus(0, compactTwoInARow)).toBe(false);
    expect(shouldAutoStartTwoInARowFocus(1, compactTwoInARow)).toBe(true);
    expect(shouldAutoStartTwoInARowFocus(2, compactTwoInARow)).toBe(false);
    expect(shouldAutoStartTwoInARowFocus(3, compactTwoInARow)).toBe(true);
    expect(shouldAutoStartTwoInARowFocus(4, compactTwoInARow)).toBe(false);
    expect(shouldAutoStartTwoInARowFocus(5, compactTwoInARow)).toBe(true);
  });

  it('keeps two-in-a-row disabled outside the compact preset', () => {
    expect(shouldAutoStartTwoInARowFocus(1, { timerPreset: 'classic', twoInARowMode: true })).toBe(false);
    expect(shouldAutoStartTwoInARowFocus(1, { timerPreset: 'compact', twoInARowMode: false })).toBe(false);
    expect(shouldAutoStartTwoInARowFocus(1, { timerPreset: 'focus', twoInARowMode: true })).toBe(false);
    expect(shouldAutoStartTwoInARowFocus(1, { timerPreset: 'custom', twoInARowMode: true })).toBe(false);
  });

  it('recovers the earned break bank from after-work grace when state is stale', () => {
    const runtime = createRuntimeSnapshot({
      sourceTabId: TAB_ID,
      phase: 'grace',
      nowMs: BASE_NOW,
      workTime: 0,
      breakTime: 300,
      allPauseTime: 0,
      graceTotal: 8,
    });

    expect(resolveGraceBreakBank({
      breakTime: 0,
      graceContext: 'afterWork',
      runtimeSnapshot: runtime,
    })).toEqual({
      baseBreakTime: 300,
      nextBreakTime: 300,
    });
  });

  it('applies grace adjustments against the authoritative after-work break bank', () => {
    const runtime = createRuntimeSnapshot({
      sourceTabId: TAB_ID,
      phase: 'grace',
      nowMs: BASE_NOW,
      workTime: 0,
      breakTime: 300,
      allPauseTime: 0,
      graceTotal: 45,
    });

    expect(resolveGraceBreakBank({
      breakTime: 0,
      graceContext: 'afterWork',
      runtimeSnapshot: runtime,
      adjustBreakBalance: 45,
    })).toEqual({
      baseBreakTime: 300,
      nextBreakTime: 255,
    });
  });

  it('keeps break continuation at zero when no earned bank should be restored', () => {
    const runtime = createRuntimeSnapshot({
      sourceTabId: TAB_ID,
      phase: 'grace',
      nowMs: BASE_NOW,
      workTime: 1500,
      breakTime: 0,
      allPauseTime: 0,
      graceTotal: 20,
    });

    expect(resolveGraceBreakBank({
      breakTime: 0,
      graceContext: 'afterBreak',
      runtimeSnapshot: runtime,
    })).toEqual({
      baseBreakTime: 0,
      nextBreakTime: 0,
    });
  });

  it('keeps pause compensation formulas exact', () => {
    const pause = getPauseCompensation(100);
    expect(pause.addToBankAmount).toBe(20);
    expect(pause.deductFromBankAmount).toBe(100);
  });

  it('keeps grace compensation formulas exact', () => {
    const grace = getGraceCompensation(75);
    expect(grace.addToBankAmount).toBe(15);
    expect(grace.deductFromBankAmount).toBe(75);
  });
});
