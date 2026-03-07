import { describe, expect, it } from 'vitest';

import {
  buildHostMemberList,
  DEFAULT_GROUP_SYNC_CONFIG,
  GROUP_MEMBER_FALLBACK_NAME,
  intersectSyncConfig,
  mergeClientMembers,
  normalizeGroupMembersPayload,
  normalizeSyncConfig,
  pruneLivePeerConnections,
  removePeerConnectionInstance,
  resolveRemoteSyncConfig,
  shouldAwaitFreshHostTimerState,
  shouldAttemptPeerReconnect,
  shouldBroadcastGroupState,
  shouldCreateReplacementPeerConnection,
  shouldFollowHostTimerSync,
  shouldRefreshMembersAfterPeerCleanup,
} from './groupStudy';

describe('groupStudy helpers', () => {
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
