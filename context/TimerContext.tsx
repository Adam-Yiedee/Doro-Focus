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

  // Actions
  login: (username: string, password?: string) => Promise<boolean>;
  register: (username: string, password?: string) => Promise<boolean>;
  logout: () => void;
  exportData: () => string;
  importData: (jsonStr: string) => boolean;
  startMigrationHost: () => Promise<string>;
  joinMigration: (code: string) => Promise<void>;
  
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
const MOCK_CLOUD_DB_KEY = 'doro_mock_cloud_db';

// Mock Cloud Helpers
const getCloudDB = () => {
    try {
        return JSON.parse(localStorage.getItem(MOCK_CLOUD_DB_KEY) || '{}');
    } catch { return {}; }
};

const saveCloudDB = (db: any) => {
    localStorage.setItem(MOCK_CLOUD_DB_KEY, JSON.stringify(db));
};

const DEFAULT_SETTINGS: TimerSettings = {
  workDuration: 1500, 
  shortBreakDuration: 300, 
  longBreakDuration: 900,
  longBreakInterval: 4, 
  disableBlur: false,
  alarmSound: 'bell',
  themeMode: 'dark'
};

const DEFAULT_SYNC_CONFIG: GroupSyncConfig = {
    syncTimers: true,
    syncTasks: true,
    syncSchedule: true,
    syncHistory: false,
    syncSettings: true
};

const DATA_SCHEMA_VERSION = 2;
const LEGACY_RUNTIME_FLAG = 'doro_use_legacy_tick';
const CROSS_TAB_CHANNEL = 'doro_timer_sync';

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
}

const isRuntimeSnapshot = (value: any): value is TimerRuntimeSnapshot => {
  return !!value && typeof value === 'object' && value.version === TIMER_RUNTIME_VERSION && typeof value.updatedAtMs === 'number' && typeof value.phase === 'string';
};

