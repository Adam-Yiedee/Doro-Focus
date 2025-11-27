
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { TimerMode, Task, Category, LogEntry, TimerSettings, AlarmSound, GroupSyncConfig, GroupMember } from '../types';
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
}

interface TimerContextType {
  // State
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
  categories: Category[];
  logs: LogEntry[];
  settings: TimerSettings;
  selectedCategoryId: number | null;
  activeTask: Task | null;
  activeColor?: string;
  scheduleBreaks: ScheduleBreak[];
  scheduleStartTime: string;
  sessionStartTime: string | null;

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
  addTask: (name: string, est: number, catId: number | null, parentId?: number, color?: string) => void;
  addDetailedTask: (task: Partial<Task> & { name: string, estimated: number }) => void;
  addSubtasksToTask: (parentId: number, subtasks: { name: string, est: number }[]) => void;
  updateTask: (task: Task) => void;
  deleteTask: (id: number) => void;
  selectTask: (id: number) => void;
  toggleTaskExpansion: (id: number) => void;
  moveTask: (fromId: number, toId: number) => void;
  moveSubtask: (fromParentId: number, toParentId: number, subId: number, targetSubId: number | null) => void;
  splitTask: (taskId: number, splitAt: number) => void;
  addCategory: (name: string, color: string) => void;
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
}

const TimerContext = createContext<TimerContextType | undefined>(undefined);

