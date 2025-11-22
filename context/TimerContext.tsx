
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { TimerMode, Task, Category, LogEntry, TimerSettings } from '../types';
import { playBell, playSwitch } from '../utils/sound';

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
  activeColor?: string; // Added activeColor

  // Actions
  startTimer: () => void;
  stopTimer: () => void;
  toggleTimer: () => void;
  switchMode: () => void; 
  activateMode: (mode: TimerMode) => void;
  startAllPause: () => void;
  confirmAllPause: (reason: string) => void;
  endAllPause: () => void;
  resumeFromPause: (action: 'work' | 'break', adjustAmount: number) => void;
  restartActiveTimer: (customSeconds?: number) => void;
  resolveGrace: (nextMode: 'work' | 'break', options?: { adjustWorkStart?: number, adjustBreakBalance?: number }) => void;
  
  // Data Management
  addTask: (name: string, est: number, catId: number | null, parentId?: number, color?: string) => void;
  updateTask: (task: Task) => void;
  deleteTask: (id: number) => void;
  selectTask: (id: number) => void;
  toggleTaskExpansion: (id: number) => void;
  addCategory: (name: string, color: string) => void;
  updateCategory: (cat: Category) => void;
  deleteCategory: (id: number) => void;
  selectCategory: (id: number | null) => void;
  updateSettings: (newSettings: TimerSettings) => void;
  clearLogs: () => void;
  resetTimers: () => void;
}

const TimerContext = createContext<TimerContextType | undefined>(undefined);

const STORAGE_KEY = 'lumina_focus_v3_stable';

const DEFAULT_SETTINGS: TimerSettings = {
  workDuration: 1500, // 25 min
  shortBreakDuration: 300, // 5 min banked per cycle
  longBreakDuration: 900, 
};

// Recursive Helpers for Tasks
const recalculateEstimates = (task: Task): Task => {
  if (task.subtasks.length > 0) {
    const updatedSubtasks = task.subtasks.map(recalculateEstimates);
    const sumEst = updatedSubtasks.reduce((acc, t) => acc + t.estimated, 0);
    return { 
      ...task, 
      subtasks: updatedSubtasks, 
      estimated: sumEst > 0 ? sumEst : task.estimated 
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
    if (t.id === updatedTask.id) return recalculateEstimates(updatedTask);
    if (t.subtasks.length > 0) {
      const newSubtasks = updateTaskInTree(t.subtasks, updatedTask);
      return recalculateEstimates({ ...t, subtasks: newSubtasks });
    }
    return t;
  });
};

const deleteTaskInTree = (tasks: Task[], id: number): Task[] => {
  return tasks
    .filter(t => t.id !== id)
    .map(t => {
        const newSubtasks = deleteTaskInTree(t.subtasks, id);
        return recalculateEstimates({ ...t, subtasks: newSubtasks });
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
      return recalculateEstimates(updated);
    }
    if (t.subtasks.length > 0) {
      const newSubtasks = addTaskToTree(t.subtasks, parentId, newTask);
      return recalculateEstimates({ ...t, subtasks: newSubtasks });
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

// Helper to find active task and its inherited color context
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
    if (t.id === id) return { ...t, completed: t.completed + 1 };
    if (t.subtasks.length > 0) {
      return { ...t, subtasks: incrementCompletedInTree(t.subtasks, id) };
    }
    return t;
  });
};

