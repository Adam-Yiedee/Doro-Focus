

export type TimerMode = 'work' | 'break';

export interface Category {
  id: number;
  name: string;
  color: string;
  icon: string; // Icon key
  archived?: boolean;
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
  // New Scheduling Fields
  isFuture?: boolean;
  scheduledStart?: string; // ISO Date String or "HH:MM"
  scheduledDate?: string; // "YYYY-MM-DD" for weekly planner
}

export interface LogEntry {
  type: 'work' | 'break' | 'allpause' | 'task-complete' | 'grace';
  start: string;
  end: string;
  duration: number;
  reason?: string;
  source?: 'timer' | 'manual';
  task?: { id: number; name: string } | null;
  color?: string;
  categoryId?: number | null;
  categoryName?: string;
  categoryColor?: string;
  categoryIcon?: string;
}

export type AlarmSound =
  | 'bell'
  | 'digital'
  | 'chime'
  | 'gong'
  | 'pop'
  | 'wood'
  | 'marimba'
  | 'crystal'
  | 'blade'
  | 'cosmic'
  | 'ripple'
  | 'news'
  | 'harp'
  | 'pulse'
  | 'beacon'
  | 'bubbles'
  | 'pluck'
  | 'flare'
  | 'drift'
  | 'orbit'
  | 'twinkle'
  | 'echo'
  | 'sprout'
  | 'comet';
export type FocusSound = 'off' | 'white-soft' | 'white-bright' | 'pink-soft' | 'pink-air' | 'brown-deep' | 'brown-warm' | 'green-calm';
export type TimerPreset = 'classic' | 'compact' | 'custom';

export interface TimerSettings {
  timerPreset: TimerPreset;
  workDuration: number;
  shortBreakDuration: number;
  longBreakDuration: number;
  longBreakInterval: number; // Pomodoros before a long break
  twoInARowMode: boolean;
  disableBlur: boolean;
  alarmSound: AlarmSound;
  twoInARowStartSound: AlarmSound;
  focusSound: FocusSound;
  focusSoundVolume: number;
  themeMode: 'light' | 'dark';
}

export interface SessionCategoryStat {
  categoryId?: number | null;
  categoryName?: string;
  categoryColor?: string;
  categoryIcon?: string;
  minutes: number;
}

export interface SessionRecord {
    id: string;
    startTime: string;
    endTime: string;
    stats: {
        totalWorkMinutes: number;
        totalBreakMinutes: number;
        pomosCompleted: number;
        miniPomosCompleted?: number;
        tasksCompleted: number;
        categoryStats?: Record<string, number>; // Category Name -> Minutes
        categoryDetails?: SessionCategoryStat[];
    };
}

export interface User {
    username: string;
    password?: string; // Stored locally
    joinedAt: string;
    lifetimeStats: {
        totalFocusHours: number;
        totalSessionHours: number;
        manualFocusHours: number;
        totalSessions: number;
        totalPomos: number;
        activeDays: number;
        currentStreak: number;
        bestStreak: number;
        lastActiveDate: string | null; // "YYYY-MM-DD"
        categoryBreakdown?: Record<string, number>; // Category Name -> Minutes
    }
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

export type TimerRuntimePhase = 'idle' | 'running-work' | 'running-break' | 'all-pause' | 'grace';

export interface TimerRuntimeSnapshot {
  version: 2;
  updatedAtMs: number;
  sourceTabId: string;
  phase: TimerRuntimePhase;
  phaseStartedAtMs: number | null;
  phaseStartWorkTime: number;
  phaseStartBreakTime: number;
  phaseStartAllPauseTime: number;
  phaseStartGraceTotal: number;
  activityStartIso: string | null;
}

export interface TimerSpectatorState {
  version: 1;
  hostName: string;
  activeMode: TimerMode;
  timerStarted: boolean;
  isIdle: boolean;
  workTime: number;
  breakTime: number;
  pomodoroCount: number;
  allPauseActive: boolean;
  allPauseTime: number;
  graceOpen: boolean;
  graceContext: 'afterWork' | 'afterBreak' | null;
  activeTaskName: string | null;
  activeCategoryName?: string;
  activeCategoryColor?: string;
  activeColor?: string;
  projectedFinishEndMs?: number | null;
  settings: Pick<TimerSettings, 'workDuration' | 'shortBreakDuration' | 'longBreakDuration' | 'longBreakInterval' | 'timerPreset' | 'twoInARowMode'>;
  runtime: TimerRuntimeSnapshot | null;
  updatedAtMs: number;
}

export type FocusFriendPresenceStatus = 'idle' | 'focusing' | 'break' | 'paused' | 'grace' | 'offline';

export interface FocusFriendPresence {
  status: FocusFriendPresenceStatus;
  updatedAtMs: number | null;
  timer: TimerSpectatorState | null;
}

export interface FocusFriendRequest {
  id: string;
  fromUsername: string;
  fromDisplayName: string;
  toUsername: string;
  toDisplayName: string;
  createdAt: string;
}

export type FocusFriendActionType = 'encouragement' | 'join-request' | 'join-invite';

export interface FocusFriendAction {
  id: string;
  type: FocusFriendActionType;
  fromUsername: string;
  fromDisplayName: string;
  toUsername: string;
  message: string;
  sessionId?: string | null;
  createdAt: string;
  readAt?: string | null;
}

export interface FocusFriend {
  username: string;
  displayName: string;
  joinedAt: string;
  friendsSince: string;
  lifetimeStats: User['lifetimeStats'];
  presence: FocusFriendPresence;
}

export interface FocusFriendsState {
  friends: FocusFriend[];
  incomingRequests: FocusFriendRequest[];
  outgoingRequests: FocusFriendRequest[];
  inbox: FocusFriendAction[];
}

export type FocusFriendNotice =
  | {
      id: string;
      type: 'action';
      action: FocusFriendAction;
    }
  | {
      id: string;
      type: 'request';
      request: FocusFriendRequest;
    };

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

export type GroupEventType =
  | 'joined'
  | 'timer-started'
  | 'timer-stopped'
  | 'timer-paused'
  | 'timer-resumed'
  | 'mode-switched'
  | 'timer-reset'
  | 'grace-resolved';

export interface GroupEventPayload {
  id: string;
  type: GroupEventType;
  actorId: string;
  actorName: string;
  mode?: TimerMode;
  reason?: string;
  at: number;
}

export interface GroupNotice {
  id: string;
  actorId: string;
  actorName: string;
  kind: 'join' | 'action';
  message: string;
  createdAt: number;
}

export interface GuestTimerLockNotice {
  id: string;
  title: string;
  message: string;
  createdAt: number;
}
