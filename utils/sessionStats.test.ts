import { describe, expect, it } from 'vitest';
import { Category, LogEntry } from '../types';
import {
  buildEndSessionStats,
  getEndSessionPendingActivityWindow,
  getSessionTaskCompletionIdsFromLogs,
} from './sessionStats';

const categories: Category[] = [
  { id: 1, name: 'Deep Work', color: '#D79EDE', icon: 'brain' },
  { id: 2, name: 'Admin', color: '#9ECBDE', icon: 'list' },
];

const makeLog = (overrides: Partial<LogEntry>): LogEntry => ({
  type: 'work',
  start: '2026-07-18T09:00:00.000Z',
  end: '2026-07-18T09:25:00.000Z',
  duration: 25 * 60,
  source: 'timer',
  ...overrides,
});

describe('getEndSessionPendingActivityWindow', () => {
  it('caps active time at the pause start when a paused session is ended', () => {
    const window = getEndSessionPendingActivityWindow({
      isIdle: false,
      timerStarted: false,
      activityStartMs: Date.parse('2026-07-18T09:30:00.000Z'),
      effectiveEndMs: Date.parse('2026-07-18T10:10:00.000Z'),
      allPauseActive: true,
      allPauseStartTime: Date.parse('2026-07-18T09:40:00.000Z'),
    });

    expect(window).toEqual({
      startMs: Date.parse('2026-07-18T09:30:00.000Z'),
      endMs: Date.parse('2026-07-18T09:40:00.000Z'),
      durationSeconds: 10 * 60,
    });
  });

  it('uses the effective end while the timer is actively running', () => {
    const window = getEndSessionPendingActivityWindow({
      isIdle: false,
      timerStarted: true,
      activityStartMs: Date.parse('2026-07-18T09:30:00.000Z'),
      effectiveEndMs: Date.parse('2026-07-18T09:45:00.000Z'),
      allPauseActive: false,
      allPauseStartTime: null,
    });

    expect(window?.durationSeconds).toBe(15 * 60);
  });

  it('does not count time after a timer has been stopped outside all-pause', () => {
    const window = getEndSessionPendingActivityWindow({
      isIdle: false,
      timerStarted: false,
      activityStartMs: Date.parse('2026-07-18T09:30:00.000Z'),
      effectiveEndMs: Date.parse('2026-07-18T09:45:00.000Z'),
      allPauseActive: false,
      allPauseStartTime: null,
    });

    expect(window).toBeNull();
  });
});

