import React, { createContext, useContext, useEffect, useState, useCallback, useReducer, useRef } from 'react';
import {
  TimerMode,
  Task,
  Category,
  LogEntry,
  SessionCategoryStat,
  TimerSettings,
  AlarmSound,
  GroupSyncConfig,
  GroupMember,
  GroupEventType,
  GroupEventPayload,
  GroupNotice,
  GuestTimerLockNotice,
  User,
  SessionRecord,
  TimerRuntimePhase,
  TimerRuntimeSnapshot,
  TimerSpectatorState,
  FocusFriendNotice,
  FocusFriendsState,
} from '../types';
import { playAlarm, playSwitch, resumeAudioContext, startFocusSound, stopFocusSound } from '../utils/sound';
import { dispatchDelayedStartSessionStarted } from '../utils/delayedStartEvents';
import Peer, { DataConnection } from 'peerjs';
import {
  GraceContext,
  TIMER_RUNTIME_VERSION,
  computeWorkCompletion,
  createRuntimeSnapshot,
  deriveRuntimeValues,
  detectRuntimeBoundaryCrossing,
  getBreakBankBaseForWorkCompletion,
  getCompletedPhaseDuration,
  getDelayedStartBoundaryState,
  getMatchingTimerPreset,
  getProjectedTaskFinishSeconds,
  getRemainingPomodorosForActiveTasks,
  getTimerStateFreshnessStamp,
  getTimerLockAutoUnlockDelay,
  isTimerLockExpired,
  resolveGraceBreakBank,
  normalizeGraceWindow,
  resetPersistedTimerSessionState,
  shouldApplyIncomingRuntime,
  shouldAutoStartTwoInARowFocus,
  shouldDiscardRestoredGrace,
} from '../utils/timerRuntime';
import {
  fetchAccountData,
  fetchFocusFriends,
  approveFocusFriendJoinRequest as apiApproveFocusFriendJoinRequest,
  isConflictError,
  isUnauthorizedError,
  loginAccount,
  logoutAccount,
  acceptFocusFriendRequest as apiAcceptFocusFriendRequest,
  declineFocusFriendJoinRequest as apiDeclineFocusFriendJoinRequest,
  declineFocusFriendRequest as apiDeclineFocusFriendRequest,
  markFocusFriendActionRead as apiMarkFocusFriendActionRead,
  removeFocusFriend as apiRemoveFocusFriend,
  requestFocusFriendJoin as apiRequestFocusFriendJoin,
  registerAccount,
  saveAccountData,
  acceptFocusFriendInvite as apiAcceptFocusFriendInvite,
  sendFocusFriendEncouragement as apiSendFocusFriendEncouragement,
  sendFocusFriendJoinInvite as apiSendFocusFriendJoinInvite,
  sendFocusFriendRequest as apiSendFocusFriendRequest,
  updateFocusFriendPresence as apiUpdateFocusFriendPresence,
} from '../utils/accountApi';
import {
  buildHostMemberList,
  DEFAULT_GROUP_SYNC_CONFIG as DEFAULT_SYNC_CONFIG,
  GROUP_MEMBER_FALLBACK_NAME,
  intersectSyncConfig,
  mergeClientMembers,
  normalizeGroupMembersPayload,
  normalizeSyncConfig,
  pruneLivePeerConnections,
  removePeerConnectionInstance,
  resolveRemoteSyncConfig,
  sanitizeGroupMemberName,
  shouldAwaitFreshHostTimerState,
  shouldAttemptPeerReconnect,
  shouldBroadcastGroupState,
  shouldCreateReplacementPeerConnection,
  shouldFollowHostTimerSync,
  shouldRefreshMembersAfterPeerCleanup,
  TIMER_ONLY_GROUP_SYNC_CONFIG as TIMER_ONLY_SYNC_CONFIG,
} from '../utils/groupStudy';
import { buildCategorySnapshot } from '../utils/categoryTracking';
import { isActiveCategory } from '../utils/categoryVisibility';
import { getAccountStatsPomodoroEquivalent, getCompletionReasonForSettings } from '../utils/pomodoroAccounting';
import { selectLocalPayloadForAccountSync, shouldApplyAccountSyncSnapshot } from '../utils/accountSync';
import { calculateLifetimeStatsFromData, EMPTY_LIFETIME_STATS } from '../utils/lifetimeStats';
import { mergeOrderedEntitiesById, mergeTaskLists } from '../utils/stateMerge';
import { pickTimerSpectatorSettings } from '../utils/timerShare';
import {
  buildEndSessionStats,
  type EndSessionPendingActivity,
  getEndSessionPendingActivityWindow,
  getSessionTaskCompletionIdsFromLogs,
} from '../utils/sessionStats';
import {
  DEFAULT_TAB_TITLE,
  getTimerTabTitleNotification,
  shouldShowTimerTabTitleNotification,
  type TimerTabTitleNotification,
} from '../utils/tabTitleNotifications';
import { getFocusTimerDisplaySeconds } from '../utils/focusTimerDisplay';
import { getFocusTimerBreakAutoEndMs } from '../utils/focusTimerAutoEnd';
import {
  markFocusFriendNoticeSeen,
  selectFocusFriendNotice,
} from '../utils/focusFriendNotifications';

export interface ScheduleBreak {
  id: string;
  startTime: string; // "HH:MM" 24h format
  duration: number; // minutes
  label: string;
}

export interface SessionStats {
  sessionStartTime?: string | null;
  sessionEndTime?: string | null;
  totalWorkMinutes: number;
  totalBreakMinutes: number;
  tasksCompleted: number;
  pomosCompleted: number;
  miniPomosCompleted?: number;
  categoryStats: Record<string, number>;
}

type PendingMenuAction = 'new-category';

const ACCOUNT_SYNC_SAVE_DEBOUNCE_MS = 2500;
const FOCUS_FRIENDS_REFRESH_MS = 15000;

const isBrowserTabVisible = () => {
  if (typeof document === 'undefined') return true;
  if (document.visibilityState !== 'visible') return false;
  return typeof document.hasFocus !== 'function' || document.hasFocus();
};

const EMPTY_FOCUS_FRIENDS_STATE: FocusFriendsState = {
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  inbox: [],
};

interface AuthResult {
  ok: boolean;
  error: string | null;
}

interface TimerContextType {
  // State
  user: User | null;
  workTime: number;
  breakTime: number;
  activeMode: TimerMode;
  timerStarted: boolean;
  isIdle: boolean; 
  lockedTimerMode: TimerMode | null;
  pomodoroCount: number;
  allPauseActive: boolean;
  allPauseTime: number;
  
  // Grace Mode
  graceOpen: boolean;
  graceContext: 'afterWork' | 'afterBreak' | null;
  graceTotal: number;

  tasks: Task[];
  pastSessions: SessionRecord[];
  categories: Category[];
  logs: LogEntry[];
  settings: TimerSettings;
  selectedCategoryId: number | null;
  activeTask: Task | null;
  activeColor?: string;
  scheduleBreaks: ScheduleBreak[];
  scheduleStartTime: string;
  sessionStartTime: string | null;
  delayedStartTargetTime: string | null;
  timerActivityStartTime: string | null;
  focusTimerDisplayOffsetSeconds: number;
  isScheduleOpen: boolean;
  isWeeklyScheduleOpen: boolean;
  showCompletedTasks: boolean;

  showSummary: boolean;
  sessionStats: SessionStats | null;

  // Group Study State
  groupSessionId: string | null;
  userName: string;
  isHost: boolean;
  members: GroupMember[];
  peerError: string | null;
  hostSyncConfig: GroupSyncConfig;
  clientSyncConfig: GroupSyncConfig; // What the joiner chooses to accept
  pendingJoinId: string | null;
  pendingMenuAction: PendingMenuAction | null;
  groupNotice: GroupNotice | null;
  guestTimerLockNotice: GuestTimerLockNotice | null;
  accountSyncState: 'idle' | 'pending' | 'syncing' | 'synced' | 'error';
  accountSyncError: string | null;
  lastAccountSyncAt: number | null;
  isPreviewAccount: boolean;
  focusFriends: FocusFriendsState;
  focusFriendsLoading: boolean;
  focusFriendsError: string | null;
  focusFriendNotice: FocusFriendNotice | null;

  // Actions
  login: (username: string, password?: string) => Promise<AuthResult>;
  register: (username: string, password?: string) => Promise<AuthResult>;
  logout: () => void;
  syncAccountNow: () => Promise<boolean>;
  refreshAccountFromCloud: (options?: { force?: boolean }) => Promise<boolean>;
  refreshFocusFriends: (options?: { silent?: boolean }) => Promise<boolean>;
  sendFocusFriendRequest: (username: string) => Promise<AuthResult>;
  acceptFocusFriendInvite: (username: string) => Promise<AuthResult>;
  acceptFocusFriendRequest: (requestId: string) => Promise<AuthResult>;
  declineFocusFriendRequest: (requestId: string) => Promise<AuthResult>;
  removeFocusFriend: (username: string) => Promise<AuthResult>;
  sendFocusFriendEncouragement: (username: string, message: string) => Promise<AuthResult>;
  requestFocusFriendJoin: (username: string, message?: string) => Promise<AuthResult>;
  sendFocusFriendJoinInvite: (username: string, sessionId: string, message?: string) => Promise<AuthResult>;
  approveFocusFriendJoinRequest: (actionId: string, sessionId: string) => Promise<AuthResult>;
  declineFocusFriendJoinRequest: (actionId: string) => Promise<AuthResult>;
  markFocusFriendActionRead: (actionId: string) => Promise<AuthResult>;
  
  startTimer: () => void;
  stopTimer: () => void;
  toggleTimer: () => void;
  toggleTimerLock: (mode: TimerMode) => void;
  switchMode: () => void; 
  activateMode: (mode: TimerMode) => void;
  startDelayedStart: (minutes: number) => void;
  startAllPause: () => void;
  confirmAllPause: (reason: string) => void;
  endAllPause: () => void;
  resumeFromPause: (action: 'work' | 'break', adjustAmount: number, logPauseAs?: 'work' | 'break') => void;
  restartActiveTimer: (customSeconds?: number) => void;
  resolveGrace: (nextMode: 'work' | 'break', options?: { adjustWorkStart?: number, adjustBreakBalance?: number, logGraceAs?: 'work' | 'break' | 'grace' }) => void;
  endSession: (options?: { effectiveEndMs?: number; showSummary?: boolean }) => void;
  closeSummary: () => void;
  hardReset: () => void;
  
  // Group Actions
  createGroupSession: (name: string, config: GroupSyncConfig) => Promise<string>;
  joinGroupSession: (id: string, name: string, config: GroupSyncConfig) => Promise<void>;
  leaveGroupSession: () => void;
  updateHostSyncConfig: (config: GroupSyncConfig) => void;
  updateClientSyncConfig: (config: GroupSyncConfig) => void;
  setPendingJoinId: (id: string | null) => void;
  requestNewCategoryFlow: () => void;
  clearPendingMenuAction: () => void;
  dismissGuestTimerLockNotice: () => void;

  // Data Management
  addTask: (name: string, est: number, catId: number | null, parentId?: number, color?: string, isFuture?: boolean, scheduledStart?: string, scheduledDate?: string) => void;
  addDetailedTask: (task: Partial<Task> & { name: string, estimated: number }) => number;
  addSubtasksToTask: (parentId: number, subtasks: { name: string, est: number }[]) => void;
  updateTask: (task: Task) => void;
  deleteTask: (id: number) => void;
  selectTask: (id: number) => void;
  toggleTaskExpansion: (id: number) => void;
  moveTask: (fromId: number, toId: number) => void;
  moveSubtask: (fromParentId: number, toParentId: number, subId: number, targetSubId: number | null) => void;
  splitTask: (taskId: number, splitAt: number) => void;
  toggleTaskFuture: (taskId: number) => void;
  setTaskSchedule: (taskId: number, scheduledStart: string | undefined) => void;
  
  addCategory: (name: string, color: string, icon: string) => void;
  updateCategory: (cat: Category) => void;
  archiveCategory: (id: number) => void;
  deleteCategory: (id: number) => void;
  moveCategory: (fromId: number, toId: number) => void;
  selectCategory: (id: number | null) => void;
  updateSettings: (newSettings: TimerSettings) => void;
  clearLogs: () => void;
  addManualFocusLog: (minutes: number, note?: string, categoryId?: number | null) => void;
  resetTimers: () => void;
  setPomodoroCount: (count: number) => void;
  addScheduleBreak: (brk: ScheduleBreak) => void;
  deleteScheduleBreak: (id: string) => void;
  setScheduleStartTime: (time: string) => void;
  setScheduleOpen: (isOpen: boolean) => void;
  setWeeklyScheduleOpen: (isOpen: boolean) => void;
  setShowCompletedTasks: (show: boolean) => void;
}

const TimerContext = createContext<TimerContextType | undefined>(undefined);

// Storage Logic
const getGuestKey = () => 'doro_guest_data';
const getUserKey = (username: string) => `doro_user_${username}`;

const DEFAULT_SETTINGS: TimerSettings = {
  timerPreset: 'classic',
  workDuration: 1500, 
  shortBreakDuration: 300, 
  longBreakDuration: 900,
  longBreakInterval: 4, 
  twoInARowMode: false,
  miniPomoAutoStartBlock: 1,
  miniPomoAutoStartSoundEnabled: true,
  disableBlur: true,
  alarmSound: 'bell',
  twoInARowStartSound: 'chime',
  focusSound: 'off',
  focusSoundVolume: 100,
  themeMode: 'dark'
};

const normalizeAlarmSound = (sound: unknown): AlarmSound => {
  if (sound === 'tada') return 'twinkle';
  const validSounds: AlarmSound[] = [
    'bell', 'digital', 'chime', 'gong', 'pop', 'wood', 'marimba', 'crystal',
    'blade', 'cosmic', 'ripple', 'news', 'harp', 'pulse', 'beacon', 'bubbles',
    'pluck', 'flare', 'drift', 'orbit', 'twinkle', 'echo', 'sprout', 'comet',
  ];
  return validSounds.includes(sound as AlarmSound) ? sound as AlarmSound : 'bell';
};

const normalizeMiniPomoAutoStartBlock = (value: unknown, fallback: 1 | 2 | 3 | 4 = 1): 1 | 2 | 3 | 4 => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const safeValue = Math.floor(value);
  return safeValue === 1 || safeValue === 2 || safeValue === 3 || safeValue === 4
    ? safeValue
    : fallback;
};

const normalizeSettings = (settings?: Partial<TimerSettings> | null): TimerSettings => {
  const source = settings || {};
  const fallbackMiniPomoBlock = source.twoInARowMode ? 2 : 1;
  const nextSettings: TimerSettings = {
    ...DEFAULT_SETTINGS,
    ...source,
  };
  nextSettings.alarmSound = normalizeAlarmSound(source.alarmSound);
  nextSettings.twoInARowStartSound = normalizeAlarmSound(source.twoInARowStartSound);
  nextSettings.miniPomoAutoStartBlock = normalizeMiniPomoAutoStartBlock(
    source.miniPomoAutoStartBlock,
    fallbackMiniPomoBlock,
  );
  nextSettings.miniPomoAutoStartSoundEnabled = source.miniPomoAutoStartSoundEnabled !== false;
  const hasExplicitPreset = Object.prototype.hasOwnProperty.call(source, 'timerPreset');
  const presetIsValid = (
    nextSettings.timerPreset === 'classic'
    || nextSettings.timerPreset === 'compact'
    || nextSettings.timerPreset === 'focus'
    || nextSettings.timerPreset === 'custom'
  );

  if (!hasExplicitPreset || !presetIsValid) {
    nextSettings.timerPreset = getMatchingTimerPreset(nextSettings);
  }

  if (nextSettings.timerPreset !== 'compact') {
    nextSettings.twoInARowMode = false;
    nextSettings.miniPomoAutoStartBlock = 1;
  } else {
    nextSettings.twoInARowMode = nextSettings.miniPomoAutoStartBlock > 1;
  }

  return nextSettings;
};

const DATA_SCHEMA_VERSION = 2;
const LEGACY_RUNTIME_FLAG = 'doro_use_legacy_tick';
const CROSS_TAB_CHANNEL = 'doro_timer_sync';
const AUTH_TOKEN_KEY = 'doro_auth_token';
const PREVIEW_ACCOUNT_USERNAME = 'preview';
const PREVIEW_ACCOUNT_PASSWORD = 'master';
const PREVIEW_AUTH_TOKEN = 'doro_preview_master_token';
const DEBUG_FOCUS_FRIEND_CREDENTIALS: Record<string, string> = {
  master: 'master',
  master2: 'master2',
  master3: 'master3',
  master4: 'master4',
  master5: 'master5',
};

const GROUP_EVENT_TYPES: GroupEventType[] = [
  'joined',
  'timer-started',
  'timer-stopped',
  'timer-paused',
  'timer-resumed',
  'mode-switched',
  'timer-reset',
  'grace-resolved',
];

const SPECTATOR_ENCOURAGEMENT_MAX_LENGTH = 180;
const SPECTATOR_ENCOURAGEMENT_MIN_INTERVAL_MS = 1200;

const isSpectatorConnection = (connection: Pick<DataConnection, 'metadata'> | null | undefined) => (
  Boolean(connection && (connection.metadata as any)?.spectator === true)
);

const isGroupEventType = (value: unknown): value is GroupEventType => {
  return typeof value === 'string' && GROUP_EVENT_TYPES.includes(value as GroupEventType);
};

const normalizeSpectatorEncouragementMessage = (value: unknown) => {
  const normalized = typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim()
    : '';
  return normalized.slice(0, SPECTATOR_ENCOURAGEMENT_MAX_LENGTH);
};

const getDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getStartOfLocalDayMs = (ms: number) => {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const getLogEndMs = (entry: Pick<LogEntry, 'start' | 'end' | 'duration'>) => {
  const startMs = Date.parse(entry.start);
  let endMs = Date.parse(entry.end);
  if (Number.isFinite(endMs)) return endMs;
  if (!Number.isFinite(startMs) || !Number.isFinite(entry.duration) || entry.duration <= 0) return null;
  endMs = startMs + (entry.duration * 1000);
  return Number.isFinite(endMs) ? endMs : null;
};

const getTodayPomodoroCountFromLogs = (entries: LogEntry[], nowMs: number) => {
  if (!Array.isArray(entries) || entries.length === 0) return 0;
  const todayStartMs = getStartOfLocalDayMs(nowMs);
  const tomorrowStartMs = todayStartMs + (24 * 60 * 60 * 1000);

  return entries.reduce((total, entry) => {
    if (!entry) return total;
    const endMs = getLogEndMs(entry);
    if (endMs === null || endMs < todayStartMs || endMs >= tomorrowStartMs) return total;
    return total + getAccountStatsPomodoroEquivalent(entry);
  }, 0);
};

const isPreviewAuthToken = (value: string | null | undefined) => value === PREVIEW_AUTH_TOKEN;

const isPreviewAccountCredentials = (username: string, password?: string) => {
  return username.trim().toLowerCase() === PREVIEW_ACCOUNT_USERNAME && password === PREVIEW_ACCOUNT_PASSWORD;
};

const isDebugFocusFriendCredentials = (username: string, password?: string) => {
  const normalized = username.trim().toLowerCase();
  return typeof password === 'string' && DEBUG_FOCUS_FRIEND_CREDENTIALS[normalized] === password;
};

const getScheduleStartLabel = (date: Date) => {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
};

const getDelayedStartTargetDate = (minutes: number, now: Date = new Date()) => {
  const safeMinutes = Number.isFinite(minutes) ? Math.min(30, Math.max(1, Math.round(minutes))) : 5;
  const target = new Date(now);
  target.setSeconds(0, 0);
  target.setMinutes(target.getMinutes() + safeMinutes);
  if (target.getTime() <= now.getTime()) {
    target.setMinutes(target.getMinutes() + 1);
  }
  return target;
};

const normalizeFocusTimerDisplayOffsetSeconds = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
);

const isDeferredTaskFromToday = (task: Pick<Task, 'isFuture' | 'scheduledDate'>, todayKey: string = getDateKey(new Date())) => {
  if (task.isFuture) return true;
  return typeof task.scheduledDate === 'string' && task.scheduledDate > todayKey;
};

let lastTaskIdSeed = 0;
const createTaskId = () => {
  const candidate = Date.now();
  if (candidate <= lastTaskIdSeed) {
    lastTaskIdSeed += 1;
  } else {
    lastTaskIdSeed = candidate;
  }
  return lastTaskIdSeed;
};

const isSelectableTask = (task: Pick<Task, 'checked' | 'isFuture' | 'scheduledDate'>, todayKey: string = getDateKey(new Date())) => (
  !task.checked && !isDeferredTaskFromToday(task, todayKey)
);

const getUniqueTaskId = (candidateId: unknown, usedIds: Set<number>): number => {
  let nextId = typeof candidateId === 'number' && Number.isFinite(candidateId)
    ? Math.floor(candidateId)
    : createTaskId();

  while (usedIds.has(nextId)) {
    nextId = createTaskId();
  }

  usedIds.add(nextId);
  return nextId;
};

const normalizeTaskIds = (tasks: Task[], usedIds: Set<number> = new Set()): Task[] => (
  tasks.map((task) => {
    const nextId = getUniqueTaskId(task.id, usedIds);
    const subtasks = Array.isArray(task.subtasks)
      ? normalizeTaskIds(task.subtasks, usedIds)
      : [];

    return {
      ...task,
      id: nextId,
      subtasks,
    };
  })
);

const normalizeTaskSelection = (
  tasks: Task[],
  options?: {
    preferredSelectedId?: number | null;
    selectFirstAvailableIfNoSelection?: boolean;
    todayKey?: string;
  },
): Task[] => {
  const todayKey = options?.todayKey || getDateKey(new Date());
  const preferredSelectedId = options && Object.prototype.hasOwnProperty.call(options, 'preferredSelectedId')
    ? options.preferredSelectedId
    : undefined;
  let selectedCount = 0;
  let firstSelectedSelectableId: number | null = null;
  let firstSelectableId: number | null = null;
  let preferredIsSelectable = false;

  const visit = (items: Task[]) => {
    items.forEach((task) => {
      const selectable = isSelectableTask(task, todayKey);
      if (selectable && firstSelectableId === null) firstSelectableId = task.id;
      if (task.selected) {
        selectedCount += 1;
        if (selectable && firstSelectedSelectableId === null) firstSelectedSelectableId = task.id;
      }
      if (preferredSelectedId !== undefined && task.id === preferredSelectedId && selectable) {
        preferredIsSelectable = true;
      }
      if (task.subtasks.length > 0) visit(task.subtasks);
    });
  };

  visit(tasks);

  let targetSelectedId: number | null = null;
  if (preferredSelectedId !== undefined) {
    targetSelectedId = preferredIsSelectable ? preferredSelectedId : null;
  } else if (selectedCount > 0) {
    targetSelectedId = firstSelectedSelectableId ?? firstSelectableId;
  } else if (options?.selectFirstAvailableIfNoSelection) {
    targetSelectedId = firstSelectableId;
  }

  const applySelection = (items: Task[]): Task[] => (
    items.map(task => ({
      ...task,
      selected: targetSelectedId !== null && task.id === targetSelectedId,
      subtasks: applySelection(task.subtasks),
    }))
  );

  return applySelection(tasks);
};

const hasSelectedSelectableTask = (tasks: Task[], todayKey: string = getDateKey(new Date())): boolean => {
  for (const task of tasks) {
    if (task.selected && isSelectableTask(task, todayKey)) return true;
    if (task.subtasks.length > 0 && hasSelectedSelectableTask(task.subtasks, todayKey)) return true;
  }
  return false;
};

const normalizeTaskState = (
  tasks: Task[],
  options?: {
    preferredSelectedId?: number | null;
    selectFirstAvailableIfNoSelection?: boolean;
    todayKey?: string;
  },
): Task[] => normalizeTaskSelection(normalizeTaskIds(tasks), options);

let lastCategoryIdSeed = 0;
const getMaxCategoryId = (categories: Category[]): number => (
  categories.reduce((maxId, category) => {
    if (typeof category.id === 'number' && Number.isFinite(category.id)) {
      return Math.max(maxId, Math.floor(category.id));
    }
    return maxId;
  }, 0)
);

const createCategoryId = (categories: Category[]) => {
  const candidate = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  const currentMax = getMaxCategoryId(categories);
  if (candidate <= lastCategoryIdSeed || candidate <= currentMax) {
    lastCategoryIdSeed = Math.max(lastCategoryIdSeed, currentMax) + 1;
  } else {
    lastCategoryIdSeed = candidate;
  }
  return lastCategoryIdSeed;
};

// Recursive Helpers for Tasks
const recalculateStats = (task: Task): Task => {
  if (task.subtasks.length > 0) {
    const updatedSubtasks = task.subtasks.map(recalculateStats);
    const sumEst = updatedSubtasks.reduce((acc, t) => acc + t.estimated, 0);
    const sumComp = updatedSubtasks.reduce((acc, t) => acc + t.completed, 0);
    
    return { 
      ...task, 
      subtasks: updatedSubtasks, 
      estimated: sumEst > 0 ? sumEst : task.estimated,
      completed: sumComp
    };
  }
  return task;
};

const findTask = (tasks: Task[], id: number): Task | null => {
  for (const task of tasks) {
    if (task.id === id) return task;
    if (task.subtasks.length > 0) {
      const found = findTask(task.subtasks, id);
      if (found) return found;
    }
  }
  return null;
};

const updateTaskInTree = (tasks: Task[], updatedTask: Task): Task[] => {
  return tasks.map(t => {
    if (t.id === updatedTask.id) return recalculateStats(updatedTask);
    if (t.subtasks.length > 0) {
      const newSubtasks = updateTaskInTree(t.subtasks, updatedTask);
      return recalculateStats({ ...t, subtasks: newSubtasks });
    }
    return t;
  });
};

const deleteTaskInTree = (tasks: Task[], id: number): Task[] => {
  return tasks
    .filter(t => t.id !== id)
    .map(t => {
        const newSubtasks = deleteTaskInTree(t.subtasks, id);
        return recalculateStats({ ...t, subtasks: newSubtasks });
    });
};

const addTaskToTree = (tasks: Task[], parentId: number, newTask: Task): Task[] => {
  return tasks.map(t => {
    if (t.id === parentId) {
      const updated = { ...t, subtasks: [...t.subtasks, newTask], isExpanded: true };
      return recalculateStats(updated);
    }
    if (t.subtasks.length > 0) {
      const newSubtasks = addTaskToTree(t.subtasks, parentId, newTask);
      return recalculateStats({ ...t, subtasks: newSubtasks });
    }
    return t;
  });
};

const findSelectedTask = (tasks: Task[]): Task | null => {
  for (const task of tasks) {
    if (task.selected) return task;
    const childSelected = findSelectedTask(task.subtasks);
    if (childSelected) return childSelected;
  }
  return null;
};

const flattenTasks = (tasks: Task[]): Task[] => {
    let flat: Task[] = [];
    tasks.forEach(t => {
        flat.push(t);
        if (t.subtasks.length > 0) {
            flat = flat.concat(flattenTasks(t.subtasks));
        }
    });
    return flat;
};

const getCheckedTaskIdSet = (tasks: Task[]) => (
  new Set(
    flattenTasks(tasks)
      .filter(task => task.checked && typeof task.id === 'number' && Number.isFinite(task.id))
      .map(task => task.id),
  )
);

const getMaxTaskId = (tasks: Task[]): number => {
  let maxId = 0;
  tasks.forEach((task) => {
    if (typeof task.id === 'number' && Number.isFinite(task.id)) {
      maxId = Math.max(maxId, Math.floor(task.id));
    }
    if (task.subtasks.length > 0) {
      maxId = Math.max(maxId, getMaxTaskId(task.subtasks));
    }
  });
  return maxId;
};

const findActiveContext = (tasks: Task[], parentColor?: string, parentCategoryId: number | null = null): { task: Task | null, color?: string, categoryId: number | null } => {
  for (const task of tasks) {
    const currentColor = task.color || parentColor;
    const currentCategoryId = typeof task.categoryId === 'number' && Number.isFinite(task.categoryId)
      ? task.categoryId
      : parentCategoryId;
    if (task.selected) {
      return { task: task, color: currentColor, categoryId: currentCategoryId };
    }
    if (task.subtasks.length > 0) {
      const found = findActiveContext(task.subtasks, currentColor, currentCategoryId);
      if (found.task) return found;
    }
  }
  return { task: null, color: undefined, categoryId: null };
};

const incrementCompletedInTree = (tasks: Task[], id: number): Task[] => {
  return tasks.map(t => {
    if (t.id === id) {
        return recalculateStats({ ...t, completed: t.completed + 1 });
    }
    if (t.subtasks.length > 0) {
      const newSubtasks = incrementCompletedInTree(t.subtasks, id);
      return recalculateStats({ ...t, subtasks: newSubtasks });
    }
    return t;
  });
};

const removeCompletedTasks = (tasks: Task[]): Task[] => {
    return tasks
        .filter(t => !t.checked) // Remove checked
        .map(t => ({
            ...t,
            subtasks: removeCompletedTasks(t.subtasks)
        }));
};

const clearCategoryFromTasks = (tasks: Task[], categoryId: number): Task[] => {
  let changed = false;

  const nextTasks = tasks.map((task) => {
    const nextSubtasks = task.subtasks.length > 0 ? clearCategoryFromTasks(task.subtasks, categoryId) : task.subtasks;
    const nextCategoryId = task.categoryId === categoryId ? null : task.categoryId;
    const taskChanged = nextSubtasks !== task.subtasks || nextCategoryId !== task.categoryId;

    if (!taskChanged) {
      return task;
    }

    changed = true;
    return {
      ...task,
      categoryId: nextCategoryId,
      subtasks: nextSubtasks,
    };
  });

  return changed ? nextTasks : tasks;
};

interface TimerPersistencePayload {
  schemaVersion?: number;
  revision?: number;
  runtime?: TimerRuntimeSnapshot;
  settings?: TimerSettings;
  tasks?: Task[];
  pastSessions?: SessionRecord[];
  categories?: Category[];
  logs?: LogEntry[];
  pomodoroCount?: number;
  workTime?: number;
  breakTime?: number;
  activeMode?: TimerMode;
  timerStarted?: boolean;
  isIdle?: boolean;
  lockedTimerMode?: TimerMode | null;
  lockedTimerStartedAtMs?: number | null;
  allPauseActive?: boolean;
  allPauseTime?: number;
  allPauseReason?: string;
  allPauseStartTime?: number | null;
  graceOpen?: boolean;
  graceContext?: 'afterWork' | 'afterBreak' | null;
  graceTotal?: number;
  scheduleBreaks?: ScheduleBreak[];
  scheduleStartTime?: string;
  sessionStartTime?: string | null;
  delayedStartTargetTime?: string | null;
  focusTimerDisplayOffsetSeconds?: number;
  userName?: string;
  user?: User | null;
  updatedAt?: string;
}

type PersistedRuntimeTimerState = Pick<TimerPersistencePayload,
  | 'workTime'
  | 'breakTime'
  | 'activeMode'
  | 'timerStarted'
  | 'isIdle'
  | 'lockedTimerMode'
  | 'lockedTimerStartedAtMs'
  | 'pomodoroCount'
  | 'allPauseActive'
  | 'allPauseTime'
  | 'allPauseReason'
  | 'allPauseStartTime'
  | 'graceOpen'
  | 'graceContext'
  | 'graceTotal'
  | 'sessionStartTime'
  | 'delayedStartTargetTime'
  | 'scheduleStartTime'
  | 'focusTimerDisplayOffsetSeconds'
>;

const isRuntimeSnapshot = (value: any): value is TimerRuntimeSnapshot => {
  return !!value && typeof value === 'object' && value.version === TIMER_RUNTIME_VERSION && typeof value.updatedAtMs === 'number' && typeof value.phase === 'string';
};

const normalizeLockedTimerMode = (value: unknown): TimerMode | null => (
  value === 'work' || value === 'break' ? value : null
);

