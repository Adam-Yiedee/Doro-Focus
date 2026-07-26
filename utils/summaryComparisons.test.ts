import { describe, expect, it } from 'vitest';
import { SessionRecord } from '../types';
import { getSummaryPomoComparison, getSummaryPomoDeltaLabel } from './summaryComparisons';

const makeSession = ({
  id,
  startTime,
  workMinutes,
  pomosCompleted = workMinutes / 25,
}: {
  id: string;
  startTime: string;
  workMinutes: number;
  pomosCompleted?: number;
}): SessionRecord => ({
  id,
  startTime,
  endTime: new Date(Date.parse(startTime) + (workMinutes * 60_000)).toISOString(),
  stats: {
    totalWorkMinutes: workMinutes,
    totalBreakMinutes: 0,
    pomosCompleted,
    tasksCompleted: 0,
  },
});

describe('getSummaryPomoComparison', () => {
  it('adds the current summary to prior same-day sessions', () => {
    const current = makeSession({
      id: 'current',
      startTime: '2026-07-20T17:00:00.000Z',
      workMinutes: 25,
    });
    const result = getSummaryPomoComparison({
      pastSessions: [
        makeSession({
          id: 'today-earlier',
          startTime: '2026-07-20T15:00:00.000Z',
          workMinutes: 50,
        }),
        makeSession({
          id: 'yesterday',
          startTime: '2026-07-19T17:00:00.000Z',
          workMinutes: 25,
        }),
      ],
      sessionStats: {
        sessionStartTime: current.startTime,
        sessionEndTime: current.endTime,
        totalWorkMinutes: current.stats.totalWorkMinutes,
        pomosCompleted: current.stats.pomosCompleted,
      },
      now: new Date('2026-07-20T18:00:00.000Z'),
    });

    expect(result.summaryDayPomos).toBe(3);
    expect(result.previousDayTargetLabel).toBe('Yesterday');
    expect(result.previousDayPomos).toBe(1);
    expect(result.previousDayDelta).toBe(2);
  });

  it('does not double-count the current session after it has been archived', () => {
    const current = makeSession({
      id: 'current',
      startTime: '2026-07-20T17:00:00.000Z',
      workMinutes: 25,
    });
    const result = getSummaryPomoComparison({
      pastSessions: [
        current,
        makeSession({
          id: 'today-earlier',
          startTime: '2026-07-20T15:00:00.000Z',
          workMinutes: 50,
        }),
        makeSession({
          id: 'yesterday',
          startTime: '2026-07-19T17:00:00.000Z',
          workMinutes: 25,
        }),
      ],
      sessionStats: {
        sessionStartTime: current.startTime,
        sessionEndTime: current.endTime,
        totalWorkMinutes: current.stats.totalWorkMinutes,
        pomosCompleted: current.stats.pomosCompleted,
      },
      now: new Date('2026-07-20T18:00:00.000Z'),
    });

    expect(result.summaryDayPomos).toBe(3);
    expect(result.previousDayDelta).toBe(2);
    expect(result.weeklyAverageDelta).toBeCloseTo(3 - (1 / 7), 5);
  });

  it('compares completed pomos rather than partial focus-minute equivalents', () => {
    const result = getSummaryPomoComparison({
      pastSessions: [
        makeSession({
          id: 'today-partial',
          startTime: '2026-07-20T15:00:00.000Z',
          workMinutes: 40,
          pomosCompleted: 1,
        }),
        makeSession({
          id: 'yesterday-complete',
          startTime: '2026-07-19T17:00:00.000Z',
          workMinutes: 25,
          pomosCompleted: 1,
        }),
      ],
      sessionStats: {
        sessionStartTime: '2026-07-20T17:00:00.000Z',
        sessionEndTime: '2026-07-20T17:12:30.000Z',
        totalWorkMinutes: 12.5,
        pomosCompleted: 0,
      },
      now: new Date('2026-07-20T18:00:00.000Z'),
    });

    expect(result.summaryDayPomos).toBe(1);
    expect(result.previousDayPomos).toBe(1);
    expect(result.previousDayDelta).toBe(0);
    expect(result.weeklyAverageDelta).toBeCloseTo(1 - (1 / 7), 5);
  });

  it('compares against the previous calendar day even when an older focus day has fewer pomos', () => {
    const result = getSummaryPomoComparison({
      pastSessions: [
        makeSession({
          id: 'yesterday-heavy',
          startTime: '2026-07-19T10:00:00.000Z',
          workMinutes: 125,
          pomosCompleted: 5,
        }),
        makeSession({
          id: 'older-light',
          startTime: '2026-07-18T10:00:00.000Z',
          workMinutes: 25,
          pomosCompleted: 1,
        }),
      ],
      sessionStats: {
        sessionStartTime: '2026-07-20T17:00:00.000Z',
        sessionEndTime: '2026-07-20T17:50:00.000Z',
        totalWorkMinutes: 50,
        pomosCompleted: 2,
      },
      now: new Date('2026-07-20T18:00:00.000Z'),
    });

    expect(result.summaryDayPomos).toBe(2);
    expect(result.previousDayKey).toBe('2026-07-19');
    expect(result.previousDayPomos).toBe(5);
    expect(result.previousDayDelta).toBe(-3);
    expect(getSummaryPomoDeltaLabel(result.previousDayDelta, result.previousDayTargetLabel)).toBe('Fewer Pomos Than Yesterday');
  });

  it('includes zero-pomo days in the previous seven-day average', () => {
    const result = getSummaryPomoComparison({
      pastSessions: [
        makeSession({
          id: 'six-days-ago',
          startTime: '2026-07-14T10:00:00.000Z',
          workMinutes: 175,
          pomosCompleted: 7,
        }),
      ],
      sessionStats: {
        sessionStartTime: '2026-07-20T17:00:00.000Z',
        sessionEndTime: '2026-07-20T17:25:00.000Z',
        totalWorkMinutes: 25,
        pomosCompleted: 1,
      },
      now: new Date('2026-07-20T18:00:00.000Z'),
    });

    expect(result.weeklyComparisonDays).toHaveLength(7);
    expect(result.weeklyAveragePomos).toBe(1);
    expect(result.weeklyAverageDelta).toBe(0);
    expect(getSummaryPomoDeltaLabel(result.weeklyAverageDelta, 'Average')).toBe('Same Pomos As Average');
  });
});
