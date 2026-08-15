import { describe, expect, it } from 'vitest';
import {
  convertTaskPomodoroUnits,
  getAccountStatsPomodoroEquivalent,
  getAccountStatsFocusSeconds,
  getAccountStatsSessionPomodoroEquivalent,
  getPomodoroCompletionStatsFromLogs,
  MINI_POMODORO_COMPLETE_REASON,
  POMODORO_COMPLETE_REASON,
} from './pomodoroAccounting';
import type { Task } from '../types';

const createTask = (overrides: Partial<Task> = {}): Task => ({
  id: 1,
  name: 'Task',
  estimated: 4,
  completed: 1,
  checked: false,
  selected: true,
  categoryId: null,
  subtasks: [],
  ...overrides,
});

describe('pomodoro accounting', () => {
  it('doubles task estimates and progress when switching from pomos to mini-pomos', () => {
    const tasks = [createTask({
      subtasks: [createTask({ id: 2, estimated: 1.5, completed: 0.5, selected: false })],
    })];

    const converted = convertTaskPomodoroUnits(tasks, { timerPreset: 'classic' }, { timerPreset: 'compact' });

    expect(converted[0]).toMatchObject({ estimated: 8, completed: 2 });
    expect(converted[0].subtasks[0]).toMatchObject({ estimated: 3, completed: 1 });
  });

  it('converts odd mini-pomo task counts to exact half-pomos in traditional and unstructured modes', () => {
    const tasks = [createTask({ estimated: 3, completed: 1 })];

    const traditional = convertTaskPomodoroUnits(tasks, { timerPreset: 'compact' }, { timerPreset: 'classic' });
    const unstructured = convertTaskPomodoroUnits(tasks, { timerPreset: 'compact' }, { timerPreset: 'focus' });

    expect(traditional[0]).toMatchObject({ estimated: 1.5, completed: 0.5 });
    expect(unstructured[0]).toMatchObject({ estimated: 1.5, completed: 0.5 });
  });

  it('keeps task units unchanged between traditional and unstructured modes', () => {
    const tasks = [createTask()];

    expect(convertTaskPomodoroUnits(tasks, { timerPreset: 'classic' }, { timerPreset: 'focus' })).toBe(tasks);
    expect(convertTaskPomodoroUnits(tasks, { timerPreset: 'focus' }, { timerPreset: 'classic' })).toBe(tasks);
  });

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

  it('converts account pomodoros from credited focus time', () => {
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

  it('uses the mini-pomo preset duration for completed mini-pomo focus time', () => {
    expect(getAccountStatsFocusSeconds({
      type: 'work',
      reason: MINI_POMODORO_COMPLETE_REASON,
      duration: 13 * 60,
    })).toBe(15 * 60);

    expect(getAccountStatsFocusSeconds({
      type: 'work',
      reason: 'Manual Focus',
      source: 'manual',
      duration: 13 * 60,
    })).toBe(13 * 60);
  });

  it('converts archived account session pomodoros from total work minutes', () => {
    expect(getAccountStatsSessionPomodoroEquivalent({
      id: 'archived-session',
      startTime: '2026-03-12T09:00:00.000Z',
      endTime: '2026-03-12T13:00:00.000Z',
      stats: {
        totalWorkMinutes: 240,
        totalBreakMinutes: 0,
        pomosCompleted: 6.1,
        tasksCompleted: 0,
      },
    })).toBeCloseTo(9.6, 5);
  });

  it('converts account pomodoros from any productive logged work minutes', () => {
    expect(getAccountStatsPomodoroEquivalent({
      type: 'work',
      reason: 'Session End',
      duration: 240 * 60,
    })).toBeCloseTo(9.6, 5);

    expect(getAccountStatsPomodoroEquivalent({
      type: 'work',
      reason: POMODORO_COMPLETE_REASON,
      duration: 30 * 60,
    })).toBeCloseTo(1.2, 5);
  });

  it('converts manually logged focus minutes into account pomodoro equivalents', () => {
    expect(getAccountStatsPomodoroEquivalent({
      type: 'work',
      reason: 'Manual Focus',
      source: 'manual',
      duration: 7200,
    })).toBeCloseTo(4.8, 5);
  });

  it('does not count pause-credit work logs in account pomodoro totals', () => {
    expect(getAccountStatsPomodoroEquivalent({
      type: 'work',
      reason: 'Paused session (Pause Credit: Working)',
      duration: 25 * 60,
    })).toBe(0);
  });

  it('counts grace marked as working as productive account time only', () => {
    expect(getAccountStatsPomodoroEquivalent({
      type: 'grace',
      reason: 'Grace Period (Working)',
      duration: 5 * 60,
    })).toBeCloseTo(0.2, 5);

    expect(getAccountStatsPomodoroEquivalent({
      type: 'grace',
      reason: 'Grace Period',
      duration: 5 * 60,
    })).toBe(0);

    expect(getAccountStatsPomodoroEquivalent({
      type: 'grace',
      reason: 'Grace Period (Resting)',
      duration: 5 * 60,
    })).toBe(0);
  });
});
