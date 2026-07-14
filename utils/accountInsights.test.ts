import { describe, expect, it } from 'vitest';
import { Category, LogEntry } from '../types';
import { computeAccountInsights } from './accountInsights';

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

describe('computeAccountInsights', () => {
  it('splits sessions at long neutral grace boundaries', () => {
    const insights = computeAccountInsights({
      joinedAt: '2026-01-05T00:00:00',
      nowMs: Date.parse('2026-01-05T18:00:00'),
      categories,
      logs: [
        makeLog({
          start: '2026-01-05T09:00:00',
          end: '2026-01-05T09:25:00',
          reason: 'Pomodoro Complete',
          categoryId: 1,
        }),
        makeLog({
          type: 'grace',
          start: '2026-01-05T09:25:00',
          end: '2026-01-05T13:10:00',
          reason: 'Grace Period',
        }),
        makeLog({
          start: '2026-01-05T13:10:00',
          end: '2026-01-05T13:35:00',
          reason: 'Pomodoro Complete',
          categoryId: 2,
        }),
        makeLog({
          start: '2026-01-05T13:40:00',
          end: '2026-01-05T14:00:00',
          reason: 'Session End',
          categoryId: 2,
        }),
      ],
    });

    expect(insights.sessions).toHaveLength(2);
    expect(insights.sessions[0]).toMatchObject({
      startMs: Date.parse('2026-01-05T09:00:00'),
      endMs: Date.parse('2026-01-05T09:25:00'),
      closed: true,
    });
    expect(insights.sessions[1]).toMatchObject({
      startMs: Date.parse('2026-01-05T13:10:00'),
      endMs: Date.parse('2026-01-05T14:00:00'),
      closed: true,
    });
  });

  it('computes productive hour, weekday, and category insights from pomodoro logs', () => {
    const monday = '2026-01-05';
    const tuesday = '2026-01-06';
    const insights = computeAccountInsights({
      joinedAt: `${monday}T00:00:00`,
      nowMs: Date.parse(`${tuesday}T22:00:00`),
      categories,
      logs: [
        makeLog({
          start: `${monday}T09:00:00`,
          end: `${monday}T09:25:00`,
          reason: 'Pomodoro Complete',
          categoryId: 1,
        }),
        makeLog({
          start: `${monday}T09:34:00`,
          end: `${monday}T09:59:00`,
          reason: 'Pomodoro Complete',
          categoryId: 1,
        }),
        makeLog({
          start: `${tuesday}T08:30:00`,
          end: `${tuesday}T08:55:00`,
          reason: 'Pomodoro Complete',
          categoryId: 2,
        }),
      ],
    });

    expect(insights.mostProductiveHours).toEqual({
      hours: [9],
      focusMinutes: 50,
    });
    expect(insights.mostProductiveWeekdays.weekdays).toEqual([new Date(`${monday}T12:00:00`).getDay()]);
    expect(insights.mostProductiveWeekdays.averageFocusMinutes).toBe(50);
    expect(insights.topCategory).toMatchObject({
      name: 'Writing',
      minutes: 50,
    });
    expect(insights.hasCategorizedWork).toBe(true);
    expect(insights.dayPartTotals.morning).toBeCloseTo(75, 5);
    expect(insights.dayPartTotals.afternoon).toBe(0);
    expect(insights.dayPartTotals.night).toBe(0);
  });

  it('tracks today and week-over-week deltas', () => {
    const insights = computeAccountInsights({
      joinedAt: '2026-01-01T00:00:00',
      nowMs: Date.parse('2026-01-14T23:00:00'),
      categories,
      logs: [
        makeLog({
          start: '2026-01-06T09:00:00',
          end: '2026-01-06T09:25:00',
          reason: 'Pomodoro Complete',
          categoryId: 1,
        }),
        makeLog({
          type: 'break',
          start: '2026-01-06T09:25:00',
          end: '2026-01-06T09:26:00',
          reason: 'Session End',
        }),
        makeLog({
          start: '2026-01-07T10:00:00',
          end: '2026-01-07T10:25:00',
          reason: 'Pomodoro Complete',
          categoryId: 1,
        }),
        makeLog({
          type: 'break',
          start: '2026-01-07T10:25:00',
          end: '2026-01-07T10:26:00',
          reason: 'Session End',
        }),
        makeLog({
          start: '2026-01-14T08:00:00',
          end: '2026-01-14T08:25:00',
          reason: 'Pomodoro Complete',
          categoryId: 2,
        }),
        makeLog({
          type: 'break',
          start: '2026-01-14T08:25:00',
          end: '2026-01-14T08:26:00',
          reason: 'Session End',
        }),
      ],
    });

    expect(insights.today.focusMinutes).toBeCloseTo(25, 5);
    expect(insights.today.pomodoros).toBe(1);
    expect(insights.today.sessions).toBe(1);
    expect(insights.weekComparison.thisWeek.focusMinutes).toBeCloseTo(25, 5);
    expect(insights.weekComparison.lastWeek.focusMinutes).toBeCloseTo(50, 5);
    expect(insights.weekComparison.thisWeek.pomodoros).toBe(1);
    expect(insights.weekComparison.lastWeek.pomodoros).toBe(2);
    expect(insights.weekComparison.focusDeltaMinutes).toBeCloseTo(-25, 5);
    expect(insights.weekComparison.pomoDelta).toBe(-1);
  });

  it('converts mini-pomodoro work minutes to standard pomodoros in today and trend stats', () => {
    const today = '2026-01-14';
    const insights = computeAccountInsights({
      joinedAt: '2026-01-01T00:00:00',
      nowMs: Date.parse(`${today}T23:00:00`),
      categories,
      logs: [
        makeLog({
          start: `${today}T08:00:00`,
          end: `${today}T08:15:00`,
          reason: 'Mini-Pomodoro Complete',
          categoryId: 1,
        }),
        makeLog({
          start: `${today}T08:18:00`,
          end: `${today}T08:33:00`,
          reason: 'Mini-Pomodoro Complete',
          categoryId: 1,
        }),
        makeLog({
          start: `${today}T08:36:00`,
          end: `${today}T08:51:00`,
          reason: 'Mini-Pomodoro Complete',
          categoryId: 1,
        }),
      ],
    });

    expect(insights.today.focusMinutes).toBeCloseTo(45, 5);
    expect(insights.today.pomodoros).toBeCloseTo(1.8, 5);
    expect(insights.weekComparison.thisWeek.pomodoros).toBeCloseTo(1.8, 5);
    expect(insights.dailyFocusTrend.find((point) => point.dateKey === today)?.pomodoros).toBeCloseTo(1.8, 5);
  });

  it('builds recent daily trend points and session lanes for interactive charts', () => {
    const insights = computeAccountInsights({
      joinedAt: '2026-01-01T00:00:00',
      nowMs: Date.parse('2026-01-14T23:00:00'),
      categories,
      logs: [
        makeLog({
          start: '2026-01-13T21:00:00',
          end: '2026-01-13T21:25:00',
          reason: 'Pomodoro Complete',
          categoryId: 1,
        }),
        makeLog({
          type: 'break',
          start: '2026-01-13T21:25:00',
          end: '2026-01-13T21:35:00',
          reason: 'Session End',
        }),
        makeLog({
          start: '2026-01-14T08:00:00',
          end: '2026-01-14T08:25:00',
          reason: 'Pomodoro Complete',
          categoryId: 2,
        }),
        makeLog({
          type: 'break',
          start: '2026-01-14T08:25:00',
          end: '2026-01-14T08:35:00',
          reason: 'Session End',
        }),
      ],
    });

    const todayTrend = insights.dailyFocusTrend.find((point) => point.dateKey === '2026-01-14');
    expect(todayTrend).toMatchObject({
      focusMinutes: 25,
      pomodoros: 1,
      sessions: 1,
    });

    const yesterdayTrend = insights.dailyFocusTrend.find((point) => point.dateKey === '2026-01-13');
    expect(yesterdayTrend).toMatchObject({
      focusMinutes: 25,
      pomodoros: 1,
      sessions: 1,
    });

    const todayLane = insights.sessionLanes.find((lane) => lane.dateKey === '2026-01-14');
    expect(todayLane?.totalFocusMinutes).toBeCloseTo(25, 5);
    expect(todayLane?.sessions[0]).toMatchObject({
      closed: true,
      startMinutes: 8 * 60,
      endMinutes: 8 * 60 + 35,
    });
  });

  it('does not let neutral grace inflate session duration stats', () => {
    const insights = computeAccountInsights({
      joinedAt: '2026-01-14T00:00:00',
      nowMs: Date.parse('2026-01-14T23:00:00'),
      categories,
      logs: [
        makeLog({
          start: '2026-01-14T09:00:00',
          end: '2026-01-14T09:25:00',
          reason: 'Pomodoro Complete',
          categoryId: 1,
        }),
        makeLog({
          type: 'grace',
          start: '2026-01-14T09:25:00',
          end: '2026-01-14T09:35:00',
          reason: 'Grace Period',
        }),
        makeLog({
          type: 'break',
          start: '2026-01-14T09:35:00',
          end: '2026-01-14T09:40:00',
          reason: 'Session End',
        }),
      ],
    });

    const todayLane = insights.sessionLanes.find((lane) => lane.dateKey === '2026-01-14');
    expect(todayLane?.sessions[0]).toMatchObject({
      startMinutes: 9 * 60,
      endMinutes: 9 * 60 + 40,
      durationMinutes: 30,
    });
  });

  it('uses saved focus minutes for best hour and weekday stats', () => {
    const monday = '2026-01-05';
    const tuesday = '2026-01-06';
    const insights = computeAccountInsights({
      joinedAt: `${monday}T00:00:00`,
      nowMs: Date.parse(`${tuesday}T23:00:00`),
      categories,
      logs: [
        makeLog({
          start: `${monday}T09:00:00`,
          end: `${monday}T09:25:00`,
          reason: 'Pomodoro Complete',
          categoryId: 1,
        }),
        makeLog({
          start: `${monday}T09:30:00`,
          end: `${monday}T09:55:00`,
          reason: 'Pomodoro Complete',
          categoryId: 1,
        }),
        makeLog({
          start: `${tuesday}T10:00:00`,
          end: `${tuesday}T10:58:00`,
          reason: 'Manual Work Log',
          categoryId: 2,
        }),
      ],
    });

    expect(insights.mostProductiveHours).toEqual({
      hours: [10],
      focusMinutes: 58,
    });
    expect(insights.mostProductiveWeekdays.weekdays).toEqual([new Date(`${tuesday}T12:00:00`).getDay()]);
    expect(insights.mostProductiveWeekdays.averageFocusMinutes).toBe(58);
  });

  it('averages tied quit windows when more than two stop times are equally common', () => {
    const insights = computeAccountInsights({
      joinedAt: '2026-01-05T00:00:00',
      nowMs: Date.parse('2026-01-09T23:00:00'),
      categories,
      logs: [
        makeLog({
          start: '2026-01-05T12:35:00',
          end: '2026-01-05T13:25:00',
          reason: 'Pomodoro Complete',
          categoryId: 1,
        }),
        makeLog({
          type: 'break',
          start: '2026-01-05T13:25:00',
          end: '2026-01-05T13:30:00',
          reason: 'Session End',
        }),
        makeLog({
          start: '2026-01-06T14:05:00',
          end: '2026-01-06T14:55:00',
          reason: 'Pomodoro Complete',
          categoryId: 1,
        }),
        makeLog({
          type: 'break',
          start: '2026-01-06T14:55:00',
          end: '2026-01-06T15:00:00',
          reason: 'Session End',
        }),
        makeLog({
          start: '2026-01-07T16:35:00',
          end: '2026-01-07T17:25:00',
          reason: 'Pomodoro Complete',
          categoryId: 2,
        }),
        makeLog({
          type: 'break',
          start: '2026-01-07T17:25:00',
          end: '2026-01-07T17:30:00',
          reason: 'Session End',
        }),
      ],
    });

    expect(insights.mostCommonQuitTimes).toEqual({
      bucketMinutes: [15 * 60 + 20],
      count: 1,
      sourceBucketCount: 3,
    });
  });

  it('uses the saved category snapshot when logs reference a deleted category', () => {
    const insights = computeAccountInsights({
      joinedAt: '2026-01-05T00:00:00',
      nowMs: Date.parse('2026-01-05T23:00:00'),
      categories,
      logs: [
        makeLog({
          start: '2026-01-05T09:00:00',
          end: '2026-01-05T09:25:00',
          reason: 'Pomodoro Complete',
          categoryId: 99,
          categoryName: 'Archived Reading',
        }),
      ],
    });

    expect(insights.topCategory).toMatchObject({
      name: 'Archived Reading',
      minutes: 25,
    });
    expect(insights.today.topCategoryName).toBe('Archived Reading');
  });

  it('prefers the current category name when the category still exists', () => {
    const renamedCategories: Category[] = [
      { id: 2, name: 'Deep Study', color: '#4FAE9B', icon: 'book' },
    ];

    const insights = computeAccountInsights({
      joinedAt: '2026-01-05T00:00:00',
      nowMs: Date.parse('2026-01-05T23:00:00'),
      categories: renamedCategories,
      logs: [
        makeLog({
          start: '2026-01-05T09:00:00',
          end: '2026-01-05T09:25:00',
          reason: 'Pomodoro Complete',
          categoryId: 2,
          categoryName: 'Study',
        }),
      ],
    });

    expect(insights.topCategory).toMatchObject({
      name: 'Deep Study',
      minutes: 25,
    });
  });
});
