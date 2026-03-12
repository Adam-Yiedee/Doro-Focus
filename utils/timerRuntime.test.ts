import { describe, expect, it } from 'vitest';
import {
  computeWorkCompletion,
  createRuntimeSnapshot,
  deriveRuntimeValues,
  detectRuntimeBoundaryCrossing,
  getCompletedPhaseDuration,
  getTimerStateFreshnessStamp,
  getGraceCompensation,
  getPauseCompensation,
  normalizeGraceWindow,
  shouldApplyIncomingRuntime,
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

  it('discards restored grace when the persisted grace snapshot is stale', () => {
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
    })).toBe(true);
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