const STORAGE_KEY = 'lumina_focus_v8_cal'; 

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
  const [categories, setCategories] = useState<Category[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [scheduleBreaks, setScheduleBreaks] = useState<ScheduleBreak[]>([]);
  const [scheduleStartTime, setScheduleStartTime] = useState<string>('08:00');
  const [sessionStartTime, setSessionStartTime] = useState<string | null>(null);

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

  const lastTickRef = useRef<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const currentActivityStartRef = useRef<Date | null>(null);
  const lastLoopTimeRef = useRef<number>(0);
  const isProcessingRef = useRef(false);
  const breakZeroTriggeredRef = useRef(false);

  // Auto-detect mobile and disable blur
  useEffect(() => {
    const checkMobile = () => {
        const isMobile = window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (isMobile) {
            setSettings(prev => ({ ...prev, disableBlur: true }));
        }
    };
    checkMobile();
  }, []);

  // Parse URL Params for Session Join
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionParam = params.get('session');
    if (sessionParam) {
        setPendingJoinId(sessionParam);
        // Clean URL to prevent re-join on refresh (optional, but good UX)
        window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSettings(prev => ({ ...prev, ...parsed.settings }));
        setTasks(parsed.tasks || []);
        setCategories(parsed.categories || []);
        setLogs(parsed.logs || []);
        setPomodoroCount(parsed.pomodoroCount || 0);
        setScheduleBreaks(parsed.scheduleBreaks || []);
        if (parsed.breakTime !== undefined) setBreakTime(parsed.breakTime);
        if (parsed.workTime !== undefined) setWorkTime(parsed.workTime);
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
      } catch (e) {
        console.error("Failed to load state", e);
      }
    } else {
         const now = new Date();
         const h = now.getHours().toString().padStart(2, '0');
         const m = now.getMinutes().toString().padStart(2, '0');
         setScheduleStartTime(`${h}:${m}`);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      settings, tasks, categories, logs, pomodoroCount, workTime, breakTime, scheduleBreaks, scheduleStartTime, sessionStartTime, userName
    }));
  }, [settings, tasks, categories, logs, pomodoroCount, workTime, breakTime, scheduleBreaks, scheduleStartTime, sessionStartTime, userName]);

  // ---- PEERJS SYNC LOGIC ----
  const getCurrentState = useCallback(() => {
    return {
       settings, tasks, categories, logs, activeMode, timerStarted, isIdle,
       workTime, breakTime, pomodoroCount, scheduleBreaks,
       scheduleStartTime, sessionStartTime, allPauseActive,
       allPauseReason, graceOpen, graceContext,
       // Include host info
       hostConfig: hostSyncConfig
    };
  }, [settings, tasks, categories, logs, activeMode, timerStarted, isIdle, workTime, breakTime, pomodoroCount, scheduleBreaks, scheduleStartTime, sessionStartTime, allPauseActive, allPauseReason, graceOpen, graceContext, hostSyncConfig]);

  const applyRemoteState = useCallback((remote: any) => {
      // Glitch Prevention: Only update if strictly necessary or significant drift
      isRemoteUpdate.current = true;
      
      const config = isHost ? DEFAULT_SYNC_CONFIG : clientSyncConfig;
      
      if (config.syncSettings && remote.settings) {
          setSettings(prev => ({
              ...remote.settings,
              disableBlur: prev.disableBlur // IMPORTANT: Never sync disableBlur setting
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
          // Soft sync: Only update if deviation > 1s or mode changed
          // This prevents jitter
          const timerDrift = Math.abs(remote.workTime - workTime);
          if (remote.activeMode !== activeMode || timerDrift > 1.5 || !timerStarted) {
               setWorkTime(remote.workTime);
               setBreakTime(remote.breakTime);
               setActiveMode(remote.activeMode);
               setTimerStarted(remote.timerStarted);
          }
          
          // CRITICAL: Sync Visual State
          // If the remote timer is running, or explicitly not idle, update isIdle
          if (remote.timerStarted) {
              setIsIdle(false);
          } else if (remote.isIdle !== undefined) {
              setIsIdle(remote.isIdle);
          }
          
          setPomodoroCount(remote.pomodoroCount);
          setAllPauseActive(remote.allPauseActive);
          setAllPauseReason(remote.allPauseReason || '');
          setGraceOpen(remote.graceOpen || false);
          setGraceContext(remote.graceContext || null);

          if (remote.timerStarted) {
              workerRef.current?.postMessage('start');
              // Don't reset tick ref if just a minor adjustment to avoid jumps
              if (lastTickRef.current === null) {
                  lastTickRef.current = Date.now();
                  currentActivityStartRef.current = new Date(); 
              }
          } else {
              workerRef.current?.postMessage('stop');
          }
      }

      // Update Host Config if we are client
      if (!isHost && remote.hostConfig) {
          setHostSyncConfig(remote.hostConfig);
      }

      setTimeout(() => { isRemoteUpdate.current = false; }, 300);
  }, [workTime, activeMode, timerStarted, isHost, clientSyncConfig]);

  const broadcastState = useCallback((excludeConnId?: string) => {
      if (!groupSessionId || connectionsRef.current.length === 0) return;
      
      const fullState = getCurrentState();
      
      // Filter based on Host Config
      const filteredState: any = { ...fullState };
      
      if (!hostSyncConfig.syncTimers) {
          delete filteredState.workTime;
          delete filteredState.breakTime;
          delete filteredState.activeMode;
          delete filteredState.timerStarted;
          delete filteredState.isIdle;
      }
      if (!hostSyncConfig.syncTasks) {
          delete filteredState.tasks;
          delete filteredState.categories;
      }
      if (!hostSyncConfig.syncHistory) {
          delete filteredState.logs;
      }
      if (!hostSyncConfig.syncSchedule) {
          delete filteredState.scheduleBreaks;
          delete filteredState.scheduleStartTime;
      }
      if (!hostSyncConfig.syncSettings) {
          delete filteredState.settings;
      }

      connectionsRef.current.forEach(conn => {
          if (conn.open && conn.peer !== excludeConnId) {
              conn.send({ type: 'STATE_UPDATE', state: filteredState });
          }
      });
  }, [groupSessionId, getCurrentState, hostSyncConfig]);

  useEffect(() => {
     if(!groupSessionId || isRemoteUpdate.current) return;
     const t = setTimeout(() => {
         broadcastState();
     }, 100);
     return () => clearTimeout(t);
  }, [
      tasks, settings, activeMode, timerStarted, isIdle,
      scheduleBreaks, sessionStartTime, pomodoroCount, allPauseActive, 
      graceOpen, groupSessionId, broadcastState, hostSyncConfig
  ]);

  const updateMembersList = useCallback(() => {
      if (isHost) {
           const memberList: GroupMember[] = [
               { id: 'host', name: userName, isHost: true },
               ...connectionsRef.current.map(c => ({ id: c.peer, name: (c.metadata as any)?.name || 'Member', isHost: false }))
           ];
           setMembers(memberList);
           // Broadcast members
           connectionsRef.current.forEach(c => {
               if(c.open) c.send({ type: 'MEMBERS_UPDATE', members: memberList });
           });
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
                setGroupSessionId(id);
                setIsHost(true);
                setPeerError(null);
                setMembers([{ id, name, isHost: true }]);
                resolve(id);
            });

            peer.on('connection', (conn: DataConnection) => {
                connectionsRef.current.push(conn);
                conn.on('open', () => {
                    // Send full initial state + members
                    conn.send({ type: 'STATE_UPDATE', state: getCurrentState() });
                    updateMembersList();
                });
                conn.on('data', (data: any) => {
                    if (data.type === 'STATE_UPDATE') {
                        // Clients don't typically push state to host in this mode, 
                        // but if we added bidirectional, we'd handle it here.
                    }
                });
                conn.on('close', () => {
                    connectionsRef.current = connectionsRef.current.filter(c => c.peer !== conn.peer);
                    updateMembersList();
                });
            });

            peer.on('error', (err: any) => {
                if (err.type === 'unavailable-id') {
                     reject(new Error("Session ID collision, please try again."));
                } else {
                     setPeerError("Connection Error: " + err.type);
                     reject(err);
                }
            });
          } catch (e) {
              reject(e);
          }
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
                setGroupSessionId(hostId);
                setIsHost(false);
                setPeerError(null);
                
                const conn = peer.connect(hostId, { metadata: { name } });
                connectionsRef.current = [conn];

                conn.on('open', () => {
                    resolve();
                });

                conn.on('data', (data: any) => {
                    if (data.type === 'STATE_UPDATE') {
                        applyRemoteState(data.state);
                    } else if (data.type === 'MEMBERS_UPDATE') {
                        setMembers(data.members);
                    }
                });
                
                conn.on('close', () => {
                    setPeerError("Disconnected from Host");
                    leaveGroupSession();
                });
            });
            
            peer.on('error', (err: any) => {
                 setPeerError("Connection Failed. Check ID.");
                 setGroupSessionId(null);
                 reject(err);
            });
          } catch (e) {
              reject(e);
          }
      });
  };

  const leaveGroupSession = () => {
      if (peerRef.current) {
          peerRef.current.destroy();
          peerRef.current = null;
      }
      connectionsRef.current = [];
      setGroupSessionId(null);
      setIsHost(false);
      setPeerError(null);
      setMembers([]);
  };

  const updateHostSyncConfig = (config: GroupSyncConfig) => {
      setHostSyncConfig(config);
      broadcastState(); // Trigger update with new filters
  };

  // ---- END PEERJS LOGIC ----

  useEffect(() => {
    const workerCode = `
      let intervalId;
      self.onmessage = function(e) {
        if (e.data === 'start') {
          if (intervalId) clearInterval(intervalId);
          intervalId = setInterval(() => {
            self.postMessage('tick');
          }, 250);
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
      type,
      start: start.toISOString(),
      end: new Date().toISOString(),
      duration,
      reason,
      task: selectedTask ? { id: selectedTask.id, name: selectedTask.name } : null,
      color: currentContext.color 
    };
    setLogs(prev => [entry, ...prev]);
  }, [tasks]);

  const sendNotification = useCallback((title: string, body: string) => {
    // Desktop / Web Standard
    if ("Notification" in window) {
       if (Notification.permission === "granted") {
           try {
             // Request Interaction keeps it visible longer on desktop
             new Notification(title, { 
                body, 
                icon: '/favicon.ico', 
                tag: 'lumina-timer', 
                requireInteraction: true,
                vibrate: [200, 100, 200]
             } as any);
           } catch(e) { console.error(e); }
       } else if (Notification.permission !== "denied") {
           Notification.requestPermission().then(p => {
               if (p === "granted") {
                   new Notification(title, { body, icon: '/favicon.ico', tag: 'lumina-timer' });
               }
           });
       }
    }
    // Mobile Vibration (Android)
    if (typeof navigator !== 'undefined' && "vibrate" in navigator) {
        navigator.vibrate([200, 100, 200, 100, 200]);
    }
  }, []);

  const handleWorkLoopComplete = useCallback(() => {
    if (isProcessingRef.current) return;
    const now = Date.now();
    // Increase debounce to 5 seconds to absolutely prevent double-reporting if state updates trigger re-renders
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
        const updatedTasks = incrementCompletedInTree(prevTasks, selected.id);
        const updatedSelected = findSelectedTask(updatedTasks);
        if (updatedSelected && updatedSelected.completed >= updatedSelected.estimated) {
             const flat = flattenTasks(updatedTasks);
             const currentIdx = flat.findIndex(t => t.id === updatedSelected.id);
             if (currentIdx !== -1) {
                 let nextId: number | null = null;
                 for (let i = currentIdx + 1; i < flat.length; i++) {
                     const t = flat[i];
                     if (!t.checked && t.completed < t.estimated && t.subtasks.length === 0) {
                          nextId = t.id;
                          break;
                     }
                 }
                 if (nextId) return selectTaskInTree(updatedTasks, nextId);
             }
        }
        return updatedTasks;
    });

    sendNotification(
      isLongBreak ? "Long Break Earned!" : "Focus Session Complete", 
      `${Math.floor(reward/60)} minutes added to break bank.`
    );
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

  // CRITICAL FIX: Monitor timer completion in Effect instead of inside setState updater
  // This prevents double-firing in StrictMode or during rapid updates
  useEffect(() => {
    if (timerStarted && !isIdle) {
       if (activeMode === 'work' && workTime <= 0) {
           handleWorkLoopComplete();
       } else if (activeMode === 'break') {
           // Break Logic:
           // If we have time (positive), ensure trigger is reset
           if (breakTime > 1) {
               breakZeroTriggeredRef.current = false;
           }
           // If we hit zero (or go negative) AND we haven't already triggered completion for this session
           else if (breakTime <= 0 && !breakZeroTriggeredRef.current) {
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
        // BREAK MODE
        // Allow negative time (debt) if user continues past zero
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
      // Ensure we have notification permissions on first interaction
      if ("Notification" in window && Notification.permission === "default") {
          Notification.requestPermission();
      }

      if (!sessionStartTime) {
          const now = new Date();
          const startStr = now.toISOString();
          setSessionStartTime(startStr);
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
       if (logPauseAs === 'work' && activeTask) {
           taskOverride = activeTask;
       }
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
    // GUARD: Prevent double firing
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    if (graceOpen && options?.logGraceAs) {
        const graceStart = new Date(Date.now() - graceTotal * 1000);
        let taskOverride: Task | undefined = undefined;
        if (options.logGraceAs === 'work' && activeTask) {
            taskOverride = activeTask;
        }

        let reason = 'Grace Period';
        if (options.logGraceAs === 'work') reason = 'Grace Period (Working)';
        else if (options.logGraceAs === 'break') reason = 'Grace Period (Resting)';

        logActivity(options.logGraceAs, graceStart, graceTotal, reason, taskOverride);
    }
    
    setGraceOpen(false);
    setGraceContext(null);
    setActiveMode(nextMode);
    setIsIdle(false);
    
    if (options && options.adjustBreakBalance !== undefined) {
        setBreakTime(prev => prev - (options.adjustBreakBalance || 0));
    }
    
    if (nextMode === 'work') {
        // RESET LOGIC
        // Only reset to full work duration if:
        // 1. We just finished a work session (graceContext == 'afterWork')
        // 2. OR the current work timer is exhausted (<= 1s)
        // Otherwise (coming from break), preserve the remaining time.
        // We added `settings.workDuration > 0` as a sanity check.
        const shouldReset = graceContext === 'afterWork' || (workTime <= 1 && settings.workDuration > 0);

        setWorkTime(prev => {
            let base = prev;
            if (shouldReset) base = settings.workDuration;
            
            if (options?.adjustWorkStart) {
                base = Math.max(0, base - options.adjustWorkStart);
            }
            return base;
        });
    } else {
        // If we just finished work and are going to break,
        // we should reset work timer for the NEXT time we return to work.
        if (graceContext === 'afterWork') {
             setWorkTime(settings.workDuration);
        }
    }

    currentActivityStartRef.current = new Date();
    startTimer();
    
    // Release guard after short delay
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
    
    setSessionStats({
        totalWorkMinutes: totalWork,
        totalBreakMinutes: totalBreak,
        tasksCompleted: completedTasksCount,
        pomosCompleted: pomodoroCount
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

  const closeSummary = () => {
      setShowSummary(false);
      setSessionStats(null);
  };

  const hardReset = () => {
      localStorage.removeItem(STORAGE_KEY);
      setSettings(DEFAULT_SETTINGS);
      setTasks([]);
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

  const addTask = (name: string, estimated: number, categoryId: number | null, parentId?: number, color?: string) => {
    const newTask: Task = {
      id: Date.now(), name, estimated, completed: 0, checked: false,
      selected: tasks.length === 0 && !parentId, categoryId, subtasks: [], isExpanded: true, color: color || undefined
    };
    if (parentId) setTasks(prev => addTaskToTree(prev, parentId, newTask));
    else setTasks(prev => [...prev, newTask]);
  };

  const addDetailedTask = (taskProps: Partial<Task> & { name: string, estimated: number }) => {
      const newTask: Task = {
        id: Date.now(), name: taskProps.name, estimated: taskProps.estimated, completed: 0, checked: false,
        selected: tasks.length === 0, categoryId: taskProps.categoryId || null, subtasks: taskProps.subtasks || [], isExpanded: true, color: taskProps.color
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

  const addCategory = (name: string, color: string) => setCategories(prev => [...prev, { id: Date.now(), name, color }]);
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
      workTime, breakTime, activeMode, timerStarted, isIdle, pomodoroCount,
      allPauseActive, allPauseTime, graceOpen, graceContext, graceTotal,
      tasks, categories, logs, settings, selectedCategoryId, scheduleBreaks, scheduleStartTime, sessionStartTime,
      activeTask, activeColor, showSummary, sessionStats,
      groupSessionId, userName, isHost, peerError, members, hostSyncConfig, clientSyncConfig, pendingJoinId,
      startTimer, stopTimer, toggleTimer, switchMode, activateMode,
      startAllPause, confirmAllPause, endAllPause, resumeFromPause, restartActiveTimer, resolveGrace, endSession, closeSummary, hardReset,
      createGroupSession, joinGroupSession, leaveGroupSession, updateHostSyncConfig, setPendingJoinId,
      addTask, addDetailedTask, addSubtasksToTask, updateTask, deleteTask, selectTask, toggleTaskExpansion, moveTask, moveSubtask, splitTask,
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
