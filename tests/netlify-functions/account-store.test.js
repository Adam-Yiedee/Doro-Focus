import { beforeEach, describe, expect, it, vi } from 'vitest';

const stores = new Map();

const getStoreState = (name) => {
  if (!stores.has(name)) {
    stores.set(name, new Map());
  }
  return stores.get(name);
};

const clone = (value) => structuredClone(value);

vi.mock('@netlify/blobs', () => ({
  getStore: vi.fn((name) => {
    const state = getStoreState(name);

    return {
      async get(key, options = {}) {
        if (!state.has(key)) return null;
        const value = clone(state.get(key));
        if (options?.type === 'json') return value;
        return JSON.stringify(value);
      },
      async setJSON(key, value) {
        state.set(key, clone(value));
      },
      async delete(key) {
        state.delete(key);
      },
    };
  }),
}));

const {
  attachPublicUserToData,
  buildDefaultAccountData,
  calculateLifetimeStatsFromAccountData,
  createSession,
  createUser,
  getAccountData,
  getUserByUsername,
  requireSession,
  saveAccountData,
} = await import('../../netlify/functions/_lib/account-store.js');

describe('account store blob compatibility', () => {
  beforeEach(() => {
    stores.clear();
  });

  it('creates and reloads a user when the store only supports get(type: json)', async () => {
    const record = await createUser('Alice', 'password123');

    expect(record).toMatchObject({
      username: 'alice',
      normalizedUsername: 'alice',
    });

    const loaded = await getUserByUsername('alice');
    expect(loaded).toMatchObject({
      id: record.id,
      username: 'alice',
    });
  });

  it('reads account data and sessions through blob get(type: json)', async () => {
    const user = await createUser('Bob', 'password123');
    const publicUser = {
      username: user.username,
      joinedAt: user.joinedAt,
      lifetimeStats: user.lifetimeStats,
    };
    const accountData = buildDefaultAccountData(publicUser);

    await saveAccountData(user.id, accountData);
    expect(await getAccountData(user.id)).toMatchObject({
      userName: 'bob',
      user: { username: 'bob' },
    });

    const token = await createSession(user);
    const request = new Request('https://example.test/account', {
      headers: { authorization: `Bearer ${token}` },
    });

    const session = await requireSession(request);
    expect(session).toMatchObject({
      userRecord: { id: user.id, username: 'bob' },
      publicUser: { username: 'bob' },
    });
  });

  it('recomputes lifetime stats from account data and preserves synced display names', async () => {
    const user = await createUser('Carol', 'password123');
    const publicUser = {
      username: user.username,
      joinedAt: user.joinedAt,
      lifetimeStats: user.lifetimeStats,
    };

    const hydrated = attachPublicUserToData({
      ...buildDefaultAccountData(publicUser),
      userName: 'Study Buddy',
      revision: 4,
      pastSessions: [
        {
          id: 'session-1',
          startTime: '2026-03-05T10:00:00.000Z',
          endTime: '2026-03-05T10:25:00.000Z',
          stats: {
            totalWorkMinutes: 25,
            totalBreakMinutes: 5,
            pomosCompleted: 1,
            tasksCompleted: 0,
            categoryStats: {},
          },
        },
      ],
      logs: [],
      user: {
        username: user.username,
        joinedAt: user.joinedAt,
        lifetimeStats: {
          totalFocusHours: 999,
          totalSessions: 999,
          totalPomos: 999,
          activeDays: 999,
          currentStreak: 999,
          bestStreak: 999,
          lastActiveDate: '2099-01-01',
          categoryBreakdown: { fake: 999 },
        },
      },
    }, publicUser);

    expect(hydrated).toMatchObject({
      revision: 4,
      userName: 'Study Buddy',
      user: {
        username: 'carol',
      },
    });
    expect(hydrated.user.lifetimeStats).toMatchObject({
      totalFocusHours: 25 / 60,
      totalSessions: 1,
      totalPomos: 1,
    });
  });

  it('counts completed pomodoros from work logs even before a session summary exists', () => {
    const stats = calculateLifetimeStatsFromAccountData([], [
      {
        type: 'work',
        start: '2026-03-12T09:00:00.000Z',
        end: '2026-03-12T09:25:00.000Z',
        duration: 1500,
        reason: 'Pomodoro Complete',
        task: null,
        color: undefined,
        categoryId: null,
      },
    ], []);

    expect(stats).toMatchObject({
      totalFocusHours: 25 / 60,
      totalSessions: 0,
      totalPomos: 1,
      activeDays: 1,
    });
  });

  it('converts mini-pomodoro work minutes to standard pomodoros from work logs', () => {
    const stats = calculateLifetimeStatsFromAccountData([], [
      {
        type: 'work',
        start: '2026-03-12T09:00:00.000Z',
        end: '2026-03-12T09:15:00.000Z',
        duration: 900,
        reason: 'Mini-Pomodoro Complete',
        task: null,
        color: undefined,
        categoryId: null,
      },
      {
        type: 'work',
        start: '2026-03-12T09:18:00.000Z',
        end: '2026-03-12T09:33:00.000Z',
        duration: 900,
        reason: 'Mini-Pomodoro Complete',
        task: null,
        color: undefined,
        categoryId: null,
      },
      {
        type: 'work',
        start: '2026-03-12T09:36:00.000Z',
        end: '2026-03-12T09:51:00.000Z',
        duration: 900,
        reason: 'Mini-Pomodoro Complete',
        task: null,
        color: undefined,
        categoryId: null,
      },
      {
        type: 'work',
        start: '2026-03-12T09:54:00.000Z',
        end: '2026-03-12T10:09:00.000Z',
        duration: 900,
        reason: 'Mini-Pomodoro Complete',
        task: null,
        color: undefined,
        categoryId: null,
      },
    ], []);

    expect(stats).toMatchObject({
      totalFocusHours: 1,
      totalSessions: 0,
      totalPomos: 2.4,
      activeDays: 1,
    });
  });

  it('keeps older archived session days when newer synced logs exist on different dates', () => {
    const stats = calculateLifetimeStatsFromAccountData([
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
    ], [
      {
        type: 'work',
        start: '2026-03-12T09:00:00.000Z',
        end: '2026-03-12T09:25:00.000Z',
        duration: 1500,
        reason: 'Pomodoro Complete',
        task: null,
        color: undefined,
        categoryId: 1,
      },
    ], [
      { id: 1, name: 'Writing', color: '#C86D80', icon: 'pen' },
      { id: 2, name: 'Study', color: '#4FAE9B', icon: 'book' },
    ]);

    expect(stats).toMatchObject({
      totalFocusHours: 75 / 60,
      totalSessions: 2,
      totalPomos: 3,
      activeDays: 2,
      categoryBreakdown: {
        Study: 50,
        Writing: 25,
      },
    });
  });

  it('keeps category attribution stable when a category is renamed after archived sessions were saved', () => {
    const stats = calculateLifetimeStatsFromAccountData([
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
    ], [], [
      { id: 2, name: 'Deep Study', color: '#4FAE9B', icon: 'book' },
    ]);

    expect(stats).toMatchObject({
      categoryBreakdown: {
        'Deep Study': 25,
      },
    });
  });

  it('uses saved category snapshots for productive logs when the original category no longer exists', () => {
    const stats = calculateLifetimeStatsFromAccountData([], [
      {
        type: 'work',
        start: '2026-03-12T09:00:00.000Z',
        end: '2026-03-12T09:25:00.000Z',
        duration: 1500,
        reason: 'Pomodoro Complete',
        task: null,
        color: undefined,
        categoryId: 99,
        categoryName: 'Archived Reading',
      },
    ], []);

    expect(stats).toMatchObject({
      categoryBreakdown: {
        'Archived Reading': 25,
      },
    });
  });

  it('prefers the current category name for productive logs when a category is renamed', () => {
    const stats = calculateLifetimeStatsFromAccountData([], [
      {
        type: 'work',
        start: '2026-03-12T09:00:00.000Z',
        end: '2026-03-12T09:25:00.000Z',
        duration: 1500,
        reason: 'Pomodoro Complete',
        task: null,
        color: undefined,
        categoryId: 2,
        categoryName: 'Study',
      },
    ], [
      { id: 2, name: 'Deep Study', color: '#4FAE9B', icon: 'book' },
    ]);

    expect(stats).toMatchObject({
      categoryBreakdown: {
        'Deep Study': 25,
      },
    });
  });
});
