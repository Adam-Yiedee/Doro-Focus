import { describe, expect, it } from 'vitest';

import {
  buildHostMemberList,
  DEFAULT_GROUP_SYNC_CONFIG,
  formatGroupEncouragementNoticeMessage,
  getGroupGoalActiveSeconds,
  getGroupGoalCompletedSecondsFromLogs,
  getGroupGoalProgressValue,
  getGroupSyncConfigForSession,
  getPooledGoalPerPersonTarget,
  getPooledGroupGoalProgressValue,
  GROUP_MEMBER_FALLBACK_NAME,
  intersectSyncConfig,
  isFocusShareSessionConfig,
  mergeClientMembers,
  normalizeGroupGoalProgressPayload,
  normalizeGroupInviteUsernames,
  normalizeGroupSessionConfig,
  normalizeGroupMembersPayload,
  normalizeSyncConfig,
  NO_GROUP_SYNC_CONFIG,
  pruneLivePeerConnections,
  removePeerConnectionInstance,
  resolveRemoteSyncConfig,
  shouldAwaitFreshHostTimerState,
  shouldAttemptPeerReconnect,
  shouldBroadcastGroupState,
  shouldCreateReplacementPeerConnection,
  shouldDisplayGroupEventNotice,
  shouldFollowHostTimerSync,
  shouldRefreshMembersAfterPeerCleanup,
  shouldSendGroupEventToPeer,
} from './groupStudy';

