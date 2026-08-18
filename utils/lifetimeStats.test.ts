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
  source,
  duration,
}: {
  type?: LogEntry['type'];
  start: string;
  end: string;
  reason?: string;
  categoryId?: number | null;
  categoryName?: string;
  source?: LogEntry['source'];
  duration?: number;
}): LogEntry => ({
  type,
  start,
  end,
  duration: duration ?? Math.max(0, (Date.parse(end) - Date.parse(start)) / 1000),
  reason,
  source,
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
    expect(stats.totalSessionHours).toBeCloseTo(25 / 60, 5);
    expect(stats.totalPomos).toBe(1);
    expect(stats.totalSessions).toBe(0);
    expect(stats.manualFocusHours).toBe(0);
    expect(stats.activeDays).toBe(1);
    expect(stats.categoryBreakdown).toEqual({ Writing: 25 });
  });

  it('counts grace marked as working in lifetime focus totals and categories', () => {
    const stats = calculateLifetimeStatsFromData([], [
      makeLog({
        start: '2026-03-12T09:00:00.000Z',
        end: '2026-03-12T09:25:00.000Z',
        reason: 'Pomodoro Complete',
        categoryId: 1,
      }),
      makeLog({
        type: 'grace',
        start: '2026-03-12T09:25:00.000Z',
        end: '2026-03-12T09:32:00.000Z',
        reason: 'Grace Period (Working)',
        categoryId: 1,
      }),
      makeLog({
        type: 'grace',
        start: '2026-03-12T09:32:00.000Z',
        end: '2026-03-12T09:35:00.000Z',
        reason: 'Grace Period',
        categoryId: 1,
      }),
    ], categories);

    expect(stats.totalFocusHours).toBeCloseTo(32 / 60, 5);
    expect(stats.totalSessionHours).toBeCloseTo(32 / 60, 5);
    expect(stats.totalPomos).toBeCloseTo(32 / 25, 5);
    expect(stats.activeDays).toBe(1);
    expect(stats.categoryBreakdown).toEqual({ Writing: 32 });
  });

  it('keeps focus time separate from total session time that includes breaks', () => {
    const stats = calculateLifetimeStatsFromData([], [
      makeLog({
        start: '2026-03-12T09:00:00.000Z',
        end: '2026-03-12T09:25:00.000Z',
        reason: 'Pomodoro Complete',
        categoryId: 1,
      }),
      makeLog({
        type: 'break',
        start: '2026-03-12T09:25:00.000Z',
        end: '2026-03-12T09:35:00.000Z',
        reason: 'Break Complete',
      }),
      makeLog({
        type: 'allpause',
        start: '2026-03-12T09:35:00.000Z',
        end: '2026-03-12T09:50:00.000Z',
        reason: 'Paused',
      }),
      makeLog({
        start: '2026-03-12T10:00:00.000Z',
        end: '2026-03-12T10:30:00.000Z',
        reason: 'Manual Focus',
        source: 'manual',
        categoryId: 2,
      }),
    ], categories);

    expect(stats.totalFocusHours).toBeCloseTo(55 / 60, 5);
    expect(stats.totalSessionHours).toBeCloseTo(35 / 60, 5);
    expect(stats.manualFocusHours).toBeCloseTo(30 / 60, 5);
  });

  it('tracks manually logged focus as focus time, manual focus, and standard pomos', () => {
    const stats = calculateLifetimeStatsFromData([], [
      makeLog({
        start: '2026-03-12T09:00:00.000Z',
        end: '2026-03-12T11:00:00.000Z',
        reason: 'Pomodoro Complete',
        source: 'manual',
        categoryId: 1,
      }),
    ], categories);

    expect(stats.totalFocusHours).toBeCloseTo(2, 5);
    expect(stats.manualFocusHours).toBeCloseTo(2, 5);
    expect(stats.totalPomos).toBeCloseTo(4.8, 5);
    expect(stats.activeDays).toBe(1);
    expect(stats.categoryBreakdown).toEqual({ Writing: 120 });
  });

  it('converts completed mini-pomodoro focus time to standard pomodoros from logs', () => {
    const stats = calculateLifetimeStatsFromData([], [
      makeLog({
        start: '2026-03-12T09:00:00.000Z',
        end: '2026-03-12T09:15:00.000Z',
        reason: 'Mini-Pomodoro Complete',
        categoryId: 1,
      }),
      makeLog({
        start: '2026-03-12T09:18:00.000Z',
        end: '2026-03-12T09:33:00.000Z',
        reason: 'Mini-Pomodoro Complete',
        categoryId: 1,
      }),
      makeLog({
        start: '2026-03-12T09:36:00.000Z',
        end: '2026-03-12T09:51:00.000Z',
        reason: 'Mini-Pomodoro Complete',
        categoryId: 1,
      }),
      makeLog({
        start: '2026-03-12T09:54:00.000Z',
        end: '2026-03-12T10:09:00.000Z',
        reason: 'Mini-Pomodoro Complete',
        categoryId: 1,
      }),
    ], categories);

    expect(stats.totalFocusHours).toBeCloseTo(60 / 60, 5);
    expect(stats.totalPomos).toBeCloseTo(2.4, 5);
    expect(stats.categoryBreakdown).toEqual({ Writing: 60 });
  });

  it('uses canonical mini-pomo focus minutes when completed mini logs have short saved durations', () => {
    const sessionStartMs = Date.parse('2026-03-12T09:00:00.000Z');
    const logs: LogEntry[] = Array.from({ length: 16 }, (_, index) => {
      const start = new Date(sessionStartMs + index * 15 * 60_000);
      const end = new Date(start.getTime() + 15 * 60_000);
      return makeLog({
        start: start.toISOString(),
        end: end.toISOString(),
        duration: 13.875 * 60,
        reason: 'Mini-Pomodoro Complete',
        categoryId: 2,
      });
    });

    const stats = calculateLifetimeStatsFromData([], logs, categories);

    expect(stats.totalFocusHours).toBeCloseTo(4, 5);
    expect(stats.totalPomos).toBeCloseTo(9.6, 5);
    expect(stats.categoryBreakdown).toEqual({ Study: 240 });
  });

  it('prefers raw same-day focus logs over larger archived compact session totals', () => {
    const sessionStartMs = Date.parse('2026-03-12T09:00:00.000Z');
    const logs: LogEntry[] = Array.from({ length: 15 }, (_, index) => {
      const start = new Date(sessionStartMs + index * 15 * 60_000);
      const end = new Date(start.getTime() + 15 * 60_000);
      return makeLog({
        start: start.toISOString(),
        end: end.toISOString(),
        reason: 'Mini-Pomodoro Complete',
        categoryId: 2,
      });
    });
    const sessions: SessionRecord[] = [
      {
        id: 'compact-session-16',
        startTime: '2026-03-12T09:00:00.000Z',
        endTime: '2026-03-12T13:00:00.000Z',
        stats: {
          totalWorkMinutes: 240,
          totalBreakMinutes: 0,
          pomosCompleted: 8,
          miniPomosCompleted: 16,
          tasksCompleted: 0,
          categoryStats: { Study: 240 },
          categoryDetails: [
            {
              categoryId: 2,
              categoryName: 'Study',
              categoryColor: '#4FAE9B',
              categoryIcon: 'book',
              minutes: 240,
            },
          ],
        },
      },
    ];

    const stats = calculateLifetimeStatsFromData(sessions, logs, categories);

    expect(stats.totalFocusHours).toBeCloseTo(225 / 60, 5);
    expect(stats.totalPomos).toBeCloseTo(9, 5);
    expect(stats.categoryBreakdown).toEqual({ Study: 225 });
  });

  it('keeps partial session-end work minute pomos while counting completed minis by unit', () => {
    const stats = calculateLifetimeStatsFromData([], [
      makeLog({
        start: '2026-03-12T09:00:00.000Z',
        end: '2026-03-12T09:15:00.000Z',
        reason: 'Mini-Pomodoro Complete',
        categoryId: 1,
      }),
      makeLog({
        start: '2026-03-12T09:18:00.000Z',
        end: '2026-03-12T09:33:00.000Z',
        reason: 'Mini-Pomodoro Complete',
        categoryId: 1,
      }),
      makeLog({
        start: '2026-03-12T09:36:00.000Z',
        end: '2026-03-12T10:36:00.000Z',
        reason: 'Session End',
        categoryId: 1,
      }),
      makeLog({
        start: '2026-03-12T11:00:00.000Z',
        end: '2026-03-12T13:30:00.000Z',
        reason: 'Session End',
        categoryId: 1,
      }),
    ], categories);

    expect(stats.totalFocusHours).toBeCloseTo(4, 5);
    expect(stats.totalPomos).toBeCloseTo(9.6, 5);
    expect(stats.categoryBreakdown).toEqual({ Writing: 240 });
  });

  it('counts session-end partial pomodoros in account statistics', () => {
    const stats = calculateLifetimeStatsFromData([], [
      makeLog({
        start: '2026-03-12T09:00:00.000Z',
        end: '2026-03-12T09:12:30.000Z',
        reason: 'Session End',
        categoryId: 1,
      }),
    ], categories);

    expect(stats.totalFocusHours).toBeCloseTo(12.5 / 60, 5);
    expect(stats.totalPomos).toBeCloseTo(0.5, 5);
    expect(stats.categoryBreakdown).toEqual({ Writing: 12.5 });
  });

  it('converts archived mini-pomodoro session focus minutes to standard pomodoros', () => {
    const sessions: SessionRecord[] = [
      {
        id: 'mini-session-1',
        startTime: '2026-03-10T08:00:00.000Z',
        endTime: '2026-03-10T09:12:00.000Z',
        stats: {
          totalWorkMinutes: 60,
          totalBreakMinutes: 12,
          pomosCompleted: 2,
          miniPomosCompleted: 4,
          tasksCompleted: 0,
          categoryStats: { Study: 60 },
        },
      },
    ];

    const stats = calculateLifetimeStatsFromData(sessions, [], categories);

    expect(stats.totalPomos).toBeCloseTo(2.4, 5);
    expect(stats.totalSessions).toBe(1);
  });

  it('converts archived session work minutes to standard pomodoros even when the saved count is stale', () => {
    const sessions: SessionRecord[] = [
      {
        id: 'session-stale-pomos',
        startTime: '2026-03-10T08:00:00.000Z',
        endTime: '2026-03-10T12:00:00.000Z',
        stats: {
          totalWorkMinutes: 240,
          totalBreakMinutes: 0,
          pomosCompleted: 6.1,
          tasksCompleted: 0,
          categoryStats: { Study: 240 },
        },
      },
    ];

    const stats = calculateLifetimeStatsFromData(sessions, [], categories);

    expect(stats.totalFocusHours).toBeCloseTo(4, 5);
    expect(stats.totalPomos).toBeCloseTo(9.6, 5);
    expect(stats.totalSessions).toBe(1);
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
    expect(stats.totalSessionHours).toBeCloseTo(90 / 60, 5);
    expect(stats.totalPomos).toBe(3);
    expect(stats.totalSessions).toBe(1);
    expect(stats.categoryBreakdown).toEqual({ Study: 75 });
  });

  it('caps archived lifetime totals by non-paused session time', () => {
    const sessions: SessionRecord[] = [
      {
        id: 'paused-session',
        startTime: '2026-03-12T08:00:00.000Z',
        endTime: '2026-03-12T12:00:00.000Z',
        stats: {
          totalWorkMinutes: 240,
          totalBreakMinutes: 0,
          pomosCompleted: 9.6,
          tasksCompleted: 0,
          categoryStats: { Study: 240 },
        },
      },
      {
        id: 'clean-session',
        startTime: '2026-03-12T13:00:00.000Z',
        endTime: '2026-03-12T17:00:00.000Z',
        stats: {
          totalWorkMinutes: 240,
          totalBreakMinutes: 0,
          pomosCompleted: 9.6,
          tasksCompleted: 0,
          categoryStats: { Study: 240 },
        },
      },
    ];

    const stats = calculateLifetimeStatsFromData(sessions, [
      makeLog({
        type: 'allpause',
        start: '2026-03-12T09:00:00.000Z',
        end: '2026-03-12T11:00:00.000Z',
        reason: 'Paused',
      }),
    ], categories);

    expect(stats.totalFocusHours).toBeCloseTo(6, 5);
    expect(stats.totalSessionHours).toBeCloseTo(6, 5);
    expect(stats.totalPomos).toBeCloseTo(14.4, 5);
    expect(stats.totalSessions).toBe(2);
    expect(stats.categoryBreakdown).toEqual({ Study: 360 });
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

  it('resolves renamed categories from archived session details when raw logs are unavailable', () => {
    const renamedCategories: Category[] = [
      { id: 2, name: 'Deep Study', color: '#4FAE9B', icon: 'book' },
    ];

    const sessions: SessionRecord[] = [
      {
        id: 'session-rename-detail',
        startTime: '2026-03-11T08:00:00.000Z',
        endTime: '2026-03-11T08:25:00.000Z',
        stats: {
          totalWorkMinutes: 25,
          totalBreakMinutes: 5,
          pomosCompleted: 1,
          tasksCompleted: 0,
          categoryStats: { Study: 25 },
          categoryDetails: [
            {
              categoryId: 2,
              categoryName: 'Study',
              categoryColor: '#4FAE9B',
              categoryIcon: 'book',
              minutes: 25,
            },
          ],
        },
      },
    ];

    const stats = calculateLifetimeStatsFromData(sessions, [], renamedCategories);

    expect(stats.categoryBreakdown).toEqual({ 'Deep Study': 25 });
  });
});
