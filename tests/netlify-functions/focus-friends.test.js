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

    const missingApprovalSessionResponse = await focusFriendsHandler(makeAuthedRequest(bobToken, 'POST', {
      action: 'approve-join-request',
      actionId: joinRequestId,
    }));
    expect(missingApprovalSessionResponse.status).toBe(400);

    const approvalResponse = await focusFriendsHandler(makeAuthedRequest(bobToken, 'POST', {
      action: 'approve-join-request',
      actionId: joinRequestId,
      sessionId: 'room99',
      groupStudy: {
        mode: 'shared-goal',
        createdAt: 456,
        goal: {
          type: 'everyone-live',
          unit: 'pomodoro',
          target: 4,
          expectedParticipants: 2,
          invitedUsernames: ['alice'],
        },
      },
    }));
    expect(approvalResponse.status).toBe(200);
    const bobAfterApproval = await approvalResponse.json();
    expect(bobAfterApproval.inbox[0]).toMatchObject({
      id: joinRequestId,
      readAt: expect.any(String),
    });

    const duplicateApprovalResponse = await focusFriendsHandler(makeAuthedRequest(bobToken, 'POST', {
      action: 'approve-join-request',
      actionId: joinRequestId,
      sessionId: 'room99',
    }));
    expect(duplicateApprovalResponse.status).toBe(409);

    const aliceApprovedInviteResponse = await focusFriendsHandler(makeAuthedRequest(aliceToken));
    const aliceApprovedInvite = await aliceApprovedInviteResponse.json();
    expect(aliceApprovedInvite.inbox[0]).toMatchObject({
      type: 'join-invite',
      fromUsername: 'bob',
      message: 'approved your join request.',
      sessionId: 'ROOM99',
      groupStudy: {
        mode: 'shared-goal',
        createdAt: 456,
        goal: {
          type: 'everyone-live',
          unit: 'pomodoro',
          target: 4,
          expectedParticipants: 2,
          invitedUsernames: ['alice'],
        },
      },
      readAt: null,
    });

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
      groupStudy: null,
      readAt: null,
    });

    expect(await getAccountData(bob.id)).toEqual(bobAccount);
    expect(await getAccountData(alice.id)).toBeNull();
  });

  it('prevents self requests and duplicate pending requests', async () => {
    const alice = await createUser('Alice', 'password123');
    const bob = await createUser('Bob', 'password123');
    const aliceToken = await createSession(alice);
    const bobToken = await createSession(bob);

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

    const selfInviteResponse = await focusFriendsHandler(makeAuthedRequest(aliceToken, 'POST', {
      action: 'send-join-invite',
      username: 'alice',
      sessionId: 'room42',
    }));
    expect(selfInviteResponse.status).toBe(400);

    const unknownInviteResponse = await focusFriendsHandler(makeAuthedRequest(aliceToken, 'POST', {
      action: 'send-join-invite',
      username: 'nobody-here',
      sessionId: 'room42',
    }));
    expect(unknownInviteResponse.status).toBe(404);

    const groupStudy = {
      mode: 'shared-goal',
      createdAt: 123,
      goal: {
        type: 'pooled-total',
        unit: 'mini-pomo',
        target: 12,
        expectedParticipants: 3,
        invitedUsernames: ['Bob', 'bob', 'bad name', 'Casey'],
      },
    };

    const nonFriendInviteResponse = await focusFriendsHandler(makeAuthedRequest(aliceToken, 'POST', {
      action: 'send-join-invite',
      username: 'bob',
      sessionId: 'room42',
      groupStudy,
    }));
    expect(nonFriendInviteResponse.status).toBe(200);

    const bobInviteResponse = await focusFriendsHandler(makeAuthedRequest(bobToken));
    const bobInvite = await bobInviteResponse.json();
    expect(bobInvite.inbox[0]).toMatchObject({
      type: 'join-invite',
      fromUsername: 'alice',
      toUsername: 'bob',
      sessionId: 'ROOM42',
      groupStudy: {
        mode: 'shared-goal',
        createdAt: 123,
        goal: {
          type: 'pooled-total',
          unit: 'mini-pomo',
          target: 12,
          expectedParticipants: 3,
          invitedUsernames: ['bob', 'casey'],
        },
      },
    });
  });

  it('declines Focus Friend join requests without sending an invite', async () => {
    const alice = await createUser('Alice', 'password123');
    const bob = await createUser('Bob', 'password123');
    const aliceToken = await createSession(alice);
    const bobToken = await createSession(bob);

    await focusFriendsHandler(makeAuthedRequest(aliceToken, 'POST', {
      action: 'send-request',
      username: 'bob',
    }));
    const bobRequestsResponse = await focusFriendsHandler(makeAuthedRequest(bobToken));
    const bobRequests = await bobRequestsResponse.json();
    await focusFriendsHandler(makeAuthedRequest(bobToken, 'POST', {
      action: 'accept-request',
      requestId: bobRequests.incomingRequests[0].id,
    }));

    await focusFriendsHandler(makeAuthedRequest(aliceToken, 'POST', {
      action: 'request-join',
      username: 'bob',
      message: 'Can I join?',
    }));
    const bobActivityResponse = await focusFriendsHandler(makeAuthedRequest(bobToken));
    const bobActivity = await bobActivityResponse.json();
    const joinRequestId = bobActivity.inbox[0].id;

    const declineResponse = await focusFriendsHandler(makeAuthedRequest(bobToken, 'POST', {
      action: 'decline-join-request',
      actionId: joinRequestId,
    }));
    expect(declineResponse.status).toBe(200);
    const bobAfterDecline = await declineResponse.json();
    expect(bobAfterDecline.inbox[0]).toMatchObject({
      id: joinRequestId,
      readAt: expect.any(String),
    });

    const duplicateDeclineResponse = await focusFriendsHandler(makeAuthedRequest(bobToken, 'POST', {
      action: 'decline-join-request',
      actionId: joinRequestId,
    }));
    expect(duplicateDeclineResponse.status).toBe(409);

    const aliceActivityResponse = await focusFriendsHandler(makeAuthedRequest(aliceToken));
    const aliceActivity = await aliceActivityResponse.json();
    expect(aliceActivity.inbox).toHaveLength(0);
  });

  it('accepts invite links idempotently and clears pending requests between the accounts', async () => {
    const alice = await createUser('Alice', 'password123');
    const bob = await createUser('Bob', 'password123');
    const aliceToken = await createSession(alice);
    const bobToken = await createSession(bob);

    const pendingResponse = await focusFriendsHandler(makeAuthedRequest(bobToken, 'POST', {
      action: 'send-request',
      username: 'alice',
    }));
    expect(pendingResponse.status).toBe(200);

    const inviteResponse = await focusFriendsHandler(makeAuthedRequest(bobToken, 'POST', {
      action: 'accept-invite',
      username: 'ALICE',
    }));
    expect(inviteResponse.status).toBe(200);
    const bobAfterInvite = await inviteResponse.json();
    expect(bobAfterInvite.friends).toMatchObject([{ username: 'alice' }]);
    expect(bobAfterInvite.incomingRequests).toHaveLength(0);
    expect(bobAfterInvite.outgoingRequests).toHaveLength(0);

    const aliceFriendsResponse = await focusFriendsHandler(makeAuthedRequest(aliceToken));
    const aliceFriends = await aliceFriendsResponse.json();
    expect(aliceFriends.friends).toMatchObject([{ username: 'bob' }]);
    expect(aliceFriends.incomingRequests).toHaveLength(0);
    expect(aliceFriends.outgoingRequests).toHaveLength(0);

    const repeatResponse = await focusFriendsHandler(makeAuthedRequest(bobToken, 'POST', {
      action: 'accept-invite',
      username: 'alice',
    }));
    expect(repeatResponse.status).toBe(200);
    const repeatPayload = await repeatResponse.json();
    expect(repeatPayload.friends.filter((friend) => friend.username === 'alice')).toHaveLength(1);

    const selfInviteResponse = await focusFriendsHandler(makeAuthedRequest(aliceToken, 'POST', {
      action: 'accept-invite',
      username: 'alice',
    }));
    expect(selfInviteResponse.status).toBe(400);
  });

  it('displays timers from Focus Friends presence without writing account data', async () => {
    const alice = await createUser('Alice', 'password123');
    const bob = await createUser('Bob', 'password123');
    const aliceToken = await createSession(alice);
    const bobToken = await createSession(bob);

    const inviteResponse = await focusFriendsHandler(makeAuthedRequest(bobToken, 'POST', {
      action: 'accept-invite',
      username: 'alice',
    }));
    expect(inviteResponse.status).toBe(200);

    const nowMs = Date.now();
    const sessionStartTime = new Date(nowMs - 120_000).toISOString();
    const presenceResponse = await focusFriendsHandler(makeAuthedRequest(bobToken, 'POST', {
      action: 'update-presence',
      timer: {
        version: 1,
        hostName: 'Bob Builder',
        activeMode: 'work',
        timerStarted: true,
        isIdle: false,
        workTime: 1470,
        breakTime: 300,
        pomodoroCount: 2,
        sessionStartTime,
        todayPomodoroCount: 5.5,
        allPauseActive: false,
        allPauseTime: 0,
        graceOpen: false,
        graceContext: null,
        activeTaskName: 'Live timer check',
        activeCategoryName: 'Presence',
        activeCategoryColor: '#4FAE9B',
        activeCategoryIcon: 'target',
        activeColor: '#4FAE9B',
        projectedFinishEndMs: null,
        settings: {
          workDuration: 1500,
          shortBreakDuration: 300,
          longBreakDuration: 900,
          longBreakInterval: 4,
          timerPreset: 'focus',
          twoInARowMode: false,
        },
        runtime: {
          version: 2,
          updatedAtMs: nowMs,
          sourceTabId: 'presence-test',
          phase: 'running-work',
          phaseStartedAtMs: nowMs,
          phaseStartWorkTime: 1470,
          phaseStartBreakTime: 300,
          phaseStartAllPauseTime: 0,
          phaseStartGraceTotal: 0,
          activityStartIso: new Date(nowMs).toISOString(),
        },
        updatedAtMs: nowMs,
      },
    }));
    expect(presenceResponse.status).toBe(200);

    const aliceFriendsResponse = await focusFriendsHandler(makeAuthedRequest(aliceToken));
    expect(aliceFriendsResponse.status).toBe(200);
    const aliceFriends = await aliceFriendsResponse.json();
    expect(aliceFriends.friends).toMatchObject([
      {
        username: 'bob',
        presence: {
          status: 'focusing',
          timer: {
            activeTaskName: 'Live timer check',
            activeCategoryName: 'Presence',
            activeCategoryIcon: 'target',
            pomodoroCount: 2,
            sessionStartTime,
            todayPomodoroCount: 5.5,
            settings: {
              timerPreset: 'focus',
            },
            runtime: {
              phase: 'running-work',
              phaseStartWorkTime: 1470,
            },
          },
        },
      },
    ]);
    expect(await getAccountData(bob.id)).toBeNull();

    const breakNowMs = nowMs + 1_000;
    const breakPresenceResponse = await focusFriendsHandler(makeAuthedRequest(bobToken, 'POST', {
      action: 'update-presence',
      timer: {
        version: 1,
        hostName: 'Bob Builder',
        activeMode: 'break',
        timerStarted: true,
        isIdle: false,
        workTime: 1470,
        breakTime: 240,
        pomodoroCount: 2,
        sessionStartTime,
        todayPomodoroCount: 5.5,
        allPauseActive: false,
        allPauseTime: 0,
        graceOpen: false,
        graceContext: null,
        activeTaskName: 'Live timer check',
        activeCategoryName: 'Presence',
        activeCategoryColor: '#4FAE9B',
        activeCategoryIcon: 'target',
        activeColor: '#4FAE9B',
        projectedFinishEndMs: null,
        settings: {
          workDuration: 1500,
          shortBreakDuration: 300,
          longBreakDuration: 900,
          longBreakInterval: 4,
          timerPreset: 'focus',
          twoInARowMode: false,
        },
        runtime: {
          version: 2,
          updatedAtMs: breakNowMs,
          sourceTabId: 'presence-test',
          phase: 'running-break',
          phaseStartedAtMs: breakNowMs,
          phaseStartWorkTime: 1470,
          phaseStartBreakTime: 240,
          phaseStartAllPauseTime: 0,
          phaseStartGraceTotal: 0,
          activityStartIso: new Date(breakNowMs).toISOString(),
        },
        updatedAtMs: breakNowMs,
      },
    }));
    expect(breakPresenceResponse.status).toBe(200);

    const aliceBreakFriendsResponse = await focusFriendsHandler(makeAuthedRequest(aliceToken));
    expect(aliceBreakFriendsResponse.status).toBe(200);
    const aliceBreakFriends = await aliceBreakFriendsResponse.json();
    expect(aliceBreakFriends.friends).toMatchObject([
      {
        username: 'bob',
        presence: {
          status: 'break',
          timer: {
            activeMode: 'break',
            breakTime: 240,
            pomodoroCount: 2,
            sessionStartTime,
            settings: {
              timerPreset: 'focus',
            },
            runtime: {
              phase: 'running-break',
              phaseStartBreakTime: 240,
            },
          },
        },
      },
    ]);
    expect(await getAccountData(bob.id)).toBeNull();
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
