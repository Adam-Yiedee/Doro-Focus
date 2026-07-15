import { describe, expect, it } from 'vitest';
import {
  getAccountStatsPomodoroEquivalent,
  getAccountStatsSessionPomodoroEquivalent,
  getPomodoroCompletionStatsFromLogs,
  MINI_POMODORO_COMPLETE_REASON,
  POMODORO_COMPLETE_REASON,
} from './pomodoroAccounting';

describe('pomodoro accounting', () => {
  it('counts mini-pomos as half standard equivalents for timer display accounting', () => {
    const stats = getPomodoroCompletionStatsFromLogs([
      { type: 'work', reason: MINI_POMODORO_COMPLETE_REASON },
      { type: 'work', reason: MINI_POMODORO_COMPLETE_REASON },
      { type: 'work', reason: MINI_POMODORO_COMPLETE_REASON },
      { type: 'work', reason: MINI_POMODORO_COMPLETE_REASON },
    ]);

    expect(stats.completedLogs).toBe(4);
    expect(stats.standardPomosCompleted).toBe(2);
    expect(stats.miniPomosCompleted).toBe(4);
  });

  it('keeps mixed sessions as standard-equivalent pomos instead of mini-only labels', () => {
    const stats = getPomodoroCompletionStatsFromLogs([
      { type: 'work', reason: POMODORO_COMPLETE_REASON },
      { type: 'work', reason: MINI_POMODORO_COMPLETE_REASON },
      { type: 'work', reason: MINI_POMODORO_COMPLETE_REASON },
      { type: 'break', reason: MINI_POMODORO_COMPLETE_REASON },
    ]);

    expect(stats.completedLogs).toBe(3);
    expect(stats.standardPomosCompleted).toBe(2);
    expect(stats.miniPomosCompleted).toBeUndefined();
  });

  it('converts mini-pomo account statistics from actual worked minutes', () => {
    expect(getAccountStatsPomodoroEquivalent({
      type: 'work',
      reason: MINI_POMODORO_COMPLETE_REASON,
      duration: 900,
    })).toBeCloseTo(0.6, 5);

    expect(getAccountStatsSessionPomodoroEquivalent({
      id: 'mini-session',
      startTime: '2026-03-12T09:00:00.000Z',
      endTime: '2026-03-12T12:00:00.000Z',
      stats: {
        totalWorkMinutes: 165,
        totalBreakMinutes: 0,
        pomosCompleted: 5.5,
        miniPomosCompleted: 11,
        tasksCompleted: 0,
      },
    })).toBeCloseTo(6.6, 5);
  });

  it('converts manually logged focus minutes into account pomodoro equivalents', () => {
    expect(getAccountStatsPomodoroEquivalent({
      type: 'work',
      reason: 'Manual Focus',
      source: 'manual',
      duration: 7200,
    })).toBeCloseTo(4.8, 5);
  });
});
