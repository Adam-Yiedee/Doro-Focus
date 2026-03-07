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
});