export const TimerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // --- State ---
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

  // Grace Mode
  const [graceOpen, setGraceOpen] = useState(false);
  const [graceContext, setGraceContext] = useState<'afterWork' | 'afterBreak' | null>(null);
  const [graceTotal, setGraceTotal] = useState(0);

  // Data
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);

  // Refs
  const lastTickRef = useRef<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const currentActivityStartRef = useRef<Date | null>(null);

  // Load State
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSettings(parsed.settings || DEFAULT_SETTINGS);
        setTasks(parsed.tasks || []);
        setCategories(parsed.categories || []);
        setLogs(parsed.logs || []);
        setPomodoroCount(parsed.pomodoroCount || 0);
        if (parsed.breakTime !== undefined) setBreakTime(parsed.breakTime);
        if (parsed.workTime !== undefined) setWorkTime(parsed.workTime);
      } catch (e) {
        console.error("Failed to load state", e);
      }
    }
  }, []);

  // Save State
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      settings, tasks, categories, logs, pomodoroCount, workTime, breakTime
    }));
  }, [settings, tasks, categories, logs, pomodoroCount, workTime, breakTime]);

  // Init Web Worker
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

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  // Calculate Active Context
  const activeContext = findActiveContext(tasks);
  const activeTask = activeContext.task;
  const activeColor = activeContext.color;

  const logActivity = useCallback((type: LogEntry['type'], start: Date, duration: number, reason: string = '', taskOverride?: Task) => {
    if (duration < 1) return;
    
    const selectedTask = taskOverride || findSelectedTask(tasks);
    // Re-find context to get color if not passed explicitly
    const currentContext = findActiveContext(tasks);
    
    const entry: LogEntry = {
      type,
      start: start.toISOString(),
      end: new Date().toISOString(),
      duration,
      reason,
      task: selectedTask ? { id: selectedTask.id, name: selectedTask.name } : null,
      color: currentContext.color // Save the color snapshot
    };
    setLogs(prev => [entry, ...prev]);
  }, [tasks]);

  const handleWorkLoopComplete = useCallback(() => {
    playBell();
    const earned = settings.shortBreakDuration;
    setBreakTime(prev => prev + earned);
    setPomodoroCount(prev => prev + 1);

    if (currentActivityStartRef.current) {
      logActivity('work', currentActivityStartRef.current, settings.workDuration, 'Pomodoro Complete');
      currentActivityStartRef.current = null; 
    }

    const selected = findSelectedTask(tasks);
    let body = "5 minutes added to break bank.";
    if (selected) {
      setTasks(prev => incrementCompletedInTree(prev, selected.id));
      body = `Completed 1 Pomodoro on ${selected.name}`;
    }

    if ("Notification" in window && Notification.permission === "granted") {
       new Notification("Focus Session Complete", { 
         body,
         requireInteraction: true,
         icon: '/icon.png' // Assuming standard icon if available, optional
       });
    }

    setTimerStarted(false);
    setGraceContext('afterWork');
    setGraceTotal(0);
    setGraceOpen(true);
  }, [settings, tasks, logActivity]);

  const handleBreakLoopComplete = useCallback(() => {
    playBell();
    
    if (currentActivityStartRef.current) {
      const duration = (Date.now() - currentActivityStartRef.current.getTime()) / 1000;
      logActivity('break', currentActivityStartRef.current, duration, 'Break Bank Depleted');
      currentActivityStartRef.current = null;
    }

    setTimerStarted(false);
    setGraceContext('afterBreak');
    setGraceTotal(0);
    setGraceOpen(true);
    
    if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Break Time's Up!", { 
          body: "Your break bank is empty.", 
          requireInteraction: true 
        });
    }
  }, [logActivity]);

  const tick = useCallback(() => {
    const now = Date.now();
    if (!lastTickRef.current) {
        lastTickRef.current = now;
        return;
    }
    
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
        setWorkTime(prev => {
          const next = prev - delta;
          if (next <= 0) {
            // Trigger immediately if we cross zero
            return 0; 
          }
          return next;
        });
        // Check outside the setter to handle state updates correctly
        setWorkTime(prev => {
           if (prev <= 0) {
             handleWorkLoopComplete();
             return 0;
           }
           return prev;
        });
      } else {
        // Break mode
        setBreakTime(prev => {
          const next = prev - delta;
          // CRITICAL FIX: Only trigger finish if we are CROSSING zero from positive.
          // If we are already negative (debt), we continue.
          if (prev > 0 && next <= 0) {
            handleBreakLoopComplete();
            return 0;
          }
          return next;
        });
      }
    }
  }, [activeMode, timerStarted, isIdle, allPauseActive, graceOpen, handleWorkLoopComplete, handleBreakLoopComplete]);

  // Handle Worker Messages
  useEffect(() => {
    if (!workerRef.current) return;
    workerRef.current.onmessage = (e) => {
      if (e.data === 'tick') {
        tick();
      }
    };
  }, [tick]);

  // Toggle Worker based on state
  useEffect(() => {
    const shouldRun = timerStarted || allPauseActive || graceOpen;
    if (shouldRun) {
      if (!lastTickRef.current) lastTickRef.current = Date.now();
      workerRef.current?.postMessage('start');
    } else {
      workerRef.current?.postMessage('stop');
      lastTickRef.current = null;
    }
  }, [timerStarted, allPauseActive, graceOpen]);

  const startTimer = () => {
    if (!timerStarted) {
      if (isIdle) {
        setIsIdle(false);
        currentActivityStartRef.current = new Date();
      }
      setTimerStarted(true);
      lastTickRef.current = Date.now(); // Reset tick ref immediately
      if (!currentActivityStartRef.current) {
        currentActivityStartRef.current = new Date();
      }
    }
  };

  const stopTimer = () => {
    setTimerStarted(false);
  };

  const toggleTimer = () => timerStarted ? stopTimer() : startTimer();

  const performSwitch = (targetMode: TimerMode) => {
    playSwitch();
    
    // 1. Log the previous session if it was active
    if (!isIdle && currentActivityStartRef.current) {
        const duration = (Date.now() - currentActivityStartRef.current.getTime()) / 1000;
        logActivity(activeMode, currentActivityStartRef.current, duration, 'Switch');
    }

    // 2. Update State
    setActiveMode(targetMode);
    setIsIdle(false);
    setGraceOpen(false);
    setGraceContext(null);

    // 3. Start New Timer
    currentActivityStartRef.current = new Date();
    setTimerStarted(true);
    lastTickRef.current = Date.now();
  };

  const activateMode = (mode: TimerMode) => {
    if (isIdle) {
        // Initial start
        performSwitch(mode);
    } else if (activeMode !== mode) {
        // Explicit switch request
        performSwitch(mode);
    } else {
        // Same mode, just ensure it's running
        if (!timerStarted) {
            startTimer();
            playSwitch();
        }
    }
  };

  const switchMode = () => {
    const next = activeMode === 'work' ? 'break' : 'work';
    performSwitch(next);
  };

  const restartActiveTimer = (customSeconds?: number) => {
    stopTimer();
    
    // DO NOT LOG on restart as per user request
    // if (!isIdle && currentActivityStartRef.current) {
    //    const duration = (Date.now() - currentActivityStartRef.current.getTime()) / 1000;
    //    logActivity(activeMode, currentActivityStartRef.current, duration, 'Restarted Timer');
    // }
    
    if (activeMode === 'work') {
        setWorkTime(customSeconds !== undefined ? customSeconds : settings.workDuration);
    } else {
        setBreakTime(prev => {
            if (customSeconds !== undefined) return customSeconds;
            // If resetting break manually, clear negative debt to 0.
            return prev < 0 ? 0 : prev;
        });
    }
    
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

  const resumeFromPause = (action: 'work' | 'break', adjustAmount: number) => {
    setAllPauseActive(false);
    
    if (allPauseStartTime) {
       const start = new Date(allPauseStartTime);
       logActivity('allpause', start, allPauseTime, allPauseReason);
    }

    setActiveMode(action);
    setIsIdle(false);
    if (action === 'work') {
      setWorkTime(prev => Math.max(0, prev - adjustAmount));
    } else {
      setBreakTime(prev => prev - adjustAmount);
    }
    currentActivityStartRef.current = new Date();
    startTimer();
  };

  const resolveGrace = (nextMode: 'work' | 'break', options?: { adjustWorkStart?: number, adjustBreakBalance?: number }) => {
    setGraceOpen(false);
    setGraceContext(null);
    setActiveMode(nextMode);
    setIsIdle(false);

    // Apply Break Balance Adjustment (if any)
    // Positive adjustBreakBalance means we SPENT break time (subtract).
    // Negative adjustBreakBalance means we EARNED break time (add).
    if (options?.adjustBreakBalance) {
        setBreakTime(prev => prev - (options.adjustBreakBalance || 0));
    }

    if (nextMode === 'work') {
        // If starting work, reset work time minus any adjustment
        setWorkTime(Math.max(0, settings.workDuration - (options?.adjustWorkStart || 0)));
    } else {
        // If starting break, work time resets to full for next time
        setWorkTime(settings.workDuration); 
        // Break time is already adjusted above
    }
    
    currentActivityStartRef.current = new Date();
    startTimer();
  };

  // Data Helpers
  const addTask = (name: string, estimated: number, categoryId: number | null, parentId?: number, color?: string) => {
    const newTask: Task = {
      id: Date.now(),
      name,
      estimated,
      completed: 0,
      checked: false,
      selected: tasks.length === 0 && !parentId, 
      categoryId,
      subtasks: [],
      isExpanded: true,
      color: color || undefined
    };
    
    if (parentId) {
      setTasks(prev => addTaskToTree(prev, parentId, newTask));
    } else {
      setTasks(prev => [...prev, newTask]);
    }
  };

  const updateTask = (task: Task) => {
    setTasks(prev => updateTaskInTree(prev, task));
  };

  const deleteTask = (id: number) => setTasks(prev => deleteTaskInTree(prev, id));
  
  const selectTask = (id: number) => {
    setTasks(prev => selectTaskInTree(prev, id));
  };

  const toggleTaskExpansion = (id: number) => {
    const task = findTask(tasks, id);
    if (task) {
      setTasks(prev => updateTaskInTree(prev, { ...task, isExpanded: !task.isExpanded }));
    }
  };

  const addCategory = (name: string, color: string) => {
    setCategories(prev => [...prev, { id: Date.now(), name, color }]);
  };

  const updateCategory = (cat: Category) => {
    setCategories(prev => prev.map(c => c.id === cat.id ? cat : c));
  };

  const deleteCategory = (id: number) => {
    setCategories(prev => prev.filter(c => c.id !== id));
    if (selectedCategoryId === id) setSelectedCategoryId(null);
  };

  const resetTimers = () => {
    restartActiveTimer();
  };

  const updateSettings = (newSettings: TimerSettings) => {
    setSettings(newSettings);
    if (!timerStarted && activeMode === 'work') {
      setWorkTime(newSettings.workDuration);
    }
  };

  const clearLogs = () => {
    setLogs([]);
    setPomodoroCount(0);
  };

  return (
    <TimerContext.Provider value={{
      workTime, breakTime, activeMode, timerStarted, isIdle, pomodoroCount,
      allPauseActive, allPauseTime,
      graceOpen, graceContext, graceTotal,
      tasks, categories, logs, settings, selectedCategoryId, 
      activeTask, activeColor, // Exported activeColor
      startTimer, stopTimer, toggleTimer, switchMode, activateMode,
      startAllPause, confirmAllPause, endAllPause, resumeFromPause, restartActiveTimer, resolveGrace,
      addTask, updateTask, deleteTask, selectTask, toggleTaskExpansion,
      addCategory, updateCategory, deleteCategory, selectCategory: setSelectedCategoryId,
      updateSettings, clearLogs, resetTimers
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