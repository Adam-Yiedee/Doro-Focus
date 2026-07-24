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

const authLoginHandler = (await import('../../netlify/functions/auth-login.js')).default;
const authRegisterHandler = (await import('../../netlify/functions/auth-register.js')).default;
const focusFriendsHandler = (await import('../../netlify/functions/focus-friends.js')).default;
const { getAccountData, getUserByUsername } = await import('../../netlify/functions/_lib/account-store.js');

const makeLoginRequest = (username, password) => new Request('https://example.test/auth-login', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify({ username, password }),
});

const makeRegisterRequest = (username, password) => new Request('https://example.test/auth-register', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify({ username, password }),
});

const makeAuthedRequest = (token, method = 'GET', body) => new Request('https://example.test/focus-friends', {
  method,
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
  body: body ? JSON.stringify(body) : undefined,
});

describe('debug Focus Friends accounts', () => {
  beforeEach(() => {
    stores.clear();
  });

  it('seeds master and master2 as mutual Focus Friends on login', async () => {
    const masterResponse = await authLoginHandler(makeLoginRequest('master', 'master'));
    expect(masterResponse.status).toBe(200);
    const masterPayload = await masterResponse.json();
    expect(masterPayload.user.username).toBe('master');
    expect(masterPayload.accountData).toMatchObject({
      userName: 'Master',
      timerStarted: true,
      isIdle: false,
    });

    const master2Response = await authLoginHandler(makeLoginRequest('master2', 'master2'));
    expect(master2Response.status).toBe(200);
    const master2Payload = await master2Response.json();
    expect(master2Payload.user.username).toBe('master2');

    const masterFriendsResponse = await focusFriendsHandler(makeAuthedRequest(masterPayload.token));
    expect(masterFriendsResponse.status).toBe(200);
    const masterFriends = await masterFriendsResponse.json();
    expect(masterFriends.friends).toMatchObject([
      {
        username: 'master2',
        displayName: 'Master 2',
        presence: {
          status: 'focusing',
          timer: {
            activeTaskName: 'Test friend activity',
            activeCategoryName: 'Friend Testing',
          },
        },
      },
    ]);

    const master2FriendsResponse = await focusFriendsHandler(makeAuthedRequest(master2Payload.token));
    expect(master2FriendsResponse.status).toBe(200);
    const master2Friends = await master2FriendsResponse.json();
    expect(master2Friends.friends).toMatchObject([
      {
        username: 'master',
        displayName: 'Master',
      },
    ]);

    const encouragementResponse = await focusFriendsHandler(makeAuthedRequest(master2Payload.token, 'POST', {
      action: 'send-encouragement',
      username: 'master',
      message: 'Debug encouragement.',
    }));
    expect(encouragementResponse.status).toBe(200);

    const masterActivityResponse = await focusFriendsHandler(makeAuthedRequest(masterPayload.token));
    const masterActivity = await masterActivityResponse.json();
    expect(masterActivity.inbox[0]).toMatchObject({
      type: 'encouragement',
      fromUsername: 'master2',
      message: 'Debug encouragement.',
    });
  });

  it('does not replace existing debug account data while repairing credentials and friendship', async () => {
    await authLoginHandler(makeLoginRequest('master', 'master'));
    const masterRecord = await getUserByUsername('master');
    const originalAccountData = await getAccountData(masterRecord.id);
    originalAccountData.userName = 'Custom Master';
    originalAccountData.revision = 8;

    const { saveAccountData } = await import('../../netlify/functions/_lib/account-store.js');
    await saveAccountData(masterRecord.id, originalAccountData);

    const secondLoginResponse = await authLoginHandler(makeLoginRequest('master', 'master'));
    expect(secondLoginResponse.status).toBe(200);
    const secondLoginPayload = await secondLoginResponse.json();
    expect(secondLoginPayload.accountData).toMatchObject({
      userName: 'Custom Master',
      revision: 8,
    });
  });

  it('reserves debug account usernames for the seeded fixtures', async () => {
    const response = await authRegisterHandler(makeRegisterRequest('master2', 'password123'));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Username is reserved for Focus Friends debugging.',
    });
  });
});
