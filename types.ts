
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
  type: 'work' | 'break' | 'allpause' | 'task-complete';
  start: string;
  end: string;
  duration: number;
  reason?: string;
  task?: { id: number; name: string } | null;
  color?: string; // Added color
}

export interface TimerSettings {
  workDuration: number;
  shortBreakDuration: number;
  longBreakDuration: number;
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