import {
  GroupGoalProgress,
  GroupGoalType,
  GroupGoalUnit,
  GroupMember,
  GroupSessionConfig,
  GroupStudyGoal,
  GroupSyncConfig,
  LogEntry,
} from '../types';
import { isProductiveFocusLog } from './logClassification';

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

export const NO_GROUP_SYNC_CONFIG: GroupSyncConfig = {
  syncTimers: false,
  syncTasks: false,
  syncSchedule: false,
  syncHistory: false,
  syncSettings: false,
};

export const TIMER_SYNC_GROUP_SESSION_CONFIG: GroupSessionConfig = {
  mode: 'timer-sync',
  goal: null,
  createdAt: 0,
};

export const GROUP_MEMBER_FALLBACK_NAME = 'Member';
const GROUP_GOAL_MIN_TARGET = 1;
const GROUP_GOAL_MAX_TARGET = 999;
const GROUP_INVITE_USERNAME_MAX_LENGTH = 32;
const GROUP_PROGRESS_STALE_MS = 45_000;

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

export const normalizeGroupInviteUsername = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (!/^[a-z0-9_.-]+$/.test(normalized)) return null;
  return normalized.slice(0, GROUP_INVITE_USERNAME_MAX_LENGTH);
};

export const normalizeGroupInviteUsernames = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  value.forEach((item) => {
    const username = normalizeGroupInviteUsername(item);
    if (username) seen.add(username);
  });
  return Array.from(seen);
};

export const normalizeGroupGoalUnit = (value: unknown, fallback: GroupGoalUnit = 'pomodoro'): GroupGoalUnit => (
  value === 'mini-pomo' ? 'mini-pomo' : value === 'pomodoro' ? 'pomodoro' : fallback
);

export const normalizeGroupGoalType = (value: unknown, fallback: GroupGoalType = 'everyone-live'): GroupGoalType => (
  value === 'pooled-total' ? 'pooled-total' : value === 'everyone-live' ? 'everyone-live' : fallback
);

export const normalizeGroupGoalTarget = (value: unknown, fallback = GROUP_GOAL_MIN_TARGET) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(GROUP_GOAL_MIN_TARGET, Math.min(GROUP_GOAL_MAX_TARGET, Math.round(numeric)));
};

export const normalizeGroupStudyGoal = (value: unknown): GroupStudyGoal | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<GroupStudyGoal>;
  const invitedUsernames = normalizeGroupInviteUsernames(candidate.invitedUsernames);
  const expectedParticipants = Math.max(
    1,
    Math.min(100, Math.floor(Number(candidate.expectedParticipants) || invitedUsernames.length + 1)),
  );

  return {
    type: normalizeGroupGoalType(candidate.type),
    unit: normalizeGroupGoalUnit(candidate.unit),
    target: normalizeGroupGoalTarget(candidate.target),
    expectedParticipants,
    invitedUsernames,
  };
};

export const normalizeGroupSessionConfig = (
  value: Partial<GroupSessionConfig> | undefined | null,
  fallback: GroupSessionConfig = TIMER_SYNC_GROUP_SESSION_CONFIG,
): GroupSessionConfig => {
  const source = value && typeof value === 'object' ? value : null;
  const mode = source?.mode === 'shared-goal' ? 'shared-goal' : source?.mode === 'timer-sync' ? 'timer-sync' : fallback.mode;
  const goal = mode === 'shared-goal'
    ? normalizeGroupStudyGoal(source?.goal) || normalizeGroupStudyGoal(fallback.goal) || {
      type: 'everyone-live',
      unit: 'pomodoro',
      target: 1,
      expectedParticipants: 1,
      invitedUsernames: [],
    }
    : null;
  const createdAt = Number.isFinite(Number(source?.createdAt))
    ? Math.max(0, Number(source?.createdAt))
    : (fallback.createdAt || Date.now());

  return {
    mode,
    goal,
    createdAt,
  };
};

export const getGroupSyncConfigForSession = (config: GroupSessionConfig): GroupSyncConfig => (
  config.mode === 'shared-goal' ? NO_GROUP_SYNC_CONFIG : TIMER_ONLY_GROUP_SYNC_CONFIG
);

export const getGroupGoalUnitSeconds = (unit: GroupGoalUnit) => (
  unit === 'mini-pomo' ? 15 * 60 : 25 * 60
);

export const getGroupGoalProgressValue = (seconds: number, unit: GroupGoalUnit) => {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return safeSeconds / getGroupGoalUnitSeconds(unit);
};

export const getGroupGoalProgressPercent = (value: number, target: number) => {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const safeTarget = Number.isFinite(target) && target > 0 ? target : 1;
  return Math.max(0, Math.min(100, (safeValue / safeTarget) * 100));
};

export const getPooledGoalPerPersonTarget = (goal: Pick<GroupStudyGoal, 'target' | 'expectedParticipants'>) => {
  const expectedParticipants = Number.isFinite(goal.expectedParticipants)
    ? Math.max(1, Math.floor(goal.expectedParticipants))
    : 1;
  return goal.target / expectedParticipants;
};

const getPositiveSeconds = (value: unknown) => {
  const seconds = typeof value === 'number' ? value : Number(value || 0);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
};

const getLogStartMs = (entry: Pick<LogEntry, 'start'>) => {
  const parsed = Date.parse(entry.start);
  return Number.isFinite(parsed) ? parsed : null;
};

const getLogEndMs = (entry: Pick<LogEntry, 'start' | 'end' | 'duration'>) => {
  const startMs = getLogStartMs(entry);
  if (startMs === null) return null;
  const durationSeconds = getPositiveSeconds(entry.duration);
  if (durationSeconds > 0) return startMs + (durationSeconds * 1000);
  const parsedEnd = Date.parse(entry.end);
  return Number.isFinite(parsedEnd) ? parsedEnd : startMs;
};

