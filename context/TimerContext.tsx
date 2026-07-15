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
} from '../types';
import { playAlarm, playSwitch, resumeAudioContext, startFocusSound, stopFocusSound } from '../utils/sound';
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
  getMatchingTimerPreset,
  getTimerStateFreshnessStamp,
  resolveGraceBreakBank,
  normalizeGraceWindow,
  resetPersistedTimerSessionState,
  shouldApplyIncomingRuntime,
  shouldAutoStartTwoInARowFocus,
  shouldDiscardRestoredGrace,
} from '../utils/timerRuntime';
import {
  fetchAccountData,
  isConflictError,
  isUnauthorizedError,
  loginAccount,
  logoutAccount,
  registerAccount,
  saveAccountData,
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
import { buildCategorySnapshot, resolveLogEntryCategory } from '../utils/categoryTracking';
import { isActiveCategory } from '../utils/categoryVisibility';
import {
  getCompletionReasonForSettings,
  getPomodoroCompletionStatsFromLogs,
  getStandardPomodoroCountForTimer,
} from '../utils/pomodoroAccounting';
import { selectLocalPayloadForAccountSync, shouldApplyAccountSyncSnapshot } from '../utils/accountSync';
import { calculateLifetimeStatsFromData, EMPTY_LIFETIME_STATS } from '../utils/lifetimeStats';
import { mergeOrderedEntitiesById, mergeTaskLists } from '../utils/stateMerge';
import { pickTimerSpectatorSettings } from '../utils/timerShare';

export interface ScheduleBreak {
  id: string;
  startTime: string; // "HH:MM" 24h format
  duration: number; // minutes
  label: string;
}

export interface SessionStats {
  totalWorkMinutes: number;
  totalBreakMinutes: number;
  tasksCompleted: number;
  pomosCompleted: number;
  miniPomosCompleted?: number;
  categoryStats: Record<string, number>;
}

type PendingMenuAction = 'new-category';

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

  // Actions
  login: (username: string, password?: string) => Promise<AuthResult>;
  register: (username: string, password?: string) => Promise<AuthResult>;
  logout: () => void;
  syncAccountNow: () => Promise<boolean>;
  refreshAccountFromCloud: (options?: { force?: boolean }) => Promise<boolean>;
  
  startTimer: () => void;
  stopTimer: () => void;
  toggleTimer: () => void;
  switchMode: () => void; 
  activateMode: (mode: TimerMode) => void;
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

const normalizeSettings = (settings?: Partial<TimerSettings> | null): TimerSettings => {
  const source = settings || {};
  const nextSettings: TimerSettings = {
    ...DEFAULT_SETTINGS,
    ...source,
  };
  nextSettings.alarmSound = normalizeAlarmSound(source.alarmSound);
  nextSettings.twoInARowStartSound = normalizeAlarmSound(source.twoInARowStartSound);
  const hasExplicitPreset = Object.prototype.hasOwnProperty.call(source, 'timerPreset');
  const presetIsValid = (
    nextSettings.timerPreset === 'classic'
    || nextSettings.timerPreset === 'compact'
    || nextSettings.timerPreset === 'custom'
  );

  if (!hasExplicitPreset || !presetIsValid) {
    nextSettings.timerPreset = getMatchingTimerPreset(nextSettings);
  }

  if (nextSettings.timerPreset !== 'compact') {
    nextSettings.twoInARowMode = false;
  }

  return nextSettings;
};

const DATA_SCHEMA_VERSION = 2;
const LEGACY_RUNTIME_FLAG = 'doro_use_legacy_tick';
const CROSS_TAB_CHANNEL = 'doro_timer_sync';
const AUTH_TOKEN_KEY = 'doro_auth_token';
const PREVIEW_ACCOUNT_USERNAME = 'master';
const PREVIEW_ACCOUNT_PASSWORD = 'master';
const PREVIEW_AUTH_TOKEN = 'doro_preview_master_token';

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

const isSpectatorConnection = (connection: Pick<DataConnection, 'metadata'> | null | undefined) => (
  Boolean(connection && (connection.metadata as any)?.spectator === true)
);

const isGroupEventType = (value: unknown): value is GroupEventType => {
  return typeof value === 'string' && GROUP_EVENT_TYPES.includes(value as GroupEventType);
};

const getDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const isPreviewAuthToken = (value: string | null | undefined) => value === PREVIEW_AUTH_TOKEN;

const isPreviewAccountCredentials = (username: string, password?: string) => {
  return username.trim().toLowerCase() === PREVIEW_ACCOUNT_USERNAME && password === PREVIEW_ACCOUNT_PASSWORD;
};

const getScheduleStartLabel = (date: Date) => {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
};

const isDeferredTaskFromToday = (task: Pick<Task, 'isFuture' | 'scheduledDate'>, todayKey: string = getDateKey(new Date())) => {
  if (task.isFuture) return true;
  return typeof task.scheduledDate === 'string' && task.scheduledDate > todayKey;
};

let lastTaskIdSeed = 0;
const createTaskId = () => {
  const candidate = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  if (candidate <= lastTaskIdSeed) {
    lastTaskIdSeed += 1;
  } else {
    lastTaskIdSeed = candidate;
  }
  return lastTaskIdSeed;
};

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

const selectTaskInTree = (tasks: Task[], id: number): Task[] => {
  return tasks.map(t => ({
    ...t,
    selected: t.id === id,
    subtasks: selectTaskInTree(t.subtasks, id)
  }));
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

const findActiveContext = (tasks: Task[], parentColor?: string): { task: Task | null, color?: string } => {
  for (const task of tasks) {
    const currentColor = task.color || parentColor;
    if (task.selected) {
      return { task: task, color: currentColor };
    }
    if (task.subtasks.length > 0) {
      const found = findActiveContext(task.subtasks, currentColor);
      if (found.task) return found;
    }
  }
  return { task: null, color: undefined };
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

const isPauseCreditedWorkLog = (entry: LogEntry): boolean => {
  if (entry.type !== 'work') return false;
  const reason = (entry.reason || '').trim().toLowerCase();
  return reason.startsWith('paused') || reason.includes('pause credit');
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
  | 'pomodoroCount'
  | 'allPauseActive'
  | 'allPauseTime'
  | 'allPauseReason'
  | 'allPauseStartTime'
  | 'graceOpen'
  | 'graceContext'
  | 'graceTotal'
  | 'sessionStartTime'
  | 'scheduleStartTime'
>;

const isRuntimeSnapshot = (value: any): value is TimerRuntimeSnapshot => {
  return !!value && typeof value === 'object' && value.version === TIMER_RUNTIME_VERSION && typeof value.updatedAtMs === 'number' && typeof value.phase === 'string';
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
  
  const [settings, setSettings] = useState<TimerSettings>(DEFAULT_SETTINGS);
  const [workTime, setWorkTime] = useState(1500);
  const [breakTime, setBreakTime] = useState(0); 
  const [activeMode, setActiveMode] = useState<TimerMode>('work');
  const [timerStarted, setTimerStarted] = useState(false);
  const [isIdle, setIsIdle] = useState(true); 
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
  const groupLifecycleRef = useRef(0);
  const clientReadyForBroadcastRef = useRef(true);
  const currentGroupStateRef = useRef<any>(null);

  const lastTickRef = useRef<number | null>(null);
  const shadowTickRef = useRef<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const currentActivityStartRef = useRef<Date | null>(null);
  const lastLoopTimeRef = useRef<number>(0);
  const lastBreakBoundaryAlertPhaseRef = useRef<number | null>(null);
  const previousLegacyBreakTimeRef = useRef<number | null>(null);
  const isProcessingRef = useRef(false);
  const isResolvingGraceRef = useRef(false);
  const skipSaveRef = useRef(false);
  const isCloudSyncInFlightRef = useRef(false);
  const isApplyingCloudSnapshotRef = useRef(false);
  const accountSyncVersionRef = useRef(0);
  const pendingAccountSyncAfterInFlightRef = useRef(false);
  const syncAccountNowRef = useRef<(() => Promise<boolean>) | null>(null);
  const accountRevisionRef = useRef(0);
  const hasHydratedCloudForUserRef = useRef<string | null>(null);
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
  currentGroupStateRef.current = {
    settings,
    tasks,
    categories,
    logs,
    activeMode,
    timerStarted,
    isIdle,
    workTime,
    breakTime,
    pomodoroCount,
    scheduleBreaks,
    scheduleStartTime,
    sessionStartTime,
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
        scheduleStartTime: timerState?.scheduleStartTime ?? scheduleStartTime,
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
    allPauseTime,
    allPauseReason,
    allPauseStartTime,
    graceContext,
    scheduleStartTime,
    sessionStartTime,
  ]);

  const anchorRuntimePhase = useCallback((
    phase: TimerRuntimePhase,
    overrides?: Partial<Pick<TimerRuntimeSnapshot, 'phaseStartWorkTime' | 'phaseStartBreakTime' | 'phaseStartAllPauseTime' | 'phaseStartGraceTotal' | 'activityStartIso'>> & {
      activeMode?: TimerMode;
      timerStarted?: boolean;
      isIdle?: boolean;
      allPauseActive?: boolean;
      allPauseTime?: number;
      allPauseReason?: string;
      allPauseStartTime?: number | null;
      graceOpen?: boolean;
      graceContext?: GraceContext;
      graceTotal?: number;
      pomodoroCount?: number;
      sessionStartTime?: string | null;
      scheduleStartTime?: string;
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
      scheduleStartTime: overrides?.scheduleStartTime ?? scheduleStartTime,
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
  }, [workTime, breakTime, allPauseTime, graceTotal, persistRuntimeSnapshot, getActiveStorageKey, activeMode, isIdle, allPauseReason, allPauseStartTime, graceContext, pomodoroCount, sessionStartTime, scheduleStartTime]);

  // Load Data Helper
  const loadData = useCallback((username?: string) => {
      skipSaveRef.current = true; // Prevent save effect triggering during load
      const key = username ? getUserKey(username) : getGuestKey();
      const saved = localStorage.getItem(key);
      
      if (saved) {
        try {
            const parsed: TimerPersistencePayload = JSON.parse(saved);
            accountRevisionRef.current = getPayloadRevision(parsed);
            const parsedTasks = parsed.tasks || [];
            const parsedSessions = parsed.pastSessions || [];
            const parsedCategories = parsed.categories || [];
            const parsedLogs = parsed.logs || [];
            setSettings(normalizeSettings(parsed.settings));
            setTasks(parsedTasks);
            lastTaskIdSeed = Math.max(lastTaskIdSeed, getMaxTaskId(parsedTasks));
            setPastSessions(parsedSessions);
            setCategories(parsedCategories);
            lastCategoryIdSeed = Math.max(lastCategoryIdSeed, getMaxCategoryId(parsedCategories));
            setLogs(parsedLogs);
            setPomodoroCount(parsed.pomodoroCount || 0);
            setScheduleBreaks(parsed.scheduleBreaks || []);
            const nextBreakTime = parsed.breakTime !== undefined ? parsed.breakTime : 0;
            const nextWorkTime = parsed.workTime !== undefined ? parsed.workTime : DEFAULT_SETTINGS.workDuration;
            const parsedTimerStarted = parsed.timerStarted !== undefined ? Boolean(parsed.timerStarted) : false;
            const nextInitialIdle = parsedTimerStarted
              ? (parsed.isIdle !== undefined ? parsed.isIdle : false)
              : true;
            setBreakTime(nextBreakTime);
            setWorkTime(nextWorkTime);
            setActiveMode(parsed.activeMode || 'work');
            setIsIdle(nextInitialIdle);
            
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
          setBreakTime(0);
          setWorkTime(DEFAULT_SETTINGS.workDuration);
          setActiveMode('work');
          setTimerStarted(false);
          setIsIdle(true);
          setAllPauseActive(false);
          setAllPauseTime(0);
          setAllPauseReason('');
          setAllPauseStartTime(null);
          setGraceOpen(false);
          setGraceContext(null);
          setGraceTotal(0);
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
    isIdle,
    logs,
    pastSessions,
    pomodoroCount,
    scheduleBreaks,
    scheduleStartTime,
    sessionStartTime,
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
    setUser(null);
    setUserName('');
    if (reason) {
      setAccountSyncState('error');
      setAccountSyncError(reason);
    } else {
      setAccountSyncState('idle');
      setAccountSyncError(null);
    }
    loadData();
  }, [loadData]);

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
    return {
      ...remoteData,
      settings: normalizeSettings(remoteData.settings),
      tasks: mergeTaskLists(remoteData.tasks, guestData.tasks, 'local'),
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

    return {
      schemaVersion: DATA_SCHEMA_VERSION,
      revision: Math.max(getPayloadRevision(localData), getPayloadRevision(remoteData)),
      settings: normalizeSettings(dataWinner.settings),
      tasks: mergeTaskLists(remoteData.tasks, localData.tasks, prefer, { membership: 'preferred' }),
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
    const safeTasks = Array.isArray(source.tasks) ? source.tasks : [];
    const safeSessions = Array.isArray(source.pastSessions) ? source.pastSessions : [];
    const safeCategories = Array.isArray(source.categories) ? source.categories : [];
    const safeLogs = Array.isArray(source.logs) ? source.logs : [];
    const safeWorkTime = typeof source.workTime === 'number' ? source.workTime : safeSettings.workDuration;
    const safeBreakTime = typeof source.breakTime === 'number' ? source.breakTime : 0;
    const safeMode: TimerMode = source.activeMode === 'break' ? 'break' : 'work';
    const safeSessionStartTime = typeof source.sessionStartTime === 'string' || source.sessionStartTime === null
      ? source.sessionStartTime
      : null;
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
              }, 0);
          }
      }
  }, [authToken, applyAccountSnapshot, buildPersistencePayload, normalizeAccountPayload, persistAccountPayload, resetAccountSession, user, userName]);

  syncAccountNowRef.current = syncAccountNow;

  const refreshAccountFromCloud = useCallback(async (options?: { force?: boolean }): Promise<boolean> => {
      if (!user || !authToken || isPreviewAuthToken(authToken)) return false;
      if (isCloudSyncInFlightRef.current || isApplyingCloudSnapshotRef.current) return false;

      const force = options?.force ?? true;

      try {
          setAccountSyncState('syncing');
          setAccountSyncError(null);
          const remote = await fetchAccountData(authToken);
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
            setAccountSyncState('synced');
            setLastAccountSyncAt(Date.now());
            hasHydratedCloudForUserRef.current = cloudUser.username;
            return true;
          }

          if (!force && !hasRemoteTimerChange && !hasRemoteDataChange) {
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
          const finalPayload = shouldPersistGuestImport
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
      if (!user || !authToken || isPreviewAuthToken(authToken)) return;
      if (skipSaveRef.current || isApplyingCloudSnapshotRef.current) return;
      accountSyncVersionRef.current += 1;
      setAccountSyncState((prev) => (prev === 'syncing' ? prev : 'pending'));
      // Debounce signed-in saves from timer phase transitions, not per-second countdown ticks.
      const timeout = setTimeout(() => { void syncAccountNow(); }, 2500);
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
      allPauseActive,
      allPauseReason,
      allPauseStartTime,
      graceOpen,
      graceContext,
      scheduleBreaks,
      scheduleStartTime,
      sessionStartTime,
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
    const activeContext = Array.isArray(state?.tasks)
      ? findActiveContext(state.tasks)
      : { task: null, color: undefined };
    const runtime = isRuntimeSnapshot(state?.runtime) ? state.runtime : runtimeRef.current;

    return {
      version: 1,
      hostName: sanitizeGroupMemberName(state?.userName ?? userNameRef.current, 'Host'),
      activeMode: state?.activeMode === 'break' ? 'break' : 'work',
      timerStarted: Boolean(state?.timerStarted),
      isIdle: Boolean(state?.isIdle),
      workTime: typeof state?.workTime === 'number' && Number.isFinite(state.workTime) ? state.workTime : DEFAULT_SETTINGS.workDuration,
      breakTime: typeof state?.breakTime === 'number' && Number.isFinite(state.breakTime) ? state.breakTime : 0,
      pomodoroCount: typeof state?.pomodoroCount === 'number' && Number.isFinite(state.pomodoroCount) ? state.pomodoroCount : 0,
      allPauseActive: Boolean(state?.allPauseActive),
      allPauseTime: typeof state?.allPauseTime === 'number' && Number.isFinite(state.allPauseTime) ? state.allPauseTime : 0,
      graceOpen: Boolean(state?.graceOpen),
      graceContext: state?.graceContext === 'afterWork' || state?.graceContext === 'afterBreak' ? state.graceContext : null,
      activeTaskName: typeof activeContext.task?.name === 'string' && activeContext.task.name.trim()
        ? activeContext.task.name.trim().slice(0, 80)
        : null,
      activeColor: typeof activeContext.color === 'string' && activeContext.color.trim() ? activeContext.color : undefined,
      settings: pickTimerSpectatorSettings(state?.settings),
      runtime,
      updatedAtMs: Date.now(),
    };
  }, []);

  const buildFilteredGroupState = useCallback((state: any, config: GroupSyncConfig) => {
      const filteredState: any = { ...state };
      if (!config.syncTimers) {
          delete filteredState.workTime; delete filteredState.breakTime; delete filteredState.activeMode;
          delete filteredState.timerStarted; delete filteredState.isIdle;
          delete filteredState.pomodoroCount;
          delete filteredState.allPauseActive; delete filteredState.allPauseTime; delete filteredState.allPauseReason;
          delete filteredState.allPauseStartTime; delete filteredState.graceOpen; delete filteredState.graceContext;
          delete filteredState.graceTotal; delete filteredState.runtime;
      }
      if (!config.syncTasks) { delete filteredState.tasks; delete filteredState.categories; }
      if (!config.syncHistory) { delete filteredState.logs; }
      if (!config.syncSchedule) { delete filteredState.scheduleBreaks; delete filteredState.scheduleStartTime; delete filteredState.sessionStartTime; }
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
      
      if (mode === 'full' && config.syncSettings && remote.settings) {
          setSettings(prev => ({
            ...normalizeSettings(remote.settings),
            disableBlur: prev.disableBlur,
            themeMode: prev.themeMode,
          }));
      }
      if (mode === 'full' && config.syncTasks && Array.isArray(remote.tasks)) {
          setTasks(remote.tasks);
          if (Array.isArray(remote.categories)) setCategories(remote.categories);
      }
      if (mode === 'full' && config.syncHistory && Array.isArray(remote.logs)) setLogs(remote.logs);
      if (mode === 'full' && config.syncSchedule) {
          if (Array.isArray(remote.scheduleBreaks)) setScheduleBreaks(remote.scheduleBreaks);
          if (typeof remote.scheduleStartTime === 'string') setScheduleStartTime(remote.scheduleStartTime);
          if (typeof remote.sessionStartTime === 'string' || remote.sessionStartTime === null) setSessionStartTime(remote.sessionStartTime ?? null);
      }
      if (config.syncTimers) {
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
  }, [getCurrentState, buildFilteredGroupState, buildTimerSpectatorState, pruneConnections]);

  useEffect(() => {
     if(!groupSessionId || isRemoteUpdate.current) return;
     const t = setTimeout(() => { broadcastState(); }, 80);
     return () => clearTimeout(t);
  }, [tasks, settings, activeMode, timerStarted, isIdle, workTime, breakTime, scheduleBreaks, scheduleStartTime, sessionStartTime, pomodoroCount, allPauseActive, allPauseTime, allPauseReason, allPauseStartTime, graceOpen, graceContext, graceTotal, groupSessionId, broadcastState, hostSyncConfig, clientSyncConfig, isHost]);

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
    setLogs(prev => [entry, ...prev]);
  }, [categories, tasks]);

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
    const nextLogs = [entry, ...logs];
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
  }, [categories, logs, pastSessions, user]);

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

  const handleBreakBoundaryReached = useCallback((overflowSeconds: number = 0) => {
    if (graceOpen) return;
    const now = new Date();
    if (currentActivityStartRef.current) {
      const elapsed = Math.max(0, (now.getTime() - currentActivityStartRef.current.getTime()) / 1000);
      const completedBreakDuration = Math.max(0, elapsed - overflowSeconds);
      if (completedBreakDuration > 0.5) {
        logActivity('break', currentActivityStartRef.current, completedBreakDuration, 'Break Complete');
      }
      currentActivityStartRef.current = null;
    }
    playAlarm(settings.alarmSound);
    const roundedDebtMinutes = Math.max(0, Math.ceil(overflowSeconds / 60));
    sendNotification(
      'Break Time Ended',
      roundedDebtMinutes > 0
        ? `Break bank depleted. You are ${roundedDebtMinutes} min into break debt.`
        : 'Break bank depleted. Timer is now counting break debt.',
    );
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
  }, [anchorRuntimePhase, graceOpen, logActivity, sendNotification, settings.alarmSound, workTime]);

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
    playAlarm(shouldAutoStartNextFocus ? settings.twoInARowStartSound : settings.alarmSound);
    const nextWorkTime = shouldAutoStartNextFocus ? settings.workDuration : 0;

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
        if (isDeferredTaskFromToday(selected, todayKey)) return prevTasks;
        
        let updatedTasks = incrementCompletedInTree(prevTasks, selected.id);
        
        const updatedSelected = findTask(updatedTasks, selected.id);
        if (updatedSelected) {
             if (!updatedSelected.checked && updatedSelected.completed >= updatedSelected.estimated) {
                 updatedTasks = updateTaskInTree(updatedTasks, { ...updatedSelected, checked: true });
                 sendNotification("Goal Reached", `${updatedSelected.name} goal met. Continuing...`);
             }
        }
        
        return updatedTasks;
    });

    sendNotification(
      completion.isLongBreak
        ? "Long Break Earned!"
        : settings.timerPreset === 'compact'
          ? "Mini-Pomo Complete"
          : "Focus Session Complete",
      shouldAutoStartNextFocus
        ? `${Math.floor(completion.reward/60)} minutes added to break bank. Next focus started.`
        : `${Math.floor(completion.reward/60)} minutes added to break bank.`,
    );

    if (shouldAutoStartNextFocus) {
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
  }, [settings, logActivity, sendNotification, pomodoroCount, breakTime, anchorRuntimePhase]);

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
    handleBreakBoundaryReached,
    handleWorkLoopComplete,
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
    if (typeof payload.scheduleStartTime === 'string') setScheduleStartTime(payload.scheduleStartTime);

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
        if (payloadUpdatedAtMs > lastExternalPayloadAppliedAtRef.current) {
          lastExternalPayloadAppliedAtRef.current = payloadUpdatedAtMs;
          isCrossTabApplyingRef.current = true;
          if (Array.isArray(parsed.tasks)) setTasks(parsed.tasks);
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

  const startTimerInternal = (opts?: { mode?: TimerMode, workOverride?: number, breakOverride?: number, forceActivityStart?: Date, playSound?: boolean, forceStart?: boolean }) => {
    if (timerStarted && !opts?.forceStart) return;
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    void resumeAudioContext();
    let nextSessionStartTime = sessionStartTime;
    let nextScheduleStartTime = scheduleStartTime;
    if (!sessionStartTime) {
        const now = new Date();
        nextSessionStartTime = now.toISOString();
        setSessionStartTime(nextSessionStartTime);
        const h = now.getHours().toString().padStart(2, '0');
        const m = now.getMinutes().toString().padStart(2, '0');
        nextScheduleStartTime = `${h}:${m}`;
        setScheduleStartTime(nextScheduleStartTime);
    }
    if (isIdle) setIsIdle(false);
    const activityStart = opts?.forceActivityStart || currentActivityStartRef.current || new Date();
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
      scheduleStartTime: nextScheduleStartTime,
    });
    if (opts?.playSound !== false) playSwitch();
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
    setTimerStarted(false);
    anchorRuntimePhase('idle');
    if (!opts?.silentGroupEvent) emitLocalGroupEvent('timer-stopped');
  };
  const toggleTimer = () => timerStarted ? stopTimer() : startTimer();

  const performSwitch = (targetMode: TimerMode) => {
    if (blockGuestTimerControl()) return;
    playSwitch();
    if (!isIdle && currentActivityStartRef.current) {
        const duration = (Date.now() - currentActivityStartRef.current.getTime()) / 1000;
        logActivity(activeMode, currentActivityStartRef.current, duration, 'Switch');
    }
    setActiveMode(targetMode);
    setIsIdle(false);
    setGraceOpen(false);
    setGraceContext(null);
    setGraceTotal(0);
    currentActivityStartRef.current = new Date();
    setTimerStarted(true);
    lastTickRef.current = Date.now();
    anchorRuntimePhase(targetMode === 'work' ? 'running-work' : 'running-break', {
      activityStartIso: currentActivityStartRef.current.toISOString(),
      activeMode: targetMode,
      timerStarted: true,
      isIdle: false,
      graceOpen: false,
      graceContext: null,
      graceTotal: 0,
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
    stopTimer({ silentGroupEvent: true });
    const pauseStart = Date.now();
    setAllPauseReason(reason);
    setAllPauseStartTime(pauseStart);
    setAllPauseTime(0);
    setAllPauseActive(true);
    setGraceOpen(false);
    setGraceContext(null);
    setGraceTotal(0);
    anchorRuntimePhase('all-pause', {
      phaseStartAllPauseTime: 0,
      activityStartIso: null,
      activeMode,
      timerStarted: false,
      isIdle: false,
      allPauseActive: true,
      allPauseTime: 0,
      allPauseReason: reason,
      allPauseStartTime: pauseStart,
      graceOpen: false,
      graceContext: null,
      graceTotal: 0,
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

    let pendingActiveDuration = 0;
    let pendingActiveMode: TimerMode | null = null;
    let pendingActiveCategoryId: number | null | undefined = null;
    let pendingActiveCategorySnapshot: Pick<LogEntry, 'categoryName' | 'categoryColor' | 'categoryIcon'> = {};
    let pendingActiveStartIso: string | null = null;

    if (!isIdle && currentActivityStartRef.current) {
      const elapsed = (effectiveEndMs - currentActivityStartRef.current.getTime()) / 1000;
      if (Number.isFinite(elapsed) && elapsed > 0.5) {
        pendingActiveDuration = elapsed;
        pendingActiveMode = activeMode;
        pendingActiveCategoryId = activeTask?.categoryId;
        pendingActiveCategorySnapshot = buildCategorySnapshot(categories, pendingActiveCategoryId ?? null);
        pendingActiveStartIso = currentActivityStartRef.current.toISOString();
        const selectedTask = activeTask ? { id: activeTask.id, name: activeTask.name } : null;
        const sessionEndEntry: LogEntry = {
          type: activeMode,
          start: pendingActiveStartIso,
          end: effectiveEndIso,
          duration: elapsed,
          reason: 'Session End',
          task: selectedTask,
          color: activeColor,
          categoryId: pendingActiveCategoryId ?? null,
          ...pendingActiveCategorySnapshot,
        };
        setLogs(prev => [sessionEndEntry, ...prev]);
      }
    }

    const sessionFloor = sessionStartTime || '';
    const workLogs = logs.filter((l) => l.type === 'work' && l.start >= sessionFloor && !isPauseCreditedWorkLog(l));
    const breakLogs = logs.filter((l) => l.type === 'break' && l.start >= sessionFloor);
    const pendingWorkSeconds = pendingActiveMode === 'work' ? pendingActiveDuration : 0;
    const pendingBreakSeconds = pendingActiveMode === 'break' ? pendingActiveDuration : 0;
    const totalWork = (workLogs.reduce((acc, l) => acc + l.duration, 0) + pendingWorkSeconds) / 60;
    const totalBreak = (breakLogs.reduce((acc, l) => acc + l.duration, 0) + pendingBreakSeconds) / 60;
    const completedTasksCount = flattenTasks(tasks).filter(t => t.checked).length;

    // Calculate Category Stats
    const categoryDetailsByKey = new Map<string, SessionCategoryStat>();
    const addSessionCategoryMinutes = (
      entry: Pick<LogEntry, 'categoryId' | 'categoryName' | 'categoryColor' | 'categoryIcon'>,
      rawMinutes: number,
    ) => {
      const safeMinutes = Number(rawMinutes);
      if (!Number.isFinite(safeMinutes) || safeMinutes <= 0) return;

      const resolvedCategory = resolveLogEntryCategory(entry, categories);
      const resolvedName = resolvedCategory.name || 'Uncategorized';
      const detailKey = typeof entry.categoryId === 'number' && Number.isFinite(entry.categoryId)
        ? `id:${entry.categoryId}`
        : `name:${resolvedName}`;
      const existing = categoryDetailsByKey.get(detailKey);

      if (existing) {
        existing.minutes += safeMinutes;
        if (!existing.categoryName && resolvedName) existing.categoryName = resolvedName;
        if (!existing.categoryColor && resolvedCategory.color) existing.categoryColor = resolvedCategory.color;
        if (!existing.categoryIcon && resolvedCategory.icon) existing.categoryIcon = resolvedCategory.icon;
        return;
      }

      categoryDetailsByKey.set(detailKey, {
        categoryId: typeof entry.categoryId === 'number' && Number.isFinite(entry.categoryId) ? entry.categoryId : null,
        categoryName: resolvedName,
        categoryColor: resolvedCategory.color || undefined,
        categoryIcon: resolvedCategory.icon || undefined,
        minutes: safeMinutes,
      });
    };

    workLogs.forEach((logEntry) => {
      addSessionCategoryMinutes(logEntry, logEntry.duration / 60);
    });
    if (pendingWorkSeconds > 0) {
      addSessionCategoryMinutes({
        categoryId: pendingActiveCategoryId ?? null,
        ...pendingActiveCategorySnapshot,
      }, pendingWorkSeconds / 60);
    }

    const categoryDetails = Array.from(categoryDetailsByKey.values());
    const catStats = categoryDetails.reduce<Record<string, number>>((acc, detail) => {
      const key = detail.categoryName || 'Uncategorized';
      acc[key] = (acc[key] || 0) + detail.minutes;
      return acc;
    }, {});
    const loggedCompletionStats = getPomodoroCompletionStatsFromLogs(workLogs);
    const standardPomosCompleted = loggedCompletionStats.completedLogs > 0
      ? loggedCompletionStats.standardPomosCompleted
      : getStandardPomodoroCountForTimer(pomodoroCount, settings);
    const miniPomosCompleted = loggedCompletionStats.completedLogs > 0
      ? loggedCompletionStats.miniPomosCompleted
      : (settings.timerPreset === 'compact' ? pomodoroCount : undefined);

    // Archive Session
    if (sessionStartTime) {
        const record: SessionRecord = {
            id: Date.now().toString(),
            startTime: sessionStartTime,
            endTime: effectiveEndIso,
            stats: {
                totalWorkMinutes: totalWork,
                totalBreakMinutes: totalBreak,
                pomosCompleted: standardPomosCompleted,
                ...(miniPomosCompleted !== undefined ? { miniPomosCompleted } : {}),
                tasksCompleted: completedTasksCount,
                categoryStats: catStats,
                categoryDetails,
            }
        };

        setPastSessions(prev => [record, ...prev]);

        // Recalculate lifetime stats from canonical history each time.
        if (user) {
            setUser(prev => {
                if (!prev) return null;
                const pendingSessionLogs = pendingActiveDuration > 0 && pendingActiveStartIso
                  ? [{
                      type: pendingActiveMode === 'work' ? 'work' : 'break',
                      start: pendingActiveStartIso,
                      end: effectiveEndIso,
                      duration: pendingActiveDuration,
                      reason: 'Session End',
                      task: activeTask ? { id: activeTask.id, name: activeTask.name } : null,
                      color: activeColor,
                      categoryId: pendingActiveCategoryId ?? null,
                      ...pendingActiveCategorySnapshot,
                    } as LogEntry]
                  : [];
                const nextStats = calculateLifetimeStats(
                  [record, ...pastSessions],
                  [...pendingSessionLogs, ...logs],
                  prev.joinedAt,
                  categories,
                );
                return { ...prev, lifetimeStats: nextStats };
            });
        }
    }

    setSessionStats({
        totalWorkMinutes: totalWork, totalBreakMinutes: totalBreak,
        tasksCompleted: completedTasksCount,
        pomosCompleted: standardPomosCompleted,
        ...(miniPomosCompleted !== undefined ? { miniPomosCompleted } : {}),
        categoryStats: catStats
    });

    setTasks(prev => removeCompletedTasks(prev));
    setPomodoroCount(0);
    setWorkTime(settings.workDuration);
    setBreakTime(0);
    setActiveMode('work');
    setIsIdle(true);
    setTimerStarted(false);
    setAllPauseActive(false);
    setAllPauseTime(0);
    setAllPauseReason('');
    setAllPauseStartTime(null);
    setGraceOpen(false);
    setGraceContext(null);
    setGraceTotal(0);
    setSessionStartTime(null);
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
      allPauseActive: false,
      allPauseTime: 0,
      allPauseReason: '',
      allPauseStartTime: null,
      graceOpen: false,
      graceContext: null,
      graceTotal: 0,
      pomodoroCount: 0,
      sessionStartTime: null,
      scheduleStartTime: nextScheduleStartTime,
    });

    setShowSummary(options?.showSummary !== false);
  }, [
    activeColor,
    activeMode,
    activeTask,
    anchorRuntimePhase,
    blockGuestTimerControl,
    calculateLifetimeStats,
    categories,
    isIdle,
    logs,
    pastSessions,
    pomodoroCount,
    sessionStartTime,
    settings.workDuration,
    tasks,
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
      setLogs([]);
      setPomodoroCount(0);
      setWorkTime(DEFAULT_SETTINGS.workDuration);
      setBreakTime(0);
      setActiveMode('work');
      setTimerStarted(false);
      setIsIdle(true);
      setAllPauseActive(false);
      setAllPauseTime(0);
      setAllPauseReason('');
      setAllPauseStartTime(null);
      setGraceOpen(false);
      setGraceContext(null);
      setGraceTotal(0);
      setSessionStartTime(null);
      setScheduleBreaks([]);
      setSessionStats(null);
      setShowSummary(false);
      leaveGroupSession();
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
        allPauseActive: false,
        allPauseTime: 0,
        allPauseReason: '',
        allPauseStartTime: null,
        graceOpen: false,
        graceContext: null,
        graceTotal: 0,
        pomodoroCount: 0,
        sessionStartTime: null,
        scheduleStartTime: nextScheduleStartTime,
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
  };

  const addTask = (name: string, estimated: number, catId: number | null, parentId?: number, color?: string, isFuture?: boolean, scheduledStart?: string, scheduledDate?: string) => {
    markAccountSyncDirty();
    const todayKey = getDateKey(new Date());
    const deferred = Boolean(isFuture) || (typeof scheduledDate === 'string' && scheduledDate > todayKey);
    const newTask: Task = {
      id: createTaskId(), name: getDefaultedTaskName(name, catId), estimated, completed: 0, checked: false,
      selected: false, categoryId: catId, subtasks: [], isExpanded: true, color: color || undefined, isFuture, scheduledStart, scheduledDate
    };
    if (parentId) setTasks(prev => addTaskToTree(prev, parentId, newTask));
    else setTasks(prev => [...prev, { ...newTask, selected: prev.length === 0 && !deferred }]);
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
      setTasks(prev => [...prev, { ...newTask, selected: prev.length === 0 && !deferred }]);
      return newTask.id;
  };

  const addSubtasksToTask = (parentId: number, subtasks: { name: string, est: number }[]) => {
    setTasks(prev => {
        let newTasks = [...prev];
        subtasks.forEach(sub => {
             const t: Task = { id: createTaskId(), name: sub.name, estimated: sub.est, completed: 0, checked: false, selected: false, categoryId: null, subtasks: [], isExpanded: false };
             newTasks = addTaskToTree(newTasks, parentId, t);
        });
        return newTasks;
    });
  };

  const updateTask = (task: Task) => {
    const nextTask = task.selected && isDeferredTaskFromToday(task) ? { ...task, selected: false } : task;
    setTasks(prev => updateTaskInTree(prev, nextTask));
  };
  const deleteTask = (id: number) => setTasks(prev => deleteTaskInTree(prev, id));
  const selectTask = (id: number) => setTasks(prev => selectTaskInTree(prev, id));
  
  const toggleTaskExpansion = (id: number) => {
    const task = findTask(tasks, id);
    if (task) setTasks(prev => updateTaskInTree(prev, { ...task, isExpanded: !task.isExpanded }));
  };

  const moveTask = (fromId: number, toId: number) => {
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
        return newTasks;
    });
  };

  const moveSubtask = (fromParentId: number, toParentId: number, subId: number, targetSubId: number | null) => {
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
        return insertSub(tempTasks);
    });
  };

  const splitTask = (taskId: number, splitAt: number) => {
    setTasks(prev => {
        const index = prev.findIndex(t => t.id === taskId);
        if (index === -1) return prev;
        const task = prev[index];
        if (splitAt <= task.completed || splitAt >= task.estimated) return prev;
        const remainingEst = task.estimated - splitAt;
        const part1 = { ...task, estimated: splitAt };
        const part2 = { ...task, id: createTaskId(), name: `${task.name} (Part 2)`, estimated: remainingEst, completed: 0, subtasks: [] };
        const newTasks = [...prev];
        newTasks[index] = part1;
        newTasks.splice(index + 1, 0, part2);
        return newTasks;
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
    setCategories(prev => [...prev, { id: createCategoryId(prev), name: trimmedName, color, icon }]);
  };
  const updateCategory = (cat: Category) => {
    const trimmedName = cat.name.trim();
    if (!trimmedName) return;
    setCategories(prev => prev.map(c => (c.id === cat.id ? { ...c, ...cat, name: trimmedName } : c)));
  };
  const archiveCategory = (id: number) => {
    setCategories(prev => prev.map(c => (c.id === id ? { ...c, archived: true } : c)));
    if (selectedCategoryId === id) setSelectedCategoryId(null);
  };
  const deleteCategory = (id: number) => {
    setCategories(prev => prev.filter(c => c.id !== id));
    setTasks(prev => clearCategoryFromTasks(prev, id));
    if (selectedCategoryId === id) setSelectedCategoryId(null);
  };
  const moveCategory = (fromId: number, toId: number) => {
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
    setSettings(safeSettings);
    if (!timerStarted && activeMode === 'work') {
      setWorkTime(safeSettings.workDuration);
      if (!allPauseActive && !graceOpen) {
        anchorRuntimePhase('idle', { phaseStartWorkTime: safeSettings.workDuration });
      }
    }
  };

  const clearLogs = () => { setLogs([]); setPomodoroCount(0); };
  const resetTimers = () => restartActiveTimer();

  return (
    <TimerContext.Provider value={{
      user, workTime, breakTime, activeMode, timerStarted, isIdle, pomodoroCount,
      allPauseActive, allPauseTime, graceOpen, graceContext, graceTotal,
      tasks, pastSessions, categories, logs, settings, selectedCategoryId, scheduleBreaks, scheduleStartTime, sessionStartTime,
      isScheduleOpen, setScheduleOpen, isWeeklyScheduleOpen, setWeeklyScheduleOpen, showCompletedTasks, setShowCompletedTasks,
      activeTask, activeColor, showSummary, sessionStats,
      groupSessionId, userName, isHost, peerError, members, hostSyncConfig, clientSyncConfig, pendingJoinId, pendingMenuAction, groupNotice, guestTimerLockNotice,
      accountSyncState, accountSyncError, lastAccountSyncAt, isPreviewAccount,
      login, logout, register, syncAccountNow, refreshAccountFromCloud,
      startTimer, stopTimer, toggleTimer, switchMode, activateMode,
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
