import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  TimerMode,
  Task,
  Category,
  LogEntry,
  TimerSettings,
  AlarmSound,
  GroupSyncConfig,
  GroupMember,
  GroupEventType,
  GroupEventPayload,
  GroupNotice,
  User,
  SessionRecord,
  TimerRuntimePhase,
  TimerRuntimeSnapshot,
} from '../types';
import { playAlarm, playSwitch } from '../utils/sound';
import Peer, { DataConnection } from 'peerjs';
import {
  TIMER_RUNTIME_VERSION,
  computeWorkCompletion,
  createRuntimeSnapshot,
  deriveRuntimeValues,
  detectRuntimeBoundaryCrossing,
} from '../utils/timerRuntime';
import {
  fetchAccountData,
  isUnauthorizedError,
  loginAccount,
  logoutAccount,
  registerAccount,
  saveAccountData,
} from '../utils/accountApi';

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
  categoryStats: Record<string, number>;
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
  groupNotice: GroupNotice | null;
  accountSyncState: 'idle' | 'syncing' | 'synced' | 'error';
  accountSyncError: string | null;
  lastAccountSyncAt: number | null;

  // Actions
  login: (username: string, password?: string) => Promise<boolean>;
  register: (username: string, password?: string) => Promise<boolean>;
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
  endSession: () => void;
  closeSummary: () => void;
  hardReset: () => void;
  
  // Group Actions
  createGroupSession: (name: string, config: GroupSyncConfig) => Promise<string>;
  joinGroupSession: (id: string, name: string, config: GroupSyncConfig) => Promise<void>;
  leaveGroupSession: () => void;
  updateHostSyncConfig: (config: GroupSyncConfig) => void;
  setPendingJoinId: (id: string | null) => void;

  // Data Management
  addTask: (name: string, est: number, catId: number | null, parentId?: number, color?: string, isFuture?: boolean, scheduledStart?: string, scheduledDate?: string) => void;
  addDetailedTask: (task: Partial<Task> & { name: string, estimated: number }) => void;
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
  deleteCategory: (id: number) => void;
  selectCategory: (id: number | null) => void;
  updateSettings: (newSettings: TimerSettings) => void;
  clearLogs: () => void;
  resetTimers: () => void;
  setPomodoroCount: (count: number) => void;
  addScheduleBreak: (brk: ScheduleBreak) => void;
  deleteScheduleBreak: (id: string) => void;
  setScheduleStartTime: (time: string) => void;
  setScheduleOpen: (isOpen: boolean) => void;
  setWeeklyScheduleOpen: (isOpen: boolean) => void;
}

const TimerContext = createContext<TimerContextType | undefined>(undefined);

// Storage Logic
const getGuestKey = () => 'doro_guest_data';
const getUserKey = (username: string) => `doro_user_${username}`;

const DEFAULT_SETTINGS: TimerSettings = {
  workDuration: 1500, 
  shortBreakDuration: 300, 
  longBreakDuration: 900,
  longBreakInterval: 4, 
  disableBlur: true,
  alarmSound: 'bell',
  themeMode: 'dark'
};

const DEFAULT_SYNC_CONFIG: GroupSyncConfig = {
    syncTimers: true,
    syncTasks: false,
    syncSchedule: false,
    syncHistory: false,
    syncSettings: false
};

const DATA_SCHEMA_VERSION = 2;
const LEGACY_RUNTIME_FLAG = 'doro_use_legacy_tick';
const CROSS_TAB_CHANNEL = 'doro_timer_sync';
const AUTH_TOKEN_KEY = 'doro_auth_token';

const TIMER_ONLY_SYNC_CONFIG: GroupSyncConfig = {
  syncTimers: true,
  syncTasks: false,
  syncSchedule: false,
  syncHistory: false,
  syncSettings: false,
};

const normalizeSyncConfig = (value: Partial<GroupSyncConfig> | undefined | null, fallback: GroupSyncConfig = DEFAULT_SYNC_CONFIG): GroupSyncConfig => ({
  syncTimers: typeof value?.syncTimers === 'boolean' ? value.syncTimers : fallback.syncTimers,
  syncTasks: typeof value?.syncTasks === 'boolean' ? value.syncTasks : fallback.syncTasks,
  syncSchedule: typeof value?.syncSchedule === 'boolean' ? value.syncSchedule : fallback.syncSchedule,
  syncHistory: typeof value?.syncHistory === 'boolean' ? value.syncHistory : fallback.syncHistory,
  syncSettings: typeof value?.syncSettings === 'boolean' ? value.syncSettings : fallback.syncSettings,
});

const intersectSyncConfig = (host: GroupSyncConfig, client: GroupSyncConfig): GroupSyncConfig => ({
  syncTimers: host.syncTimers && client.syncTimers,
  syncTasks: host.syncTasks && client.syncTasks,
  syncSchedule: host.syncSchedule && client.syncSchedule,
  syncHistory: host.syncHistory && client.syncHistory,
  syncSettings: host.syncSettings && client.syncSettings,
});

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

const isGroupEventType = (value: unknown): value is GroupEventType => {
  return typeof value === 'string' && GROUP_EVENT_TYPES.includes(value as GroupEventType);
};

const getDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
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

const EMPTY_LIFETIME_STATS: User['lifetimeStats'] = {
  totalFocusHours: 0,
  totalSessions: 0,
  totalPomos: 0,
  activeDays: 0,
  currentStreak: 0,
  bestStreak: 0,
  lastActiveDate: null,
  categoryBreakdown: {},
};

const isPauseCreditedWorkLog = (entry: LogEntry): boolean => {
  if (entry.type !== 'work') return false;
  const reason = (entry.reason || '').trim().toLowerCase();
  return reason.startsWith('paused') || reason.includes('pause credit');
};

const getLocalDateKeyFromIso = (iso: string): string | null => {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return getDateKey(dt);
};

const parseDateKey = (value: string): Date | null => {
  const parts = value.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
};

const getDayDiff = (fromKey: string, toKey: string): number | null => {
  const from = parseDateKey(fromKey);
  const to = parseDateKey(toKey);
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
};

const calculateLifetimeStatsFromData = (
  sessions: SessionRecord[],
  currentLogs: LogEntry[],
  categories: Category[],
): User['lifetimeStats'] => {
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const safeLogs = Array.isArray(currentLogs) ? currentLogs : [];
  const safeCategories = Array.isArray(categories) ? categories : [];

  const productiveLogs = safeLogs.filter((entry) => {
    if (entry.type !== 'work') return false;
    if (!Number.isFinite(entry.duration) || entry.duration <= 0) return false;
    return !isPauseCreditedWorkLog(entry);
  });

  const workSecondsFromLogs = productiveLogs.reduce((acc, entry) => acc + Math.max(0, entry.duration), 0);
  const workHoursFromLogs = workSecondsFromLogs / 3600;
  const workMinutesFromSessions = safeSessions.reduce((acc, session) => {
    const mins = Number(session.stats?.totalWorkMinutes || 0);
    return acc + (Number.isFinite(mins) && mins > 0 ? mins : 0);
  }, 0);
  const workHoursFromSessions = workMinutesFromSessions / 60;
  const totalFocusHours = productiveLogs.length > 0 ? workHoursFromLogs : workHoursFromSessions;

  const totalSessions = safeSessions.length;
  const totalPomos = safeSessions.reduce((acc, session) => {
    const pomos = Number(session.stats?.pomosCompleted || 0);
    return acc + Math.max(0, Math.floor(Number.isFinite(pomos) ? pomos : 0));
  }, 0);

  const categoryMap = new Map<number, string>();
  safeCategories.forEach((cat) => {
    if (typeof cat.id === 'number' && Number.isFinite(cat.id) && cat.name) {
      categoryMap.set(cat.id, cat.name);
    }
  });

  const categoryBreakdown: Record<string, number> = {};
  if (productiveLogs.length > 0) {
    productiveLogs.forEach((entry) => {
      const minutes = Math.max(0, entry.duration / 60);
      if (minutes <= 0) return;
      const key = typeof entry.categoryId === 'number'
        ? (categoryMap.get(entry.categoryId) || 'Uncategorized')
        : 'Uncategorized';
      categoryBreakdown[key] = (categoryBreakdown[key] || 0) + minutes;
    });
  } else {
    safeSessions.forEach((session) => {
      if (!session.stats?.categoryStats) return;
      Object.entries(session.stats.categoryStats).forEach(([name, minutes]) => {
        const safeMinutes = Number(minutes);
        if (!name || !Number.isFinite(safeMinutes) || safeMinutes <= 0) return;
        categoryBreakdown[name] = (categoryBreakdown[name] || 0) + safeMinutes;
      });
    });
  }

  const productiveDates = new Set<string>();
  if (productiveLogs.length > 0) {
    productiveLogs.forEach((entry) => {
      const key = getLocalDateKeyFromIso(entry.start);
      if (key) productiveDates.add(key);
    });
  } else {
    safeSessions.forEach((session) => {
      const mins = Number(session.stats?.totalWorkMinutes || 0);
      if (!Number.isFinite(mins) || mins <= 0) return;
      const key = getLocalDateKeyFromIso(session.startTime);
      if (key) productiveDates.add(key);
    });
  }

  const sortedDates = Array.from(productiveDates).sort();
  const activeDays = sortedDates.length;

  let bestStreak = 0;
  let runningStreak = 0;
  for (let i = 0; i < sortedDates.length; i += 1) {
    if (i === 0) {
      runningStreak = 1;
    } else {
      const diff = getDayDiff(sortedDates[i - 1], sortedDates[i]);
      runningStreak = diff === 1 ? runningStreak + 1 : 1;
    }
    if (runningStreak > bestStreak) bestStreak = runningStreak;
  }

  let currentStreak = 0;
  if (sortedDates.length > 0) {
    const todayKey = getDateKey(new Date());
    const lastKey = sortedDates[sortedDates.length - 1];
    const diffToToday = getDayDiff(lastKey, todayKey);
    if (diffToToday !== null && diffToToday <= 1) {
      currentStreak = 1;
      for (let i = sortedDates.length - 1; i > 0; i -= 1) {
        const diff = getDayDiff(sortedDates[i - 1], sortedDates[i]);
        if (diff === 1) currentStreak += 1;
        else break;
      }
    }
  }

  return {
    ...EMPTY_LIFETIME_STATS,
    totalFocusHours,
    totalSessions,
    totalPomos,
    activeDays,
    currentStreak,
    bestStreak,
    lastActiveDate: sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : null,
    categoryBreakdown,
  };
};