export const getGroupGoalCompletedSecondsFromLogs = (
  logs: LogEntry[],
  joinedAtMs: number,
  nowMs: number = Date.now(),
) => {
  const safeJoinedAtMs = Number.isFinite(joinedAtMs) ? Math.max(0, joinedAtMs) : 0;
  const safeNowMs = Number.isFinite(nowMs) ? Math.max(safeJoinedAtMs, nowMs) : Date.now();

  return logs.reduce((total, entry) => {
    if (!isProductiveFocusLog(entry)) return total;
    if (entry.source === 'manual') return total;
    const startMs = getLogStartMs(entry);
    const endMs = getLogEndMs(entry);
    if (startMs === null || endMs === null) return total;
    const overlapStart = Math.max(startMs, safeJoinedAtMs);
    const overlapEnd = Math.min(endMs, safeNowMs);
    const seconds = (overlapEnd - overlapStart) / 1000;
    return total + (Number.isFinite(seconds) && seconds > 0 ? seconds : 0);
  }, 0);
};

export const getGroupGoalActiveSeconds = ({
  activeMode,
  timerStarted,
  isIdle,
  allPauseActive,
  graceOpen,
  activityStartIso,
  joinedAtMs,
  nowMs = Date.now(),
}: {
  activeMode: 'work' | 'break';
  timerStarted: boolean;
  isIdle: boolean;
  allPauseActive: boolean;
  graceOpen: boolean;
  activityStartIso?: string | null;
  joinedAtMs: number;
  nowMs?: number;
}) => {
  if (!timerStarted || isIdle || activeMode !== 'work' || allPauseActive || graceOpen) return 0;
  if (!activityStartIso) return 0;
  const startedAtMs = Date.parse(activityStartIso);
  if (!Number.isFinite(startedAtMs)) return 0;
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const safeJoinedAtMs = Number.isFinite(joinedAtMs) ? joinedAtMs : 0;
  const seconds = (safeNowMs - Math.max(startedAtMs, safeJoinedAtMs)) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
};

const normalizeProgressSeconds = (value: unknown) => {
  const numeric = typeof value === 'number' ? value : Number(value || 0);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
};

export const normalizeGroupGoalProgress = (value: unknown): GroupGoalProgress | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<GroupGoalProgress>;
  const rawMemberId = typeof candidate.memberId === 'string' ? candidate.memberId.trim() : '';
  if (!rawMemberId) return null;
  const completedSeconds = normalizeProgressSeconds(candidate.completedSeconds);
  const activeSeconds = normalizeProgressSeconds(candidate.activeSeconds);
  const totalSeconds = normalizeProgressSeconds(candidate.totalSeconds || completedSeconds + activeSeconds);
  return {
    memberId: rawMemberId.slice(0, 80),
    name: sanitizeGroupMemberName(candidate.name),
    isHost: Boolean(candidate.isHost),
    completedSeconds,
    activeSeconds,
    totalSeconds,
    updatedAt: Number.isFinite(Number(candidate.updatedAt)) ? Math.max(0, Number(candidate.updatedAt)) : Date.now(),
  };
};

export const normalizeGroupGoalProgressPayload = (value: unknown): GroupGoalProgress[] => {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, GroupGoalProgress>();
  value.forEach((item) => {
    const progress = normalizeGroupGoalProgress(item);
    if (!progress) return;
    const existing = byId.get(progress.memberId);
    if (!existing || progress.updatedAt >= existing.updatedAt) byId.set(progress.memberId, progress);
  });
  return Array.from(byId.values());
};

export const upsertGroupGoalProgress = (
  progress: GroupGoalProgress[],
  nextProgress: GroupGoalProgress,
  nowMs: number = Date.now(),
) => {
  const freshCutoffMs = nowMs - GROUP_PROGRESS_STALE_MS;
  const byId = new Map<string, GroupGoalProgress>();
  progress.forEach((item) => {
    const normalized = normalizeGroupGoalProgress(item);
    if (!normalized || normalized.updatedAt < freshCutoffMs) return;
    byId.set(normalized.memberId, normalized);
  });
  byId.set(nextProgress.memberId, nextProgress);
  return Array.from(byId.values()).sort((a, b) => Number(b.isHost) - Number(a.isHost) || a.name.localeCompare(b.name));
};

export const getPooledGroupGoalProgressValue = (
  progress: GroupGoalProgress[],
  unit: GroupGoalUnit,
) => progress.reduce((total, item) => total + getGroupGoalProgressValue(item.totalSeconds, unit), 0);

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

export const shouldAwaitFreshHostTimerState = ({
  previousConfig,
  nextConfig,
  wasReadyForBroadcast,
  hasOpenHostConnection,
}: {
  previousConfig: GroupSyncConfig;
  nextConfig: GroupSyncConfig;
  wasReadyForBroadcast: boolean;
  hasOpenHostConnection: boolean;
}) => {
  if (!nextConfig.syncTimers) return false;
  if (!hasOpenHostConnection) return false;
  if (!previousConfig.syncTimers) return true;
  return !wasReadyForBroadcast;
};

export const shouldRefreshMembersAfterPeerCleanup = ({
  hasPeerConnection,
  replacementConnectionOpen,
}: {
  hasPeerConnection: boolean;
  replacementConnectionOpen: boolean;
}) => !hasPeerConnection || replacementConnectionOpen;

export const shouldCreateReplacementPeerConnection = ({
  hasOpenConnection,
  hasPendingConnection,
}: {
  hasOpenConnection: boolean;
  hasPendingConnection: boolean;
}) => !hasOpenConnection && !hasPendingConnection;

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
