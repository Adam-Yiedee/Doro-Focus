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

const authRegisterHandler = (await import('../../netlify/functions/auth-register.js')).default;
const {
  getAccountData,
  requireSession,
} = await import('../../netlify/functions/_lib/account-store.js');

const makeRequest = (body, method = 'POST') => new Request('https://example.test/auth-register', {
  method,
  headers: {
    'content-type': 'application/json',
  },
  body: body ? JSON.stringify(body) : undefined,
});

describe('auth-register function', () => {
  beforeEach(() => {
    stores.clear();
  });

  it('creates a new account, account data, and session token', async () => {
    const response = await authRegisterHandler(makeRequest({
      username: 'Alice',
      password: 'password123',
    }));

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload).toMatchObject({
      user: {
        username: 'alice',
      },
      accountData: {
        revision: 1,
        userName: 'alice',
        user: {
          username: 'alice',
        },
      },
    });
    expect(typeof payload.token).toBe('string');
    expect(payload.token.length).toBeGreaterThan(20);

    const session = await requireSession(new Request('https://example.test/account-data', {
      headers: { authorization: `Bearer ${payload.token}` },
    }));
    expect(session).toMatchObject({
      userRecord: {
        username: 'alice',
      },
    });

    const storedAccount = await getAccountData(session.userRecord.id);
    expect(storedAccount).toMatchObject({
      revision: 1,
      userName: 'alice',
      user: {
        username: 'alice',
      },
    });
  });

  it('rejects duplicate usernames with a specific conflict error', async () => {
    await authRegisterHandler(makeRequest({
      username: 'Alice',
      password: 'password123',
    }));

    const response = await authRegisterHandler(makeRequest({
      username: 'ALICE',
      password: 'password123',
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Username already exists',
    });
  });
});
