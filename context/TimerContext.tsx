import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { TimerMode, Task, Category, LogEntry, TimerSettings, AlarmSound } from '../types';
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
  createGroupSession: (name: string) => Promise<string>;
  joinGroupSession: (id: string, name: string) => Promise<void>;
  leaveGroupSession: () => void;

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

const STORAGE_KEY = 'lumina_focus_v7_cal'; 

const DEFAULT_SETTINGS: TimerSettings = {
  workDuration: 1500, 
  shortBreakDuration: 300, 
  longBreakDuration: 900,
  longBreakInterval: 4, 
  disableBlur: false,
  alarmSound: 'bell'
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
  
  const isRemoteUpdate = useRef(false);
  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<DataConnection[]>([]);

  const lastTickRef = useRef<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const currentActivityStartRef = useRef<Date | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSettings({ ...DEFAULT_SETTINGS, ...parsed.settings });
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
       settings, tasks, categories, logs, activeMode, timerStarted,
       workTime, breakTime, pomodoroCount, scheduleBreaks,
       scheduleStartTime, sessionStartTime, allPauseActive,
       allPauseReason, graceOpen, graceContext
    };
  }, [settings, tasks, categories, logs, activeMode, timerStarted, workTime, breakTime, pomodoroCount, scheduleBreaks, scheduleStartTime, sessionStartTime, allPauseActive, allPauseReason, graceOpen, graceContext]);

  const applyRemoteState = useCallback((remote: any) => {
      isRemoteUpdate.current = true;
      
      setSettings(remote.settings);
      setTasks(remote.tasks);
      setCategories(remote.categories);
      setLogs(remote.logs);
      setActiveMode(remote.activeMode);
      setTimerStarted(remote.timerStarted);
      setWorkTime(remote.workTime);
      setBreakTime(remote.breakTime);
      setPomodoroCount(remote.pomodoroCount);
      setScheduleBreaks(remote.scheduleBreaks);
      setScheduleStartTime(remote.scheduleStartTime);
      setSessionStartTime(remote.sessionStartTime);
      setAllPauseActive(remote.allPauseActive);
      setAllPauseReason(remote.allPauseReason || '');
      setGraceOpen(remote.graceOpen || false);
      setGraceContext(remote.graceContext || null);

      if (remote.timerStarted) {
          workerRef.current?.postMessage('start');
          lastTickRef.current = Date.now();
          currentActivityStartRef.current = new Date(); 
      } else {
          workerRef.current?.postMessage('stop');
      }

      setTimeout(() => { isRemoteUpdate.current = false; }, 300);
  }, []);

  const broadcastState = useCallback((excludeConnId?: string) => {
      if (!groupSessionId) return;
      const state = getCurrentState();
      
      // If we are Host: Broadcast to ALL connected clients (except sender if specified)
      // If we are Client: Broadcast to Host only
      
      connectionsRef.current.forEach(conn => {
          if (conn.open && conn.peer !== excludeConnId) {
              conn.send({ type: 'STATE_UPDATE', state });
          }
      });
  }, [groupSessionId, getCurrentState]);

  // Trigger broadcast on state changes
  useEffect(() => {
     if(!groupSessionId || isRemoteUpdate.current) return;
     const t = setTimeout(() => {
         broadcastState();
     }, 50);
     return () => clearTimeout(t);
  }, [
      // Major state changes only
      tasks, settings, activeMode, timerStarted, 
      scheduleBreaks, sessionStartTime, pomodoroCount, allPauseActive, 
      graceOpen, groupSessionId, broadcastState
      // Exclude workTime/breakTime to avoid flooding network on every tick
  ]);

  const createGroupSession = async (name: string): Promise<string> => {
      setUserName(name);
      return new Promise((resolve) => {
          const peer = new Peer();
          peerRef.current = peer;

          peer.on('open', (id) => {
              setGroupSessionId(id);
              setIsHost(true);
              resolve(id);
          });

          peer.on('connection', (conn) => {
              connectionsRef.current.push(conn);
              
              conn.on('open', () => {
                  // Immediately sync new peer with current state
                  conn.send({ type: 'STATE_UPDATE', state: getCurrentState() });
              });

              conn.on('data', (data: any) => {
                  if (data.type === 'STATE_UPDATE') {
                      // Host received update from a client
                      applyRemoteState(data.state);
                      // As Host, we must relay this to other clients
                      // But applyRemoteState sets isRemoteUpdate=true preventing auto-broadcast
                      // So we must manually broadcast to others
                      // We exclude the sender to avoid echo
                      connectionsRef.current.forEach(otherConn => {
                          if (otherConn.open && otherConn.peer !== conn.peer) {
                              otherConn.send({ type: 'STATE_UPDATE', state: data.state });
                          }
                      });
                  }
              });

              conn.on('close', () => {
                  connectionsRef.current = connectionsRef.current.filter(c => c.peer !== conn.peer);
              });
          });
      });
  };

  const joinGroupSession = async (hostId: string, name: string): Promise<void> => {
      setUserName(name);
      return new Promise((resolve) => {
          const peer = new Peer();
          peerRef.current = peer;

          peer.on('open', (id) => {
              setGroupSessionId(hostId); // We track the Host ID as the session ID
              setIsHost(false);
              
              const conn = peer.connect(hostId);
              connectionsRef.current = [conn];

              conn.on('open', () => {
                  resolve();
              });

              conn.on('data', (data: any) => {
                  if (data.type === 'STATE_UPDATE') {
                      applyRemoteState(data.state);
                  }
              });
              
              conn.on('close', () => {
                  alert("Host disconnected");
                  leaveGroupSession();
              });
          });
          
          peer.on('error', (err) => {
              console.error(err);
              alert("Could not connect to session. Check ID.");
              setGroupSessionId(null);
          });
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
    if (!("Notification" in window)) return;
    const trigger = () => { new Notification(title, { body, icon: '/favicon.ico', tag: 'lumina-timer' }); };
    if (Notification.permission === "granted") trigger();
    else if (Notification.permission !== "denied") Notification.requestPermission().then(p => { if (p === "granted") trigger(); });
  }, []);

  const handleWorkLoopComplete = useCallback(() => {
    playAlarm(settings.alarmSound);
    
    // Calculate Reward based on completed Pomos
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
  }, [settings, logActivity, sendNotification, pomodoroCount]);

  const handleBreakLoopComplete = useCallback(() => {
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
  }, [logActivity, sendNotification, settings.alarmSound]);

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
          const next = prev - delta;
          if (next <= 0) return 0; 
          return next;
        });
        setWorkTime(prev => { if (prev <= 0) { handleWorkLoopComplete(); return 0; } return prev; });
      } else {
        setBreakTime(prev => {
          const next = prev - delta;
          if (prev > 0 && next <= 0) { handleBreakLoopComplete(); return 0; }
          return next;
        });
      }
    }
  }, [activeMode, timerStarted, isIdle, allPauseActive, graceOpen, handleWorkLoopComplete, handleBreakLoopComplete]);

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
      // First start of session logic
      if (!sessionStartTime) {
          const now = new Date();
          const startStr = now.toISOString();
          setSessionStartTime(startStr);
          // Auto-adjust schedule start to now when session starts
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
    if (options?.adjustBreakBalance) setBreakTime(prev => prev - (options.adjustBreakBalance || 0));
    if (nextMode === 'work') setWorkTime(Math.max(0, settings.workDuration - (options?.adjustWorkStart || 0)));
    else setWorkTime(settings.workDuration); 
    currentActivityStartRef.current = new Date();
    startTimer();
  };

  const endSession = () => {
    stopTimer();
    setAllPauseActive(false);

    // Calculate Stats for Summary
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

    // Reset App State (Keep Logs)
    setTasks(prev => removeCompletedTasks(prev)); // Remove completed
    setPomodoroCount(0);
    setWorkTime(settings.workDuration);
    setBreakTime(0);
    setIsIdle(true);
    setTimerStarted(false);
    setGraceOpen(false);
    setGraceContext(null);
    setSessionStartTime(null);
    currentActivityStartRef.current = null;
    
    // Reset Schedule to Now
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
        
        // Remove 'from'
        const [moved] = newTasks.splice(fromIndex, 1);
        
        // Find 'to' index in the array *after* removal
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
      groupSessionId, userName, isHost,
      startTimer, stopTimer, toggleTimer, switchMode, activateMode,
      startAllPause, confirmAllPause, endAllPause, resumeFromPause, restartActiveTimer, resolveGrace, endSession, closeSummary, hardReset,
      createGroupSession, joinGroupSession, leaveGroupSession,
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