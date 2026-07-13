import { describe, expect, it } from 'vitest';
import {
  getPomodoroCompletionStatsFromLogs,
  MINI_POMODORO_COMPLETE_REASON,
  POMODORO_COMPLETE_REASON,
} from './pomodoroAccounting';

describe('pomodoro accounting', () => {
  it('counts two mini-pomos as one standard pomo equivalent', () => {
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
});