export const TimerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isDevMode = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const [user, setUser] = useState<User | null>(null);
  
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
  
  const isRemoteUpdate = useRef(false);
  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<DataConnection[]>([]);
  const migrationPeerRef = useRef<Peer | null>(null);

  const lastTickRef = useRef<number | null>(null);
  const shadowTickRef = useRef<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const currentActivityStartRef = useRef<Date | null>(null);
  const lastLoopTimeRef = useRef<number>(0);
  const isProcessingRef = useRef(false);
  const previousLegacyBreakTimeRef = useRef<number>(breakTime);
  const skipSaveRef = useRef(false);
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
            setSettings({ ...DEFAULT_SETTINGS, ...(parsed.settings || {}) });
            setTasks(parsed.tasks || []);
            setPastSessions(parsed.pastSessions || []);
            setCategories(parsed.categories || []);
            setLogs(parsed.logs || []);
            setPomodoroCount(parsed.pomodoroCount || 0);
            setScheduleBreaks(parsed.scheduleBreaks || []);
            const nextBreakTime = parsed.breakTime !== undefined ? parsed.breakTime : 0;
            const nextWorkTime = parsed.workTime !== undefined ? parsed.workTime : DEFAULT_SETTINGS.workDuration;
            setBreakTime(nextBreakTime);
            setWorkTime(nextWorkTime);
            setActiveMode(parsed.activeMode || 'work');
            setIsIdle(parsed.isIdle !== undefined ? parsed.isIdle : true);
            
            if (username && parsed.user) {
                // Ensure streak properties exist
                const u = parsed.user;
                if (!u.lifetimeStats.currentStreak) u.lifetimeStats.currentStreak = 0;
                if (!u.lifetimeStats.bestStreak) u.lifetimeStats.bestStreak = 0;
                if (!u.lifetimeStats.categoryBreakdown) u.lifetimeStats.categoryBreakdown = {};
                setUser(u);
            } else if (username) {
                 // Recover user structure if missing
                 setUser({ 
                     username, 
                     joinedAt: new Date().toISOString(), 
                     lifetimeStats: { totalFocusHours: 0, totalPomos: 0, totalSessions: 0, currentStreak: 0, bestStreak: 0, lastActiveDate: null, categoryBreakdown: {} } 
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
                setGraceOpen(parsed.graceOpen !== undefined ? Boolean(parsed.graceOpen) : parsed.runtime.phase === 'grace');
                setGraceContext(parsed.graceContext || null);
                setGraceTotal(parsed.graceTotal || 0);
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
                  lifetimeStats: { totalFocusHours: 0, totalPomos: 0, totalSessions: 0, currentStreak: 0, bestStreak: 0, lastActiveDate: null, categoryBreakdown: {} } 
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
      if (lastUser) {
          loadData(lastUser);
      } else {
          loadData();
      }
  }, [loadData]);

  // Auth Methods with Sync Logic
  const calculateLifetimeStats = (sessions: SessionRecord[], currentLogs: LogEntry[], joinedAt: string) => {
       const totalWorkMins = currentLogs.filter(l => l.type === 'work').reduce((acc, l) => acc + (l.duration / 60), 0);
       const totalSessions = sessions.length;
       const totalPomos = sessions.reduce((acc, s) => acc + (s.stats?.pomosCompleted || 0), 0);
       
       // Calculate Categories
       const catStats: Record<string, number> = {};
       sessions.forEach(s => {
           if (s.stats?.categoryStats) {
               Object.entries(s.stats.categoryStats).forEach(([k, v]) => {
                   catStats[k] = (catStats[k] || 0) + v;
               });
           }
       });

       // Calculate Streak
       let currentStreak = 0;
       let bestStreak = 0;
       const dates = new Set(sessions.map(s => s.startTime.split('T')[0]).concat(currentLogs.map(l => l.start.split('T')[0])));
       const sortedDates = Array.from(dates).sort();
       
       // Simple streak calc for demo
       if (sortedDates.length > 0) {
           currentStreak = 1;
           bestStreak = 1;
           let tempStreak = 1;
           for (let i = 1; i < sortedDates.length; i++) {
               const prev = new Date(sortedDates[i-1]);
               const curr = new Date(sortedDates[i]);
               const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 3600 * 24);
               if (Math.round(diffDays) === 1) {
                   tempStreak++;
               } else {
                   tempStreak = 1;
               }
               if (tempStreak > bestStreak) bestStreak = tempStreak;
           }
           // Check if current streak is active (today or yesterday)
           const today = new Date().toISOString().split('T')[0];
           const lastDate = sortedDates[sortedDates.length - 1];
           const diffToToday = (new Date(today).getTime() - new Date(lastDate).getTime()) / (1000 * 3600 * 24);
           if (diffToToday <= 1) currentStreak = tempStreak;
           else currentStreak = 0;
       }

       return {
           totalFocusHours: totalWorkMins / 60,
           totalPomos,
           totalSessions,
           currentStreak,
           bestStreak,
           lastActiveDate: sortedDates.pop() || null,
           categoryBreakdown: catStats
       };
  };

  const mergeData = (localData: any, remoteData: any) => {
      // 1. Logs: Union by start time + type
      const logMap = new Map();
      remoteData.logs?.forEach((l: LogEntry) => logMap.set(l.start + l.type, l));
      localData.logs?.forEach((l: LogEntry) => logMap.set(l.start + l.type, l));
      const mergedLogs = Array.from(logMap.values()).sort((a: any, b: any) => new Date(b.start).getTime() - new Date(a.start).getTime());

      // 2. Tasks: Union by ID (Local wins if collision to preserve recent edits)
      const taskMap = new Map();
      const flatten = (arr: Task[]) => {
          arr.forEach(t => {
              taskMap.set(t.id, t);
              if (t.subtasks && t.subtasks.length > 0) flatten(t.subtasks);
          });
      }
      // Simple merge: Just top level lists, assuming tasks don't move deep in hierarchy often for this use case
      // A better approach for this simplified mock:
      const mergedTaskMap = new Map();
      remoteData.tasks?.forEach((t: Task) => mergedTaskMap.set(t.id, t));
      localData.tasks?.forEach((t: Task) => mergedTaskMap.set(t.id, t));
      const mergedTasks = Array.from(mergedTaskMap.values());

      // 3. Sessions: Union by ID
      const sessionMap = new Map();
      remoteData.pastSessions?.forEach((s: SessionRecord) => sessionMap.set(s.id, s));
      localData.pastSessions?.forEach((s: SessionRecord) => sessionMap.set(s.id, s));
      const mergedSessions = Array.from(sessionMap.values()).sort((a: any, b: any) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

      // 4. Categories
      const catMap = new Map();
      remoteData.categories?.forEach((c: Category) => catMap.set(c.id, c));
      localData.categories?.forEach((c: Category) => catMap.set(c.id, c));
      const mergedCategories = Array.from(catMap.values());

      // 5. Settings: Local takes precedence for user comfort on this device
      const mergedSettings = { ...DEFAULT_SETTINGS, ...remoteData.settings, ...localData.settings };

      return {
          logs: mergedLogs,
          tasks: mergedTasks,
          pastSessions: mergedSessions,
          categories: mergedCategories,
          settings: mergedSettings
      };
  };

  const register = async (username: string, password?: string): Promise<boolean> => {
      // Simulate Network Delay
      await new Promise(r => setTimeout(r, 800));
      
      const db = getCloudDB();
      if (db[username]) return false; // Already exists

      // Grab current Guest Data to merge/push
      const guestKey = getGuestKey();
      const guestData = JSON.parse(localStorage.getItem(guestKey) || '{}');

      // Create new user record
      const joinedAt = new Date().toISOString();
      const initialStats = calculateLifetimeStats(guestData.pastSessions || [], guestData.logs || [], joinedAt);

      const newUser: User = {
          username,
          password, 
          joinedAt,
          lifetimeStats: initialStats
      };

      const seedWorkTime = guestData.workTime ?? DEFAULT_SETTINGS.workDuration;
      const seedBreakTime = guestData.breakTime ?? 0;
      const seedRuntime = createRuntimeSnapshot({
        sourceTabId: tabIdRef.current,
        phase: 'idle',
        nowMs: Date.now(),
        workTime: seedWorkTime,
        breakTime: seedBreakTime,
        allPauseTime: 0,
        graceTotal: 0,
        activityStartIso: null,
      });

      const accountData = {
          schemaVersion: DATA_SCHEMA_VERSION,
          runtime: seedRuntime,
          user: newUser,
          settings: { ...DEFAULT_SETTINGS, ...(guestData.settings || {}) },
          tasks: guestData.tasks || [],
          logs: guestData.logs || [],
          pastSessions: guestData.pastSessions || [],
          categories: guestData.categories || [],
          workTime: seedWorkTime,
          breakTime: seedBreakTime,
          activeMode: 'work',
          timerStarted: false,
          isIdle: true,
          allPauseActive: false,
          allPauseTime: 0,
          graceOpen: false,
          graceContext: null,
          graceTotal: 0
      };

      // Save to Cloud
      db[username] = accountData;
      saveCloudDB(db);
      
      // Save to Local User Cache
      const key = getUserKey(username);
      localStorage.setItem(key, JSON.stringify(accountData));

      // Set Active
      localStorage.setItem('doro_last_user', username);
      setUserName(username);
      loadData(username);
      
      return true;
  };

  const login = async (username: string, password?: string): Promise<boolean> => {
      // Simulate Network
      await new Promise(r => setTimeout(r, 800));

      const db = getCloudDB();
      const remoteAccount = db[username];
      
      if (!remoteAccount) return false;
      if (remoteAccount.user?.password && remoteAccount.user.password !== password) return false;

      // Get Local Guest Data (to merge)
      const guestData = JSON.parse(localStorage.getItem(getGuestKey()) || '{}');

      // Merge Guest Data into Account
      const merged = mergeData(guestData, remoteAccount);
      
      // Recalculate User Stats based on merged data
      const newStats = calculateLifetimeStats(merged.pastSessions, merged.logs, remoteAccount.user.joinedAt);
      
      const updatedAccount = {
          ...remoteAccount,
          ...merged,
          user: { ...remoteAccount.user, lifetimeStats: newStats },
          schemaVersion: DATA_SCHEMA_VERSION,
          runtime: isRuntimeSnapshot(remoteAccount.runtime)
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
              }),
          activeMode: remoteAccount.activeMode || 'work',
          timerStarted: false,
          isIdle: true,
          allPauseActive: false,
          allPauseTime: 0,
          graceOpen: false,
          graceContext: null,
          graceTotal: 0
      };

      // Push merged state back to cloud
      db[username] = updatedAccount;
      saveCloudDB(db);

      // Save to Local User Cache
      localStorage.setItem(getUserKey(username), JSON.stringify(updatedAccount));

      // Switch context
      localStorage.setItem('doro_last_user', username);
      setUserName(username);
      loadData(username);

      return true;
  };

  const logout = () => {
      setUser(null);
      setUserName('');
      localStorage.removeItem('doro_last_user');
      loadData(); // Load Guest Data
  };

  // Sync Effect: Periodically sync local user data to cloud if logged in
  useEffect(() => {
      if (!user) return;
      const interval = setInterval(() => {
          const db = getCloudDB();
          const localStr = localStorage.getItem(getUserKey(user.username));
          if (localStr) {
              const localData = JSON.parse(localStr);
              // Optimistic update to cloud
              db[user.username] = localData;
              saveCloudDB(db);
          }
      }, 10000); // 10 seconds auto-sync
      return () => clearInterval(interval);
  }, [user]);

  // Cloud Export / Import
  const exportData = (): string => {
      const userDataToSave = user ? { ...user } : null;
      const dataToSave = {
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
        user: userDataToSave
      };
      return btoa(JSON.stringify(dataToSave));
  };

  const importData = (encodedData: string): boolean => {
      try {
          const jsonStr = atob(encodedData);
          const parsed = JSON.parse(jsonStr);
          
          if (parsed.user && parsed.user.username) {
             const key = getUserKey(parsed.user.username);
             
             // Merge Strategy: Don't overwrite if existing data is present, merge logs and sessions
             const existingStr = localStorage.getItem(key);
             let dataToStore = parsed;
             
             if (existingStr) {
                 const existing = JSON.parse(existingStr);
                 // Merge Past Sessions (dedup by ID)
                 const sessionMap = new Map();
                 existing.pastSessions?.forEach((s: any) => sessionMap.set(s.id, s));
                 parsed.pastSessions?.forEach((s: any) => sessionMap.set(s.id, s));
                 
                 // Merge Logs (dedup by start time)
                 const logMap = new Map();
                 existing.logs?.forEach((l: any) => logMap.set(l.start, l));
                 parsed.logs?.forEach((l: any) => logMap.set(l.start, l));

                 // Merge Stats
                 const eStats = existing.user?.lifetimeStats || {};
                 const pStats = parsed.user?.lifetimeStats || {};
                 const newStats = { ...pStats }; // Prefer imported, but logic could be better
                 
                 dataToStore = {
                     ...parsed,
                     pastSessions: Array.from(sessionMap.values()),
                     logs: Array.from(logMap.values()),
                     user: { ...parsed.user, lifetimeStats: newStats }
                 };
             }

             if (!isRuntimeSnapshot((dataToStore as TimerPersistencePayload).runtime)) {
                const safeWork = (dataToStore as TimerPersistencePayload).workTime ?? parsed.settings?.workDuration ?? DEFAULT_SETTINGS.workDuration;
                const safeBreak = (dataToStore as TimerPersistencePayload).breakTime ?? 0;
                (dataToStore as any).schemaVersion = DATA_SCHEMA_VERSION;
                (dataToStore as any).runtime = createRuntimeSnapshot({
                  sourceTabId: tabIdRef.current,
                  phase: 'idle',
                  nowMs: Date.now(),
                  workTime: safeWork,
                  breakTime: safeBreak,
                  allPauseTime: 0,
                  graceTotal: 0,
                  activityStartIso: null,
                });
                (dataToStore as any).timerStarted = false;
                (dataToStore as any).isIdle = true;
                (dataToStore as any).allPauseActive = false;
                (dataToStore as any).allPauseTime = 0;
                (dataToStore as any).graceOpen = false;
                (dataToStore as any).graceContext = null;
                (dataToStore as any).graceTotal = 0;
             }

             localStorage.setItem(key, JSON.stringify(dataToStore));
             
             localStorage.setItem('doro_last_user', parsed.user.username);
             setUserName(parsed.user.username);
             loadData(parsed.user.username);
             return true;
          } else {
              localStorage.setItem(getGuestKey(), JSON.stringify(parsed));
              loadData();
              return true;
          }
      } catch (e) {
          console.error("Import failed", e);
          return false;
      }
  };

  // ---- DEVICE SYNC LOGIC ----
  const startMigrationHost = async (): Promise<string> => {
      const dataStr = exportData();
      return new Promise((resolve, reject) => {
          try {
              const shortId = Math.random().toString(36).substring(2, 8).toUpperCase();
              // @ts-ignore
              const peer = new Peer(shortId);
              migrationPeerRef.current = peer;
              
              peer.on('open', (id) => {
                  resolve(id);
              });
              
              peer.on('connection', (conn) => {
                  conn.on('open', () => {
                      conn.send({ type: 'MIGRATION_DATA', data: dataStr });
                      setTimeout(() => {
                          conn.close();
                          peer.destroy();
                          migrationPeerRef.current = null;
                      }, 2000);
                  });
              });

              peer.on('error', (err) => reject(err));
          } catch (e) { reject(e); }
      });
  };

  const joinMigration = async (code: string): Promise<void> => {
      return new Promise((resolve, reject) => {
          try {
              // @ts-ignore
              const peer = new Peer();
              migrationPeerRef.current = peer;
              
              peer.on('open', () => {
                  const conn = peer.connect(code);
                  
                  conn.on('open', () => {
                      console.log("Connected to migration host");
                  });

                  conn.on('data', (msg: any) => {
                      if (msg.type === 'MIGRATION_DATA' && msg.data) {
                          const success = importData(msg.data);
                          if (success) resolve();
                          else reject(new Error("Data corruption during sync"));
                          conn.close();
                          peer.destroy();
                          migrationPeerRef.current = null;
                      }
                  });
              });
              
              peer.on('error', (err) => {
                  reject(err);
              });
          } catch(e) { reject(e); }
      });
  };

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
      user: userDataToSave
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

  // PeerJS logic (omitted for brevity, same as before)
  const getCurrentState = useCallback(() => {
    return {
       settings, tasks, categories, logs, activeMode, timerStarted, isIdle,
       workTime, breakTime, pomodoroCount, scheduleBreaks,
       scheduleStartTime, sessionStartTime, allPauseActive, allPauseTime,
       allPauseReason, allPauseStartTime, graceOpen, graceContext, graceTotal,
       runtime: runtimeRef.current,
       hostConfig: hostSyncConfig
    };
  }, [settings, tasks, categories, logs, activeMode, timerStarted, isIdle, workTime, breakTime, pomodoroCount, scheduleBreaks, scheduleStartTime, sessionStartTime, allPauseActive, allPauseTime, allPauseReason, allPauseStartTime, graceOpen, graceContext, graceTotal, hostSyncConfig]);

  const applyRemoteState = useCallback((remote: any) => {
      isRemoteUpdate.current = true;
      const config = isHost ? DEFAULT_SYNC_CONFIG : clientSyncConfig;
      
      if (config.syncSettings && remote.settings) {
          setSettings(prev => ({
            ...DEFAULT_SETTINGS,
            ...remote.settings,
            disableBlur: prev.disableBlur,
            themeMode: prev.themeMode,
          }));
      }
      if (config.syncTasks && remote.tasks) {
          setTasks(remote.tasks);
          setCategories(remote.categories);
      }
      if (config.syncHistory && remote.logs) setLogs(remote.logs);
      if (config.syncSchedule) {
          if (remote.scheduleBreaks) setScheduleBreaks(remote.scheduleBreaks);
          if (remote.scheduleStartTime) setScheduleStartTime(remote.scheduleStartTime);
          if (remote.sessionStartTime) setSessionStartTime(remote.sessionStartTime);
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
          if (typeof remote.graceOpen === 'boolean') setGraceOpen(remote.graceOpen);
          if (remote.graceContext === 'afterWork' || remote.graceContext === 'afterBreak' || remote.graceContext === null) setGraceContext(remote.graceContext);
          if (typeof remote.graceTotal === 'number') setGraceTotal(remote.graceTotal);

          if (isRuntimeSnapshot(remote.runtime) && remote.runtime.updatedAtMs > lastRuntimeAppliedRef.current) {
              runtimeRef.current = remote.runtime;
              lastRuntimeAppliedRef.current = remote.runtime.updatedAtMs;
              currentActivityStartRef.current = remote.runtime.activityStartIso ? new Date(remote.runtime.activityStartIso) : null;
          }
      }
      if (!isHost && remote.hostConfig) setHostSyncConfig(remote.hostConfig);
      setTimeout(() => { isRemoteUpdate.current = false; }, 300);
  }, [isHost, clientSyncConfig]);

  const broadcastState = useCallback((excludeConnId?: string) => {
      if (!groupSessionId || connectionsRef.current.length === 0) return;
      const fullState = getCurrentState();
      const filteredState: any = { ...fullState };
      
      if (!hostSyncConfig.syncTimers) {
          delete filteredState.workTime; delete filteredState.breakTime; delete filteredState.activeMode;
          delete filteredState.timerStarted; delete filteredState.isIdle;
          delete filteredState.allPauseActive; delete filteredState.allPauseTime; delete filteredState.allPauseReason;
          delete filteredState.allPauseStartTime; delete filteredState.graceOpen; delete filteredState.graceContext;
          delete filteredState.graceTotal; delete filteredState.runtime;
      }
      if (!hostSyncConfig.syncTasks) { delete filteredState.tasks; delete filteredState.categories; }
      if (!hostSyncConfig.syncHistory) { delete filteredState.logs; }
      if (!hostSyncConfig.syncSchedule) { delete filteredState.scheduleBreaks; delete filteredState.scheduleStartTime; }
      if (!hostSyncConfig.syncSettings) { delete filteredState.settings; }

      connectionsRef.current.forEach(conn => {
          if (conn.open && conn.peer !== excludeConnId) {
              conn.send({ type: 'STATE_UPDATE', state: filteredState });
          }
      });
  }, [groupSessionId, getCurrentState, hostSyncConfig]);

  useEffect(() => {
     if(!groupSessionId || isRemoteUpdate.current) return;
     const t = setTimeout(() => { broadcastState(); }, 100);
     return () => clearTimeout(t);
  }, [tasks, settings, activeMode, timerStarted, isIdle, scheduleBreaks, sessionStartTime, pomodoroCount, allPauseActive, allPauseTime, allPauseStartTime, graceOpen, graceTotal, groupSessionId, broadcastState, hostSyncConfig]);

  const updateMembersList = useCallback(() => {
      if (isHost) {
           const memberList: GroupMember[] = [
               { id: 'host', name: userName, isHost: true },
               ...connectionsRef.current.map(c => ({ id: c.peer, name: (c.metadata as any)?.name || 'Member', isHost: false }))
           ];
           setMembers(memberList);
           connectionsRef.current.forEach(c => { if(c.open) c.send({ type: 'MEMBERS_UPDATE', members: memberList }); });
      }
  }, [isHost, userName]);

  const createGroupSession = async (name: string, config: GroupSyncConfig): Promise<string> => {
      setUserName(name);
      setHostSyncConfig(config);
      return new Promise((resolve, reject) => {
          try {
            const shortId = Math.random().toString(36).substring(2, 8).toUpperCase();
            // @ts-ignore
            const peer = new Peer(shortId); 
            peerRef.current = peer;
            peer.on('open', (id: string) => {
                setGroupSessionId(id); setIsHost(true); setPeerError(null);
                setMembers([{ id, name, isHost: true }]); resolve(id);
            });
            peer.on('connection', (conn: DataConnection) => {
                connectionsRef.current.push(conn);
                conn.on('open', () => { conn.send({ type: 'STATE_UPDATE', state: getCurrentState() }); updateMembersList(); });
                conn.on('close', () => { connectionsRef.current = connectionsRef.current.filter(c => c.peer !== conn.peer); updateMembersList(); });
            });
            peer.on('error', (err: any) => {
                if (err.type === 'unavailable-id') reject(new Error("Session ID collision."));
                else { setPeerError("Connection Error: " + err.type); reject(err); }
            });
          } catch (e) { reject(e); }
      });
  };

  const joinGroupSession = async (hostId: string, name: string, config: GroupSyncConfig): Promise<void> => {
      setUserName(name);
      setClientSyncConfig(config);
      return new Promise((resolve, reject) => {
          try {
            // @ts-ignore
            const peer = new Peer();
            peerRef.current = peer;
            peer.on('open', (id: string) => {
                setGroupSessionId(hostId); setIsHost(false); setPeerError(null);
                const conn = peer.connect(hostId, { metadata: { name } });
                connectionsRef.current = [conn];
                conn.on('open', () => { resolve(); });
                conn.on('data', (data: any) => {
                    if (data.type === 'STATE_UPDATE') applyRemoteState(data.state);
                    else if (data.type === 'MEMBERS_UPDATE') setMembers(data.members);
                });
                conn.on('close', () => { setPeerError("Disconnected from Host"); leaveGroupSession(); });
            });
            peer.on('error', (err: any) => { setPeerError("Connection Failed. Check ID."); setGroupSessionId(null); reject(err); });
          } catch (e) { reject(e); }
      });
  };

  const leaveGroupSession = () => {
      if (peerRef.current) { peerRef.current.destroy(); peerRef.current = null; }
      connectionsRef.current = [];
      setGroupSessionId(null); setIsHost(false); setPeerError(null); setMembers([]);
  };

  const updateHostSyncConfig = (config: GroupSyncConfig) => { setHostSyncConfig(config); broadcastState(); };
  
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

  const handleBreakLoopComplete = useCallback((initialGraceSeconds: number = 0) => {
    if (isProcessingRef.current) return;
    const now = Date.now();
    if (now - lastLoopTimeRef.current < 5000) return;
    
    isProcessingRef.current = true;
    lastLoopTimeRef.current = now;
    playAlarm(settings.alarmSound);
    if (currentActivityStartRef.current) {
      const duration = (Date.now() - currentActivityStartRef.current.getTime()) / 1000;
      logActivity('break', currentActivityStartRef.current, duration, 'Break Bank Depleted');
      currentActivityStartRef.current = null;
    }
    setBreakTime(0);
    setTimerStarted(false);
    setGraceContext('afterBreak');
    setGraceTotal(initialGraceSeconds);
    setGraceOpen(true);
    sendNotification("Break Time's Up!", "Back to work!");
    anchorRuntimePhase('grace', {
      phaseStartBreakTime: 0,
      phaseStartGraceTotal: initialGraceSeconds,
      activityStartIso: null,
    });
    setTimeout(() => { isProcessingRef.current = false; }, 2000);
  }, [logActivity, sendNotification, settings.alarmSound, anchorRuntimePhase]);

  useEffect(() => {
    const previousBreakTime = previousLegacyBreakTimeRef.current;
    if (!legacyRuntimeMode) {
      previousLegacyBreakTimeRef.current = breakTime;
      return;
    }
    if (timerStarted && !isIdle) {
       if (activeMode === 'work' && workTime <= 0) {
           handleWorkLoopComplete(0);
       } else if (activeMode === 'break') {
           const crossedBreakBoundary = previousBreakTime > 0 && breakTime <= 0;
           if (crossedBreakBoundary) handleBreakLoopComplete(0);
       }
    }
    previousLegacyBreakTimeRef.current = breakTime;
  }, [workTime, breakTime, activeMode, timerStarted, isIdle, handleWorkLoopComplete, handleBreakLoopComplete, legacyRuntimeMode]);

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
      const boundary = detectRuntimeBoundaryCrossing(runtime, now);
      if (boundary?.mode === 'break') {
        handleBreakLoopComplete(boundary.overflowSeconds);
      }
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
    handleBreakLoopComplete,
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
    if (typeof payload.graceOpen === 'boolean') setGraceOpen(payload.graceOpen);
    else setGraceOpen(runtime.phase === 'grace');
    if (payload.graceContext === 'afterWork' || payload.graceContext === 'afterBreak' || payload.graceContext === null) setGraceContext(payload.graceContext);
    if (typeof payload.graceTotal === 'number') setGraceTotal(payload.graceTotal);
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

  const startTimerInternal = (opts?: { mode?: TimerMode, workOverride?: number, breakOverride?: number, forceActivityStart?: Date, playSound?: boolean }) => {
    if (timerStarted) return;
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

  const startTimer = () => startTimerInternal();

  const stopTimer = () => {
    setTimerStarted(false);
    anchorRuntimePhase('idle');
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
  };

  const activateMode = (mode: TimerMode) => {
    if (isIdle) performSwitch(mode);
    else if (activeMode !== mode) performSwitch(mode);
    else if (!timerStarted) { startTimer(); playSwitch(); }
  };

  const switchMode = () => performSwitch(activeMode === 'work' ? 'break' : 'work');

  const restartActiveTimer = (customSeconds?: number) => {
    stopTimer();
    const nextWorkTime = activeMode === 'work' ? (customSeconds !== undefined ? customSeconds : settings.workDuration) : workTime;
    const nextBreakTime = activeMode === 'break' ? (customSeconds !== undefined ? customSeconds : (breakTime < 0 ? 0 : breakTime)) : breakTime;
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
  };

  const startAllPause = () => {};
  const confirmAllPause = (reason: string) => {
    stopTimer();
    const pauseStart = Date.now();
    setAllPauseReason(reason);
    setAllPauseStartTime(pauseStart);
    setAllPauseTime(0);
    setAllPauseActive(true);
    anchorRuntimePhase('all-pause', {
      phaseStartAllPauseTime: 0,
      activityStartIso: null,
    });
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
       let taskOverride: Task | undefined = undefined;
       if (logPauseAs === 'work' && activeTask) taskOverride = activeTask;
       logActivity(logPauseAs || 'allpause', start, allPauseTime, allPauseReason || 'Paused', taskOverride);
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
  };

  const resolveGrace = (nextMode: 'work' | 'break', options?: { adjustWorkStart?: number, adjustBreakBalance?: number, logGraceAs?: 'work' | 'break' | 'grace' }) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

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
    });
    setTimeout(() => { isProcessingRef.current = false; }, 500);
  };

  const endSession = () => {
    stopTimer();
    setAllPauseActive(false);
    const workLogs = logs.filter(l => l.type === 'work' && l.start > (sessionStartTime || ''));
    const breakLogs = logs.filter(l => l.type === 'break' && l.start > (sessionStartTime || ''));
    const totalWork = workLogs.reduce((acc, l) => acc + l.duration, 0) / 60;
    const totalBreak = breakLogs.reduce((acc, l) => acc + l.duration, 0) / 60;
    const completedTasksCount = flattenTasks(tasks).filter(t => t.checked).length;
    
    // Calculate Category Stats
    const catStats: Record<string, number> = {};
    workLogs.forEach(l => {
        if (l.categoryId) {
            const cat = categories.find(c => c.id === l.categoryId);
            if (cat) {
                catStats[cat.name] = (catStats[cat.name] || 0) + (l.duration / 60);
            }
        }
    });

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

        // Update User Lifetime Stats & Streak
        if (user) {
            setUser(prev => {
                if (!prev) return null;
                const stats = { ...prev.lifetimeStats };
                
                stats.totalFocusHours += (totalWork / 60);
                stats.totalPomos += pomodoroCount;
                stats.totalSessions += 1;
                
                // Update Lifetime Category Stats
                const lifetimeCats = stats.categoryBreakdown || {};
                Object.entries(catStats).forEach(([catName, mins]) => {
                    lifetimeCats[catName] = (lifetimeCats[catName] || 0) + mins;
                });
                stats.categoryBreakdown = lifetimeCats;

                // Streak Calculation
                const today = new Date().toISOString().split('T')[0];
                const lastActive = stats.lastActiveDate;
                
                if (lastActive !== today) {
                    const yesterday = new Date();
                    yesterday.setDate(yesterday.getDate() - 1);
                    const yesterdayStr = yesterday.toISOString().split('T')[0];
                    
                    if (lastActive === yesterdayStr) {
                        stats.currentStreak += 1;
                    } else {
                        stats.currentStreak = 1;
                    }
                    if (stats.currentStreak > stats.bestStreak) {
                        stats.bestStreak = stats.currentStreak;
                    }
                    stats.lastActiveDate = today;
                }

                return { ...prev, lifetimeStats: stats };
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
    const newTask: Task = {
      id: Date.now(), name, estimated, completed: 0, checked: false,
      selected: tasks.length === 0 && !parentId && !isFuture, categoryId: catId, subtasks: [], isExpanded: true, color: color || undefined, isFuture, scheduledStart, scheduledDate
    };
    if (parentId) setTasks(prev => addTaskToTree(prev, parentId, newTask));
    else setTasks(prev => [...prev, newTask]);
  };

  const addDetailedTask = (taskProps: Partial<Task> & { name: string, estimated: number }) => {
      const newTask: Task = {
        id: Date.now(), name: taskProps.name, estimated: taskProps.estimated, completed: 0, checked: false,
        selected: tasks.length === 0 && !taskProps.isFuture, categoryId: taskProps.categoryId || null, subtasks: taskProps.subtasks || [], isExpanded: true, color: taskProps.color,
        isFuture: taskProps.isFuture, scheduledStart: taskProps.scheduledStart, scheduledDate: taskProps.scheduledDate
      };
      setTasks(prev => [...prev, newTask]);
  };

  const addSubtasksToTask = (parentId: number, subtasks: { name: string, est: number }[]) => {
    setTasks(prev => {
        let newTasks = [...prev];
        subtasks.forEach(sub => {
             const t: Task = { id: Date.now() + Math.random(), name: sub.name, estimated: sub.est, completed: 0, checked: false, selected: false, categoryId: null, subtasks: [], isExpanded: false };
             newTasks = addTaskToTree(newTasks, parentId, t);
        });
        return newTasks;
    });
  };

  const updateTask = (task: Task) => setTasks(prev => updateTaskInTree(prev, task));
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
        const part2 = { ...task, id: Date.now(), name: `${task.name} (Part 2)`, estimated: remainingEst, completed: 0, subtasks: [] };
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
      groupSessionId, userName, isHost, peerError, members, hostSyncConfig, clientSyncConfig, pendingJoinId,
      login, logout, register, exportData, importData, startMigrationHost, joinMigration,
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
