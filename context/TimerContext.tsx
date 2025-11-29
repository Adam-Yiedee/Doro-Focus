import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { TimerMode, Task, Category, LogEntry, TimerSettings, AlarmSound, GroupSyncConfig, GroupMember, User, SessionRecord } from '../types';
import { playAlarm, playSwitch } from '../utils/sound';
import Peer, { DataConnection } from 'peerjs';

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
  addTask: (name: string, est: number, catId: number | null, parentId?: number, color?: string, isFuture?: boolean, scheduledStart?: string) => void;
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
  alarmSound: 'bell'
};

const DEFAULT_SYNC_CONFIG: GroupSyncConfig = {
    syncTimers: true,
    syncTasks: true,
    syncSchedule: true,
    syncHistory: false,
    syncSettings: true
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

export const TimerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
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
  const workerRef = useRef<Worker | null>(null);
  const currentActivityStartRef = useRef<Date | null>(null);
  const lastLoopTimeRef = useRef<number>(0);
  const isProcessingRef = useRef(false);
  const breakZeroTriggeredRef = useRef(false);
  const skipSaveRef = useRef(false);

  // Load Data Helper
  const loadData = useCallback((username?: string) => {
      skipSaveRef.current = true; // Prevent save effect triggering during load
      const key = username ? getUserKey(username) : getGuestKey();
      const saved = localStorage.getItem(key);
      
      if (saved) {
        try {
            const parsed = JSON.parse(saved);
            setSettings(prev => ({ ...prev, ...(parsed.settings || {}) }));
            setTasks(parsed.tasks || []);
            setPastSessions(parsed.pastSessions || []);
            setCategories(parsed.categories || []);
            setLogs(parsed.logs || []);
            setPomodoroCount(parsed.pomodoroCount || 0);
            setScheduleBreaks(parsed.scheduleBreaks || []);
            if (parsed.breakTime !== undefined) setBreakTime(parsed.breakTime);
            if (parsed.workTime !== undefined) setWorkTime(parsed.workTime);
            
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
        } catch (e) { console.error("Failed to load", e); }
      } else {
          // Defaults for new user or guest
          setSettings(DEFAULT_SETTINGS);
          setTasks([]);
          setPastSessions([]);
          setLogs([]);
          setCategories([]);
          setPomodoroCount(0);
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
      }
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
      const mergedSettings = { ...remoteData.settings, ...localData.settings };

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

      const accountData = {
          user: newUser,
          settings: guestData.settings || DEFAULT_SETTINGS,
          tasks: guestData.tasks || [],
          logs: guestData.logs || [],
          pastSessions: guestData.pastSessions || [],
          categories: guestData.categories || []
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
          user: { ...remoteAccount.user, lifetimeStats: newStats }
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
      const key = user ? getUserKey(user.username) : getGuestKey();
      const userDataToSave = user ? { ...user } : null;
      const dataToSave = {
        settings, tasks, pastSessions, categories, logs, pomodoroCount, workTime, breakTime, scheduleBreaks, scheduleStartTime, sessionStartTime, userName, user: userDataToSave
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
    if (skipSaveRef.current) return;
    const key = user ? getUserKey(user.username) : getGuestKey();
    const userDataToSave = user ? { ...user } : null;
    const dataToSave = {
      settings, tasks, pastSessions, categories, logs, pomodoroCount, workTime, breakTime, scheduleBreaks, scheduleStartTime, sessionStartTime, userName, user: userDataToSave
    };
    localStorage.setItem(key, JSON.stringify(dataToSave));
  }, [settings, tasks, pastSessions, categories, logs, pomodoroCount, workTime, breakTime, scheduleBreaks, scheduleStartTime, sessionStartTime, userName, user]);

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
       scheduleStartTime, sessionStartTime, allPauseActive,
       allPauseReason, graceOpen, graceContext,
       hostConfig: hostSyncConfig
    };
  }, [settings, tasks, categories, logs, activeMode, timerStarted, isIdle, workTime, breakTime, pomodoroCount, scheduleBreaks, scheduleStartTime, sessionStartTime, allPauseActive, allPauseReason, graceOpen, graceContext, hostSyncConfig]);

  const applyRemoteState = useCallback((remote: any) => {
      isRemoteUpdate.current = true;
      const config = isHost ? DEFAULT_SYNC_CONFIG : clientSyncConfig;
      
      if (config.syncSettings && remote.settings) {
          setSettings(prev => ({ ...remote.settings, disableBlur: prev.disableBlur }));
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
          const timerDrift = Math.abs(remote.workTime - workTime);
          if (remote.activeMode !== activeMode || timerDrift > 1.5 || !timerStarted) {
               setWorkTime(remote.workTime);
               setBreakTime(remote.breakTime);
               setActiveMode(remote.activeMode);
               setTimerStarted(remote.timerStarted);
          }
          if (remote.timerStarted) setIsIdle(false);
          else if (remote.isIdle !== undefined) setIsIdle(remote.isIdle);
          
          setPomodoroCount(remote.pomodoroCount);
          setAllPauseActive(remote.allPauseActive);
          setAllPauseReason(remote.allPauseReason || '');
          setGraceOpen(remote.graceOpen || false);
          setGraceContext(remote.graceContext || null);

          if (remote.timerStarted) {
              workerRef.current?.postMessage('start');
              if (lastTickRef.current === null) {
                  lastTickRef.current = Date.now();
                  currentActivityStartRef.current = new Date(); 
              }
          } else {
              workerRef.current?.postMessage('stop');
          }
      }
      if (!isHost && remote.hostConfig) setHostSyncConfig(remote.hostConfig);
      setTimeout(() => { isRemoteUpdate.current = false; }, 300);
  }, [workTime, activeMode, timerStarted, isHost, clientSyncConfig]);

  const broadcastState = useCallback((excludeConnId?: string) => {
      if (!groupSessionId || connectionsRef.current.length === 0) return;
      const fullState = getCurrentState();
      const filteredState: any = { ...fullState };
      
      if (!hostSyncConfig.syncTimers) {
          delete filteredState.workTime; delete filteredState.breakTime; delete filteredState.activeMode;
          delete filteredState.timerStarted; delete filteredState.isIdle;
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
  }, [tasks, settings, activeMode, timerStarted, isIdle, scheduleBreaks, sessionStartTime, pomodoroCount, allPauseActive, graceOpen, groupSessionId, broadcastState, hostSyncConfig]);

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
          intervalId = setInterval(() => { self.postMessage('tick'); }, 250);
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

  const handleWorkLoopComplete = useCallback(() => {
    if (isProcessingRef.current) return;
    const now = Date.now();
    if (now - lastLoopTimeRef.current < 5000) return; 
    
    isProcessingRef.current = true;
    lastLoopTimeRef.current = now;
    playAlarm(settings.alarmSound);
    
    const nextPomoCount = pomodoroCount + 1;
    const isLongBreak = nextPomoCount % settings.longBreakInterval === 0;
    const reward = isLongBreak ? settings.longBreakDuration : settings.shortBreakDuration;

    setBreakTime(prev => prev + reward);
    setPomodoroCount(nextPomoCount);

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

    sendNotification(isLongBreak ? "Long Break Earned!" : "Focus Session Complete", `${Math.floor(reward/60)} minutes added to break bank.`);
    setTimerStarted(false);
    setGraceContext('afterWork');
    setGraceTotal(0);
    setGraceOpen(true);
    setTimeout(() => { isProcessingRef.current = false; }, 2000);
  }, [settings, logActivity, sendNotification, pomodoroCount]);

  const handleBreakLoopComplete = useCallback(() => {
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
    setTimerStarted(false);
    setGraceContext('afterBreak');
    setGraceTotal(0);
    setGraceOpen(true);
    sendNotification("Break Time's Up!", "Back to work!");
    setTimeout(() => { isProcessingRef.current = false; }, 2000);
  }, [logActivity, sendNotification, settings.alarmSound]);

  useEffect(() => {
    if (timerStarted && !isIdle) {
       if (activeMode === 'work' && workTime <= 0) {
           handleWorkLoopComplete();
       } else if (activeMode === 'break') {
           if (breakTime > 1) {
               breakZeroTriggeredRef.current = false;
           } else if (breakTime <= 0 && !breakZeroTriggeredRef.current) {
               breakZeroTriggeredRef.current = true;
               handleBreakLoopComplete();
           }
       }
    }
  }, [workTime, breakTime, activeMode, timerStarted, isIdle, handleWorkLoopComplete, handleBreakLoopComplete]);

  const tick = useCallback(() => {
    const now = Date.now();
    if (!lastTickRef.current) { lastTickRef.current = now; return; }
    const delta = (now - lastTickRef.current) / 1000;
    lastTickRef.current = now;

    if (allPauseActive) { setAllPauseTime(prev => prev + delta); return; }
    if (graceOpen) { setGraceTotal(prev => prev + delta); return; }

    if (timerStarted && !isIdle) {
      if (activeMode === 'work') {
        setWorkTime(prev => {
          if (prev <= 0) return 0;
          return Math.max(0, prev - delta);
        });
      } else {
        setBreakTime(prev => prev - delta);
      }
    }
  }, [activeMode, timerStarted, isIdle, allPauseActive, graceOpen]);

  useEffect(() => {
    if (!workerRef.current) return;
    workerRef.current.onmessage = (e) => { if (e.data === 'tick') tick(); };
  }, [tick]);

  useEffect(() => {
    if (timerStarted || allPauseActive || graceOpen) {
      if (!lastTickRef.current) lastTickRef.current = Date.now();
      workerRef.current?.postMessage('start');
    } else {
      workerRef.current?.postMessage('stop');
      lastTickRef.current = null;
    }
  }, [timerStarted, allPauseActive, graceOpen]);

  const startTimer = () => {
    if (!timerStarted) {
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
      if (!sessionStartTime) {
          const now = new Date();
          setSessionStartTime(now.toISOString());
          const h = now.getHours().toString().padStart(2, '0');
          const m = now.getMinutes().toString().padStart(2, '0');
          setScheduleStartTime(`${h}:${m}`);
      }
      if (isIdle) { setIsIdle(false); currentActivityStartRef.current = new Date(); }
      setTimerStarted(true);
      lastTickRef.current = Date.now(); 
      if (!currentActivityStartRef.current) currentActivityStartRef.current = new Date();
      playSwitch(); 
    }
  };

  const stopTimer = () => { setTimerStarted(false); };
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
  };

  const activateMode = (mode: TimerMode) => {
    if (isIdle) performSwitch(mode);
    else if (activeMode !== mode) performSwitch(mode);
    else if (!timerStarted) { startTimer(); playSwitch(); }
  };

  const switchMode = () => performSwitch(activeMode === 'work' ? 'break' : 'work');

  const restartActiveTimer = (customSeconds?: number) => {
    stopTimer();
    if (activeMode === 'work') setWorkTime(customSeconds !== undefined ? customSeconds : settings.workDuration);
    else setBreakTime(prev => customSeconds !== undefined ? customSeconds : (prev < 0 ? 0 : prev));
    setGraceOpen(false);
    setIsIdle(false);
    currentActivityStartRef.current = new Date();
    setTimerStarted(true);
    lastTickRef.current = Date.now();
  };

  const startAllPause = () => {};
  const confirmAllPause = (reason: string) => {
    stopTimer();
    setAllPauseReason(reason);
    setAllPauseStartTime(Date.now());
    setAllPauseTime(0);
    setAllPauseActive(true);
  };

  const endAllPause = () => {
    setAllPauseActive(false);
    if (allPauseStartTime) {
      const start = new Date(allPauseStartTime);
      logActivity('allpause', start, allPauseTime, allPauseReason);
    }
    currentActivityStartRef.current = new Date();
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
    if (action === 'work') setWorkTime(prev => Math.max(0, prev - adjustAmount));
    else setBreakTime(prev => prev - adjustAmount);
    currentActivityStartRef.current = new Date();
    startTimer();
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
    if (options && options.adjustBreakBalance !== undefined) setBreakTime(prev => prev - (options.adjustBreakBalance || 0));
    
    if (nextMode === 'work') {
        const shouldReset = graceContext === 'afterWork' || (workTime <= 1 && settings.workDuration > 0);
        setWorkTime(prev => {
            let base = prev;
            if (shouldReset) base = settings.workDuration;
            if (options?.adjustWorkStart) base = Math.max(0, base - options.adjustWorkStart);
            return base;
        });
    } else {
        if (graceContext === 'afterWork') setWorkTime(settings.workDuration);
    }

    currentActivityStartRef.current = new Date();
    startTimer();
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
  };

  const addTask = (name: string, estimated: number, catId: number | null, parentId?: number, color?: string, isFuture?: boolean, scheduledStart?: string) => {
    const newTask: Task = {
      id: Date.now(), name, estimated, completed: 0, checked: false,
      selected: tasks.length === 0 && !parentId && !isFuture, categoryId: catId, subtasks: [], isExpanded: true, color: color || undefined, isFuture, scheduledStart
    };
    if (parentId) setTasks(prev => addTaskToTree(prev, parentId, newTask));
    else setTasks(prev => [...prev, newTask]);
  };

  const addDetailedTask = (taskProps: Partial<Task> & { name: string, estimated: number }) => {
      const newTask: Task = {
        id: Date.now(), name: taskProps.name, estimated: taskProps.estimated, completed: 0, checked: false,
        selected: tasks.length === 0 && !taskProps.isFuture, categoryId: taskProps.categoryId || null, subtasks: taskProps.subtasks || [], isExpanded: true, color: taskProps.color,
        isFuture: taskProps.isFuture, scheduledStart: taskProps.scheduledStart
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
    if (!timerStarted && activeMode === 'work') setWorkTime(newSettings.workDuration);
  };

  const clearLogs = () => { setLogs([]); setPomodoroCount(0); };
  const resetTimers = () => restartActiveTimer();

  return (
    <TimerContext.Provider value={{
      user, workTime, breakTime, activeMode, timerStarted, isIdle, pomodoroCount,
      allPauseActive, allPauseTime, graceOpen, graceContext, graceTotal,
      tasks, pastSessions, categories, logs, settings, selectedCategoryId, scheduleBreaks, scheduleStartTime, sessionStartTime,
      isScheduleOpen, setScheduleOpen,
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