describe('groupStudy helpers', () => {
  it('shows only the encouragement copy in recipient notifications', () => {
    expect(formatGroupEncouragementNoticeMessage('  Sam, keep the momentum going.  '))
      .toBe('Sam, keep the momentum going.');
    expect(formatGroupEncouragementNoticeMessage('')).toBe('Keep going.');
  });

  it('keeps the default sync config timer-only', () => {
    expect(DEFAULT_GROUP_SYNC_CONFIG).toEqual({
      syncTimers: true,
      syncTasks: false,
      syncSchedule: false,
      syncHistory: false,
      syncSettings: false,
    });
  });

  it('normalizes partial sync configs against defaults', () => {
    expect(normalizeSyncConfig({
      syncTasks: true,
      syncSettings: true,
    })).toEqual({
      syncTimers: true,
      syncTasks: true,
      syncSchedule: false,
      syncHistory: false,
      syncSettings: true,
    });
  });

  it('normalizes group session metadata and keeps legacy sessions timer-sync', () => {
    expect(normalizeGroupSessionConfig(undefined).mode).toBe('timer-sync');
    expect(normalizeGroupSessionConfig(undefined).purpose).toBe('group-study');
    expect(getGroupSyncConfigForSession(normalizeGroupSessionConfig(undefined))).toEqual(DEFAULT_GROUP_SYNC_CONFIG);

    const sharedGoal = normalizeGroupSessionConfig({
      mode: 'shared-goal',
      goal: {
        type: 'pooled-total',
        unit: 'mini-pomo',
        target: 12,
        expectedParticipants: 3,
        invitedUsernames: [' Alice ', 'bob', 'alice', 'no spaces'],
      },
      createdAt: 123,
    });

    expect(sharedGoal).toEqual({
      mode: 'shared-goal',
      createdAt: 123,
      purpose: 'group-study',
      goal: {
        type: 'pooled-total',
        unit: 'mini-pomo',
        target: 12,
        expectedParticipants: 3,
        invitedUsernames: ['alice', 'bob'],
      },
    });
    expect(getGroupSyncConfigForSession(sharedGoal)).toEqual(NO_GROUP_SYNC_CONFIG);
  });

  it('preserves focus-share session metadata without treating it as group study UI', () => {
    const focusShare = normalizeGroupSessionConfig({
      mode: 'timer-sync',
      goal: null,
      createdAt: 456,
      purpose: 'focus-share',
    });

    expect(focusShare).toEqual({
      mode: 'timer-sync',
      goal: null,
      createdAt: 456,
      purpose: 'focus-share',
    });
    expect(isFocusShareSessionConfig(focusShare)).toBe(true);
    expect(isFocusShareSessionConfig({ ...focusShare, purpose: 'group-study' })).toBe(false);
    expect(isFocusShareSessionConfig({
      ...focusShare,
      mode: 'shared-goal',
      goal: {
        type: 'everyone-live',
        unit: 'pomodoro',
        target: 1,
        expectedParticipants: 1,
        invitedUsernames: [],
      },
    })).toBe(false);
  });

  it('deduplicates typed invite usernames conservatively', () => {
    expect(normalizeGroupInviteUsernames([' Ada ', 'ada', 'Grace.Hopper', 'bad name', '', 'Linus-1'])).toEqual([
      'ada',
      'grace.hopper',
      'linus-1',
    ]);
  });

  it('converts exact focused seconds into configured goal units', () => {
    expect(getGroupGoalProgressValue(25 * 60, 'pomodoro')).toBe(1);
    expect(getGroupGoalProgressValue(15 * 60, 'mini-pomo')).toBe(1);
    expect(getGroupGoalProgressValue(25 * 60, 'mini-pomo')).toBeCloseTo(5 / 3, 5);
    expect(getGroupGoalProgressValue(15 * 60, 'pomodoro')).toBeCloseTo(0.6, 5);
  });

  it('counts only timer productive work after joining, plus live active work', () => {
    const joinedAtMs = Date.parse('2026-07-29T10:00:00.000Z');
    const nowMs = Date.parse('2026-07-29T10:45:00.000Z');

    expect(getGroupGoalCompletedSecondsFromLogs([
      {
        type: 'work',
        start: '2026-07-29T09:50:00.000Z',
        end: '2026-07-29T10:10:00.000Z',
        duration: 20 * 60,
        reason: 'Session End',
      },
      {
        type: 'work',
        start: '2026-07-29T10:10:00.000Z',
        end: '2026-07-29T10:20:00.000Z',
        duration: 10 * 60,
        reason: 'Manual',
        source: 'manual',
      },
      {
        type: 'break',
        start: '2026-07-29T10:20:00.000Z',
        end: '2026-07-29T10:25:00.000Z',
        duration: 5 * 60,
        reason: 'Break',
      },
      {
        type: 'work',
        start: '2026-07-29T10:25:00.000Z',
        end: '2026-07-29T10:35:00.000Z',
        duration: 10 * 60,
        reason: 'Task/Category Switch',
      },
    ], joinedAtMs, nowMs)).toBe(20 * 60);

    expect(getGroupGoalActiveSeconds({
      activeMode: 'work',
      timerStarted: true,
      isIdle: false,
      allPauseActive: false,
      graceOpen: false,
      activityStartIso: '2026-07-29T10:30:00.000Z',
      joinedAtMs,
      nowMs,
    })).toBe(15 * 60);
  });

  it('calculates pooled per-person estimates and aggregated progress', () => {
    expect(getPooledGoalPerPersonTarget({
      target: 12,
      expectedParticipants: 3,
    })).toBe(4);
    expect(getPooledGoalPerPersonTarget({
      target: 8,
      expectedParticipants: 3,
    })).toBe(3);

    expect(getPooledGroupGoalProgressValue([
      {
        memberId: 'host',
        name: 'Host',
        isHost: true,
        completedSeconds: 25 * 60,
        activeSeconds: 0,
        totalSeconds: 25 * 60,
        updatedAt: 100,
      },
      {
        memberId: 'guest',
        name: 'Guest',
        isHost: false,
        completedSeconds: 10 * 60,
        activeSeconds: 5 * 60,
        totalSeconds: 15 * 60,
        updatedAt: 100,
      },
    ], 'pomodoro')).toBeCloseTo(1.6, 5);
  });

  it('normalizes progress payloads by newest member update', () => {
    expect(normalizeGroupGoalProgressPayload([
      { memberId: 'a', name: 'A', completedSeconds: 60, activeSeconds: 0, totalSeconds: 60, updatedAt: 1 },
      { memberId: 'a', name: 'A newer', completedSeconds: 120, activeSeconds: 0, totalSeconds: 120, updatedAt: 2 },
      { name: 'missing id' },
    ])).toEqual([
      {
        memberId: 'a',
        name: 'A newer',
        isHost: false,
        completedSeconds: 120,
        activeSeconds: 0,
        totalSeconds: 120,
        updatedAt: 2,
      },
    ]);
  });

  it('preserves safe participant focus metadata on progress payloads', () => {
    expect(normalizeGroupGoalProgressPayload([
      {
        memberId: 'mira',
        name: 'Mira',
        completedSeconds: 60,
        activeSeconds: 30,
        totalSeconds: 90,
        activeTaskName: '  Cell notes   review  ',
        activeCategoryName: ' Biology ',
        activeCategoryColor: '#95D7A1',
        activeColor: 'url(bad)',
        updatedAt: 5,
      },
    ])).toEqual([
      {
        memberId: 'mira',
        name: 'Mira',
        isHost: false,
        completedSeconds: 60,
        activeSeconds: 30,
        totalSeconds: 90,
        activeTaskName: 'Cell notes review',
        activeCategoryName: 'Biology',
        activeCategoryColor: '#95D7A1',
        updatedAt: 5,
      },
    ]);
  });

  it('intersects host and client sync configs conservatively', () => {
    expect(intersectSyncConfig(
      {
        syncTimers: true,
        syncTasks: true,
        syncSchedule: true,
        syncHistory: false,
        syncSettings: true,
      },
      {
        syncTimers: true,
        syncTasks: false,
        syncSchedule: true,
        syncHistory: true,
        syncSettings: false,
      },
    )).toEqual({
      syncTimers: true,
      syncTasks: false,
      syncSchedule: true,
      syncHistory: false,
      syncSettings: false,
    });
  });

  it('normalizes and deduplicates member payloads', () => {
    expect(normalizeGroupMembersPayload([
      { id: ' host ', name: '  Dana  ', isHost: true },
      { id: 'guest', name: '  ', isHost: false },
      { id: 'guest', name: 'Avery', isHost: false },
      { name: 'No Id' },
    ])).toEqual([
      { id: 'host', name: 'Dana', isHost: true },
      { id: 'guest', name: 'Avery', isHost: false },
      { id: 'member_3', name: 'No Id', isHost: false },
    ]);
  });

  it('builds a host member list with sanitized fallback names', () => {
    expect(buildHostMemberList('host-1', '', [
      { id: 'peer-1', name: ' Riley ' },
      { id: 'peer-2', name: '' },
    ])).toEqual([
      { id: 'host-1', name: 'Host', isHost: true },
      { id: 'peer-1', name: 'Riley', isHost: false },
      { id: 'peer-2', name: GROUP_MEMBER_FALLBACK_NAME, isHost: false },
    ]);
  });

  it('merges client members while preserving other known peers', () => {
    expect(mergeClientMembers({
      existingMembers: [
        { id: 'host-1', name: 'Old Host', isHost: true },
        { id: 'self-1', name: 'Old Self', isHost: false },
        { id: 'peer-2', name: 'Taylor', isHost: false },
      ],
      hostId: 'host-1',
      hostName: 'Casey',
      selfId: 'self-1',
      selfName: 'Jordan',
    })).toEqual([
      { id: 'host-1', name: 'Casey', isHost: true },
      { id: 'self-1', name: 'Jordan', isHost: false },
      { id: 'peer-2', name: 'Taylor', isHost: false },
    ]);
  });

  it('keeps the local client in the list when a host members update omits them', () => {
    expect(mergeClientMembers({
      existingMembers: [
        { id: 'host-1', name: 'Casey', isHost: true },
        { id: 'peer-2', name: 'Taylor', isHost: false },
      ],
      hostId: 'host-1',
      hostName: 'Casey',
      selfId: 'self-1',
      selfName: 'Jordan',
    })).toEqual([
      { id: 'host-1', name: 'Casey', isHost: true },
      { id: 'self-1', name: 'Jordan', isHost: false },
      { id: 'peer-2', name: 'Taylor', isHost: false },
    ]);
  });

  it('keeps the newest open connection for each peer when pruning duplicates', () => {
    const hostA = { peer: 'host-1', open: true, id: 'old-host' };
    const hostB = { peer: 'host-1', open: true, id: 'new-host' };
    const guest = { peer: 'guest-1', open: true, id: 'guest' };
    const closedGuest = { peer: 'guest-2', open: false, id: 'closed' };

    expect(pruneLivePeerConnections([hostA, guest, hostB, closedGuest])).toEqual([
      guest,
      hostB,
    ]);
  });

  it('removes only the disconnected connection instance during reconnect cleanup', () => {
    const staleConn = { peer: 'guest-1', open: true, id: 'stale' };
    const liveReplacement = { peer: 'guest-1', open: true, id: 'live' };
    const pendingReplacement = { peer: 'guest-1', open: false, id: 'pending' };
    const anotherPeer = { peer: 'guest-2', open: true, id: 'other' };

    expect(removePeerConnectionInstance(
      [staleConn, liveReplacement, anotherPeer],
      staleConn,
    )).toEqual({
      remainingConnections: [liveReplacement, anotherPeer],
      hasPeerConnection: true,
    });

    expect(removePeerConnectionInstance(
      [staleConn, anotherPeer],
      staleConn,
    )).toEqual({
      remainingConnections: [anotherPeer],
      hasPeerConnection: false,
    });

    expect(removePeerConnectionInstance(
      [staleConn, pendingReplacement, anotherPeer],
      staleConn,
    )).toEqual({
      remainingConnections: [pendingReplacement, anotherPeer],
      hasPeerConnection: true,
    });
  });

  it('resolves inbound sync config conservatively for joined clients', () => {
    expect(resolveRemoteSyncConfig({
      isHost: false,
      remoteHostConfig: {
        syncTimers: true,
        syncTasks: true,
        syncSchedule: true,
        syncHistory: true,
        syncSettings: false,
      },
      clientSyncConfig: {
        syncTimers: true,
        syncTasks: false,
        syncSchedule: true,
        syncHistory: false,
        syncSettings: true,
      },
    })).toEqual({
      syncTimers: true,
      syncTasks: false,
      syncSchedule: true,
      syncHistory: false,
      syncSettings: false,
    });

    expect(resolveRemoteSyncConfig({
      mode: 'timer-only',
      isHost: false,
      remoteHostConfig: {
        syncTimers: true,
        syncTasks: true,
        syncSchedule: true,
        syncHistory: true,
        syncSettings: true,
      },
      clientSyncConfig: DEFAULT_GROUP_SYNC_CONFIG,
    })).toEqual(DEFAULT_GROUP_SYNC_CONFIG);
  });

  it('only broadcasts full shared state for active host sessions', () => {
    expect(shouldBroadcastGroupState({
      groupSessionId: 'ROOM1',
      isHost: true,
    })).toBe(true);

    expect(shouldBroadcastGroupState({
      groupSessionId: 'ROOM1',
      isHost: false,
    })).toBe(false);

    expect(shouldBroadcastGroupState({
      groupSessionId: null,
      isHost: true,
    })).toBe(false);
  });

  it('only displays targeted encouragement for its intended member', () => {
    const targetedEncouragement = {
      type: 'encouragement' as const,
      targetId: 'MIRA',
    };

    expect(shouldDisplayGroupEventNotice(targetedEncouragement, 'MIRA')).toBe(true);
    expect(shouldDisplayGroupEventNotice(targetedEncouragement, 'HOST')).toBe(false);
    expect(shouldDisplayGroupEventNotice(targetedEncouragement, null)).toBe(false);
    expect(shouldDisplayGroupEventNotice({
      type: 'encouragement',
    }, 'HOST')).toBe(true);
    expect(shouldDisplayGroupEventNotice({
      type: 'timer-started',
      targetId: 'MIRA',
    }, 'HOST')).toBe(true);
  });

  it('routes targeted encouragement through the host and then only to the recipient', () => {
    const targetedEncouragement = {
      type: 'encouragement' as const,
      targetId: 'MIRA',
    };

    expect(shouldSendGroupEventToPeer({
      event: targetedEncouragement,
      peerId: 'HOST',
      senderIsHost: false,
      hostPeerId: 'HOST',
    })).toBe(true);
    expect(shouldSendGroupEventToPeer({
      event: targetedEncouragement,
      peerId: 'MIRA',
      senderIsHost: true,
      hostPeerId: 'HOST',
    })).toBe(true);
    expect(shouldSendGroupEventToPeer({
      event: targetedEncouragement,
      peerId: 'SAM',
      senderIsHost: true,
      hostPeerId: 'HOST',
    })).toBe(false);
    expect(shouldSendGroupEventToPeer({
      event: targetedEncouragement,
      peerId: 'MIRA',
      excludePeerId: 'MIRA',
      senderIsHost: true,
      hostPeerId: 'HOST',
    })).toBe(false);
  });

  it('continues broadcasting untargeted group events', () => {
    expect(shouldSendGroupEventToPeer({
      event: { type: 'timer-started' },
      peerId: 'SAM',
      senderIsHost: true,
      hostPeerId: 'HOST',
    })).toBe(true);
  });

  it('only attempts PeerJS reconnects for disconnected, non-destroyed peers', () => {
    expect(shouldAttemptPeerReconnect({
      disconnected: true,
      destroyed: false,
    })).toBe(true);

    expect(shouldAttemptPeerReconnect({
      disconnected: true,
      destroyed: true,
    })).toBe(false);

    expect(shouldAttemptPeerReconnect({
      disconnected: false,
      destroyed: false,
    })).toBe(false);
  });

  it('only creates a replacement host connection when there is no live or pending one already', () => {
    expect(shouldCreateReplacementPeerConnection({
      hasOpenConnection: false,
      hasPendingConnection: false,
    })).toBe(true);

    expect(shouldCreateReplacementPeerConnection({
      hasOpenConnection: true,
      hasPendingConnection: false,
    })).toBe(false);

    expect(shouldCreateReplacementPeerConnection({
      hasOpenConnection: false,
      hasPendingConnection: true,
    })).toBe(false);
  });

  it('only re-enters awaiting-host-timer mode when timer sync is newly enabled or still pending', () => {
    expect(shouldAwaitFreshHostTimerState({
      previousConfig: DEFAULT_GROUP_SYNC_CONFIG,
      nextConfig: {
        ...DEFAULT_GROUP_SYNC_CONFIG,
        syncTasks: true,
      },
      wasReadyForBroadcast: true,
      hasOpenHostConnection: true,
    })).toBe(false);

    expect(shouldAwaitFreshHostTimerState({
      previousConfig: {
        ...DEFAULT_GROUP_SYNC_CONFIG,
        syncTimers: false,
      },
      nextConfig: DEFAULT_GROUP_SYNC_CONFIG,
      wasReadyForBroadcast: true,
      hasOpenHostConnection: true,
    })).toBe(true);

    expect(shouldAwaitFreshHostTimerState({
      previousConfig: DEFAULT_GROUP_SYNC_CONFIG,
      nextConfig: DEFAULT_GROUP_SYNC_CONFIG,
      wasReadyForBroadcast: false,
      hasOpenHostConnection: true,
    })).toBe(true);

    expect(shouldAwaitFreshHostTimerState({
      previousConfig: DEFAULT_GROUP_SYNC_CONFIG,
      nextConfig: {
        ...DEFAULT_GROUP_SYNC_CONFIG,
        syncTimers: false,
        syncTasks: true,
      },
      wasReadyForBroadcast: true,
      hasOpenHostConnection: true,
    })).toBe(false);

    expect(shouldAwaitFreshHostTimerState({
      previousConfig: {
        ...DEFAULT_GROUP_SYNC_CONFIG,
        syncTimers: false,
      },
      nextConfig: DEFAULT_GROUP_SYNC_CONFIG,
      wasReadyForBroadcast: true,
      hasOpenHostConnection: false,
    })).toBe(false);
  });

  it('only refreshes member lists after cleanup when the peer is truly gone or already replaced live', () => {
    expect(shouldRefreshMembersAfterPeerCleanup({
      hasPeerConnection: false,
      replacementConnectionOpen: false,
    })).toBe(true);

    expect(shouldRefreshMembersAfterPeerCleanup({
      hasPeerConnection: true,
      replacementConnectionOpen: true,
    })).toBe(true);

    expect(shouldRefreshMembersAfterPeerCleanup({
      hasPeerConnection: true,
      replacementConnectionOpen: false,
    })).toBe(false);
  });

  it('only locks timer control for joined clients following host timer sync', () => {
    expect(shouldFollowHostTimerSync({
      groupSessionId: 'ROOM1',
      isHost: false,
      hostSyncConfig: DEFAULT_GROUP_SYNC_CONFIG,
      clientSyncConfig: DEFAULT_GROUP_SYNC_CONFIG,
    })).toBe(true);

    expect(shouldFollowHostTimerSync({
      groupSessionId: 'ROOM1',
      isHost: true,
      hostSyncConfig: DEFAULT_GROUP_SYNC_CONFIG,
      clientSyncConfig: DEFAULT_GROUP_SYNC_CONFIG,
    })).toBe(false);

    expect(shouldFollowHostTimerSync({
      groupSessionId: 'ROOM1',
      isHost: false,
      hostSyncConfig: { ...DEFAULT_GROUP_SYNC_CONFIG, syncTimers: false },
      clientSyncConfig: DEFAULT_GROUP_SYNC_CONFIG,
    })).toBe(false);

    expect(shouldFollowHostTimerSync({
      groupSessionId: 'ROOM1',
      isHost: false,
      hostSyncConfig: { ...DEFAULT_GROUP_SYNC_CONFIG, syncTimers: false },
      clientSyncConfig: DEFAULT_GROUP_SYNC_CONFIG,
      awaitingInitialHostState: true,
    })).toBe(true);

    expect(shouldFollowHostTimerSync({
      groupSessionId: null,
      isHost: false,
      hostSyncConfig: DEFAULT_GROUP_SYNC_CONFIG,
      clientSyncConfig: DEFAULT_GROUP_SYNC_CONFIG,
    })).toBe(false);
  });
});