describe('buildEndSessionStats', () => {
  it('only counts timer logs from the current session and adds capped pending work', () => {
    const logs: LogEntry[] = [
      makeLog({
        start: '2026-07-18T09:05:00.000Z',
        end: '2026-07-18T09:30:00.000Z',
        duration: 25 * 60,
        reason: 'Pomodoro Complete',
        categoryId: 1,
      }),
      makeLog({
        type: 'break',
        start: '2026-07-18T09:30:00.000Z',
        end: '2026-07-18T09:35:00.000Z',
        duration: 5 * 60,
      }),
      makeLog({
        start: '2026-07-18T09:35:00.000Z',
        end: '2026-07-18T09:45:00.000Z',
        duration: 10 * 60,
        source: 'manual',
        categoryId: 2,
      }),
      makeLog({
        start: '2026-07-18T09:45:00.000Z',
        end: '2026-07-18T09:47:00.000Z',
        duration: 2 * 60,
        reason: 'Paused Time I Was Working',
        categoryId: 2,
      }),
      makeLog({
        start: '2026-07-18T08:00:00.000Z',
        end: '2026-07-18T08:25:00.000Z',
        duration: 25 * 60,
        reason: 'Pomodoro Complete',
        categoryId: 2,
      }),
    ];

    const stats = buildEndSessionStats({
      logs,
      sessionStartTime: '2026-07-18T09:00:00.000Z',
      categories,
      pendingActivity: {
        mode: 'work',
        durationSeconds: 10 * 60,
        categoryId: 2,
        categoryName: 'Admin',
        categoryColor: '#9ECBDE',
        categoryIcon: 'list',
      },
      pomodoroCount: 4,
      settings: { timerPreset: 'classic' },
      tasksCompleted: 3,
    });

    expect(stats.totalWorkMinutes).toBe(35);
    expect(stats.totalBreakMinutes).toBe(5);
    expect(stats.tasksCompleted).toBe(3);
    expect(stats.pomosCompleted).toBe(1);
    expect(stats.categoryStats).toEqual({
      'Deep Work': 25,
      Admin: 10,
    });
  });

  it('falls back to current compact timer pomos when no completion logs exist', () => {
    const stats = buildEndSessionStats({
      logs: [],
      sessionStartTime: '2026-07-18T09:00:00.000Z',
      categories,
      pomodoroCount: 3,
      settings: { timerPreset: 'compact' },
      tasksCompleted: 0,
    });

    expect(stats.pomosCompleted).toBe(1.5);
    expect(stats.miniPomosCompleted).toBe(3);
  });

  it('keeps work logged before a pause when resumed work is pending', () => {
    const stats = buildEndSessionStats({
      logs: [
        makeLog({
          start: '2026-07-18T09:00:00.000Z',
          end: '2026-07-18T09:12:00.000Z',
          duration: 12 * 60,
          reason: 'Timer Paused',
          categoryId: 1,
        }),
        makeLog({
          type: 'allpause',
          start: '2026-07-18T09:12:00.000Z',
          end: '2026-07-18T09:20:00.000Z',
          duration: 8 * 60,
          reason: 'Paused',
        }),
      ],
      sessionStartTime: '2026-07-18T09:00:00.000Z',
      categories,
      pendingActivity: {
        mode: 'work',
        durationSeconds: 9 * 60,
        categoryId: 1,
      },
      pomodoroCount: 0,
      settings: { timerPreset: 'classic' },
      tasksCompleted: 0,
    });

    expect(stats.totalWorkMinutes).toBe(21);
    expect(stats.totalBreakMinutes).toBe(0);
    expect(stats.categoryStats).toEqual({ 'Deep Work': 21 });
  });

  it('does not count timer logs after the session end snapshot', () => {
    const stats = buildEndSessionStats({
      logs: [
        makeLog({
          start: '2026-07-18T09:05:00.000Z',
          end: '2026-07-18T09:30:00.000Z',
          duration: 25 * 60,
          categoryId: 1,
        }),
        makeLog({
          start: '2026-07-18T10:05:00.000Z',
          end: '2026-07-18T10:30:00.000Z',
          duration: 25 * 60,
          categoryId: 2,
        }),
      ],
      sessionStartTime: '2026-07-18T09:00:00.000Z',
      sessionEndTime: '2026-07-18T09:45:00.000Z',
      categories,
      pomodoroCount: 0,
      settings: { timerPreset: 'classic' },
      tasksCompleted: 0,
    });

    expect(stats.totalWorkMinutes).toBe(25);
    expect(stats.categoryStats).toEqual({ 'Deep Work': 25 });
  });

  it('finds unique task completions inside the session window only', () => {
    const completionIds = getSessionTaskCompletionIdsFromLogs([
      makeLog({
        type: 'task-complete',
        start: '2026-07-18T09:10:00.000Z',
        end: '2026-07-18T09:10:00.000Z',
        duration: 0,
        task: { id: 17, name: 'Draft' },
      }),
      makeLog({
        type: 'task-complete',
        start: '2026-07-18T09:12:00.000Z',
        end: '2026-07-18T09:12:00.000Z',
        duration: 0,
        task: { id: 17, name: 'Draft again' },
      }),
      makeLog({
        type: 'task-complete',
        start: '2026-07-18T10:05:00.000Z',
        end: '2026-07-18T10:05:00.000Z',
        duration: 0,
        task: { id: 18, name: 'Future task' },
      }),
      makeLog({
        type: 'task-complete',
        start: '2026-07-18T08:55:00.000Z',
        end: '2026-07-18T08:55:00.000Z',
        duration: 0,
        task: { id: 19, name: 'Old task' },
      }),
    ], '2026-07-18T09:00:00.000Z', '2026-07-18T09:45:00.000Z');

    expect(Array.from(completionIds)).toEqual([17]);
  });
});