const normalizeLockedTimerState = (
  modeValue: unknown,
  startedAtValue: unknown,
  nowMs: number = Date.now(),
): { mode: TimerMode | null; startedAtMs: number | null } => {
  const mode = normalizeLockedTimerMode(modeValue);
  if (!mode) return { mode: null, startedAtMs: null };

  const startedAtMs = typeof startedAtValue === 'number' && Number.isFinite(startedAtValue)
    ? startedAtValue
    : nowMs;

  return isTimerLockExpired(startedAtMs, nowMs)
    ? { mode: null, startedAtMs: null }
    : { mode, startedAtMs };
};

const collapseHydratedGraceState = ({
  sourceTabId,
  nowMs,
  workTime,
  breakTime,
  activeMode,
}: {
  sourceTabId: string;
  nowMs: number;
  workTime: number;
  breakTime: number;
  activeMode: TimerMode;
}) => ({
  runtime: createRuntimeSnapshot({
    sourceTabId,
    phase: 'idle',
    nowMs,
    workTime,
    breakTime,
    allPauseTime: 0,
    graceTotal: 0,
    activityStartIso: null,
  }),
  activeMode: breakTime > 0 ? 'break' as const : activeMode,
  timerStarted: false,
  isIdle: true,
  allPauseActive: false,
  allPauseTime: 0,
  allPauseReason: '',
  allPauseStartTime: null as number | null,
  graceOpen: false,
  graceContext: null as GraceContext,
  graceTotal: 0,
  sessionStartTime: null as string | null,
  delayedStartTargetTime: null as string | null,
});

type PreviewBlockSeed = {
  categoryId: number;
  taskName: string;
  startHour: number;
  startMinute: number;
  durationMinutes: number;
};

const buildPreviewAccountPayload = (sourceTabId: string): TimerPersistencePayload => {
  const now = new Date();
  const joinedAt = new Date(now);
  joinedAt.setDate(joinedAt.getDate() - 120);
  joinedAt.setHours(9, 12, 0, 0);

  const categories: Category[] = [
    { id: 1, name: 'Deep Work', color: '#7CB4FF', icon: 'brain' },
    { id: 2, name: 'Writing', color: '#F5B27A', icon: 'notebook' },
    { id: 3, name: 'Planning', color: '#95D7A1', icon: 'calendar' },
    { id: 4, name: 'Creative', color: '#C6A2FF', icon: 'sparkles' },
    { id: 5, name: 'Health', color: '#F49AB1', icon: 'heart' },
  ];
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const templates: PreviewBlockSeed[][] = [
    [
      { categoryId: 1, taskName: 'Architecture review', startHour: 8, startMinute: 30, durationMinutes: 50 },
      { categoryId: 1, taskName: 'API cleanup', startHour: 9, startMinute: 35, durationMinutes: 45 },
      { categoryId: 3, taskName: 'Roadmap planning', startHour: 11, startMinute: 10, durationMinutes: 35 },
    ],
    [
      { categoryId: 2, taskName: 'Draft writing pass', startHour: 9, startMinute: 0, durationMinutes: 50 },
      { categoryId: 2, taskName: 'Edit notes', startHour: 10, startMinute: 5, durationMinutes: 40 },
      { categoryId: 4, taskName: 'Creative direction', startHour: 13, startMinute: 25, durationMinutes: 55 },
    ],
    [
      { categoryId: 1, taskName: 'Implementation sprint', startHour: 8, startMinute: 10, durationMinutes: 55 },
      { categoryId: 1, taskName: 'Testing pass', startHour: 10, startMinute: 0, durationMinutes: 45 },
      { categoryId: 5, taskName: 'Workout reset', startHour: 17, startMinute: 45, durationMinutes: 30 },
    ],
    [
      { categoryId: 3, taskName: 'Weekly planning', startHour: 8, startMinute: 45, durationMinutes: 35 },
      { categoryId: 2, taskName: 'Reading and notes', startHour: 10, startMinute: 20, durationMinutes: 50 },
      { categoryId: 4, taskName: 'Design polish', startHour: 14, startMinute: 10, durationMinutes: 45 },
      { categoryId: 1, taskName: 'Bug fix pass', startHour: 15, startMinute: 20, durationMinutes: 40 },
    ],
    [
      { categoryId: 5, taskName: 'Morning walk', startHour: 7, startMinute: 35, durationMinutes: 25 },
      { categoryId: 1, taskName: 'Focused build block', startHour: 9, startMinute: 15, durationMinutes: 50 },
      { categoryId: 2, taskName: 'Outline next draft', startHour: 11, startMinute: 5, durationMinutes: 35 },
    ],
  ];
  const activeDayOffsets = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 18, 19, 20, 22, 23, 24, 25, 27, 28, 29, 31, 32, 33];

  const logs: LogEntry[] = [];
  const pastSessions: SessionRecord[] = [];

  activeDayOffsets.forEach((dayOffset, index) => {
    const baseDate = new Date(now);
    baseDate.setHours(0, 0, 0, 0);
    baseDate.setDate(baseDate.getDate() - dayOffset);
    const template = templates[index % templates.length];
    const categoryMinutes = new Map<number, number>();
    let totalWorkMinutes = 0;
    let totalBreakMinutes = 0;
    let firstStartIso = '';
    let lastEndIso = '';

    template.forEach((seed, blockIndex) => {
      const category = categoryMap.get(seed.categoryId);
      if (!category) return;

      const start = new Date(baseDate);
      start.setHours(seed.startHour, seed.startMinute + (((dayOffset + blockIndex) % 3) * 5), 0, 0);
      const durationMinutes = seed.durationMinutes + ((dayOffset + blockIndex) % 2 === 0 ? 0 : 5);
      const end = new Date(start.getTime() + durationMinutes * 60_000);
      const workLog: LogEntry = {
        type: 'work',
        start: start.toISOString(),
        end: end.toISOString(),
        duration: durationMinutes * 60,
        reason: 'Pomodoro Complete',
        task: {
          id: 10_000 + (dayOffset * 10) + blockIndex,
          name: seed.taskName,
        },
        color: category.color,
        categoryId: category.id,
        categoryName: category.name,
        categoryColor: category.color,
        categoryIcon: category.icon,
      };
      logs.push(workLog);
      categoryMinutes.set(category.id, (categoryMinutes.get(category.id) || 0) + durationMinutes);
      totalWorkMinutes += durationMinutes;
      if (!firstStartIso) firstStartIso = workLog.start;
      lastEndIso = workLog.end;

      if (blockIndex < template.length - 1) {
        const breakMinutes = 10 + (((dayOffset + blockIndex) % 2) * 5);
        const breakStart = new Date(end);
        const breakEnd = new Date(breakStart.getTime() + breakMinutes * 60_000);
        logs.push({
          type: 'break',
          start: breakStart.toISOString(),
          end: breakEnd.toISOString(),
          duration: breakMinutes * 60,
          reason: 'Recovery Time',
          color: category.color,
          categoryId: category.id,
          categoryName: category.name,
          categoryColor: category.color,
          categoryIcon: category.icon,
        });
        totalBreakMinutes += breakMinutes;
        lastEndIso = breakEnd.toISOString();
      }
    });

    if (!firstStartIso || !lastEndIso) return;

    const closeStart = new Date(lastEndIso);
    const closeEnd = new Date(closeStart.getTime() + 5 * 60_000);
    logs.push({
      type: 'break',
      start: closeStart.toISOString(),
      end: closeEnd.toISOString(),
      duration: 5 * 60,
      reason: 'Session End',
    });
    totalBreakMinutes += 5;
    lastEndIso = closeEnd.toISOString();

    const categoryDetails: SessionCategoryStat[] = Array.from(categoryMinutes.entries()).map(([categoryId, minutes]) => {
      const category = categoryMap.get(categoryId)!;
      return {
        categoryId,
        categoryName: category.name,
        categoryColor: category.color,
        categoryIcon: category.icon,
        minutes,
      };
    });

    pastSessions.push({
      id: `preview-session-${getDateKey(new Date(firstStartIso))}-${index}`,
      startTime: firstStartIso,
      endTime: lastEndIso,
      stats: {
        totalWorkMinutes,
        totalBreakMinutes,
        pomosCompleted: template.length,
        tasksCompleted: Math.max(1, Math.round(template.length / 2)),
        categoryStats: Object.fromEntries(categoryDetails.map((detail) => [detail.categoryName || 'Uncategorized', detail.minutes])),
        categoryDetails,
      },
    });
  });

  logs.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  pastSessions.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));

  return {
    schemaVersion: DATA_SCHEMA_VERSION,
    revision: 1,
    runtime: createRuntimeSnapshot({
      sourceTabId,
      phase: 'idle',
      nowMs: now.getTime(),
      workTime: DEFAULT_SETTINGS.workDuration,
      breakTime: 0,
      allPauseTime: 0,
      graceTotal: 0,
      activityStartIso: null,
    }),
    settings: DEFAULT_SETTINGS,
    tasks: [],
    pastSessions,
    categories,
    logs,
    pomodoroCount: 0,
    workTime: DEFAULT_SETTINGS.workDuration,
    breakTime: 0,
    activeMode: 'work',
    timerStarted: false,
    isIdle: true,
    lockedTimerMode: null,
    lockedTimerStartedAtMs: null,
    allPauseActive: false,
    allPauseTime: 0,
    allPauseReason: '',
    allPauseStartTime: null,
    graceOpen: false,
    graceContext: null,
    graceTotal: 0,
    scheduleBreaks: [],
    scheduleStartTime: '08:30',
    sessionStartTime: null,
    delayedStartTargetTime: null,
    focusTimerDisplayOffsetSeconds: 0,
    userName: 'Master Preview',
    user: {
      username: PREVIEW_ACCOUNT_USERNAME,
      joinedAt: joinedAt.toISOString(),
      lifetimeStats: { ...EMPTY_LIFETIME_STATS },
    },
    updatedAt: now.toISOString(),
  };
};

