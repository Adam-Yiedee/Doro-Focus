import { describe, expect, it } from 'vitest';
import { Category, LogEntry, SessionRecord } from '../types';
import { calculateLifetimeStatsFromData } from './lifetimeStats';

const categories: Category[] = [
  { id: 1, name: 'Writing', color: '#C86D80', icon: 'pen' },
  { id: 2, name: 'Study', color: '#4FAE9B', icon: 'book' },
];

const makeLog = ({
  type = 'work',
  start,
  end,
  reason = '',
  categoryId = null,
  categoryName,
}: {
  type?: LogEntry['type'];
  start: string;
  end: string;
  reason?: string;
  categoryId?: number | null;
  categoryName?: string;
}): LogEntry => ({
  type,
  start,
  end,
  duration: Math.max(0, (Date.parse(end) - Date.parse(start)) / 1000),
  reason,
  task: null,
  color: undefined,
  categoryId,
  categoryName,
});

describe('calculateLifetimeStatsFromData', () => {
  it('counts completed pomodoros directly from logs when sessions are not archived yet', () => {
    const stats = calculateLifetimeStatsFromData([], [
      makeLog({
        start: '2026-03-12T09:00:00.000Z',
        end: '2026-03-12T09:25:00.000Z',
        reason: 'Pomodoro Complete',
        categoryId: 1,
      }),
    ], categories);

    expect(stats.totalFocusHours).toBeCloseTo(25 / 60, 5);
    expect(stats.totalPomos).toBe(1);
    expect(stats.totalSessions).toBe(0);
    expect(stats.activeDays).toBe(1);
    expect(stats.categoryBreakdown).toEqual({ Writing: 25 });
  });

  it('falls back to archived session totals when completed pomodoro logs are unavailable', () => {
    const sessions: SessionRecord[] = [
      {
        id: 'session-1',
        startTime: '2026-03-10T08:00:00.000Z',
        endTime: '2026-03-10T09:30:00.000Z',
        stats: {
          totalWorkMinutes: 75,
          totalBreakMinutes: 15,
          pomosCompleted: 3,
          tasksCompleted: 0,
          categoryStats: { Study: 75 },
        },
      },
    ];

    const stats = calculateLifetimeStatsFromData(sessions, [], categories);

    expect(stats.totalFocusHours).toBeCloseTo(75 / 60, 5);
    expect(stats.totalPomos).toBe(3);
    expect(stats.totalSessions).toBe(1);
    expect(stats.categoryBreakdown).toEqual({ Study: 75 });
  });

  it('merges legacy session days with newer log-backed days without double-counting overlapping dates', () => {
    const sessions: SessionRecord[] = [
      {
        id: 'session-1',
        startTime: '2026-03-10T08:00:00.000Z',
        endTime: '2026-03-10T09:00:00.000Z',
        stats: {
          totalWorkMinutes: 50,
          totalBreakMinutes: 10,
          pomosCompleted: 2,
          tasksCompleted: 0,
          categoryStats: { Study: 50 },
        },
      },
      {
        id: 'session-2',
        startTime: '2026-03-12T08:00:00.000Z',
        endTime: '2026-03-12T08:45:00.000Z',
        stats: {
          totalWorkMinutes: 30,
          totalBreakMinutes: 5,
          pomosCompleted: 1,
          tasksCompleted: 0,
          categoryStats: { Writing: 30 },
        },
      },
    ];

    const stats = calculateLifetimeStatsFromData(sessions, [
      makeLog({
        start: '2026-03-12T09:00:00.000Z',
        end: '2026-03-12T09:25:00.000Z',
        reason: 'Pomodoro Complete',
        categoryId: 1,
      }),
    ], categories);

    expect(stats.totalFocusHours).toBeCloseTo(75 / 60, 5);
    expect(stats.totalPomos).toBe(3);
    expect(stats.totalSessions).toBe(2);
    expect(stats.activeDays).toBe(2);
    expect(stats.categoryBreakdown).toEqual({
      Study: 50,
      Writing: 25,
    });
  });

  it('ignores pause-credit work logs when rebuilding lifetime stats', () => {
    const stats = calculateLifetimeStatsFromData([], [
      makeLog({
        start: '2026-03-12T10:00:00.000Z',
        end: '2026-03-12T10:10:00.000Z',
        reason: 'Paused session (Pause Credit: Working)',
        categoryId: 2,
      }),
      makeLog({
        start: '2026-03-12T10:15:00.000Z',
        end: '2026-03-12T10:40:00.000Z',
        reason: 'Pomodoro Complete',
        categoryId: 2,
      }),
    ], categories);

    expect(stats.totalFocusHours).toBeCloseTo(25 / 60, 5);
    expect(stats.totalPomos).toBe(1);
    expect(stats.categoryBreakdown).toEqual({ Study: 25 });
  });

  it('falls back to the saved category snapshot when a category no longer exists', () => {
    const stats = calculateLifetimeStatsFromData([], [
      makeLog({
        start: '2026-03-12T09:00:00.000Z',
        end: '2026-03-12T09:25:00.000Z',
        reason: 'Pomodoro Complete',
        categoryId: 99,
        categoryName: 'Archived Reading',
      }),
    ], categories);

    expect(stats.categoryBreakdown).toEqual({ 'Archived Reading': 25 });
  });

  it('prefers the live category name over an older saved snapshot when the category still exists', () => {
    const renamedCategories: Category[] = [
      { id: 1, name: 'Deep Writing', color: '#C86D80', icon: 'pen' },
    ];

    const stats = calculateLifetimeStatsFromData([], [
      makeLog({
        start: '2026-03-12T09:00:00.000Z',
        end: '2026-03-12T09:25:00.000Z',
        reason: 'Pomodoro Complete',
        categoryId: 1,
        categoryName: 'Writing',
      }),
    ], renamedCategories);

    expect(stats.categoryBreakdown).toEqual({ 'Deep Writing': 25 });
  });
});
