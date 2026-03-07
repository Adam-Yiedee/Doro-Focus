import { GroupMember, GroupSyncConfig } from '../types';

export const DEFAULT_GROUP_SYNC_CONFIG: GroupSyncConfig = {
  syncTimers: true,
  syncTasks: false,
  syncSchedule: false,
  syncHistory: false,
  syncSettings: false,
};

export const TIMER_ONLY_GROUP_SYNC_CONFIG: GroupSyncConfig = {
  syncTimers: true,
  syncTasks: false,
  syncSchedule: false,
  syncHistory: false,
  syncSettings: false,
};

export const GROUP_MEMBER_FALLBACK_NAME = 'Member';

type PeerConnectionLike = {
  peer: string;
  open?: boolean;
};

export const normalizeSyncConfig = (
  value: Partial<GroupSyncConfig> | undefined | null,
  fallback: GroupSyncConfig = DEFAULT_GROUP_SYNC_CONFIG,
): GroupSyncConfig => ({
  syncTimers: typeof value?.syncTimers === 'boolean' ? value.syncTimers : fallback.syncTimers,
  syncTasks: typeof value?.syncTasks === 'boolean' ? value.syncTasks : fallback.syncTasks,
  syncSchedule: typeof value?.syncSchedule === 'boolean' ? value.syncSchedule : fallback.syncSchedule,
  syncHistory: typeof value?.syncHistory === 'boolean' ? value.syncHistory : fallback.syncHistory,
  syncSettings: typeof value?.syncSettings === 'boolean' ? value.syncSettings : fallback.syncSettings,
});

export const intersectSyncConfig = (host: GroupSyncConfig, client: GroupSyncConfig): GroupSyncConfig => ({
  syncTimers: host.syncTimers && client.syncTimers,
  syncTasks: host.syncTasks && client.syncTasks,
  syncSchedule: host.syncSchedule && client.syncSchedule,
  syncHistory: host.syncHistory && client.syncHistory,
  syncSettings: host.syncSettings && client.syncSettings,
});

export const sanitizeGroupMemberName = (
  value: unknown,
  fallback: string = GROUP_MEMBER_FALLBACK_NAME,
) => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 48) : fallback;
};

export const normalizeGroupMembersPayload = (value: unknown): GroupMember[] => {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, GroupMember>();
  value.forEach((member, index) => {
    if (!member || typeof member !== 'object') return;
    const candidate = member as Partial<GroupMember>;
    const rawId = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    const id = rawId || `member_${index}`;
    byId.set(id, {
      id,
      name: sanitizeGroupMemberName(candidate.name),
      isHost: Boolean(candidate.isHost),
    });
  });
  return Array.from(byId.values());
};

export const buildHostMemberList = (
  hostId: string,
  hostName: unknown,
  peers: Array<{ id: string; name: unknown }>,
): GroupMember[] => {
  return normalizeGroupMembersPayload([
    { id: hostId, name: sanitizeGroupMemberName(hostName, 'Host'), isHost: true },
    ...peers.map((peer) => ({
      id: peer.id,
      name: sanitizeGroupMemberName(peer.name),
      isHost: false,
    })),
  ]);
};

export const mergeClientMembers = ({
  existingMembers,
  hostId,
  hostName,
  selfId,
  selfName,
}: {
  existingMembers: GroupMember[];
  hostId: string;
  hostName: unknown;
  selfId: string | null | undefined;
  selfName: unknown;
}): GroupMember[] => {
  const filtered = existingMembers.filter((member) => member.id !== hostId && (!selfId || member.id !== selfId));
  return normalizeGroupMembersPayload([
    { id: hostId, name: sanitizeGroupMemberName(hostName, 'Host'), isHost: true },
    ...(selfId ? [{ id: selfId, name: sanitizeGroupMemberName(selfName), isHost: false }] : []),
    ...filtered,
  ]);
};

export const pruneLivePeerConnections = <T extends PeerConnectionLike>(connections: T[]): T[] => {
  const seenPeers = new Set<string>();
  const nextConnections: T[] = [];

  for (let index = connections.length - 1; index >= 0; index -= 1) {
    const connection = connections[index];
    if (!connection || typeof connection.peer !== 'string') continue;
    const peerId = connection.peer.trim();
    if (!peerId || connection.open === false || seenPeers.has(peerId)) continue;
    seenPeers.add(peerId);
    nextConnections.unshift(connection);
  }

  return nextConnections;
};

export const removePeerConnectionInstance = <T extends PeerConnectionLike>(connections: T[], target: T) => {
  const remainingConnections = connections.filter((connection) => connection !== target);
  return {
    remainingConnections,
    hasPeerConnection: remainingConnections.some((connection) => connection.peer === target.peer),
  };
};

export const resolveRemoteSyncConfig = ({
  mode = 'full',
  isHost,
  remoteHostConfig,
  clientSyncConfig,
}: {
  mode?: 'full' | 'timer-only';
  isHost: boolean;
  remoteHostConfig: GroupSyncConfig;
  clientSyncConfig: GroupSyncConfig;
}): GroupSyncConfig => {
  const inboundBaseConfig = isHost
    ? remoteHostConfig
    : intersectSyncConfig(remoteHostConfig, clientSyncConfig);

  if (mode === 'timer-only') {
    return {
      ...TIMER_ONLY_GROUP_SYNC_CONFIG,
      syncTimers: inboundBaseConfig.syncTimers,
    };
  }

  return inboundBaseConfig;
};

export const shouldFollowHostTimerSync = ({
  groupSessionId,
  isHost,
  hostSyncConfig,
  clientSyncConfig,
  awaitingInitialHostState = false,
}: {
  groupSessionId: string | null;
  isHost: boolean;
  hostSyncConfig: GroupSyncConfig;
  clientSyncConfig: GroupSyncConfig;
  awaitingInitialHostState?: boolean;
}) => {
  return Boolean(
    groupSessionId
      && !isHost
      && clientSyncConfig.syncTimers
      && (awaitingInitialHostState || hostSyncConfig.syncTimers)
  );
};

export const shouldBroadcastGroupState = ({
  groupSessionId,
  isHost,
}: {
  groupSessionId: string | null;
  isHost: boolean;
}) => Boolean(groupSessionId && isHost);

export const shouldAttemptPeerReconnect = ({
  disconnected,
  destroyed,
}: {
  disconnected: boolean;
  destroyed: boolean;
}) => disconnected && !destroyed;
