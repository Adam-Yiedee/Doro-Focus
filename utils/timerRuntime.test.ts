import { describe, expect, it } from 'vitest';
import {
  computeWorkCompletion,
  createRuntimeSnapshot,
  deriveRuntimeValues,
  detectRuntimeBoundaryCrossing,
  getGraceCompensation,
  getPauseCompensation,
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

  it('crosses break boundary once and reports overflow only', () => {
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
