

export type TimerMode = 'work' | 'break';

export interface Category {
  id: number;
  name: string;
  color: string;
}

export interface Task {
  id: number;
  name: string;
  estimated: number;
  completed: number;
  checked: boolean;
  selected: boolean;
  categoryId: number | null;
  subtasks: Task[];
  isExpanded?: boolean;
  color?: string;
}

export interface LogEntry {
  type: 'work' | 'break' | 'allpause' | 'task-complete' | 'grace';
  start: string;
  end: string;
  duration: number;
  reason?: string;
  task?: { id: number; name: string } | null;
  color?: string; 
}

export type AlarmSound = 'bell' | 'digital' | 'chime' | 'gong' | 'pop' | 'wood';

export interface TimerSettings {
  workDuration: number;
  shortBreakDuration: number;
  longBreakDuration: number;
  longBreakInterval: number; // Pomodoros before a long break
  disableBlur: boolean;
  alarmSound: AlarmSound;
}

export interface TimerState {
  workTime: number;
  breakTime: number;
  activeMode: TimerMode;
  timerStarted: boolean;
  pomodoroCount: number;
  allPauseActive: boolean;
  allPauseTime: number;
  graceOpen: boolean;
  graceContext: 'afterWork' | 'afterBreak' | null;
  pendingBreakChunk: number;
  sessionEndTimestamp: number | null;
}

// Group Study Types
export interface GroupSyncConfig {
  syncTimers: boolean;
  syncTasks: boolean;
  syncSchedule: boolean; // Future schedule only
  syncHistory: boolean;  // Full history sync
  syncSettings: boolean;
}

export interface GroupMember {
  id: string;
  name: string;
  isHost: boolean;
}