export const TimerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isDevMode = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const [user, setUser] = useState<User | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem(AUTH_TOKEN_KEY));
  const isPreviewAccount = isPreviewAuthToken(authToken);
  const [accountSyncState, setAccountSyncState] = useState<'idle' | 'pending' | 'syncing' | 'synced' | 'error'>('idle');
  const [accountSyncError, setAccountSyncError] = useState<string | null>(null);
  const [lastAccountSyncAt, setLastAccountSyncAt] = useState<number | null>(null);
  const [accountTimerSyncNonce, bumpAccountTimerSyncNonce] = useReducer((value: number) => value + 1, 0);
  const [focusFriends, setFocusFriends] = useState<FocusFriendsState>(EMPTY_FOCUS_FRIENDS_STATE);
  const [focusFriendsLoading, setFocusFriendsLoading] = useState(false);
  const [focusFriendsError, setFocusFriendsError] = useState<string | null>(null);
  const [focusFriendNotice, setFocusFriendNotice] = useState<FocusFriendNotice | null>(null);
  
  const [settings, setSettings] = useState<TimerSettings>(DEFAULT_SETTINGS);
  const [workTime, setWorkTime] = useState(1500);
  const [breakTime, setBreakTime] = useState(0); 
  const [activeMode, setActiveMode] = useState<TimerMode>('work');
  const [timerStarted, setTimerStarted] = useState(false);
  const [isIdle, setIsIdle] = useState(true); 
  const [lockedTimerMode, setLockedTimerMode] = useState<TimerMode | null>(null);
  const [lockedTimerStartedAtMs, setLockedTimerStartedAtMs] = useState<number | null>(null);
  const [pomodoroCount, setPomodoroCount] = useState(0);
  
  const [allPauseActive, setAllPauseActive] = useState(false);
  const [allPauseTime, setAllPauseTime] = useState(0);
  const [allPauseReason, setAllPauseReason] = useState('');
  const [allPauseStartTime, setAllPauseStartTime] = useState<number | null>(null);

  const [graceOpen, setGraceOpen] = useState(false);
  const [graceContext, setGraceContext] = useState<'afterWork' | 'afterBreak' | null>(null);
  const [graceTotal, setGraceTotal] = useState(0);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [pastSessions, setPastSessions] = useState<SessionRecord[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [scheduleBreaks, setScheduleBreaks] = useState<ScheduleBreak[]>([]);
  const [scheduleStartTime, setScheduleStartTime] = useState<string>('08:00');
  const [sessionStartTime, setSessionStartTime] = useState<string | null>(null);
  const [delayedStartTargetTime, setDelayedStartTargetTime] = useState<string | null>(null);
  const [focusTimerDisplayOffsetSeconds, setFocusTimerDisplayOffsetSeconds] = useState(0);
  const [isScheduleOpen, setScheduleOpen] = useState(false);
  const [isWeeklyScheduleOpen, setWeeklyScheduleOpen] = useState(false);
  const [showCompletedTasks, setShowCompletedTasks] = useState(false);

  const [showSummary, setShowSummary] = useState(false);
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null);

  // Group Study State
  const [groupSessionId, setGroupSessionId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [isHost, setIsHost] = useState(false);
  const [peerError, setPeerError] = useState<string | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [hostSyncConfig, setHostSyncConfig] = useState<GroupSyncConfig>(DEFAULT_SYNC_CONFIG);
  const [clientSyncConfig, setClientSyncConfig] = useState<GroupSyncConfig>(DEFAULT_SYNC_CONFIG);
  const [pendingJoinId, setPendingJoinId] = useState<string | null>(null);
  const [pendingMenuAction, setPendingMenuAction] = useState<PendingMenuAction | null>(null);
  const [groupNotice, setGroupNotice] = useState<GroupNotice | null>(null);
  const [guestTimerLockNotice, setGuestTimerLockNotice] = useState<GuestTimerLockNotice | null>(null);
  const hostSyncConfigRef = useRef<GroupSyncConfig>(DEFAULT_SYNC_CONFIG);
  const clientSyncConfigRef = useRef<GroupSyncConfig>(DEFAULT_SYNC_CONFIG);
  const groupSessionIdRef = useRef<string | null>(null);
  const userNameRef = useRef<string>('');
  const isHostRef = useRef(false);
  const activeModeRef = useRef<TimerMode>('work');
  
  const isRemoteUpdate = useRef(false);
  const remoteUpdateVersionRef = useRef(0);
  const remoteUpdateClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<DataConnection[]>([]);
  const lastClientTimerBroadcastSignatureRef = useRef<string | null>(null);
  const localPeerIdRef = useRef<string | null>(null);
  const memberNamesRef = useRef<Record<string, string>>({});
  const announcedPeerIdsRef = useRef<Set<string>>(new Set());
  const seenGroupEventIdsRef = useRef<Set<string>>(new Set());
  const spectatorEncouragementLastAtRef = useRef<Record<string, number>>({});
  const groupLifecycleRef = useRef(0);
  const clientReadyForBroadcastRef = useRef(true);
  const currentGroupStateRef = useRef<any>(null);
  const logsRef = useRef<LogEntry[]>([]);
  const sessionTaskBaselineRef = useRef<{ sessionStartTime: string; checkedTaskIds: Set<number> } | null>(null);
  const taskCompletionWatcherRef = useRef<{ sessionStartTime: string | null; checkedTaskIds: Set<number> }>({
    sessionStartTime: null,
    checkedTaskIds: new Set(),
  });

  const lastTickRef = useRef<number | null>(null);
  const shadowTickRef = useRef<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const currentActivityStartRef = useRef<Date | null>(null);
  const delayedStartTargetTimeRef = useRef<string | null>(null);
  const lastLoopTimeRef = useRef<number>(0);
  const lastBreakBoundaryAlertPhaseRef = useRef<number | null>(null);
  const focusTimerAutoEndedBreakStartRef = useRef<number | null>(null);
  const previousLegacyBreakTimeRef = useRef<number | null>(null);
  const isProcessingRef = useRef(false);
  const isResolvingGraceRef = useRef(false);
  const skipSaveRef = useRef(false);
  const isCloudSyncInFlightRef = useRef(false);
  const isApplyingCloudSnapshotRef = useRef(false);
  const accountSyncVersionRef = useRef(0);
  const hasPendingLocalAccountChangesRef = useRef(false);
  const pendingAccountSyncAfterInFlightRef = useRef(false);
  const syncAccountNowRef = useRef<(() => Promise<boolean>) | null>(null);
  const accountRevisionRef = useRef(0);
  const hasHydratedCloudForUserRef = useRef<string | null>(null);
  const seenFocusFriendActionIdsRef = useRef<Set<string>>(new Set());
  const seenFocusFriendRequestIdsRef = useRef<Set<string>>(new Set());
  const focusFriendsSnapshotKeyRef = useRef('');
  const focusFriendsRefreshInFlightRef = useRef(false);
  const focusFriendPresenceInFlightRef = useRef(false);
  const focusFriendsMutationVersionRef = useRef(0);
  const tabIdRef = useRef(`tab_${Math.random().toString(36).slice(2, 10)}`);
  const runtimeRef = useRef<TimerRuntimeSnapshot>(createRuntimeSnapshot({
    sourceTabId: tabIdRef.current,
    phase: 'idle',
    nowMs: Date.now(),
    workTime: DEFAULT_SETTINGS.workDuration,
    breakTime: 0,
    allPauseTime: 0,
    graceTotal: 0,
    activityStartIso: null,
  }));
  const lastRuntimeAppliedRef = useRef<number>(runtimeRef.current.updatedAtMs);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const pendingPostLoadReconcileRef = useRef(false);
  const pendingRuntimeMigrationRef = useRef(false);
  const isCrossTabApplyingRef = useRef(false);
  const lastExternalPayloadAppliedAtRef = useRef(0);
  const [legacyRuntimeMode, setLegacyRuntimeMode] = useState(() => {
    try {
      return localStorage.getItem(LEGACY_RUNTIME_FLAG) === '1';
    } catch {
      return false;
    }
  });

  groupSessionIdRef.current = groupSessionId;
  userNameRef.current = userName;
  isHostRef.current = isHost;
  logsRef.current = logs;
  delayedStartTargetTimeRef.current = delayedStartTargetTime;
  currentGroupStateRef.current = {
    settings,
    tasks,
    categories,
    logs,
    activeMode,
    timerStarted,
    isIdle,
    lockedTimerMode: settings.timerPreset === 'focus' ? null : lockedTimerMode,
    lockedTimerStartedAtMs: settings.timerPreset === 'focus' ? null : lockedTimerStartedAtMs,
    workTime,
    breakTime,
    pomodoroCount,
    scheduleBreaks,
    scheduleStartTime,
    sessionStartTime,
    delayedStartTargetTime,
    focusTimerDisplayOffsetSeconds,
    allPauseActive,
    allPauseTime,
    allPauseReason,
    allPauseStartTime,
    graceOpen,
    graceContext,
    graceTotal,
    userName,
  };

  useEffect(() => {
    hostSyncConfigRef.current = hostSyncConfig;
  }, [hostSyncConfig]);

  useEffect(() => {
    clientSyncConfigRef.current = clientSyncConfig;
  }, [clientSyncConfig]);

  useEffect(() => {
    activeModeRef.current = activeMode;
  }, [activeMode]);

  const getActiveStorageKey = useCallback(() => {
    return user ? getUserKey(user.username) : getGuestKey();
  }, [user]);

  const persistRuntimeSnapshot = useCallback((
    snapshot: TimerRuntimeSnapshot,
    overrideKey?: string,
    timerState?: Partial<PersistedRuntimeTimerState>,
  ) => {
    const key = overrideKey || getActiveStorageKey();
    const runtimeRunning = snapshot.phase === 'running-work' || snapshot.phase === 'running-break';
    const runtimeMode: TimerMode = timerState?.activeMode ?? (snapshot.phase === 'running-break' ? 'break' : activeMode);
    const runtimeGrace = normalizeGraceWindow({
      graceOpenCandidate: typeof timerState?.graceOpen === 'boolean' ? timerState.graceOpen : snapshot.phase === 'grace',
      rawGraceContext: timerState?.graceContext ?? graceContext,
      fallbackMode: runtimeMode,
    });
    try {
      const existingRaw = localStorage.getItem(key);
      const existing: TimerPersistencePayload = existingRaw ? JSON.parse(existingRaw) : {};
      const shouldSuppressTimerLock = settings.timerPreset === 'focus';
      const merged: TimerPersistencePayload = {
        ...existing,
        schemaVersion: DATA_SCHEMA_VERSION,
        runtime: snapshot,
        pomodoroCount: typeof timerState?.pomodoroCount === 'number' ? timerState.pomodoroCount : pomodoroCount,
        workTime: typeof timerState?.workTime === 'number' ? timerState.workTime : workTime,
        breakTime: typeof timerState?.breakTime === 'number' ? timerState.breakTime : breakTime,
        activeMode: runtimeMode,
        timerStarted: typeof timerState?.timerStarted === 'boolean' ? timerState.timerStarted : runtimeRunning,
        isIdle: typeof timerState?.isIdle === 'boolean' ? timerState.isIdle : snapshot.phase === 'idle',
        lockedTimerMode: shouldSuppressTimerLock ? null : (timerState?.lockedTimerMode !== undefined ? timerState.lockedTimerMode : lockedTimerMode),
        lockedTimerStartedAtMs: shouldSuppressTimerLock ? null : (timerState?.lockedTimerStartedAtMs !== undefined ? timerState.lockedTimerStartedAtMs : lockedTimerStartedAtMs),
        allPauseActive: typeof timerState?.allPauseActive === 'boolean' ? timerState.allPauseActive : snapshot.phase === 'all-pause',
        allPauseTime: typeof timerState?.allPauseTime === 'number' ? timerState.allPauseTime : allPauseTime,
        allPauseReason: timerState?.allPauseReason ?? allPauseReason,
        allPauseStartTime: timerState?.allPauseStartTime !== undefined ? timerState.allPauseStartTime : allPauseStartTime,
        graceOpen: runtimeGrace.graceOpen,
        graceContext: runtimeGrace.graceContext,
        graceTotal: runtimeGrace.graceOpen
          ? (typeof timerState?.graceTotal === 'number' ? timerState.graceTotal : snapshot.phaseStartGraceTotal)
          : 0,
        sessionStartTime: timerState?.sessionStartTime !== undefined ? timerState.sessionStartTime : sessionStartTime,
        delayedStartTargetTime: timerState?.delayedStartTargetTime !== undefined ? timerState.delayedStartTargetTime : delayedStartTargetTime,
        scheduleStartTime: timerState?.scheduleStartTime ?? scheduleStartTime,
        focusTimerDisplayOffsetSeconds: typeof timerState?.focusTimerDisplayOffsetSeconds === 'number'
          ? timerState.focusTimerDisplayOffsetSeconds
          : focusTimerDisplayOffsetSeconds,
      };
      localStorage.setItem(key, JSON.stringify(merged));
    } catch (error) {
      console.error('Failed to persist runtime snapshot', error);
    }
  }, [
    getActiveStorageKey,
    activeMode,
    breakTime,
    pomodoroCount,
    workTime,
    lockedTimerMode,
    lockedTimerStartedAtMs,
    allPauseTime,
    allPauseReason,
    allPauseStartTime,
    graceContext,
    scheduleStartTime,
    sessionStartTime,
    delayedStartTargetTime,
    focusTimerDisplayOffsetSeconds,
    settings.timerPreset,
  ]);

  const anchorRuntimePhase = useCallback((
    phase: TimerRuntimePhase,
    overrides?: Partial<Pick<TimerRuntimeSnapshot, 'phaseStartWorkTime' | 'phaseStartBreakTime' | 'phaseStartAllPauseTime' | 'phaseStartGraceTotal' | 'activityStartIso'>> & {
      activeMode?: TimerMode;
      timerStarted?: boolean;
      isIdle?: boolean;
      lockedTimerMode?: TimerMode | null;
      lockedTimerStartedAtMs?: number | null;
      allPauseActive?: boolean;
      allPauseTime?: number;
      allPauseReason?: string;
      allPauseStartTime?: number | null;
      graceOpen?: boolean;
      graceContext?: GraceContext;
      graceTotal?: number;
      pomodoroCount?: number;
      sessionStartTime?: string | null;
      delayedStartTargetTime?: string | null;
      scheduleStartTime?: string;
      focusTimerDisplayOffsetSeconds?: number;
    },
  ) => {
    const phaseWorkTime = overrides?.phaseStartWorkTime ?? workTime;
    const phaseBreakTime = overrides?.phaseStartBreakTime ?? breakTime;
    const phaseAllPause = overrides?.phaseStartAllPauseTime ?? overrides?.allPauseTime ?? allPauseTime;
    const phaseGraceTotal = phase === 'grace'
      ? (overrides?.phaseStartGraceTotal ?? overrides?.graceTotal ?? graceTotal)
      : 0;
    const phaseImpliesRunning = typeof overrides?.timerStarted === 'boolean'
      ? overrides.timerStarted
      : (phase === 'running-work' || phase === 'running-break');
    const phaseMode: TimerMode = overrides?.activeMode ?? (phase === 'running-break' ? 'break' : activeMode);
    const phaseGraceState = normalizeGraceWindow({
      graceOpenCandidate: typeof overrides?.graceOpen === 'boolean' ? overrides.graceOpen : phase === 'grace',
      rawGraceContext: overrides?.graceContext ?? graceContext,
      fallbackMode: phaseMode,
    });
    const snapshot = createRuntimeSnapshot({
      sourceTabId: tabIdRef.current,
      phase,
      nowMs: Date.now(),
      workTime: phaseWorkTime,
      breakTime: phaseBreakTime,
      allPauseTime: phaseAllPause,
      graceTotal: phaseGraceTotal,
      activityStartIso: overrides?.activityStartIso ?? (currentActivityStartRef.current ? currentActivityStartRef.current.toISOString() : null),
    });
    runtimeRef.current = snapshot;
    lastRuntimeAppliedRef.current = snapshot.updatedAtMs;
    const phaseTimerState: PersistedRuntimeTimerState = {
      activeMode: phaseMode,
      timerStarted: phaseImpliesRunning,
      isIdle: typeof overrides?.isIdle === 'boolean' ? overrides.isIdle : (phase === 'idle' ? isIdle : false),
      lockedTimerMode: overrides?.lockedTimerMode !== undefined ? overrides.lockedTimerMode : lockedTimerMode,
      lockedTimerStartedAtMs: overrides?.lockedTimerStartedAtMs !== undefined ? overrides.lockedTimerStartedAtMs : lockedTimerStartedAtMs,
      allPauseActive: typeof overrides?.allPauseActive === 'boolean' ? overrides.allPauseActive : phase === 'all-pause',
      allPauseTime: typeof overrides?.allPauseTime === 'number' ? overrides.allPauseTime : phaseAllPause,
      allPauseReason: overrides?.allPauseReason ?? allPauseReason,
      allPauseStartTime: overrides?.allPauseStartTime !== undefined ? overrides.allPauseStartTime : allPauseStartTime,
      graceOpen: phaseGraceState.graceOpen,
      graceContext: phaseGraceState.graceContext,
      graceTotal: phaseGraceState.graceOpen
        ? (typeof overrides?.graceTotal === 'number' ? overrides.graceTotal : phaseGraceTotal)
        : 0,
      workTime: phaseWorkTime,
      breakTime: phaseBreakTime,
      pomodoroCount: typeof overrides?.pomodoroCount === 'number' ? overrides.pomodoroCount : pomodoroCount,
      sessionStartTime: overrides?.sessionStartTime !== undefined ? overrides.sessionStartTime : sessionStartTime,
      delayedStartTargetTime: overrides?.delayedStartTargetTime !== undefined ? overrides.delayedStartTargetTime : delayedStartTargetTime,
      scheduleStartTime: overrides?.scheduleStartTime ?? scheduleStartTime,
      focusTimerDisplayOffsetSeconds: typeof overrides?.focusTimerDisplayOffsetSeconds === 'number'
        ? overrides.focusTimerDisplayOffsetSeconds
        : focusTimerDisplayOffsetSeconds,
    };
    persistRuntimeSnapshot(snapshot, undefined, phaseTimerState);
    if (broadcastChannelRef.current) {
      broadcastChannelRef.current.postMessage({
        type: 'RUNTIME_SYNC',
        key: getActiveStorageKey(),
        runtime: snapshot,
        timer: phaseTimerState,
      });
    }
    bumpAccountTimerSyncNonce();
  }, [workTime, breakTime, allPauseTime, graceTotal, persistRuntimeSnapshot, getActiveStorageKey, activeMode, isIdle, lockedTimerMode, lockedTimerStartedAtMs, allPauseReason, allPauseStartTime, graceContext, pomodoroCount, sessionStartTime, delayedStartTargetTime, scheduleStartTime, focusTimerDisplayOffsetSeconds]);

  // Load Data Helper
  const loadData = useCallback((username?: string) => {
      skipSaveRef.current = true; // Prevent save effect triggering during load
      const key = username ? getUserKey(username) : getGuestKey();
      const saved = localStorage.getItem(key);
      
      if (saved) {
        try {
            const parsed: TimerPersistencePayload = JSON.parse(saved);
            accountRevisionRef.current = getPayloadRevision(parsed);
            const rawParsedTasks = parsed.tasks || [];
            lastTaskIdSeed = Math.max(lastTaskIdSeed, getMaxTaskId(rawParsedTasks));
            const parsedTasks = normalizeTaskState(rawParsedTasks);
            const parsedSessions = parsed.pastSessions || [];
            const parsedCategories = parsed.categories || [];
            const parsedLogs = parsed.logs || [];
            const nextSettings = normalizeSettings(parsed.settings);
            setSettings(nextSettings);
            setTasks(parsedTasks);
            lastTaskIdSeed = Math.max(lastTaskIdSeed, getMaxTaskId(parsedTasks));
            setPastSessions(parsedSessions);
            setCategories(parsedCategories);
            lastCategoryIdSeed = Math.max(lastCategoryIdSeed, getMaxCategoryId(parsedCategories));
            setLogs(parsedLogs);
            setPomodoroCount(parsed.pomodoroCount || 0);
            setScheduleBreaks(parsed.scheduleBreaks || []);
            setFocusTimerDisplayOffsetSeconds(normalizeFocusTimerDisplayOffsetSeconds(parsed.focusTimerDisplayOffsetSeconds));
            const nextBreakTime = parsed.breakTime !== undefined ? parsed.breakTime : 0;
            const nextWorkTime = parsed.workTime !== undefined ? parsed.workTime : DEFAULT_SETTINGS.workDuration;
            const parsedTimerStarted = parsed.timerStarted !== undefined ? Boolean(parsed.timerStarted) : false;
            const parsedDelayedStartTargetTime = typeof parsed.delayedStartTargetTime === 'string' ? parsed.delayedStartTargetTime : null;
            const nextInitialIdle = parsedTimerStarted
              ? (parsed.isIdle !== undefined ? parsed.isIdle : false)
              : true;
            setBreakTime(nextBreakTime);
            setWorkTime(nextWorkTime);
            setActiveMode(parsed.activeMode || 'work');
            setIsIdle(nextInitialIdle);
            setDelayedStartTargetTime(parsedDelayedStartTargetTime);
            const parsedTimerLock = nextSettings.timerPreset === 'focus'
              ? { mode: null, startedAtMs: null }
              : normalizeLockedTimerState(parsed.lockedTimerMode, parsed.lockedTimerStartedAtMs);
            setLockedTimerMode(parsedTimerLock.mode);
            setLockedTimerStartedAtMs(parsedTimerLock.startedAtMs);
            
            if (username) {
                const baseUser = parsed.user && typeof parsed.user.joinedAt === 'string'
                  ? parsed.user
                  : {
                      username,
                      joinedAt: new Date().toISOString(),
                      lifetimeStats: { ...EMPTY_LIFETIME_STATS },
                    };
                const normalizedUsername = typeof baseUser.username === 'string' && baseUser.username.trim()
                  ? baseUser.username
                  : username;
                const recalculatedStats = calculateLifetimeStatsFromData(parsedSessions, parsedLogs, parsedCategories);
                setUser({
                  ...baseUser,
                  username: normalizedUsername,
                  lifetimeStats: recalculatedStats,
                });
                setUserName(normalizeStoredUserName(parsed.userName, normalizedUsername));
            } else {
                setUser(null);
                setUserName(normalizeStoredUserName(parsed.userName));
            }

            if (parsed.sessionStartTime) {
                setSessionStartTime(parsed.sessionStartTime);
                if (parsed.scheduleStartTime) setScheduleStartTime(parsed.scheduleStartTime);
            } else {
                 const now = new Date();
                 setScheduleStartTime(getScheduleStartLabel(now));
            }

            const hasRuntime = parsed.schemaVersion === DATA_SCHEMA_VERSION && isRuntimeSnapshot(parsed.runtime);
            if (hasRuntime && parsed.runtime) {
                const parsedMode = parsed.activeMode === 'work' || parsed.activeMode === 'break' ? parsed.activeMode : 'work';
                const nowMs = Date.now();
                const shouldDropRestoredGrace = shouldDiscardRestoredGrace({
                  snapshot: parsed.runtime,
                  sessionStartTime: parsed.sessionStartTime ?? null,
                  graceOpen: parsed.graceOpen,
                  nowMs,
                });
                const collapsedGraceState = shouldDropRestoredGrace
                  ? collapseHydratedGraceState({
                      sourceTabId: tabIdRef.current,
                      nowMs,
                      workTime: nextWorkTime,
                      breakTime: nextBreakTime,
                      activeMode: parsedMode,
                    })
                  : null;
                const hydratedRuntime = collapsedGraceState?.runtime || parsed.runtime;

                runtimeRef.current = hydratedRuntime;
                lastRuntimeAppliedRef.current = hydratedRuntime.updatedAtMs;
                const runtimeRunning = hydratedRuntime.phase === 'running-work' || hydratedRuntime.phase === 'running-break';
                const hydratedIsIdle = hydratedRuntime.phase === 'idle';
                setTimerStarted(
                  collapsedGraceState
                    ? collapsedGraceState.timerStarted
                    : (parsed.timerStarted !== undefined ? Boolean(parsed.timerStarted) : runtimeRunning),
                );
                setAllPauseActive(
                  collapsedGraceState
                    ? collapsedGraceState.allPauseActive
                    : (parsed.allPauseActive !== undefined ? Boolean(parsed.allPauseActive) : hydratedRuntime.phase === 'all-pause'),
                );
                setAllPauseTime(collapsedGraceState ? collapsedGraceState.allPauseTime : (parsed.allPauseTime || 0));
                setAllPauseReason(collapsedGraceState ? collapsedGraceState.allPauseReason : (parsed.allPauseReason || ''));
                setAllPauseStartTime(collapsedGraceState ? collapsedGraceState.allPauseStartTime : (parsed.allPauseStartTime ?? null));
                const parsedGrace = normalizeGraceWindow({
                  graceOpenCandidate: collapsedGraceState
                    ? false
                    : (parsed.graceOpen !== undefined ? Boolean(parsed.graceOpen) : hydratedRuntime.phase === 'grace'),
                  rawGraceContext: parsed.graceContext,
                  fallbackMode: parsedMode,
                });
                setGraceOpen(collapsedGraceState ? collapsedGraceState.graceOpen : parsedGrace.graceOpen);
                setGraceContext(collapsedGraceState ? collapsedGraceState.graceContext : parsedGrace.graceContext);
                setGraceTotal(
                  collapsedGraceState
                    ? collapsedGraceState.graceTotal
                    : (parsedGrace.graceOpen && typeof parsed.graceTotal === 'number' ? parsed.graceTotal : 0),
                );
                if (collapsedGraceState) {
                  setActiveMode(collapsedGraceState.activeMode);
                  setIsIdle(collapsedGraceState.isIdle);
                  setSessionStartTime(collapsedGraceState.sessionStartTime);
                  setDelayedStartTargetTime(null);
                  setFocusTimerDisplayOffsetSeconds(0);
                  currentActivityStartRef.current = null;
                  pendingRuntimeMigrationRef.current = true;
                } else {
                  if (hydratedRuntime.phase === 'running-break') setActiveMode('break');
                  if (hydratedRuntime.phase === 'running-work') setActiveMode('work');
                  setIsIdle(hydratedIsIdle);
                  currentActivityStartRef.current = hydratedRuntime.activityStartIso ? new Date(hydratedRuntime.activityStartIso) : null;
                }
            } else {
                // Legacy migration: keep remaining times but force a safe stopped state.
                setTimerStarted(false);
                setIsIdle(true);
                setAllPauseActive(false);
                setAllPauseTime(0);
                setAllPauseReason('');
                setAllPauseStartTime(null);
                setGraceOpen(false);
                setGraceContext(null);
                setGraceTotal(0);
                setDelayedStartTargetTime(null);
                currentActivityStartRef.current = null;
                runtimeRef.current = createRuntimeSnapshot({
                    sourceTabId: tabIdRef.current,
                    phase: 'idle',
                    nowMs: Date.now(),
                    workTime: nextWorkTime,
                    breakTime: nextBreakTime,
                    allPauseTime: 0,
                    graceTotal: 0,
                    activityStartIso: null,
                });
                lastRuntimeAppliedRef.current = runtimeRef.current.updatedAtMs;
                pendingRuntimeMigrationRef.current = true;
             }
         } catch (e) {
            accountRevisionRef.current = 0;
            console.error("Failed to load", e);
         }
       } else {
           // Defaults for new user or guest
          accountRevisionRef.current = 0;
          setSettings(DEFAULT_SETTINGS);
          setTasks([]);
          setPastSessions([]);
          setLogs([]);
          setCategories([]);
          setPomodoroCount(0);
          setFocusTimerDisplayOffsetSeconds(0);
          setBreakTime(0);
          setWorkTime(DEFAULT_SETTINGS.workDuration);
          setActiveMode('work');
          setTimerStarted(false);
          setIsIdle(true);
          setLockedTimerMode(null);
          setLockedTimerStartedAtMs(null);
          setAllPauseActive(false);
          setAllPauseTime(0);
          setAllPauseReason('');
          setAllPauseStartTime(null);
          setGraceOpen(false);
          setGraceContext(null);
          setGraceTotal(0);
          setDelayedStartTargetTime(null);
          const now = new Date();
          setScheduleStartTime(getScheduleStartLabel(now));
           if (username) {
               setUser({ 
                   username, 
                   joinedAt: new Date().toISOString(), 
                   lifetimeStats: { ...EMPTY_LIFETIME_STATS } 
               });
               setUserName(username);
           } else {
               setUser(null);
               setUserName('');
           }
          currentActivityStartRef.current = null;
          runtimeRef.current = createRuntimeSnapshot({
            sourceTabId: tabIdRef.current,
            phase: 'idle',
            nowMs: Date.now(),
            workTime: DEFAULT_SETTINGS.workDuration,
            breakTime: 0,
            allPauseTime: 0,
            graceTotal: 0,
            activityStartIso: null,
          });
          lastRuntimeAppliedRef.current = runtimeRef.current.updatedAtMs;
          pendingRuntimeMigrationRef.current = true;
      }
      pendingPostLoadReconcileRef.current = true;
      setTimeout(() => { skipSaveRef.current = false; }, 100);
  }, []);

  const applyAccountSnapshot = useCallback((accountUsername: string, payload: TimerPersistencePayload) => {
      isApplyingCloudSnapshotRef.current = true;
      try {
          accountRevisionRef.current = getPayloadRevision(payload);
          localStorage.setItem(getUserKey(accountUsername), JSON.stringify(payload));
          localStorage.setItem('doro_last_user', accountUsername);
          setUserName(normalizeStoredUserName(payload.userName, accountUsername));
          loadData(accountUsername);
      } finally {
          isApplyingCloudSnapshotRef.current = false;
      }
  }, [loadData]);

  // Initial Load
  useEffect(() => {
      const lastUser = localStorage.getItem('doro_last_user');
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      if (lastUser && token) {
          loadData(lastUser);
      } else {
          if (!token) {
            localStorage.removeItem('doro_last_user');
            setAuthToken(null);
          }
          loadData();
      }
  }, [loadData]);

  // Auth Methods with Sync Logic
  const calculateLifetimeStats = (
    sessions: SessionRecord[],
    currentLogs: LogEntry[],
    _joinedAt: string,
    sourceCategories?: Category[],
  ) => {
    return calculateLifetimeStatsFromData(sessions, currentLogs, sourceCategories || categories);
  };

  const buildPersistencePayload = useCallback((options?: {
    updatedAt?: string;
    revision?: number;
    userOverride?: User | null;
  }): TimerPersistencePayload => {
    const effectiveUser = options?.userOverride === undefined ? user : options.userOverride;
    const nextLifetimeStats = effectiveUser
      ? calculateLifetimeStatsFromData(pastSessions, logs, categories)
      : null;
    const payloadUser = effectiveUser
      ? {
          ...effectiveUser,
          lifetimeStats: nextLifetimeStats || effectiveUser.lifetimeStats,
        }
      : null;

    return {
      schemaVersion: DATA_SCHEMA_VERSION,
      revision: options?.revision ?? accountRevisionRef.current,
      runtime: runtimeRef.current,
      settings,
      tasks,
      pastSessions,
      categories,
      logs,
      pomodoroCount,
      workTime,
      breakTime,
      activeMode,
      timerStarted,
      isIdle: runtimeRef.current.phase === 'idle' ? true : isIdle,
      lockedTimerMode: settings.timerPreset === 'focus' ? null : lockedTimerMode,
      lockedTimerStartedAtMs: settings.timerPreset === 'focus' ? null : lockedTimerStartedAtMs,
      allPauseActive,
      allPauseTime,
      allPauseReason,
      allPauseStartTime,
      graceOpen,
      graceContext,
      graceTotal,
      scheduleBreaks,
      scheduleStartTime,
      sessionStartTime,
      delayedStartTargetTime,
      focusTimerDisplayOffsetSeconds,
      userName,
      user: payloadUser,
      updatedAt: options?.updatedAt ?? new Date().toISOString(),
    };
  }, [
    activeMode,
    allPauseActive,
    allPauseReason,
    allPauseStartTime,
    allPauseTime,
    breakTime,
    categories,
    graceContext,
    graceOpen,
    graceTotal,
    focusTimerDisplayOffsetSeconds,
    isIdle,
    lockedTimerMode,
    lockedTimerStartedAtMs,
    logs,
    pastSessions,
    pomodoroCount,
    scheduleBreaks,
    scheduleStartTime,
    sessionStartTime,
    delayedStartTargetTime,
    settings,
    tasks,
    timerStarted,
    user,
    userName,
    workTime,
  ]);

  const normalizeStoredUserName = (value: unknown, fallback = '') => {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    return trimmed || fallback;
  };

  const resetAccountSession = useCallback((reason?: string) => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem('doro_last_user');
    const now = new Date();
    const guestKey = getGuestKey();
    try {
      const guestRaw = localStorage.getItem(guestKey);
      const parsedGuest: TimerPersistencePayload = guestRaw ? JSON.parse(guestRaw) : {};
      const sanitizedGuest = resetPersistedTimerSessionState(parsedGuest, {
        sourceTabId: tabIdRef.current,
        nowMs: now.getTime(),
        fallbackWorkDuration: DEFAULT_SETTINGS.workDuration,
        scheduleStartTime: getScheduleStartLabel(now),
      });
      localStorage.setItem(guestKey, JSON.stringify(sanitizedGuest));
    } catch (error) {
      const sanitizedGuest = resetPersistedTimerSessionState({} as TimerPersistencePayload, {
        sourceTabId: tabIdRef.current,
        nowMs: now.getTime(),
        fallbackWorkDuration: DEFAULT_SETTINGS.workDuration,
        scheduleStartTime: getScheduleStartLabel(now),
      });
      localStorage.setItem(guestKey, JSON.stringify(sanitizedGuest));
      console.error('Failed to sanitize guest timer state during account reset', error);
    }
    setAuthToken(null);
    setLastAccountSyncAt(null);
    accountRevisionRef.current = 0;
    hasHydratedCloudForUserRef.current = null;
    seenFocusFriendActionIdsRef.current.clear();
    seenFocusFriendRequestIdsRef.current.clear();
    focusFriendsSnapshotKeyRef.current = '';
    focusFriendsRefreshInFlightRef.current = false;
    focusFriendsMutationVersionRef.current += 1;
    setUser(null);
    setUserName('');
    setFocusFriends(EMPTY_FOCUS_FRIENDS_STATE);
    setFocusFriendsLoading(false);
    setFocusFriendsError(null);
    setFocusFriendNotice(null);
    if (reason) {
      setAccountSyncState('error');
      setAccountSyncError(reason);
    } else {
      setAccountSyncState('idle');
      setAccountSyncError(null);
    }
    loadData();
  }, [loadData]);

  const normalizeFocusFriendsState = (value: Partial<FocusFriendsState> | null | undefined): FocusFriendsState => ({
    friends: Array.isArray(value?.friends) ? value.friends : [],
    incomingRequests: Array.isArray(value?.incomingRequests) ? value.incomingRequests : [],
    outgoingRequests: Array.isArray(value?.outgoingRequests) ? value.outgoingRequests : [],
    inbox: Array.isArray(value?.inbox) ? value.inbox : [],
  });

  const applyFocusFriendsSnapshot = useCallback((snapshot: Partial<FocusFriendsState> | null | undefined) => {
    const normalized = normalizeFocusFriendsState(snapshot);
    const snapshotKey = JSON.stringify(normalized);
    if (isBrowserTabVisible()) {
      const nextNotice = selectFocusFriendNotice({
        snapshot: normalized,
        seenActionIds: seenFocusFriendActionIdsRef.current,
        seenRequestIds: seenFocusFriendRequestIdsRef.current,
      });

      if (nextNotice) {
        markFocusFriendNoticeSeen(
          nextNotice,
          seenFocusFriendActionIdsRef.current,
          seenFocusFriendRequestIdsRef.current,
        );
        setFocusFriendNotice(nextNotice);
      }
    }

    if (snapshotKey !== focusFriendsSnapshotKeyRef.current) {
      focusFriendsSnapshotKeyRef.current = snapshotKey;
      setFocusFriends(normalized);
    }
  }, []);

  const refreshFocusFriends = useCallback(async (options?: { silent?: boolean }): Promise<boolean> => {
    if (!user || !authToken || isPreviewAuthToken(authToken)) {
      seenFocusFriendActionIdsRef.current.clear();
      seenFocusFriendRequestIdsRef.current.clear();
      focusFriendsSnapshotKeyRef.current = '';
      setFocusFriends(EMPTY_FOCUS_FRIENDS_STATE);
      setFocusFriendsLoading(false);
      setFocusFriendsError(null);
      return false;
    }
    if (focusFriendsRefreshInFlightRef.current) return false;
    const mutationVersionAtStart = focusFriendsMutationVersionRef.current;

    try {
      focusFriendsRefreshInFlightRef.current = true;
      if (!options?.silent) setFocusFriendsLoading(true);
      const snapshot = await fetchFocusFriends(authToken);
      if (mutationVersionAtStart !== focusFriendsMutationVersionRef.current) return false;
      applyFocusFriendsSnapshot(snapshot);
      setFocusFriendsError(null);
      return true;
    } catch (error) {
      if (isUnauthorizedError(error)) {
        resetAccountSession('Session expired. Sign in again.');
        return false;
      }
      if (!options?.silent) {
        setFocusFriendsError(error instanceof Error ? error.message : 'Focus Friends could not refresh.');
      }
      return false;
    } finally {
      focusFriendsRefreshInFlightRef.current = false;
      if (!options?.silent) setFocusFriendsLoading(false);
    }
  }, [applyFocusFriendsSnapshot, authToken, resetAccountSession, user?.username]);

  const runFocusFriendMutation = useCallback(async (
    action: (token: string) => Promise<FocusFriendsState>,
  ): Promise<AuthResult> => {
    if (!user || !authToken || isPreviewAuthToken(authToken)) {
      return { ok: false, error: 'Sign in with a syncing account to use Focus Friends.' };
    }

    try {
      focusFriendsMutationVersionRef.current += 1;
      setFocusFriendsLoading(true);
      const snapshot = await action(authToken);
      applyFocusFriendsSnapshot(snapshot);
      setFocusFriendsError(null);
      return { ok: true, error: null };
    } catch (error) {
      if (isUnauthorizedError(error)) {
        resetAccountSession('Session expired. Sign in again.');
        return { ok: false, error: 'Session expired. Sign in again.' };
      }
      const message = error instanceof Error ? error.message : 'Focus Friends action failed.';
      setFocusFriendsError(message);
      return { ok: false, error: message };
    } finally {
      setFocusFriendsLoading(false);
    }
  }, [applyFocusFriendsSnapshot, authToken, resetAccountSession, user]);

  const sendFocusFriendRequest = useCallback((username: string) => (
    runFocusFriendMutation((token) => apiSendFocusFriendRequest(token, username))
  ), [runFocusFriendMutation]);

  const acceptFocusFriendRequest = useCallback((requestId: string) => (
    runFocusFriendMutation((token) => apiAcceptFocusFriendRequest(token, requestId))
  ), [runFocusFriendMutation]);

  const acceptFocusFriendInvite = useCallback((username: string) => (
    runFocusFriendMutation((token) => apiAcceptFocusFriendInvite(token, username))
  ), [runFocusFriendMutation]);

  const declineFocusFriendRequest = useCallback((requestId: string) => (
    runFocusFriendMutation((token) => apiDeclineFocusFriendRequest(token, requestId))
  ), [runFocusFriendMutation]);

  const removeFocusFriend = useCallback((username: string) => (
    runFocusFriendMutation((token) => apiRemoveFocusFriend(token, username))
  ), [runFocusFriendMutation]);

  const sendFocusFriendEncouragement = useCallback((username: string, message: string) => (
    runFocusFriendMutation((token) => apiSendFocusFriendEncouragement(token, username, message))
  ), [runFocusFriendMutation]);

  const requestFocusFriendJoin = useCallback((username: string, message?: string) => (
    runFocusFriendMutation((token) => apiRequestFocusFriendJoin(token, username, message, null))
  ), [runFocusFriendMutation]);

  const sendFocusFriendJoinInvite = useCallback((username: string, sessionId: string, message?: string) => (
    runFocusFriendMutation((token) => apiSendFocusFriendJoinInvite(token, username, sessionId, message))
  ), [runFocusFriendMutation]);

  const approveFocusFriendJoinRequest = useCallback((actionId: string, sessionId: string) => (
    runFocusFriendMutation((token) => apiApproveFocusFriendJoinRequest(token, actionId, sessionId))
  ), [runFocusFriendMutation]);

  const declineFocusFriendJoinRequest = useCallback((actionId: string) => (
    runFocusFriendMutation((token) => apiDeclineFocusFriendJoinRequest(token, actionId))
  ), [runFocusFriendMutation]);

  const markFocusFriendActionRead = useCallback((actionId: string) => (
    runFocusFriendMutation((token) => apiMarkFocusFriendActionRead(token, actionId))
  ), [runFocusFriendMutation]);

  const getPayloadUpdatedAtMs = (payload?: TimerPersistencePayload | null) => {
    if (typeof payload?.updatedAt !== 'string') return 0;
    const parsed = Date.parse(payload.updatedAt);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const getPayloadRevision = (payload?: TimerPersistencePayload | null) => {
    if (typeof payload?.revision !== 'number' || !Number.isFinite(payload.revision)) return 0;
    return Math.max(0, Math.floor(payload.revision));
  };

  const getPayloadRuntimeUpdatedAtMs = (payload?: TimerPersistencePayload | null) => {
    return isRuntimeSnapshot(payload?.runtime) ? payload.runtime.updatedAtMs : 0;
  };

  const pickPayloadByStamp = (
    localData: TimerPersistencePayload,
    remoteData: TimerPersistencePayload,
    prefer: 'local' | 'remote',
    getStamp: (payload: TimerPersistencePayload) => number,
  ) => {
    const localStamp = getStamp(localData);
    const remoteStamp = getStamp(remoteData);
    if (localStamp === remoteStamp) return prefer === 'local' ? localData : remoteData;
    return localStamp > remoteStamp ? localData : remoteData;
  };

  const mergeLogs = (remoteLogs: LogEntry[] = [], localLogs: LogEntry[] = []) => {
    const logMap = new Map<string, LogEntry>();
    remoteLogs.forEach((entry) => {
      const key = `${entry.type}:${entry.start}:${entry.end}:${entry.duration}`;
      logMap.set(key, entry);
    });
    localLogs.forEach((entry) => {
      const key = `${entry.type}:${entry.start}:${entry.end}:${entry.duration}`;
      logMap.set(key, entry);
    });
    return Array.from(logMap.values()).sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
  };

  const mergeSessions = (remoteSessions: SessionRecord[] = [], localSessions: SessionRecord[] = []) => {
    const sessionMap = new Map<string, SessionRecord>();
    remoteSessions.forEach((session) => sessionMap.set(session.id, session));
    localSessions.forEach((session) => sessionMap.set(session.id, session));
    return Array.from(sessionMap.values()).sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  };

  const mergeSeedDataIntoAccount = (guestData: TimerPersistencePayload, remoteData: TimerPersistencePayload): TimerPersistencePayload => {
    const guestUpdatedAt = getPayloadUpdatedAtMs(guestData);
    const remoteUpdatedAt = getPayloadUpdatedAtMs(remoteData);
    const mergedTasks = mergeTaskLists(remoteData.tasks, guestData.tasks, 'local');
    lastTaskIdSeed = Math.max(lastTaskIdSeed, getMaxTaskId(mergedTasks));
    return {
      ...remoteData,
      settings: normalizeSettings(remoteData.settings),
      tasks: normalizeTaskState(mergedTasks),
      categories: mergeOrderedEntitiesById<Category>(remoteData.categories, guestData.categories, 'local'),
      logs: mergeLogs(remoteData.logs, guestData.logs),
      pastSessions: mergeSessions(remoteData.pastSessions, guestData.pastSessions),
      scheduleBreaks: mergeOrderedEntitiesById<ScheduleBreak>(remoteData.scheduleBreaks, guestData.scheduleBreaks, 'local'),
      userName: normalizeStoredUserName(guestData.userName, normalizeStoredUserName(remoteData.userName)),
      updatedAt: guestUpdatedAt >= remoteUpdatedAt ? guestData.updatedAt : remoteData.updatedAt,
    };
  };

  const mergeAccountPayload = (
    localData: TimerPersistencePayload,
    remoteData: TimerPersistencePayload,
    prefer: 'local' | 'remote' = 'local',
  ): TimerPersistencePayload => {
    const dataWinner = pickPayloadByStamp(localData, remoteData, prefer, getPayloadUpdatedAtMs);
    const timerWinner = pickPayloadByStamp(
      localData,
      remoteData,
      prefer,
      (payload) => getTimerStateFreshnessStamp({
        runtime: isRuntimeSnapshot(payload.runtime) ? payload.runtime : null,
        payloadUpdatedAtMs: getPayloadUpdatedAtMs(payload),
      }),
    );
    const mergedSettings = normalizeSettings(dataWinner.settings);
    const timerLock = mergedSettings.timerPreset === 'focus'
      ? { mode: null, startedAtMs: null }
      : normalizeLockedTimerState(timerWinner.lockedTimerMode, timerWinner.lockedTimerStartedAtMs);
    const mergedTasks = mergeTaskLists(remoteData.tasks, localData.tasks, prefer, { membership: 'preferred' });
    lastTaskIdSeed = Math.max(lastTaskIdSeed, getMaxTaskId(mergedTasks));

    return {
      schemaVersion: DATA_SCHEMA_VERSION,
      revision: Math.max(getPayloadRevision(localData), getPayloadRevision(remoteData)),
      settings: mergedSettings,
      tasks: normalizeTaskState(mergedTasks),
      categories: mergeOrderedEntitiesById<Category>(remoteData.categories, localData.categories, prefer, { membership: 'preferred' }),
      logs: mergeLogs(remoteData.logs, localData.logs),
      pastSessions: mergeSessions(remoteData.pastSessions, localData.pastSessions),
      runtime: isRuntimeSnapshot(timerWinner.runtime) ? timerWinner.runtime : dataWinner.runtime,
      pomodoroCount: typeof timerWinner.pomodoroCount === 'number' ? timerWinner.pomodoroCount : 0,
      workTime: typeof timerWinner.workTime === 'number' ? timerWinner.workTime : DEFAULT_SETTINGS.workDuration,
      breakTime: typeof timerWinner.breakTime === 'number' ? timerWinner.breakTime : 0,
      activeMode: timerWinner.activeMode === 'break' ? 'break' : 'work',
      timerStarted: typeof timerWinner.timerStarted === 'boolean' ? timerWinner.timerStarted : false,
      isIdle: typeof timerWinner.isIdle === 'boolean' ? timerWinner.isIdle : true,
      lockedTimerMode: timerLock.mode,
      lockedTimerStartedAtMs: timerLock.startedAtMs,
      allPauseActive: typeof timerWinner.allPauseActive === 'boolean' ? timerWinner.allPauseActive : false,
      allPauseTime: typeof timerWinner.allPauseTime === 'number' ? timerWinner.allPauseTime : 0,
      allPauseReason: typeof timerWinner.allPauseReason === 'string' ? timerWinner.allPauseReason : '',
      allPauseStartTime: timerWinner.allPauseStartTime === null || typeof timerWinner.allPauseStartTime === 'number'
        ? timerWinner.allPauseStartTime
        : null,
      graceOpen: typeof timerWinner.graceOpen === 'boolean' ? timerWinner.graceOpen : false,
      graceContext: timerWinner.graceContext === 'afterWork' || timerWinner.graceContext === 'afterBreak'
        ? timerWinner.graceContext
        : null,
      graceTotal: typeof timerWinner.graceTotal === 'number' ? timerWinner.graceTotal : 0,
      scheduleBreaks: mergeOrderedEntitiesById<ScheduleBreak>(remoteData.scheduleBreaks, localData.scheduleBreaks, prefer, { membership: 'preferred' }),
      scheduleStartTime: typeof timerWinner.scheduleStartTime === 'string' && timerWinner.scheduleStartTime
        ? timerWinner.scheduleStartTime
        : (typeof dataWinner.scheduleStartTime === 'string' && dataWinner.scheduleStartTime ? dataWinner.scheduleStartTime : '08:00'),
      sessionStartTime: typeof timerWinner.sessionStartTime === 'string' || timerWinner.sessionStartTime === null
        ? timerWinner.sessionStartTime
        : (typeof dataWinner.sessionStartTime === 'string' || dataWinner.sessionStartTime === null ? dataWinner.sessionStartTime : null),
      delayedStartTargetTime: typeof timerWinner.delayedStartTargetTime === 'string' || timerWinner.delayedStartTargetTime === null
        ? timerWinner.delayedStartTargetTime
        : (typeof dataWinner.delayedStartTargetTime === 'string' || dataWinner.delayedStartTargetTime === null ? dataWinner.delayedStartTargetTime : null),
      focusTimerDisplayOffsetSeconds: normalizeFocusTimerDisplayOffsetSeconds(timerWinner.focusTimerDisplayOffsetSeconds),
      userName: normalizeStoredUserName(
        dataWinner.userName,
        normalizeStoredUserName(timerWinner.userName, normalizeStoredUserName(remoteData.userName, normalizeStoredUserName(localData.userName))),
      ),
      updatedAt: typeof dataWinner.updatedAt === 'string' ? dataWinner.updatedAt : new Date().toISOString(),
    };
  };

  const normalizeAccountPayload = useCallback((
    payload: Partial<TimerPersistencePayload> | undefined | null,
    payloadUser: User,
    options?: {
      fallbackUserName?: string;
      revision?: number;
      updatedAt?: string;
    },
  ): TimerPersistencePayload => {
    const source = payload || {};
    const safeSettings = normalizeSettings(source.settings);
    const rawSafeTasks = Array.isArray(source.tasks) ? source.tasks : [];
    lastTaskIdSeed = Math.max(lastTaskIdSeed, getMaxTaskId(rawSafeTasks));
    const safeTasks = normalizeTaskState(rawSafeTasks);
    lastTaskIdSeed = Math.max(lastTaskIdSeed, getMaxTaskId(safeTasks));
    const safeSessions = Array.isArray(source.pastSessions) ? source.pastSessions : [];
    const safeCategories = Array.isArray(source.categories) ? source.categories : [];
    const safeLogs = Array.isArray(source.logs) ? source.logs : [];
    const safeWorkTime = typeof source.workTime === 'number' ? source.workTime : safeSettings.workDuration;
    const safeBreakTime = typeof source.breakTime === 'number' ? source.breakTime : 0;
    const safeMode: TimerMode = source.activeMode === 'break' ? 'break' : 'work';
    const safeSessionStartTime = typeof source.sessionStartTime === 'string' || source.sessionStartTime === null
      ? source.sessionStartTime
      : null;
    const safeDelayedStartTargetTime = typeof source.delayedStartTargetTime === 'string' ? source.delayedStartTargetTime : null;
    const runtime = isRuntimeSnapshot(source.runtime)
      ? source.runtime
      : createRuntimeSnapshot({
          sourceTabId: tabIdRef.current,
          phase: 'idle',
          nowMs: Date.now(),
          workTime: safeWorkTime,
          breakTime: safeBreakTime,
          allPauseTime: 0,
          graceTotal: 0,
          activityStartIso: null,
        });
    const nowMs = Date.now();
    const shouldDropRestoredGrace = shouldDiscardRestoredGrace({
      snapshot: runtime,
      sessionStartTime: safeSessionStartTime,
      graceOpen: source.graceOpen,
      nowMs,
    });
    const collapsedGraceState = shouldDropRestoredGrace
      ? collapseHydratedGraceState({
          sourceTabId: tabIdRef.current,
          nowMs,
          workTime: safeWorkTime,
          breakTime: safeBreakTime,
          activeMode: safeMode,
        })
      : null;
    const normalizedRuntime = collapsedGraceState?.runtime || runtime;
    const runtimeRunning = normalizedRuntime.phase === 'running-work' || normalizedRuntime.phase === 'running-break';
    const normalizedGrace = normalizeGraceWindow({
      graceOpenCandidate: collapsedGraceState
        ? false
        : (typeof source.graceOpen === 'boolean' ? source.graceOpen : normalizedRuntime.phase === 'grace'),
      rawGraceContext: source.graceContext,
      fallbackMode: safeMode,
    });
    const normalizedTimerLock = safeSettings.timerPreset === 'focus'
      ? { mode: null, startedAtMs: null }
      : normalizeLockedTimerState(source.lockedTimerMode, source.lockedTimerStartedAtMs, nowMs);
    const normalizedUserName = normalizeStoredUserName(source.userName, options?.fallbackUserName || payloadUser.username);
    const normalizedUser: User = {
      ...payloadUser,
      username: payloadUser.username,
      joinedAt: payloadUser.joinedAt,
      lifetimeStats: calculateLifetimeStats(
        safeSessions,
        safeLogs,
        payloadUser.joinedAt,
        safeCategories,
      ),
    };

    return {
      schemaVersion: DATA_SCHEMA_VERSION,
      revision: options?.revision ?? getPayloadRevision(source),
      runtime: normalizedRuntime,
      settings: safeSettings,
      tasks: safeTasks,
      pastSessions: safeSessions,
      categories: safeCategories,
      logs: safeLogs,
      pomodoroCount: typeof source.pomodoroCount === 'number' ? source.pomodoroCount : 0,
      workTime: safeWorkTime,
      breakTime: safeBreakTime,
      activeMode: collapsedGraceState
        ? collapsedGraceState.activeMode
        : (normalizedRuntime.phase === 'running-break' ? 'break' : normalizedRuntime.phase === 'running-work' ? 'work' : safeMode),
      timerStarted: collapsedGraceState
        ? collapsedGraceState.timerStarted
        : (typeof source.timerStarted === 'boolean' ? source.timerStarted : runtimeRunning),
      isIdle: collapsedGraceState
        ? collapsedGraceState.isIdle
        : (typeof source.isIdle === 'boolean' ? source.isIdle : normalizedRuntime.phase === 'idle'),
      lockedTimerMode: normalizedTimerLock.mode,
      lockedTimerStartedAtMs: normalizedTimerLock.startedAtMs,
      allPauseActive: collapsedGraceState
        ? collapsedGraceState.allPauseActive
        : (typeof source.allPauseActive === 'boolean' ? source.allPauseActive : normalizedRuntime.phase === 'all-pause'),
      allPauseTime: collapsedGraceState
        ? collapsedGraceState.allPauseTime
        : (typeof source.allPauseTime === 'number' ? source.allPauseTime : 0),
      allPauseReason: collapsedGraceState
        ? collapsedGraceState.allPauseReason
        : (typeof source.allPauseReason === 'string' ? source.allPauseReason : ''),
      allPauseStartTime: collapsedGraceState
        ? collapsedGraceState.allPauseStartTime
        : (source.allPauseStartTime === null || typeof source.allPauseStartTime === 'number'
          ? source.allPauseStartTime
          : null),
      graceOpen: collapsedGraceState ? collapsedGraceState.graceOpen : normalizedGrace.graceOpen,
      graceContext: collapsedGraceState ? collapsedGraceState.graceContext : normalizedGrace.graceContext,
      graceTotal: collapsedGraceState
        ? collapsedGraceState.graceTotal
        : (normalizedGrace.graceOpen && typeof source.graceTotal === 'number' ? source.graceTotal : 0),
      scheduleBreaks: Array.isArray(source.scheduleBreaks) ? source.scheduleBreaks : [],
      scheduleStartTime: typeof source.scheduleStartTime === 'string' && source.scheduleStartTime ? source.scheduleStartTime : '08:00',
      sessionStartTime: collapsedGraceState ? collapsedGraceState.sessionStartTime : safeSessionStartTime,
      delayedStartTargetTime: collapsedGraceState ? null : safeDelayedStartTargetTime,
      focusTimerDisplayOffsetSeconds: collapsedGraceState
        ? 0
        : normalizeFocusTimerDisplayOffsetSeconds(source.focusTimerDisplayOffsetSeconds),
      userName: normalizedUserName,
      user: normalizedUser,
      updatedAt: options?.updatedAt ?? (typeof source.updatedAt === 'string' ? source.updatedAt : new Date().toISOString()),
    };
  }, [calculateLifetimeStats]);

  const persistAccountPayload = useCallback(async (
      token: string,
      payload: TimerPersistencePayload,
      payloadUser: User,
  ): Promise<TimerPersistencePayload> => {
      let candidatePayload = payload;
      let candidateUser = payloadUser;

      for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
              const response = await saveAccountData(token, candidatePayload);
              return normalizeAccountPayload(
                  response.accountData || candidatePayload,
                  response.user || candidatePayload.user || candidateUser,
                  {
                    fallbackUserName: candidatePayload.userName || candidateUser.username,
                    revision: getPayloadRevision(response.accountData || candidatePayload),
                    updatedAt: typeof response.accountData?.updatedAt === 'string' ? response.accountData.updatedAt : response.savedAt,
                  },
              );
          } catch (error) {
              if (attempt === 0 && isConflictError(error) && error.payload?.accountData && error.payload?.user) {
                  const remoteUser = error.payload.user as User;
                  const remotePayload = normalizeAccountPayload(
                      error.payload.accountData,
                      remoteUser,
                      {
                        fallbackUserName: error.payload.accountData?.userName ?? remoteUser.username,
                        revision: getPayloadRevision(error.payload.accountData),
                        updatedAt: typeof error.payload.accountData?.updatedAt === 'string' ? error.payload.accountData.updatedAt : undefined,
                      },
                  );
                  candidateUser = remoteUser;
                  candidatePayload = normalizeAccountPayload(
                      mergeAccountPayload(candidatePayload, remotePayload, 'local'),
                      remoteUser,
                      {
                        fallbackUserName: candidatePayload.userName || remotePayload.userName || remoteUser.username,
                        revision: getPayloadRevision(remotePayload),
                        updatedAt: new Date().toISOString(),
                      },
                  );
                  continue;
              }
              throw error;
          }
      }

      return candidatePayload;
  }, [normalizeAccountPayload]);

  const syncAccountNow = useCallback(async (): Promise<boolean> => {
      if (!user || !authToken || isApplyingCloudSnapshotRef.current || isPreviewAuthToken(authToken)) return false;
      if (isCloudSyncInFlightRef.current) {
          pendingAccountSyncAfterInFlightRef.current = true;
          setAccountSyncState((prev) => (prev === 'syncing' ? prev : 'pending'));
          return false;
      }

      const syncVersionAtStart = accountSyncVersionRef.current;
      let completedRequest = false;

      try {
          isCloudSyncInFlightRef.current = true;
          setAccountSyncState('syncing');
          setAccountSyncError(null);
          const rawPayload = buildPersistencePayload({
            updatedAt: new Date().toISOString(),
            userOverride: user,
          });
          const payloadUser: User = {
            ...(rawPayload.user || user),
            username: user.username,
            joinedAt: rawPayload.user?.joinedAt || user.joinedAt,
            lifetimeStats: user.lifetimeStats,
          };
          const normalizedPayload = normalizeAccountPayload(
            rawPayload,
            payloadUser,
            {
              fallbackUserName: normalizeStoredUserName(rawPayload.userName, userName || user.username),
              revision: Math.max(accountRevisionRef.current, getPayloadRevision(rawPayload)),
              updatedAt: rawPayload.updatedAt,
            },
          );
          const persisted = await persistAccountPayload(authToken, normalizedPayload, payloadUser);
          completedRequest = true;
          accountRevisionRef.current = Math.max(accountRevisionRef.current, getPayloadRevision(persisted));

          if (!shouldApplyAccountSyncSnapshot(syncVersionAtStart, accountSyncVersionRef.current)) {
              pendingAccountSyncAfterInFlightRef.current = true;
              setAccountSyncState('pending');
              return false;
          }

          applyAccountSnapshot(user.username, persisted);
          hasPendingLocalAccountChangesRef.current = false;
          hasHydratedCloudForUserRef.current = user.username;
          setLastAccountSyncAt(Date.now());
          setAccountSyncState('synced');
          return true;
      } catch (error) {
          if (isUnauthorizedError(error)) {
              resetAccountSession('Session expired. Sign in again.');
              return false;
          }
          setAccountSyncState('error');
          setAccountSyncError(error instanceof Error ? error.message : 'Cloud sync failed.');
          return false;
      } finally {
          isCloudSyncInFlightRef.current = false;
          if (completedRequest && pendingAccountSyncAfterInFlightRef.current) {
              pendingAccountSyncAfterInFlightRef.current = false;
              globalThis.setTimeout(() => {
                  void syncAccountNowRef.current?.();
              }, ACCOUNT_SYNC_SAVE_DEBOUNCE_MS);
          }
      }
  }, [authToken, applyAccountSnapshot, buildPersistencePayload, normalizeAccountPayload, persistAccountPayload, resetAccountSession, user, userName]);

  syncAccountNowRef.current = syncAccountNow;

  const refreshAccountFromCloud = useCallback(async (options?: { force?: boolean }): Promise<boolean> => {
      if (!user || !authToken || isPreviewAuthToken(authToken)) return false;
      if (isCloudSyncInFlightRef.current || isApplyingCloudSnapshotRef.current) return false;
      if (hasPendingLocalAccountChangesRef.current) {
          pendingAccountSyncAfterInFlightRef.current = true;
          setAccountSyncState((prev) => (prev === 'syncing' ? prev : 'pending'));
          return false;
      }

      const force = options?.force ?? true;
      const syncVersionAtStart = accountSyncVersionRef.current;
      let completedRequest = false;

      try {
          isCloudSyncInFlightRef.current = true;
          setAccountSyncState('syncing');
          setAccountSyncError(null);
          const remote = await fetchAccountData(authToken);
          completedRequest = true;
          const cloudUser = remote.user;
          const localCacheKey = getUserKey(cloudUser.username);
          const cachedLocalRaw: TimerPersistencePayload = JSON.parse(localStorage.getItem(localCacheKey) || '{}');
          const liveLocalRaw = buildPersistencePayload({
            updatedAt: new Date().toISOString(),
            userOverride: user.username === cloudUser.username
              ? { ...user, username: cloudUser.username, joinedAt: user.joinedAt || cloudUser.joinedAt }
              : user,
          });
          const localRaw = selectLocalPayloadForAccountSync<TimerPersistencePayload>({
            activeUsername: user.username,
            targetUsername: cloudUser.username,
            livePayload: liveLocalRaw,
            cachedPayload: cachedLocalRaw,
          }) || {};
          const localPayload = normalizeAccountPayload(
            localRaw,
            {
              ...(localRaw.user || cloudUser),
              username: cloudUser.username,
              joinedAt: localRaw.user?.joinedAt || cloudUser.joinedAt,
              lifetimeStats: cloudUser.lifetimeStats,
            },
            {
              fallbackUserName: normalizeStoredUserName(localRaw.userName, userName || cloudUser.username),
              revision: Math.max(accountRevisionRef.current, getPayloadRevision(localRaw)),
              updatedAt: typeof localRaw.updatedAt === 'string' ? localRaw.updatedAt : undefined,
            },
          );
          const cloudPayload = normalizeAccountPayload(
            remote.accountData || {},
            cloudUser,
            {
              fallbackUserName: normalizeStoredUserName(remote.accountData?.userName, cloudUser.username),
              revision: getPayloadRevision(remote.accountData),
              updatedAt: typeof remote.accountData?.updatedAt === 'string' ? remote.accountData.updatedAt : undefined,
            },
          );

          const localRevision = getPayloadRevision(localPayload);
          const cloudRevision = getPayloadRevision(cloudPayload);
          const localUpdatedAt = getPayloadUpdatedAtMs(localPayload);
          const cloudUpdatedAt = getPayloadUpdatedAtMs(cloudPayload);
          const localRuntimeUpdated = getPayloadRuntimeUpdatedAtMs(localPayload);
          const cloudRuntimeUpdated = getPayloadRuntimeUpdatedAtMs(cloudPayload);
          const revisionsMatch = localRevision === cloudRevision;
          const localDirty = revisionsMatch && localUpdatedAt > cloudUpdatedAt;
          const hasRemoteTimerChange = cloudRuntimeUpdated > localRuntimeUpdated;
          const hasRemoteDataChange = cloudRevision > localRevision || cloudUpdatedAt > localUpdatedAt;

          if (!hasRemoteTimerChange && !hasRemoteDataChange && !localDirty) {
            if (!shouldApplyAccountSyncSnapshot(syncVersionAtStart, accountSyncVersionRef.current)) {
              pendingAccountSyncAfterInFlightRef.current = true;
              setAccountSyncState('pending');
              return false;
            }
            setAccountSyncState('synced');
            setLastAccountSyncAt(Date.now());
            hasHydratedCloudForUserRef.current = cloudUser.username;
            return true;
          }

          if (!force && !hasRemoteTimerChange && !hasRemoteDataChange) {
              if (!shouldApplyAccountSyncSnapshot(syncVersionAtStart, accountSyncVersionRef.current)) {
                  pendingAccountSyncAfterInFlightRef.current = true;
                  setAccountSyncState('pending');
                  return false;
              }
              setAccountSyncState('synced');
              setLastAccountSyncAt(Date.now());
              hasHydratedCloudForUserRef.current = cloudUser.username;
              return true;
          }

          let nextPayload = cloudPayload;
          let shouldPersistMergedPayload = false;

          if (localDirty || cloudRevision !== localRevision || hasRemoteTimerChange) {
              const prefer: 'local' | 'remote' = localDirty || localUpdatedAt > cloudUpdatedAt ? 'local' : 'remote';
              nextPayload = normalizeAccountPayload(
                mergeAccountPayload(localPayload, cloudPayload, prefer),
                cloudUser,
                {
                  fallbackUserName: prefer === 'local'
                    ? normalizeStoredUserName(localPayload.userName, cloudPayload.userName || cloudUser.username)
                    : normalizeStoredUserName(cloudPayload.userName, localPayload.userName || cloudUser.username),
                  revision: cloudRevision,
                  updatedAt: prefer === 'local' ? localPayload.updatedAt : cloudPayload.updatedAt,
                },
              );
              shouldPersistMergedPayload = prefer === 'local' && (localDirty || cloudRevision !== localRevision);
          }

          if (shouldPersistMergedPayload) {
              if (!shouldApplyAccountSyncSnapshot(syncVersionAtStart, accountSyncVersionRef.current)) {
                  pendingAccountSyncAfterInFlightRef.current = true;
                  setAccountSyncState('pending');
                  return false;
              }

              nextPayload = await persistAccountPayload(
                authToken,
                normalizeAccountPayload(
                  nextPayload,
                  cloudUser,
                  {
                    fallbackUserName: nextPayload.userName || cloudUser.username,
                    revision: cloudRevision,
                    updatedAt: new Date().toISOString(),
                  },
                ),
                cloudUser,
              );
          }

          if (!shouldApplyAccountSyncSnapshot(syncVersionAtStart, accountSyncVersionRef.current)) {
              pendingAccountSyncAfterInFlightRef.current = true;
              setAccountSyncState('pending');
              return false;
          }

          applyAccountSnapshot(cloudUser.username, nextPayload);
          hasHydratedCloudForUserRef.current = cloudUser.username;
          setLastAccountSyncAt(Date.now());
          setAccountSyncState('synced');
          return true;
      } catch (error) {
          if (isUnauthorizedError(error)) {
              resetAccountSession('Session expired. Sign in again.');
              return false;
          }
          setAccountSyncState('error');
          setAccountSyncError(error instanceof Error ? error.message : 'Failed to refresh from cloud.');
          return false;
      } finally {
          isCloudSyncInFlightRef.current = false;
          if (completedRequest && pendingAccountSyncAfterInFlightRef.current) {
              pendingAccountSyncAfterInFlightRef.current = false;
              globalThis.setTimeout(() => {
                  void syncAccountNowRef.current?.();
              }, ACCOUNT_SYNC_SAVE_DEBOUNCE_MS);
          }
      }
  }, [authToken, applyAccountSnapshot, buildPersistencePayload, normalizeAccountPayload, persistAccountPayload, resetAccountSession, user, userName]);

  const register = async (username: string, password?: string): Promise<AuthResult> => {
      if (!password) {
          return { ok: false, error: 'Password is required.' };
      }
      if (isPreviewAccountCredentials(username, password)) {
          const previewPayload = buildPreviewAccountPayload(tabIdRef.current);
          localStorage.setItem(AUTH_TOKEN_KEY, PREVIEW_AUTH_TOKEN);
          setAuthToken(PREVIEW_AUTH_TOKEN);
          applyAccountSnapshot(PREVIEW_ACCOUNT_USERNAME, previewPayload);
          hasHydratedCloudForUserRef.current = PREVIEW_ACCOUNT_USERNAME;
          setLastAccountSyncAt(null);
          setAccountSyncState('idle');
          setAccountSyncError(null);
          return { ok: true, error: null };
      }
      try {
          const guestData: TimerPersistencePayload = JSON.parse(localStorage.getItem(getGuestKey()) || '{}');
          const response = await registerAccount(username, password, guestData);
          localStorage.setItem(AUTH_TOKEN_KEY, response.token);
          setAuthToken(response.token);

          const accountUsername = response.user.username;
          const accountPayload = normalizeAccountPayload(
            response.accountData || guestData,
            response.user,
            {
              fallbackUserName: normalizeStoredUserName(response.accountData?.userName, normalizeStoredUserName(guestData.userName, accountUsername)),
              revision: getPayloadRevision(response.accountData),
              updatedAt: typeof response.accountData?.updatedAt === 'string' ? response.accountData.updatedAt : undefined,
            },
          );

          applyAccountSnapshot(accountUsername, accountPayload);
          hasHydratedCloudForUserRef.current = accountUsername;
          setLastAccountSyncAt(Date.now());
          setAccountSyncState('synced');
          setAccountSyncError(null);
          return { ok: true, error: null };
      } catch (error) {
          const message = error instanceof Error ? error.message : 'Registration failed.';
          setAccountSyncState('error');
          setAccountSyncError(message);
          return { ok: false, error: message };
      }
  };

  const login = async (username: string, password?: string): Promise<AuthResult> => {
      if (!password) {
          return { ok: false, error: 'Password is required.' };
      }
      const isDebugFocusFriendLogin = isDebugFocusFriendCredentials(username, password);
      if (isPreviewAccountCredentials(username, password)) {
          const previewPayload = buildPreviewAccountPayload(tabIdRef.current);
          localStorage.setItem(AUTH_TOKEN_KEY, PREVIEW_AUTH_TOKEN);
          setAuthToken(PREVIEW_AUTH_TOKEN);
          applyAccountSnapshot(PREVIEW_ACCOUNT_USERNAME, previewPayload);
          hasHydratedCloudForUserRef.current = PREVIEW_ACCOUNT_USERNAME;
          setLastAccountSyncAt(null);
          setAccountSyncState('idle');
          setAccountSyncError(null);
          return { ok: true, error: null };
      }
      try {
          const response = await loginAccount(username, password);
          const accountUsername = response.user.username;
          localStorage.setItem(AUTH_TOKEN_KEY, response.token);
          setAuthToken(response.token);

          const guestData: TimerPersistencePayload = JSON.parse(localStorage.getItem(getGuestKey()) || '{}');
          const remotePayload = normalizeAccountPayload(
            response.accountData || {},
            response.user,
            {
              fallbackUserName: normalizeStoredUserName(response.accountData?.userName, accountUsername),
              revision: getPayloadRevision(response.accountData),
              updatedAt: typeof response.accountData?.updatedAt === 'string' ? response.accountData.updatedAt : undefined,
            },
          );
          let finalPayload = remotePayload;
          if (!isDebugFocusFriendLogin) {
            const guestPayload = normalizeAccountPayload(
              guestData,
              response.user,
              {
                fallbackUserName: normalizeStoredUserName(guestData.userName, remotePayload.userName || accountUsername),
                revision: getPayloadRevision(guestData),
                updatedAt: typeof guestData.updatedAt === 'string' ? guestData.updatedAt : undefined,
              },
            );
            const mergedGuestPayload = normalizeAccountPayload(
              mergeSeedDataIntoAccount(guestPayload, remotePayload),
              response.user,
              {
                fallbackUserName: guestPayload.userName || remotePayload.userName || accountUsername,
                revision: getPayloadRevision(remotePayload),
                updatedAt: typeof remotePayload.updatedAt === 'string' ? remotePayload.updatedAt : undefined,
              },
            );
            const shouldPersistGuestImport = JSON.stringify(mergedGuestPayload) !== JSON.stringify(remotePayload);
            finalPayload = shouldPersistGuestImport
              ? await persistAccountPayload(
                  response.token,
                  normalizeAccountPayload(
                    mergedGuestPayload,
                    response.user,
                    {
                      fallbackUserName: mergedGuestPayload.userName || accountUsername,
                      revision: getPayloadRevision(remotePayload),
                      updatedAt: new Date().toISOString(),
                    },
                  ),
                  response.user,
                )
              : remotePayload;
          }

          applyAccountSnapshot(accountUsername, finalPayload);
          hasHydratedCloudForUserRef.current = accountUsername;
          setLastAccountSyncAt(Date.now());
          setAccountSyncState('synced');
          setAccountSyncError(null);
          return { ok: true, error: null };
      } catch (error) {
          const message = error instanceof Error ? error.message : 'Login failed.';
          setAccountSyncState('error');
          setAccountSyncError(message);
          return { ok: false, error: message };
      }
  };

  const logout = () => {
      const tokenToRevoke = authToken;
      if (tokenToRevoke && !isPreviewAuthToken(tokenToRevoke)) {
          void logoutAccount(tokenToRevoke).catch(() => {});
      }
      resetAccountSession();
  };

  useEffect(() => {
    if (selectedCategoryId === null) return;
    if (categories.some((category) => category.id === selectedCategoryId && isActiveCategory(category))) return;
    setSelectedCategoryId(null);
  }, [categories, selectedCategoryId]);

  useEffect(() => {
      if (!user || !authToken || isPreviewAuthToken(authToken)) return;
      if (hasHydratedCloudForUserRef.current === user.username) return;
      void refreshAccountFromCloud();
  }, [authToken, refreshAccountFromCloud, user]);

  useEffect(() => {
      if (!user || !authToken || isPreviewAuthToken(authToken)) return;
      const interval = setInterval(() => { void refreshAccountFromCloud({ force: false }); }, 12000);
      return () => clearInterval(interval);
  }, [authToken, refreshAccountFromCloud, user]);

  useEffect(() => {
      if (!user || !authToken || isPreviewAuthToken(authToken)) {
          seenFocusFriendActionIdsRef.current.clear();
          seenFocusFriendRequestIdsRef.current.clear();
          focusFriendsSnapshotKeyRef.current = '';
          setFocusFriends(EMPTY_FOCUS_FRIENDS_STATE);
          setFocusFriendsLoading(false);
          setFocusFriendsError(null);
          return;
      }
      const refreshFocusFriendsSnapshot = () => {
          void refreshFocusFriends({ silent: true });
      };
      refreshFocusFriendsSnapshot();
      const interval = setInterval(refreshFocusFriendsSnapshot, FOCUS_FRIENDS_REFRESH_MS);
      if (typeof document !== 'undefined') {
          document.addEventListener('visibilitychange', refreshFocusFriendsSnapshot);
      }
      if (typeof window !== 'undefined') {
          window.addEventListener('focus', refreshFocusFriendsSnapshot);
      }
      return () => {
          clearInterval(interval);
          if (typeof document !== 'undefined') {
              document.removeEventListener('visibilitychange', refreshFocusFriendsSnapshot);
          }
          if (typeof window !== 'undefined') {
              window.removeEventListener('focus', refreshFocusFriendsSnapshot);
          }
      };
  }, [authToken, refreshFocusFriends, user?.username]);

  useEffect(() => {
      if (!user || !authToken || isPreviewAuthToken(authToken)) return;
      if (skipSaveRef.current || isApplyingCloudSnapshotRef.current) return;
      accountSyncVersionRef.current += 1;
      hasPendingLocalAccountChangesRef.current = true;
      setAccountSyncState((prev) => (prev === 'syncing' ? prev : 'pending'));
      // Debounce signed-in saves from timer phase transitions, not per-second countdown ticks.
      const timeout = setTimeout(() => { void syncAccountNow(); }, ACCOUNT_SYNC_SAVE_DEBOUNCE_MS);
      return () => clearTimeout(timeout);
  }, [
      user,
      authToken,
      settings,
      tasks,
      pastSessions,
      categories,
      logs,
      pomodoroCount,
      activeMode,
      timerStarted,
      isIdle,
      lockedTimerMode,
      lockedTimerStartedAtMs,
      allPauseActive,
      allPauseReason,
      allPauseStartTime,
      graceOpen,
      graceContext,
      focusTimerDisplayOffsetSeconds,
      scheduleBreaks,
      scheduleStartTime,
      sessionStartTime,
      delayedStartTargetTime,
      userName,
      accountTimerSyncNonce,
      syncAccountNow,
  ]);

  // Save Effect
  useEffect(() => {
    if (isCrossTabApplyingRef.current) return;

    if (skipSaveRef.current) {
      const retryTimeout = setTimeout(() => {
        if (skipSaveRef.current || isCrossTabApplyingRef.current) return;
        const key = getActiveStorageKey();
        localStorage.setItem(key, JSON.stringify(buildPersistencePayload()));
      }, 140);
      return () => clearTimeout(retryTimeout);
    }

    const key = getActiveStorageKey();
    localStorage.setItem(key, JSON.stringify(buildPersistencePayload()));
  }, [
    buildPersistencePayload,
    getActiveStorageKey,
  ]);

  useEffect(() => {
    const checkMobile = () => {
        const isMobile = window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (isMobile) {
            setSettings(prev => ({ ...prev, disableBlur: true }));
        }
    };
    checkMobile();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionParam = params.get('session');
    if (sessionParam) {
        setPendingJoinId(sessionParam);
        window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // PeerJS logic
  const GROUP_CONNECT_TIMEOUT_MS = 15000;

  const pruneConnections = useCallback(() => {
    const nextConnections = pruneLivePeerConnections(connectionsRef.current);
    connectionsRef.current
      .filter(conn => conn?.open && !nextConnections.includes(conn))
      .forEach(conn => {
        try { conn.close(); } catch {}
      });
    connectionsRef.current = nextConnections;
    return connectionsRef.current;
  }, []);

  const formatGroupEventMessage = useCallback((event: GroupEventPayload): string => {
    switch (event.type) {
      case 'joined':
        return 'joined the study session';
      case 'timer-started':
        return 'started the timer';
      case 'timer-stopped':
        return 'stopped the timer';
      case 'timer-paused':
        return event.reason ? `paused the timer (${event.reason})` : 'paused the timer';
      case 'timer-resumed':
        return event.mode === 'break' ? 'resumed on break mode' : 'resumed on focus mode';
      case 'mode-switched':
        return event.mode === 'break' ? 'switched to break mode' : 'switched to focus mode';
      case 'timer-reset':
        return 'reset the active timer';
      case 'grace-resolved':
        return event.mode === 'break' ? 'continued into break after grace' : 'returned to focus after grace';
      default:
        return 'updated the timer';
    }
  }, []);

  const postGroupNotice = useCallback((event: GroupEventPayload) => {
    if (!event.actorId || !event.actorName) return;
    if (localPeerIdRef.current && event.actorId === localPeerIdRef.current) return;
    if (seenGroupEventIdsRef.current.has(event.id)) return;
    seenGroupEventIdsRef.current.add(event.id);
    setGroupNotice({
      id: `${event.id}_${Date.now()}`,
      actorId: event.actorId,
      actorName: event.actorName,
      kind: event.type === 'joined' ? 'join' : 'action',
      message: formatGroupEventMessage(event),
      createdAt: Date.now(),
    });
  }, [formatGroupEventMessage]);

  const postSpectatorEncouragementNotice = useCallback((raw: any, conn: DataConnection) => {
    const message = normalizeSpectatorEncouragementMessage(raw?.message);
    const eventId = typeof raw?.id === 'string' && raw.id.trim()
      ? raw.id.trim().slice(0, 96)
      : `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const sendResult = (ok: boolean, error?: string) => {
      if (!conn.open) return;
      conn.send({
        type: ok ? 'SPECTATOR_ENCOURAGEMENT_ACK' : 'SPECTATOR_ENCOURAGEMENT_ERROR',
        id: eventId,
        error,
      });
    };

    if (!message) {
      sendResult(false, 'Choose an encouragement first.');
      return;
    }

    if (seenGroupEventIdsRef.current.has(eventId)) {
      sendResult(true);
      return;
    }

    const nowMs = Date.now();
    const viewerKey = conn.peer || 'spectator';
    const lastAt = spectatorEncouragementLastAtRef.current[viewerKey] || 0;
    if (nowMs - lastAt < SPECTATOR_ENCOURAGEMENT_MIN_INTERVAL_MS) {
      sendResult(false, 'Give the encouragement a second.');
      return;
    }

    spectatorEncouragementLastAtRef.current[viewerKey] = nowMs;
    seenGroupEventIdsRef.current.add(eventId);
    const actorName = sanitizeGroupMemberName(raw?.actorName ?? (conn.metadata as any)?.name, 'Timer Viewer');

    setGroupNotice({
      id: `${eventId}_${nowMs}`,
      actorId: `spectator:${viewerKey}`,
      actorName,
      kind: 'encouragement',
      message,
      createdAt: nowMs,
    });
    sendResult(true);
  }, []);

  const sendGroupEvent = useCallback((event: GroupEventPayload, excludeConnId?: string) => {
    if (!groupSessionIdRef.current) return;
    const openConnections = pruneConnections();
    if (openConnections.length === 0) return;
    openConnections.forEach(conn => {
      if (conn.open && conn.peer !== excludeConnId && !isSpectatorConnection(conn)) {
        conn.send({ type: 'GROUP_EVENT', event });
      }
    });
  }, [pruneConnections]);

  const normalizeGroupEventPayload = useCallback((raw: any, fallbackActorId?: string, fallbackActorName?: string): GroupEventPayload | null => {
    if (!raw || typeof raw !== 'object') return null;
    if (!isGroupEventType(raw.type)) return null;

    const actorId = typeof raw.actorId === 'string' && raw.actorId.trim()
      ? raw.actorId.trim()
      : (fallbackActorId || '');
    const actorName = typeof raw.actorName === 'string' && raw.actorName.trim()
      ? raw.actorName.trim()
      : (fallbackActorName || 'Member');
    if (!actorId) return null;

    const normalized: GroupEventPayload = {
      id: typeof raw.id === 'string' && raw.id.trim()
        ? raw.id.trim()
        : `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      type: raw.type,
      actorId,
      actorName,
      at: typeof raw.at === 'number' ? raw.at : Date.now(),
    };

    if (raw.mode === 'work' || raw.mode === 'break') {
      normalized.mode = raw.mode;
    }
    if (typeof raw.reason === 'string' && raw.reason.trim()) {
      normalized.reason = raw.reason.trim().slice(0, 80);
    }
    return normalized;
  }, []);

  const getKnownMemberName = useCallback((peerId?: string | null, fallback: string = GROUP_MEMBER_FALLBACK_NAME) => {
    if (!peerId) return fallback;
    const known = memberNamesRef.current[peerId];
    return typeof known === 'string' && known.trim() ? known : fallback;
  }, []);

  const rememberMemberName = useCallback((peerId: string | null | undefined, rawName: unknown, fallback: string = GROUP_MEMBER_FALLBACK_NAME) => {
    const normalized = typeof rawName === 'string' && rawName.trim()
      ? sanitizeGroupMemberName(rawName, fallback)
      : null;
    if (peerId && normalized) {
      memberNamesRef.current[peerId] = normalized;
      return normalized;
    }
    return getKnownMemberName(peerId, fallback);
  }, [getKnownMemberName]);

  const getConnectionMemberName = useCallback((conn: DataConnection, fallback: string = GROUP_MEMBER_FALLBACK_NAME) => {
    return rememberMemberName(conn.peer, (conn.metadata as any)?.name, fallback);
  }, [rememberMemberName]);

  const announceMemberJoin = useCallback((peerId: string, rawName: unknown) => {
    if (!peerId || announcedPeerIdsRef.current.has(peerId)) return;
    const actorName = rememberMemberName(peerId, rawName);
    announcedPeerIdsRef.current.add(peerId);
    const joinEvent = normalizeGroupEventPayload({
      type: 'joined',
      actorId: peerId,
      actorName,
      at: Date.now(),
    }, peerId, actorName);
    if (joinEvent) {
      postGroupNotice(joinEvent);
      sendGroupEvent(joinEvent);
    }
  }, [normalizeGroupEventPayload, postGroupNotice, rememberMemberName, sendGroupEvent]);

  const emitLocalGroupEvent = useCallback((type: GroupEventType, extras?: { mode?: TimerMode, reason?: string }) => {
    if (!groupSessionIdRef.current) return;
    const actorId = localPeerIdRef.current;
    const actorName = sanitizeGroupMemberName(userNameRef.current.trim(), '');
    if (!actorId || !actorName) return;
    const payload: GroupEventPayload = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      type,
      actorId,
      actorName,
      at: Date.now(),
    };
    if (extras?.mode === 'work' || extras?.mode === 'break') payload.mode = extras.mode;
    if (typeof extras?.reason === 'string' && extras.reason.trim()) payload.reason = extras.reason.trim().slice(0, 80);
    sendGroupEvent(payload);
  }, [sendGroupEvent]);

  const isFollowingHostTimerSync = useCallback(() => {
    return shouldFollowHostTimerSync({
      groupSessionId: groupSessionIdRef.current,
      isHost: isHostRef.current,
      hostSyncConfig: hostSyncConfigRef.current,
      clientSyncConfig: clientSyncConfigRef.current,
      awaitingInitialHostState: !clientReadyForBroadcastRef.current,
    });
  }, []);

  const isAwaitingInitialHostTimerSync = useCallback(() => {
    return Boolean(
      groupSessionIdRef.current
        && !isHostRef.current
        && clientSyncConfigRef.current.syncTimers
        && !clientReadyForBroadcastRef.current
    );
  }, []);

  const dismissGuestTimerLockNotice = useCallback(() => {
    setGuestTimerLockNotice(null);
  }, []);

  const requestNewCategoryFlow = useCallback(() => {
    setPendingMenuAction('new-category');
  }, []);

  const clearPendingMenuAction = useCallback(() => {
    setPendingMenuAction(null);
  }, []);

  const blockGuestTimerControl = useCallback(() => {
    if (!isFollowingHostTimerSync()) return false;
    const now = Date.now();
    setGuestTimerLockNotice({
      id: `guest_timer_lock_${now}`,
      title: 'Timer controlled by host',
      message: 'You joined this group as a guest. Only the host can change the shared timer. Leave the group session if you want to control your own timer.',
      createdAt: now,
    });
    return true;
  }, [isFollowingHostTimerSync]);

  useEffect(() => {
    if (isFollowingHostTimerSync()) return;
    setGuestTimerLockNotice(null);
  }, [groupSessionId, isHost, hostSyncConfig.syncTimers, clientSyncConfig.syncTimers, isFollowingHostTimerSync]);

  const getCurrentState = useCallback(() => {
    return {
       ...currentGroupStateRef.current,
       userName: userNameRef.current,
       runtime: runtimeRef.current,
       hostConfig: hostSyncConfigRef.current,
    };
  }, []);

  const buildTimerSpectatorState = useCallback((state: any): TimerSpectatorState => {
    const nowMs = Date.now();
    const activeContext = Array.isArray(state?.tasks)
      ? findActiveContext(state.tasks)
      : { task: null, color: undefined, categoryId: null };
    const activeCategoryId = typeof activeContext.categoryId === 'number' && Number.isFinite(activeContext.categoryId)
      ? activeContext.categoryId
      : null;
    const activeCategory = activeCategoryId !== null && Array.isArray(state?.categories)
      ? (state.categories as Category[]).find(category => category.id === activeCategoryId)
      : null;
    const activeCategoryName = typeof activeCategory?.name === 'string' && activeCategory.name.trim()
      ? activeCategory.name.trim().slice(0, 60)
      : null;
    const activeCategoryColor = activeCategoryName && typeof activeCategory?.color === 'string' && activeCategory.color.trim()
      ? activeCategory.color.trim()
      : undefined;
    const activeCategoryIcon = activeCategoryName && typeof activeCategory?.icon === 'string' && activeCategory.icon.trim()
      ? activeCategory.icon.trim()
      : undefined;
    const runtime = isRuntimeSnapshot(state?.runtime) ? state.runtime : runtimeRef.current;
    const settings = pickTimerSpectatorSettings(state?.settings);
    const activeMode = state?.activeMode === 'break' ? 'break' : 'work';
    const derivedTimer = runtime
      ? deriveRuntimeValues(runtime, nowMs)
      : {
          workTime: typeof state?.workTime === 'number' && Number.isFinite(state.workTime) ? state.workTime : DEFAULT_SETTINGS.workDuration,
          breakTime: typeof state?.breakTime === 'number' && Number.isFinite(state.breakTime) ? state.breakTime : 0,
        };
    const runtimeMode = runtime?.phase === 'running-break' ? 'break' : activeMode;
    const grace = normalizeGraceWindow({
      graceOpenCandidate: runtime?.phase === 'grace' || Boolean(state?.graceOpen),
      rawGraceContext: state?.graceContext,
      fallbackMode: runtimeMode,
    });
    const remainingPomodoros = Array.isArray(state?.tasks)
      ? getRemainingPomodorosForActiveTasks(state.tasks, getDateKey(new Date(nowMs)))
      : 0;
    const projectedFinishSeconds = remainingPomodoros > 0
      ? getProjectedTaskFinishSeconds({
          remainingPomodoros,
          pomodoroCount: typeof state?.pomodoroCount === 'number' && Number.isFinite(state.pomodoroCount) ? state.pomodoroCount : 0,
          workTime: derivedTimer.workTime,
          breakTime: derivedTimer.breakTime,
          activeMode: runtimeMode,
          isIdle: runtime ? runtime.phase === 'idle' : Boolean(state?.isIdle),
          graceOpen: grace.graceOpen,
          graceContext: grace.graceContext,
          settings,
        })
      : 0;

    return {
      version: 1,
      hostName: sanitizeGroupMemberName(state?.userName ?? userNameRef.current, 'Host'),
      activeMode,
      timerStarted: Boolean(state?.timerStarted),
      isIdle: Boolean(state?.isIdle),
      workTime: typeof state?.workTime === 'number' && Number.isFinite(state.workTime) ? state.workTime : DEFAULT_SETTINGS.workDuration,
      breakTime: typeof state?.breakTime === 'number' && Number.isFinite(state.breakTime) ? state.breakTime : 0,
      pomodoroCount: typeof state?.pomodoroCount === 'number' && Number.isFinite(state.pomodoroCount) ? state.pomodoroCount : 0,
      sessionStartTime: typeof state?.sessionStartTime === 'string' || state?.sessionStartTime === null
        ? state.sessionStartTime
        : null,
      todayPomodoroCount: getTodayPomodoroCountFromLogs(
        Array.isArray(state?.logs) ? state.logs : [],
        nowMs,
      ),
      allPauseActive: Boolean(state?.allPauseActive),
      allPauseTime: typeof state?.allPauseTime === 'number' && Number.isFinite(state.allPauseTime) ? state.allPauseTime : 0,
      graceOpen: Boolean(state?.graceOpen),
      graceContext: state?.graceContext === 'afterWork' || state?.graceContext === 'afterBreak' ? state.graceContext : null,
      activeTaskName: typeof activeContext.task?.name === 'string' && activeContext.task.name.trim()
        ? activeContext.task.name.trim().slice(0, 80)
        : null,
      activeCategoryName: activeCategoryName || undefined,
      activeCategoryColor,
      activeCategoryIcon,
      activeColor: typeof activeContext.color === 'string' && activeContext.color.trim() ? activeContext.color : undefined,
      projectedFinishEndMs: projectedFinishSeconds > 0 ? nowMs + (projectedFinishSeconds * 1000) : null,
      settings,
      runtime,
      updatedAtMs: nowMs,
    };
  }, []);

  const publishFocusFriendPresence = useCallback(async (): Promise<boolean> => {
    if (!user || !authToken || isPreviewAuthToken(authToken) || !isBrowserTabVisible()) return false;
    if (focusFriendPresenceInFlightRef.current) return false;

    try {
      focusFriendPresenceInFlightRef.current = true;
      const timer = buildTimerSpectatorState(getCurrentState());
      const snapshot = await apiUpdateFocusFriendPresence(authToken, timer);
      applyFocusFriendsSnapshot(snapshot);
      return true;
    } catch (error) {
      if (isUnauthorizedError(error)) {
        resetAccountSession('Session expired. Sign in again.');
      }
      return false;
    } finally {
      focusFriendPresenceInFlightRef.current = false;
    }
  }, [applyFocusFriendsSnapshot, authToken, buildTimerSpectatorState, getCurrentState, resetAccountSession, user?.username]);

  useEffect(() => {
    if (!user || !authToken || isPreviewAuthToken(authToken)) return;

    const publishVisiblePresence = () => {
      if (!isBrowserTabVisible()) return;
      void publishFocusFriendPresence();
    };

    publishVisiblePresence();
    const interval = setInterval(publishVisiblePresence, FOCUS_FRIENDS_REFRESH_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', publishVisiblePresence);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', publishVisiblePresence);
    }
    return () => {
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', publishVisiblePresence);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', publishVisiblePresence);
      }
    };
  }, [authToken, publishFocusFriendPresence, user?.username]);

  useEffect(() => {
    if (!user || !authToken || isPreviewAuthToken(authToken) || !isBrowserTabVisible()) return;
    void publishFocusFriendPresence();
  }, [
    accountTimerSyncNonce,
    activeMode,
    allPauseActive,
    graceContext,
    graceOpen,
    isIdle,
    pomodoroCount,
    publishFocusFriendPresence,
    timerStarted,
    user?.username,
    authToken,
  ]);

  const buildFilteredGroupState = useCallback((state: any, config: GroupSyncConfig) => {
      const filteredState: any = { ...state };
      if (!config.syncTimers) {
          delete filteredState.workTime; delete filteredState.breakTime; delete filteredState.activeMode;
          delete filteredState.timerStarted; delete filteredState.isIdle;
          delete filteredState.lockedTimerMode;
          delete filteredState.lockedTimerStartedAtMs;
          delete filteredState.pomodoroCount;
          delete filteredState.allPauseActive; delete filteredState.allPauseTime; delete filteredState.allPauseReason;
          delete filteredState.allPauseStartTime; delete filteredState.graceOpen; delete filteredState.graceContext;
          delete filteredState.graceTotal; delete filteredState.delayedStartTargetTime; delete filteredState.focusTimerDisplayOffsetSeconds; delete filteredState.runtime;
      }
      if (!config.syncTasks) { delete filteredState.tasks; delete filteredState.categories; }
      if (!config.syncHistory) { delete filteredState.logs; }
      if (!config.syncSchedule) { delete filteredState.scheduleBreaks; delete filteredState.scheduleStartTime; delete filteredState.sessionStartTime; delete filteredState.delayedStartTargetTime; }
      if (!config.syncSettings) { delete filteredState.settings; }
      filteredState.hostConfig = hostSyncConfigRef.current;
      return filteredState;
  }, []);

  const applyRemoteState = useCallback((remote: any, mode: 'full' | 'timer-only' = 'full') => {
      if (!remote || typeof remote !== 'object') return;
      isRemoteUpdate.current = true;
      remoteUpdateVersionRef.current += 1;
      const releaseVersion = remoteUpdateVersionRef.current;
      if (remoteUpdateClearTimeoutRef.current) {
        clearTimeout(remoteUpdateClearTimeoutRef.current);
      }

      const remoteHostConfig = normalizeSyncConfig(remote.hostConfig, hostSyncConfigRef.current);
      const config = resolveRemoteSyncConfig({
        mode,
        isHost: isHostRef.current,
        remoteHostConfig,
        clientSyncConfig: clientSyncConfigRef.current,
      });
      const incomingSettings = mode === 'full' && config.syncSettings && remote.settings
        ? normalizeSettings(remote.settings)
        : null;
      
      if (incomingSettings) {
          setSettings(prev => ({
            ...incomingSettings,
            disableBlur: prev.disableBlur,
            themeMode: prev.themeMode,
          }));
      }
      if (mode === 'full' && config.syncTasks && Array.isArray(remote.tasks)) {
          lastTaskIdSeed = Math.max(lastTaskIdSeed, getMaxTaskId(remote.tasks));
          setTasks(normalizeTaskState(remote.tasks));
          if (Array.isArray(remote.categories)) setCategories(remote.categories);
      }
      if (mode === 'full' && config.syncHistory && Array.isArray(remote.logs)) setLogs(remote.logs);
      if (mode === 'full' && config.syncSchedule) {
          if (Array.isArray(remote.scheduleBreaks)) setScheduleBreaks(remote.scheduleBreaks);
          if (typeof remote.scheduleStartTime === 'string') setScheduleStartTime(remote.scheduleStartTime);
          if (typeof remote.sessionStartTime === 'string' || remote.sessionStartTime === null) setSessionStartTime(remote.sessionStartTime ?? null);
          if (typeof remote.delayedStartTargetTime === 'string' || remote.delayedStartTargetTime === null) setDelayedStartTargetTime(remote.delayedStartTargetTime ?? null);
      }
      if (config.syncTimers) {
          if (Object.prototype.hasOwnProperty.call(remote, 'focusTimerDisplayOffsetSeconds')) {
              setFocusTimerDisplayOffsetSeconds(normalizeFocusTimerDisplayOffsetSeconds(remote.focusTimerDisplayOffsetSeconds));
          }
          if (Object.prototype.hasOwnProperty.call(remote, 'lockedTimerMode')) {
              const shouldDropRemoteTimerLock = incomingSettings?.timerPreset === 'focus' || settings.timerPreset === 'focus';
              const remoteTimerLock = shouldDropRemoteTimerLock
                ? { mode: null, startedAtMs: null }
                : normalizeLockedTimerState(remote.lockedTimerMode, remote.lockedTimerStartedAtMs);
              setLockedTimerMode(remoteTimerLock.mode);
              setLockedTimerStartedAtMs(remoteTimerLock.startedAtMs);
          }
          const remoteRuntime = isRuntimeSnapshot(remote.runtime) ? remote.runtime : null;
          if (shouldApplyIncomingRuntime({
            incomingRuntime: remoteRuntime,
            lastAppliedAtMs: lastRuntimeAppliedRef.current,
          })) {
              const now = Date.now();
              const derived = deriveRuntimeValues(remoteRuntime!, now);
              const runtimeMode: TimerMode = remoteRuntime!.phase === 'running-break'
                ? 'break'
                : (remote.activeMode === 'work' || remote.activeMode === 'break' ? remote.activeMode : activeModeRef.current);
              const remoteGrace = normalizeGraceWindow({
                graceOpenCandidate: remoteRuntime!.phase === 'grace',
                rawGraceContext: remote.graceContext,
                fallbackMode: runtimeMode,
              });
              runtimeRef.current = remoteRuntime!;
              lastRuntimeAppliedRef.current = remoteRuntime!.updatedAtMs;
              currentActivityStartRef.current = remoteRuntime!.activityStartIso ? new Date(remoteRuntime!.activityStartIso) : null;
              setWorkTime(derived.workTime);
              setBreakTime(derived.breakTime);
              setActiveMode(remoteRuntime!.phase === 'running-work' ? 'work' : remoteRuntime!.phase === 'running-break' ? 'break' : runtimeMode);
              setTimerStarted(remoteRuntime!.phase === 'running-work' || remoteRuntime!.phase === 'running-break');
              setIsIdle(remoteRuntime!.phase === 'idle');
              if (typeof remote.pomodoroCount === 'number') setPomodoroCount(remote.pomodoroCount);
              setAllPauseActive(remoteRuntime!.phase === 'all-pause');
              setAllPauseTime(derived.allPauseTime);
              if (typeof remote.allPauseReason === 'string') setAllPauseReason(remote.allPauseReason);
              else if (remoteRuntime!.phase !== 'all-pause') setAllPauseReason('');
              if (remote.allPauseStartTime === null || typeof remote.allPauseStartTime === 'number') setAllPauseStartTime(remote.allPauseStartTime ?? null);
              else if (remoteRuntime!.phase !== 'all-pause') setAllPauseStartTime(null);
              setGraceOpen(remoteGrace.graceOpen);
              setGraceContext(remoteGrace.graceContext);
              setGraceTotal(remoteGrace.graceOpen ? derived.graceTotal : 0);
          }
      }
      if (!isHostRef.current && remote.hostConfig) {
          hostSyncConfigRef.current = remoteHostConfig;
          setHostSyncConfig(remoteHostConfig);
      }
      remoteUpdateClearTimeoutRef.current = setTimeout(() => {
        if (remoteUpdateVersionRef.current !== releaseVersion) return;
        isRemoteUpdate.current = false;
        remoteUpdateClearTimeoutRef.current = null;
      }, 120);
  }, []);

  const broadcastState = useCallback((excludeConnId?: string) => {
      if (!shouldBroadcastGroupState({
        groupSessionId: groupSessionIdRef.current,
        isHost: isHostRef.current,
      })) return;
      const openConnections = pruneConnections();
      if (openConnections.length === 0) return;
      const fullState = getCurrentState();

      const filteredState = buildFilteredGroupState(fullState, hostSyncConfigRef.current);
      const spectatorState = buildTimerSpectatorState(fullState);
      openConnections.forEach(conn => {
          if (conn.open && conn.peer !== excludeConnId) {
              if (isSpectatorConnection(conn)) {
                  conn.send({ type: 'SPECTATOR_STATE', state: spectatorState });
                  return;
              }
              conn.send({ type: 'STATE_UPDATE', state: filteredState });
          }
      });
  }, [getCurrentState, buildFilteredGroupState, buildTimerSpectatorState, pruneConnections, settings.timerPreset]);

  useEffect(() => {
     if(!groupSessionId || isRemoteUpdate.current) return;
     const t = setTimeout(() => { broadcastState(); }, 80);
     return () => clearTimeout(t);
  }, [tasks, settings, activeMode, timerStarted, isIdle, lockedTimerMode, lockedTimerStartedAtMs, workTime, breakTime, scheduleBreaks, scheduleStartTime, sessionStartTime, delayedStartTargetTime, focusTimerDisplayOffsetSeconds, pomodoroCount, allPauseActive, allPauseTime, allPauseReason, allPauseStartTime, graceOpen, graceContext, graceTotal, groupSessionId, broadcastState, hostSyncConfig, clientSyncConfig, isHost]);

  const updateMembersList = useCallback(() => {
      if (!isHostRef.current) return;
      const openConnections = pruneConnections();
      const memberConnections = openConnections.filter(connection => !isSpectatorConnection(connection));
      const hostId = localPeerIdRef.current || groupSessionIdRef.current || 'host';
      const hostName = rememberMemberName(hostId, userNameRef.current, 'Host');
      const memberList = buildHostMemberList(
        hostId,
        hostName,
        memberConnections.map(c => ({ id: c.peer, name: getConnectionMemberName(c) })),
      );
      setMembers(memberList);
      memberConnections.forEach(c => { if(c.open) c.send({ type: 'MEMBERS_UPDATE', members: memberList }); });
  }, [getConnectionMemberName, pruneConnections, rememberMemberName]);

  const upsertClientMembers = useCallback((hostId: string, rawHostName: unknown, selfId: string | null | undefined, rawSelfName: unknown) => {
      const hostName = rememberMemberName(hostId, rawHostName, 'Host');
      const selfName = rememberMemberName(selfId, rawSelfName);
      setMembers(prev => mergeClientMembers({
        existingMembers: prev,
        hostId,
        hostName,
        selfId,
        selfName,
      }));
      return hostName;
  }, [rememberMemberName]);

  const createGroupSession = async (name: string, config: GroupSyncConfig): Promise<string> => {
      const normalizedConfig = normalizeSyncConfig(config, hostSyncConfigRef.current);
      if (groupSessionIdRef.current || peerRef.current || connectionsRef.current.length > 0) {
          leaveGroupSession();
      }
      const lifecycleId = groupLifecycleRef.current + 1;
      groupLifecycleRef.current = lifecycleId;
      userNameRef.current = name;
      setUserName(name);
      hostSyncConfigRef.current = normalizedConfig;
      setHostSyncConfig(normalizedConfig);
      lastClientTimerBroadcastSignatureRef.current = null;
      clientReadyForBroadcastRef.current = true;
      memberNamesRef.current = {};
      announcedPeerIdsRef.current = new Set();
      seenGroupEventIdsRef.current = new Set();
      spectatorEncouragementLastAtRef.current = {};

      return new Promise((resolve, reject) => {
          let settled = false;
          const isStale = () => groupLifecycleRef.current !== lifecycleId;
          const timeoutId = setTimeout(() => {
              if (isStale()) return;
              if (settled) return;
              settled = true;
              try { peerRef.current?.destroy(); } catch {}
              peerRef.current = null;
              connectionsRef.current = [];
              localPeerIdRef.current = null;
              groupSessionIdRef.current = null;
              isHostRef.current = false;
              setGroupSessionId(null);
              setIsHost(false);
              setMembers([]);
              setPeerError("Timed out creating group session. Check your connection and try again.");
              reject(new Error("Timed out creating group session."));
          }, GROUP_CONNECT_TIMEOUT_MS);

          const settle = (handler: () => void) => {
              if (settled) return;
              settled = true;
              clearTimeout(timeoutId);
              handler();
          };

          try {
            const shortId = Math.random().toString(36).substring(2, 8).toUpperCase();
            // @ts-ignore
            const peer = new Peer(shortId);
            peerRef.current = peer;

            peer.on('open', (id: string) => {
                if (isStale()) {
                  try { peer.destroy(); } catch {}
                  return;
                }
                if (settled) {
                  localPeerIdRef.current = id;
                  groupSessionIdRef.current = id;
                  isHostRef.current = true;
                  setGroupSessionId(id);
                  setIsHost(true);
                  setPeerError(null);
                  updateMembersList();
                  broadcastState();
                  return;
                }
                settle(() => {
                  const hostName = rememberMemberName(id, name, 'Host');
                  localPeerIdRef.current = id;
                  groupSessionIdRef.current = id;
                  isHostRef.current = true;
                  setGroupSessionId(id);
                  setIsHost(true);
                  setPeerError(null);
                  setMembers([{ id, name: hostName, isHost: true }]);
                  resolve(id);
                });
            });

            peer.on('disconnected', () => {
                if (isStale()) return;
                setPeerError('Session connection interrupted. Reconnecting...');
                if (shouldAttemptPeerReconnect({
                  disconnected: peer.disconnected,
                  destroyed: peer.destroyed,
                })) {
                  try { peer.reconnect(); } catch {}
                }
            });

            peer.on('close', () => {
                if (isStale()) return;
                const message = 'Group session closed.';
                if (!settled) {
                  settle(() => {
                    peerRef.current = null;
                    connectionsRef.current = [];
                    localPeerIdRef.current = null;
                    groupSessionIdRef.current = null;
                    isHostRef.current = false;
                    setGroupSessionId(null);
                    setIsHost(false);
                    setMembers([]);
                    setPeerError(message);
                    reject(new Error(message));
                  });
                  return;
                }
                leaveGroupSession({ reason: message, preserveConfigs: true });
            });

            peer.on('connection', (conn: DataConnection) => {
                if (isStale()) {
                  try { conn.close(); } catch {}
                  return;
                }
                const spectatorConnection = isSpectatorConnection(conn);
                const sendSpectatorUpdate = () => {
                  if (!conn.open) return;
                  conn.send({ type: 'SPECTATOR_STATE', state: buildTimerSpectatorState(getCurrentState()) });
                };
                const cleanupConnection = () => {
                  const { remainingConnections, hasPeerConnection } = removePeerConnectionInstance(connectionsRef.current, conn);
                  connectionsRef.current = remainingConnections;
                  if (!spectatorConnection && !hasPeerConnection) {
                    delete memberNamesRef.current[conn.peer];
                    announcedPeerIdsRef.current.delete(conn.peer);
                  }
                  const replacementConnection = remainingConnections.find(connection => connection.peer === conn.peer);
                  if (!spectatorConnection && shouldRefreshMembersAfterPeerCleanup({
                    hasPeerConnection,
                    replacementConnectionOpen: Boolean(replacementConnection?.open),
                  })) {
                    updateMembersList();
                  }
                };
                if (!spectatorConnection) rememberMemberName(conn.peer, (conn.metadata as any)?.name);
                connectionsRef.current = connectionsRef.current.filter(existing => {
                  if (existing.peer !== conn.peer) return true;
                  try { existing.close(); } catch {}
                  return false;
                });
                connectionsRef.current.push(conn);

                conn.on('open', () => {
                  if (isStale()) return;
                  connectionsRef.current = connectionsRef.current.filter(existing => existing.peer !== conn.peer);
                  connectionsRef.current.push(conn);
                  if (spectatorConnection) {
                    sendSpectatorUpdate();
                    return;
                  }
                  const initialState = buildFilteredGroupState(getCurrentState(), hostSyncConfigRef.current);
                  conn.send({ type: 'STATE_UPDATE', state: initialState });
                  const remoteName = getConnectionMemberName(conn);
                  updateMembersList();
                  if (remoteName !== GROUP_MEMBER_FALLBACK_NAME) {
                    announceMemberJoin(conn.peer, remoteName);
                  }
                });

                conn.on('data', (data: any) => {
                    if (isStale()) return;
                    if (!data || typeof data !== 'object') return;
                    if (spectatorConnection) {
                        if (data.type === 'SPECTATOR_ENCOURAGEMENT') {
                          postSpectatorEncouragementNotice(data, conn);
                          return;
                        }
                        if (data.type === 'SPECTATOR_REQUEST' || data.type === 'STATE_REQUEST' || data.type === 'TIMER_STATE') {
                          sendSpectatorUpdate();
                        }
                        return;
                    }
                    if (data.type === 'MEMBER_INTRO') {
                        const remoteName = rememberMemberName(conn.peer, data.name);
                        updateMembersList();
                        announceMemberJoin(conn.peer, remoteName);
                        return;
                    }
                    if (data.type === 'GROUP_EVENT') {
                        const actorName = rememberMemberName(conn.peer, data.event?.actorName ?? (conn.metadata as any)?.name);
                        updateMembersList();
                        const forwardedEvent = normalizeGroupEventPayload({
                          ...(data.event || {}),
                          actorId: conn.peer,
                          actorName,
                        }, conn.peer, actorName);
                        if (forwardedEvent) {
                            postGroupNotice(forwardedEvent);
                            sendGroupEvent(forwardedEvent, conn.peer);
                        }
                        return;
                    }
                    if (data.type === 'STATE_REQUEST') {
                        if (conn.open) {
                          conn.send({ type: 'STATE_UPDATE', state: buildFilteredGroupState(getCurrentState(), hostSyncConfigRef.current) });
                        }
                        return;
                    }
                    if (data.type === 'TIMER_STATE' && data.state && hostSyncConfigRef.current.syncTimers) {
                        if (conn.open) {
                          conn.send({ type: 'TIMER_STATE', state: buildFilteredGroupState(getCurrentState(), TIMER_ONLY_SYNC_CONFIG) });
                        }
                        return;
                    }
                    // Backward compatibility for older clients that still send STATE_UPDATE.
                    if (data.type === 'STATE_UPDATE' && data.state && hostSyncConfigRef.current.syncTimers) {
                        if (conn.open) {
                          conn.send({ type: 'STATE_UPDATE', state: buildFilteredGroupState(getCurrentState(), hostSyncConfigRef.current) });
                        }
                    }
                });

                conn.on('error', () => {
                  if (isStale()) return;
                  cleanupConnection();
                });

                conn.on('close', () => {
                  if (isStale()) return;
                  cleanupConnection();
                });
            });

            peer.on('error', (err: any) => {
                if (isStale()) return;
                const message = err?.type === 'unavailable-id'
                  ? "Session ID collision. Try again."
                  : `Connection Error: ${err?.type || 'unknown'}`;
                if (!settled) {
                  settle(() => {
                    try { peer.destroy(); } catch {}
                    peerRef.current = null;
                    connectionsRef.current = [];
                    localPeerIdRef.current = null;
                    groupSessionIdRef.current = null;
                    isHostRef.current = false;
                    setGroupSessionId(null);
                    setIsHost(false);
                    setMembers([]);
                    setPeerError(message);
                    reject(new Error(message));
                  });
                  return;
                }
                setPeerError(message);
            });
          } catch (e) {
            settle(() => {
              const error = e instanceof Error ? e : new Error('Failed to create group session.');
              setPeerError(error.message);
              reject(error);
            });
          }
      });
  };

  const joinGroupSession = async (hostId: string, name: string, config: GroupSyncConfig): Promise<void> => {
      const sessionId = hostId.trim().toUpperCase();
      if (!sessionId) throw new Error('Session ID is required.');
      const normalizedConfig = normalizeSyncConfig(config, clientSyncConfigRef.current);
      if (groupSessionIdRef.current || peerRef.current || connectionsRef.current.length > 0) {
          leaveGroupSession();
      }
      const lifecycleId = groupLifecycleRef.current + 1;
      groupLifecycleRef.current = lifecycleId;
      userNameRef.current = name;
      isHostRef.current = false;
      setUserName(name);
      clientSyncConfigRef.current = normalizedConfig;
      setClientSyncConfig(normalizedConfig);
      lastClientTimerBroadcastSignatureRef.current = null;
      clientReadyForBroadcastRef.current = false;
      memberNamesRef.current = {};
      announcedPeerIdsRef.current = new Set();
      seenGroupEventIdsRef.current = new Set();
      spectatorEncouragementLastAtRef.current = {};

      return new Promise((resolve, reject) => {
          let settled = false;
          let conn: DataConnection | null = null;
          const isStale = () => groupLifecycleRef.current !== lifecycleId;
          const timeoutId = setTimeout(() => {
              if (isStale()) return;
              if (settled) return;
              settled = true;
              try { conn?.close(); } catch {}
              try { peerRef.current?.destroy(); } catch {}
              peerRef.current = null;
              connectionsRef.current = [];
              localPeerIdRef.current = null;
              groupSessionIdRef.current = null;
              isHostRef.current = false;
              setGroupSessionId(null);
              setIsHost(false);
              setMembers([]);
              setPeerError("Timed out joining the host session. Verify the ID and try again.");
              reject(new Error("Timed out joining the host session."));
          }, GROUP_CONNECT_TIMEOUT_MS);

          const fail = (message: string, err?: unknown) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            try { conn?.close(); } catch {}
            try { peerRef.current?.destroy(); } catch {}
            peerRef.current = null;
            connectionsRef.current = [];
            localPeerIdRef.current = null;
            groupSessionIdRef.current = null;
            isHostRef.current = false;
            setGroupSessionId(null);
            setIsHost(false);
            setMembers([]);
            setPeerError(message);
            if (err instanceof Error) reject(err);
            else reject(new Error(message));
          };

          const succeed = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            setPeerError(null);
            resolve();
          };

          const syncJoinedHostConnection = (connection: DataConnection, localPeerId: string, localName: string) => {
            if (!connection.open) return;
            upsertClientMembers(sessionId, undefined, localPeerId, localName);
            connection.send({ type: 'MEMBER_INTRO', name: localName });
            connection.send({ type: 'STATE_REQUEST' });
          };

          const cleanupJoinedHostConnection = (targetConn: DataConnection) => {
            const { remainingConnections, hasPeerConnection } = removePeerConnectionInstance(connectionsRef.current, targetConn);
            connectionsRef.current = remainingConnections;
            return hasPeerConnection;
          };

          const bindHostConnection = (
            nextConn: DataConnection,
            localPeerId: string,
            localName: string,
            options?: { resolveOnOpen?: boolean },
          ) => {
            conn = nextConn;
            connectionsRef.current = [...connectionsRef.current.filter(existing => existing !== nextConn), nextConn];

            nextConn.on('open', () => {
              if (isStale()) return;
              conn = nextConn;
              connectionsRef.current = connectionsRef.current.filter(existing => existing !== nextConn);
              connectionsRef.current.push(nextConn);
              pruneConnections();
              setPeerError(null);
              syncJoinedHostConnection(nextConn, localPeerId, localName);
              if (options?.resolveOnOpen) {
                succeed();
              }
            });

            nextConn.on('data', (data: any) => {
              if (isStale()) return;
              if (!data || typeof data !== 'object') return;
              if (data.type === 'STATE_UPDATE') {
                clientReadyForBroadcastRef.current = true;
                upsertClientMembers(
                  sessionId,
                  data.state?.userName ?? data.state?.user?.username ?? data.state?.hostName,
                  localPeerId,
                  localName,
                );
                applyRemoteState(data.state, 'full');
              }
              else if (data.type === 'TIMER_STATE') {
                clientReadyForBroadcastRef.current = true;
                upsertClientMembers(sessionId, undefined, localPeerId, localName);
                applyRemoteState(data.state, 'timer-only');
              }
              else if (data.type === 'MEMBERS_UPDATE') {
                const normalizedMembers = normalizeGroupMembersPayload(data.members);
                normalizedMembers.forEach(member => {
                  memberNamesRef.current[member.id] = member.name;
                });
                const resolvedHostName = normalizedMembers.find(member => member.isHost || member.id === sessionId)?.name;
                setMembers(mergeClientMembers({
                  existingMembers: normalizedMembers,
                  hostId: sessionId,
                  hostName: resolvedHostName,
                  selfId: localPeerId,
                  selfName: localName,
                }));
              }
              else if (data.type === 'GROUP_EVENT') {
                const remoteEvent = normalizeGroupEventPayload(data.event);
                if (remoteEvent) {
                  rememberMemberName(remoteEvent.actorId, remoteEvent.actorName);
                  postGroupNotice(remoteEvent);
                }
              }
            });

            nextConn.on('error', (err: any) => {
              if (isStale()) return;
              const message = `Unable to connect to host (${err?.type || 'error'}).`;
              const hasPeerConnection = cleanupJoinedHostConnection(nextConn);
              if (!settled) {
                fail(message, err instanceof Error ? err : new Error(message));
                return;
              }
              if (hasPeerConnection) return;
              leaveGroupSession({ reason: message, preserveConfigs: true });
            });

            nextConn.on('close', () => {
              if (isStale()) return;
              const message = 'Disconnected from Host';
              const hasPeerConnection = cleanupJoinedHostConnection(nextConn);
              if (!settled) {
                fail(message, new Error(message));
                return;
              }
              if (hasPeerConnection) return;
              leaveGroupSession({ reason: message, preserveConfigs: true });
            });
          };

          try {
            // @ts-ignore
            const peer = new Peer();
            peerRef.current = peer;
            peer.on('open', (id: string) => {
                if (isStale()) {
                  try { peer.destroy(); } catch {}
                  return;
                }
                const localName = rememberMemberName(id, name);
                if (settled) {
                  localPeerIdRef.current = id;
                  setPeerError(null);
                  const hostConnections = pruneConnections().filter(connection => connection.peer === sessionId);
                  const hostConn = hostConnections.find(connection => connection.open);
                  if (hostConn?.open) {
                    syncJoinedHostConnection(hostConn, id, localName);
                  } else if (shouldCreateReplacementPeerConnection({
                    hasOpenConnection: false,
                    hasPendingConnection: hostConnections.some(connection => !connection.open),
                  })) {
                    bindHostConnection(peer.connect(sessionId, { metadata: { name: localName } }), id, localName);
                  }
                  return;
                }
                localPeerIdRef.current = id;
                groupSessionIdRef.current = sessionId;
                isHostRef.current = false;
                setGroupSessionId(sessionId);
                setIsHost(false);
                setPeerError(null);
                conn = peer.connect(sessionId, { metadata: { name: localName } });
                connectionsRef.current = [conn];
                setMembers([
                  { id: sessionId, name: 'Host', isHost: true },
                  { id, name: localName, isHost: false },
                ]);
                bindHostConnection(conn, id, localName, { resolveOnOpen: true });
            });

            peer.on('disconnected', () => {
              if (isStale()) return;
              setPeerError('Connection to group service lost. Reconnecting...');
              if (shouldAttemptPeerReconnect({
                disconnected: peer.disconnected,
                destroyed: peer.destroyed,
              })) {
                try { peer.reconnect(); } catch {}
              }
            });

            peer.on('close', () => {
              if (isStale()) return;
              const message = 'Disconnected from Host';
              if (!settled) {
                fail(message, new Error(message));
                return;
              }
              leaveGroupSession({ reason: message, preserveConfigs: true });
            });

            peer.on('error', (err: any) => {
              if (isStale()) return;
              const message = err?.type === 'peer-unavailable'
                ? 'Host session not found. Check the ID and try again.'
                : `Connection Failed: ${err?.type || 'unknown'}`;
              if (!settled) {
                fail(message, err instanceof Error ? err : new Error(message));
                return;
              }
              setPeerError(message);
            });
          } catch (e) {
            const error = e instanceof Error ? e : new Error('Failed to join group session.');
            fail(error.message, error);
          }
      });
  };

  const leaveGroupSession = (options?: { reason?: string, preserveConfigs?: boolean }) => {
      groupLifecycleRef.current += 1;
      if (remoteUpdateClearTimeoutRef.current) {
        clearTimeout(remoteUpdateClearTimeoutRef.current);
        remoteUpdateClearTimeoutRef.current = null;
      }
      remoteUpdateVersionRef.current += 1;
      isRemoteUpdate.current = false;
      if (peerRef.current) { try { peerRef.current.destroy(); } catch {} peerRef.current = null; }
      connectionsRef.current.forEach(conn => { try { conn.close(); } catch {} });
      connectionsRef.current = [];
      lastClientTimerBroadcastSignatureRef.current = null;
      localPeerIdRef.current = null;
      groupSessionIdRef.current = null;
      isHostRef.current = false;
      memberNamesRef.current = {};
      announcedPeerIdsRef.current = new Set();
      seenGroupEventIdsRef.current = new Set();
      spectatorEncouragementLastAtRef.current = {};
      clientReadyForBroadcastRef.current = true;
      setGroupNotice(null);
      setGuestTimerLockNotice(null);
      setGroupSessionId(null);
      setIsHost(false);
      setMembers([]);
      if (!options?.preserveConfigs) {
        hostSyncConfigRef.current = DEFAULT_SYNC_CONFIG;
        clientSyncConfigRef.current = DEFAULT_SYNC_CONFIG;
        setHostSyncConfig(DEFAULT_SYNC_CONFIG);
        setClientSyncConfig(DEFAULT_SYNC_CONFIG);
      }
      if (options?.reason) setPeerError(options.reason);
      else setPeerError(null);
  };

  const updateHostSyncConfig = (config: GroupSyncConfig) => {
    const normalizedConfig = normalizeSyncConfig(config, hostSyncConfigRef.current);
    hostSyncConfigRef.current = normalizedConfig;
    setHostSyncConfig(normalizedConfig);
    broadcastState();
  };

  const updateClientSyncConfig = (config: GroupSyncConfig) => {
    const previousConfig = clientSyncConfigRef.current;
    const wasReadyForBroadcast = clientReadyForBroadcastRef.current;
    const normalizedConfig = normalizeSyncConfig(config, clientSyncConfigRef.current);
    const hostConn = !isHostRef.current && groupSessionIdRef.current
      ? pruneConnections().find(conn => conn.open)
      : null;
    clientSyncConfigRef.current = normalizedConfig;
    setClientSyncConfig(normalizedConfig);

    if (shouldAwaitFreshHostTimerState({
      previousConfig,
      nextConfig: normalizedConfig,
      wasReadyForBroadcast,
      hasOpenHostConnection: Boolean(hostConn?.open),
    })) {
      clientReadyForBroadcastRef.current = false;
    } else if (!normalizedConfig.syncTimers) {
      clientReadyForBroadcastRef.current = true;
    }

    if (isHostRef.current || !groupSessionIdRef.current) return;
    if (!hostConn?.open) return;
    hostConn.send({ type: 'STATE_REQUEST' });
  };
  
  useEffect(() => {
    const workerCode = `
      let intervalId;
      self.onmessage = function(e) {
        if (e.data === 'start') {
          if (intervalId) clearInterval(intervalId);
          intervalId = setInterval(() => { self.postMessage('tick'); }, 500);
        } else if (e.data === 'stop') {
          if (intervalId) clearInterval(intervalId);
          intervalId = null;
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    workerRef.current = new Worker(URL.createObjectURL(blob));
    return () => { workerRef.current?.terminate(); };
  }, []);

  const activeContext = findActiveContext(tasks);
  const activeTask = activeContext.task;
  const activeColor = activeContext.color;

  const prependLogEntry = useCallback((entry: LogEntry) => {
    setLogs(prev => {
      const nextLogs = [entry, ...prev];
      logsRef.current = nextLogs;
      return nextLogs;
    });
  }, []);

  const logActivity = useCallback((type: LogEntry['type'], start: Date, duration: number, reason: string = '', taskOverride?: Task) => {
    const selectedTask = taskOverride || findSelectedTask(tasks);
    const currentContext = findActiveContext(tasks);
    const categorySnapshot = buildCategorySnapshot(categories, selectedTask?.categoryId ?? null);
    const entry: LogEntry = {
      type, start: start.toISOString(), end: new Date().toISOString(),
      duration, reason, task: selectedTask ? { id: selectedTask.id, name: selectedTask.name } : null,
      color: currentContext.color,
      categoryId: selectedTask ? selectedTask.categoryId : null,
      ...categorySnapshot,
    };
    prependLogEntry(entry);
  }, [categories, prependLogEntry, tasks]);

  useEffect(() => {
    const checkedTaskIds = getCheckedTaskIdSet(tasks);

    if (!sessionStartTime) {
      sessionTaskBaselineRef.current = null;
      taskCompletionWatcherRef.current = { sessionStartTime: null, checkedTaskIds };
      return;
    }

    if (sessionTaskBaselineRef.current?.sessionStartTime !== sessionStartTime) {
      sessionTaskBaselineRef.current = {
        sessionStartTime,
        checkedTaskIds: new Set(checkedTaskIds),
      };
      taskCompletionWatcherRef.current = { sessionStartTime, checkedTaskIds };
      return;
    }

    const previous = taskCompletionWatcherRef.current;
    const completedTasks = previous.sessionStartTime === sessionStartTime
      ? flattenTasks(tasks).filter(task => (
        task.checked
        && typeof task.id === 'number'
        && Number.isFinite(task.id)
        && !previous.checkedTaskIds.has(task.id)
      ))
      : [];

    taskCompletionWatcherRef.current = { sessionStartTime, checkedTaskIds };
    if (completedTasks.length === 0) return;

    const alreadyLoggedTaskIds = getSessionTaskCompletionIdsFromLogs(logsRef.current, sessionStartTime);
    const completionEntries = completedTasks
      .filter(task => !alreadyLoggedTaskIds.has(task.id))
      .map((task, index): LogEntry => {
        const completedAt = new Date(Date.now() + index);
        const categorySnapshot = buildCategorySnapshot(categories, task.categoryId ?? null);
        return {
          type: 'task-complete',
          start: completedAt.toISOString(),
          end: completedAt.toISOString(),
          duration: 0,
          reason: 'Task Complete',
          source: 'timer',
          task: { id: task.id, name: task.name },
          color: task.color || categorySnapshot.categoryColor,
          categoryId: task.categoryId ?? null,
          ...categorySnapshot,
        };
      });

    if (completionEntries.length === 0) return;

    setLogs(prev => {
      const latestLoggedTaskIds = getSessionTaskCompletionIdsFromLogs(prev, sessionStartTime);
      const nextEntries = completionEntries.filter(entry => {
        const taskId = entry.task?.id;
        return typeof taskId === 'number' && Number.isFinite(taskId) && !latestLoggedTaskIds.has(taskId);
      });

      if (nextEntries.length === 0) return prev;
      const nextLogs = [...nextEntries, ...prev];
      logsRef.current = nextLogs;
      return nextLogs;
    });
  }, [categories, sessionStartTime, tasks]);

  const addManualFocusLog = useCallback((minutes: number, note: string = '', categoryId: number | null = null) => {
    const safeMinutes = Math.max(0, Math.round(Number(minutes)));
    if (!Number.isFinite(safeMinutes) || safeMinutes <= 0) return;

    const selectedCategory = typeof categoryId === 'number' && Number.isFinite(categoryId)
      ? categories.find(category => category.id === categoryId && !category.archived)
      : null;
    const resolvedCategoryId = selectedCategory?.id ?? null;
    const categorySnapshot = buildCategorySnapshot(categories, resolvedCategoryId);
    const end = new Date();
    const start = new Date(end.getTime() - (safeMinutes * 60_000));
    const trimmedNote = typeof note === 'string' ? note.trim() : '';
    const entry: LogEntry = {
      type: 'work',
      start: start.toISOString(),
      end: end.toISOString(),
      duration: safeMinutes * 60,
      reason: trimmedNote || 'Manual Focus',
      source: 'manual',
      task: null,
      color: selectedCategory?.color,
      categoryId: resolvedCategoryId,
      ...categorySnapshot,
    };
    const nextLogs = [entry, ...logsRef.current];
    logsRef.current = nextLogs;
    setLogs(nextLogs);
    if (user) {
      setUser(prev => (
        prev
          ? {
              ...prev,
              lifetimeStats: calculateLifetimeStatsFromData(pastSessions, nextLogs, categories),
            }
          : prev
      ));
    }
  }, [categories, pastSessions, user]);

  const sendNotification = useCallback((title: string, body: string) => {
    if ("Notification" in window) {
       if (Notification.permission === "granted") {
          try {
            new Notification(title, { body, tag: 'lumina-timer', requireInteraction: true, vibrate: [200, 100, 200] } as any);
          } catch(e) { console.error(e); }
       }
    }
    if (typeof navigator !== 'undefined' && "vibrate" in navigator) navigator.vibrate([200, 100, 200, 100, 200]);
  }, []);

  const resetTimerTabTitle = useCallback(() => {
    if (typeof document === 'undefined') return;
    document.title = DEFAULT_TAB_TITLE;
  }, []);

  const showTimerTabTitleNotification = useCallback((notification: TimerTabTitleNotification) => {
    if (typeof document === 'undefined') return;
    const hasFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
    document.title = shouldShowTimerTabTitleNotification({
      visibilityState: document.visibilityState,
      hasFocus,
    })
      ? getTimerTabTitleNotification(notification)
      : DEFAULT_TAB_TITLE;
  }, []);

  useEffect(() => {
    resetTimerTabTitle();

    const resetOnOpen = () => {
      if (document.visibilityState === 'visible') {
        resetTimerTabTitle();
      }
    };

    document.addEventListener('visibilitychange', resetOnOpen);
    window.addEventListener('focus', resetTimerTabTitle);

    return () => {
      document.removeEventListener('visibilitychange', resetOnOpen);
      window.removeEventListener('focus', resetTimerTabTitle);
      resetTimerTabTitle();
    };
  }, [resetTimerTabTitle]);

  const handleBreakBoundaryReached = useCallback((overflowSeconds: number = 0) => {
    if (graceOpen) return;
    const now = new Date();
    const delayedStartTargetIso = delayedStartTargetTimeRef.current;
    const delayedStartBoundary = getDelayedStartBoundaryState(delayedStartTargetIso, now.getTime());
    if (delayedStartBoundary) {
      const focusStartMs = delayedStartBoundary.targetMs;
      const focusStartDate = new Date(focusStartMs);
      const elapsedFocusSeconds = delayedStartBoundary.focusElapsedSeconds;
      const nextWorkTime = Math.max(0, settings.workDuration - elapsedFocusSeconds);
      const nextScheduleStartTime = getScheduleStartLabel(focusStartDate);

      setDelayedStartTargetTime(null);
      delayedStartTargetTimeRef.current = null;
      setWorkTime(nextWorkTime);
      setBreakTime(0);
      setActiveMode('work');
      setTimerStarted(true);
      setIsIdle(false);
      setGraceContext(null);
      setGraceTotal(0);
      setGraceOpen(false);
      setSessionStartTime(delayedStartBoundary.targetIso);
      setScheduleStartTime(nextScheduleStartTime);
      currentActivityStartRef.current = focusStartDate;
      lastTickRef.current = now.getTime();
      playSwitch();
      anchorRuntimePhase('running-work', {
        phaseStartWorkTime: nextWorkTime,
        phaseStartBreakTime: 0,
        phaseStartGraceTotal: 0,
        activityStartIso: focusStartDate.toISOString(),
        activeMode: 'work',
        timerStarted: true,
        isIdle: false,
        graceOpen: false,
        graceContext: null,
        graceTotal: 0,
        sessionStartTime: delayedStartBoundary.targetIso,
        delayedStartTargetTime: null,
        scheduleStartTime: nextScheduleStartTime,
      });
      dispatchDelayedStartSessionStarted();
      return;
    }
    const isFocusTimerPreset = settings.timerPreset === 'focus';
    if (!isFocusTimerPreset) {
      showTimerTabTitleNotification('breakDone');
    }
    if (currentActivityStartRef.current) {
      const elapsed = Math.max(0, (now.getTime() - currentActivityStartRef.current.getTime()) / 1000);
      const completedBreakDuration = Math.max(0, elapsed - overflowSeconds);
      if (completedBreakDuration > 0.5) {
        logActivity('break', currentActivityStartRef.current, completedBreakDuration, 'Break Complete');
      }
      currentActivityStartRef.current = null;
    }
    if (!isFocusTimerPreset) {
      playAlarm(settings.alarmSound);
    }
    const roundedDebtMinutes = Math.max(0, Math.ceil(overflowSeconds / 60));
    if (lockedTimerMode === 'break' || isFocusTimerPreset) {
      const nextBreakTime = -Math.max(0, overflowSeconds);
      const nextActivityStart = new Date(Date.now() - Math.max(0, overflowSeconds) * 1000);
      if (!isFocusTimerPreset) {
        sendNotification(
          'Break Time Ended',
          roundedDebtMinutes > 0
            ? `Break bank depleted. You are ${roundedDebtMinutes} min into break debt.`
            : 'Break bank depleted. Continuing break timer.',
        );
      }
      setTimerStarted(true);
      setActiveMode('break');
      setIsIdle(false);
      setBreakTime(nextBreakTime);
      setGraceContext(null);
      setGraceTotal(0);
      setGraceOpen(false);
      currentActivityStartRef.current = nextActivityStart;
      lastTickRef.current = Date.now();
      anchorRuntimePhase('running-break', {
        phaseStartWorkTime: workTime,
        phaseStartBreakTime: nextBreakTime,
        phaseStartGraceTotal: 0,
        activityStartIso: nextActivityStart.toISOString(),
        activeMode: 'break',
        timerStarted: true,
        isIdle: false,
        graceOpen: false,
        graceContext: null,
        graceTotal: 0,
      });
      return;
    }
    if (!isFocusTimerPreset) {
      sendNotification(
        'Break Time Ended',
        roundedDebtMinutes > 0
          ? `Break bank depleted. You are ${roundedDebtMinutes} min into break debt.`
          : 'Break bank depleted. Timer is now counting break debt.',
      );
    }
    setTimerStarted(false);
    setBreakTime(0);
    setGraceContext('afterBreak');
    setGraceTotal(Math.max(0, overflowSeconds));
    setGraceOpen(true);
    anchorRuntimePhase('grace', {
      phaseStartWorkTime: workTime,
      phaseStartBreakTime: 0,
      phaseStartGraceTotal: Math.max(0, overflowSeconds),
      activityStartIso: null,
      activeMode: 'break',
      timerStarted: false,
      isIdle: false,
      graceOpen: true,
      graceContext: 'afterBreak',
      graceTotal: Math.max(0, overflowSeconds),
    });
  }, [anchorRuntimePhase, graceOpen, lockedTimerMode, logActivity, sendNotification, settings.alarmSound, settings.timerPreset, settings.workDuration, showTimerTabTitleNotification, workTime]);

  const handleWorkLoopComplete = useCallback((initialGraceSeconds: number = 0) => {
    if (isProcessingRef.current) return;
    const now = Date.now();
    if (now - lastLoopTimeRef.current < 5000) return; 
    
    isProcessingRef.current = true;
    lastLoopTimeRef.current = now;
    
    const breakBankBase = getBreakBankBaseForWorkCompletion({
      breakTime,
      runtimeSnapshot: runtimeRef.current,
      nowMs: now,
    });
    const completion = computeWorkCompletion(pomodoroCount, breakBankBase, settings);
    const shouldAutoStartNextFocus = shouldAutoStartTwoInARowFocus(completion.nextPomoCount, settings);
    const isFocusTimerPreset = settings.timerPreset === 'focus';
    const shouldStartNextFocus = shouldAutoStartNextFocus || lockedTimerMode === 'work' || isFocusTimerPreset;
    if (!isFocusTimerPreset && (!shouldAutoStartNextFocus || settings.miniPomoAutoStartSoundEnabled)) {
      playAlarm(shouldAutoStartNextFocus ? settings.twoInARowStartSound : settings.alarmSound);
    }
    const nextWorkTime = shouldStartNextFocus ? settings.workDuration : 0;

    setBreakTime(completion.nextBreakTime);
    setPomodoroCount(completion.nextPomoCount);
    setWorkTime(nextWorkTime);

    if (currentActivityStartRef.current) {
      logActivity(
        'work',
        currentActivityStartRef.current,
        getCompletedPhaseDuration({
          snapshot: runtimeRef.current,
          mode: 'work',
          nowMs: now,
          overflowSeconds: initialGraceSeconds,
          activityStartIso: currentActivityStartRef.current.toISOString(),
          fallbackDuration: settings.workDuration,
        }),
        getCompletionReasonForSettings(settings),
      );
      currentActivityStartRef.current = null; 
    }
    
    setTasks(prevTasks => {
        const selected = findSelectedTask(prevTasks);
        if (!selected) return prevTasks;
        const todayKey = getDateKey(new Date());
        if (selected.checked || isDeferredTaskFromToday(selected, todayKey)) {
            return normalizeTaskState(prevTasks, { selectFirstAvailableIfNoSelection: true });
        }
        
        let updatedTasks = incrementCompletedInTree(prevTasks, selected.id);
        
        const updatedSelected = findTask(updatedTasks, selected.id);
        if (updatedSelected) {
             if (!updatedSelected.checked && updatedSelected.completed >= updatedSelected.estimated) {
                 updatedTasks = updateTaskInTree(updatedTasks, { ...updatedSelected, checked: true });
                 sendNotification("Goal Reached", `${updatedSelected.name} goal met. Continuing...`);
             }
        }
        
        return normalizeTaskState(updatedTasks, { selectFirstAvailableIfNoSelection: true });
    });

    if (!isFocusTimerPreset) {
      sendNotification(
        completion.isLongBreak
          ? "Long Break Earned!"
          : settings.timerPreset === 'compact'
            ? "Mini-Pomo Complete"
            : "Focus Session Complete",
        shouldStartNextFocus
          ? `${Math.floor(completion.reward/60)} minutes added to break bank. Next focus started.`
          : `${Math.floor(completion.reward/60)} minutes added to break bank.`,
      );
    }

    if (shouldStartNextFocus) {
      const nextActivityStart = new Date();
      currentActivityStartRef.current = nextActivityStart;
      setTimerStarted(true);
      setActiveMode('work');
      setIsIdle(false);
      setGraceContext(null);
      setGraceTotal(0);
      setGraceOpen(false);
      lastTickRef.current = Date.now();
      anchorRuntimePhase('running-work', {
        phaseStartWorkTime: nextWorkTime,
        phaseStartBreakTime: completion.nextBreakTime,
        phaseStartGraceTotal: 0,
        activityStartIso: nextActivityStart.toISOString(),
        activeMode: 'work',
        timerStarted: true,
        isIdle: false,
        graceOpen: false,
        graceContext: null,
        graceTotal: 0,
        pomodoroCount: completion.nextPomoCount,
      });
      setTimeout(() => { isProcessingRef.current = false; }, 2000);
      return;
    }

    showTimerTabTitleNotification('workDone');
    setTimerStarted(false);
    setGraceContext('afterWork');
    setGraceTotal(initialGraceSeconds);
    setGraceOpen(true);
    anchorRuntimePhase('grace', {
      phaseStartWorkTime: 0,
      phaseStartBreakTime: completion.nextBreakTime,
      phaseStartGraceTotal: initialGraceSeconds,
      activityStartIso: null,
      activeMode: 'work',
      timerStarted: false,
      isIdle: false,
      graceOpen: true,
      graceContext: 'afterWork',
      graceTotal: initialGraceSeconds,
      pomodoroCount: completion.nextPomoCount,
    });
    setTimeout(() => { isProcessingRef.current = false; }, 2000);
  }, [settings, logActivity, sendNotification, pomodoroCount, breakTime, anchorRuntimePhase, lockedTimerMode, showTimerTabTitleNotification]);

  useEffect(() => {
    if (!legacyRuntimeMode) return;
    if (timerStarted && !isIdle) {
      if (activeMode === 'work' && workTime <= 0) {
        handleWorkLoopComplete(0);
      }
    }
  }, [workTime, activeMode, timerStarted, isIdle, handleWorkLoopComplete, legacyRuntimeMode]);

  useEffect(() => {
    const previousBreakTime = previousLegacyBreakTimeRef.current;
    previousLegacyBreakTimeRef.current = breakTime;

    if (!legacyRuntimeMode) return;
    if (!timerStarted || isIdle || activeMode !== 'break') return;
    if (previousBreakTime === null) return;
    if (previousBreakTime > 0 && breakTime <= 0) {
      handleBreakBoundaryReached(Math.abs(breakTime));
    }
  }, [activeMode, breakTime, handleBreakBoundaryReached, isIdle, legacyRuntimeMode, timerStarted]);

  useEffect(() => {
    const shouldPlayFocusSoundDuringAfterWorkGrace = (
      graceOpen
      && graceContext === 'afterWork'
      && !allPauseActive
      && !isIdle
    );
    const shouldPlayFocusSound = (
      settings.focusSound !== 'off'
      && (
        (
          timerStarted
          && !isIdle
          && activeMode === 'work'
          && !allPauseActive
          && !graceOpen
        )
        || shouldPlayFocusSoundDuringAfterWorkGrace
      )
    );

    if (shouldPlayFocusSound) {
      void startFocusSound(settings.focusSound, settings.focusSoundVolume);
      return;
    }

    stopFocusSound();
  }, [activeMode, allPauseActive, graceContext, graceOpen, isIdle, settings.focusSound, settings.focusSoundVolume, timerStarted]);

  useEffect(() => {
    if (settings.focusSound === 'off') return;

    const unlockFocusAudio = () => {
      void resumeAudioContext();
      const shouldPlayFocusSoundDuringAfterWorkGrace = (
        graceOpen
        && graceContext === 'afterWork'
        && !allPauseActive
        && !isIdle
      );

      const shouldPlayFocusSound = (
        (
          timerStarted
          && !isIdle
          && activeMode === 'work'
          && !allPauseActive
          && !graceOpen
        )
        || shouldPlayFocusSoundDuringAfterWorkGrace
      );

      if (shouldPlayFocusSound) {
        void startFocusSound(settings.focusSound, settings.focusSoundVolume);
      }
    };

    window.addEventListener('pointerdown', unlockFocusAudio, { passive: true });
    window.addEventListener('keydown', unlockFocusAudio);

    return () => {
      window.removeEventListener('pointerdown', unlockFocusAudio);
      window.removeEventListener('keydown', unlockFocusAudio);
    };
  }, [activeMode, allPauseActive, graceContext, graceOpen, isIdle, settings.focusSound, settings.focusSoundVolume, timerStarted]);

  useEffect(() => {
    return () => {
      stopFocusSound();
    };
  }, []);

  const legacyTick = useCallback((now: number) => {
    if (!lastTickRef.current) { lastTickRef.current = now; return; }
    const delta = (now - lastTickRef.current) / 1000;
    lastTickRef.current = now;

    if (allPauseActive) {
      setAllPauseTime(prev => prev + delta);
      return;
    }
    if (graceOpen) {
      setGraceTotal(prev => prev + delta);
      return;
    }

    if (timerStarted && !isIdle) {
      if (activeMode === 'work') {
        setWorkTime(prev => Math.max(0, prev - delta));
      } else {
        setBreakTime(prev => prev - delta);
      }
    }
  }, [activeMode, timerStarted, isIdle, allPauseActive, graceOpen]);

  const autoEndLongFocusTimerBreak = useCallback((autoEndMs: number) => {
    if (settings.timerPreset !== 'focus') return;
    if (activeMode !== 'break' || isIdle || !timerStarted || allPauseActive || graceOpen) return;
    if (!sessionStartTime) return;

    const breakStart = currentActivityStartRef.current;
    if (!breakStart) return;
    const breakStartMs = breakStart.getTime();
    if (typeof breakStartMs !== 'number' || !Number.isFinite(breakStartMs)) return;
    if (focusTimerAutoEndedBreakStartRef.current === breakStartMs) return;
    focusTimerAutoEndedBreakStartRef.current = breakStartMs;

    const effectiveEndDate = new Date(autoEndMs);
    const effectiveEndIso = effectiveEndDate.toISOString();
    let sessionEndEntry: LogEntry | null = null;
    let pendingActivity: EndSessionPendingActivity | null = null;
    const pendingWindow = getEndSessionPendingActivityWindow({
      isIdle,
      timerStarted,
      activityStartMs: breakStartMs,
      effectiveEndMs: autoEndMs,
      allPauseActive,
      allPauseStartTime,
    });

    if (pendingWindow) {
      const parsedSessionStartMs = Date.parse(sessionStartTime);
      const boundedPendingStartMs = Number.isFinite(parsedSessionStartMs)
        ? Math.max(pendingWindow.startMs, parsedSessionStartMs)
        : pendingWindow.startMs;
      const boundedPendingEndMs = pendingWindow.endMs;
      const boundedPendingDurationSeconds = (boundedPendingEndMs - boundedPendingStartMs) / 1000;
      if (Number.isFinite(boundedPendingDurationSeconds) && boundedPendingDurationSeconds > 0.5) {
        const pendingActiveCategoryId = activeTask?.categoryId;
        const pendingActiveCategorySnapshot = buildCategorySnapshot(categories, pendingActiveCategoryId ?? null);
        const pendingActiveStartIso = new Date(boundedPendingStartMs).toISOString();
        const selectedTask = activeTask ? { id: activeTask.id, name: activeTask.name } : null;

        pendingActivity = {
          mode: 'break',
          durationSeconds: boundedPendingDurationSeconds,
          startMs: boundedPendingStartMs,
          endMs: boundedPendingEndMs,
          categoryId: pendingActiveCategoryId ?? null,
          ...pendingActiveCategorySnapshot,
        };
        sessionEndEntry = {
          type: 'break',
          start: pendingActiveStartIso,
          end: effectiveEndIso,
          duration: boundedPendingDurationSeconds,
          reason: 'Focus Timer Auto Session End',
          source: 'timer',
          task: selectedTask,
          color: activeColor,
          categoryId: pendingActiveCategoryId ?? null,
          ...pendingActiveCategorySnapshot,
        };
      }
    }

    const baseLogs = logsRef.current;
    const logsIncludingSessionEnd = sessionEndEntry
      ? [sessionEndEntry, ...baseLogs]
      : baseLogs;
    const checkedTaskIds = getCheckedTaskIdSet(tasks);
    const baselineCheckedTaskIds = (
      sessionTaskBaselineRef.current?.sessionStartTime === sessionStartTime
        ? sessionTaskBaselineRef.current.checkedTaskIds
        : checkedTaskIds
    );
    const completedTaskIds = getSessionTaskCompletionIdsFromLogs(baseLogs, sessionStartTime, effectiveEndIso);
    checkedTaskIds.forEach((taskId) => {
      if (!baselineCheckedTaskIds.has(taskId)) completedTaskIds.add(taskId);
    });
    const completedTasksCount = Array.from(completedTaskIds)
      .filter(taskId => checkedTaskIds.has(taskId))
      .length;
    const sessionSummary = buildEndSessionStats({
      logs: baseLogs,
      sessionStartTime,
      sessionEndTime: effectiveEndIso,
      categories,
      pendingActivity,
      pomodoroCount,
      settings: {
        timerPreset: settings.timerPreset,
        workDuration: settings.workDuration,
      },
      tasksCompleted: completedTasksCount,
    });
    const carryFocusSeconds = Math.max(
      focusTimerDisplayOffsetSeconds,
      focusTimerDisplayOffsetSeconds + getFocusTimerDisplaySeconds({
        logs: logsIncludingSessionEnd,
        sessionStartTime,
        nowMs: autoEndMs,
        timerStarted,
        isIdle,
        activeMode,
        currentActivityStartTime: breakStart.toISOString(),
        workTime,
        workDuration: settings.workDuration,
        allPauseActive,
        graceOpen,
      }),
    );

    if (sessionEndEntry) {
      logsRef.current = logsIncludingSessionEnd;
      setLogs(logsIncludingSessionEnd);
    }

    const record: SessionRecord = {
      id: `focus-auto-${autoEndMs}`,
      startTime: sessionStartTime,
      endTime: effectiveEndIso,
      stats: {
        totalWorkMinutes: sessionSummary.totalWorkMinutes,
        totalBreakMinutes: sessionSummary.totalBreakMinutes,
        pomosCompleted: sessionSummary.pomosCompleted,
        ...(sessionSummary.miniPomosCompleted !== undefined ? { miniPomosCompleted: sessionSummary.miniPomosCompleted } : {}),
        tasksCompleted: sessionSummary.tasksCompleted,
        categoryStats: sessionSummary.categoryStats,
        categoryDetails: sessionSummary.categoryDetails,
      },
    };

    setPastSessions(prev => [record, ...prev]);
    if (user) {
      setUser(prev => {
        if (!prev) return null;
        const nextStats = calculateLifetimeStats(
          [record, ...pastSessions],
          logsIncludingSessionEnd,
          prev.joinedAt,
          categories,
        );
        return { ...prev, lifetimeStats: nextStats };
      });
    }

    setSessionStats(null);
    setShowSummary(false);
    setPomodoroCount(0);
    setWorkTime(settings.workDuration);
    setBreakTime(0);
    setTimerStarted(false);
    setIsIdle(true);
    setLockedTimerMode(null);
    setLockedTimerStartedAtMs(null);
    setAllPauseActive(false);
    setAllPauseTime(0);
    setAllPauseReason('');
    setAllPauseStartTime(null);
    setGraceOpen(false);
    setGraceContext(null);
    setGraceTotal(0);
    setSessionStartTime(null);
    setDelayedStartTargetTime(null);
    delayedStartTargetTimeRef.current = null;
    setFocusTimerDisplayOffsetSeconds(carryFocusSeconds);
    sessionTaskBaselineRef.current = null;
    taskCompletionWatcherRef.current = {
      sessionStartTime: null,
      checkedTaskIds,
    };
    currentActivityStartRef.current = null;
    lastTickRef.current = null;
    shadowTickRef.current = null;
    workerRef.current?.postMessage('stop');

    anchorRuntimePhase('idle', {
      phaseStartWorkTime: settings.workDuration,
      phaseStartBreakTime: 0,
      phaseStartAllPauseTime: 0,
      phaseStartGraceTotal: 0,
      activityStartIso: null,
      activeMode: 'break',
      timerStarted: false,
      isIdle: true,
      lockedTimerMode: null,
      lockedTimerStartedAtMs: null,
      allPauseActive: false,
      allPauseTime: 0,
      allPauseReason: '',
      allPauseStartTime: null,
      graceOpen: false,
      graceContext: null,
      graceTotal: 0,
      pomodoroCount: 0,
      sessionStartTime: null,
      delayedStartTargetTime: null,
      scheduleStartTime,
      focusTimerDisplayOffsetSeconds: carryFocusSeconds,
    });
  }, [
    activeColor,
    activeMode,
    activeTask,
    allPauseActive,
    allPauseStartTime,
    anchorRuntimePhase,
    calculateLifetimeStats,
    categories,
    focusTimerDisplayOffsetSeconds,
    graceOpen,
    isIdle,
    pastSessions,
    pomodoroCount,
    scheduleStartTime,
    sessionStartTime,
    settings.timerPreset,
    settings.workDuration,
    tasks,
    timerStarted,
    user,
    workTime,
  ]);

  const reconcileFromRuntime = useCallback((now: number) => {
    const runtime = runtimeRef.current;
    const derived = deriveRuntimeValues(runtime, now);

    if (runtime.phase === 'running-work') {
      lastBreakBoundaryAlertPhaseRef.current = null;
      if (Math.abs(derived.workTime - workTime) > 0.05) setWorkTime(derived.workTime);
      if (Math.abs(derived.breakTime - breakTime) > 0.05) setBreakTime(derived.breakTime);
      const boundary = detectRuntimeBoundaryCrossing(runtime, now);
      if (boundary?.mode === 'work') {
        handleWorkLoopComplete(boundary.overflowSeconds);
      }
      return;
    }

    if (runtime.phase === 'running-break') {
      if (Math.abs(derived.workTime - workTime) > 0.05) setWorkTime(derived.workTime);
      if (Math.abs(derived.breakTime - breakTime) > 0.05) setBreakTime(derived.breakTime);
      const focusTimerAutoEndMs = getFocusTimerBreakAutoEndMs({
        timerPreset: settings.timerPreset,
        activeMode,
        timerStarted,
        isIdle,
        allPauseActive,
        graceOpen,
        activityStartMs: currentActivityStartRef.current?.getTime() ?? null,
        nowMs: now,
        alreadyAutoEndedActivityStartMs: focusTimerAutoEndedBreakStartRef.current,
      });
      if (focusTimerAutoEndMs !== null) {
        autoEndLongFocusTimerBreak(focusTimerAutoEndMs);
        return;
      }
      const boundary = detectRuntimeBoundaryCrossing(runtime, now);
      const phaseStart = runtime.phaseStartedAtMs ?? null;
      if (boundary?.mode === 'break' && phaseStart !== null && lastBreakBoundaryAlertPhaseRef.current !== phaseStart) {
        lastBreakBoundaryAlertPhaseRef.current = phaseStart;
        handleBreakBoundaryReached(boundary.overflowSeconds);
      }
      return;
    }

    lastBreakBoundaryAlertPhaseRef.current = null;
    if (runtime.phase === 'all-pause') {
      if (Math.abs(derived.allPauseTime - allPauseTime) > 0.05) setAllPauseTime(derived.allPauseTime);
      return;
    }

    if (runtime.phase === 'grace') {
      if (Math.abs(derived.graceTotal - graceTotal) > 0.05) setGraceTotal(derived.graceTotal);
      return;
    }

    if (Math.abs(workTime - derived.workTime) > 0.05) setWorkTime(derived.workTime);
    if (Math.abs(breakTime - derived.breakTime) > 0.05) setBreakTime(derived.breakTime);
  }, [
    workTime,
    breakTime,
    allPauseTime,
    graceTotal,
    activeMode,
    allPauseActive,
    autoEndLongFocusTimerBreak,
    graceOpen,
    handleBreakBoundaryReached,
    handleWorkLoopComplete,
    isIdle,
    settings.timerPreset,
    timerStarted,
  ]);

  const tick = useCallback(() => {
    if (isAwaitingInitialHostTimerSync()) {
      return;
    }
    const now = Date.now();
    if (legacyRuntimeMode) {
      legacyTick(now);
      return;
    }

    if (isDevMode) {
      const runtime = runtimeRef.current;
      if (timerStarted && !isIdle && runtime.phase !== 'running-work' && runtime.phase !== 'running-break') {
        console.error('Timer runtime invariant failed: running timer has non-running runtime phase', runtime);
      }
      if (localStorage.getItem('doro_shadow_runtime') === '1') {
        if (!shadowTickRef.current) {
          shadowTickRef.current = now;
        } else {
          const delta = (now - shadowTickRef.current) / 1000;
          shadowTickRef.current = now;
          const derived = deriveRuntimeValues(runtime, now);
          if (runtime.phase === 'running-work') {
            const projected = Math.max(0, workTime - delta);
            const drift = Math.abs(projected - derived.workTime);
            if (drift > 1) {
              console.warn('Runtime shadow drift detected for work timer', { projected, derived: derived.workTime, drift });
            }
          }
          if (runtime.phase === 'running-break') {
            const projected = breakTime - delta;
            const drift = Math.abs(projected - derived.breakTime);
            if (drift > 1) {
              console.warn('Runtime shadow drift detected for break timer', { projected, derived: derived.breakTime, drift });
            }
          }
        }
      }
    }
    reconcileFromRuntime(now);
  }, [isAwaitingInitialHostTimerSync, legacyRuntimeMode, legacyTick, reconcileFromRuntime, timerStarted, isIdle, isDevMode]);

  const applyExternalTimerState = useCallback((payload: Partial<TimerPersistencePayload>, runtime: TimerRuntimeSnapshot) => {
    if (!isRuntimeSnapshot(runtime)) return;
    if (runtime.sourceTabId === tabIdRef.current) return;
    if (runtime.updatedAtMs <= lastRuntimeAppliedRef.current) return;

    isCrossTabApplyingRef.current = true;
    runtimeRef.current = runtime;
    lastRuntimeAppliedRef.current = runtime.updatedAtMs;

    const runtimeMode = runtime.phase === 'running-break' ? 'break' : 'work';
    const runtimeRunning = runtime.phase === 'running-work' || runtime.phase === 'running-break';

    if (typeof payload.workTime === 'number') setWorkTime(payload.workTime);
    if (typeof payload.breakTime === 'number') setBreakTime(payload.breakTime);
    if (payload.activeMode === 'work' || payload.activeMode === 'break') setActiveMode(payload.activeMode);
    else setActiveMode(runtimeMode);
    if (typeof payload.timerStarted === 'boolean') setTimerStarted(payload.timerStarted);
    else setTimerStarted(runtimeRunning);
    setIsIdle(runtime.phase === 'idle');
    if (Object.prototype.hasOwnProperty.call(payload, 'lockedTimerMode')) {
      const payloadSettings = normalizeSettings(payload.settings);
      const payloadTimerLock = payloadSettings.timerPreset === 'focus'
        ? { mode: null, startedAtMs: null }
        : normalizeLockedTimerState(payload.lockedTimerMode, payload.lockedTimerStartedAtMs);
      setLockedTimerMode(payloadTimerLock.mode);
      setLockedTimerStartedAtMs(payloadTimerLock.startedAtMs);
    }
    if (typeof payload.pomodoroCount === 'number') setPomodoroCount(payload.pomodoroCount);
    if (typeof payload.allPauseActive === 'boolean') setAllPauseActive(payload.allPauseActive);
    else setAllPauseActive(runtime.phase === 'all-pause');
    if (typeof payload.allPauseTime === 'number') setAllPauseTime(payload.allPauseTime);
    if (typeof payload.allPauseReason === 'string') setAllPauseReason(payload.allPauseReason);
    if (payload.allPauseStartTime === null || typeof payload.allPauseStartTime === 'number') setAllPauseStartTime(payload.allPauseStartTime ?? null);
    const payloadMode = payload.activeMode === 'work' || payload.activeMode === 'break' ? payload.activeMode : runtimeMode;
    const payloadGrace = normalizeGraceWindow({
      graceOpenCandidate: typeof payload.graceOpen === 'boolean' ? payload.graceOpen : runtime.phase === 'grace',
      rawGraceContext: payload.graceContext,
      fallbackMode: payloadMode,
    });
    setGraceOpen(payloadGrace.graceOpen);
    setGraceContext(payloadGrace.graceContext);
    setGraceTotal(
      payloadGrace.graceOpen
        ? (typeof payload.graceTotal === 'number' ? payload.graceTotal : runtime.phaseStartGraceTotal)
        : 0,
    );
    if (typeof payload.sessionStartTime === 'string' || payload.sessionStartTime === null) setSessionStartTime(payload.sessionStartTime ?? null);
    if (typeof payload.delayedStartTargetTime === 'string' || payload.delayedStartTargetTime === null) setDelayedStartTargetTime(payload.delayedStartTargetTime ?? null);
    if (typeof payload.scheduleStartTime === 'string') setScheduleStartTime(payload.scheduleStartTime);
    if (Object.prototype.hasOwnProperty.call(payload, 'focusTimerDisplayOffsetSeconds')) {
      setFocusTimerDisplayOffsetSeconds(normalizeFocusTimerDisplayOffsetSeconds(payload.focusTimerDisplayOffsetSeconds));
    }

    currentActivityStartRef.current = runtime.activityStartIso ? new Date(runtime.activityStartIso) : null;
    reconcileFromRuntime(Date.now());
    setTimeout(() => { isCrossTabApplyingRef.current = false; }, 0);
  }, [reconcileFromRuntime]);

  useEffect(() => {
    if (!workerRef.current) return;
    workerRef.current.onmessage = (e) => { if (e.data === 'tick') tick(); };
  }, [tick]);

  useEffect(() => {
    if (timerStarted || allPauseActive || graceOpen) {
      if (!lastTickRef.current) lastTickRef.current = Date.now();
      if (!shadowTickRef.current) shadowTickRef.current = Date.now();
      workerRef.current?.postMessage('start');
    } else {
      workerRef.current?.postMessage('stop');
      lastTickRef.current = null;
      shadowTickRef.current = null;
    }
  }, [timerStarted, allPauseActive, graceOpen]);

  useEffect(() => {
    if (!pendingPostLoadReconcileRef.current) return;
    pendingPostLoadReconcileRef.current = false;
    reconcileFromRuntime(Date.now());
    if (pendingRuntimeMigrationRef.current) {
      pendingRuntimeMigrationRef.current = false;
      persistRuntimeSnapshot(runtimeRef.current);
    }
  }, [reconcileFromRuntime, persistRuntimeSnapshot]);

  useEffect(() => {
    const onVisibleOrFocus = () => {
      if (document.visibilityState === 'visible') {
        reconcileFromRuntime(Date.now());
      }
    };
    document.addEventListener('visibilitychange', onVisibleOrFocus);
    window.addEventListener('focus', onVisibleOrFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibleOrFocus);
      window.removeEventListener('focus', onVisibleOrFocus);
    };
  }, [reconcileFromRuntime]);

  useEffect(() => {
    const onStorageFlagChange = (e: StorageEvent) => {
      if (e.key === LEGACY_RUNTIME_FLAG) {
        setLegacyRuntimeMode(e.newValue === '1');
      }
    };
    window.addEventListener('storage', onStorageFlagChange);
    return () => window.removeEventListener('storage', onStorageFlagChange);
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CROSS_TAB_CHANNEL);
    broadcastChannelRef.current = channel;
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== 'RUNTIME_SYNC') return;
      if (data.key !== getActiveStorageKey()) return;
      if (!isRuntimeSnapshot(data.runtime)) return;
      applyExternalTimerState((data.timer || {}) as Partial<TimerPersistencePayload>, data.runtime);
    };
    return () => {
      channel.close();
      broadcastChannelRef.current = null;
    };
  }, [applyExternalTimerState, getActiveStorageKey]);

  useEffect(() => {
    const key = getActiveStorageKey();
    const onStorageSync = (event: StorageEvent) => {
      if (event.key !== key || !event.newValue) return;
      try {
        const parsed: TimerPersistencePayload = JSON.parse(event.newValue);
        if (!isRuntimeSnapshot(parsed.runtime)) return;
        applyExternalTimerState(parsed, parsed.runtime);
        const payloadUpdatedAtMs = getPayloadUpdatedAtMs(parsed);
        if (!hasPendingLocalAccountChangesRef.current && payloadUpdatedAtMs > lastExternalPayloadAppliedAtRef.current) {
          lastExternalPayloadAppliedAtRef.current = payloadUpdatedAtMs;
          isCrossTabApplyingRef.current = true;
          if (Array.isArray(parsed.tasks)) {
            lastTaskIdSeed = Math.max(lastTaskIdSeed, getMaxTaskId(parsed.tasks));
            setTasks(normalizeTaskState(parsed.tasks));
          }
          if (Array.isArray(parsed.categories)) setCategories(parsed.categories);
          if (Array.isArray(parsed.logs)) setLogs(parsed.logs);
          if (Array.isArray(parsed.pastSessions)) setPastSessions(parsed.pastSessions);
          setTimeout(() => { isCrossTabApplyingRef.current = false; }, 0);
        }
      } catch {
        // Ignore invalid payloads.
      }
    };
    window.addEventListener('storage', onStorageSync);
    return () => window.removeEventListener('storage', onStorageSync);
  }, [getActiveStorageKey, applyExternalTimerState]);

  const ensureSessionStarted = useCallback((startDate: Date = new Date()) => {
    if (!sessionStartTime) {
      const nextSessionStartTime = startDate.toISOString();
      setSessionStartTime(nextSessionStartTime);
      const checkedTaskIds = getCheckedTaskIdSet(tasks);
      sessionTaskBaselineRef.current = {
        sessionStartTime: nextSessionStartTime,
        checkedTaskIds: new Set(checkedTaskIds),
      };
      taskCompletionWatcherRef.current = {
        sessionStartTime: nextSessionStartTime,
        checkedTaskIds,
      };
      const h = startDate.getHours().toString().padStart(2, '0');
      const m = startDate.getMinutes().toString().padStart(2, '0');
      const nextScheduleStartTime = `${h}:${m}`;
      setScheduleStartTime(nextScheduleStartTime);
      return { nextSessionStartTime, nextScheduleStartTime };
    }

    return {
      nextSessionStartTime: sessionStartTime,
      nextScheduleStartTime: scheduleStartTime,
    };
  }, [scheduleStartTime, sessionStartTime, tasks]);

  const startTimerInternal = (opts?: { mode?: TimerMode, workOverride?: number, breakOverride?: number, forceActivityStart?: Date, playSound?: boolean, forceStart?: boolean }) => {
    if (timerStarted && !opts?.forceStart) return;
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    void resumeAudioContext();
    const wasDelayedStart = Boolean(delayedStartTargetTimeRef.current);
    if (wasDelayedStart) {
      setDelayedStartTargetTime(null);
      delayedStartTargetTimeRef.current = null;
      setSessionStartTime(null);
    }
    const sessionAnchorDate = opts?.forceActivityStart || (!isIdle ? currentActivityStartRef.current : null) || new Date();
    const { nextSessionStartTime, nextScheduleStartTime } = wasDelayedStart
      ? {
          nextSessionStartTime: sessionAnchorDate.toISOString(),
          nextScheduleStartTime: getScheduleStartLabel(sessionAnchorDate),
        }
      : ensureSessionStarted(sessionAnchorDate);
    if (wasDelayedStart) {
      setSessionStartTime(nextSessionStartTime);
      setScheduleStartTime(nextScheduleStartTime);
    }
    if (isIdle) setIsIdle(false);
    const activityStart = opts?.forceActivityStart || currentActivityStartRef.current || sessionAnchorDate;
    currentActivityStartRef.current = activityStart;
    setTimerStarted(true);
    lastTickRef.current = Date.now();
    const nextMode = opts?.mode || activeMode;
    anchorRuntimePhase(nextMode === 'work' ? 'running-work' : 'running-break', {
      phaseStartWorkTime: opts?.workOverride ?? workTime,
      phaseStartBreakTime: opts?.breakOverride ?? breakTime,
      activityStartIso: activityStart.toISOString(),
      activeMode: nextMode,
      timerStarted: true,
      isIdle: false,
      graceOpen: false,
      graceContext: null,
      graceTotal: 0,
      sessionStartTime: nextSessionStartTime,
      delayedStartTargetTime: null,
      scheduleStartTime: nextScheduleStartTime,
    });
    if (opts?.playSound !== false) playSwitch();
  };

  const startDelayedStart = (minutes: number) => {
    if (blockGuestTimerControl()) return;
    if (timerStarted || allPauseActive || graceOpen) return;
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    void resumeAudioContext();

    const now = new Date();
    const target = getDelayedStartTargetDate(minutes, now);
    const targetIso = target.toISOString();
    const delaySeconds = Math.max(1, (target.getTime() - now.getTime()) / 1000);
    const nextScheduleStartTime = getScheduleStartLabel(target);

    setDelayedStartTargetTime(targetIso);
    delayedStartTargetTimeRef.current = targetIso;
    setSessionStartTime(targetIso);
    setScheduleStartTime(nextScheduleStartTime);
    setWorkTime(settings.workDuration);
    setBreakTime(delaySeconds);
    setActiveMode('break');
    setTimerStarted(true);
    setIsIdle(false);
    setLockedTimerMode(null);
    setLockedTimerStartedAtMs(null);
    setGraceOpen(false);
    setGraceContext(null);
    setGraceTotal(0);
    setAllPauseActive(false);
    setAllPauseTime(0);
    setAllPauseReason('');
    setAllPauseStartTime(null);
    currentActivityStartRef.current = now;
    lastTickRef.current = now.getTime();
    anchorRuntimePhase('running-break', {
      phaseStartWorkTime: settings.workDuration,
      phaseStartBreakTime: delaySeconds,
      phaseStartAllPauseTime: 0,
      phaseStartGraceTotal: 0,
      activityStartIso: now.toISOString(),
      activeMode: 'break',
      timerStarted: true,
      isIdle: false,
      lockedTimerMode: null,
      lockedTimerStartedAtMs: null,
      allPauseActive: false,
      allPauseTime: 0,
      allPauseReason: '',
      allPauseStartTime: null,
      graceOpen: false,
      graceContext: null,
      graceTotal: 0,
      sessionStartTime: targetIso,
      delayedStartTargetTime: targetIso,
      scheduleStartTime: nextScheduleStartTime,
    });
    playSwitch();
    emitLocalGroupEvent('timer-started');
  };

  useEffect(() => {
    if (!graceOpen || graceContext !== null) return;
    const normalizedGrace = normalizeGraceWindow({
      graceOpenCandidate: true,
      rawGraceContext: null,
      fallbackMode: activeMode,
    });
    setGraceContext(normalizedGrace.graceContext);
  }, [graceOpen, graceContext, activeMode]);

  const startTimer = () => {
    if (blockGuestTimerControl()) return;
    if (timerStarted) return;
    startTimerInternal();
    emitLocalGroupEvent('timer-started');
  };

  const stopTimer = (opts?: { silentGroupEvent?: boolean }) => {
    if (blockGuestTimerControl()) return;
    const wasDelayedStart = Boolean(delayedStartTargetTimeRef.current);
    if (wasDelayedStart) {
      setDelayedStartTargetTime(null);
      delayedStartTargetTimeRef.current = null;
      setSessionStartTime(null);
      setBreakTime(0);
      setWorkTime(settings.workDuration);
      setActiveMode('work');
    }
    setTimerStarted(false);
    anchorRuntimePhase('idle', {
      ...(wasDelayedStart ? {
        phaseStartWorkTime: settings.workDuration,
        phaseStartBreakTime: 0,
        activeMode: 'work' as TimerMode,
        isIdle: true,
      } : {}),
      delayedStartTargetTime: null,
      ...(wasDelayedStart ? { sessionStartTime: null } : {}),
    });
    if (!opts?.silentGroupEvent) emitLocalGroupEvent('timer-stopped');
  };

  const publishTimerLockState = (nextLockedTimerMode: TimerMode | null, nextLockedTimerStartedAtMs: number | null) => {
    const currentRuntime = runtimeRef.current;
    const nowMs = Date.now();
    const derived = deriveRuntimeValues(currentRuntime, nowMs);
    const runtimeMode: TimerMode = currentRuntime.phase === 'running-break'
      ? 'break'
      : currentRuntime.phase === 'running-work'
        ? 'work'
        : activeMode;

    setLockedTimerMode(nextLockedTimerMode);
    setLockedTimerStartedAtMs(nextLockedTimerStartedAtMs);
    anchorRuntimePhase(currentRuntime.phase, {
      phaseStartWorkTime: derived.workTime,
      phaseStartBreakTime: derived.breakTime,
      phaseStartAllPauseTime: derived.allPauseTime,
      phaseStartGraceTotal: currentRuntime.phase === 'grace' ? derived.graceTotal : 0,
      activityStartIso: currentRuntime.activityStartIso,
      activeMode: runtimeMode,
      timerStarted: currentRuntime.phase === 'running-work' || currentRuntime.phase === 'running-break',
      isIdle,
      allPauseActive: currentRuntime.phase === 'all-pause',
      allPauseTime: derived.allPauseTime,
      graceOpen: currentRuntime.phase === 'grace',
      graceContext: currentRuntime.phase === 'grace' ? graceContext : null,
      graceTotal: currentRuntime.phase === 'grace' ? derived.graceTotal : 0,
      lockedTimerMode: nextLockedTimerMode,
      lockedTimerStartedAtMs: nextLockedTimerStartedAtMs,
    });
  };

  const publishTimerLockStateRef = useRef(publishTimerLockState);
  publishTimerLockStateRef.current = publishTimerLockState;

  useEffect(() => {
    if (!timerStarted || isIdle || sessionStartTime) return;

    const sessionAnchorDate = currentActivityStartRef.current || new Date();
    const { nextSessionStartTime, nextScheduleStartTime } = ensureSessionStarted(sessionAnchorDate);
    const currentRuntime = runtimeRef.current;
    const repairedPhase = currentRuntime.phase === 'idle'
      ? (activeMode === 'break' ? 'running-break' : 'running-work')
      : currentRuntime.phase;

    anchorRuntimePhase(repairedPhase, {
      activeMode,
      timerStarted: true,
      isIdle: false,
      activityStartIso: currentRuntime.activityStartIso || sessionAnchorDate.toISOString(),
      sessionStartTime: nextSessionStartTime,
      scheduleStartTime: nextScheduleStartTime,
    });
  }, [activeMode, anchorRuntimePhase, ensureSessionStarted, isIdle, sessionStartTime, timerStarted]);

  const toggleTimerLock = (mode: TimerMode) => {
    if (blockGuestTimerControl()) return;
    const nowMs = Date.now();
    const nextLockedTimerMode = lockedTimerMode === mode ? null : mode;
    const nextLockedTimerStartedAtMs = nextLockedTimerMode ? nowMs : null;
    publishTimerLockState(nextLockedTimerMode, nextLockedTimerStartedAtMs);
  };

  useEffect(() => {
    if (!lockedTimerMode) return;
    const nowMs = Date.now();
    const safeLockedAtMs = lockedTimerStartedAtMs ?? nowMs;
    const delayMs = getTimerLockAutoUnlockDelay(safeLockedAtMs, nowMs);

    if (lockedTimerStartedAtMs === null) {
      publishTimerLockStateRef.current(lockedTimerMode, safeLockedAtMs);
    }

    if (delayMs <= 0) {
      publishTimerLockStateRef.current(null, null);
      return;
    }

    const timeout = window.setTimeout(() => {
      publishTimerLockStateRef.current(null, null);
    }, delayMs);

    return () => window.clearTimeout(timeout);
  }, [lockedTimerMode, lockedTimerStartedAtMs]);

  const toggleTimer = () => timerStarted ? stopTimer() : startTimer();

  const performSwitch = (targetMode: TimerMode) => {
    if (blockGuestTimerControl()) return;
    const switchStartedAt = new Date();
    const delayedStartTargetIso = delayedStartTargetTimeRef.current;
    const isDelayedStartCountdown = Boolean(delayedStartTargetIso && timerStarted && !isIdle && activeMode === 'break');
    const manualEarlySessionStart = isDelayedStartCountdown && targetMode === 'work';
    const manualEarlySessionStartIso = switchStartedAt.toISOString();
    const manualEarlyScheduleStartTime = getScheduleStartLabel(switchStartedAt);
    const { nextSessionStartTime, nextScheduleStartTime } = manualEarlySessionStart
      ? {
          nextSessionStartTime: manualEarlySessionStartIso,
          nextScheduleStartTime: manualEarlyScheduleStartTime,
        }
      : ensureSessionStarted(currentActivityStartRef.current || switchStartedAt);
    const shouldClearTimerLock = lockedTimerMode !== null && lockedTimerMode !== targetMode;
    playSwitch();
    if (!isIdle && currentActivityStartRef.current && !isDelayedStartCountdown) {
        const duration = (Date.now() - currentActivityStartRef.current.getTime()) / 1000;
        logActivity(activeMode, currentActivityStartRef.current, duration, 'Switch');
    }
    if (isDelayedStartCountdown) {
      setDelayedStartTargetTime(null);
      delayedStartTargetTimeRef.current = null;
      setBreakTime(0);
      setSessionStartTime(nextSessionStartTime);
      setScheduleStartTime(nextScheduleStartTime);
    }
    if (shouldClearTimerLock) {
      setLockedTimerMode(null);
      setLockedTimerStartedAtMs(null);
    }
    setActiveMode(targetMode);
    setIsIdle(false);
    setGraceOpen(false);
    setGraceContext(null);
    setGraceTotal(0);
    currentActivityStartRef.current = switchStartedAt;
    setTimerStarted(true);
    lastTickRef.current = switchStartedAt.getTime();
    anchorRuntimePhase(targetMode === 'work' ? 'running-work' : 'running-break', {
      phaseStartBreakTime: manualEarlySessionStart ? 0 : undefined,
      activityStartIso: currentActivityStartRef.current.toISOString(),
      activeMode: targetMode,
      timerStarted: true,
      isIdle: false,
      graceOpen: false,
      graceContext: null,
      graceTotal: 0,
      sessionStartTime: nextSessionStartTime,
      delayedStartTargetTime: null,
      scheduleStartTime: nextScheduleStartTime,
      lockedTimerMode: shouldClearTimerLock ? null : lockedTimerMode,
      lockedTimerStartedAtMs: shouldClearTimerLock ? null : lockedTimerStartedAtMs,
    });
    emitLocalGroupEvent('mode-switched', { mode: targetMode });
  };

  const activateMode = (mode: TimerMode) => {
    if (blockGuestTimerControl()) return;
    if (isIdle) performSwitch(mode);
    else if (activeMode !== mode) performSwitch(mode);
    else if (!timerStarted) { startTimer(); playSwitch(); }
  };

  const switchMode = () => performSwitch(activeMode === 'work' ? 'break' : 'work');

  const restartActiveTimer = (customSeconds?: number) => {
    if (blockGuestTimerControl()) return;
    stopTimer({ silentGroupEvent: true });
    const nextWorkTime = activeMode === 'work' ? (customSeconds !== undefined ? customSeconds : settings.workDuration) : workTime;
    const nextBreakTime = activeMode === 'break' ? (customSeconds !== undefined ? customSeconds : breakTime) : breakTime;
    if (activeMode === 'work') setWorkTime(nextWorkTime);
    else setBreakTime(nextBreakTime);
    setGraceOpen(false);
    setGraceContext(null);
    setGraceTotal(0);
    setIsIdle(false);
    const now = new Date();
    currentActivityStartRef.current = now;
    setTimerStarted(true);
    lastTickRef.current = now.getTime();
    anchorRuntimePhase(activeMode === 'work' ? 'running-work' : 'running-break', {
      phaseStartWorkTime: nextWorkTime,
      phaseStartBreakTime: nextBreakTime,
      activityStartIso: now.toISOString(),
      activeMode,
      timerStarted: true,
      isIdle: false,
      graceOpen: false,
      graceContext: null,
      graceTotal: 0,
    });
    emitLocalGroupEvent('timer-reset', { mode: activeMode });
  };

  const startAllPause = () => {};
  const confirmAllPause = (reason: string) => {
    if (blockGuestTimerControl()) return;
    const pauseStart = Date.now();
    const delayedStartPauseState = getDelayedStartBoundaryState(delayedStartTargetTimeRef.current, pauseStart);
    const isDelayedStartPending = Boolean(delayedStartPauseState && !delayedStartPauseState.hasReachedTarget);
    const isDelayedStartReady = Boolean(delayedStartPauseState?.hasReachedTarget);
    const activeStart = isDelayedStartReady
      ? new Date(delayedStartPauseState!.targetMs)
      : currentActivityStartRef.current;
    const pausedActiveMode: TimerMode = isDelayedStartReady ? 'work' : activeMode;
    const delayedPauseScheduleStartTime = delayedStartPauseState?.hasReachedTarget
      ? getScheduleStartLabel(new Date(delayedStartPauseState.targetMs))
      : getScheduleStartLabel(new Date(pauseStart));
    const delayedPauseWorkTime = delayedStartPauseState?.hasReachedTarget
      ? Math.max(0, settings.workDuration - delayedStartPauseState.focusElapsedSeconds)
      : settings.workDuration;

    if (timerStarted && !isIdle && activeStart && !isDelayedStartPending) {
      const activeDuration = (pauseStart - activeStart.getTime()) / 1000;
      if (Number.isFinite(activeDuration) && activeDuration > 0.5) {
        const selectedTask = activeTask ? { id: activeTask.id, name: activeTask.name } : null;
        const activeCategoryId = activeTask?.categoryId ?? null;
        const activeCategorySnapshot = buildCategorySnapshot(categories, activeCategoryId);
        const pauseEntry: LogEntry = {
          type: pausedActiveMode,
          start: activeStart.toISOString(),
          end: new Date(pauseStart).toISOString(),
          duration: activeDuration,
          reason: 'Timer Paused',
          source: 'timer',
          task: selectedTask,
          color: activeColor,
          categoryId: activeCategoryId,
          ...activeCategorySnapshot,
        };
        prependLogEntry(pauseEntry);
      }
    }

    if (delayedStartPauseState) {
      setDelayedStartTargetTime(null);
      delayedStartTargetTimeRef.current = null;
      setSessionStartTime(isDelayedStartReady ? delayedStartPauseState.targetIso : null);
      setScheduleStartTime(delayedPauseScheduleStartTime);
      setWorkTime(delayedPauseWorkTime);
      setBreakTime(0);
      setActiveMode('work');
      setTimerStarted(false);
      setIsIdle(false);
      setLockedTimerMode(null);
      setLockedTimerStartedAtMs(null);
    } else {
      stopTimer({ silentGroupEvent: true });
    }
    currentActivityStartRef.current = null;
    setAllPauseReason(reason);
    setAllPauseStartTime(pauseStart);
    setAllPauseTime(0);
    setAllPauseActive(true);
    setGraceOpen(false);
    setGraceContext(null);
    setGraceTotal(0);
    anchorRuntimePhase('all-pause', {
      ...(delayedStartPauseState ? {
        phaseStartWorkTime: delayedPauseWorkTime,
        phaseStartBreakTime: 0,
      } : {}),
      phaseStartAllPauseTime: 0,
      activityStartIso: null,
      activeMode: delayedStartPauseState ? 'work' : activeMode,
      timerStarted: false,
      isIdle: false,
      allPauseActive: true,
      allPauseTime: 0,
      allPauseReason: reason,
      allPauseStartTime: pauseStart,
      graceOpen: false,
      graceContext: null,
      graceTotal: 0,
      ...(delayedStartPauseState ? {
        sessionStartTime: isDelayedStartReady ? delayedStartPauseState.targetIso : null,
        delayedStartTargetTime: null,
        scheduleStartTime: delayedPauseScheduleStartTime,
        lockedTimerMode: null,
        lockedTimerStartedAtMs: null,
      } : {}),
    });
    emitLocalGroupEvent('timer-paused', { reason: reason || undefined });
  };

  const endAllPause = () => {
    if (blockGuestTimerControl()) return;
    setAllPauseActive(false);
    if (allPauseStartTime) {
      const start = new Date(allPauseStartTime);
      logActivity('allpause', start, allPauseTime, allPauseReason);
    }
    currentActivityStartRef.current = new Date();
    anchorRuntimePhase('idle', {
      activityStartIso: currentActivityStartRef.current.toISOString(),
    });
  };

  const resumeFromPause = (action: 'work' | 'break', adjustAmount: number, logPauseAs?: 'work' | 'break') => {
    if (blockGuestTimerControl()) return;
    setAllPauseActive(false);
    if (allPauseStartTime) {
       const start = new Date(allPauseStartTime);
       const pauseReason = allPauseReason || 'Paused';
       const pauseLabel = logPauseAs === 'work'
         ? `${pauseReason} (Pause Credit: Working)`
         : logPauseAs === 'break'
           ? `${pauseReason} (Pause Credit: Resting)`
           : pauseReason;
       // Paused time is never productive focus time; always record as pause for stats integrity.
       logActivity('allpause', start, allPauseTime, pauseLabel);
    }
    setActiveMode(action);
    setIsIdle(false);
    const nextWorkTime = action === 'work' ? Math.max(0, workTime - adjustAmount) : workTime;
    const nextBreakTime = action === 'break' ? breakTime - adjustAmount : breakTime;
    if (action === 'work') setWorkTime(nextWorkTime);
    else setBreakTime(nextBreakTime);
    const now = new Date();
    currentActivityStartRef.current = now;
    startTimerInternal({
      mode: action,
      workOverride: nextWorkTime,
      breakOverride: nextBreakTime,
      forceActivityStart: now,
      playSound: true,
    });
    emitLocalGroupEvent('timer-resumed', { mode: action });
  };

  const resolveGrace = (nextMode: 'work' | 'break', options?: { adjustWorkStart?: number, adjustBreakBalance?: number, logGraceAs?: 'work' | 'break' | 'grace' }) => {
    if (blockGuestTimerControl()) return;
    if (isResolvingGraceRef.current) return;
    isResolvingGraceRef.current = true;

    if (graceOpen && options?.logGraceAs) {
        const graceStart = new Date(Date.now() - graceTotal * 1000);
        let taskOverride: Task | undefined = undefined;
        if (options.logGraceAs === 'work' && activeTask) taskOverride = activeTask;
        let reason = 'Grace Period';
        if (options.logGraceAs === 'work') reason = 'Grace Period (Working)';
        else if (options.logGraceAs === 'break') reason = 'Grace Period (Resting)';
        logActivity(options.logGraceAs, graceStart, graceTotal, reason, taskOverride);
    }
    
    setGraceOpen(false);
    setGraceContext(null);
    setGraceTotal(0);
    setActiveMode(nextMode);
    setIsIdle(false);
    let nextBreakTime = breakTime;
    if (graceContext === 'afterWork' || nextMode === 'break' || options?.adjustBreakBalance !== undefined) {
      nextBreakTime = resolveGraceBreakBank({
        breakTime,
        graceContext,
        runtimeSnapshot: runtimeRef.current,
        adjustBreakBalance: options?.adjustBreakBalance,
      }).nextBreakTime;
      setBreakTime(nextBreakTime);
    }
    
    let nextWorkTime = workTime;
    if (nextMode === 'work') {
        const shouldReset = graceContext === 'afterWork' || (workTime <= 1 && settings.workDuration > 0);
        let base = workTime;
        if (shouldReset) base = settings.workDuration;
        if (options?.adjustWorkStart) base = Math.max(0, base - options.adjustWorkStart);
        nextWorkTime = base;
        setWorkTime(nextWorkTime);
    } else {
        if (graceContext === 'afterWork') {
          nextWorkTime = settings.workDuration;
          setWorkTime(settings.workDuration);
        }
    }

    const now = new Date();
    currentActivityStartRef.current = now;
    startTimerInternal({
      mode: nextMode,
      workOverride: nextWorkTime,
      breakOverride: nextBreakTime,
      forceActivityStart: now,
      playSound: true,
      forceStart: true,
    });
    emitLocalGroupEvent('grace-resolved', { mode: nextMode });
    setTimeout(() => { isResolvingGraceRef.current = false; }, 300);
  };

  const endSession = useCallback((options?: { effectiveEndMs?: number; showSummary?: boolean }) => {
    if (blockGuestTimerControl()) return;

    const effectiveEndMs = typeof options?.effectiveEndMs === 'number' && Number.isFinite(options.effectiveEndMs)
      ? options.effectiveEndMs
      : Date.now();
    const effectiveEndDate = new Date(effectiveEndMs);
    const effectiveEndIso = effectiveEndDate.toISOString();
    const delayedStartTargetIso = delayedStartTargetTimeRef.current;
    const delayedStartEndState = getDelayedStartBoundaryState(delayedStartTargetIso, effectiveEndMs);
    const isCancellingDelayedStart = Boolean(
      delayedStartEndState
      && activeMode === 'break'
      && timerStarted
      && !delayedStartEndState.hasReachedTarget,
    );
    const isEndingReachedDelayedStart = Boolean(
      delayedStartEndState
      && activeMode === 'break'
      && timerStarted
      && delayedStartEndState.hasReachedTarget,
    );
    const effectiveSessionStartTime = isEndingReachedDelayedStart
      ? delayedStartEndState!.targetIso
      : sessionStartTime;
    const effectiveActiveMode: TimerMode = isEndingReachedDelayedStart ? 'work' : activeMode;
    const effectiveActivityStartMs = isEndingReachedDelayedStart
      ? delayedStartEndState!.targetMs
      : currentActivityStartRef.current?.getTime() ?? null;

    if (isCancellingDelayedStart) {
      setPomodoroCount(0);
      setWorkTime(settings.workDuration);
      setBreakTime(0);
      setActiveMode('work');
      setIsIdle(true);
      setTimerStarted(false);
      setLockedTimerMode(null);
      setLockedTimerStartedAtMs(null);
      setAllPauseActive(false);
      setAllPauseTime(0);
      setAllPauseReason('');
      setAllPauseStartTime(null);
      setGraceOpen(false);
      setGraceContext(null);
      setGraceTotal(0);
      setSessionStartTime(null);
      setDelayedStartTargetTime(null);
      delayedStartTargetTimeRef.current = null;
      setSessionStats(null);
      setShowSummary(false);
      currentActivityStartRef.current = null;
      lastTickRef.current = null;
      shadowTickRef.current = null;
      workerRef.current?.postMessage('stop');

      const resetNow = new Date();
      const nextScheduleStartTime = getScheduleStartLabel(resetNow);
      setScheduleStartTime(nextScheduleStartTime);
      anchorRuntimePhase('idle', {
        phaseStartWorkTime: settings.workDuration,
        phaseStartBreakTime: 0,
        phaseStartAllPauseTime: 0,
        phaseStartGraceTotal: 0,
        activityStartIso: null,
        activeMode: 'work',
        timerStarted: false,
        isIdle: true,
        lockedTimerMode: null,
        lockedTimerStartedAtMs: null,
        allPauseActive: false,
        allPauseTime: 0,
        allPauseReason: '',
        allPauseStartTime: null,
        graceOpen: false,
        graceContext: null,
        graceTotal: 0,
        pomodoroCount: 0,
        sessionStartTime: null,
        delayedStartTargetTime: null,
        scheduleStartTime: nextScheduleStartTime,
        focusTimerDisplayOffsetSeconds: 0,
      });
      return;
    }

    let sessionEndEntry: LogEntry | null = null;
    let pendingActivity: EndSessionPendingActivity | null = null;
    const pendingWindow = getEndSessionPendingActivityWindow({
      isIdle,
      timerStarted,
      activityStartMs: effectiveActivityStartMs,
      effectiveEndMs,
      allPauseActive,
      allPauseStartTime,
    });

    if (pendingWindow) {
      const parsedSessionStartMs = typeof effectiveSessionStartTime === 'string' ? Date.parse(effectiveSessionStartTime) : NaN;
      const boundedPendingStartMs = Number.isFinite(parsedSessionStartMs)
        ? Math.max(pendingWindow.startMs, parsedSessionStartMs)
        : pendingWindow.startMs;
      const boundedPendingEndMs = pendingWindow.endMs;
      const boundedPendingDurationSeconds = (boundedPendingEndMs - boundedPendingStartMs) / 1000;
      if (!Number.isFinite(boundedPendingDurationSeconds) || boundedPendingDurationSeconds <= 0.5) {
        pendingActivity = null;
        sessionEndEntry = null;
      } else {
        const pendingActiveCategoryId = activeTask?.categoryId;
        const pendingActiveCategorySnapshot = buildCategorySnapshot(categories, pendingActiveCategoryId ?? null);
        const pendingActiveStartIso = new Date(boundedPendingStartMs).toISOString();
        const pendingActiveEndIso = new Date(boundedPendingEndMs).toISOString();
        const selectedTask = activeTask ? { id: activeTask.id, name: activeTask.name } : null;

        pendingActivity = {
          mode: effectiveActiveMode,
          durationSeconds: boundedPendingDurationSeconds,
          startMs: boundedPendingStartMs,
          endMs: boundedPendingEndMs,
          categoryId: pendingActiveCategoryId ?? null,
          ...pendingActiveCategorySnapshot,
        };
        const nextSessionEndEntry: LogEntry = {
          type: effectiveActiveMode,
          start: pendingActiveStartIso,
          end: pendingActiveEndIso,
          duration: boundedPendingDurationSeconds,
          reason: 'Session End',
          source: 'timer',
          task: selectedTask,
          color: activeColor,
          categoryId: pendingActiveCategoryId ?? null,
          ...pendingActiveCategorySnapshot,
        };
        sessionEndEntry = nextSessionEndEntry;
      }
    }

    const baseLogs = logsRef.current;
    const checkedTaskIds = getCheckedTaskIdSet(tasks);
    const baselineCheckedTaskIds = (
      sessionTaskBaselineRef.current?.sessionStartTime === effectiveSessionStartTime
        ? sessionTaskBaselineRef.current.checkedTaskIds
        : checkedTaskIds
    );
    const completedTaskIds = getSessionTaskCompletionIdsFromLogs(baseLogs, effectiveSessionStartTime, effectiveEndIso);
    if (effectiveSessionStartTime) {
      checkedTaskIds.forEach((taskId) => {
        if (!baselineCheckedTaskIds.has(taskId)) completedTaskIds.add(taskId);
      });
    }
    const completedTasksCount = Array.from(completedTaskIds)
      .filter(taskId => checkedTaskIds.has(taskId))
      .length;
    const sessionSummary = buildEndSessionStats({
      logs: baseLogs,
      sessionStartTime: effectiveSessionStartTime,
      sessionEndTime: effectiveEndIso,
      categories,
      pendingActivity,
      pomodoroCount,
      settings: {
        timerPreset: settings.timerPreset,
        workDuration: settings.workDuration,
      },
      tasksCompleted: completedTasksCount,
    });
    const logsIncludingSessionEnd = sessionEndEntry
      ? [sessionEndEntry, ...baseLogs]
      : baseLogs;
    if (sessionEndEntry) {
      logsRef.current = logsIncludingSessionEnd;
      setLogs(logsIncludingSessionEnd);
    }

    // Archive Session
    if (effectiveSessionStartTime) {
        const record: SessionRecord = {
            id: Date.now().toString(),
            startTime: effectiveSessionStartTime,
            endTime: effectiveEndIso,
            stats: {
                totalWorkMinutes: sessionSummary.totalWorkMinutes,
                totalBreakMinutes: sessionSummary.totalBreakMinutes,
                pomosCompleted: sessionSummary.pomosCompleted,
                ...(sessionSummary.miniPomosCompleted !== undefined ? { miniPomosCompleted: sessionSummary.miniPomosCompleted } : {}),
                tasksCompleted: sessionSummary.tasksCompleted,
                categoryStats: sessionSummary.categoryStats,
                categoryDetails: sessionSummary.categoryDetails,
            }
        };

        setPastSessions(prev => [record, ...prev]);

        // Recalculate lifetime stats from canonical history each time.
        if (user) {
            setUser(prev => {
                if (!prev) return null;
                const nextStats = calculateLifetimeStats(
                  [record, ...pastSessions],
                  logsIncludingSessionEnd,
                  prev.joinedAt,
                  categories,
                );
                return { ...prev, lifetimeStats: nextStats };
            });
        }
    }

    setSessionStats({
        sessionStartTime: effectiveSessionStartTime,
        sessionEndTime: effectiveEndIso,
        totalWorkMinutes: sessionSummary.totalWorkMinutes,
        totalBreakMinutes: sessionSummary.totalBreakMinutes,
        tasksCompleted: sessionSummary.tasksCompleted,
        pomosCompleted: sessionSummary.pomosCompleted,
        ...(sessionSummary.miniPomosCompleted !== undefined ? { miniPomosCompleted: sessionSummary.miniPomosCompleted } : {}),
        categoryStats: sessionSummary.categoryStats
    });

    setTasks(prev => normalizeTaskState(removeCompletedTasks(prev), { selectFirstAvailableIfNoSelection: true }));
    setPomodoroCount(0);
    setWorkTime(settings.workDuration);
    setBreakTime(0);
    setActiveMode('work');
    setIsIdle(true);
    setTimerStarted(false);
    setLockedTimerMode(null);
    setLockedTimerStartedAtMs(null);
    setAllPauseActive(false);
    setAllPauseTime(0);
    setAllPauseReason('');
    setAllPauseStartTime(null);
    setGraceOpen(false);
    setGraceContext(null);
    setGraceTotal(0);
    setSessionStartTime(null);
    setDelayedStartTargetTime(null);
    delayedStartTargetTimeRef.current = null;
    setFocusTimerDisplayOffsetSeconds(0);
    sessionTaskBaselineRef.current = null;
    taskCompletionWatcherRef.current = {
      sessionStartTime: null,
      checkedTaskIds: getCheckedTaskIdSet(removeCompletedTasks(tasks)),
    };
    currentActivityStartRef.current = null;
    lastTickRef.current = null;
    shadowTickRef.current = null;
    workerRef.current?.postMessage('stop');

    const resetNow = new Date();
    const h = resetNow.getHours().toString().padStart(2, '0');
    const m = resetNow.getMinutes().toString().padStart(2, '0');
    const nextScheduleStartTime = `${h}:${m}`;
    setScheduleStartTime(nextScheduleStartTime);
    anchorRuntimePhase('idle', {
      phaseStartWorkTime: settings.workDuration,
      phaseStartBreakTime: 0,
      phaseStartAllPauseTime: 0,
      phaseStartGraceTotal: 0,
      activityStartIso: null,
      activeMode: 'work',
      timerStarted: false,
      isIdle: true,
      lockedTimerMode: null,
      lockedTimerStartedAtMs: null,
      allPauseActive: false,
      allPauseTime: 0,
      allPauseReason: '',
      allPauseStartTime: null,
      graceOpen: false,
      graceContext: null,
      graceTotal: 0,
      pomodoroCount: 0,
      sessionStartTime: null,
      delayedStartTargetTime: null,
      scheduleStartTime: nextScheduleStartTime,
      focusTimerDisplayOffsetSeconds: 0,
    });

    setShowSummary(options?.showSummary !== false);
  }, [
    activeColor,
    activeMode,
    activeTask,
    allPauseActive,
    allPauseStartTime,
    anchorRuntimePhase,
    blockGuestTimerControl,
    calculateLifetimeStats,
    categories,
    isIdle,
    logs,
    pastSessions,
    pomodoroCount,
    sessionStartTime,
    settings.timerPreset,
    settings.workDuration,
    tasks,
    timerStarted,
    user,
  ]);

  const closeSummary = () => { setShowSummary(false); setSessionStats(null); };

  const hardReset = () => {
      localStorage.removeItem(getUserKey(user?.username || ''));
      localStorage.removeItem(getGuestKey());
      setSettings(DEFAULT_SETTINGS);
      setTasks([]);
      setPastSessions([]);
      setCategories([]);
      logsRef.current = [];
      setLogs([]);
      setPomodoroCount(0);
      setWorkTime(DEFAULT_SETTINGS.workDuration);
      setBreakTime(0);
      setActiveMode('work');
      setTimerStarted(false);
      setIsIdle(true);
      setLockedTimerMode(null);
      setLockedTimerStartedAtMs(null);
      setAllPauseActive(false);
      setAllPauseTime(0);
      setAllPauseReason('');
      setAllPauseStartTime(null);
      setGraceOpen(false);
      setGraceContext(null);
      setGraceTotal(0);
      setSessionStartTime(null);
      setDelayedStartTargetTime(null);
      delayedStartTargetTimeRef.current = null;
      setFocusTimerDisplayOffsetSeconds(0);
      setScheduleBreaks([]);
      setSessionStats(null);
      setShowSummary(false);
      leaveGroupSession();
      sessionTaskBaselineRef.current = null;
      taskCompletionWatcherRef.current = {
        sessionStartTime: null,
        checkedTaskIds: new Set(),
      };
      const now = new Date();
      const h = now.getHours().toString().padStart(2, '0');
      const m = now.getMinutes().toString().padStart(2, '0');
      const nextScheduleStartTime = `${h}:${m}`;
      setScheduleStartTime(nextScheduleStartTime);
      currentActivityStartRef.current = null;
      lastTickRef.current = null;
      shadowTickRef.current = null;
      workerRef.current?.postMessage('stop');
      anchorRuntimePhase('idle', {
        phaseStartWorkTime: DEFAULT_SETTINGS.workDuration,
        phaseStartBreakTime: 0,
        phaseStartAllPauseTime: 0,
        phaseStartGraceTotal: 0,
        activityStartIso: null,
        activeMode: 'work',
        timerStarted: false,
        isIdle: true,
        lockedTimerMode: null,
        lockedTimerStartedAtMs: null,
        allPauseActive: false,
        allPauseTime: 0,
        allPauseReason: '',
        allPauseStartTime: null,
        graceOpen: false,
        graceContext: null,
        graceTotal: 0,
        pomodoroCount: 0,
        sessionStartTime: null,
        delayedStartTargetTime: null,
        scheduleStartTime: nextScheduleStartTime,
        focusTimerDisplayOffsetSeconds: 0,
      });
  };

  const getDefaultedTaskName = (name: string, catId: number | null | undefined) => {
    const trimmedName = name.trim();
    if (trimmedName) return trimmedName;

    const categoryName = typeof catId === 'number'
      ? categories.find((category) => category.id === catId)?.name.trim()
      : '';
    return categoryName || 'Task';
  };

  const markAccountSyncDirty = () => {
    if (skipSaveRef.current || isApplyingCloudSnapshotRef.current) return;
    accountSyncVersionRef.current += 1;
    hasPendingLocalAccountChangesRef.current = true;
  };

  const addTask = (name: string, estimated: number, catId: number | null, parentId?: number, color?: string, isFuture?: boolean, scheduledStart?: string, scheduledDate?: string) => {
    markAccountSyncDirty();
    const todayKey = getDateKey(new Date());
    const deferred = Boolean(isFuture) || (typeof scheduledDate === 'string' && scheduledDate > todayKey);
    const createNewTask = (): Task => ({
      id: createTaskId(), name: getDefaultedTaskName(name, catId), estimated, completed: 0, checked: false,
      selected: false, categoryId: catId, subtasks: [], isExpanded: true, color: color || undefined, isFuture, scheduledStart, scheduledDate
    });
    if (parentId) {
      setTasks(prev => {
        lastTaskIdSeed = Math.max(lastTaskIdSeed, getMaxTaskId(prev));
        return normalizeTaskState(addTaskToTree(prev, parentId, createNewTask()));
      });
    } else {
      setTasks(prev => {
        lastTaskIdSeed = Math.max(lastTaskIdSeed, getMaxTaskId(prev));
        const newTask = createNewTask();
        const shouldSelectNewTask = !deferred && !hasSelectedSelectableTask(prev);
        const nextTasks = [...prev, newTask];
        return normalizeTaskState(nextTasks, {
          preferredSelectedId: shouldSelectNewTask ? newTask.id : undefined,
          selectFirstAvailableIfNoSelection: !deferred,
        });
      });
    }
  };

  const addDetailedTask = (taskProps: Partial<Task> & { name: string, estimated: number }) => {
      markAccountSyncDirty();
      const todayKey = getDateKey(new Date());
      const deferred = Boolean(taskProps.isFuture) || (typeof taskProps.scheduledDate === 'string' && taskProps.scheduledDate > todayKey);
      const categoryId = taskProps.categoryId || null;
      const newTask: Task = {
        id: createTaskId(), name: getDefaultedTaskName(taskProps.name, categoryId), estimated: taskProps.estimated, completed: 0, checked: false,
        selected: false, categoryId, subtasks: taskProps.subtasks || [], isExpanded: true, color: taskProps.color,
        isFuture: taskProps.isFuture, scheduledStart: taskProps.scheduledStart, scheduledDate: taskProps.scheduledDate
      };
      setTasks(prev => {
        const shouldSelectNewTask = !deferred && !hasSelectedSelectableTask(prev);
        return normalizeTaskState([...prev, newTask], {
          preferredSelectedId: shouldSelectNewTask ? newTask.id : undefined,
          selectFirstAvailableIfNoSelection: !deferred,
        });
      });
      return newTask.id;
  };

  const addSubtasksToTask = (parentId: number, subtasks: { name: string, est: number }[]) => {
    markAccountSyncDirty();
    setTasks(prev => {
        let newTasks = [...prev];
        subtasks.forEach(sub => {
             const t: Task = { id: createTaskId(), name: sub.name, estimated: sub.est, completed: 0, checked: false, selected: false, categoryId: null, subtasks: [], isExpanded: false };
             newTasks = addTaskToTree(newTasks, parentId, t);
        });
        return normalizeTaskState(newTasks);
    });
  };

  const updateTask = (task: Task) => {
    markAccountSyncDirty();
    const nextTask = task.selected && isDeferredTaskFromToday(task) ? { ...task, selected: false } : task;
    setTasks(prev => normalizeTaskState(updateTaskInTree(prev, nextTask)));
  };
  const deleteTask = (id: number) => {
    markAccountSyncDirty();
    setTasks(prev => normalizeTaskState(deleteTaskInTree(prev, id), { selectFirstAvailableIfNoSelection: true }));
  };
  const selectTask = (id: number) => {
    const currentTarget = findTask(tasks, id);
    if (!currentTarget || currentTarget.selected || !isSelectableTask(currentTarget)) return;
    markAccountSyncDirty();
    setTasks(prev => {
      const target = findTask(prev, id);
      if (!target || target.selected || !isSelectableTask(target)) return prev;
      return normalizeTaskState(prev, { preferredSelectedId: id });
    });
  };
  
  const toggleTaskExpansion = (id: number) => {
    const task = findTask(tasks, id);
    if (task) {
      markAccountSyncDirty();
      setTasks(prev => normalizeTaskState(updateTaskInTree(prev, { ...task, isExpanded: !task.isExpanded })));
    }
  };

  const moveTask = (fromId: number, toId: number) => {
    markAccountSyncDirty();
    setTasks(prev => {
        const newTasks = [...prev];
        const fromIndex = newTasks.findIndex(t => t.id === fromId);
        if (fromIndex === -1) return prev;
        const [moved] = newTasks.splice(fromIndex, 1);
        const toIndex = newTasks.findIndex(t => t.id === toId);
        if (toIndex === -1) {
            newTasks.push(moved);
        } else {
             newTasks.splice(toIndex, 0, moved);
        }
        return normalizeTaskState(newTasks);
    });
  };

  const moveSubtask = (fromParentId: number, toParentId: number, subId: number, targetSubId: number | null) => {
    markAccountSyncDirty();
    setTasks(prev => {
        let movedSub: Task | null = null;
        const tasksWithoutSub = (list: Task[]): Task[] => {
            return list.map(t => {
                if (t.id === fromParentId) {
                    const idx = t.subtasks.findIndex(s => s.id === subId);
                    if (idx !== -1) {
                        movedSub = t.subtasks[idx];
                        const newSubs = [...t.subtasks];
                        newSubs.splice(idx, 1);
                        return recalculateStats({ ...t, subtasks: newSubs });
                    }
                }
                if (t.subtasks.length > 0) return recalculateStats({ ...t, subtasks: tasksWithoutSub(t.subtasks) });
                return t;
            });
        };
        const tempTasks = tasksWithoutSub(prev);
        if (!movedSub) return prev;
        const insertSub = (list: Task[]): Task[] => {
            return list.map(t => {
                if (t.id === toParentId) {
                    const newSubs = [...t.subtasks];
                    if (targetSubId === null) {
                        newSubs.push(movedSub!);
                    } else {
                        const tIdx = newSubs.findIndex(s => s.id === targetSubId);
                        if (tIdx !== -1) newSubs.splice(tIdx, 0, movedSub!);
                        else newSubs.push(movedSub!);
                    }
                    return recalculateStats({ ...t, subtasks: newSubs });
                }
                if (t.subtasks.length > 0) return recalculateStats({ ...t, subtasks: insertSub(t.subtasks) });
                return t;
            });
        };
        return normalizeTaskState(insertSub(tempTasks));
    });
  };

  const splitTask = (taskId: number, splitAt: number) => {
    markAccountSyncDirty();
    setTasks(prev => {
        const index = prev.findIndex(t => t.id === taskId);
        if (index === -1) return prev;
        const task = prev[index];
        if (splitAt <= task.completed || splitAt >= task.estimated) return prev;
        const remainingEst = task.estimated - splitAt;
        const part1 = { ...task, estimated: splitAt };
        const part2 = { ...task, id: createTaskId(), name: `${task.name} (Part 2)`, estimated: remainingEst, completed: 0, selected: false, subtasks: [] };
        const newTasks = [...prev];
        newTasks[index] = part1;
        newTasks.splice(index + 1, 0, part2);
        return normalizeTaskState(newTasks, { preferredSelectedId: part1.selected ? part1.id : undefined });
    });
  };

  const toggleTaskFuture = (taskId: number) => {
    const task = findTask(tasks, taskId);
    if (!task) return;
    updateTask({ ...task, isFuture: !task.isFuture, scheduledStart: undefined });
  };

  const setTaskSchedule = (taskId: number, scheduledStart: string | undefined) => {
      const task = findTask(tasks, taskId);
      if (!task) return;
      updateTask({ ...task, scheduledStart, isFuture: true });
  };

  const addCategory = (name: string, color: string, icon: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    markAccountSyncDirty();
    setCategories(prev => [...prev, { id: createCategoryId(prev), name: trimmedName, color, icon }]);
  };
  const updateCategory = (cat: Category) => {
    const trimmedName = cat.name.trim();
    if (!trimmedName) return;
    markAccountSyncDirty();
    setCategories(prev => prev.map(c => (c.id === cat.id ? { ...c, ...cat, name: trimmedName } : c)));
  };
  const archiveCategory = (id: number) => {
    markAccountSyncDirty();
    setCategories(prev => prev.map(c => (c.id === id ? { ...c, archived: true } : c)));
    if (selectedCategoryId === id) setSelectedCategoryId(null);
  };
  const deleteCategory = (id: number) => {
    markAccountSyncDirty();
    setCategories(prev => prev.filter(c => c.id !== id));
    setTasks(prev => normalizeTaskState(clearCategoryFromTasks(prev, id)));
    if (selectedCategoryId === id) setSelectedCategoryId(null);
  };
  const moveCategory = (fromId: number, toId: number) => {
    markAccountSyncDirty();
    setCategories(prev => {
      const nextCategories = [...prev];
      const fromIndex = nextCategories.findIndex(category => category.id === fromId);
      if (fromIndex === -1) return prev;
      const [movedCategory] = nextCategories.splice(fromIndex, 1);
      const toIndex = nextCategories.findIndex(category => category.id === toId);
      if (toIndex === -1) {
        nextCategories.push(movedCategory);
      } else {
        nextCategories.splice(toIndex, 0, movedCategory);
      }
      return nextCategories;
    });
  };

  const addScheduleBreak = (brk: ScheduleBreak) => setScheduleBreaks(prev => [...prev, brk].sort((a,b) => a.startTime.localeCompare(b.startTime)));
  const deleteScheduleBreak = (id: string) => setScheduleBreaks(prev => prev.filter(b => b.id !== id));

  const updateSettings = (newSettings: TimerSettings) => {
    const safeSettings = normalizeSettings(newSettings);
    const focusPresetBoundary = settings.timerPreset === 'focus' || safeSettings.timerPreset === 'focus';
    if (focusPresetBoundary && lockedTimerMode !== null) {
      publishTimerLockState(null, null);
    }
    setSettings(safeSettings);
    if (!timerStarted && activeMode === 'work') {
      setWorkTime(safeSettings.workDuration);
      if (!allPauseActive && !graceOpen) {
        anchorRuntimePhase('idle', { phaseStartWorkTime: safeSettings.workDuration });
      }
    }
  };

  const clearLogs = () => {
    logsRef.current = [];
    setLogs([]);
    setPomodoroCount(0);
    setFocusTimerDisplayOffsetSeconds(0);
  };
  const resetTimers = () => restartActiveTimer();

  return (
    <TimerContext.Provider value={{
      user, workTime, breakTime, activeMode, timerStarted, isIdle, lockedTimerMode, pomodoroCount,
      allPauseActive, allPauseTime, graceOpen, graceContext, graceTotal,
      tasks, pastSessions, categories, logs, settings, selectedCategoryId, scheduleBreaks, scheduleStartTime, sessionStartTime, delayedStartTargetTime,
      timerActivityStartTime: runtimeRef.current.activityStartIso ?? null,
      focusTimerDisplayOffsetSeconds,
      isScheduleOpen, setScheduleOpen, isWeeklyScheduleOpen, setWeeklyScheduleOpen, showCompletedTasks, setShowCompletedTasks,
      activeTask, activeColor, showSummary, sessionStats,
      groupSessionId, userName, isHost, peerError, members, hostSyncConfig, clientSyncConfig, pendingJoinId, pendingMenuAction, groupNotice, guestTimerLockNotice,
      accountSyncState, accountSyncError, lastAccountSyncAt, isPreviewAccount, focusFriends, focusFriendsLoading, focusFriendsError, focusFriendNotice,
      login, logout, register, syncAccountNow, refreshAccountFromCloud,
      refreshFocusFriends, sendFocusFriendRequest, acceptFocusFriendInvite, acceptFocusFriendRequest, declineFocusFriendRequest, removeFocusFriend, sendFocusFriendEncouragement, requestFocusFriendJoin, sendFocusFriendJoinInvite, approveFocusFriendJoinRequest, declineFocusFriendJoinRequest, markFocusFriendActionRead,
      startTimer, stopTimer, toggleTimer, toggleTimerLock, switchMode, activateMode, startDelayedStart,
      startAllPause, confirmAllPause, endAllPause, resumeFromPause, restartActiveTimer, resolveGrace, endSession, closeSummary, hardReset,
      createGroupSession, joinGroupSession, leaveGroupSession, updateHostSyncConfig, updateClientSyncConfig, setPendingJoinId, requestNewCategoryFlow, clearPendingMenuAction, dismissGuestTimerLockNotice,
      addTask, addDetailedTask, addSubtasksToTask, updateTask, deleteTask, selectTask, toggleTaskExpansion, moveTask, moveSubtask, splitTask,
      toggleTaskFuture, setTaskSchedule,
      addCategory, updateCategory, archiveCategory, deleteCategory, moveCategory, selectCategory: setSelectedCategoryId,
      addScheduleBreak, deleteScheduleBreak, setScheduleStartTime,
      updateSettings, clearLogs, addManualFocusLog, resetTimers, setPomodoroCount
    }}>
      {children}
    </TimerContext.Provider>
  );
};

export const useTimer = () => {
  const context = useContext(TimerContext);
  if (!context) throw new Error("useTimer must be used within TimerProvider");
  return context;
};
