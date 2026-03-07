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

const accountDataHandler = (await import('./account-data.js')).default;
const {
  buildDefaultAccountData,
  createSession,
  createUser,
  getAccountData,
  getUserByUsername,
  saveAccountData,
} = await import('./_lib/account-store.js');

const makeAuthedRequest = (token, method, body) => new Request('https://example.test/account-data', {
  method,
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
  body: body ? JSON.stringify(body) : undefined,
});

describe('account-data function', () => {
  beforeEach(() => {
    stores.clear();
  });

  it('recomputes stats server-side and increments revisions on save', async () => {
    const user = await createUser('Alice', 'password123');
    const publicUser = {
      username: user.username,
      joinedAt: user.joinedAt,
      lifetimeStats: user.lifetimeStats,
    };
    const existing = buildDefaultAccountData(publicUser);
    await saveAccountData(user.id, existing);

    const token = await createSession(user);
    const response = await accountDataHandler(makeAuthedRequest(token, 'PUT', {
      accountData: {
        ...existing,
        revision: existing.revision,
        userName: 'Focus Squad',
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
      },
    }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.accountData).toMatchObject({
      revision: 2,
      userName: 'Focus Squad',
    });
    expect(payload.user.lifetimeStats).toMatchObject({
      totalFocusHours: 25 / 60,
      totalSessions: 1,
      totalPomos: 1,
    });

    const storedAccount = await getAccountData(user.id);
    expect(storedAccount.revision).toBe(2);

    const storedUser = await getUserByUsername('alice');
    expect(storedUser.lifetimeStats).toMatchObject({
      totalFocusHours: 25 / 60,
      totalSessions: 1,
      totalPomos: 1,
    });
  });

  it('rejects stale writes with the latest authoritative payload', async () => {
    const user = await createUser('Bob', 'password123');
    const publicUser = {
      username: user.username,
      joinedAt: user.joinedAt,
      lifetimeStats: user.lifetimeStats,
    };
    const existing = buildDefaultAccountData(publicUser);
    await saveAccountData(user.id, existing);

    const token = await createSession(user);
    const response = await accountDataHandler(makeAuthedRequest(token, 'PUT', {
      accountData: {
        ...existing,
        revision: 0,
        userName: 'Stale Client',
      },
    }));

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload).toMatchObject({
      conflict: true,
      accountData: {
        revision: 1,
        userName: user.username,
      },
    });
  });
});
