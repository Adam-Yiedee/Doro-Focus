import { describe, expect, it } from 'vitest';
import { TimerSpectatorState } from '../types';
import { getTimerShareEstimateFromSpectatorState } from './timerShare';

describe('getTimerShareEstimateFromSpectatorState', () => {
  it('uses the running break runtime to count down the remote break bank', () => {
    const startMs = 1_700_000_000_000;
    const state: TimerSpectatorState = {
      version: 1,
      hostName: 'Master 2',
      activeMode: 'work',
      timerStarted: true,
      isIdle: false,
      workTime: 1200,
      breakTime: 999,
      pomodoroCount: 5,
      allPauseActive: false,
      allPauseTime: 0,
      graceOpen: false,
      graceContext: null,
      activeTaskName: 'Biology',
      activeCategoryName: 'Science',
      activeCategoryColor: '#4FAE9B',
      activeColor: '#4FAE9B',
      projectedFinishEndMs: null,
      settings: {
        workDuration: 1500,
        shortBreakDuration: 300,
        longBreakDuration: 900,
        longBreakInterval: 4,
        timerPreset: 'classic',
        twoInARowMode: false,
      },
      runtime: {
        version: 2,
        updatedAtMs: startMs,
        sourceTabId: 'friend-break',
        phase: 'running-break',
        phaseStartedAtMs: startMs,
        phaseStartWorkTime: 1200,
        phaseStartBreakTime: 300,
        phaseStartAllPauseTime: 0,
        phaseStartGraceTotal: 0,
        activityStartIso: new Date(startMs).toISOString(),
      },
      updatedAtMs: startMs,
    };

    const estimate = getTimerShareEstimateFromSpectatorState(state, startMs + 45_000);

    expect(estimate.status).toBe('running');
    expect(estimate.remainingSeconds).toBeCloseTo(255, 5);
  });
});