interface TimerPersistencePayload {
  schemaVersion?: number;
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

const isRuntimeSnapshot = (value: any): value is TimerRuntimeSnapshot => {
  return !!value && typeof value === 'object' && value.version === TIMER_RUNTIME_VERSION && typeof value.updatedAtMs === 'number' && typeof value.phase === 'string';
};

export const TimerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isDevMode = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const [user, setUser] = useState<User | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem(AUTH_TOKEN_KEY));
  const [accountSyncState, setAccountSyncState] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [accountSyncError, setAccountSyncError] = useState<string | null>(null);
  const [lastAccountSyncAt, setLastAccountSyncAt] = useState<number | null>(null);
  
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
  const [groupNotice, setGroupNotice] = useState<GroupNotice | null>(null);
  const hostSyncConfigRef = useRef<GroupSyncConfig>(DEFAULT_SYNC_CONFIG);
  const clientSyncConfigRef = useRef<GroupSyncConfig>(DEFAULT_SYNC_CONFIG);
  const activeModeRef = useRef<TimerMode>('work');
  
  const isRemoteUpdate = useRef(false);
  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<DataConnection[]>([]);
  const lastClientTimerBroadcastSignatureRef = useRef<string | null>(null);
  const localPeerIdRef = useRef<string | null>(null);

  const lastTickRef = useRef<number | null>(null);
  const shadowTickRef = useRef<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const currentActivityStartRef = useRef<Date | null>(null);
  const lastLoopTimeRef = useRef<number>(0);
  const isProcessingRef = useRef(false);
  const isResolvingGraceRef = useRef(false);
  const skipSaveRef = useRef(false);
  const isCloudSyncInFlightRef = useRef(false);
  const isApplyingCloudSnapshotRef = useRef(false);
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
  const [legacyRuntimeMode, setLegacyRuntimeMode] = useState(() => {
    try {
      return localStorage.getItem(LEGACY_RUNTIME_FLAG) === '1';
    } catch {
      return false;
    }
  });

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

  const persistRuntimeSnapshot = useCallback((snapshot: TimerRuntimeSnapshot, overrideKey?: string) => {
    const key = overrideKey || getActiveStorageKey();
    const runtimeRunning = snapshot.phase === 'running-work' || snapshot.phase === 'running-break';
    const runtimeMode: TimerMode = snapshot.phase === 'running-break' ? 'break' : activeMode;
    try {
      const existingRaw = localStorage.getItem(key);
      const existing: TimerPersistencePayload = existingRaw ? JSON.parse(existingRaw) : {};
      const merged: TimerPersistencePayload = {
        ...existing,
        schemaVersion: DATA_SCHEMA_VERSION,
        runtime: snapshot,
        activeMode: runtimeMode,
        timerStarted: runtimeRunning,
        isIdle: snapshot.phase === 'idle' ? isIdle : false,
        allPauseActive: snapshot.phase === 'all-pause',
        allPauseTime,
        allPauseReason,
        allPauseStartTime,
        graceOpen: snapshot.phase === 'grace',
        graceContext,
        graceTotal,
      };
      localStorage.setItem(key, JSON.stringify(merged));
    } catch (error) {
      console.error('Failed to persist runtime snapshot', error);
    }
  }, [
    getActiveStorageKey,
    activeMode,
    timerStarted,
    isIdle,
    allPauseActive,
    allPauseTime,
    allPauseReason,
    allPauseStartTime,
    graceOpen,
    graceContext,
    graceTotal,
  ]);

  const anchorRuntimePhase = useCallback((phase: TimerRuntimePhase, overrides?: Partial<Pick<TimerRuntimeSnapshot, 'phaseStartWorkTime' | 'phaseStartBreakTime' | 'phaseStartAllPauseTime' | 'phaseStartGraceTotal' | 'activityStartIso'>>) => {
    const phaseWorkTime = overrides?.phaseStartWorkTime ?? workTime;
    const phaseBreakTime = overrides?.phaseStartBreakTime ?? breakTime;
    const phaseAllPause = overrides?.phaseStartAllPauseTime ?? allPauseTime;
    const phaseGrace = overrides?.phaseStartGraceTotal ?? graceTotal;
    const phaseImpliesRunning = phase === 'running-work' || phase === 'running-break';
    const phaseMode: TimerMode = phase === 'running-break' ? 'break' : activeMode;
    const snapshot = createRuntimeSnapshot({
      sourceTabId: tabIdRef.current,
      phase,
      nowMs: Date.now(),
      workTime: phaseWorkTime,
      breakTime: phaseBreakTime,
      allPauseTime: phaseAllPause,
      graceTotal: phaseGrace,
      activityStartIso: overrides?.activityStartIso ?? (currentActivityStartRef.current ? currentActivityStartRef.current.toISOString() : null),
    });
    runtimeRef.current = snapshot;
    lastRuntimeAppliedRef.current = snapshot.updatedAtMs;
    persistRuntimeSnapshot(snapshot);
    if (broadcastChannelRef.current) {
      broadcastChannelRef.current.postMessage({
        type: 'RUNTIME_SYNC',
        key: getActiveStorageKey(),
        runtime: snapshot,
        timer: {
          activeMode: phaseMode,
          timerStarted: phaseImpliesRunning,
          isIdle: phase === 'idle' ? isIdle : false,
          allPauseActive: phase === 'all-pause',
          allPauseTime: phaseAllPause,
          allPauseReason,
          allPauseStartTime,
          graceOpen: phase === 'grace',
          graceContext,
          graceTotal: phaseGrace,
          workTime: phaseWorkTime,
          breakTime: phaseBreakTime,
          pomodoroCount,
          sessionStartTime,
          scheduleStartTime,
        },
      });
    }
  }, [workTime, breakTime, allPauseTime, graceTotal, persistRuntimeSnapshot, getActiveStorageKey, activeMode, timerStarted, isIdle, allPauseActive, allPauseReason, allPauseStartTime, graceOpen, graceContext, pomodoroCount, sessionStartTime, scheduleStartTime]);

  // Load Data Helper
  const loadData = useCallback((username?: string) => {
      skipSaveRef.current = true; // Prevent save effect triggering during load
      const key = username ? getUserKey(username) : getGuestKey();
      const saved = localStorage.getItem(key);
      
      if (saved) {
        try {
            const parsed: TimerPersistencePayload = JSON.parse(saved);
            const parsedTasks = parsed.tasks || [];
            const parsedSessions = parsed.pastSessions || [];
            const parsedCategories = parsed.categories || [];
            const parsedLogs = parsed.logs || [];
            setSettings({ ...DEFAULT_SETTINGS, ...(parsed.settings || {}) });
            setTasks(parsedTasks);
            lastTaskIdSeed = Math.max(lastTaskIdSeed, getMaxTaskId(parsedTasks));
            setPastSessions(parsedSessions);
            setCategories(parsedCategories);
            setLogs(parsedLogs);
            setPomodoroCount(parsed.pomodoroCount || 0);
            setScheduleBreaks(parsed.scheduleBreaks || []);
            const nextBreakTime = parsed.breakTime !== undefined ? parsed.breakTime : 0;
            const nextWorkTime = parsed.workTime !== undefined ? parsed.workTime : DEFAULT_SETTINGS.workDuration;
            setBreakTime(nextBreakTime);
            setWorkTime(nextWorkTime);
            setActiveMode(parsed.activeMode || 'work');
            setIsIdle(parsed.isIdle !== undefined ? parsed.isIdle : true);
            
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
            } else {
                setUser(null);
            }
            
            if (parsed.userName) setUserName(parsed.userName);
            
            if (parsed.sessionStartTime) {
                setSessionStartTime(parsed.sessionStartTime);
                if (parsed.scheduleStartTime) setScheduleStartTime(parsed.scheduleStartTime);
            } else {
                 const now = new Date();
                 const h = now.getHours().toString().padStart(2, '0');
                 const m = now.getMinutes().toString().padStart(2, '0');
                 setScheduleStartTime(`${h}:${m}`);
            }

            const hasRuntime = parsed.schemaVersion === DATA_SCHEMA_VERSION && isRuntimeSnapshot(parsed.runtime);
            if (hasRuntime && parsed.runtime) {
                runtimeRef.current = parsed.runtime;
                lastRuntimeAppliedRef.current = parsed.runtime.updatedAtMs;
                const runtimeRunning = parsed.runtime.phase === 'running-work' || parsed.runtime.phase === 'running-break';
                setTimerStarted(parsed.timerStarted !== undefined ? Boolean(parsed.timerStarted) : runtimeRunning);
                setAllPauseActive(parsed.allPauseActive !== undefined ? Boolean(parsed.allPauseActive) : parsed.runtime.phase === 'all-pause');
                setAllPauseTime(parsed.allPauseTime || 0);
                setAllPauseReason(parsed.allPauseReason || '');
                setAllPauseStartTime(parsed.allPauseStartTime ?? null);
                const parsedGraceRawContext = parsed.graceContext;
                const parsedMode = parsed.activeMode === 'work' || parsed.activeMode === 'break' ? parsed.activeMode : 'work';
                const parsedGraceCandidateOpen = parsed.graceOpen !== undefined ? Boolean(parsed.graceOpen) : parsed.runtime.phase === 'grace';
                const parsedHasLegacyBreakGrace = parsedGraceRawContext === 'afterBreak' || (parsedGraceRawContext == null && parsedMode === 'break');
                const parsedGraceOpen = parsedGraceCandidateOpen;
                const parsedGraceContext: 'afterWork' | null = parsedGraceOpen && !parsedHasLegacyBreakGrace ? 'afterWork' : null;
                setGraceOpen(parsedGraceOpen);
                setGraceContext(parsedGraceContext);
                setGraceTotal(parsedGraceOpen && !parsedHasLegacyBreakGrace ? (parsed.graceTotal || 0) : 0);
                if (parsed.runtime.phase === 'running-break') setActiveMode('break');
                if (parsed.runtime.phase === 'running-work') setActiveMode('work');
                if (parsed.isIdle === undefined) setIsIdle(parsed.runtime.phase === 'idle');
                currentActivityStartRef.current = parsed.runtime.activityStartIso ? new Date(parsed.runtime.activityStartIso) : null;
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
        } catch (e) { console.error("Failed to load", e); }
      } else {
          // Defaults for new user or guest
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
          const h = now.getHours().toString().padStart(2, '0');
          const m = now.getMinutes().toString().padStart(2, '0');
          setScheduleStartTime(`${h}:${m}`);
          if (username) {
              setUser({ 
                  username, 
                  joinedAt: new Date().toISOString(), 
                  lifetimeStats: { ...EMPTY_LIFETIME_STATS } 
              });
          } else {
              setUser(null);
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

  const mergeData = (localData: any, remoteData: any, prefer: 'local' | 'remote' = 'local') => {
      const mergeByPreference = <T extends { id: number | string }>(remoteItems: T[] = [], localItems: T[] = []) => {
        const merged = new Map<number | string, T>();
        const first = prefer === 'local' ? remoteItems : localItems;
        const second = prefer === 'local' ? localItems : remoteItems;
        first.forEach((item) => merged.set(item.id, item));
        second.forEach((item) => merged.set(item.id, item));
        return Array.from(merged.values());
      };

      // 1. Logs: Union by start time + type
      const logMap = new Map();
      remoteData.logs?.forEach((l: LogEntry) => logMap.set(l.start + l.type, l));
      localData.logs?.forEach((l: LogEntry) => logMap.set(l.start + l.type, l));
      const mergedLogs = Array.from(logMap.values()).sort((a: any, b: any) => new Date(b.start).getTime() - new Date(a.start).getTime());

      // 2. Tasks: Union by ID with caller-defined conflict preference.
      const mergedTasks = mergeByPreference<Task>(remoteData.tasks, localData.tasks);

      // 3. Sessions: Union by ID
      const sessionMap = new Map();
      remoteData.pastSessions?.forEach((s: SessionRecord) => sessionMap.set(s.id, s));
      localData.pastSessions?.forEach((s: SessionRecord) => sessionMap.set(s.id, s));
      const mergedSessions = Array.from(sessionMap.values()).sort((a: any, b: any) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

      // 4. Categories
      const mergedCategories = mergeByPreference<Category>(remoteData.categories, localData.categories);

      // 5. Settings: Local takes precedence for user comfort on this device
      const mergedSettings = prefer === 'local'
        ? { ...DEFAULT_SETTINGS, ...remoteData.settings, ...localData.settings }
        : { ...DEFAULT_SETTINGS, ...localData.settings, ...remoteData.settings };

      return {
          logs: mergedLogs,
          tasks: mergedTasks,
          pastSessions: mergedSessions,
          categories: mergedCategories,
          settings: mergedSettings
      };
  };

  const syncAccountNow = useCallback(async (): Promise<boolean> => {
      if (!user || !authToken || isApplyingCloudSnapshotRef.current) return false;
      if (isCloudSyncInFlightRef.current) return false;

      const localStr = localStorage.getItem(getUserKey(user.username));
      if (!localStr) return false;

      try {
          isCloudSyncInFlightRef.current = true;
          setAccountSyncState('syncing');
          setAccountSyncError(null);
          const payload: TimerPersistencePayload = JSON.parse(localStr);
          const payloadUser = payload.user;
          const joinedAt = payloadUser?.joinedAt || user.joinedAt;
          const normalizedUser: User = {
            ...(payloadUser || user),
            username: user.username,
            joinedAt,
            lifetimeStats: calculateLifetimeStats(
              payload.pastSessions || [],
              payload.logs || [],
              joinedAt,
              payload.categories || [],
            ),
          };
          payload.schemaVersion = DATA_SCHEMA_VERSION;
          payload.userName = normalizedUser.username;
          payload.user = normalizedUser;
          payload.updatedAt = new Date().toISOString();
          const response = await saveAccountData(authToken, payload);
          const persisted = response.accountData || payload;
          localStorage.setItem(getUserKey(user.username), JSON.stringify(persisted));
          if (persisted.user) setUser(persisted.user as User);
          setLastAccountSyncAt(Date.now());
          setAccountSyncState('synced');
          return true;
      } catch (error) {
          if (isUnauthorizedError(error)) {
              localStorage.removeItem(AUTH_TOKEN_KEY);
              setAuthToken(null);
          }
          setAccountSyncState('error');
          setAccountSyncError(error instanceof Error ? error.message : 'Cloud sync failed.');
          return false;
      } finally {
          isCloudSyncInFlightRef.current = false;
      }
  }, [authToken, user]);

  const refreshAccountFromCloud = useCallback(async (options?: { force?: boolean }): Promise<boolean> => {
      if (!user || !authToken) return false;
      if (isCloudSyncInFlightRef.current || isApplyingCloudSnapshotRef.current) return false;

      const force = options?.force ?? true;

      try {
          setAccountSyncState('syncing');
          setAccountSyncError(null);
          const remote = await fetchAccountData(authToken);
          const cloudUser = remote.user;
          const cloudPayload = remote.accountData || {};
          const localCacheKey = getUserKey(cloudUser.username);
          const localPayload = JSON.parse(localStorage.getItem(localCacheKey) || '{}');
          const cloudRuntimeUpdated = isRuntimeSnapshot(cloudPayload.runtime) ? cloudPayload.runtime.updatedAtMs : 0;
          const localRuntimeUpdated = isRuntimeSnapshot(localPayload.runtime) ? localPayload.runtime.updatedAtMs : 0;
          const cloudUpdatedAt = typeof cloudPayload.updatedAt === 'string' ? Date.parse(cloudPayload.updatedAt) : 0;
          const localUpdatedAt = typeof localPayload.updatedAt === 'string' ? Date.parse(localPayload.updatedAt) : 0;
          const hasRemoteTimerChange = cloudRuntimeUpdated > localRuntimeUpdated;
          const hasRemoteDataChange = Number.isFinite(cloudUpdatedAt) && Number.isFinite(localUpdatedAt)
            ? cloudUpdatedAt > localUpdatedAt
            : cloudUpdatedAt > 0;
          if (!force && !hasRemoteTimerChange && !hasRemoteDataChange) {
            setAccountSyncState('synced');
            setLastAccountSyncAt(Date.now());
            return true;
          }

          const mergedCore = mergeData(localPayload, cloudPayload, 'remote');
          const mergedStats = calculateLifetimeStats(
            mergedCore.pastSessions || [],
            mergedCore.logs || [],
            cloudUser.joinedAt,
            mergedCore.categories || [],
          );
          const mergedPayload: TimerPersistencePayload = {
              ...cloudPayload,
              ...mergedCore,
              schemaVersion: DATA_SCHEMA_VERSION,
              user: { ...cloudUser, lifetimeStats: mergedStats },
              userName: cloudUser.username,
              activeMode: cloudPayload.activeMode === 'break' ? 'break' : 'work',
              timerStarted: Boolean(cloudPayload.timerStarted),
              isIdle: typeof cloudPayload.isIdle === 'boolean' ? cloudPayload.isIdle : true,
              allPauseActive: Boolean(cloudPayload.allPauseActive),
              allPauseTime: typeof cloudPayload.allPauseTime === 'number' ? cloudPayload.allPauseTime : 0,
              graceOpen: Boolean(cloudPayload.graceOpen),
              graceContext: cloudPayload.graceContext === 'afterWork' || cloudPayload.graceContext === 'afterBreak' ? cloudPayload.graceContext : null,
              graceTotal: typeof cloudPayload.graceTotal === 'number' ? cloudPayload.graceTotal : 0,
              updatedAt: typeof cloudPayload.updatedAt === 'string' ? cloudPayload.updatedAt : new Date().toISOString(),
          };

          if (!isRuntimeSnapshot(mergedPayload.runtime)) {
              const safeWork = mergedPayload.workTime ?? mergedPayload.settings?.workDuration ?? DEFAULT_SETTINGS.workDuration;
              const safeBreak = mergedPayload.breakTime ?? 0;
              mergedPayload.runtime = createRuntimeSnapshot({
                  sourceTabId: tabIdRef.current,
                  phase: 'idle',
                  nowMs: Date.now(),
                  workTime: safeWork,
                  breakTime: safeBreak,
                  allPauseTime: 0,
                  graceTotal: 0,
                  activityStartIso: null,
              });
              mergedPayload.timerStarted = false;
              mergedPayload.isIdle = true;
              mergedPayload.allPauseActive = false;
              mergedPayload.allPauseTime = 0;
              mergedPayload.graceOpen = false;
              mergedPayload.graceContext = null;
              mergedPayload.graceTotal = 0;
          }

          isApplyingCloudSnapshotRef.current = true;
          localStorage.setItem(localCacheKey, JSON.stringify(mergedPayload));
          localStorage.setItem('doro_last_user', cloudUser.username);
          setUserName(cloudUser.username);
          loadData(cloudUser.username);
          isApplyingCloudSnapshotRef.current = false;

          if (force || hasRemoteDataChange) {
            await saveAccountData(authToken, mergedPayload);
          }
          hasHydratedCloudForUserRef.current = cloudUser.username;
          setLastAccountSyncAt(Date.now());
          setAccountSyncState('synced');
          return true;
      } catch (error) {
          isApplyingCloudSnapshotRef.current = false;
          if (isUnauthorizedError(error)) {
              localStorage.removeItem(AUTH_TOKEN_KEY);
              setAuthToken(null);
          }
          setAccountSyncState('error');
          setAccountSyncError(error instanceof Error ? error.message : 'Failed to refresh from cloud.');
          return false;
      }
  }, [authToken, loadData, user]);

  const register = async (username: string, password?: string): Promise<boolean> => {
      if (!password) return false;
      try {
          const guestData = JSON.parse(localStorage.getItem(getGuestKey()) || '{}');
          const response = await registerAccount(username, password, guestData);
          localStorage.setItem(AUTH_TOKEN_KEY, response.token);
          setAuthToken(response.token);

          const accountUsername = response.user.username;
          const seededPayload = response.accountData || {};
          const accountPayload: TimerPersistencePayload = {
            ...seededPayload,
            user: {
              ...response.user,
              lifetimeStats: calculateLifetimeStats(
                seededPayload.pastSessions || [],
                seededPayload.logs || [],
                response.user.joinedAt,
                seededPayload.categories || [],
              ),
            },
            userName: accountUsername,
            schemaVersion: DATA_SCHEMA_VERSION,
            updatedAt: typeof seededPayload.updatedAt === 'string' ? seededPayload.updatedAt : new Date().toISOString(),
          };

          localStorage.setItem(getUserKey(accountUsername), JSON.stringify(accountPayload));
          localStorage.setItem('doro_last_user', accountUsername);
          hasHydratedCloudForUserRef.current = accountUsername;
          setUserName(accountUsername);
          setLastAccountSyncAt(Date.now());
          setAccountSyncState('synced');
          setAccountSyncError(null);
          loadData(accountUsername);
          return true;
      } catch (error) {
          setAccountSyncState('error');
          setAccountSyncError(error instanceof Error ? error.message : 'Registration failed.');
          return false;
      }
  };

  const login = async (username: string, password?: string): Promise<boolean> => {
      if (!password) return false;
      try {
          const response = await loginAccount(username, password);
          const guestData = JSON.parse(localStorage.getItem(getGuestKey()) || '{}');
          const remoteAccount = response.accountData || {};
          const merged = mergeData(guestData, remoteAccount);
          const mergedStats = calculateLifetimeStats(
            merged.pastSessions || [],
            merged.logs || [],
            response.user.joinedAt,
            merged.categories || [],
          );
          const accountUsername = response.user.username;
          const remoteMode: TimerMode = remoteAccount.activeMode === 'break' ? 'break' : 'work';
          const remoteRuntime = isRuntimeSnapshot(remoteAccount.runtime)
            ? remoteAccount.runtime
            : createRuntimeSnapshot({
                sourceTabId: tabIdRef.current,
                phase: 'idle',
                nowMs: Date.now(),
                workTime: remoteAccount.workTime ?? merged.settings?.workDuration ?? DEFAULT_SETTINGS.workDuration,
                breakTime: remoteAccount.breakTime ?? 0,
                allPauseTime: 0,
                graceTotal: 0,
                activityStartIso: null,
              });
          const remoteRuntimeRunning = remoteRuntime.phase === 'running-work' || remoteRuntime.phase === 'running-break';
          const remoteGraceRawContext = remoteAccount.graceContext;
          const remoteGraceCandidateOpen = Boolean(remoteAccount.graceOpen);
          const remoteHasLegacyBreakGrace = remoteGraceRawContext === 'afterBreak' || (remoteGraceRawContext == null && remoteMode === 'break');
          const remoteGraceOpen = remoteGraceCandidateOpen && !remoteHasLegacyBreakGrace;
          const remoteGraceContext: 'afterWork' | null = remoteGraceOpen ? 'afterWork' : null;

          const updatedAccount: TimerPersistencePayload = {
              ...remoteAccount,
              ...merged,
              user: { ...response.user, lifetimeStats: mergedStats },
              userName: accountUsername,
              schemaVersion: DATA_SCHEMA_VERSION,
              runtime: remoteRuntime,
              activeMode: remoteMode,
              timerStarted: typeof remoteAccount.timerStarted === 'boolean' ? remoteAccount.timerStarted : remoteRuntimeRunning,
              isIdle: typeof remoteAccount.isIdle === 'boolean' ? remoteAccount.isIdle : remoteRuntime.phase === 'idle',
              allPauseActive: typeof remoteAccount.allPauseActive === 'boolean' ? remoteAccount.allPauseActive : remoteRuntime.phase === 'all-pause',
              allPauseTime: typeof remoteAccount.allPauseTime === 'number' ? remoteAccount.allPauseTime : 0,
              allPauseReason: typeof remoteAccount.allPauseReason === 'string' ? remoteAccount.allPauseReason : '',
              allPauseStartTime: remoteAccount.allPauseStartTime === null || typeof remoteAccount.allPauseStartTime === 'number'
                ? remoteAccount.allPauseStartTime
                : null,
              graceOpen: remoteGraceOpen,
              graceContext: remoteGraceContext,
              graceTotal: remoteGraceOpen && typeof remoteAccount.graceTotal === 'number' ? remoteAccount.graceTotal : 0,
              updatedAt: typeof remoteAccount.updatedAt === 'string' ? remoteAccount.updatedAt : new Date().toISOString(),
          };

          await saveAccountData(response.token, updatedAccount);
          localStorage.setItem(AUTH_TOKEN_KEY, response.token);
          setAuthToken(response.token);
          localStorage.setItem(getUserKey(accountUsername), JSON.stringify(updatedAccount));
          localStorage.setItem('doro_last_user', accountUsername);
          hasHydratedCloudForUserRef.current = accountUsername;
          setUserName(accountUsername);
          setLastAccountSyncAt(Date.now());
          setAccountSyncState('synced');
          setAccountSyncError(null);
          loadData(accountUsername);
          return true;
      } catch (error) {
          setAccountSyncState('error');
          setAccountSyncError(error instanceof Error ? error.message : 'Login failed.');
          return false;
      }
  };

  const logout = () => {
      const tokenToRevoke = authToken;
      if (tokenToRevoke) {
          void logoutAccount(tokenToRevoke).catch(() => {});
      }
      localStorage.removeItem(AUTH_TOKEN_KEY);
      setAuthToken(null);
      setAccountSyncState('idle');
      setAccountSyncError(null);
      setLastAccountSyncAt(null);
      hasHydratedCloudForUserRef.current = null;
      setUser(null);
      setUserName('');
      localStorage.removeItem('doro_last_user');
      loadData(); // Load Guest Data
  };

  useEffect(() => {
      if (!user || !authToken) return;
      if (hasHydratedCloudForUserRef.current === user.username) return;
      void refreshAccountFromCloud();
  }, [authToken, refreshAccountFromCloud, user]);

  useEffect(() => {
      if (!user || !authToken) return;
      const interval = setInterval(() => { void refreshAccountFromCloud({ force: false }); }, 12000);
      return () => clearInterval(interval);
  }, [authToken, refreshAccountFromCloud, user]);

  useEffect(() => {
      if (!user || !authToken) return;
      if (skipSaveRef.current || isApplyingCloudSnapshotRef.current) return;
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
      workTime,
      breakTime,
      activeMode,
      timerStarted,
      isIdle,
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
      syncAccountNow,
  ]);

  // Save Effect
  useEffect(() => {
    if (skipSaveRef.current || isCrossTabApplyingRef.current) return;
    const key = getActiveStorageKey();
    const userDataToSave = user ? { ...user } : null;
    const dataToSave: TimerPersistencePayload = {
      schemaVersion: DATA_SCHEMA_VERSION,
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
      isIdle,
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
      user: userDataToSave,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(key, JSON.stringify(dataToSave));
  }, [
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
    isIdle,
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
    user,
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
    const byPeer = new Map<string, DataConnection>();
    connectionsRef.current.forEach(conn => {
      if (!conn || !conn.peer || !conn.open) return;
      if (!byPeer.has(conn.peer)) byPeer.set(conn.peer, conn);
    });
    connectionsRef.current = Array.from(byPeer.values());
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
    if (!groupSessionId) return;
    const openConnections = pruneConnections();
    if (openConnections.length === 0) return;
    openConnections.forEach(conn => {
      if (conn.open && conn.peer !== excludeConnId) {
        conn.send({ type: 'GROUP_EVENT', event });
      }
    });
  }, [groupSessionId, pruneConnections]);

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

  const emitLocalGroupEvent = useCallback((type: GroupEventType, extras?: { mode?: TimerMode, reason?: string }) => {
    if (!groupSessionId) return;
    const actorId = localPeerIdRef.current;
    const actorName = userName.trim();
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
  }, [groupSessionId, userName, sendGroupEvent]);

  const getCurrentState = useCallback(() => {
    return {
       settings, tasks, categories, logs, activeMode, timerStarted, isIdle,
       workTime, breakTime, pomodoroCount, scheduleBreaks,
       scheduleStartTime, sessionStartTime, allPauseActive, allPauseTime,
       allPauseReason, allPauseStartTime, graceOpen, graceContext, graceTotal,
       runtime: runtimeRef.current,
       hostConfig: hostSyncConfigRef.current
    };
  }, [settings, tasks, categories, logs, activeMode, timerStarted, isIdle, workTime, breakTime, pomodoroCount, scheduleBreaks, scheduleStartTime, sessionStartTime, allPauseActive, allPauseTime, allPauseReason, allPauseStartTime, graceOpen, graceContext, graceTotal]);

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

      const remoteHostConfig = normalizeSyncConfig(remote.hostConfig, hostSyncConfigRef.current);
      const inboundBaseConfig = isHost
        ? hostSyncConfigRef.current
        : intersectSyncConfig(remoteHostConfig, clientSyncConfigRef.current);
      const config = mode === 'timer-only'
        ? { ...TIMER_ONLY_SYNC_CONFIG, syncTimers: inboundBaseConfig.syncTimers }
        : inboundBaseConfig;
      
      if (mode === 'full' && config.syncSettings && remote.settings) {
          setSettings(prev => ({
            ...DEFAULT_SETTINGS,
            ...remote.settings,
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
          if (typeof remote.workTime === 'number') setWorkTime(remote.workTime);
          if (typeof remote.breakTime === 'number') setBreakTime(remote.breakTime);
          if (remote.activeMode === 'work' || remote.activeMode === 'break') setActiveMode(remote.activeMode);
          if (typeof remote.timerStarted === 'boolean') setTimerStarted(remote.timerStarted);
          if (typeof remote.isIdle === 'boolean') setIsIdle(remote.isIdle);
          if (typeof remote.pomodoroCount === 'number') setPomodoroCount(remote.pomodoroCount);
          if (typeof remote.allPauseActive === 'boolean') setAllPauseActive(remote.allPauseActive);
          if (typeof remote.allPauseTime === 'number') setAllPauseTime(remote.allPauseTime);
          if (typeof remote.allPauseReason === 'string') setAllPauseReason(remote.allPauseReason);
          if (remote.allPauseStartTime === null || typeof remote.allPauseStartTime === 'number') setAllPauseStartTime(remote.allPauseStartTime ?? null);
          const remoteGraceRawContext = remote.graceContext;
          const remoteMode = remote.activeMode === 'work' || remote.activeMode === 'break' ? remote.activeMode : activeModeRef.current;
          const remoteGraceCandidateOpen = typeof remote.graceOpen === 'boolean' ? remote.graceOpen : false;
          const remoteHasLegacyBreakGrace = remoteGraceRawContext === 'afterBreak' || (remoteGraceRawContext == null && remoteMode === 'break');
          const remoteGraceOpen = remoteGraceCandidateOpen;
          const remoteGraceContext: 'afterWork' | null = remoteGraceOpen && !remoteHasLegacyBreakGrace ? 'afterWork' : null;
          if (typeof remote.graceOpen === 'boolean') setGraceOpen(remoteGraceOpen);
          if (remote.graceContext === 'afterWork' || remote.graceContext === 'afterBreak' || remote.graceContext === null) setGraceContext(remoteGraceContext);
          if (typeof remote.graceTotal === 'number') setGraceTotal(remoteGraceOpen && !remoteHasLegacyBreakGrace ? remote.graceTotal : 0);

          if (isRuntimeSnapshot(remote.runtime) && remote.runtime.updatedAtMs > lastRuntimeAppliedRef.current) {
              runtimeRef.current = remote.runtime;
              lastRuntimeAppliedRef.current = remote.runtime.updatedAtMs;
              currentActivityStartRef.current = remote.runtime.activityStartIso ? new Date(remote.runtime.activityStartIso) : null;
          }
      }
      if (!isHost && remote.hostConfig) {
          hostSyncConfigRef.current = remoteHostConfig;
          setHostSyncConfig(remoteHostConfig);
      }
      setTimeout(() => { isRemoteUpdate.current = false; }, 120);
  }, [isHost]);

  const broadcastState = useCallback((excludeConnId?: string) => {
      if (!groupSessionId) return;
      const openConnections = pruneConnections();
      if (openConnections.length === 0) return;
      const fullState = getCurrentState();

      if (isHost) {
          const filteredState = buildFilteredGroupState(fullState, hostSyncConfigRef.current);
          openConnections.forEach(conn => {
              if (conn.open && conn.peer !== excludeConnId) {
                  conn.send({ type: 'STATE_UPDATE', state: filteredState });
              }
          });
          return;
      }

      const outboundClientConfig = intersectSyncConfig(hostSyncConfigRef.current, clientSyncConfigRef.current);
      if (!outboundClientConfig.syncTimers) return;
      const roundedWork = Math.round(fullState.workTime * 10) / 10;
      const roundedBreak = Math.round(fullState.breakTime * 10) / 10;
      const clientTimerSignature = [
        runtimeRef.current.updatedAtMs,
        fullState.activeMode,
        fullState.timerStarted ? 1 : 0,
        fullState.isIdle ? 1 : 0,
        fullState.allPauseActive ? 1 : 0,
        fullState.allPauseReason || '',
        fullState.graceOpen ? 1 : 0,
        fullState.graceContext || '',
        fullState.pomodoroCount,
        fullState.timerStarted ? '' : roundedWork,
        fullState.timerStarted ? '' : roundedBreak,
      ].join('|');
      if (lastClientTimerBroadcastSignatureRef.current === clientTimerSignature) return;
      const timerState = buildFilteredGroupState(fullState, TIMER_ONLY_SYNC_CONFIG);
      let didSend = false;
      openConnections.forEach(conn => {
          if (conn.open && conn.peer !== excludeConnId) {
              conn.send({ type: 'TIMER_STATE', state: timerState });
              didSend = true;
          }
      });
      if (didSend) {
        lastClientTimerBroadcastSignatureRef.current = clientTimerSignature;
      }
  }, [groupSessionId, getCurrentState, isHost, buildFilteredGroupState, pruneConnections]);

  useEffect(() => {
     if(!groupSessionId || isRemoteUpdate.current) return;
     const t = setTimeout(() => { broadcastState(); }, 80);
     return () => clearTimeout(t);
  }, [tasks, settings, activeMode, timerStarted, isIdle, workTime, breakTime, scheduleBreaks, scheduleStartTime, sessionStartTime, pomodoroCount, allPauseActive, allPauseTime, allPauseReason, allPauseStartTime, graceOpen, graceContext, graceTotal, groupSessionId, broadcastState, hostSyncConfig, clientSyncConfig, isHost]);

  const updateMembersList = useCallback(() => {
      if (isHost) {
           const openConnections = pruneConnections();
           const memberList: GroupMember[] = [
               { id: 'host', name: userName, isHost: true },
               ...openConnections.map(c => ({ id: c.peer, name: (c.metadata as any)?.name || 'Member', isHost: false }))
           ];
           setMembers(memberList);
           openConnections.forEach(c => { if(c.open) c.send({ type: 'MEMBERS_UPDATE', members: memberList }); });
      }
  }, [isHost, userName, pruneConnections]);

  const createGroupSession = async (name: string, config: GroupSyncConfig): Promise<string> => {
      const normalizedConfig = normalizeSyncConfig(config, hostSyncConfigRef.current);
      if (groupSessionId || peerRef.current || connectionsRef.current.length > 0) {
          leaveGroupSession();
      }
      setUserName(name);
      hostSyncConfigRef.current = normalizedConfig;
      setHostSyncConfig(normalizedConfig);
      lastClientTimerBroadcastSignatureRef.current = null;

      return new Promise((resolve, reject) => {
          let settled = false;
          const timeoutId = setTimeout(() => {
              if (settled) return;
              settled = true;
              try { peerRef.current?.destroy(); } catch {}
              peerRef.current = null;
              connectionsRef.current = [];
              localPeerIdRef.current = null;
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
                settle(() => {
                  localPeerIdRef.current = id;
                  setGroupSessionId(id);
                  setIsHost(true);
                  setPeerError(null);
                  setMembers([{ id, name, isHost: true }]);
                  resolve(id);
                });
            });

            peer.on('connection', (conn: DataConnection) => {
                connectionsRef.current = connectionsRef.current.filter(existing => {
                  if (existing.peer !== conn.peer) return true;
                  try { existing.close(); } catch {}
                  return false;
                });
                connectionsRef.current.push(conn);

                conn.on('open', () => {
                  connectionsRef.current = connectionsRef.current.filter(existing => existing.peer !== conn.peer);
                  connectionsRef.current.push(conn);
                  const initialState = buildFilteredGroupState(getCurrentState(), hostSyncConfigRef.current);
                  conn.send({ type: 'STATE_UPDATE', state: initialState });
                  const joinEvent = normalizeGroupEventPayload({
                    type: 'joined',
                    actorId: conn.peer,
                    actorName: (conn.metadata as any)?.name || 'Member',
                    at: Date.now(),
                  }, conn.peer, (conn.metadata as any)?.name || 'Member');
                  if (joinEvent) {
                    postGroupNotice(joinEvent);
                    sendGroupEvent(joinEvent);
                  }
                  updateMembersList();
                });

                conn.on('data', (data: any) => {
                    if (!data || typeof data !== 'object') return;
                    if (data.type === 'GROUP_EVENT') {
                        const forwardedEvent = normalizeGroupEventPayload({
                          ...(data.event || {}),
                          actorId: conn.peer,
                          actorName: (conn.metadata as any)?.name || 'Member',
                        }, conn.peer, (conn.metadata as any)?.name || 'Member');
                        if (forwardedEvent) {
                            postGroupNotice(forwardedEvent);
                            sendGroupEvent(forwardedEvent, conn.peer);
                        }
                        return;
                    }
                    if (data.type === 'TIMER_STATE' && data.state && hostSyncConfigRef.current.syncTimers) {
                        const timerState = buildFilteredGroupState(data.state, TIMER_ONLY_SYNC_CONFIG);
                        applyRemoteState(timerState, 'timer-only');
                        pruneConnections().forEach(peerConn => {
                            if (peerConn.open && peerConn.peer !== conn.peer) {
                                peerConn.send({ type: 'TIMER_STATE', state: timerState });
                            }
                        });
                        return;
                    }
                    // Backward compatibility for older clients that still send STATE_UPDATE.
                    if (data.type === 'STATE_UPDATE' && data.state && hostSyncConfigRef.current.syncTimers) {
                        const timerState = buildFilteredGroupState(data.state, TIMER_ONLY_SYNC_CONFIG);
                        applyRemoteState(timerState, 'timer-only');
                        pruneConnections().forEach(peerConn => {
                            if (peerConn.open && peerConn.peer !== conn.peer) {
                                peerConn.send({ type: 'TIMER_STATE', state: timerState });
                            }
                        });
                    }
                });

                conn.on('error', () => {
                  connectionsRef.current = connectionsRef.current.filter(c => c.peer !== conn.peer);
                  updateMembersList();
                });

                conn.on('close', () => {
                  connectionsRef.current = connectionsRef.current.filter(c => c.peer !== conn.peer);
                  updateMembersList();
                });
            });

            peer.on('error', (err: any) => {
                const message = err?.type === 'unavailable-id'
                  ? "Session ID collision. Try again."
                  : `Connection Error: ${err?.type || 'unknown'}`;
                if (!settled) {
                  settle(() => {
                    try { peer.destroy(); } catch {}
                    peerRef.current = null;
                    connectionsRef.current = [];
                    localPeerIdRef.current = null;
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
      if (groupSessionId || peerRef.current || connectionsRef.current.length > 0) {
          leaveGroupSession();
      }
      setUserName(name);
      clientSyncConfigRef.current = normalizedConfig;
      setClientSyncConfig(normalizedConfig);
      lastClientTimerBroadcastSignatureRef.current = null;

      return new Promise((resolve, reject) => {
          let settled = false;
          let conn: DataConnection | null = null;
          const timeoutId = setTimeout(() => {
              if (settled) return;
              settled = true;
              try { conn?.close(); } catch {}
              try { peerRef.current?.destroy(); } catch {}
              peerRef.current = null;
              connectionsRef.current = [];
              localPeerIdRef.current = null;
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

          try {
            // @ts-ignore
            const peer = new Peer();
            peerRef.current = peer;
            peer.on('open', (id: string) => {
                localPeerIdRef.current = id;
                setGroupSessionId(sessionId);
                setIsHost(false);
                setPeerError(null);
                conn = peer.connect(sessionId, { metadata: { name } });
                connectionsRef.current = [conn];
                conn.on('open', () => {
                  connectionsRef.current = [conn!];
                  succeed();
                });
                conn.on('data', (data: any) => {
                    if (!data || typeof data !== 'object') return;
                    if (data.type === 'STATE_UPDATE') applyRemoteState(data.state, 'full');
                    else if (data.type === 'TIMER_STATE') applyRemoteState(data.state, 'timer-only');
                    else if (data.type === 'MEMBERS_UPDATE') setMembers(data.members);
                    else if (data.type === 'GROUP_EVENT') {
                      const remoteEvent = normalizeGroupEventPayload(data.event);
                      if (remoteEvent) postGroupNotice(remoteEvent);
                    }
                });
                conn.on('error', (err: any) => {
                  const message = `Unable to connect to host (${err?.type || 'error'}).`;
                  if (!settled) {
                    fail(message, err instanceof Error ? err : new Error(message));
                    return;
                  }
                  leaveGroupSession({ reason: message, preserveConfigs: true });
                });
                conn.on('close', () => {
                  const message = "Disconnected from Host";
                  if (!settled) {
                    fail(message, new Error(message));
                    return;
                  }
                  leaveGroupSession({ reason: message, preserveConfigs: true });
                });
            });
            peer.on('error', (err: any) => {
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
      if (peerRef.current) { try { peerRef.current.destroy(); } catch {} peerRef.current = null; }
      connectionsRef.current.forEach(conn => { try { conn.close(); } catch {} });
      connectionsRef.current = [];
      lastClientTimerBroadcastSignatureRef.current = null;
      localPeerIdRef.current = null;
      setGroupNotice(null);
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
    const entry: LogEntry = {
      type, start: start.toISOString(), end: new Date().toISOString(),
      duration, reason, task: selectedTask ? { id: selectedTask.id, name: selectedTask.name } : null,
      color: currentContext.color,
      categoryId: selectedTask ? selectedTask.categoryId : null
    };
    setLogs(prev => [entry, ...prev]);
  }, [tasks]);

  const sendNotification = useCallback((title: string, body: string) => {
    if ("Notification" in window) {
       if (Notification.permission === "granted") {
           try {
             new Notification(title, { body, icon: '/favicon.ico', tag: 'lumina-timer', requireInteraction: true, vibrate: [200, 100, 200] } as any);
           } catch(e) { console.error(e); }
       } else if (Notification.permission !== "denied") {
           Notification.requestPermission().then(p => { if (p === "granted") new Notification(title, { body, icon: '/favicon.ico', tag: 'lumina-timer' }); });
       }
    }
    if (typeof navigator !== 'undefined' && "vibrate" in navigator) navigator.vibrate([200, 100, 200, 100, 200]);
  }, []);

  const handleWorkLoopComplete = useCallback((initialGraceSeconds: number = 0) => {
    if (isProcessingRef.current) return;
    const now = Date.now();
    if (now - lastLoopTimeRef.current < 5000) return; 
    
    isProcessingRef.current = true;
    lastLoopTimeRef.current = now;
    playAlarm(settings.alarmSound);
    
    const completion = computeWorkCompletion(pomodoroCount, breakTime, settings);

    setBreakTime(completion.nextBreakTime);
    setPomodoroCount(completion.nextPomoCount);
    setWorkTime(0);

    if (currentActivityStartRef.current) {
      logActivity('work', currentActivityStartRef.current, settings.workDuration, 'Pomodoro Complete');
      currentActivityStartRef.current = null; 
    }
    
    setTasks(prevTasks => {
        const selected = findSelectedTask(prevTasks);
        if (!selected) return prevTasks;
        const todayKey = getDateKey(new Date());
        if (isDeferredTaskFromToday(selected, todayKey)) return prevTasks;
        
        let updatedTasks = incrementCompletedInTree(prevTasks, selected.id);
        
        const updatedSelected = findSelectedTask(updatedTasks);
        if (updatedSelected) {
             if (updatedSelected.completed === updatedSelected.estimated) {
                 updatedTasks = updateTaskInTree(updatedTasks, { ...updatedSelected, checked: true });
                 sendNotification("Goal Reached", `${updatedSelected.name} goal met. Continuing...`);
             }
        }
        
        return updatedTasks;
    });

    sendNotification(completion.isLongBreak ? "Long Break Earned!" : "Focus Session Complete", `${Math.floor(completion.reward/60)} minutes added to break bank.`);
    setTimerStarted(false);
    setGraceContext('afterWork');
    setGraceTotal(initialGraceSeconds);
    setGraceOpen(true);
    anchorRuntimePhase('grace', {
      phaseStartWorkTime: 0,
      phaseStartBreakTime: completion.nextBreakTime,
      phaseStartGraceTotal: initialGraceSeconds,
      activityStartIso: null,
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
      return;
    }

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
    handleWorkLoopComplete,
  ]);

  const tick = useCallback(() => {
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
  }, [legacyRuntimeMode, legacyTick, reconcileFromRuntime, timerStarted, isIdle, isDevMode]);

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
    if (typeof payload.isIdle === 'boolean') setIsIdle(payload.isIdle);
    else setIsIdle(runtime.phase === 'idle');
    if (typeof payload.pomodoroCount === 'number') setPomodoroCount(payload.pomodoroCount);
    if (typeof payload.allPauseActive === 'boolean') setAllPauseActive(payload.allPauseActive);
    else setAllPauseActive(runtime.phase === 'all-pause');
    if (typeof payload.allPauseTime === 'number') setAllPauseTime(payload.allPauseTime);
    if (typeof payload.allPauseReason === 'string') setAllPauseReason(payload.allPauseReason);
    if (payload.allPauseStartTime === null || typeof payload.allPauseStartTime === 'number') setAllPauseStartTime(payload.allPauseStartTime ?? null);
    const payloadGraceRawContext = payload.graceContext;
    const payloadMode = payload.activeMode === 'work' || payload.activeMode === 'break' ? payload.activeMode : runtimeMode;
    const payloadGraceCandidateOpen = typeof payload.graceOpen === 'boolean' ? payload.graceOpen : runtime.phase === 'grace';
    const payloadHasLegacyBreakGrace = payloadGraceRawContext === 'afterBreak' || (payloadGraceRawContext == null && payloadMode === 'break');
    const payloadGraceOpen = payloadGraceCandidateOpen;
    const payloadGraceContext: 'afterWork' | null = payloadGraceOpen && !payloadHasLegacyBreakGrace ? 'afterWork' : null;
    setGraceOpen(payloadGraceOpen);
    if (payload.graceContext === 'afterWork' || payload.graceContext === 'afterBreak' || payload.graceContext === null) setGraceContext(payloadGraceContext);
    if (typeof payload.graceTotal === 'number') setGraceTotal(payloadGraceOpen && !payloadHasLegacyBreakGrace ? payload.graceTotal : 0);
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
    if (!sessionStartTime) {
        const now = new Date();
        setSessionStartTime(now.toISOString());
        const h = now.getHours().toString().padStart(2, '0');
        const m = now.getMinutes().toString().padStart(2, '0');
        setScheduleStartTime(`${h}:${m}`);
    }
    if (isIdle) setIsIdle(false);
    const activityStart = opts?.forceActivityStart || currentActivityStartRef.current || new Date();
    currentActivityStartRef.current = activityStart;
    setTimerStarted(true);
    lastTickRef.current = Date.now();
    anchorRuntimePhase((opts?.mode || activeMode) === 'work' ? 'running-work' : 'running-break', {
      phaseStartWorkTime: opts?.workOverride ?? workTime,
      phaseStartBreakTime: opts?.breakOverride ?? breakTime,
      activityStartIso: activityStart.toISOString(),
    });
    if (opts?.playSound !== false) playSwitch();
  };

  useEffect(() => {
    // Grace is only valid after work completion; any other context is stale and should continue break immediately.
    if (!graceOpen || graceContext === 'afterWork') return;
    setGraceOpen(false);
    setGraceContext(null);
    setGraceTotal(0);
    setActiveMode('break');
    setIsIdle(false);
    const now = new Date();
    currentActivityStartRef.current = now;
    startTimerInternal({
      mode: 'break',
      workOverride: workTime,
      breakOverride: breakTime,
      forceActivityStart: now,
      playSound: false,
      forceStart: true,
    });
  }, [graceOpen, graceContext, workTime, breakTime]);

  const startTimer = () => {
    if (timerStarted) return;
    startTimerInternal();
    emitLocalGroupEvent('timer-started');
  };

  const stopTimer = (opts?: { silentGroupEvent?: boolean }) => {
    setTimerStarted(false);
    anchorRuntimePhase('idle');
    if (!opts?.silentGroupEvent) emitLocalGroupEvent('timer-stopped');
  };
  const toggleTimer = () => timerStarted ? stopTimer() : startTimer();

  const performSwitch = (targetMode: TimerMode) => {
    playSwitch();
    if (!isIdle && currentActivityStartRef.current) {
        const duration = (Date.now() - currentActivityStartRef.current.getTime()) / 1000;
        logActivity(activeMode, currentActivityStartRef.current, duration, 'Switch');
    }
    setActiveMode(targetMode);
    setIsIdle(false);
    setGraceOpen(false);
    setGraceContext(null);
    currentActivityStartRef.current = new Date();
    setTimerStarted(true);
    lastTickRef.current = Date.now();
    anchorRuntimePhase(targetMode === 'work' ? 'running-work' : 'running-break', {
      activityStartIso: currentActivityStartRef.current.toISOString(),
    });
    emitLocalGroupEvent('mode-switched', { mode: targetMode });
  };

  const activateMode = (mode: TimerMode) => {
    if (isIdle) performSwitch(mode);
    else if (activeMode !== mode) performSwitch(mode);
    else if (!timerStarted) { startTimer(); playSwitch(); }
  };

  const switchMode = () => performSwitch(activeMode === 'work' ? 'break' : 'work');

  const restartActiveTimer = (customSeconds?: number) => {
    stopTimer({ silentGroupEvent: true });
    const nextWorkTime = activeMode === 'work' ? (customSeconds !== undefined ? customSeconds : settings.workDuration) : workTime;
    const nextBreakTime = activeMode === 'break' ? (customSeconds !== undefined ? customSeconds : breakTime) : breakTime;
    if (activeMode === 'work') setWorkTime(nextWorkTime);
    else setBreakTime(nextBreakTime);
    setGraceOpen(false);
    setIsIdle(false);
    const now = new Date();
    currentActivityStartRef.current = now;
    setTimerStarted(true);
    lastTickRef.current = now.getTime();
    anchorRuntimePhase(activeMode === 'work' ? 'running-work' : 'running-break', {
      phaseStartWorkTime: nextWorkTime,
      phaseStartBreakTime: nextBreakTime,
      activityStartIso: now.toISOString(),
    });
    emitLocalGroupEvent('timer-reset', { mode: activeMode });
  };

  const startAllPause = () => {};
  const confirmAllPause = (reason: string) => {
    stopTimer({ silentGroupEvent: true });
    const pauseStart = Date.now();
    setAllPauseReason(reason);
    setAllPauseStartTime(pauseStart);
    setAllPauseTime(0);
    setAllPauseActive(true);
    anchorRuntimePhase('all-pause', {
      phaseStartAllPauseTime: 0,
      activityStartIso: null,
    });
    emitLocalGroupEvent('timer-paused', { reason: reason || undefined });
  };

  const endAllPause = () => {
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
    if (options && options.adjustBreakBalance !== undefined) {
      nextBreakTime = breakTime - (options.adjustBreakBalance || 0);
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

  const endSession = () => {
    let pendingActiveDuration = 0;
    let pendingActiveMode: TimerMode | null = null;
    let pendingActiveCategoryId: number | null | undefined = null;
    let pendingActiveStartIso: string | null = null;
    if (!isIdle && currentActivityStartRef.current) {
      const elapsed = (Date.now() - currentActivityStartRef.current.getTime()) / 1000;
      if (Number.isFinite(elapsed) && elapsed > 0.5) {
        pendingActiveDuration = elapsed;
        pendingActiveMode = activeMode;
        pendingActiveCategoryId = activeTask?.categoryId;
        pendingActiveStartIso = currentActivityStartRef.current.toISOString();
        logActivity(activeMode, currentActivityStartRef.current, elapsed, 'Session End', activeTask || undefined);
      }
    }

    stopTimer({ silentGroupEvent: true });
    setAllPauseActive(false);
    const sessionFloor = sessionStartTime || '';
    const workLogs = logs.filter((l) => l.type === 'work' && l.start >= sessionFloor && !isPauseCreditedWorkLog(l));
    const breakLogs = logs.filter((l) => l.type === 'break' && l.start >= sessionFloor);
    const pendingWorkSeconds = pendingActiveMode === 'work' ? pendingActiveDuration : 0;
    const pendingBreakSeconds = pendingActiveMode === 'break' ? pendingActiveDuration : 0;
    const totalWork = (workLogs.reduce((acc, l) => acc + l.duration, 0) + pendingWorkSeconds) / 60;
    const totalBreak = (breakLogs.reduce((acc, l) => acc + l.duration, 0) + pendingBreakSeconds) / 60;
    const completedTasksCount = flattenTasks(tasks).filter(t => t.checked).length;
    
    // Calculate Category Stats
    const catStats: Record<string, number> = {};
    workLogs.forEach(l => {
        const minutes = l.duration / 60;
        if (typeof l.categoryId === 'number') {
          const cat = categories.find(c => c.id === l.categoryId);
          const key = cat?.name || 'Uncategorized';
          catStats[key] = (catStats[key] || 0) + minutes;
        } else {
          catStats.Uncategorized = (catStats.Uncategorized || 0) + minutes;
        }
    });
    if (pendingWorkSeconds > 0 && typeof pendingActiveCategoryId === 'number') {
      const cat = categories.find(c => c.id === pendingActiveCategoryId);
      const key = cat?.name || 'Uncategorized';
      catStats[key] = (catStats[key] || 0) + (pendingWorkSeconds / 60);
    } else if (pendingWorkSeconds > 0) {
      catStats.Uncategorized = (catStats.Uncategorized || 0) + (pendingWorkSeconds / 60);
    }

    // Archive Session
    if (sessionStartTime) {
        const record: SessionRecord = {
            id: Date.now().toString(),
            startTime: sessionStartTime,
            endTime: new Date().toISOString(),
            stats: {
                totalWorkMinutes: totalWork,
                totalBreakMinutes: totalBreak,
                pomosCompleted: pomodoroCount,
                tasksCompleted: completedTasksCount,
                categoryStats: catStats
            }
        };
        
        setPastSessions(prev => [record, ...prev]);

        // Recalculate lifetime stats from canonical history each time.
        if (user) {
            setUser(prev => {
                if (!prev) return null;
                const pendingSessionLogs = pendingActiveDuration > 0
                  ? [{
                      type: pendingActiveMode === 'work' ? 'work' : 'break',
                      start: pendingActiveStartIso || new Date().toISOString(),
                      end: new Date().toISOString(),
                      duration: pendingActiveDuration,
                      reason: 'Session End',
                      task: activeTask ? { id: activeTask.id, name: activeTask.name } : null,
                      color: activeColor,
                      categoryId: pendingActiveCategoryId ?? null,
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
        tasksCompleted: completedTasksCount, pomosCompleted: pomodoroCount,
        categoryStats: catStats
    });

    setTasks(prev => removeCompletedTasks(prev)); 
    setPomodoroCount(0);
    setWorkTime(settings.workDuration);
    setBreakTime(0);
    setIsIdle(true);
    setTimerStarted(false);
    setGraceOpen(false);
    setGraceContext(null);
    setSessionStartTime(null);
    currentActivityStartRef.current = null;
    
    const now = new Date();
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    setScheduleStartTime(`${h}:${m}`);
    anchorRuntimePhase('idle', {
      phaseStartWorkTime: settings.workDuration,
      phaseStartBreakTime: 0,
      phaseStartAllPauseTime: 0,
      phaseStartGraceTotal: 0,
      activityStartIso: null,
    });
    
    setShowSummary(true);
  };

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
      setGraceOpen(false);
      setGraceContext(null);
      setSessionStartTime(null);
      setScheduleBreaks([]);
      setSessionStats(null);
      setShowSummary(false);
      leaveGroupSession();
      const now = new Date();
      const h = now.getHours().toString().padStart(2, '0');
      const m = now.getMinutes().toString().padStart(2, '0');
      setScheduleStartTime(`${h}:${m}`);
      currentActivityStartRef.current = null;
      lastTickRef.current = null;
      workerRef.current?.postMessage('stop');
      anchorRuntimePhase('idle', {
        phaseStartWorkTime: DEFAULT_SETTINGS.workDuration,
        phaseStartBreakTime: 0,
        phaseStartAllPauseTime: 0,
        phaseStartGraceTotal: 0,
        activityStartIso: null,
      });
  };

  const addTask = (name: string, estimated: number, catId: number | null, parentId?: number, color?: string, isFuture?: boolean, scheduledStart?: string, scheduledDate?: string) => {
    const todayKey = getDateKey(new Date());
    const deferred = Boolean(isFuture) || (typeof scheduledDate === 'string' && scheduledDate > todayKey);
    const newTask: Task = {
      id: createTaskId(), name, estimated, completed: 0, checked: false,
      selected: tasks.length === 0 && !parentId && !deferred, categoryId: catId, subtasks: [], isExpanded: true, color: color || undefined, isFuture, scheduledStart, scheduledDate
    };
    if (parentId) setTasks(prev => addTaskToTree(prev, parentId, newTask));
    else setTasks(prev => [...prev, newTask]);
  };

  const addDetailedTask = (taskProps: Partial<Task> & { name: string, estimated: number }) => {
      const todayKey = getDateKey(new Date());
      const deferred = Boolean(taskProps.isFuture) || (typeof taskProps.scheduledDate === 'string' && taskProps.scheduledDate > todayKey);
      const newTask: Task = {
        id: createTaskId(), name: taskProps.name, estimated: taskProps.estimated, completed: 0, checked: false,
        selected: tasks.length === 0 && !deferred, categoryId: taskProps.categoryId || null, subtasks: taskProps.subtasks || [], isExpanded: true, color: taskProps.color,
        isFuture: taskProps.isFuture, scheduledStart: taskProps.scheduledStart, scheduledDate: taskProps.scheduledDate
      };
      setTasks(prev => [...prev, newTask]);
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

  const addCategory = (name: string, color: string, icon: string) => setCategories(prev => [...prev, { id: Date.now(), name, color, icon }]);
  const updateCategory = (cat: Category) => setCategories(prev => prev.map(c => c.id === cat.id ? cat : c));
  const deleteCategory = (id: number) => {
    setCategories(prev => prev.filter(c => c.id !== id));
    if (selectedCategoryId === id) setSelectedCategoryId(null);
  };

  const addScheduleBreak = (brk: ScheduleBreak) => setScheduleBreaks(prev => [...prev, brk].sort((a,b) => a.startTime.localeCompare(b.startTime)));
  const deleteScheduleBreak = (id: string) => setScheduleBreaks(prev => prev.filter(b => b.id !== id));

  const updateSettings = (newSettings: TimerSettings) => {
    setSettings(newSettings);
    if (!timerStarted && activeMode === 'work') {
      setWorkTime(newSettings.workDuration);
      if (!allPauseActive && !graceOpen) {
        anchorRuntimePhase('idle', { phaseStartWorkTime: newSettings.workDuration });
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
      isScheduleOpen, setScheduleOpen, isWeeklyScheduleOpen, setWeeklyScheduleOpen,
      activeTask, activeColor, showSummary, sessionStats,
      groupSessionId, userName, isHost, peerError, members, hostSyncConfig, clientSyncConfig, pendingJoinId, groupNotice,
      accountSyncState, accountSyncError, lastAccountSyncAt,
      login, logout, register, syncAccountNow, refreshAccountFromCloud,
      startTimer, stopTimer, toggleTimer, switchMode, activateMode,
      startAllPause, confirmAllPause, endAllPause, resumeFromPause, restartActiveTimer, resolveGrace, endSession, closeSummary, hardReset,
      createGroupSession, joinGroupSession, leaveGroupSession, updateHostSyncConfig, setPendingJoinId,
      addTask, addDetailedTask, addSubtasksToTask, updateTask, deleteTask, selectTask, toggleTaskExpansion, moveTask, moveSubtask, splitTask,
      toggleTaskFuture, setTaskSchedule,
      addCategory, updateCategory, deleteCategory, selectCategory: setSelectedCategoryId,
      addScheduleBreak, deleteScheduleBreak, setScheduleStartTime,
      updateSettings, clearLogs, resetTimers, setPomodoroCount
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
