import { describe, expect, it } from 'vitest';
import {
  APP_OPEN_STREAK_STORAGE_KEY,
  preserveAppOpenStreakWithEarnedStats,
  resolveAppOpenStreak,
  recordAppOpenStreak,
  recordAppOpenStreakWithEarnedStats,
} from './appOpenStreak';

const localTime = (year: number, monthIndex: number, day: number, hour = 9) => (
  new Date(year, monthIndex, day, hour, 0, 0).getTime()
);

const createMemoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  };
};

describe('app open streak accounting', () => {
  it('starts a streak the first time the app is opened', () => {
    const snapshot = resolveAppOpenStreak(null, localTime(2026, 6, 28));

    expect(snapshot.currentStreak).toBe(1);
    expect(snapshot.bestStreak).toBe(1);
    expect(snapshot.lastOpenDate).toBe('2026-07-28');
    expect(snapshot.freezesAvailableThisWeek).toBe(2);
    expect(snapshot.streakBroken).toBe(false);
    expect(snapshot.historyByDate['2026-07-28']).toBe('active');
    expect(snapshot.rollingDays).toHaveLength(7);
    expect(snapshot.rollingDays[snapshot.rollingDays.length - 1]).toMatchObject({
      dateKey: '2026-07-28',
      weekdayLabel: 'Tues',
      status: 'active',
    });
    expect(snapshot.rollingDays.slice(0, 6).every((day) => day.status === null)).toBe(true);
  });

  it('does not increment again when opened more than once on the same day', () => {
    const storage = createMemoryStorage();

    const firstOpen = recordAppOpenStreak(storage, localTime(2026, 6, 28, 8));
    const secondOpen = recordAppOpenStreak(storage, localTime(2026, 6, 28, 22));
    const stored = JSON.parse(storage.getItem(APP_OPEN_STREAK_STORAGE_KEY) ?? '{}');

    expect(firstOpen.currentStreak).toBe(1);
    expect(secondOpen.currentStreak).toBe(1);
    expect(secondOpen.openedToday).toBe(true);
    expect(stored.currentStreak).toBe(1);
    expect(stored.historyByDate['2026-07-28']).toBe('active');
  });

  it('increments on consecutive open days without using freezes', () => {
    const snapshot = resolveAppOpenStreak({
      currentStreak: 4,
      bestStreak: 4,
      lastOpenDate: '2026-07-27',
      freezeUsageByWeek: {},
    }, localTime(2026, 6, 28));

    expect(snapshot.currentStreak).toBe(5);
    expect(snapshot.bestStreak).toBe(5);
    expect(snapshot.missedDays).toBe(0);
    expect(snapshot.preservedMissedDays).toBe(0);
    expect(snapshot.freezesAvailableThisWeek).toBe(2);
  });

  it('uses weekly freezes to preserve a streak over inactive days', () => {
    const snapshot = resolveAppOpenStreak({
      currentStreak: 7,
      bestStreak: 7,
      lastOpenDate: '2026-07-27',
      freezeUsageByWeek: {},
    }, localTime(2026, 6, 30));

    expect(snapshot.currentStreak).toBe(8);
    expect(snapshot.missedDays).toBe(2);
    expect(snapshot.preservedMissedDays).toBe(2);
    expect(snapshot.streakBroken).toBe(false);
    expect(snapshot.freezesAvailableThisWeek).toBe(0);
    expect(snapshot.historyByDate['2026-07-28']).toBe('frozen');
    expect(snapshot.historyByDate['2026-07-29']).toBe('frozen');
    expect(snapshot.historyByDate['2026-07-30']).toBe('active');
    expect(snapshot.rollingDays.map((day) => [day.dateKey, day.status])).toContainEqual(['2026-07-28', 'frozen']);
    expect(snapshot.rollingDays.map((day) => [day.dateKey, day.status])).toContainEqual(['2026-07-30', 'active']);
  });

  it('breaks the streak when more than two inactive days need freezes in the same week', () => {
    const snapshot = resolveAppOpenStreak({
      currentStreak: 12,
      bestStreak: 12,
      lastOpenDate: '2026-07-27',
      freezeUsageByWeek: {},
    }, localTime(2026, 6, 31));

    expect(snapshot.currentStreak).toBe(1);
    expect(snapshot.bestStreak).toBe(12);
    expect(snapshot.missedDays).toBe(3);
    expect(snapshot.preservedMissedDays).toBe(2);
    expect(snapshot.streakBroken).toBe(true);
    expect(snapshot.freezesAvailableThisWeek).toBe(0);
  });

  it('resets freeze availability by week without accumulating unused freezes', () => {
    const snapshot = resolveAppOpenStreak({
      currentStreak: 3,
      bestStreak: 3,
      lastOpenDate: '2026-01-02',
      freezeUsageByWeek: {},
    }, localTime(2026, 0, 5));

    expect(snapshot.currentStreak).toBe(4);
    expect(snapshot.preservedMissedDays).toBe(2);
    expect(snapshot.freezeUsageByWeek['2025-12-28']).toBe(1);
    expect(snapshot.freezeUsageByWeek['2026-01-04']).toBe(1);
    expect(snapshot.freezesUsedThisWeek).toBe(1);
    expect(snapshot.freezesAvailableThisWeek).toBe(1);
  });

  it('recovers gracefully from invalid persisted data', () => {
    const storage = createMemoryStorage();
    storage.setItem(APP_OPEN_STREAK_STORAGE_KEY, '{bad json');

    const snapshot = recordAppOpenStreak(storage, localTime(2026, 6, 28));

    expect(snapshot.currentStreak).toBe(1);
    expect(snapshot.lastOpenDate).toBe('2026-07-28');
  });

  it('preserves a higher already-earned account streak when recording an app open', () => {
    const storage = createMemoryStorage();

    const snapshot = recordAppOpenStreakWithEarnedStats(
      storage,
      { currentStreak: 8, bestStreak: 11 },
      localTime(2026, 6, 28),
    );
    const stored = JSON.parse(storage.getItem(APP_OPEN_STREAK_STORAGE_KEY) ?? '{}');

    expect(snapshot.currentStreak).toBe(8);
    expect(snapshot.bestStreak).toBe(11);
    expect(snapshot.historyByDate['2026-07-28']).toBe('active');
    expect(stored.currentStreak).toBe(8);
    expect(stored.bestStreak).toBe(11);
  });

  it('repairs a lower local app-open streak without downgrading earned streaks', () => {
    const storage = createMemoryStorage();
    storage.setItem(APP_OPEN_STREAK_STORAGE_KEY, JSON.stringify({
      currentStreak: 1,
      bestStreak: 2,
      lastOpenDate: '2026-07-28',
      freezeUsageByWeek: {},
      historyByDate: {
        '2026-07-28': 'active',
      },
    }));

    const snapshot = preserveAppOpenStreakWithEarnedStats(
      storage,
      { currentStreak: 6, bestStreak: 9 },
      localTime(2026, 6, 28),
    );
    const stored = JSON.parse(storage.getItem(APP_OPEN_STREAK_STORAGE_KEY) ?? '{}');

    expect(snapshot.currentStreak).toBe(6);
    expect(snapshot.bestStreak).toBe(9);
    expect(stored.currentStreak).toBe(6);
    expect(stored.bestStreak).toBe(9);
  });

  it('never lowers a stronger local app-open streak during preservation', () => {
    const storage = createMemoryStorage();
    storage.setItem(APP_OPEN_STREAK_STORAGE_KEY, JSON.stringify({
      currentStreak: 12,
      bestStreak: 13,
      lastOpenDate: '2026-07-28',
      freezeUsageByWeek: {},
      historyByDate: {
        '2026-07-28': 'active',
      },
    }));

    const snapshot = preserveAppOpenStreakWithEarnedStats(
      storage,
      { currentStreak: 4, bestStreak: 7 },
      localTime(2026, 6, 28),
    );

    expect(snapshot.currentStreak).toBe(12);
    expect(snapshot.bestStreak).toBe(13);
  });
});
