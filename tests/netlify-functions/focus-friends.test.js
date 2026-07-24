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

const focusFriendsHandler = (await import('../../netlify/functions/focus-friends.js')).default;
const {
  buildDefaultAccountData,
  createSession,
  createUser,
  getAccountData,
  saveAccountData,
} = await import('../../netlify/functions/_lib/account-store.js');

const makeAuthedRequest = (token, method = 'GET', body) => new Request('https://example.test/focus-friends', {
  method,
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
  body: body ? JSON.stringify(body) : undefined,
});

const makePublicUser = (record) => ({
  username: record.username,
  joinedAt: record.joinedAt,
  lifetimeStats: record.lifetimeStats,
});

describe('focus-friends function', () => {
  beforeEach(() => {
    stores.clear();
  });

  it('requests, accepts, displays active presence, and delivers friend activity', async () => {
    const alice = await createUser('Alice', 'password123');
    const bob = await createUser('Bob', 'password123');
    const aliceToken = await createSession(alice);
    const bobToken = await createSession(bob);

    const bobAccount = {
      ...buildDefaultAccountData(makePublicUser(bob)),
      userName: 'Bob Builder',
      categories: [{ id: 7, name: 'Writing', color: '#4FAE9B', icon: 'notebook' }],
      tasks: [{
        id: 20,
        name: 'Draft chapter',
        estimated: 2,
        completed: 0,
        checked: false,
        selected: true,
        categoryId: 7,
        subtasks: [],
      }],
      activeMode: 'work',
      timerStarted: true,
      isIdle: false,
      workTime: 1200,
      runtime: {
        version: 2,
        updatedAtMs: Date.now(),
        sourceTabId: 'test',
        phase: 'running-work',
        phaseStartedAtMs: Date.now(),
        phaseStartWorkTime: 1200,
        phaseStartBreakTime: 0,
        phaseStartAllPauseTime: 0,
        phaseStartGraceTotal: 0,
        activityStartIso: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    };
    await saveAccountData(bob.id, bobAccount);

    const requestResponse = await focusFriendsHandler(makeAuthedRequest(aliceToken, 'POST', {
      action: 'send-request',
      username: 'BOB',
    }));
    expect(requestResponse.status).toBe(200);
    const aliceAfterRequest = await requestResponse.json();
    expect(aliceAfterRequest.outgoingRequests).toHaveLength(1);
    const requestId = aliceAfterRequest.outgoingRequests[0].id;

    const bobInboxResponse = await focusFriendsHandler(makeAuthedRequest(bobToken));
    const bobInbox = await bobInboxResponse.json();
    expect(bobInbox.incomingRequests).toMatchObject([
      {
        id: requestId,
        fromUsername: 'alice',
        toUsername: 'bob',
      },
    ]);

    const acceptResponse = await focusFriendsHandler(makeAuthedRequest(bobToken, 'POST', {
      action: 'accept-request',
      requestId,
    }));
    expect(acceptResponse.status).toBe(200);
    const bobFriends = await acceptResponse.json();
    expect(bobFriends.friends).toMatchObject([{ username: 'alice' }]);

    const aliceFriendsResponse = await focusFriendsHandler(makeAuthedRequest(aliceToken));
    const aliceFriends = await aliceFriendsResponse.json();
    expect(aliceFriends.friends).toHaveLength(1);
    expect(aliceFriends.friends[0]).toMatchObject({
      username: 'bob',
      displayName: 'Bob Builder',
      presence: {
        status: 'focusing',
        timer: {
          activeTaskName: 'Draft chapter',
          activeCategoryName: 'Writing',
        },
      },
    });

    const encouragementResponse = await focusFriendsHandler(makeAuthedRequest(bobToken, 'POST', {
      action: 'send-encouragement',
      username: 'alice',
      message: 'Keep going, you are almost there.',
    }));
    expect(encouragementResponse.status).toBe(200);

    const aliceActivityResponse = await focusFriendsHandler(makeAuthedRequest(aliceToken));
    const aliceActivity = await aliceActivityResponse.json();
    expect(aliceActivity.inbox[0]).toMatchObject({
      type: 'encouragement',
      fromUsername: 'bob',
      message: 'Keep going, you are almost there.',
      readAt: null,
    });

    const readResponse = await focusFriendsHandler(makeAuthedRequest(aliceToken, 'POST', {
      action: 'mark-action-read',
      actionId: aliceActivity.inbox[0].id,
    }));
    const readPayload = await readResponse.json();
    expect(readPayload.inbox[0].readAt).toEqual(expect.any(String));

    const joinResponse = await focusFriendsHandler(makeAuthedRequest(aliceToken, 'POST', {
      action: 'request-join',
      username: 'bob',
      message: 'Can I join your session?',
      sessionId: 'abc123',
    }));
    expect(joinResponse.status).toBe(200);

    const bobActivityResponse = await focusFriendsHandler(makeAuthedRequest(bobToken));
    const bobActivity = await bobActivityResponse.json();
    expect(bobActivity.inbox[0]).toMatchObject({
      type: 'join-request',
      fromUsername: 'alice',
      sessionId: 'ABC123',
    });
    const joinRequestId = bobActivity.inbox[0].id;

    const missingInviteResponse = await focusFriendsHandler(makeAuthedRequest(bobToken, 'POST', {
      action: 'send-join-invite',
      username: 'alice',
      message: 'Join my session.',
    }));
    expect(missingInviteResponse.status).toBe(400);

    const inviteResponse = await focusFriendsHandler(makeAuthedRequest(bobToken, 'POST', {
      action: 'send-join-invite',
      username: 'alice',
      message: 'Join my session.',
      sessionId: 'room42',
    }));
    expect(inviteResponse.status).toBe(200);

    const readJoinRequestResponse = await focusFriendsHandler(makeAuthedRequest(bobToken, 'POST', {
      action: 'mark-action-read',
      actionId: joinRequestId,
    }));
    expect(readJoinRequestResponse.status).toBe(200);
    const bobAfterRead = await readJoinRequestResponse.json();
    expect(bobAfterRead.inbox[0]).toMatchObject({
      id: joinRequestId,
      readAt: expect.any(String),
    });

    const aliceInviteResponse = await focusFriendsHandler(makeAuthedRequest(aliceToken));
    const aliceInvite = await aliceInviteResponse.json();
    expect(aliceInvite.inbox[0]).toMatchObject({
      type: 'join-invite',
      fromUsername: 'bob',
      message: 'Join my session.',
      sessionId: 'ROOM42',
      readAt: null,
    });

    expect(await getAccountData(bob.id)).toEqual(bobAccount);
    expect(await getAccountData(alice.id)).toBeNull();
  });

  it('prevents self requests and duplicate pending requests', async () => {
    const alice = await createUser('Alice', 'password123');
    const bob = await createUser('Bob', 'password123');
    const aliceToken = await createSession(alice);
    await createSession(bob);

    const selfResponse = await focusFriendsHandler(makeAuthedRequest(aliceToken, 'POST', {
      action: 'send-request',
      username: 'alice',
    }));
    expect(selfResponse.status).toBe(400);

    const firstResponse = await focusFriendsHandler(makeAuthedRequest(aliceToken, 'POST', {
      action: 'send-request',
      username: 'bob',
    }));
    expect(firstResponse.status).toBe(200);

    const duplicateResponse = await focusFriendsHandler(makeAuthedRequest(aliceToken, 'POST', {
      action: 'send-request',
      username: 'bob',
    }));
    expect(duplicateResponse.status).toBe(409);

    const unknownReadResponse = await focusFriendsHandler(makeAuthedRequest(aliceToken, 'POST', {
      action: 'mark-action-read',
      actionId: 'missing-action',
    }));
    expect(unknownReadResponse.status).toBe(404);

    const nonFriendInviteResponse = await focusFriendsHandler(makeAuthedRequest(aliceToken, 'POST', {
      action: 'send-join-invite',
      username: 'bob',
      sessionId: 'room42',
    }));
    expect(nonFriendInviteResponse.status).toBe(403);
  });

  it('does not synthesize active presence when a friend account payload is missing', async () => {
    const alice = await createUser('Alice', 'password123');
    const bob = await createUser('Bob', 'password123');
    const aliceToken = await createSession(alice);
    const bobToken = await createSession(bob);

    const requestResponse = await focusFriendsHandler(makeAuthedRequest(aliceToken, 'POST', {
      action: 'send-request',
      username: 'bob',
    }));
    const requestPayload = await requestResponse.json();

    const acceptResponse = await focusFriendsHandler(makeAuthedRequest(bobToken, 'POST', {
      action: 'accept-request',
      requestId: requestPayload.outgoingRequests[0].id,
    }));
    expect(acceptResponse.status).toBe(200);

    const aliceFriendsResponse = await focusFriendsHandler(makeAuthedRequest(aliceToken));
    const aliceFriends = await aliceFriendsResponse.json();

    expect(aliceFriends.friends).toMatchObject([
      {
        username: 'bob',
        presence: {
          status: 'offline',
          updatedAtMs: null,
          timer: null,
        },
      },
    ]);
    expect(await getAccountData(alice.id)).toBeNull();
    expect(await getAccountData(bob.id)).toBeNull();
  });
});
