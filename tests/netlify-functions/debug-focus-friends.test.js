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

  it('seeds master debug accounts as mutual Focus Friends on login', async () => {
    const masterResponse = await authLoginHandler(makeLoginRequest('master', 'master'));
    expect(masterResponse.status).toBe(200);
    const masterPayload = await masterResponse.json();
    expect(masterPayload.user.username).toBe('master');
    expect(masterPayload.accountData).toMatchObject({
      userName: 'Master',
      timerStarted: true,
      isIdle: false,
      pomodoroCount: 1,
    });

    const master2Response = await authLoginHandler(makeLoginRequest('master2', 'master2'));
    expect(master2Response.status).toBe(200);
    const master2Payload = await master2Response.json();
    expect(master2Payload.user.username).toBe('master2');

    const expectedDebugAccountStates = {
      master3: { timerStarted: true, isIdle: false },
      master4: { timerStarted: false, isIdle: true },
      master5: { timerStarted: false, isIdle: true },
    };
    const extraDebugPayloads = await Promise.all(['master3', 'master4', 'master5'].map(async (username) => {
      const response = await authLoginHandler(makeLoginRequest(username, username));
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.user.username).toBe(username);
      expect(payload.accountData).toMatchObject(expectedDebugAccountStates[username]);
      return payload;
    }));

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
            pomodoroCount: 4,
          },
        },
      },
      {
        username: 'master3',
        displayName: 'Master 3',
        presence: {
          status: 'focusing',
          timer: {
            activeTaskName: 'Review request flow',
            activeCategoryName: 'Deep Work',
            pomodoroCount: 2,
          },
        },
      },
      {
        username: 'master4',
        displayName: 'Master 4',
        presence: {
          status: 'idle',
          timer: {
            activeTaskName: 'Check session invites',
            activeCategoryName: 'Pair Focus',
          },
        },
      },
      {
        username: 'master5',
        displayName: 'Master 5',
        presence: {
          status: 'offline',
          timer: null,
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
      {
        username: 'master3',
        displayName: 'Master 3',
      },
      {
        username: 'master4',
        displayName: 'Master 4',
      },
      {
        username: 'master5',
        displayName: 'Master 5',
      },
    ]);

    const master5FriendsResponse = await focusFriendsHandler(makeAuthedRequest(extraDebugPayloads[2].token));
    expect(master5FriendsResponse.status).toBe(200);
    const master5Friends = await master5FriendsResponse.json();
    expect(master5Friends.friends.map((friend) => friend.username)).toEqual([
      'master',
      'master2',
      'master3',
      'master4',
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

  it('repairs untouched debug fixture presence without replacing customized data', async () => {
    await authLoginHandler(makeLoginRequest('master5', 'master5'));
    const master5Record = await getUserByUsername('master5');
    const staleMaster5Fixture = await getAccountData(master5Record.id);
    staleMaster5Fixture.timerStarted = true;
    staleMaster5Fixture.isIdle = false;
    staleMaster5Fixture.updatedAt = new Date().toISOString();
    staleMaster5Fixture.runtime = {
      ...staleMaster5Fixture.runtime,
      updatedAtMs: Date.now(),
      phase: 'running-work',
    };

    const { saveAccountData } = await import('../../netlify/functions/_lib/account-store.js');
    await saveAccountData(master5Record.id, staleMaster5Fixture);

    const repairedResponse = await authLoginHandler(makeLoginRequest('master5', 'master5'));
    expect(repairedResponse.status).toBe(200);
    const repairedPayload = await repairedResponse.json();
    expect(repairedPayload.accountData).toMatchObject({
      timerStarted: false,
      isIdle: true,
    });

    const masterResponse = await authLoginHandler(makeLoginRequest('master', 'master'));
    const masterPayload = await masterResponse.json();
    const masterFriendsResponse = await focusFriendsHandler(makeAuthedRequest(masterPayload.token));
    const masterFriends = await masterFriendsResponse.json();
    expect(masterFriends.friends.find((friend) => friend.username === 'master5')).toMatchObject({
      presence: {
        status: 'offline',
        timer: null,
      },
    });
  });

  it('reserves debug account usernames for the seeded fixtures', async () => {
    const response = await authRegisterHandler(makeRegisterRequest('master5', 'password123'));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Username is reserved for Focus Friends debugging.',
    });
  });
});
