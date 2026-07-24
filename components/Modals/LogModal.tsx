import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Heart, Link as LinkIcon, LogIn, Plus, QrCode, Send, Share2, Timer as TimerIcon, UserPlus, Users, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useTimer } from '../../context/TimerContext';
import { AlarmSound, Category, FocusFriend, FocusFriendAction, FocusFriendRequest, FocusSound, GroupMember, GroupSyncConfig, LogEntry, SessionRecord, TimerPreset, TimerSettings, User } from '../../types';
import AccountInsights from './AccountInsights';
import { CATEGORY_ICON_OPTIONS, CATEGORY_ICONS, getIcon } from '../../utils/icons';
import { computeAccountInsights } from '../../utils/accountInsights';
import { getCategoryMapById, resolveLogEntryCategory } from '../../utils/categoryTracking';
import { getActiveCategories } from '../../utils/categoryVisibility';
import {
  DEFAULT_GROUP_SYNC_CONFIG as DEFAULT_GROUP_CONFIG,
  TIMER_ONLY_GROUP_SYNC_CONFIG,
} from '../../utils/groupStudy';
import { calculateLifetimeStatsFromData } from '../../utils/lifetimeStats';
import {
  formatPomodoroCount,
  getPomodoroEquivalentWeightForReason,
  MINI_POMODORO_COMPLETE_REASON,
  POMODORO_COMPLETE_REASON,
  getStandardPomodoroCountForTimer,
} from '../../utils/pomodoroAccounting';
import {
  buildEncouragementOptions,
  normalizeEncouragementSubject,
  type EncouragementPrompt,
  type EncouragementPromptContext,
} from '../../utils/encouragementPrompts';
import { PASTEL_SWATCHES as PRESET_COLORS } from '../../utils/palette';
import { playAlarm, startFocusSoundPreview, stopFocusSoundPreview } from '../../utils/sound';
import {
  TIMER_PRESETS,
  getMatchingTimerPreset,
  getProjectedTaskFinishSeconds,
  getRemainingPomodorosForActiveTasks,
} from '../../utils/timerRuntime';
import {
  buildTimerSpectatorUrl,
  formatTimerShareDuration,
  formatTimerShareEndLabel,
  getTimerShareEstimateFromSpectatorState,
} from '../../utils/timerShare';
import {
  buildFocusFriendInviteUrl,
  getFocusFriendInviteUsernameFromCurrentUrl,
  normalizeFocusFriendInviteUsername,
  removeFocusFriendInviteParamsFromCurrentUrl,
} from '../../utils/focusFriendInvite';

interface LogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ModalTab = 'log' | 'group' | 'account' | 'settings';
type TabButton = ModalTab | 'schedule';
type GroupFlow = 'menu' | 'host' | 'join';
type SyncKey = keyof GroupSyncConfig;
type AccountAction = 'sync' | 'refresh' | null;
type FocusFriendsPage = 'friends' | 'add';
type FocusFriendEncouragementMenuPlacement = 'down' | 'up';
type FocusFriendEncouragementConfirmation = {
  username: string;
  message: string;
  phase: 'visible' | 'leaving';
};
type FocusFriendJoinFeedback = {
  phase: 'sending' | 'sent' | 'error';
  message: string;
  expiresAtMs: number;
};
type FocusFriendJoinFollowupPolling = {
  interval: ReturnType<typeof setInterval> | null;
  timeout: ReturnType<typeof setTimeout> | null;
};
type FocusFriendBusyAction = 'refresh' | 'send-request' | `accept:${string}` | `accept-invite:${string}` | `decline:${string}` | `encourage:${string}` | `join:${string}` | `approve-join:${string}` | `decline-join:${string}` | `open-invite:${string}` | `read:${string}` | null;
type SettingsPanelTransitionPhase = 'idle' | 'leaving' | 'entering';
type SettingsPanelTransitionDirection = 'forward' | 'backward';
type DragInsertPosition = 'before' | 'after';
type ActivityLogDisplayMode = 'focus' | 'break' | 'pause' | 'grace';
type ActivityLogDisplayEntry = {
  rawEntries: LogEntry[];
  mode: ActivityLogDisplayMode;
  start: string;
  end: string;
  duration: number;
  taskName: string;
  categoryName: string | null;
  categoryColor: string | null;
  categoryIcon: string | null;
};

const GROUP_INVITE_BASE_URL = (import.meta.env.VITE_PUBLIC_SITE_URL || 'https://dorofocus.netlify.app').replace(/\/+$/, '');

const buildGroupInviteUrl = (sessionId: string) => {
  const normalized = sessionId.trim().toUpperCase();
  return `${GROUP_INVITE_BASE_URL}/?session=${encodeURIComponent(normalized)}`;
};

const isAccountDataConflictMessage = (message: string | null | undefined) => {
  const normalized = message?.trim().toLowerCase() || '';
  return normalized.includes('account data') && normalized.includes('conflict');
};

const ALARM_OPTIONS: Array<{ label: string; value: AlarmSound }> = [
  { label: 'Bell', value: 'bell' },
  { label: 'Digital', value: 'digital' },
  { label: 'Chime', value: 'chime' },
  { label: 'Gong', value: 'gong' },
  { label: 'Pop', value: 'pop' },
  { label: 'Wood', value: 'wood' },
  { label: 'Marimba', value: 'marimba' },
  { label: 'Crystal', value: 'crystal' },
  { label: 'Blade', value: 'blade' },
  { label: 'Cosmic', value: 'cosmic' },
  { label: 'Ripple', value: 'ripple' },
  { label: 'News', value: 'news' },
  { label: 'Harp', value: 'harp' },
  { label: 'Pulse', value: 'pulse' },
  { label: 'Beacon', value: 'beacon' },
  { label: 'Bubbles', value: 'bubbles' },
  { label: 'Pluck', value: 'pluck' },
  { label: 'Flare', value: 'flare' },
  { label: 'Drift', value: 'drift' },
  { label: 'Orbit', value: 'orbit' },
  { label: 'Twinkle', value: 'twinkle' },
  { label: 'Echo', value: 'echo' },
  { label: 'Sprout', value: 'sprout' },
  { label: 'Comet', value: 'comet' },
];

const FOCUS_SOUND_OPTIONS: Array<{ label: string; value: FocusSound }> = [
  { label: 'Off', value: 'off' },
  { label: 'White Soft', value: 'white-soft' },
  { label: 'White Bright', value: 'white-bright' },
  { label: 'Pink Soft', value: 'pink-soft' },
  { label: 'Pink Air', value: 'pink-air' },
  { label: 'Brown Deep', value: 'brown-deep' },
  { label: 'Brown Warm', value: 'brown-warm' },
  { label: 'Green Calm', value: 'green-calm' },
];

const getFocusFriendPomoMeta = (friend: FocusFriend) => {
  const timer = friend.presence.timer;
  const isActiveTimerState = Boolean(timer) && friend.presence.status !== 'idle' && friend.presence.status !== 'offline';
  const hasDailyPomoCount = Number.isFinite(Number(timer?.todayPomodoroCount));
  const completedPomoCount = hasDailyPomoCount
    ? Math.max(0, Number(timer?.todayPomodoroCount))
    : Number.isFinite(Number(timer?.pomodoroCount)) && timer
      ? getStandardPomodoroCountForTimer(Number(timer.pomodoroCount), timer.settings)
      : null;
  const safeCompletedPomoCount = completedPomoCount ?? 0;
  const displayedPomoCount = timer && isActiveTimerState ? safeCompletedPomoCount : null;
  const displayValue = displayedPomoCount !== null ? formatPomodoroCount(displayedPomoCount) : null;
  const promptUnitLabel = safeCompletedPomoCount === 1 ? 'pomo' : 'pomos';
  const displayUnitLabel = displayedPomoCount === 1 ? 'Pomo' : 'Pomos';

  return {
    currentPomoNumber: displayedPomoCount,
    completedPomoCount,
    displayLabel: displayedPomoCount !== null
      ? `${displayValue} ${displayUnitLabel}`
      : null,
    promptLabel: safeCompletedPomoCount > 0 ? `${formatPomodoroCount(safeCompletedPomoCount)} ${promptUnitLabel}` : 'first pomo',
  };
};

const getFocusFriendEncouragementContext = (friend: FocusFriend): EncouragementPromptContext => {
  const timer = friend.presence.timer;
  const pomoMeta = getFocusFriendPomoMeta(friend);
  const taskName = normalizeEncouragementSubject(timer?.activeTaskName, ['No selected task']);
  const categoryName = normalizeEncouragementSubject(timer?.activeCategoryName, ['Uncategorized']);
  return {
    currentPomoNumber: pomoMeta.currentPomoNumber,
    completedPomoCount: pomoMeta.completedPomoCount,
    pomoLabel: pomoMeta.promptLabel,
    taskName,
    categoryName,
    isBreak: timer?.activeMode === 'break' || friend.presence.status === 'break',
  };
};

const buildFocusFriendEncouragementOptions = (friend: FocusFriend) => (
  buildEncouragementOptions(getFocusFriendEncouragementContext(friend))
);

const FOCUS_SOUND_PREVIEW_MS = 2600;
const FOCUS_FRIEND_CONFIRMATION_VISIBLE_MS = 2200;
const FOCUS_FRIEND_CONFIRMATION_EXIT_MS = 640;
const FOCUS_FRIEND_JOIN_SENDING_VISIBLE_MS = 12_000;
const FOCUS_FRIEND_JOIN_FEEDBACK_VISIBLE_MS = 3800;
const FOCUS_FRIEND_JOIN_ERROR_VISIBLE_MS = 2800;
const FOCUS_FRIEND_JOIN_FOLLOWUP_REFRESH_MS = 2600;
const FOCUS_FRIEND_JOIN_FOLLOWUP_WINDOW_MS = 45_000;
const DAY_MS = 86_400_000;
const ROLLING_WEEK_DAYS = 7;

const TIMER_PRESET_OPTIONS: Array<{ label: string; value: Exclude<TimerPreset, 'custom'>; detail: string }> = [
  { label: 'Classic', value: 'classic', detail: '25 / 5 / 15' },
  { label: 'Mini-Pomos', value: 'compact', detail: '15 / 3 / 9' },
];

const MAX_VALID_DATE_MS = 8.64e15;

const formatDuration = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const formatDateTime = (iso: string, fallback = 'Unknown') => {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return fallback;
  return dt.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const getSafeTimestamp = (value: unknown): number | null => {
  const numeric = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric) || Math.abs(numeric) > MAX_VALID_DATE_MS) {
    return null;
  }
  return Number.isNaN(new Date(numeric).getTime()) ? null : numeric;
};

const formatTimestampDateTime = (timestamp: unknown, fallback = 'Never') => {
  const safeTimestamp = getSafeTimestamp(timestamp);
  if (safeTimestamp === null) return fallback;
  return formatDateTime(new Date(safeTimestamp).toISOString(), fallback);
};

const formatRelativeTimeFromMs = (timestamp: unknown) => {
  const safeTimestamp = getSafeTimestamp(timestamp);
  if (safeTimestamp === null) return 'Never';
  const diffMs = Date.now() - safeTimestamp;
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'Just now';

  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return formatTimestampDateTime(safeTimestamp, 'Never');
};

const formatFocusFriendSentenceRelativeTimeFromMs = (timestamp: unknown) => {
  const safeTimestamp = getSafeTimestamp(timestamp);
  if (safeTimestamp === null) return null;
  const diffMs = Date.now() - safeTimestamp;
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'just now';

  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;

  return formatTimestampDateTime(safeTimestamp, 'Never');
};

const formatCompactHours = (hours: number) => {
  const safe = Math.max(0, hours);
  return `${safe.toFixed(1)}h`;
};

const formatCompactMinutes = (minutes: number) => {
  const safe = Math.max(0, minutes);
  if (safe >= 60) {
    return `${(safe / 60).toFixed(1)}h`;
  }
  return `${Math.max(1, Math.round(safe))}m`;
};

const formatClockMinutes = (minutes: number | null) => {
  if (minutes === null || !Number.isFinite(minutes)) return '--';
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const mins = normalized % 60;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${mins.toString().padStart(2, '0')} ${suffix}`;
};

const ACCOUNT_USERNAME_REGEX = /^[A-Za-z0-9_.-]{3,32}$/;
const ACCOUNT_PASSWORD_MIN_LENGTH = 8;
const ACCOUNT_PASSWORD_MAX_LENGTH = 256;
const PREVIEW_ACCOUNT_USERNAME = 'preview';
const PREVIEW_ACCOUNT_PASSWORD = 'master';
const DEBUG_FOCUS_FRIEND_CREDENTIALS: Record<string, string> = {
  master: 'master',
  master2: 'master2',
  master3: 'master3',
  master4: 'master4',
  master5: 'master5',
};
const DEBUG_FOCUS_FRIEND_AUTH_HINT = 'master/master through master5/master5.';
const CATEGORY_EDITOR_CLOSE_DURATION_MS = 220;
const SETTINGS_PANEL_TRANSITION_MS = 240;
const AUTO_START_SOUND_PANEL_EXIT_MS = 300;
const CATEGORY_DRAG_HOLD_MS = 180;
const CATEGORY_DRAG_CANCEL_DISTANCE_PX = 8;
const CATEGORY_DRAG_DEAD_ZONE_MIN_PX = 14;
const CATEGORY_DRAG_DEAD_ZONE_RATIO = 0.34;
const CATEGORY_REORDER_MIN_INTERVAL_MS = 96;
const CATEGORY_FLIP_ANIMATION_DURATION_MS = 165;
const CATEGORY_FLIP_MAX_ITEMS = 24;
const LOG_ENTRY_TYPES = new Set<LogEntry['type']>(['work', 'break', 'allpause', 'task-complete', 'grace']);
const EMPTY_ACCOUNT_STATS: User['lifetimeStats'] = {
  totalFocusHours: 0,
  totalSessionHours: 0,
  manualFocusHours: 0,
  totalSessions: 0,
  totalPomos: 0,
  activeDays: 0,
  currentStreak: 0,
  bestStreak: 0,
  lastActiveDate: null,
  categoryBreakdown: {},
};

const validateAccountUsernameInput = (value: string) => {
  if (!ACCOUNT_USERNAME_REGEX.test(value)) {
    return 'Use 3-32 letters, numbers, ".", "_" or "-".';
  }
  return null;
};

const isPreviewAccountCredentials = (username: string, password: string) => {
  return username.trim().toLowerCase() === PREVIEW_ACCOUNT_USERNAME && password === PREVIEW_ACCOUNT_PASSWORD;
};

const isDebugFocusFriendCredentials = (username: string, password: string) => {
  const normalized = username.trim().toLowerCase();
  return DEBUG_FOCUS_FRIEND_CREDENTIALS[normalized] === password;
};

const validateAccountPasswordInput = (value: string, username = '') => {
  if (isPreviewAccountCredentials(username, value)) {
    return null;
  }
  if (isDebugFocusFriendCredentials(username, value)) {
    return null;
  }
  if (value.length < ACCOUNT_PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${ACCOUNT_PASSWORD_MIN_LENGTH} characters.`;
  }
  if (value.length > ACCOUNT_PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${ACCOUNT_PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
};

const isRenderableLogEntry = (value: unknown): value is LogEntry => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<LogEntry>;
  return typeof entry.type === 'string'
    && LOG_ENTRY_TYPES.has(entry.type as LogEntry['type'])
    && typeof entry.start === 'string'
    && typeof entry.end === 'string'
    && typeof entry.duration === 'number'
    && Number.isFinite(entry.duration);
};

const getSafeLogEntry = (value: unknown): LogEntry | null => {
  if (!isRenderableLogEntry(value)) return null;
  const entry = value as LogEntry;
  const safeTask = entry.task && typeof entry.task === 'object'
    ? {
        id: typeof entry.task.id === 'number' && Number.isFinite(entry.task.id) ? entry.task.id : -1,
        name: typeof entry.task.name === 'string' ? entry.task.name.trim() : '',
      }
    : null;

  return {
    type: entry.type as LogEntry['type'],
    start: entry.start,
    end: entry.end,
    duration: entry.duration,
    reason: typeof entry.reason === 'string' ? entry.reason : undefined,
    source: entry.source === 'manual' ? 'manual' : undefined,
    task: safeTask && safeTask.name ? safeTask : null,
    color: typeof entry.color === 'string' ? entry.color : undefined,
    categoryId: typeof entry.categoryId === 'number' && Number.isFinite(entry.categoryId) ? entry.categoryId : null,
    categoryName: typeof entry.categoryName === 'string' ? entry.categoryName : undefined,
    categoryColor: typeof entry.categoryColor === 'string' ? entry.categoryColor : undefined,
    categoryIcon: typeof entry.categoryIcon === 'string' ? entry.categoryIcon : undefined,
  };
};

const isRenderableCategory = (value: unknown): value is Category => {
  if (!value || typeof value !== 'object') return false;
  const category = value as Partial<Category>;
  return typeof category.id === 'number'
    && Number.isFinite(category.id)
    && typeof category.name === 'string'
    && typeof category.color === 'string'
    && typeof category.icon === 'string';
};

const isRenderableSessionRecord = (value: unknown): value is SessionRecord => {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<SessionRecord>;
  return typeof session.id === 'string'
    && typeof session.startTime === 'string'
    && typeof session.endTime === 'string'
    && Boolean(session.stats)
    && typeof session.stats === 'object';
};

const isRenderableUser = (value: unknown): value is User => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<User>;
  return typeof candidate.username === 'string' && typeof candidate.joinedAt === 'string';
};

const isRenderableGroupMember = (value: unknown): value is GroupMember => {
  if (!value || typeof value !== 'object') return false;
  const member = value as Partial<GroupMember>;
  return typeof member.id === 'string'
    && typeof member.name === 'string'
    && typeof member.isHost === 'boolean';
};

const isRenderableFocusFriend = (value: unknown): value is FocusFriend => {
  if (!value || typeof value !== 'object') return false;
  const friend = value as Partial<FocusFriend>;
  return typeof friend.username === 'string'
    && typeof friend.displayName === 'string'
    && typeof friend.joinedAt === 'string'
    && typeof friend.friendsSince === 'string'
    && Boolean(friend.presence)
    && typeof friend.presence === 'object';
};

const isRenderableFocusFriendRequest = (value: unknown): value is FocusFriendRequest => {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<FocusFriendRequest>;
  return typeof request.id === 'string'
    && typeof request.fromUsername === 'string'
    && typeof request.fromDisplayName === 'string'
    && typeof request.toUsername === 'string'
    && typeof request.toDisplayName === 'string'
    && typeof request.createdAt === 'string';
};

const isRenderableFocusFriendAction = (value: unknown): value is FocusFriendAction => {
  if (!value || typeof value !== 'object') return false;
  const action = value as Partial<FocusFriendAction>;
  return typeof action.id === 'string'
    && (action.type === 'encouragement' || action.type === 'join-request' || action.type === 'join-invite')
    && typeof action.fromUsername === 'string'
    && typeof action.fromDisplayName === 'string'
    && typeof action.toUsername === 'string'
    && typeof action.message === 'string'
    && typeof action.createdAt === 'string';
};

const getSafeSyncConfig = (value: unknown): GroupSyncConfig => {
  const candidate = value && typeof value === 'object' ? value as Partial<GroupSyncConfig> : {};
  return {
    syncTimers: typeof candidate.syncTimers === 'boolean' ? candidate.syncTimers : DEFAULT_GROUP_CONFIG.syncTimers,
    syncTasks: typeof candidate.syncTasks === 'boolean' ? candidate.syncTasks : DEFAULT_GROUP_CONFIG.syncTasks,
    syncSchedule: typeof candidate.syncSchedule === 'boolean' ? candidate.syncSchedule : DEFAULT_GROUP_CONFIG.syncSchedule,
    syncHistory: typeof candidate.syncHistory === 'boolean' ? candidate.syncHistory : DEFAULT_GROUP_CONFIG.syncHistory,
    syncSettings: typeof candidate.syncSettings === 'boolean' ? candidate.syncSettings : DEFAULT_GROUP_CONFIG.syncSettings,
  };
};

const getSafeText = (value: unknown) => (typeof value === 'string' ? value : '');

const getSafeSessionId = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return normalized || null;
};

const TAB_ORDER: Record<TabButton, number> = {
  log: 0,
  schedule: 1,
  group: 2,
  account: 3,
  settings: 4,
};

const SETTINGS_TAB_BUTTONS: Array<{ id: TabButton; label: string }> = [
  { id: 'log', label: 'Log' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'group', label: 'Group Study' },
  { id: 'account', label: 'Account' },
  { id: 'settings', label: 'Settings' },
];

const modalPanelTitleClass = 'text-lg font-bold text-white tracking-tight';

const getSafeLifetimeStats = (user: User | null): User['lifetimeStats'] => {
  const rawStats = user?.lifetimeStats;
  const rawBreakdown = rawStats?.categoryBreakdown;
  const safeTotalFocusHours = Number(rawStats?.totalFocusHours);
  const safeTotalSessionHours = Number(rawStats?.totalSessionHours);
  const safeManualFocusHours = Number(rawStats?.manualFocusHours);
  const safeCategoryBreakdown = rawBreakdown && typeof rawBreakdown === 'object' && !Array.isArray(rawBreakdown)
    ? Object.fromEntries(
        Object.entries(rawBreakdown).filter(([name, minutes]) => (
          typeof name === 'string' && Number.isFinite(Number(minutes)) && Number(minutes) > 0
        )).map(([name, minutes]) => [name, Number(minutes)]),
      )
    : {};

  return {
    ...EMPTY_ACCOUNT_STATS,
    ...(rawStats || {}),
    totalFocusHours: Number.isFinite(safeTotalFocusHours) && safeTotalFocusHours > 0 ? safeTotalFocusHours : 0,
    totalSessionHours: Number.isFinite(safeTotalSessionHours) && safeTotalSessionHours > 0 ? safeTotalSessionHours : 0,
    manualFocusHours: Number.isFinite(safeManualFocusHours) && safeManualFocusHours > 0 ? safeManualFocusHours : 0,
    totalSessions: Math.max(0, Math.floor(Number(rawStats?.totalSessions || 0))),
    totalPomos: Math.max(0, Number.isFinite(Number(rawStats?.totalPomos || 0)) ? Number(rawStats?.totalPomos || 0) : 0),
    activeDays: Math.max(0, Math.floor(Number(rawStats?.activeDays || 0))),
    currentStreak: Math.max(0, Math.floor(Number(rawStats?.currentStreak || 0))),
    bestStreak: Math.max(0, Math.floor(Number(rawStats?.bestStreak || 0))),
    lastActiveDate: typeof rawStats?.lastActiveDate === 'string' ? rawStats.lastActiveDate : null,
    categoryBreakdown: safeCategoryBreakdown,
  };
};

const clampInt = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
};

const isGraceLike = (entry: LogEntry) => {
  return entry.type === 'grace' || (typeof entry.reason === 'string' && entry.reason.startsWith('Grace Period'));
};

const isManualFocusLog = (entry: LogEntry) => (
  entry.type === 'work' && entry.source === 'manual'
);

const getDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getDateKeyFromIso = (iso: string) => {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return getDateKey(dt);
};

const getStartOfLocalDayMs = (value: number | string | Date) => {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const getInclusiveLocalDayCount = (startIso: string, endMs = Date.now()) => {
  const startMs = getStartOfLocalDayMs(startIso);
  const endDayMs = getStartOfLocalDayMs(endMs);
  if (startMs === null || endDayMs === null || endDayMs < startMs) return 1;
  return Math.max(1, Math.floor((endDayMs - startMs) / DAY_MS) + 1);
};

const getRollingWeekBounds = () => {
  const todayStartMs = getStartOfLocalDayMs(Date.now()) ?? Date.now();
  return {
    startMs: todayStartMs - ((ROLLING_WEEK_DAYS - 1) * DAY_MS),
    endMs: todayStartMs + DAY_MS,
  };
};

const isIsoWithinMsRange = (iso: string, startMs: number, endMs: number) => {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) && ms >= startMs && ms < endMs;
};

const parseDateKey = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, m - 1, d);
};

const formatLogDayLabel = (key: string) => {
  const date = parseDateKey(key);
  if (!date) return key;
  const todayKey = getDateKey(new Date());
  if (key === todayKey) return 'Today';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === getDateKey(yesterday)) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
};

const formatDateKeyLabel = (key: string | null, fallback = 'No focus days yet') => {
  if (!key) return fallback;
  const date = parseDateKey(key);
  if (!date) return fallback;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatClockTime = (iso: string) => {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '--:--';
  return dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const formatTimeRange = (start: string, end: string) => {
  return `${formatClockTime(start)} - ${formatClockTime(end)}`;
};

const formatLogDurationCompact = (seconds: number) => {
  const safe = Math.max(0, Math.round(seconds));
  if (safe === 0) return '0m';
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainingSeconds = safe % 60;

  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${remainingSeconds}s`;
};

const getLogDisplayReason = (entry: LogEntry) => {
  const reason = typeof entry.reason === 'string' ? entry.reason.trim() : '';
  if (!reason) return '';

  const normalized = reason.toLowerCase();
  if (
    normalized === POMODORO_COMPLETE_REASON.toLowerCase()
    || normalized === MINI_POMODORO_COMPLETE_REASON.toLowerCase()
    || normalized === 'session end'
  ) return '';
  if (entry.type === 'break' && normalized === 'recovery time') return '';
  if (entry.type === 'allpause' && normalized === 'paused session') return '';
  if (isGraceLike(entry) && (normalized === 'grace continuation' || normalized.startsWith('grace period'))) return '';

  return reason;
};

const getActivityLogDisplayMode = (entry: LogEntry): ActivityLogDisplayMode => {
  if (entry.type === 'work') return 'focus';
  if (entry.type === 'break') return 'break';
  if (entry.type === 'allpause') return 'pause';
  return 'grace';
};

const getLogEntryModeLabel = (entry: LogEntry) => {
  const mode = getActivityLogDisplayMode(entry);
  if (mode === 'focus') return 'Focus';
  if (mode === 'break') return 'Break';
  if (mode === 'pause') return 'Pause';
  return 'Grace Time';
};

const hasContinuousLogTransition = (previousEntry: LogEntry | null, entry: LogEntry) => {
  if (!previousEntry) return false;
  const previousEndMs = new Date(previousEntry.end).getTime();
  const currentStartMs = new Date(entry.start).getTime();
  if (Number.isNaN(previousEndMs) || Number.isNaN(currentStartMs)) return false;
  return Math.abs(currentStartMs - previousEndMs) <= 120_000;
};

const getActivityLogTaskName = (entry: LogEntry) => (
  typeof entry.task?.name === 'string' ? entry.task.name.trim() : ''
);

const getActivityLogPrimaryLabel = (entry: ActivityLogDisplayEntry) => {
  if (entry.mode === 'focus') {
    const manualEntry = entry.rawEntries.find(isManualFocusLog);
    if (manualEntry) {
      const detail = getLogDisplayReason(manualEntry);
      return detail && detail.toLowerCase() !== 'manual focus'
        ? `Manual Focus - ${detail}`
        : 'Manual Focus';
    }

    const miniPomoCount = entry.rawEntries.filter(
      (rawEntry) => getPomodoroEquivalentWeightForReason(rawEntry.reason) === 0.5,
    ).length;
    if (miniPomoCount > 0) {
      return miniPomoCount === 1 ? 'Completed Mini-Pomo' : `Completed ${miniPomoCount} Mini-Pomos`;
    }

    const pomoCount = entry.rawEntries.filter(
      (rawEntry) => getPomodoroEquivalentWeightForReason(rawEntry.reason) === 1,
    ).length;
    if (pomoCount > 0) {
      return pomoCount === 1 ? 'Completed Pomo' : `Completed ${pomoCount} Pomos`;
    }

    return `Switched to ${entry.taskName || 'Focus'}`;
  }
  if (entry.mode === 'break') return 'Switched to Break';
  if (entry.mode === 'pause') return 'Paused timer';
  return 'Used grace time';
};

const shouldMergeActivityLogEntries = (
  previousDisplayEntry: ActivityLogDisplayEntry,
  nextEntry: LogEntry,
  nextMode: ActivityLogDisplayMode,
  nextTaskName: string,
  nextCategoryName: string | null,
) => {
  if (previousDisplayEntry.mode !== nextMode) return false;
  const previousRawEntry = previousDisplayEntry.rawEntries[previousDisplayEntry.rawEntries.length - 1] || null;
  if (!hasContinuousLogTransition(previousRawEntry, nextEntry)) return false;
  if (previousRawEntry && (isManualFocusLog(previousRawEntry) || isManualFocusLog(nextEntry))) return false;

  if (nextMode === 'focus') {
    if (previousDisplayEntry.taskName && nextTaskName && previousDisplayEntry.taskName !== nextTaskName) return false;
    if (previousDisplayEntry.categoryName && nextCategoryName && previousDisplayEntry.categoryName !== nextCategoryName) return false;
  }

  return true;
};

const buildActivityLogDisplayEntries = (
  entries: LogEntry[],
  categoriesById: Map<number, Category>,
) => {
  const displayEntries: ActivityLogDisplayEntry[] = [];

  entries.forEach((entry) => {
    const mode = getActivityLogDisplayMode(entry);
    const resolvedCategory = resolveLogEntryCategory(entry, categoriesById);
    const taskName = getActivityLogTaskName(entry);
    const previousDisplayEntry = displayEntries[displayEntries.length - 1];

    if (previousDisplayEntry && shouldMergeActivityLogEntries(previousDisplayEntry, entry, mode, taskName, resolvedCategory.name || null)) {
      previousDisplayEntry.rawEntries.push(entry);
      previousDisplayEntry.end = entry.end;
      previousDisplayEntry.duration += Math.max(0, entry.duration);
      if (!previousDisplayEntry.taskName && taskName) previousDisplayEntry.taskName = taskName;
      if (!previousDisplayEntry.categoryName && resolvedCategory.name) previousDisplayEntry.categoryName = resolvedCategory.name;
      if (!previousDisplayEntry.categoryColor && resolvedCategory.color) previousDisplayEntry.categoryColor = resolvedCategory.color;
      if (!previousDisplayEntry.categoryIcon && resolvedCategory.icon) previousDisplayEntry.categoryIcon = resolvedCategory.icon;
      return;
    }

    displayEntries.push({
      rawEntries: [entry],
      mode,
      start: entry.start,
      end: entry.end,
      duration: Math.max(0, entry.duration),
      taskName,
      categoryName: resolvedCategory.name || null,
      categoryColor: resolvedCategory.color || null,
      categoryIcon: resolvedCategory.icon || null,
    });
  });

  return displayEntries;
};

const getLogEventAction = (entry: LogEntry, previousEntry: LogEntry | null) => {
  const continuous = hasContinuousLogTransition(previousEntry, entry);

  if (entry.type === 'work') {
    if (continuous && previousEntry?.type === 'break') return 'Switched to focus';
    if (continuous && previousEntry?.type === 'allpause') return 'Resumed focus';
    if (continuous && previousEntry && isGraceLike(previousEntry)) return 'Returned to focus';
    return 'Started focus';
  }

  if (entry.type === 'break') {
    if (continuous && previousEntry && (previousEntry.type === 'work' || isGraceLike(previousEntry))) return 'Switched to break';
    if (continuous && previousEntry?.type === 'allpause') return 'Resumed break';
    return 'Started break';
  }

  if (entry.type === 'allpause') return 'Paused timer';

  if (isGraceLike(entry)) {
    const reason = typeof entry.reason === 'string' ? entry.reason.toLowerCase() : '';
    if (reason.includes('(working)')) return 'Extended focus';
    if (reason.includes('(resting)')) return 'Extended break';
    return 'Used grace time';
  }

  return 'Timer event';
};

const getLogEventContext = (entry: LogEntry, categoryName?: string) => {
  const detail = getLogDisplayReason(entry);
  const taskName = typeof entry.task?.name === 'string' ? entry.task.name.trim() : '';

  if (entry.type === 'work') {
    if (taskName && categoryName && categoryName !== taskName) return `${taskName} - ${categoryName}`;
    if (taskName) return taskName;
    if (categoryName) return categoryName;
    if (detail) return detail;
    return 'Focus timer';
  }

  if (entry.type === 'break') {
    return detail || 'Break timer';
  }

  if (entry.type === 'allpause') {
    return detail || 'Timer paused';
  }

  if (isGraceLike(entry)) {
    if (detail && !/^grace period/i.test(detail)) return detail;
    const reason = typeof entry.reason === 'string' ? entry.reason.toLowerCase() : '';
    if (reason.includes('(working)')) return 'Extra focus time before switching';
    if (reason.includes('(resting)')) return 'Extra break time before switching';
    return 'Extra time before choosing the next mode';
  }

  return detail || 'Timer event';
};

const colorToRgba = (color: string, alpha: number) => {
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  const normalized = color.trim();

  if (/^#([0-9a-f]{3})$/i.test(normalized)) {
    const hex = normalized.slice(1);
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
  }

  if (/^#([0-9a-f]{6})$/i.test(normalized)) {
    const hex = normalized.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
  }

  const rgbMatch = normalized.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/i);
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${safeAlpha})`;
  }

  const rgbaMatch = normalized.match(/^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*[\d.]+\s*\)$/i);
  if (rgbaMatch) {
    return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${safeAlpha})`;
  }

  return `rgba(125, 83, 162, ${safeAlpha})`;
};

const getTaskPaletteColor = (preferred: string | undefined, seed: string) => {
  const normalized = typeof preferred === 'string' ? preferred.trim().toLowerCase() : '';
  const exactMatch = PRESET_COLORS.find((color) => color.toLowerCase() === normalized);
  if (exactMatch) return exactMatch;

  let hash = 0;
  const source = seed || normalized || PRESET_COLORS[0];
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash * 31) + source.charCodeAt(index)) >>> 0;
  }
  return PRESET_COLORS[hash % PRESET_COLORS.length];
};

const getFocusFriendAvatarIconKey = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  if (!key) return null;
  return Object.prototype.hasOwnProperty.call(CATEGORY_ICONS, key) ? key : null;
};

const copyToClipboard = async (value: string) => {
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
};

const ToggleRow: React.FC<{
  label: string;
  description?: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  tone?: 'default' | 'quiet';
  switchTone?: 'blue' | 'neutral';
}> = ({ label, description, checked, onToggle, disabled = false, tone = 'default', switchTone = 'blue' }) => {
  const surfaceClass = disabled
    ? 'cursor-not-allowed opacity-60'
    : tone === 'quiet'
      ? checked
        ? 'border-white/[0.075] bg-white/[0.04] text-white/90 hover:border-white/[0.09] hover:bg-white/[0.055]'
        : 'border-white/[0.07] bg-white/[0.025] text-white/72 hover:border-white/[0.09] hover:bg-white/[0.045] hover:text-white/88'
      : checked
        ? 'border-white/14 bg-white/[0.065] text-white hover:bg-white/[0.08]'
        : 'border-white/8 bg-white/[0.025] text-white/72 hover:border-white/12 hover:bg-white/[0.05] hover:text-white/88';
  const checkedSwitchClass = switchTone === 'neutral'
    ? 'border-white/[0.14] bg-white/[0.13]'
    : 'border-blue-300/30 bg-blue-500/70';
  const checkedKnobClass = switchTone === 'neutral'
    ? 'left-[1.35rem] shadow-[0_8px_18px_-10px_rgba(255,255,255,0.42)]'
    : 'left-[1.35rem] shadow-[0_8px_18px_-10px_rgba(96,165,250,0.7)]';

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`settings-option-btn group w-full flex items-center justify-between gap-4 rounded-[1rem] border px-4 py-3 text-left outline-none transition-[background-color,border-color,transform,color] duration-200 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/[0.10] ${surfaceClass}`}
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold tracking-tight">{label}</div>
        {description && <div className="mt-1 text-[11px] leading-relaxed text-white/42">{description}</div>}
      </div>
      <div
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-[background-color,border-color] duration-200 ${
          checked ? checkedSwitchClass : 'border-white/8 bg-white/8'
        }`}
      >
        <div
          className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white transition-[left,transform,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            checked ? checkedKnobClass : 'left-1'
          }`}
        />
      </div>
    </button>
  );
};

const LogModal: React.FC<LogModalProps> = ({ isOpen, onClose }) => {
  const {
    logs,
    clearLogs,
    addManualFocusLog,
    settings,
    updateSettings,
    workTime,
    breakTime,
    activeMode,
    timerStarted,
    isIdle,
    pomodoroCount,
    allPauseActive,
    graceOpen,
    graceContext,
    activeTask,
    tasks,
    hardReset,
    pastSessions,
    categories,
    addCategory,
    updateCategory,
    archiveCategory,
    moveCategory,
    user,
    login,
    register,
    logout,
    syncAccountNow,
    refreshAccountFromCloud,
    accountSyncState,
    accountSyncError,
    lastAccountSyncAt,
    isPreviewAccount,
    focusFriends,
    focusFriendsLoading,
    focusFriendsError,
    refreshFocusFriends,
    sendFocusFriendRequest,
    acceptFocusFriendInvite,
    acceptFocusFriendRequest,
    declineFocusFriendRequest,
    sendFocusFriendEncouragement,
    requestFocusFriendJoin,
    approveFocusFriendJoinRequest,
    declineFocusFriendJoinRequest,
    markFocusFriendActionRead,
    groupSessionId,
    userName,
    isHost,
    members,
    peerError,
    hostSyncConfig,
    clientSyncConfig,
    createGroupSession,
    joinGroupSession,
    leaveGroupSession,
    updateHostSyncConfig,
    updateClientSyncConfig,
    pendingJoinId,
    pendingMenuAction,
    setPendingJoinId,
    clearPendingMenuAction,
    setWeeklyScheduleOpen,
  } = useTimer();

  const [activeTab, setActiveTab] = useState<ModalTab>('settings');
  const [displayedTab, setDisplayedTab] = useState<ModalTab>('settings');
  const [settingsPanelTransitionPhase, setSettingsPanelTransitionPhase] = useState<SettingsPanelTransitionPhase>('idle');
  const [settingsPanelTransitionDirection, setSettingsPanelTransitionDirection] = useState<SettingsPanelTransitionDirection>('forward');
  const [focusFriendsNowMs, setFocusFriendsNowMs] = useState(Date.now());

  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authLocalError, setAuthLocalError] = useState<string | null>(null);
  const [accountActionBusy, setAccountActionBusy] = useState<AccountAction>(null);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [focusFriendUsernameInput, setFocusFriendUsernameInput] = useState('');
  const [focusFriendBusyAction, setFocusFriendBusyAction] = useState<FocusFriendBusyAction>(null);
  const [focusFriendEncouragementOptions, setFocusFriendEncouragementOptions] = useState<Record<string, EncouragementPrompt[]>>({});
  const [focusFriendEncouragementMenuUsername, setFocusFriendEncouragementMenuUsername] = useState<string | null>(null);
  const [focusFriendEncouragementMenuPlacement, setFocusFriendEncouragementMenuPlacement] = useState<FocusFriendEncouragementMenuPlacement>('down');
  const [focusFriendEncouragementConfirmation, setFocusFriendEncouragementConfirmation] = useState<FocusFriendEncouragementConfirmation | null>(null);
  const [focusFriendJoinFeedback, setFocusFriendJoinFeedback] = useState<Record<string, FocusFriendJoinFeedback>>({});
  const [focusFriendsPage, setFocusFriendsPage] = useState<FocusFriendsPage>('friends');
  const [focusFriendInviteUsername, setFocusFriendInviteUsername] = useState<string | null>(() => getFocusFriendInviteUsernameFromCurrentUrl());
  const [focusFriendInviteCopied, setFocusFriendInviteCopied] = useState(false);
  const [focusFriendsTabIndicatorStyle, setFocusFriendsTabIndicatorStyle] = useState({ left: 0, width: 0, opacity: 0 });
  const focusFriendEncouragementConfirmationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusFriendJoinFeedbackTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const focusFriendJoinFollowupPollingRef = useRef<FocusFriendJoinFollowupPolling>({ interval: null, timeout: null });

  const [groupFlow, setGroupFlow] = useState<GroupFlow>('menu');
  const [groupName, setGroupName] = useState('');
  const [groupSessionInput, setGroupSessionInput] = useState('');
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupLocalError, setGroupLocalError] = useState<string | null>(null);
  const [showGroupQr, setShowGroupQr] = useState(false);
  const [groupSyncControlsOpen, setGroupSyncControlsOpen] = useState(false);
  const [hostDraftConfig, setHostDraftConfig] = useState<GroupSyncConfig>(DEFAULT_GROUP_CONFIG);
  const [joinDraftConfig, setJoinDraftConfig] = useState<GroupSyncConfig>(DEFAULT_GROUP_CONFIG);
  const [inviteSessionId, setInviteSessionId] = useState('');
  const [timerShareBusy, setTimerShareBusy] = useState(false);
  const [timerShareMessage, setTimerShareMessage] = useState<string | null>(null);
  const groupNameInputRef = useRef<HTMLInputElement | null>(null);
  const inviteAutoJoinKeyRef = useRef<string | null>(null);
  const focusFriendInviteAutoAddKeyRef = useRef<string | null>(null);
  const settingsBodyRef = useRef<HTMLDivElement | null>(null);
  const categorySettingsSectionRef = useRef<HTMLDivElement | null>(null);
  const settingsTabListRef = useRef<HTMLDivElement | null>(null);
  const settingsTabButtonRefsRef = useRef(new Map<TabButton, HTMLButtonElement>());
  const focusFriendsTabListRef = useRef<HTMLDivElement | null>(null);
  const focusFriendsTabButtonRefsRef = useRef(new Map<FocusFriendsPage, HTMLButtonElement>());
  const settingsPanelTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCategoryCommitRef = useRef<(() => void) | null>(null);
  const pendingCategorySectionScrollRef = useRef(false);
  const [settingsTabIndicatorStyle, setSettingsTabIndicatorStyle] = useState({ left: 0, width: 0, opacity: 0 });

  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState(PRESET_COLORS[0]);
  const [newCategoryIcon, setNewCategoryIcon] = useState('star');
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [categoryFormError, setCategoryFormError] = useState<string | null>(null);
  const [categoryEditorCloseState, setCategoryEditorCloseState] = useState<'save' | 'cancel' | null>(null);
  const [draggingCategoryId, setDraggingCategoryId] = useState<number | null>(null);
  const [categoryDropHint, setCategoryDropHint] = useState<{ categoryId: number; position: DragInsertPosition } | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [manualFocusHoursInput, setManualFocusHoursInput] = useState('');
  const [manualFocusMinutesInput, setManualFocusMinutesInput] = useState('');
  const [manualFocusNote, setManualFocusNote] = useState('');
  const [manualFocusCategoryId, setManualFocusCategoryId] = useState<number | null>(null);
  const [manualFocusError, setManualFocusError] = useState<string | null>(null);
  const [showAutoStartSoundPanel, setShowAutoStartSoundPanel] = useState(settings.twoInARowMode);
  const [autoStartSoundPanelExiting, setAutoStartSoundPanelExiting] = useState(false);
  const [isFocusSoundPreviewing, setIsFocusSoundPreviewing] = useState(false);
  const categoryEditorTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoStartSoundPanelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusSoundPreviewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const categoryCardRefsRef = useRef(new Map<number, HTMLDivElement>());
  const previousCategoryTopsRef = useRef<Map<number, number>>(new Map());
  const categoryFlipAnimationsRef = useRef(new Map<number, Animation>());
  const lastCategoryHoverMoveKeyRef = useRef<string | null>(null);
  const lastCategoryReorderAtRef = useRef(0);
  const categoryHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeCategoryPointerIdRef = useRef<number | null>(null);
  const pressedCategoryIdRef = useRef<number | null>(null);
  const pressedCategoryStartRef = useRef<{ x: number; y: number } | null>(null);

  const isLightTheme = settings.themeMode !== 'dark';
  const safeLogs = useMemo(() => (
    Array.isArray(logs) ? logs.map(getSafeLogEntry).filter((entry): entry is LogEntry => Boolean(entry)) : []
  ), [logs]);
  const safePastSessions = useMemo(() => (
    Array.isArray(pastSessions) ? pastSessions.filter(isRenderableSessionRecord) : []
  ), [pastSessions]);
  const safeCategories = useMemo(() => (
    Array.isArray(categories) ? categories.filter(isRenderableCategory) : []
  ), [categories]);
  const safeActiveCategories = useMemo(() => getActiveCategories(safeCategories), [safeCategories]);
  const safeActiveCategoryIds = useMemo(() => safeActiveCategories.map((category) => category.id), [safeActiveCategories]);
  const safeCategoryOrderKey = useMemo(() => safeActiveCategoryIds.join('|'), [safeActiveCategoryIds]);
  const activeCategoryPreviewLabel = useMemo(() => {
    const trimmed = newCategoryName.trim();
    if (trimmed) return trimmed;
    return editingCategoryId !== null ? 'Edit Category' : 'New Category';
  }, [editingCategoryId, newCategoryName]);
  const safeUser = useMemo(() => {
    if (!isRenderableUser(user)) return null;
    const username = user.username.trim();
    return { ...user, username: username || 'Account' };
  }, [user]);
  const safeMembers = useMemo(() => (
    Array.isArray(members) ? members.filter(isRenderableGroupMember) : []
  ), [members]);
  const safeFocusFriends = useMemo(() => (
    Array.isArray(focusFriends.friends) ? focusFriends.friends.filter(isRenderableFocusFriend) : []
  ), [focusFriends.friends]);
  const safeIncomingFocusFriendRequests = useMemo(() => (
    Array.isArray(focusFriends.incomingRequests) ? focusFriends.incomingRequests.filter(isRenderableFocusFriendRequest) : []
  ), [focusFriends.incomingRequests]);
  const safeFocusFriendInbox = useMemo(() => (
    Array.isArray(focusFriends.inbox) ? focusFriends.inbox.filter(isRenderableFocusFriendAction) : []
  ), [focusFriends.inbox]);
  const safeLifetimeStats = useMemo(() => {
    if (!safeUser) return getSafeLifetimeStats(null);
    return getSafeLifetimeStats({
      ...safeUser,
      lifetimeStats: calculateLifetimeStatsFromData(safePastSessions, safeLogs, safeCategories),
    });
  }, [safeCategories, safeLogs, safePastSessions, safeUser]);
  const safeWeeklyStats = useMemo(() => {
    const { startMs, endMs } = getRollingWeekBounds();
    const weeklyLogs = safeLogs.filter((entry) => isIsoWithinMsRange(entry.start, startMs, endMs));
    const weeklySessions = safePastSessions.filter((session) => isIsoWithinMsRange(session.startTime, startMs, endMs));
    return getSafeLifetimeStats({
      username: 'weekly',
      joinedAt: new Date(startMs).toISOString(),
      lifetimeStats: calculateLifetimeStatsFromData(weeklySessions, weeklyLogs, safeCategories),
    });
  }, [safeCategories, safeLogs, safePastSessions]);
  const safeLastAccountSyncAt = useMemo(() => getSafeTimestamp(lastAccountSyncAt), [lastAccountSyncAt]);
  const safeHostSyncConfig = useMemo(() => getSafeSyncConfig(hostSyncConfig), [hostSyncConfig]);
  const safeClientSyncConfig = useMemo(() => getSafeSyncConfig(clientSyncConfig), [clientSyncConfig]);
  const safeGroupSessionId = useMemo(() => getSafeSessionId(groupSessionId), [groupSessionId]);
  const safeUserName = useMemo(() => getSafeText(userName), [userName]);
  const categoriesById = useMemo(() => getCategoryMapById(safeCategories), [safeCategories]);
  const orderedLogs = useMemo(() => {
    return [...safeLogs]
      .filter((entry) => entry.type !== 'task-complete')
      .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
  }, [safeLogs]);
  const groupedLogDays = useMemo(() => {
    const groups = new Map<string, LogEntry[]>();
    orderedLogs.forEach((entry) => {
      const key = getDateKeyFromIso(entry.start) || 'unknown';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(entry);
    });
    return Array.from(groups.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([dateKey, entries]) => {
      const sortedEntries = [...entries].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
      const displayEntries = buildActivityLogDisplayEntries(sortedEntries, categoriesById);
      const totals = sortedEntries.reduce(
        (acc, entry) => {
          if (entry.type === 'work') acc.work += Math.max(0, entry.duration);
          else if (entry.type === 'break') acc.break += Math.max(0, entry.duration);
          else if (entry.type === 'allpause') acc.pause += Math.max(0, entry.duration);
          else if (isGraceLike(entry)) acc.grace += Math.max(0, entry.duration);
          else if (entry.type === 'task-complete') acc.completed += Math.max(0, entry.duration);
          return acc;
        },
        { work: 0, break: 0, pause: 0, grace: 0, completed: 0 },
      );
      const tracked = totals.work + totals.break + totals.pause + totals.grace + totals.completed;
      const firstEntry = sortedEntries[0];
      const lastEntry = sortedEntries[sortedEntries.length - 1];
      return {
        dateKey,
        entries: displayEntries,
        totals,
        tracked,
        firstStart: firstEntry?.start || null,
        lastEnd: lastEntry?.end || firstEntry?.end || null,
      };
    });
  }, [categoriesById, orderedLogs]);

  useEffect(() => {
    if (manualFocusCategoryId === null) return;
    if (!safeActiveCategoryIds.includes(manualFocusCategoryId)) {
      setManualFocusCategoryId(null);
    }
  }, [manualFocusCategoryId, safeActiveCategoryIds]);

  useEffect(() => {
    if (settings.twoInARowMode) {
      if (autoStartSoundPanelTimeoutRef.current) {
        clearTimeout(autoStartSoundPanelTimeoutRef.current);
        autoStartSoundPanelTimeoutRef.current = null;
      }
      setShowAutoStartSoundPanel(true);
      setAutoStartSoundPanelExiting(false);
      return;
    }

    if (!showAutoStartSoundPanel || autoStartSoundPanelExiting) return;
    setAutoStartSoundPanelExiting(true);
    autoStartSoundPanelTimeoutRef.current = setTimeout(() => {
      setShowAutoStartSoundPanel(false);
      setAutoStartSoundPanelExiting(false);
      autoStartSoundPanelTimeoutRef.current = null;
    }, AUTO_START_SOUND_PANEL_EXIT_MS);
  }, [autoStartSoundPanelExiting, settings.twoInARowMode, showAutoStartSoundPanel]);

  const clearFocusSoundPreviewTimer = useCallback(() => {
    if (focusSoundPreviewTimeoutRef.current) {
      clearTimeout(focusSoundPreviewTimeoutRef.current);
      focusSoundPreviewTimeoutRef.current = null;
    }
  }, []);

  const stopSettingsFocusSoundPreview = useCallback(() => {
    clearFocusSoundPreviewTimer();
    stopFocusSoundPreview();
    setIsFocusSoundPreviewing(false);
  }, [clearFocusSoundPreviewTimer]);

  useEffect(() => {
    if (!isFocusSoundPreviewing) return;

    if (!isOpen || displayedTab !== 'settings' || settings.focusSound === 'off') {
      stopSettingsFocusSoundPreview();
      return;
    }

    const previewVolume = clampInt(Math.round(settings.focusSoundVolume ?? 100), 0, 100);
    clearFocusSoundPreviewTimer();
    void startFocusSoundPreview(settings.focusSound, previewVolume, FOCUS_SOUND_PREVIEW_MS).catch(() => {
      clearFocusSoundPreviewTimer();
      setIsFocusSoundPreviewing(false);
    });

    focusSoundPreviewTimeoutRef.current = setTimeout(() => {
      focusSoundPreviewTimeoutRef.current = null;
      setIsFocusSoundPreviewing(false);
    }, FOCUS_SOUND_PREVIEW_MS + 220);
  }, [
    clearFocusSoundPreviewTimer,
    displayedTab,
    isFocusSoundPreviewing,
    isOpen,
    settings.focusSound,
    settings.focusSoundVolume,
    stopSettingsFocusSoundPreview,
  ]);

  useEffect(() => () => {
    clearFocusSoundPreviewTimer();
    stopFocusSoundPreview();
  }, [clearFocusSoundPreviewTimer]);

  const handleFocusSoundPreviewToggle = useCallback(() => {
    if (isFocusSoundPreviewing) {
      stopSettingsFocusSoundPreview();
      return;
    }

    if (settings.focusSound === 'off') return;
    setIsFocusSoundPreviewing(true);
  }, [isFocusSoundPreviewing, settings.focusSound, stopSettingsFocusSoundPreview]);

  const accountError = authLocalError || accountSyncError || focusFriendsError || null;
  const accountDataConflictError = isAccountDataConflictMessage(accountError) ? accountError : null;
  const accountTopError = accountDataConflictError ? null : accountError;
  const lastSyncRelative = useMemo(() => formatRelativeTimeFromMs(safeLastAccountSyncAt), [safeLastAccountSyncAt]);

  const syncStateMeta = useMemo(() => {
    if (isPreviewAccount) {
      return {
        label: 'Preview Mode',
        detail: 'Local-only mock account for previewing the signed-in account screen offline.',
        className: 'text-violet-100 bg-violet-500/15 border-violet-400/30',
        accent: '#C4B5FD',
      };
    }
    if (accountSyncState === 'syncing') {
      return {
        label: 'Syncing',
        detail: 'Pushing queued changes and checking cloud state now.',
        className: 'text-blue-200 bg-blue-500/15 border-blue-400/30',
        accent: '#60A5FA',
      };
    }
    if (accountSyncState === 'pending' && accountError) {
      return {
        label: 'Retry Pending',
        detail: 'Unsynced account changes are queued after the last sync problem.',
        className: 'text-amber-100 bg-amber-500/15 border-amber-400/30',
        accent: '#F59E0B',
      };
    }
    if (accountSyncState === 'pending') {
      return {
        label: 'Changes Queued',
        detail: 'This device changed locally and will push the update automatically.',
        className: 'text-amber-100 bg-amber-500/15 border-amber-400/30',
        accent: '#F59E0B',
      };
    }
    if (accountSyncState === 'synced') {
      return {
        label: 'Synced',
        detail: safeLastAccountSyncAt !== null
          ? `Cloud data and this device matched ${lastSyncRelative}.`
          : 'Cloud data and this device are aligned.',
        className: 'text-emerald-200 bg-emerald-500/15 border-emerald-400/30',
        accent: '#34D399',
      };
    }
    if (accountSyncState === 'error' || accountError) {
      return {
        label: 'Needs Attention',
        detail: 'The latest sync did not complete cleanly.',
        className: 'text-red-200 bg-red-500/15 border-red-400/30',
        accent: '#F87171',
      };
    }
    return {
      label: 'Ready',
      detail: 'Your account is signed in on this device and ready to sync.',
      className: 'text-white/70 bg-white/10 border-white/15',
      accent: '#94A3B8',
    };
  }, [accountError, accountSyncState, isPreviewAccount, lastSyncRelative, safeLastAccountSyncAt]);

  const normalizedUsernameInput = usernameInput.trim().toLowerCase();
  const normalizedFocusFriendUsernameInput = focusFriendUsernameInput.trim().toLowerCase();
  const focusFriendUsernameValidationMessage = normalizedFocusFriendUsernameInput
    ? validateAccountUsernameInput(normalizedFocusFriendUsernameInput)
    : null;
  const isPreviewAccountAuth = isPreviewAccountCredentials(normalizedUsernameInput, passwordInput);
  const usernameValidationMessage = normalizedUsernameInput
    ? validateAccountUsernameInput(normalizedUsernameInput)
    : null;
  const passwordValidationMessage = passwordInput
    ? validateAccountPasswordInput(passwordInput, normalizedUsernameInput)
    : null;
  const isDebugFocusFriendAuth = isDebugFocusFriendCredentials(normalizedUsernameInput, passwordInput);
  const allowsShortAuthPassword = isPreviewAccountAuth || isDebugFocusFriendAuth;
  const canSubmitAuth = Boolean(
    normalizedUsernameInput
      && passwordInput
      && !usernameValidationMessage
      && !passwordValidationMessage
      && !authBusy,
  );

  const categoryBreakdown = useMemo(() => {
    const breakdown = safeLifetimeStats.categoryBreakdown || {};
    return Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  }, [safeLifetimeStats]);
  const categoryColorsByName = useMemo(() => {
    const map = new Map<string, string>(safeCategories.map((category) => [category.name, category.color]));
    safeLogs.forEach((entry) => {
      const resolvedCategory = resolveLogEntryCategory(entry, categoriesById);
      if (resolvedCategory.name && resolvedCategory.color && !map.has(resolvedCategory.name)) {
        map.set(resolvedCategory.name, resolvedCategory.color);
      }
    });
    return map;
  }, [categoriesById, safeCategories, safeLogs]);
  const accountPrimaryColor = useMemo(() => {
    for (const [name] of categoryBreakdown) {
      const categoryColor = categoryColorsByName.get(name);
      if (categoryColor) return categoryColor;
    }
    return PRESET_COLORS[0];
  }, [categoryBreakdown, categoryColorsByName]);
  const groupInviteUrl = useMemo(() => (
    safeGroupSessionId ? buildGroupInviteUrl(safeGroupSessionId) : ''
  ), [safeGroupSessionId]);
  const focusFriendInviteUrl = useMemo(() => (
    safeUser ? buildFocusFriendInviteUrl(safeUser.username) : ''
  ), [safeUser?.username]);
  const isOwnFocusFriendInvite = Boolean(
    safeUser
    && focusFriendInviteUsername
    && safeUser.username.trim().toLowerCase() === focusFriendInviteUsername,
  );

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    setFocusFriendsNowMs(Date.now());
    const interval = window.setInterval(() => setFocusFriendsNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || displayedTab !== 'account' || !safeUser || isPreviewAccount) return;
    void refreshFocusFriends();
  }, [displayedTab, isOpen, isPreviewAccount, refreshFocusFriends, safeUser?.username]);

  const clearSettingsPanelTransitionTimeout = useCallback(() => {
    if (settingsPanelTransitionTimeoutRef.current) {
      clearTimeout(settingsPanelTransitionTimeoutRef.current);
      settingsPanelTransitionTimeoutRef.current = null;
    }
  }, []);

  const registerSettingsTabButton = useCallback((tab: TabButton, node: HTMLButtonElement | null) => {
    if (node) settingsTabButtonRefsRef.current.set(tab, node);
    else settingsTabButtonRefsRef.current.delete(tab);
  }, []);

  const updateSettingsTabIndicator = useCallback(() => {
    if (!isOpen) {
      setSettingsTabIndicatorStyle((prev) => (prev.opacity === 0 ? prev : { ...prev, opacity: 0 }));
      return;
    }

    const activeButton = settingsTabButtonRefsRef.current.get(activeTab);
    if (!activeButton) {
      setSettingsTabIndicatorStyle((prev) => (prev.opacity === 0 ? prev : { ...prev, opacity: 0 }));
      return;
    }

    const nextLeft = activeButton.offsetLeft;
    const nextWidth = activeButton.offsetWidth;
    setSettingsTabIndicatorStyle((prev) => {
      if (
        prev.opacity === 1
        && Math.abs(prev.left - nextLeft) < 0.5
        && Math.abs(prev.width - nextWidth) < 0.5
      ) {
        return prev;
      }
      return { left: nextLeft, width: nextWidth, opacity: 1 };
    });
  }, [activeTab, isOpen]);

  const registerFocusFriendsPageButton = useCallback((page: FocusFriendsPage, node: HTMLButtonElement | null) => {
    if (node) focusFriendsTabButtonRefsRef.current.set(page, node);
    else focusFriendsTabButtonRefsRef.current.delete(page);
  }, []);

  const updateFocusFriendsTabIndicator = useCallback(() => {
    if (!isOpen || displayedTab !== 'account') {
      setFocusFriendsTabIndicatorStyle((prev) => (prev.opacity === 0 ? prev : { ...prev, opacity: 0 }));
      return;
    }

    const activeButton = focusFriendsTabButtonRefsRef.current.get(focusFriendsPage);
    if (!activeButton) {
      setFocusFriendsTabIndicatorStyle((prev) => (prev.opacity === 0 ? prev : { ...prev, opacity: 0 }));
      return;
    }

    const nextLeft = activeButton.offsetLeft;
    const nextWidth = activeButton.offsetWidth;
    setFocusFriendsTabIndicatorStyle((prev) => {
      if (
        prev.opacity === 1
        && Math.abs(prev.left - nextLeft) < 0.5
        && Math.abs(prev.width - nextWidth) < 0.5
      ) {
        return prev;
      }
      return { left: nextLeft, width: nextWidth, opacity: 1 };
    });
  }, [displayedTab, focusFriendsPage, isOpen]);

  const scrollActiveSettingsTabIntoView = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const activeButton = settingsTabButtonRefsRef.current.get(activeTab);
    if (!activeButton) return;
    activeButton.scrollIntoView({
      behavior,
      block: 'nearest',
      inline: 'center',
    });
  }, [activeTab]);

  const syncDisplayedTabImmediately = useCallback((tab: ModalTab) => {
    clearSettingsPanelTransitionTimeout();
    setActiveTab(tab);
    setDisplayedTab(tab);
    setSettingsPanelTransitionPhase('idle');
    setSettingsPanelTransitionDirection('forward');
    if (settingsBodyRef.current) settingsBodyRef.current.scrollTop = 0;
  }, [clearSettingsPanelTransitionTimeout]);

  useEffect(() => {
    if (!isOpen) return;
    const inviteUsername = getFocusFriendInviteUsernameFromCurrentUrl();
    if (!inviteUsername) return;
    setFocusFriendInviteUsername(inviteUsername);
    setFocusFriendsPage('add');
    setAuthLocalError(null);
    syncDisplayedTabImmediately('account');
  }, [isOpen, syncDisplayedTabImmediately]);

  const scrollCategorySettingsSectionIntoView = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const body = settingsBodyRef.current;
    const section = categorySettingsSectionRef.current;
    if (!body || !section) return false;

    const bodyRect = body.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const nextTop = body.scrollTop + sectionRect.top - bodyRect.top - 18;
    body.scrollTo({
      top: Math.max(0, nextTop),
      behavior,
    });
    return true;
  }, []);

  const clearCategoryHoldTimer = useCallback(() => {
    if (categoryHoldTimerRef.current) {
      clearTimeout(categoryHoldTimerRef.current);
      categoryHoldTimerRef.current = null;
    }
  }, []);

  const registerCategoryRef = useCallback((categoryId: number, node: HTMLDivElement | null) => {
    if (node) categoryCardRefsRef.current.set(categoryId, node);
    else categoryCardRefsRef.current.delete(categoryId);
  }, []);

  const cancelCategoryFlipAnimations = useCallback(() => {
    categoryFlipAnimationsRef.current.forEach((animation) => {
      try {
        animation.cancel();
      } catch {
        // no-op
      }
    });
    categoryFlipAnimationsRef.current.clear();
    categoryCardRefsRef.current.forEach((node) => {
      node.style.transform = '';
      node.style.transition = '';
      node.style.willChange = '';
    });
  }, []);

  const snapshotCategoryRects = useCallback(() => {
    const tops = new Map<number, number>();
    const windowScrollY = typeof window !== 'undefined' ? window.scrollY : 0;
    safeActiveCategoryIds.forEach((categoryId) => {
      const node = categoryCardRefsRef.current.get(categoryId);
      if (!node) return;
      const rect = node.getBoundingClientRect();
      tops.set(categoryId, rect.top + windowScrollY);
    });
    previousCategoryTopsRef.current = tops;
  }, [safeActiveCategoryIds]);

  const clearCategoryDragState = useCallback(() => {
    clearCategoryHoldTimer();
    cancelCategoryFlipAnimations();
    activeCategoryPointerIdRef.current = null;
    pressedCategoryIdRef.current = null;
    pressedCategoryStartRef.current = null;
    setDraggingCategoryId(null);
    setCategoryDropHint(null);
    lastCategoryHoverMoveKeyRef.current = null;
    lastCategoryReorderAtRef.current = 0;
  }, [cancelCategoryFlipAnimations, clearCategoryHoldTimer]);

  const handleCategoryDragStart = useCallback((categoryId: number) => {
    cancelCategoryFlipAnimations();
    snapshotCategoryRects();
    setDraggingCategoryId(categoryId);
    setCategoryDropHint(null);
    lastCategoryHoverMoveKeyRef.current = null;
    lastCategoryReorderAtRef.current = 0;
  }, [cancelCategoryFlipAnimations, snapshotCategoryRects]);

  const handleCategoryDragHover = useCallback((targetCategoryId: number, position: DragInsertPosition) => {
    if (!draggingCategoryId || draggingCategoryId === targetCategoryId) return;

    setCategoryDropHint((prev) => (
      prev && prev.categoryId === targetCategoryId && prev.position === position
        ? prev
        : { categoryId: targetCategoryId, position }
    ));

    const categoryIdsWithoutDragged = safeActiveCategoryIds.filter((id) => id !== draggingCategoryId);
    const targetIndex = categoryIdsWithoutDragged.indexOf(targetCategoryId);
    if (targetIndex === -1) return;

    const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
    const toId = insertIndex >= categoryIdsWithoutDragged.length ? -1 : categoryIdsWithoutDragged[insertIndex];
    const moveKey = `${draggingCategoryId}:${toId}`;
    if (lastCategoryHoverMoveKeyRef.current === moveKey) return;

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastCategoryReorderAtRef.current < CATEGORY_REORDER_MIN_INTERVAL_MS) return;

    lastCategoryHoverMoveKeyRef.current = moveKey;
    lastCategoryReorderAtRef.current = now;
    moveCategory(draggingCategoryId, toId);
  }, [draggingCategoryId, moveCategory, safeActiveCategoryIds]);

  useEffect(() => {
    return () => {
      clearSettingsPanelTransitionTimeout();
    };
  }, [clearSettingsPanelTransitionTimeout]);

  useLayoutEffect(() => {
    updateSettingsTabIndicator();
  }, [activeTab, isOpen, updateSettingsTabIndicator]);

  useEffect(() => {
    if (!isOpen) return;

    const tabList = settingsTabListRef.current;
    const activeButton = settingsTabButtonRefsRef.current.get(activeTab);
    if (!tabList || !activeButton) return;

    const frameId = requestAnimationFrame(() => {
      updateSettingsTabIndicator();
      scrollActiveSettingsTabIntoView(activeTab === 'log' ? 'auto' : 'smooth');
    });

    const handleResize = () => updateSettingsTabIndicator();
    window.addEventListener('resize', handleResize);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => updateSettingsTabIndicator());
      resizeObserver.observe(tabList);
      resizeObserver.observe(activeButton);
    }

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
    };
  }, [activeTab, isOpen, scrollActiveSettingsTabIntoView, updateSettingsTabIndicator]);

  useLayoutEffect(() => {
    updateFocusFriendsTabIndicator();
  }, [displayedTab, focusFriendsPage, isOpen, updateFocusFriendsTabIndicator]);

  useEffect(() => {
    if (!isOpen || displayedTab !== 'account') return;

    const tabList = focusFriendsTabListRef.current;
    const activeButton = focusFriendsTabButtonRefsRef.current.get(focusFriendsPage);
    if (!tabList || !activeButton) return;

    const frameId = requestAnimationFrame(updateFocusFriendsTabIndicator);
    const handleResize = () => updateFocusFriendsTabIndicator();
    window.addEventListener('resize', handleResize);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateFocusFriendsTabIndicator);
      resizeObserver.observe(tabList);
      resizeObserver.observe(activeButton);
    }

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
    };
  }, [displayedTab, focusFriendsPage, isOpen, updateFocusFriendsTabIndicator]);

  useEffect(() => {
    return () => {
      clearCategoryHoldTimer();
      cancelCategoryFlipAnimations();
    };
  }, [cancelCategoryFlipAnimations, clearCategoryHoldTimer]);

  useEffect(() => {
    if (!isOpen) {
      clearSettingsPanelTransitionTimeout();
      setActiveTab('settings');
      setDisplayedTab('settings');
      setSettingsPanelTransitionPhase('idle');
      setSettingsPanelTransitionDirection('forward');
      clearCategoryDragState();
      pendingCategorySectionScrollRef.current = false;
    }
  }, [clearCategoryDragState, clearSettingsPanelTransitionTimeout, isOpen]);

  useEffect(() => {
    if (displayedTab !== 'settings') {
      clearCategoryDragState();
    }
  }, [clearCategoryDragState, displayedTab]);

  useEffect(() => {
    if (draggingCategoryId && !safeActiveCategoryIds.includes(draggingCategoryId)) {
      clearCategoryDragState();
    }
  }, [clearCategoryDragState, draggingCategoryId, safeActiveCategoryIds]);

  useLayoutEffect(() => {
    const nextTops = new Map<number, number>();
    const windowScrollY = typeof window !== 'undefined' ? window.scrollY : 0;
    safeActiveCategoryIds.forEach((categoryId) => {
      const node = categoryCardRefsRef.current.get(categoryId);
      if (!node) return;
      const rect = node.getBoundingClientRect();
      nextTops.set(categoryId, rect.top + windowScrollY);
    });

    if (draggingCategoryId === null) {
      previousCategoryTopsRef.current = nextTops;
      return;
    }

    if (safeActiveCategoryIds.length > CATEGORY_FLIP_MAX_ITEMS) {
      previousCategoryTopsRef.current = nextTops;
      return;
    }

    if (previousCategoryTopsRef.current.size === 0) {
      previousCategoryTopsRef.current = nextTops;
      return;
    }

    nextTops.forEach((nextTop, categoryId) => {
      if (categoryId === draggingCategoryId) return;
      const prevTop = previousCategoryTopsRef.current.get(categoryId);
      const node = categoryCardRefsRef.current.get(categoryId);
      if (typeof prevTop !== 'number' || !node) return;

      const deltaY = prevTop - nextTop;
      if (Math.abs(deltaY) < 0.75 || Math.abs(deltaY) > 320) return;

      const existing = categoryFlipAnimationsRef.current.get(categoryId);
      if (existing) {
        try {
          existing.cancel();
        } catch {
          // no-op
        }
      }

      node.style.willChange = 'transform';
      if (typeof node.animate === 'function') {
        const animation = node.animate(
          [
            { transform: `translateY(${deltaY}px)` },
            { transform: 'translateY(0)' },
          ],
          {
            duration: CATEGORY_FLIP_ANIMATION_DURATION_MS,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'both',
          },
        );
        categoryFlipAnimationsRef.current.set(categoryId, animation);
        animation.onfinish = () => {
          if (categoryFlipAnimationsRef.current.get(categoryId) === animation) categoryFlipAnimationsRef.current.delete(categoryId);
          node.style.willChange = '';
          node.style.transform = '';
        };
        animation.oncancel = () => {
          if (categoryFlipAnimationsRef.current.get(categoryId) === animation) categoryFlipAnimationsRef.current.delete(categoryId);
          node.style.willChange = '';
          node.style.transform = '';
        };
      } else {
        node.style.transition = 'transform 0s';
        node.style.transform = `translateY(${deltaY}px)`;
        requestAnimationFrame(() => {
          node.style.transition = `transform ${CATEGORY_FLIP_ANIMATION_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
          node.style.transform = 'translateY(0)';
        });
      }
    });

    previousCategoryTopsRef.current = nextTops;
  }, [draggingCategoryId, safeActiveCategoryIds, safeCategoryOrderKey]);

  useEffect(() => {
    if (!isOpen) return;
    const normalizedPendingJoinId = getSafeSessionId(pendingJoinId);
    if (normalizedPendingJoinId) {
      inviteAutoJoinKeyRef.current = null;
      syncDisplayedTabImmediately('group');
      setGroupFlow('join');
      setGroupSessionInput(normalizedPendingJoinId);
      setInviteSessionId(normalizedPendingJoinId);
      setGroupLocalError(null);
      setPendingJoinId(null);
    }
  }, [isOpen, pendingJoinId, setPendingJoinId, syncDisplayedTabImmediately]);

  useEffect(() => {
    if (accountSyncState === 'pending') {
      setAccountMessage(null);
    }
  }, [accountSyncState]);

  useEffect(() => {
    if (!isOpen) return;
    setGroupName(prev => prev || safeUser?.username || safeUserName || '');
    if (safeGroupSessionId) {
      setHostDraftConfig(safeHostSyncConfig);
      setJoinDraftConfig(safeClientSyncConfig);
      return;
    }
    setHostDraftConfig({ ...DEFAULT_GROUP_CONFIG });
    setJoinDraftConfig({ ...DEFAULT_GROUP_CONFIG });
  }, [isOpen, safeUser?.username, safeUserName, safeGroupSessionId, safeHostSyncConfig, safeClientSyncConfig]);

  const clearFocusFriendEncouragementConfirmationTimer = useCallback(() => {
    if (focusFriendEncouragementConfirmationTimeoutRef.current !== null) {
      clearTimeout(focusFriendEncouragementConfirmationTimeoutRef.current);
      focusFriendEncouragementConfirmationTimeoutRef.current = null;
    }
  }, []);

  const clearFocusFriendEncouragementConfirmation = useCallback(() => {
    clearFocusFriendEncouragementConfirmationTimer();
    setFocusFriendEncouragementConfirmation(null);
  }, [clearFocusFriendEncouragementConfirmationTimer]);

  const showFocusFriendEncouragementConfirmation = useCallback((username: string, message: string) => {
    clearFocusFriendEncouragementConfirmationTimer();
    setFocusFriendEncouragementConfirmation({ username, message, phase: 'visible' });
    focusFriendEncouragementConfirmationTimeoutRef.current = setTimeout(() => {
      setFocusFriendEncouragementConfirmation(current => (
        current?.username === username && current.message === message
          ? { ...current, phase: 'leaving' }
          : current
      ));
      focusFriendEncouragementConfirmationTimeoutRef.current = setTimeout(() => {
        setFocusFriendEncouragementConfirmation(current => (
          current?.username === username && current.message === message ? null : current
        ));
        focusFriendEncouragementConfirmationTimeoutRef.current = null;
      }, FOCUS_FRIEND_CONFIRMATION_EXIT_MS);
    }, FOCUS_FRIEND_CONFIRMATION_VISIBLE_MS);
  }, [clearFocusFriendEncouragementConfirmationTimer]);

  useEffect(() => () => clearFocusFriendEncouragementConfirmationTimer(), [clearFocusFriendEncouragementConfirmationTimer]);

  useEffect(() => {
    if (!isOpen) return;
    if (safeUser) {
      setUsernameInput(safeUser.username);
      setPasswordInput('');
      setAuthLocalError(null);
      setFocusFriendsPage(focusFriendInviteUsername ? 'add' : 'friends');
      setFocusFriendEncouragementMenuUsername(null);
      setFocusFriendEncouragementMenuPlacement('down');
      setFocusFriendEncouragementOptions({});
      clearFocusFriendEncouragementConfirmation();
    }
  }, [clearFocusFriendEncouragementConfirmation, focusFriendInviteUsername, isOpen, safeUser]);

  useEffect(() => {
    setFocusFriendEncouragementMenuUsername(null);
    setFocusFriendEncouragementMenuPlacement('down');
    clearFocusFriendEncouragementConfirmation();
  }, [clearFocusFriendEncouragementConfirmation, focusFriendsPage]);

  useEffect(() => {
    if (!isOpen || displayedTab !== 'account') {
      setFocusFriendEncouragementMenuUsername(null);
      setFocusFriendEncouragementMenuPlacement('down');
      clearFocusFriendEncouragementConfirmation();
    }
  }, [clearFocusFriendEncouragementConfirmation, displayedTab, isOpen]);

  useEffect(() => {
    if (!focusFriendEncouragementMenuUsername) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-focus-friend-encouragement-menu="true"]')) return;
      setFocusFriendEncouragementMenuUsername(null);
      setFocusFriendEncouragementMenuPlacement('down');
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFocusFriendEncouragementMenuUsername(null);
        setFocusFriendEncouragementMenuPlacement('down');
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [focusFriendEncouragementMenuUsername]);

  const updateTimerSettings = (patch: Partial<TimerSettings>) => {
    const nextSettings = { ...settings, ...patch };
    const timerDurationsChanged = (
      'workDuration' in patch
      || 'shortBreakDuration' in patch
      || 'longBreakDuration' in patch
      || 'longBreakInterval' in patch
    );

    if (timerDurationsChanged && !('timerPreset' in patch)) {
      nextSettings.timerPreset = getMatchingTimerPreset(nextSettings);
    }

    if (nextSettings.timerPreset !== 'compact') {
      nextSettings.twoInARowMode = false;
    }

    updateSettings(nextSettings);
  };

  const setTimerPreset = (timerPreset: Exclude<TimerPreset, 'custom'>) => {
    updateTimerSettings({
      timerPreset,
      ...TIMER_PRESETS[timerPreset],
      twoInARowMode: timerPreset === 'compact' ? settings.twoInARowMode : false,
    });
  };

  const setDurationFromMinutes = (
    field: 'workDuration' | 'shortBreakDuration' | 'longBreakDuration',
    rawMinutes: string
  ) => {
    const parsed = Number(rawMinutes);
    if (!Number.isFinite(parsed)) return;
    const seconds = clampInt(parsed, 1, 999) * 60;
    if (field === 'workDuration') updateTimerSettings({ workDuration: seconds });
    if (field === 'shortBreakDuration') updateTimerSettings({ shortBreakDuration: seconds });
    if (field === 'longBreakDuration') updateTimerSettings({ longBreakDuration: seconds });
  };

  const setLongBreakInterval = (rawValue: string) => {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    updateTimerSettings({ longBreakInterval: clampInt(parsed, 1, 24) });
  };

  const handleManualFocusLog = () => {
    const rawHours = manualFocusHoursInput.trim() ? Number(manualFocusHoursInput) : 0;
    const rawMinutes = manualFocusMinutesInput.trim() ? Number(manualFocusMinutesInput) : 0;
    const totalMinutes = (rawHours * 60) + rawMinutes;

    if (!Number.isFinite(rawHours) || !Number.isFinite(rawMinutes) || rawHours < 0 || rawMinutes < 0 || totalMinutes <= 0) {
      setManualFocusError('Enter focused time before logging it.');
      return;
    }
    if (totalMinutes > 24 * 60) {
      setManualFocusError('Log 24 hours or less at a time.');
      return;
    }

    addManualFocusLog(totalMinutes, manualFocusNote, manualFocusCategoryId);
    setManualFocusHoursInput('');
    setManualFocusMinutesInput('');
    setManualFocusNote('');
    setManualFocusError(null);
  };

  const handleTabClick = (tab: TabButton) => {
    if (settingsPanelTransitionPhase !== 'idle') return;
    const direction: SettingsPanelTransitionDirection = TAB_ORDER[tab] >= TAB_ORDER[activeTab] ? 'forward' : 'backward';
    setSettingsPanelTransitionDirection(direction);

    if (tab === 'schedule') {
      setSettingsPanelTransitionPhase('leaving');
      clearSettingsPanelTransitionTimeout();
      settingsPanelTransitionTimeoutRef.current = setTimeout(() => {
        settingsPanelTransitionTimeoutRef.current = null;
        setSettingsPanelTransitionPhase('idle');
        setWeeklyScheduleOpen(true);
        onClose();
      }, SETTINGS_PANEL_TRANSITION_MS);
      return;
    }

    if (tab === activeTab && displayedTab === tab) return;

    setActiveTab(tab);
    setSettingsPanelTransitionPhase('leaving');
    clearSettingsPanelTransitionTimeout();
    settingsPanelTransitionTimeoutRef.current = setTimeout(() => {
      setDisplayedTab(tab);
      if (settingsBodyRef.current) settingsBodyRef.current.scrollTop = 0;
      setSettingsPanelTransitionPhase('entering');
      settingsPanelTransitionTimeoutRef.current = setTimeout(() => {
        settingsPanelTransitionTimeoutRef.current = null;
        setSettingsPanelTransitionPhase('idle');
      }, SETTINGS_PANEL_TRANSITION_MS);
    }, SETTINGS_PANEL_TRANSITION_MS);
  };

  const handleAuthSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (authBusy) return;
    const username = normalizedUsernameInput;
    const isPreviewLogin = isPreviewAccountCredentials(username, passwordInput);
    const isDebugFocusFriendLogin = isDebugFocusFriendCredentials(username, passwordInput);
    if (!username || !passwordInput) {
      setAuthLocalError('Username and password are required.');
      return;
    }
    const usernameError = validateAccountUsernameInput(username);
    if (usernameError) {
      setAuthLocalError(usernameError);
      return;
    }
    const passwordError = validateAccountPasswordInput(passwordInput, username);
    if (passwordError) {
      setAuthLocalError(passwordError);
      return;
    }

    setAuthBusy(true);
    setAuthLocalError(null);
    setAccountMessage(null);

    const authResult = authMode === 'register' && !isDebugFocusFriendLogin
      ? await register(username, passwordInput)
      : await login(username, passwordInput);

    setAuthBusy(false);
    if (!authResult.ok) {
      setAuthLocalError(
        authResult.error || (authMode === 'register' ? 'Unable to create account.' : 'Unable to sign in.')
      );
      return;
    }

    setPasswordInput('');
    setAccountMessage(
      isPreviewLogin
        ? 'Preview account loaded.'
        : isDebugFocusFriendLogin
          ? 'Focus Friends account loaded.'
        : authMode === 'register'
          ? 'Account created and synced.'
          : 'Signed in and synced.',
    );
  };

  const handleSyncNow = async () => {
    if (isPreviewAccount) {
      setAccountMessage('Preview account is local-only and does not sync.');
      return;
    }
    if (accountActionBusy) return;
    setAccountActionBusy('sync');
    setAccountMessage(null);
    const ok = await syncAccountNow();
    if (ok) setAccountMessage('Cloud sync complete.');
    else if (!accountSyncError) setAccountMessage('Cloud sync did not complete.');
    setAccountActionBusy(null);
  };

  const handleRefreshCloud = async () => {
    if (isPreviewAccount) {
      setAccountMessage('Preview account uses bundled sample data only.');
      return;
    }
    if (accountActionBusy) return;
    setAccountActionBusy('refresh');
    setAccountMessage(null);
    const ok = await refreshAccountFromCloud();
    if (ok) setAccountMessage('Pulled latest cloud data.');
    else if (!accountSyncError) setAccountMessage('Could not pull cloud data.');
    setAccountActionBusy(null);
  };

  const runFocusFriendAction = async (
    busyAction: FocusFriendBusyAction,
    action: () => Promise<{ ok: boolean; error: string | null }>,
    successMessage: string,
  ): Promise<boolean> => {
    if (focusFriendBusyAction) return false;
    setFocusFriendBusyAction(busyAction);
    setAuthLocalError(null);
    setAccountMessage(null);
    try {
      const result = await action();
      if (result.ok) {
        setAccountMessage(successMessage);
        return true;
      } else {
        setAuthLocalError(result.error || 'Focus Friends action failed.');
        return false;
      }
    } catch (error) {
      setAuthLocalError(error instanceof Error ? error.message : 'Focus Friends action failed.');
      return false;
    } finally {
      setFocusFriendBusyAction(null);
    }
  };

  const clearFocusFriendJoinFeedbackTimeout = (username: string) => {
    const timeout = focusFriendJoinFeedbackTimeoutsRef.current[username];
    if (!timeout) return;
    clearTimeout(timeout);
    delete focusFriendJoinFeedbackTimeoutsRef.current[username];
  };

  const scheduleFocusFriendJoinFeedbackClear = (username: string, delayMs: number) => {
    clearFocusFriendJoinFeedbackTimeout(username);
    focusFriendJoinFeedbackTimeoutsRef.current[username] = setTimeout(() => {
      delete focusFriendJoinFeedbackTimeoutsRef.current[username];
      setFocusFriendJoinFeedback(prev => {
        if (!prev[username]) return prev;
        const next = { ...prev };
        delete next[username];
        return next;
      });
    }, delayMs);
  };

  const setFocusFriendJoinFeedbackForUser = (
    username: string,
    feedback: Omit<FocusFriendJoinFeedback, 'expiresAtMs'>,
    visibleMs: number,
  ) => {
    setFocusFriendJoinFeedback(prev => ({
      ...prev,
      [username]: {
        ...feedback,
        expiresAtMs: Date.now() + visibleMs,
      },
    }));
    scheduleFocusFriendJoinFeedbackClear(username, visibleMs);
  };

  const stopFocusFriendJoinFollowupPolling = () => {
    const polling = focusFriendJoinFollowupPollingRef.current;
    if (polling.interval) clearInterval(polling.interval);
    if (polling.timeout) clearTimeout(polling.timeout);
    focusFriendJoinFollowupPollingRef.current = { interval: null, timeout: null };
  };

  const startFocusFriendJoinFollowupPolling = () => {
    stopFocusFriendJoinFollowupPolling();
    void refreshFocusFriends({ silent: true });
    focusFriendJoinFollowupPollingRef.current = {
      interval: setInterval(() => {
        void refreshFocusFriends({ silent: true });
      }, FOCUS_FRIEND_JOIN_FOLLOWUP_REFRESH_MS),
      timeout: setTimeout(() => {
        stopFocusFriendJoinFollowupPolling();
      }, FOCUS_FRIEND_JOIN_FOLLOWUP_WINDOW_MS),
    };
  };

  useEffect(() => () => {
    Object.values(focusFriendJoinFeedbackTimeoutsRef.current).forEach(timeout => clearTimeout(timeout));
    focusFriendJoinFeedbackTimeoutsRef.current = {};
    stopFocusFriendJoinFollowupPolling();
  }, []);

  useEffect(() => {
    if (safeGroupSessionId) stopFocusFriendJoinFollowupPolling();
  }, [safeGroupSessionId]);

  const handleRefreshFocusFriends = async () => {
    if (focusFriendBusyAction) return;
    setFocusFriendBusyAction('refresh');
    setAuthLocalError(null);
    setAccountMessage(null);
    const ok = await refreshFocusFriends();
    if (ok) setAccountMessage('Focus Friends refreshed.');
    else if (!focusFriendsError) setAccountMessage('Focus Friends could not refresh.');
    setFocusFriendBusyAction(null);
  };

  const handleSendFocusFriendRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    const username = normalizedFocusFriendUsernameInput;
    if (!username) {
      setAuthLocalError('Enter a username to add a Focus Friend.');
      return;
    }
    const validationMessage = validateAccountUsernameInput(username);
    if (validationMessage) {
      setAuthLocalError(validationMessage);
      return;
    }

    await runFocusFriendAction(
      'send-request',
      () => sendFocusFriendRequest(username),
      `Focus Friend request sent to ${username}.`,
    );
    setFocusFriendUsernameInput('');
  };

  const handleCopyFocusFriendInviteLink = async () => {
    if (!focusFriendInviteUrl) {
      setAuthLocalError('Sign in to copy a Focus Friend invite link.');
      return;
    }

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard unavailable.');
      }
      await navigator.clipboard.writeText(focusFriendInviteUrl);
      setFocusFriendInviteCopied(true);
      setAuthLocalError(null);
      setAccountMessage('Invite link copied.');
      window.setTimeout(() => setFocusFriendInviteCopied(false), 1600);
    } catch {
      setFocusFriendInviteCopied(false);
      setAuthLocalError('Could not copy automatically. Select the link and copy it manually.');
    }
  };

  const handleAcceptFocusFriendRequest = (request: FocusFriendRequest) => {
    void runFocusFriendAction(
      `accept:${request.id}`,
      () => acceptFocusFriendRequest(request.id),
      `${request.fromDisplayName || request.fromUsername} is now a Focus Friend.`,
    );
  };

  const handleAcceptFocusFriendInvite = async (rawUsername: string) => {
    const username = normalizeFocusFriendInviteUsername(rawUsername);
    if (!username) {
      setAuthLocalError('This Focus Friend invite link is invalid.');
      return false;
    }
    if (!safeUser) {
      setAuthMode('login');
      setFocusFriendsPage('add');
      syncDisplayedTabImmediately('account');
      setAuthLocalError('Sign in or create an account to auto add this Focus Friend.');
      return false;
    }
    if (username === safeUser.username.trim().toLowerCase()) {
      setAuthLocalError('You cannot use your own Focus Friend invite.');
      setFocusFriendInviteUsername(null);
      removeFocusFriendInviteParamsFromCurrentUrl();
      return false;
    }
    if (isPreviewAccount) {
      setAuthLocalError('Focus Friend invites need a syncing account.');
      return false;
    }

    const accepted = await runFocusFriendAction(
      `accept-invite:${username}`,
      () => acceptFocusFriendInvite(username),
      `@${username} added as a Focus Friend.`,
    );
    if (accepted) {
      setFocusFriendInviteUsername(null);
      setFocusFriendsPage('friends');
      removeFocusFriendInviteParamsFromCurrentUrl();
    }
    return accepted;
  };

  useEffect(() => {
    if (!isOpen || !focusFriendInviteUsername || !safeUser || isPreviewAccount || focusFriendBusyAction !== null) return;
    const inviteKey = `${safeUser.username.trim().toLowerCase()}:${focusFriendInviteUsername}`;
    if (focusFriendInviteAutoAddKeyRef.current === inviteKey) return;
    focusFriendInviteAutoAddKeyRef.current = inviteKey;
    void handleAcceptFocusFriendInvite(focusFriendInviteUsername);
  }, [focusFriendBusyAction, focusFriendInviteUsername, isOpen, isPreviewAccount, safeUser?.username]);

  const handleDeclineFocusFriendRequest = (request: FocusFriendRequest) => {
    void runFocusFriendAction(
      `decline:${request.id}`,
      () => declineFocusFriendRequest(request.id),
      'Focus Friend request declined.',
    );
  };

  const getFocusFriendEncouragementMenuPlacement = (trigger: HTMLElement): FocusFriendEncouragementMenuPlacement => {
    const settingsBody = trigger.closest('.settings-body');
    const focusFriendsPanel = trigger.closest('.doro-focus-friends-panel');
    const bodyRect = settingsBody?.getBoundingClientRect();
    const panelRect = focusFriendsPanel?.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const estimatedMenuHeight = 240;
    const boundaryTop = Math.max(bodyRect?.top ?? 0, panelRect?.top ?? 0);
    const boundaryBottom = Math.min(bodyRect?.bottom ?? window.innerHeight, panelRect?.bottom ?? window.innerHeight);
    const spaceBelow = boundaryBottom - triggerRect.bottom;
    const spaceAbove = triggerRect.top - boundaryTop;
    return spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow ? 'up' : 'down';
  };

  const handleToggleFocusFriendEncouragementMenu = (friend: FocusFriend, trigger: HTMLElement) => {
    if (focusFriendBusyAction !== null) return;
    setAuthLocalError(null);
    clearFocusFriendEncouragementConfirmation();
    if (focusFriendEncouragementMenuUsername === friend.username) {
      setFocusFriendEncouragementMenuUsername(null);
      setFocusFriendEncouragementMenuPlacement('down');
      return;
    }

    setFocusFriendEncouragementOptions(prev => ({
      ...prev,
      [friend.username]: buildFocusFriendEncouragementOptions(friend),
    }));
    setFocusFriendEncouragementMenuPlacement(getFocusFriendEncouragementMenuPlacement(trigger));
    setFocusFriendEncouragementMenuUsername(friend.username);
  };

  const handleSendFocusFriendEncouragement = (friend: FocusFriend, rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message) {
      setAuthLocalError('Encouragement could not be prepared.');
      return;
    }
    setFocusFriendEncouragementMenuUsername(null);
    setFocusFriendEncouragementMenuPlacement('down');
    clearFocusFriendEncouragementConfirmation();
    void (async () => {
      const sent = await runFocusFriendAction(
        `encourage:${friend.username}`,
        () => sendFocusFriendEncouragement(friend.username, message),
        `Encouragement sent to ${friend.displayName || friend.username}.`,
      );
      if (sent) showFocusFriendEncouragementConfirmation(friend.username, message);
    })();
  };

  const handleRequestFocusFriendJoin = (friend: FocusFriend) => {
    const username = friend.username.trim();
    if (!username || focusFriendBusyAction !== null) return;
    if (friend.presence.status === 'idle' || friend.presence.status === 'offline') {
      setFocusFriendJoinFeedbackForUser(username, {
        phase: 'error',
        message: 'Not active',
      }, FOCUS_FRIEND_JOIN_ERROR_VISIBLE_MS);
      return;
    }

    const currentFeedback = focusFriendJoinFeedback[username];
    if (
      currentFeedback
      && currentFeedback.phase !== 'error'
      && currentFeedback.expiresAtMs > Date.now()
    ) {
      return;
    }

    setFocusFriendEncouragementMenuUsername(null);
    setFocusFriendEncouragementMenuPlacement('down');
    setAuthLocalError(null);
    setAccountMessage(null);
    setFocusFriendBusyAction(`join:${username}`);
    setFocusFriendJoinFeedbackForUser(username, {
      phase: 'sending',
      message: 'Requesting',
    }, FOCUS_FRIEND_JOIN_SENDING_VISIBLE_MS);

    void (async () => {
      try {
        const result = await requestFocusFriendJoin(username, 'Can I join your focus session?');
        if (result.ok) {
          setFocusFriendJoinFeedbackForUser(username, {
            phase: 'sent',
            message: 'Requested',
          }, FOCUS_FRIEND_JOIN_FEEDBACK_VISIBLE_MS);
          startFocusFriendJoinFollowupPolling();
          return;
        }

        const message = result.error || 'Could not send request.';
        setAuthLocalError(message);
        setFocusFriendJoinFeedbackForUser(username, {
          phase: 'error',
          message: 'Try again',
        }, FOCUS_FRIEND_JOIN_ERROR_VISIBLE_MS);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not send request.';
        setAuthLocalError(message);
        setFocusFriendJoinFeedbackForUser(username, {
          phase: 'error',
          message: 'Try again',
        }, FOCUS_FRIEND_JOIN_ERROR_VISIBLE_MS);
      } finally {
        setFocusFriendBusyAction(null);
      }
    })();
  };

  const handleApproveFocusFriendJoinRequest = (action: FocusFriendAction) => {
    const targetUsername = action.fromUsername.trim();
    if (action.type !== 'join-request' || !targetUsername) {
      setAuthLocalError('Choose a valid Focus Friend request first.');
      return;
    }

    void runFocusFriendAction(
      `approve-join:${action.id}`,
      async () => {
        try {
          let sessionId = safeGroupSessionId;
          if (!sessionId) {
            const shareName = groupName.trim() || safeUser?.username || safeUserName || 'Host';
            setGroupName(shareName);
            setHostDraftConfig(TIMER_ONLY_GROUP_SYNC_CONFIG);
            sessionId = await createGroupSession(shareName, TIMER_ONLY_GROUP_SYNC_CONFIG);
          }

          return approveFocusFriendJoinRequest(action.id, sessionId);
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : 'Could not allow this Focus Friend to join.',
          };
        }
      },
      `${action.fromDisplayName || action.fromUsername} can join your focus session.`,
    );
  };

  const handleDeclineFocusFriendJoinRequest = (action: FocusFriendAction) => {
    if (action.type !== 'join-request') {
      setAuthLocalError('Choose a valid Focus Friend request first.');
      return;
    }

    void runFocusFriendAction(
      `decline-join:${action.id}`,
      () => declineFocusFriendJoinRequest(action.id),
      'Join request declined.',
    );
  };

  const handleOpenFocusFriendJoinInvite = (action: FocusFriendAction) => {
    const sessionId = getSafeSessionId(action.sessionId);
    if (action.type !== 'join-invite' || !sessionId) {
      setAuthLocalError('This Focus Friend invite is missing a session code.');
      return;
    }
    if (groupBusy) {
      setAuthLocalError('Group Study is already connecting.');
      return;
    }

    void runFocusFriendAction(
      `open-invite:${action.id}`,
      async () => {
        const joinName = groupName.trim() || safeUser?.username || safeUserName || action.toUsername || 'Focus Friend';
        setGroupSessionInput(sessionId);
        setInviteSessionId(sessionId);
        setGroupFlow('join');
        setGroupName(joinName);
        setJoinDraftConfig(TIMER_ONLY_GROUP_SYNC_CONFIG);
        setGroupLocalError(null);
        syncDisplayedTabImmediately('group');
        setGroupBusy(true);
        try {
          if (safeGroupSessionId !== sessionId) {
            await joinGroupSession(sessionId, joinName, TIMER_ONLY_GROUP_SYNC_CONFIG);
          }
          setPendingJoinId(null);
          if (!action.readAt) {
            await markFocusFriendActionRead(action.id);
          }
          return { ok: true, error: null };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Could not join this Focus Friend session.';
          setGroupLocalError(message);
          return { ok: false, error: message };
        } finally {
          setGroupBusy(false);
        }
      },
      'Joined Focus Friend session.',
    );
  };

  const handleMarkFocusFriendActionRead = (action: FocusFriendAction) => {
    void runFocusFriendAction(
      `read:${action.id}`,
      () => markFocusFriendActionRead(action.id),
      'Friend activity marked read.',
    );
  };

  const toggleHostDraftSync = (key: SyncKey) => {
    setHostDraftConfig(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleJoinDraftSync = (key: SyncKey) => {
    setJoinDraftConfig(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleLiveHostSync = (key: SyncKey) => {
    updateHostSyncConfig({ ...safeHostSyncConfig, [key]: !safeHostSyncConfig[key] });
  };

  const toggleLiveClientSync = (key: SyncKey) => {
    updateClientSyncConfig({ ...safeClientSyncConfig, [key]: !safeClientSyncConfig[key] });
  };

  const handleCreateGroup = async () => {
    if (groupBusy) return;
    const name = groupName.trim();
    if (!name) {
      setGroupLocalError('Enter your name before creating a session.');
      return;
    }
    setGroupBusy(true);
    setGroupLocalError(null);
    try {
      await createGroupSession(name, hostDraftConfig);
    } catch (error) {
      setGroupLocalError(error instanceof Error ? error.message : 'Failed to create session.');
    } finally {
      setGroupBusy(false);
    }
  };

  const buildCurrentTimerShareUrl = (sessionId: string) => {
    const nowMs = Date.now();
    const remainingPomodoros = getRemainingPomodorosForActiveTasks(tasks, getDateKey(new Date(nowMs)));
    const projectedFinishSeconds = remainingPomodoros > 0
      ? getProjectedTaskFinishSeconds({
          remainingPomodoros,
          pomodoroCount,
          workTime,
          breakTime,
          activeMode,
          isIdle,
          graceOpen,
          graceContext,
          settings,
        })
      : 0;
    const projectedFinishEndMs = projectedFinishSeconds > 0 ? nowMs + (projectedFinishSeconds * 1000) : null;
    const shareEndMs = projectedFinishEndMs;
    const latestEndLabel = formatTimerShareEndLabel(
      shareEndMs,
      'No end time',
    );

    return buildTimerSpectatorUrl(sessionId, {
      activeMode,
      endMs: shareEndMs,
      endLabel: latestEndLabel,
      remainingSeconds: projectedFinishSeconds > 0 ? projectedFinishSeconds : null,
      timezoneOffset: new Date().getTimezoneOffset(),
      endKind: 'finish',
    });
  };

  const handleCopyTimerShareLink = async () => {
    if (timerShareBusy) return;
    setTimerShareBusy(true);
    setTimerShareMessage(null);

    try {
      let sessionId = safeGroupSessionId;

      if (!sessionId) {
        const shareName = groupName.trim() || safeUser?.username || safeUserName || 'Host';
        setGroupName(shareName);
        setHostDraftConfig(TIMER_ONLY_GROUP_SYNC_CONFIG);
        sessionId = await createGroupSession(shareName, TIMER_ONLY_GROUP_SYNC_CONFIG);
      }

      const link = buildCurrentTimerShareUrl(sessionId);
      const copied = await copyToClipboard(link);
      setTimerShareMessage(copied ? 'copied' : 'Could not copy link. Try again from this browser.');
    } catch (error) {
      setTimerShareMessage(error instanceof Error ? error.message : 'Failed to prepare spectator link.');
    } finally {
      setTimerShareBusy(false);
    }
  };

  const handleJoinGroup = useCallback(async () => {
    if (groupBusy) return;
    const name = groupName.trim();
    const sessionId = groupSessionInput.trim().toUpperCase();
    if (!name) {
      setGroupLocalError('Enter your name before joining.');
      return;
    }
    if (!sessionId) {
      setGroupLocalError('Enter a valid session ID.');
      return;
    }
    setGroupBusy(true);
    setGroupLocalError(null);
    try {
      await joinGroupSession(sessionId, name, joinDraftConfig);
      setPendingJoinId(null);
    } catch (error) {
      setGroupLocalError(error instanceof Error ? error.message : 'Failed to join session.');
    } finally {
      setGroupBusy(false);
    }
  }, [groupBusy, groupName, groupSessionInput, joinDraftConfig, joinGroupSession, setPendingJoinId]);

  useEffect(() => {
    if (!isOpen || groupBusy || groupSessionId || groupFlow !== 'join') return;
    if (!inviteSessionId || inviteSessionId !== groupSessionInput.trim().toUpperCase()) return;

    const trimmedName = groupName.trim();
    if (!trimmedName) {
      groupNameInputRef.current?.focus();
      groupNameInputRef.current?.select();
      return;
    }

    const inviteKey = `${inviteSessionId}:${trimmedName}`;
    if (inviteAutoJoinKeyRef.current === inviteKey) return;
    inviteAutoJoinKeyRef.current = inviteKey;
    void handleJoinGroup();
  }, [groupBusy, groupFlow, groupName, groupSessionId, groupSessionInput, handleJoinGroup, inviteSessionId, isOpen]);

  useEffect(() => {
    setGroupSyncControlsOpen(false);
    if (groupSessionId) {
      inviteAutoJoinKeyRef.current = null;
    }
  }, [groupSessionId]);

  useEffect(() => {
    return () => {
      if (autoStartSoundPanelTimeoutRef.current) clearTimeout(autoStartSoundPanelTimeoutRef.current);
      if (categoryEditorTransitionTimeoutRef.current) clearTimeout(categoryEditorTransitionTimeoutRef.current);
      pendingCategoryCommitRef.current = null;
    };
  }, []);

  const resetCategoryForm = useCallback(() => {
    setNewCategoryName('');
    setNewCategoryColor(PRESET_COLORS[0]);
    setNewCategoryIcon('star');
    setEditingCategoryId(null);
    setCategoryFormError(null);
    setCategoryEditorCloseState(null);
  }, []);

  const closeCategoryFormImmediately = useCallback(() => {
    if (categoryEditorTransitionTimeoutRef.current) clearTimeout(categoryEditorTransitionTimeoutRef.current);
    if (pendingCategoryCommitRef.current) {
      const commit = pendingCategoryCommitRef.current;
      pendingCategoryCommitRef.current = null;
      commit();
    }
    setShowAddCategory(false);
    resetCategoryForm();
  }, [resetCategoryForm]);

  const closeCategoryForm = useCallback((mode: 'save' | 'cancel' = 'cancel', onAfterClose?: () => void) => {
    if (!showAddCategory) {
      pendingCategoryCommitRef.current = onAfterClose || null;
      closeCategoryFormImmediately();
      return;
    }
    if (categoryEditorTransitionTimeoutRef.current) clearTimeout(categoryEditorTransitionTimeoutRef.current);
    pendingCategoryCommitRef.current = onAfterClose || null;
    setCategoryEditorCloseState(mode);
    categoryEditorTransitionTimeoutRef.current = setTimeout(() => {
      closeCategoryFormImmediately();
    }, CATEGORY_EDITOR_CLOSE_DURATION_MS);
  }, [closeCategoryFormImmediately, showAddCategory]);

  const openNewCategoryForm = useCallback(() => {
    if (categoryEditorTransitionTimeoutRef.current) clearTimeout(categoryEditorTransitionTimeoutRef.current);
    pendingCategoryCommitRef.current = null;
    resetCategoryForm();
    setShowAddCategory(true);
  }, [resetCategoryForm]);

  const openCategoryEditor = useCallback((category: Category) => {
    if (categoryEditorTransitionTimeoutRef.current) clearTimeout(categoryEditorTransitionTimeoutRef.current);
    pendingCategoryCommitRef.current = null;
    setEditingCategoryId(category.id);
    setNewCategoryName(category.name);
    setNewCategoryColor(category.color);
    setNewCategoryIcon(category.icon);
    setCategoryFormError(null);
    setCategoryEditorCloseState(null);
    setShowAddCategory(true);
  }, []);

  const handleCreateCategory = () => {
    const name = newCategoryName.trim();
    if (!name) {
      setCategoryFormError('Enter a category name.');
      return;
    }

    const normalizedName = name.toLowerCase();
    const duplicateCategory = safeActiveCategories.find((category) => (
      category.id !== editingCategoryId
      && category.name.trim().toLowerCase() === normalizedName
    ));
    if (duplicateCategory) {
      setCategoryFormError('Category names need to be unique.');
      return;
    }

    const nextEditingCategoryId = editingCategoryId;
    const nextName = name;
    const nextColor = newCategoryColor;
    const nextIcon = newCategoryIcon;

    closeCategoryForm('save', () => {
      if (nextEditingCategoryId !== null) {
        updateCategory({ id: nextEditingCategoryId, name: nextName, color: nextColor, icon: nextIcon });
      } else {
        addCategory(nextName, nextColor, nextIcon);
      }
    });
  };

  const handleArchiveCategory = (id: number) => {
    pendingCategoryCommitRef.current = null;
    clearCategoryDragState();
    archiveCategory(id);
    if (editingCategoryId === id) {
      closeCategoryFormImmediately();
    }
  };

  const handleCategoryPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>, categoryId: number) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-category-action="true"]')) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;

    clearCategoryHoldTimer();
    activeCategoryPointerIdRef.current = event.pointerId;
    pressedCategoryIdRef.current = categoryId;
    pressedCategoryStartRef.current = { x: event.clientX, y: event.clientY };
    categoryHoldTimerRef.current = setTimeout(() => {
      if (pressedCategoryIdRef.current !== categoryId) return;
      handleCategoryDragStart(categoryId);
    }, CATEGORY_DRAG_HOLD_MS);
  }, [clearCategoryHoldTimer, handleCategoryDragStart]);

  const releaseCategoryPointer = useCallback((pointerId?: number) => {
    if (typeof pointerId === 'number' && activeCategoryPointerIdRef.current !== null && pointerId !== activeCategoryPointerIdRef.current) {
      return;
    }

    if (draggingCategoryId !== null) {
      clearCategoryDragState();
      return;
    }

    clearCategoryHoldTimer();
    activeCategoryPointerIdRef.current = null;
    pressedCategoryIdRef.current = null;
    pressedCategoryStartRef.current = null;
  }, [clearCategoryDragState, clearCategoryHoldTimer, draggingCategoryId]);

  useEffect(() => {
    if (activeCategoryPointerIdRef.current === null && draggingCategoryId === null) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (activeCategoryPointerIdRef.current !== null && event.pointerId !== activeCategoryPointerIdRef.current) return;

      const start = pressedCategoryStartRef.current;
      if (start && draggingCategoryId === null) {
        const distanceX = Math.abs(event.clientX - start.x);
        const distanceY = Math.abs(event.clientY - start.y);
        if (distanceX > CATEGORY_DRAG_CANCEL_DISTANCE_PX || distanceY > CATEGORY_DRAG_CANCEL_DISTANCE_PX) {
          clearCategoryHoldTimer();
          activeCategoryPointerIdRef.current = null;
          pressedCategoryIdRef.current = null;
          pressedCategoryStartRef.current = null;
        }
        return;
      }

      if (draggingCategoryId === null) return;
      event.preventDefault();

      const targetCategory = safeActiveCategories.find((category) => {
        if (category.id === draggingCategoryId) return false;
        const node = categoryCardRefsRef.current.get(category.id);
        if (!node) return false;
        const rect = node.getBoundingClientRect();
        return event.clientY >= rect.top && event.clientY <= rect.bottom;
      });

      if (!targetCategory) return;
      const targetNode = categoryCardRefsRef.current.get(targetCategory.id);
      if (!targetNode) return;
      const rect = targetNode.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const deadZone = Math.max(CATEGORY_DRAG_DEAD_ZONE_MIN_PX, rect.height * CATEGORY_DRAG_DEAD_ZONE_RATIO);
      if (Math.abs(event.clientY - midpoint) <= deadZone) return;

      const position: DragInsertPosition = event.clientY < midpoint ? 'before' : 'after';
      handleCategoryDragHover(targetCategory.id, position);
    };

    const handlePointerUp = (event: PointerEvent) => {
      releaseCategoryPointer(event.pointerId);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [clearCategoryHoldTimer, draggingCategoryId, handleCategoryDragHover, releaseCategoryPointer, safeActiveCategories]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (draggingCategoryId === null) return undefined;

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
    };
  }, [draggingCategoryId]);

  useEffect(() => {
    if (!isOpen) {
      closeCategoryFormImmediately();
    }
  }, [closeCategoryFormImmediately, isOpen]);

  useEffect(() => {
    if (!isOpen || pendingMenuAction !== 'new-category') return;
    pendingCategorySectionScrollRef.current = true;
    syncDisplayedTabImmediately('settings');
    openNewCategoryForm();
    clearPendingMenuAction();
  }, [clearPendingMenuAction, isOpen, openNewCategoryForm, pendingMenuAction, syncDisplayedTabImmediately]);

  useEffect(() => {
    if (
      !isOpen ||
      displayedTab !== 'settings' ||
      !showAddCategory ||
      !pendingCategorySectionScrollRef.current ||
      typeof window === 'undefined'
    ) {
      return;
    }

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        pendingCategorySectionScrollRef.current = false;
        scrollCategorySettingsSectionIntoView('smooth');
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [displayedTab, isOpen, scrollCategorySettingsSectionIntoView, showAddCategory]);

  if (!isOpen) return null;

  const renderLogTab = () => {
    return (
      <div className="p-4 md:p-8 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className={modalPanelTitleClass}>Activity Log</h3>
          </div>
          <button
            type="button"
            onClick={clearLogs}
            className="self-start rounded-lg border border-red-500/20 px-3 py-2 text-[11px] font-semibold tracking-[0.08em] text-white/62 transition-colors hover:border-red-400/28 hover:bg-red-500/8 hover:text-red-100"
          >
            Clear log
          </button>
        </div>

        {orderedLogs.length === 0 && (
          <div className="rounded-[1.45rem] border border-white/8 bg-white/[0.03] px-6 py-12 text-center">
            <div className="text-sm font-semibold text-white/78">No timer activity yet.</div>
            <div className="mt-1 text-sm text-white/44">
              Focus, break, pause, and grace events will appear here after you start a timer.
            </div>
          </div>
        )}

        {orderedLogs.length > 0 && (
          <div className="space-y-3.5">
            {groupedLogDays.map(({ dateKey, entries, totals, tracked, firstStart, lastEnd }) => {
              const daySummaryItems = [
                { label: 'Events', value: `${entries.length}` },
                { label: 'Tracked', value: formatLogDurationCompact(tracked) },
                { label: 'Focus', value: formatLogDurationCompact(totals.work) },
                ...(totals.break > 0 ? [{ label: 'Break', value: formatLogDurationCompact(totals.break) }] : []),
                ...(totals.pause > 0 ? [{ label: 'Pause', value: formatLogDurationCompact(totals.pause) }] : []),
                ...(totals.grace > 0 ? [{ label: 'Grace Time', value: formatLogDurationCompact(totals.grace) }] : []),
              ];

              return (
                <section
                  key={`log-day-${dateKey}`}
                  className="overflow-hidden rounded-[1.45rem] border border-white/8 bg-white/[0.03] shadow-[0_18px_32px_-28px_rgba(0,0,0,0.42)]"
                >
                  <div className="flex flex-col gap-4 border-b border-white/8 px-4 py-4 md:flex-row md:items-end md:justify-between md:px-5">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/38">
                        {formatLogDayLabel(dateKey)}
                      </div>
                      <div className="mt-1 text-base font-semibold tracking-tight text-white">
                        {firstStart && lastEnd ? formatTimeRange(firstStart, lastEnd) : `${entries.length} events`}
                      </div>
                      <div className="mt-1 text-sm text-white/44">
                        {entries.length} activity block{entries.length === 1 ? '' : 's'}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-3 md:justify-end">
                      {daySummaryItems.map((item) => (
                        <div key={`${dateKey}-${item.label}`} className="min-w-[4.4rem]">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/32">
                            {item.label}
                          </div>
                          <div className="mt-1 text-sm font-semibold text-white">
                            {item.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="divide-y divide-white/8">
                    {entries.map((entry, index) => {
                      const hasMiniPomoCompletion = entry.mode === 'focus' && entry.rawEntries.some(
                        (rawEntry) => getPomodoroEquivalentWeightForReason(rawEntry.reason) === 0.5,
                      );
                      const hasManualFocus = entry.mode === 'focus' && entry.rawEntries.some(isManualFocusLog);
                      const modeLabel = entry.mode === 'focus'
                        ? (hasManualFocus ? 'Manual' : hasMiniPomoCompletion ? 'Mini-Pomo' : 'Focus')
                        : entry.mode === 'break'
                          ? 'Break'
                          : entry.mode === 'pause'
                            ? 'Pause'
                            : 'Grace Time';
                      const primaryLabel = getActivityLogPrimaryLabel(entry);
                      const categoryChipColor = entry.categoryColor || PRESET_COLORS[0];

                      return (
                        <div
                          key={`log-row-${dateKey}-${entry.start}-${entry.mode}-${index}`}
                          className="group grid gap-2 px-4 py-3 transition-[background-color,transform,box-shadow] duration-200 ease-out hover:-translate-y-[1px] hover:bg-white/[0.025] hover:shadow-[0_16px_26px_-24px_rgba(0,0,0,0.95)] md:grid-cols-[5.25rem_minmax(0,1fr)_4.75rem] md:items-center md:px-5"
                        >
                          <div className="text-[12px] font-mono font-semibold text-white/72">
                            {formatClockTime(entry.start)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <div className="truncate text-sm font-semibold tracking-tight text-white">
                                {primaryLabel}
                              </div>
                              {entry.categoryName && entry.mode === 'focus' && (
                                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/10 border border-white/5">
                                  {entry.categoryIcon && (
                                    <div className="w-3 h-3 text-white" style={{ color: categoryChipColor }}>
                                      {getIcon(entry.categoryIcon, { size: 12 })}
                                    </div>
                                  )}
                                  <span className="text-[9px] text-white/50 font-bold uppercase">
                                    {entry.categoryName}
                                  </span>
                                </div>
                              )}
                            </div>
                            <div className="mt-1 text-[11px] text-white/34">
                              {formatTimeRange(entry.start, entry.end)}
                            </div>
                          </div>

                          <div className="md:text-right">
                            <div className="text-sm font-mono font-semibold text-white/88">
                              {formatLogDurationCompact(entry.duration)}
                            </div>
                            <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/30">
                              {modeLabel}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderAccountLoggedIn = () => {
    if (!safeUser) return renderAccountSignedOut();

    const stats = safeLifetimeStats;
    const weekStats = safeWeeklyStats;
    const insights = computeAccountInsights({
      logs: safeLogs,
      categories: safeCategories,
      joinedAt: safeUser.joinedAt,
    });
    const joinedAt = formatDateTime(safeUser.joinedAt, 'Unknown');
    const activeDays = Math.max(0, Math.floor(stats.activeDays || 0));
    const weekActiveDays = Math.max(0, Math.floor(weekStats.activeDays || 0));
    const lifetimeCalendarDays = getInclusiveLocalDayCount(safeUser.joinedAt);
    const dailyAvgHours = activeDays > 0 ? stats.totalFocusHours / activeDays : 0;
    const overallDailyAvgHours = stats.totalFocusHours / lifetimeCalendarDays;
    const weekActiveDayAvgHours = weekActiveDays > 0 ? weekStats.totalFocusHours / weekActiveDays : 0;
    const weekOverallDailyAvgHours = weekStats.totalFocusHours / ROLLING_WEEK_DAYS;
    const focusHoursLabel = formatCompactHours(stats.totalFocusHours);
    const totalTimeLabel = formatCompactHours(stats.totalSessionHours || 0);
    const manualFocusHoursLabel = formatCompactHours(stats.manualFocusHours || 0);
    const lastActiveLabel = formatDateKeyLabel(stats.lastActiveDate);
    const profileName = safeUserName.trim();
    const profileNameLabel = profileName && profileName !== safeUser.username ? profileName : 'Matches username';
    const lastCloudCheckLabel = isPreviewAccount ? 'Local only' : formatTimestampDateTime(safeLastAccountSyncAt, 'Never');
    const accountQuickFacts = [
      { label: 'Joined', value: joinedAt },
      { label: 'Last active', value: lastActiveLabel },
      { label: 'Profile name', value: profileNameLabel },
      { label: 'Cloud check', value: lastCloudCheckLabel },
    ];
    const todayTopCategoryColor = insights.today.topCategoryName
      ? (categoryColorsByName.get(insights.today.topCategoryName) || PRESET_COLORS[3])
      : PRESET_COLORS[3];
    const weeklyStatCards: Array<{
      label: string;
      value: string;
      color: string;
      valueClassName?: string;
    }> = [
      { label: 'Focus Time', value: formatCompactHours(weekStats.totalFocusHours), color: accountPrimaryColor },
      { label: 'Total Time', value: formatCompactHours(weekStats.totalSessionHours || 0), color: PRESET_COLORS[5] },
      { label: 'Pomodoros', value: formatPomodoroCount(weekStats.totalPomos), color: PRESET_COLORS[2] },
      { label: 'Sessions', value: `${weekStats.totalSessions}`, color: PRESET_COLORS[1] },
      {
        label: 'Current Streak',
        value: `${weekStats.currentStreak}`,
        color: PRESET_COLORS[3],
      },
      {
        label: 'Active-Day Average',
        value: formatCompactHours(weekActiveDayAvgHours),
        color: PRESET_COLORS[6],
      },
      {
        label: 'Overall Average',
        value: formatCompactHours(weekOverallDailyAvgHours),
        color: PRESET_COLORS[0],
      },
    ];
    const statCards: Array<{
      label: string;
      value: string;
      color: string;
      valueClassName?: string;
    }> = [
      { label: 'Focus Time', value: focusHoursLabel, color: accountPrimaryColor },
      { label: 'Total Time', value: totalTimeLabel, color: PRESET_COLORS[0] },
      { label: 'Manual Focus', value: manualFocusHoursLabel, color: PRESET_COLORS[5] },
      { label: 'Pomodoros', value: formatPomodoroCount(stats.totalPomos), color: PRESET_COLORS[2] },
      { label: 'Sessions', value: `${stats.totalSessions}`, color: PRESET_COLORS[1] },
      {
        label: 'Current Streak',
        value: `${stats.currentStreak}`,
        color: PRESET_COLORS[3],
      },
      {
        label: 'Best Streak',
        value: `${stats.bestStreak}`,
        color: PRESET_COLORS[4],
      },
      {
        label: 'Active-Day Average',
        value: formatCompactHours(dailyAvgHours),
        color: PRESET_COLORS[6],
      },
      {
        label: 'Overall Average',
        value: formatCompactHours(overallDailyAvgHours),
        color: PRESET_COLORS[0],
      },
    ];
    const todayStatCards: Array<{
      label: string;
      value: string;
      color: string;
      valueClassName?: string;
    }> = [
      { label: 'Focus Today', value: insights.today.focusMinutes > 0 ? formatCompactMinutes(insights.today.focusMinutes) : '0m', color: accountPrimaryColor },
      { label: 'Pomodoros', value: formatPomodoroCount(insights.today.pomodoros), color: PRESET_COLORS[2] },
      { label: 'Sessions', value: `${insights.today.sessions}`, color: PRESET_COLORS[1] },
      {
        label: "Today's Top Category",
        value: insights.today.topCategoryName || '--',
        color: todayTopCategoryColor,
        valueClassName: `text-[1.8rem] font-bold tracking-tight leading-tight break-words ${isLightTheme ? 'text-slate-900' : 'text-white'}`,
      },
    ];
    const todayMeta = insights.today.firstStartMinutes !== null
      ? `First start ${formatClockMinutes(insights.today.firstStartMinutes)}`
      : null;
    const accountOverviewSectionStyle: React.CSSProperties = {
      borderColor: isLightTheme ? 'rgba(148, 163, 184, 0.18)' : 'rgba(255, 255, 255, 0.08)',
      backgroundColor: isLightTheme ? 'rgba(255, 255, 255, 0.92)' : 'rgba(16, 20, 27, 0.9)',
      boxShadow: isLightTheme
        ? '0 24px 52px -42px rgba(15, 23, 42, 0.16)'
        : '0 28px 58px -46px rgba(0, 0, 0, 0.7)',
    };
    const accountOverviewChipStyle: React.CSSProperties = {
      borderColor: isLightTheme ? 'rgba(148, 163, 184, 0.22)' : 'rgba(255, 255, 255, 0.1)',
      backgroundColor: isLightTheme ? 'rgba(248, 250, 252, 0.92)' : 'rgba(255, 255, 255, 0.03)',
      color: isLightTheme ? 'rgba(51, 65, 85, 0.84)' : 'rgba(255, 255, 255, 0.66)',
    };
    const accountOverviewGridClassName = 'grid grid-cols-2 gap-3 xl:grid-cols-4';
    const getAccountOverviewCardStyle = (color: string): React.CSSProperties & {
      '--doro-account-stat-rest-shadow': string;
      '--doro-account-stat-hover-shadow': string;
    } => ({
      borderColor: isLightTheme ? 'rgba(148, 163, 184, 0.16)' : 'rgba(255, 255, 255, 0.08)',
      backgroundColor: isLightTheme ? colorToRgba(color, 0.065) : 'rgba(255, 255, 255, 0.028)',
      '--doro-account-stat-rest-shadow': isLightTheme
        ? '0 16px 30px -28px rgba(15, 23, 42, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.74)'
        : '0 18px 34px -30px rgba(0, 0, 0, 0.58), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
      '--doro-account-stat-hover-shadow': isLightTheme
        ? '0 22px 34px -30px rgba(15, 23, 42, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.78)'
        : '0 22px 34px -28px rgba(0, 0, 0, 0.72), inset 0 1px 0 rgba(255, 255, 255, 0.055)',
    });
    const overviewKickerClassName = isLightTheme
      ? 'text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500'
      : 'text-[10px] font-semibold uppercase tracking-[0.14em] text-white/42';
    const overviewHeadingClassName = isLightTheme
      ? 'mt-1 text-lg font-bold tracking-tight text-slate-950'
      : 'mt-1 text-lg font-bold tracking-tight text-white';
    const overviewCardLabelClassName = isLightTheme
      ? 'text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500'
      : 'text-[10px] font-semibold uppercase tracking-[0.14em] text-white/42';
    const overviewCardValueClassName = isLightTheme
      ? 'text-[1.8rem] font-mono font-bold tracking-tight text-slate-950'
      : 'text-[1.8rem] font-mono font-bold tracking-tight text-white';
    const renderAccountOverviewCard = (
      card: { label: string; value: string; color: string; valueClassName?: string },
      index: number,
    ) => (
      <div
        key={card.label}
        className={`doro-account-stat-card group relative overflow-hidden rounded-[1.2rem] border px-4 py-4 md:px-5 md:py-5 transform-gpu transition-[transform,border-color,background-color,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform hover:-translate-y-[2px] hover:scale-[1.01] ${
          isLightTheme ? 'hover:border-slate-300/70' : 'hover:border-white/14'
        }`}
        style={{
          ...getAccountOverviewCardStyle(card.color),
          animationDelay: `${index * 70}ms`,
        }}
      >
        <div className="relative">
          <div className={`${overviewCardLabelClassName} min-h-[1.7rem] pr-1 leading-[1.15] whitespace-normal text-balance`}>
            {card.label}
          </div>
          <div className={`mt-4 ${card.valueClassName || overviewCardValueClassName}`}>
            {card.value}
          </div>
        </div>
        <div className={`pointer-events-none absolute inset-x-4 bottom-0 h-px ${isLightTheme ? 'bg-slate-300/55' : 'bg-white/6'}`} />
        <div
          className="doro-account-stat-rail pointer-events-none absolute inset-x-4 bottom-0 h-[2px] origin-left rounded-full"
          style={{
            backgroundColor: colorToRgba(card.color, isLightTheme ? 0.84 : 0.9),
            animationDelay: `${120 + (index * 70)}ms`,
          }}
        />
      </div>
    );

    const getFocusFriendLastActiveLabel = (friend: FocusFriend) => {
      const relative = formatRelativeTimeFromMs(friend.presence.updatedAtMs);
      if (relative === 'Never') return 'Last active unknown';
      if (relative === 'Just now') return 'Last active just now';
      return `Last active ${relative}`;
    };

    const getFocusFriendLastActiveDetail = (friend: FocusFriend) => {
      const relative = formatFocusFriendSentenceRelativeTimeFromMs(friend.presence.updatedAtMs);
      if (!relative || relative === 'Never') return 'has no recent activity';
      return `Last Active ${relative}`;
    };

    const getFriendTimerMeta = (friend: FocusFriend) => {
      const timer = friend.presence.timer;
      const estimate = getTimerShareEstimateFromSpectatorState(timer, focusFriendsNowMs);
      const isBreak = friend.presence.status === 'break' || timer?.runtime?.phase === 'running-break' || timer?.activeMode === 'break';
      const pomoMeta = getFocusFriendPomoMeta(friend);
      const inactiveDetailLabel = friend.presence.status === 'idle' || friend.presence.status === 'offline'
        ? getFocusFriendLastActiveLabel(friend)
        : null;
      return {
        remainingLabel: formatTimerShareDuration(estimate.remainingSeconds),
        detailLabel: inactiveDetailLabel || formatTimerShareEndLabel(estimate.endMs, estimate.status === 'idle' ? 'Not running' : 'No end time'),
        taskLabel: isBreak ? '' : timer?.activeTaskName || 'No selected task',
        categoryLabel: isBreak ? 'Break' : timer?.activeCategoryName || 'Uncategorized',
        categoryColor: isBreak ? PRESET_COLORS[1] : timer?.activeColor || timer?.activeCategoryColor || accountPrimaryColor,
        categoryIcon: isBreak ? undefined : timer?.activeCategoryIcon,
        pomoLabel: pomoMeta.displayLabel,
        isBreak,
        status: estimate.status,
      };
    };

    const getFocusFriendActivityMeta = (friend: FocusFriend, timerMeta: ReturnType<typeof getFriendTimerMeta>) => {
      const displayName = friend.displayName || friend.username;
      if (friend.presence.status === 'idle' || friend.presence.status === 'offline') {
        return {
          displayName,
          actionLabel: getFocusFriendLastActiveDetail(friend),
          targetLabel: '',
        };
      }
      if (friend.presence.status === 'break' || timerMeta.isBreak) {
        return {
          displayName,
          actionLabel: 'is taking a break',
          targetLabel: '',
        };
      }
      if (friend.presence.status === 'paused') {
        return {
          displayName,
          actionLabel: 'paused their timer',
          targetLabel: '',
        };
      }
      if (friend.presence.status === 'grace') {
        return {
          displayName,
          actionLabel: 'is wrapping up',
          targetLabel: '',
        };
      }

      const focusTarget = timerMeta.categoryLabel && timerMeta.categoryLabel !== 'Uncategorized'
        ? timerMeta.categoryLabel
        : timerMeta.taskLabel && timerMeta.taskLabel !== 'No selected task'
          ? timerMeta.taskLabel
          : 'a focus session';
      return {
        displayName,
        actionLabel: 'is working on',
        targetLabel: focusTarget,
      };
    };

    const focusFriendRowClassName = `doro-focus-friend-item rounded-[1.05rem] border px-4 py-3 transition-[background-color,border-color,transform,box-shadow] duration-200 ${
      isLightTheme
        ? 'border-slate-200/75 bg-white/72 hover:border-slate-300/80 hover:bg-white'
        : 'border-white/[0.075] bg-white/[0.026] hover:border-white/[0.12] hover:bg-white/[0.045]'
    }`;
    const focusFriendMemberRowClassName = `doro-focus-friend-item doro-focus-friend-card doro-focus-friend-member-row group relative overflow-visible rounded-[1.05rem] border px-3 py-2.5 transition-[background-color,border-color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
      isLightTheme
        ? 'border-slate-200/60 bg-white/72 hover:border-slate-300/70'
        : 'border-white/[0.075] bg-white/[0.026] hover:border-white/[0.12]'
    }`;
    const focusFriendInsetClassName = `rounded-lg border ${
      isLightTheme ? 'border-slate-200/75 bg-white/72' : 'border-white/[0.075] bg-white/[0.026]'
    }`;
    const focusFriendMutedTextClassName = isLightTheme ? 'text-slate-500' : 'text-white/45';
    const focusFriendBodyTextClassName = isLightTheme ? 'text-slate-700' : 'text-white/66';
    const focusFriendStrongTextClassName = isLightTheme ? 'text-slate-950' : 'text-white';
    const focusFriendButtonBaseClassName = 'doro-focus-friend-button inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-center text-[10px] font-bold uppercase tracking-[0.12em] transition-[background-color,border-color,color,transform] duration-200 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45';
    const focusFriendPrimaryButtonClassName = `${focusFriendButtonBaseClassName} ${
      isLightTheme
        ? 'border-slate-900 bg-slate-950 text-white hover:bg-slate-800'
        : 'border-white/[0.16] bg-white text-slate-950 hover:bg-white/88'
    }`;
    const focusFriendNeutralButtonClassName = `${focusFriendButtonBaseClassName} ${
      isLightTheme
        ? 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-950'
        : 'border-white/10 bg-white/[0.04] text-white/72 hover:border-white/16 hover:bg-white/[0.08] hover:text-white'
    }`;
    const focusFriendDangerButtonClassName = `${focusFriendButtonBaseClassName} ${
      isLightTheme
        ? 'border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100/70'
        : 'border-red-400/18 bg-red-500/[0.035] text-red-100/72 hover:border-red-300/22 hover:bg-red-500/[0.07] hover:text-red-100'
    }`;
    const getFocusFriendPageButtonClassName = (page: FocusFriendsPage) => {
      const active = focusFriendsPage === page;
      return `settings-tab-btn doro-focus-friends-tab-btn flex-1 py-3 px-4 font-bold text-[10px] uppercase tracking-[0.16em] whitespace-nowrap ${
        active ? 'is-active' : ''
      }`;
    };
    const renderFocusFriendRequest = (request: FocusFriendRequest, index = 0) => (
      <div
        key={request.id}
        className={`${focusFriendRowClassName} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}
        style={{ animationDelay: `${70 + (index * 45)}ms` }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <UserPlus size={16} strokeWidth={2.2} className={`shrink-0 ${focusFriendMutedTextClassName}`} />
          <div className="min-w-0">
            <div className={`truncate text-sm font-bold ${focusFriendStrongTextClassName}`}>
              {request.fromDisplayName || request.fromUsername}
            </div>
            <div className={`mt-1 text-xs ${focusFriendMutedTextClassName}`}>
              @{request.fromUsername} sent a request {formatRelativeTimeFromMs(Date.parse(request.createdAt))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <button
            type="button"
            onClick={() => handleAcceptFocusFriendRequest(request)}
            disabled={focusFriendBusyAction !== null}
            className={focusFriendPrimaryButtonClassName}
            aria-label={`Accept Focus Friend request from ${request.fromUsername}`}
          >
            <Check size={14} strokeWidth={2.4} />
            Accept
          </button>
          <button
            type="button"
            onClick={() => handleDeclineFocusFriendRequest(request)}
            disabled={focusFriendBusyAction !== null}
            className={focusFriendDangerButtonClassName}
            aria-label={`Decline Focus Friend request from ${request.fromUsername}`}
          >
            <X size={14} strokeWidth={2.4} />
            Decline
          </button>
        </div>
      </div>
    );

    const renderFocusFriendActivity = (action: FocusFriendAction, index = 0) => {
      const isJoinRequest = action.type === 'join-request';
      const isJoinInvite = action.type === 'join-invite';
      const inviteSessionId = getSafeSessionId(action.sessionId);
      const actionLabel = isJoinRequest ? 'Join request' : isJoinInvite ? 'Session invite' : 'Encouragement';
      const actionIcon = isJoinRequest
        ? <Users size={15} className={focusFriendMutedTextClassName} />
        : isJoinInvite
          ? <LinkIcon size={15} className={focusFriendMutedTextClassName} />
          : <Heart size={15} className={focusFriendMutedTextClassName} />;

      return (
        <div
          key={action.id}
          className={`${focusFriendRowClassName} flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between`}
          style={{ animationDelay: `${95 + (index * 45)}ms` }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              {actionIcon}
              <div>
                <div className={`text-sm font-bold leading-tight ${focusFriendStrongTextClassName}`}>
                  {action.fromDisplayName || action.fromUsername}
                </div>
                <div className={`text-[11px] ${focusFriendMutedTextClassName}`}>
                  {actionLabel} - {formatRelativeTimeFromMs(Date.parse(action.createdAt))}
                </div>
              </div>
            </div>
            <div className={`mt-3 text-sm leading-relaxed ${focusFriendBodyTextClassName}`}>
              {action.message}
            </div>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
            {isJoinRequest && !action.readAt && (
              <>
                <button
                  type="button"
                  onClick={() => handleApproveFocusFriendJoinRequest(action)}
                  disabled={focusFriendBusyAction !== null}
                  className={focusFriendPrimaryButtonClassName}
                  aria-label={`Allow ${action.fromUsername} to join your focus session`}
                >
                  <Check size={14} strokeWidth={2.4} />
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => handleDeclineFocusFriendJoinRequest(action)}
                  disabled={focusFriendBusyAction !== null}
                  className={focusFriendNeutralButtonClassName}
                  aria-label={`Decline ${action.fromUsername}'s focus session join request`}
                >
                  <X size={14} strokeWidth={2.4} />
                  No
                </button>
              </>
            )}
            {isJoinInvite && (
              <button
                type="button"
                onClick={() => handleOpenFocusFriendJoinInvite(action)}
                disabled={focusFriendBusyAction !== null || !inviteSessionId}
                className={focusFriendPrimaryButtonClassName}
                aria-label={`Join ${action.fromUsername}'s focus session`}
                title={inviteSessionId ? 'Join session' : 'Invite missing session code'}
              >
                <LogIn size={14} strokeWidth={2.4} />
                Join
              </button>
            )}
            {!action.readAt && !isJoinRequest && (
              <button
                type="button"
                onClick={() => handleMarkFocusFriendActionRead(action)}
                disabled={focusFriendBusyAction !== null}
                className={focusFriendNeutralButtonClassName}
                aria-label="Mark friend activity read"
              >
                <Check size={14} strokeWidth={2.4} />
                Read
              </button>
            )}
          </div>
        </div>
      );
    };

    const renderFocusFriendCard = (friend: FocusFriend, index = 0) => {
      const timerMeta = getFriendTimerMeta(friend);
      const canRequestJoin = friend.presence.status !== 'idle' && friend.presence.status !== 'offline';
      const activityMeta = getFocusFriendActivityMeta(friend, timerMeta);
      const encouragementOptions = focusFriendEncouragementOptions[friend.username] || [];
      const encouragementMenuOpen = focusFriendEncouragementMenuUsername === friend.username;
      const encouragementConfirmationVisible = focusFriendEncouragementConfirmation?.username === friend.username;
      const joinFeedback = focusFriendJoinFeedback[friend.username];
      const joinFeedbackVisible = Boolean(joinFeedback && joinFeedback.expiresAtMs > Date.now());
      const isJoinRequestBusy = focusFriendBusyAction === `join:${friend.username}`;
      const showJoinFeedback = joinFeedbackVisible || isJoinRequestBusy;
      const displayInitial = activityMeta.displayName.trim().slice(0, 1) || friend.username.slice(0, 1) || '?';
      const avatarIconKey = friend.presence.status === 'focusing'
        ? getFocusFriendAvatarIconKey(timerMeta.categoryIcon)
        : null;
      const avatarIcon = avatarIconKey
        ? getIcon(avatarIconKey, {
            size: 18,
            strokeWidth: 2.25,
            className: 'shrink-0',
            'aria-hidden': true,
          })
        : null;
      const friendAccentColor = getTaskPaletteColor(
        timerMeta.categoryColor || accountPrimaryColor,
        `${friend.username}:${timerMeta.categoryLabel}:${timerMeta.taskLabel}`,
      );
      const friendAccentSoft = colorToRgba(friendAccentColor, canRequestJoin ? (isLightTheme ? 0.18 : 0.2) : (isLightTheme ? 0.08 : 0.1));
      const friendAccentLine = colorToRgba(friendAccentColor, canRequestJoin ? (isLightTheme ? 0.48 : 0.42) : (isLightTheme ? 0.22 : 0.2));
      const friendSurfaceColor = isLightTheme ? 'rgba(255, 255, 255, 0.78)' : 'rgba(255, 255, 255, 0.035)';
      const friendRowShadow = isLightTheme
        ? '0 18px 26px -18px rgba(15, 23, 42, 0.24)'
        : '0 18px 26px -18px rgba(0, 0, 0, 0.72)';
      const friendNameColor = canRequestJoin
        ? friendAccentColor
        : (isLightTheme ? 'rgba(100, 116, 139, 0.82)' : 'rgba(255, 255, 255, 0.34)');
      const friendChipTextColor = isLightTheme ? 'rgba(30, 41, 59, 0.84)' : 'rgba(255, 255, 255, 0.76)';
      const activityActionText = activityMeta.actionLabel.replace(/^is\s+/, '');
      const ignoreNestedFocusFriendAction = (target: EventTarget | null) => (
        target instanceof HTMLElement
        && Boolean(target.closest('button, a, input, select, textarea, [data-focus-friend-encouragement-menu="true"]'))
      );
      const requestJoinFromCard = (target: EventTarget | null) => {
        if (!canRequestJoin || ignoreNestedFocusFriendAction(target)) return;
        handleRequestFocusFriendJoin(friend);
      };

      return (
        <div
          key={friend.username}
          className={`${focusFriendMemberRowClassName} ${canRequestJoin ? 'doro-focus-friend-card-active doro-focus-friend-card-requestable' : 'doro-focus-friend-card-inactive'} ${showJoinFeedback ? 'doro-focus-friend-card-join-feedback' : ''} ${encouragementMenuOpen ? 'doro-focus-friend-card-menu-open' : ''} outline-none`}
          role={canRequestJoin ? 'button' : undefined}
          aria-label={canRequestJoin ? `Ask to join ${activityMeta.displayName}'s focus session` : undefined}
          tabIndex={0}
          title={canRequestJoin ? `Ask to join ${activityMeta.displayName}'s focus session` : undefined}
          onClick={event => requestJoinFromCard(event.target)}
          onKeyDown={event => {
            if (!canRequestJoin || ignoreNestedFocusFriendAction(event.target)) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            handleRequestFocusFriendJoin(friend);
          }}
          style={{
            animationDelay: `${110 + (index * 45)}ms`,
            backgroundColor: friendSurfaceColor,
            borderColor: canRequestJoin
              ? colorToRgba(friendAccentColor, isLightTheme ? 0.34 : 0.3)
              : isLightTheme ? 'rgba(148, 163, 184, 0.18)' : 'rgba(255, 255, 255, 0.065)',
            boxShadow: friendRowShadow,
          } as React.CSSProperties}
        >
          <div className="doro-focus-friend-card-grid grid min-w-0 grid-cols-[2.6rem_minmax(0,1fr)_auto] items-center gap-3">
            <div className="doro-focus-friend-avatar relative h-10 w-10 shrink-0">
              <div
                className={`doro-focus-friend-avatar-inner flex h-10 w-10 items-center justify-center rounded-xl border text-sm font-black uppercase ${
                  isLightTheme ? 'text-slate-800' : 'text-white/82'
                }`}
                style={{
                  backgroundColor: friendAccentSoft,
                  borderColor: friendAccentLine,
                }}
              >
                {avatarIcon || displayInitial}
              </div>
            </div>

            <div className="doro-focus-friend-main min-w-0">
              <div className="doro-focus-friend-summary-row flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                <span
                  className="doro-focus-friend-name min-w-0 max-w-full truncate text-[0.95rem] font-bold leading-snug"
                  style={{
                    color: friendNameColor,
                  }}
                >
                  {activityMeta.displayName}
                </span>
                {canRequestJoin ? (
                  <>
                    {timerMeta.pomoLabel ? (
                      <span
                        className="doro-focus-friend-metric inline-flex h-5 shrink-0 items-center text-[10px] font-black uppercase leading-none"
                        style={{
                          color: friendChipTextColor,
                        }}
                      >
                        {timerMeta.pomoLabel}
                      </span>
                    ) : null}
                    <span
                      className="doro-focus-friend-metric inline-flex h-5 shrink-0 items-center gap-1 text-[10px] font-black uppercase leading-none"
                      style={{
                        color: friendChipTextColor,
                      }}
                    >
                      <span className="doro-focus-friend-timer-icon-wrap" aria-hidden="true">
                        <TimerIcon className="doro-focus-friend-timer-icon" style={{ color: friendAccentColor }} />
                      </span>
                      {timerMeta.remainingLabel}
                    </span>
                    {timerMeta.status !== 'running' && (
                      <span className={`doro-focus-friend-metric-detail min-w-0 truncate text-xs ${focusFriendMutedTextClassName}`}>{timerMeta.detailLabel}</span>
                    )}
                  </>
                ) : null}
              </div>
              <div className={`doro-focus-friend-activity-line mt-0.5 flex min-w-0 items-center gap-1.5 text-[0.78rem] font-semibold leading-tight ${
                canRequestJoin ? focusFriendMutedTextClassName : isLightTheme ? 'text-slate-400' : 'text-white/24'
              }`}>
                <span className="truncate">
                  {activityActionText}
                  {activityMeta.targetLabel ? (
                    <span
                      style={{
                        color: canRequestJoin ? friendAccentColor : undefined,
                      }}
                    >
                      {' '}
                      {activityMeta.targetLabel}
                    </span>
                  ) : null}
                </span>
              </div>
            </div>

            <div className="doro-focus-friend-action-rail flex w-[8.85rem] max-w-[36vw] shrink-0 items-center justify-end gap-1.5">
              {encouragementConfirmationVisible ? (
                <div
                  className={`doro-focus-friend-confirmation doro-focus-friend-confirmation-inline flex h-8 w-full min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-semibold ${
                    focusFriendEncouragementConfirmation?.phase === 'leaving' ? 'doro-focus-friend-confirmation-leaving' : ''
                  }`}
                  role="status"
                  aria-live="polite"
                >
                  <Heart size={14} strokeWidth={2.45} className="doro-focus-friend-confirmation-heart shrink-0" aria-hidden="true" />
                  <span className="doro-focus-friend-confirmation-label relative z-[1] truncate">Encouragement sent</span>
                </div>
              ) : showJoinFeedback ? (
                <div
                  className={`doro-focus-friend-join-feedback doro-focus-friend-join-feedback-${joinFeedback?.phase || 'sending'} flex h-8 w-full min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-semibold`}
                  role="status"
                  aria-live="polite"
                >
                  {joinFeedback?.phase === 'error' ? (
                    <X size={13} strokeWidth={2.45} className="shrink-0" aria-hidden="true" />
                  ) : joinFeedback?.phase === 'sent' ? (
                    <Check size={13} strokeWidth={2.45} className="shrink-0" aria-hidden="true" />
                  ) : (
                    <span className="doro-focus-friend-join-spinner shrink-0" aria-hidden="true" />
                  )}
                  <span className="truncate">{joinFeedback?.message || 'Requesting'}</span>
                </div>
              ) : (
                <div className="doro-focus-friend-hover-actions flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                  <div
                    className="doro-focus-friend-encouragement relative"
                    data-focus-friend-encouragement-menu="true"
                  >
                    <button
                      type="button"
                      onPointerDown={event => event.stopPropagation()}
                      onClick={event => {
                        event.stopPropagation();
                        handleToggleFocusFriendEncouragementMenu(friend, event.currentTarget);
                      }}
                      disabled={focusFriendBusyAction !== null}
                      className={`${focusFriendNeutralButtonClassName} doro-focus-friend-hover-button doro-focus-friend-icon-button ${encouragementMenuOpen ? 'is-open' : ''}`}
                      aria-haspopup="listbox"
                      aria-expanded={encouragementMenuOpen}
                      aria-label={`Choose encouragement for ${friend.username}`}
                      data-tooltip="Encourage"
                      title="Encourage"
                    >
                      <Heart size={15} strokeWidth={2.35} aria-hidden="true" />
                    </button>
                    {encouragementMenuOpen && (
                      <div
                        className={`doro-focus-friend-encouragement-menu ${
                          focusFriendEncouragementMenuPlacement === 'up' ? 'doro-focus-friend-encouragement-menu-up' : ''
                        }`}
                        role="listbox"
                        aria-label={`Encouragement options for ${friend.username}`}
                      >
                        {encouragementOptions.map(prompt => (
                          <button
                            key={`${prompt.kind}:${prompt.message}`}
                            type="button"
                            role="option"
                            data-kind={prompt.kind}
                            onClick={event => {
                              event.stopPropagation();
                              handleSendFocusFriendEncouragement(friend, prompt.message);
                            }}
                            disabled={focusFriendBusyAction !== null}
                            className="doro-focus-friend-encouragement-option"
                          >
                            {prompt.message}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onPointerDown={event => event.stopPropagation()}
                    onClick={event => {
                      event.stopPropagation();
                      handleRequestFocusFriendJoin(friend);
                    }}
                    disabled={focusFriendBusyAction !== null || !canRequestJoin}
                    className={`${focusFriendNeutralButtonClassName} doro-focus-friend-hover-button doro-focus-friend-icon-button`}
                    aria-label={`Request to join ${friend.username}'s focus session`}
                    data-tooltip={canRequestJoin ? 'Join' : 'No active session'}
                    title={canRequestJoin ? 'Request to join' : 'No active session'}
                  >
                    <Send size={15} strokeWidth={2.35} aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    };

    const unreadFriendActivityCount = safeFocusFriendInbox.filter(action => !action.readAt).length;
    const focusFriendAddBadgeCount = safeIncomingFocusFriendRequests.length + unreadFriendActivityCount;
    const onlineFocusFriends = safeFocusFriends.filter(friend => friend.presence.status !== 'idle' && friend.presence.status !== 'offline');
    const offlineFocusFriends = safeFocusFriends.filter(friend => friend.presence.status === 'idle' || friend.presence.status === 'offline');
    const renderFocusFriendListSection = (label: string, friends: FocusFriend[], startIndex = 0) => (
      friends.length > 0 ? (
        <div className="space-y-2">
          <div className={`flex items-center gap-2 px-1 text-[10px] font-semibold uppercase leading-none tracking-[0.14em] ${
            isLightTheme ? 'text-slate-500' : 'text-white/42'
          }`}>
            <span>{label}</span>
          </div>
          <div className="grid gap-2">
            {friends.map((friend, index) => renderFocusFriendCard(friend, startIndex + index))}
          </div>
        </div>
      ) : null
    );

    return (
      <div className="p-4 md:p-8 space-y-5">
        {(accountTopError || accountMessage) && (
          <div className="grid gap-3 md:grid-cols-2">
            {accountTopError && (
              <div className="rounded-2xl border border-red-500/28 bg-red-500/12 px-4 py-3 text-sm text-red-100">
                {accountTopError}
              </div>
            )}
            {accountMessage && (
              <div className="rounded-2xl border border-emerald-500/26 bg-emerald-500/12 px-4 py-3 text-sm text-emerald-100">
                {accountMessage}
              </div>
            )}
          </div>
        )}

        <div
          className="relative overflow-hidden rounded-[1.7rem] border p-5 md:p-6"
          style={accountOverviewSectionStyle}
        >
          <div className="relative space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className={`${overviewHeadingClassName} mt-0`}>Today's Snapshot</div>
              </div>
              {todayMeta && (
                <div className="rounded-full border px-3 py-1.5 text-[11px] font-medium" style={accountOverviewChipStyle}>
                  {todayMeta}
                </div>
              )}
            </div>

            <div className={accountOverviewGridClassName}>
              {todayStatCards.map((card, index) => renderAccountOverviewCard(card, index))}
            </div>
          </div>
        </div>

        <div
          className="relative overflow-hidden rounded-[1.7rem] border p-5 md:p-6"
          style={accountOverviewSectionStyle}
        >
          <div className="relative space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className={`${overviewHeadingClassName} mt-0`}>Week's Snapshot</div>
              </div>
            </div>

            <div className={accountOverviewGridClassName}>
              {weeklyStatCards.map((card, index) => renderAccountOverviewCard(card, index))}
            </div>
          </div>
        </div>

        <div
          className="relative overflow-hidden rounded-[1.7rem] border p-5 md:p-6"
          style={accountOverviewSectionStyle}
        >
          <div className="relative space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className={`${overviewHeadingClassName} mt-0`}>Lifetime totals</div>
              </div>
            </div>

            <div className={accountOverviewGridClassName}>
              {statCards.map((card, index) => renderAccountOverviewCard(card, index))}
            </div>
          </div>
        </div>

        <AccountInsights
          logs={safeLogs}
          categories={safeCategories}
          joinedAt={safeUser.joinedAt}
          accentColor={accountPrimaryColor}
          isLightTheme={isLightTheme}
          showTodayStats={false}
        />

        <div
          className={`doro-focus-friends-panel relative overflow-visible rounded-[1.7rem] border p-5 md:p-6 ${
            focusFriendEncouragementMenuUsername ? 'doro-focus-friends-panel-menu-open' : ''
          }`}
          style={accountOverviewSectionStyle}
        >
          <div className="doro-focus-friends-section relative space-y-4" aria-busy={focusFriendsLoading}>
            <div className="doro-focus-friends-header flex flex-wrap items-center justify-between gap-3">
              <div className={`${overviewHeadingClassName} doro-focus-friends-heading mt-0 flex items-center gap-2`}>
                <Users size={18} />
                Focus Friends
              </div>
              <div className="settings-tabbar doro-focus-friends-tabbar flex shrink-0">
                <div
                  ref={focusFriendsTabListRef}
                  className="settings-tablist doro-focus-friends-tablist relative flex min-w-full"
                >
                  <div
                    aria-hidden="true"
                    className="settings-tab-indicator doro-focus-friends-tab-indicator"
                    style={{
                      width: focusFriendsTabIndicatorStyle.width,
                      opacity: focusFriendsTabIndicatorStyle.opacity,
                      transform: `translate3d(${focusFriendsTabIndicatorStyle.left}px, 0, 0)`,
                    }}
                  />
                  <button
                    ref={(node) => registerFocusFriendsPageButton('friends', node)}
                    type="button"
                    onClick={() => setFocusFriendsPage('friends')}
                    className={getFocusFriendPageButtonClassName('friends')}
                    aria-pressed={focusFriendsPage === 'friends'}
                  >
                    <span className="settings-tab-label">Friends</span>
                  </button>
                  <button
                    ref={(node) => registerFocusFriendsPageButton('add', node)}
                    type="button"
                    onClick={() => setFocusFriendsPage('add')}
                    className={getFocusFriendPageButtonClassName('add')}
                    aria-pressed={focusFriendsPage === 'add'}
                  >
                    <span className="settings-tab-label">Add{focusFriendAddBadgeCount > 0 ? ` ${focusFriendAddBadgeCount}` : ''}</span>
                  </button>
                </div>
              </div>
            </div>

            {focusFriendsPage === 'friends' ? (
              <div className="space-y-4">
                {safeFocusFriends.length > 0 ? (
                  <>
                    {renderFocusFriendListSection('Focusing', onlineFocusFriends)}
                    {renderFocusFriendListSection('Away', offlineFocusFriends, onlineFocusFriends.length)}
                  </>
                ) : (
                  <div className={`${focusFriendRowClassName} text-sm leading-relaxed ${focusFriendBodyTextClassName}`}>
                    No friends yet.
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {focusFriendInviteUsername && (
                  <div className={`${focusFriendRowClassName} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
                    <div className="min-w-0">
                      <div className={`truncate text-sm font-bold ${focusFriendStrongTextClassName}`}>
                        @{focusFriendInviteUsername}
                      </div>
                      <div className={`mt-1 text-xs ${focusFriendMutedTextClassName}`}>
                        {isOwnFocusFriendInvite ? 'This is your invite link.' : 'Invite ready.'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleAcceptFocusFriendInvite(focusFriendInviteUsername)}
                      disabled={isPreviewAccount || isOwnFocusFriendInvite || focusFriendBusyAction !== null}
                      className={focusFriendPrimaryButtonClassName}
                    >
                      <UserPlus size={16} />
                      Auto add
                    </button>
                  </div>
                )}

                {focusFriendInviteUrl && (
                  <div className={`${focusFriendInsetClassName} overflow-hidden p-2`}>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <input
                        type="text"
                        readOnly
                        value={focusFriendInviteUrl}
                        onFocus={event => event.currentTarget.select()}
                        aria-label="Focus Friend invite link"
                        className={`min-h-[2.75rem] w-full border-0 bg-transparent px-3.5 py-2 text-sm outline-none ${
                          isLightTheme ? 'text-slate-700 placeholder:text-slate-400' : 'text-white/72 placeholder:text-white/25'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={handleCopyFocusFriendInviteLink}
                        disabled={isPreviewAccount || focusFriendBusyAction !== null}
                        className={focusFriendNeutralButtonClassName}
                      >
                        <LinkIcon size={16} />
                        {focusFriendInviteCopied ? 'Copied' : 'Copy link'}
                      </button>
                    </div>
                  </div>
                )}

                <form onSubmit={handleSendFocusFriendRequest} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className={focusFriendInsetClassName}>
                    <input
                      type="text"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={32}
                      value={focusFriendUsernameInput}
                      onChange={event => setFocusFriendUsernameInput(event.target.value)}
                      placeholder="Friend username"
                      className={`min-h-[2.75rem] w-full border-0 bg-transparent px-3.5 py-2 text-sm outline-none ${
                        isLightTheme ? 'text-slate-950 placeholder:text-slate-400' : 'text-white placeholder:text-white/25'
                      }`}
                      disabled={isPreviewAccount || focusFriendBusyAction !== null}
                      aria-invalid={Boolean(focusFriendUsernameValidationMessage)}
                    />
                    {(focusFriendUsernameValidationMessage || (normalizedFocusFriendUsernameInput && normalizedFocusFriendUsernameInput !== focusFriendUsernameInput.trim())) && (
                      <div className={`border-t px-3.5 py-2 text-[11px] leading-relaxed ${
                        isLightTheme ? 'border-slate-200/80 text-slate-500' : 'border-white/[0.08] text-white/45'
                      }`}>
                        {focusFriendUsernameValidationMessage || `Will request ${normalizedFocusFriendUsernameInput}.`}
                      </div>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={isPreviewAccount || focusFriendBusyAction !== null || !normalizedFocusFriendUsernameInput || Boolean(focusFriendUsernameValidationMessage)}
                    className={focusFriendPrimaryButtonClassName}
                  >
                    <UserPlus size={16} />
                    Add
                  </button>
                </form>

                {isPreviewAccount && (
                  <div className={`${focusFriendInsetClassName} px-4 py-3 text-sm leading-relaxed ${focusFriendBodyTextClassName}`}>
                    Focus Friends use cloud accounts.
                  </div>
                )}

                {safeIncomingFocusFriendRequests.length > 0 && (
                  <div className="space-y-2">
                    {safeIncomingFocusFriendRequests.map(renderFocusFriendRequest)}
                  </div>
                )}

                {safeFocusFriendInbox.length > 0 && (
                  <div className="grid gap-2">
                    {safeFocusFriendInbox.slice(0, 6).map(renderFocusFriendActivity)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {accountDataConflictError && (
          <div className="rounded-[1.2rem] border border-red-500/28 bg-red-500/12 px-4 py-3 text-sm leading-relaxed text-red-100">
            {accountDataConflictError}
          </div>
        )}

        <details
          className="group rounded-[1.7rem] border"
          style={accountOverviewSectionStyle}
        >
          <summary className="list-none cursor-pointer select-none px-5 py-4 md:px-6 md:py-5 [&::-webkit-details-marker]:hidden">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className={overviewKickerClassName}>Account</div>
                <div className={overviewHeadingClassName}>{safeUser.username}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className={`rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${syncStateMeta.className}`}>
                  {syncStateMeta.label}
                </div>
                <div className="rounded-full border px-3 py-1.5 text-[11px] font-medium" style={accountOverviewChipStyle}>
                  Details
                </div>
              </div>
            </div>
          </summary>

          <div className="px-5 pb-5 pt-0 md:px-6 md:pb-6">
            <div
              className={`rounded-[1.2rem] border px-4 py-4 md:px-5 md:py-5 ${
                isLightTheme ? 'hover:border-slate-300/70' : 'hover:border-white/14'
              }`}
              style={getAccountOverviewCardStyle(syncStateMeta.accent)}
            >
              <div className={overviewCardLabelClassName}>
                <span>Sync status</span>
              </div>
              <div className={`mt-3 text-sm leading-relaxed ${isLightTheme ? 'text-slate-600' : 'text-white/62'}`}>
                {syncStateMeta.detail}
              </div>
              <div className={`mt-2 text-[11px] leading-relaxed ${isLightTheme ? 'text-slate-500' : 'text-white/46'}`}>
                {isPreviewAccount
                  ? 'Preview mode stays local and never pushes or pulls account data.'
                  : `Local history leads. Last cloud check: ${lastCloudCheckLabel}.`}
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {accountQuickFacts.map((item, index) => (
                <div
                  key={item.label}
                  className={`rounded-[1.2rem] border px-4 py-4 transition-[transform,border-color,background-color,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-[2px] ${
                    isLightTheme ? 'hover:border-slate-300/70' : 'hover:border-white/14'
                  }`}
                  style={getAccountOverviewCardStyle(index === 2 ? accountPrimaryColor : PRESET_COLORS[(index + 2) % PRESET_COLORS.length])}
                >
                  <div className={overviewCardLabelClassName}>{item.label}</div>
                  <div className={`mt-3 text-sm font-semibold leading-relaxed ${isLightTheme ? 'text-slate-900' : 'text-white'}`}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isPreviewAccount || accountActionBusy !== null}
                onClick={handleSyncNow}
                className="rounded-[0.95rem] border border-blue-400/28 bg-blue-500/12 px-3.5 py-2 text-sm font-semibold text-blue-100 transition-colors hover:bg-blue-500/20 disabled:opacity-55"
              >
                {isPreviewAccount ? 'Preview only' : accountActionBusy === 'sync' ? 'Syncing...' : 'Sync now'}
              </button>
              <button
                type="button"
                disabled={isPreviewAccount || accountActionBusy !== null}
                onClick={handleRefreshCloud}
                className="rounded-[0.95rem] border border-white/12 bg-white/[0.04] px-3.5 py-2 text-sm font-semibold text-white/82 transition-colors hover:bg-white/[0.08] disabled:opacity-55"
              >
                {isPreviewAccount ? 'Mock data' : accountActionBusy === 'refresh' ? 'Pulling...' : 'Pull cloud'}
              </button>
              <button
                type="button"
                onClick={logout}
                className="rounded-[0.95rem] border border-red-500/24 bg-red-500/10 px-3.5 py-2 text-sm font-semibold text-red-100 transition-colors hover:bg-red-500/16"
              >
                Sign out
              </button>
            </div>
          </div>
        </details>

      </div>
    );
  };

  const renderAccountSignedOut = () => {
    const authTitle = authMode === 'register' ? 'Create Account' : 'Sign In';
    const authDescription = authMode === 'register'
      ? `Create an account to track statistics and save across devices. ${DEBUG_FOCUS_FRIEND_AUTH_HINT}`
      : `Sign in to track statistics and save across devices. ${DEBUG_FOCUS_FRIEND_AUTH_HINT}`;

    return (
      <div className="p-4 md:p-8 min-h-[520px]">
        <div className="mx-auto flex max-w-md flex-col justify-center rounded-[1.9rem] border border-white/10 bg-white/5 p-5 md:p-6">
          <div className="mb-6">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">Account</div>
            <div className="mt-3 text-2xl font-bold tracking-tight text-white">{authTitle}</div>
            <div className="mt-2 text-sm leading-relaxed text-white/58">
              {authDescription}
            </div>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {focusFriendInviteUsername && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-3 text-sm leading-relaxed text-white/68">
                Sign in or create an account to add <span className="font-semibold text-white">@{focusFriendInviteUsername}</span>.
              </div>
            )}
            {accountError && (
              <div className="rounded-2xl border border-red-500/28 bg-red-500/12 px-4 py-3 text-sm text-red-100">
                {accountError}
              </div>
            )}
            {accountMessage && (
              <div className="rounded-2xl border border-emerald-500/26 bg-emerald-500/12 px-4 py-3 text-sm text-emerald-100">
                {accountMessage}
              </div>
            )}

            <div>
              <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">Username</label>
              <input
                type="text"
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="username"
                maxLength={32}
                value={usernameInput}
                onChange={event => setUsernameInput(event.target.value)}
                placeholder="Username"
                aria-invalid={Boolean(usernameValidationMessage)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-white outline-none transition-all placeholder-white/25 focus:border-white/30"
                disabled={authBusy}
              />
              <div className="mt-2 min-h-[1.25rem] text-[11px] leading-relaxed text-white/50">
                {usernameValidationMessage
                  ? usernameValidationMessage
                  : usernameInput.trim() && normalizedUsernameInput !== usernameInput.trim()
                    ? `Will be saved as ${normalizedUsernameInput}.`
                    : 'Use 3-32 lowercase letters, numbers, ".", "_" or "-".'}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">Password</label>
              <input
                type="password"
                autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                minLength={allowsShortAuthPassword ? undefined : ACCOUNT_PASSWORD_MIN_LENGTH}
                maxLength={ACCOUNT_PASSWORD_MAX_LENGTH}
                value={passwordInput}
                onChange={event => setPasswordInput(event.target.value)}
                placeholder="Password"
                aria-invalid={Boolean(passwordValidationMessage)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-white outline-none transition-all placeholder-white/25 focus:border-white/30"
                disabled={authBusy}
              />
              <div className="mt-2 min-h-[1.25rem] text-[11px] leading-relaxed text-white/50">
                {passwordValidationMessage || (
                  isPreviewAccountAuth
                    ? 'Preview account password accepted.'
                    : isDebugFocusFriendAuth
                      ? 'Focus Friends account password accepted.'
                      : `Use at least 8 characters. ${DEBUG_FOCUS_FRIEND_AUTH_HINT}`
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={!canSubmitAuth}
              className="flex w-full items-center justify-center rounded-2xl bg-white py-4 text-xs font-bold uppercase tracking-[0.16em] text-black shadow-lg transition-all hover:bg-gray-200 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-55"
            >
              {authBusy ? (
                <span className="h-4 w-4 rounded-full border-2 border-black border-t-transparent animate-spin" />
              ) : authMode === 'register' ? (
                'Create Account'
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setAuthMode(prev => (prev === 'register' ? 'login' : 'register'));
              setAuthLocalError(null);
              setAccountMessage(null);
            }}
            disabled={authBusy}
            className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-bold uppercase tracking-[0.16em] text-white/65 transition-colors hover:bg-white/10 hover:text-white"
          >
            {authMode === 'register' ? 'Already have an account? Sign In' : 'Need an account? Create One'}
          </button>
        </div>
      </div>
    );
  };

  const renderAccountTab = () => {
    return safeUser ? renderAccountLoggedIn() : renderAccountSignedOut();
  };

  const renderGroupTab = () => {
    const groupError = groupLocalError || peerError;
    const hostControls = safeHostSyncConfig;
    const clientControls = safeClientSyncConfig;
    const timerSharePrimaryLabel = timerShareMessage === 'copied' ? 'Timer Copied' : 'Timer Link';
    const groupShellClass = 'rounded-[1.45rem] border border-white/[0.08] bg-white/[0.035] p-4 shadow-[0_24px_54px_-42px_rgba(0,0,0,0.72),inset_0_1px_0_rgba(255,255,255,0.045)] md:p-5';
    const groupInsetClass = 'rounded-lg border border-white/[0.09] bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]';
    const groupSectionLabelClass = 'text-[10px] font-bold uppercase tracking-[0.15em] text-white/36';
    const groupActionButtonClass = 'group relative flex min-h-[4.65rem] w-full items-center overflow-hidden rounded-lg border border-white/[0.11] bg-white/[0.045] px-3.5 py-3 text-left shadow-[0_20px_42px_-34px_rgba(0,0,0,0.72),inset_0_1px_0_rgba(255,255,255,0.045)] transform-gpu transition-[background-color,border-color,box-shadow,transform,color] duration-300 ease-out hover:-translate-y-0.5 hover:border-white/[0.16] hover:bg-white/[0.075] hover:shadow-[0_28px_52px_-36px_rgba(0,0,0,0.82),inset_0_1px_0_rgba(255,255,255,0.055)] active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:scale-100';
    const groupActionLabelClass = 'text-[10px] font-bold uppercase leading-none tracking-[0.14em] text-white/82 transition-colors group-hover:text-white';
    const groupActionDetailClass = 'mt-1.5 text-[10px] font-semibold leading-snug text-white/40 transition-colors group-hover:text-white/54';
    const groupActionIconClass = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.09] bg-white/[0.045] text-white/58 transition-[transform,background-color,color] duration-300 group-hover:-translate-y-0.5 group-hover:bg-white/[0.08] group-hover:text-white/86';
    const renderGroupActionButton = ({
      label,
      detail,
      onClick,
      disabled = false,
      icon,
    }: {
      label: string;
      detail?: string;
      onClick: () => void;
      disabled?: boolean;
      icon: React.ReactNode;
    }) => (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={groupActionButtonClass}
      >
        <div className="relative z-10 flex h-full w-full items-start justify-between gap-3">
          <div className="min-w-0">
            <div className={groupActionLabelClass}>{label}</div>
            {detail && <div className={groupActionDetailClass}>{detail}</div>}
          </div>
          <span className={groupActionIconClass}>{icon}</span>
        </div>
      </button>
    );
    const timerShareButton = renderGroupActionButton({
      label: timerShareBusy ? 'Preparing...' : timerSharePrimaryLabel,
      onClick: handleCopyTimerShareLink,
      disabled: timerShareBusy,
      icon: <Share2 size={15} strokeWidth={2.1} aria-hidden="true" />,
    });
    const groupUtilityButtonClass = 'inline-flex min-h-[3.35rem] w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.12em] transition-[background-color,border-color,box-shadow,color,transform] duration-200 hover:-translate-y-[1px] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0';
    const groupUtilityPrimaryClass = `${groupUtilityButtonClass} border-blue-400/18 bg-blue-500/[0.09] text-blue-200 hover:bg-blue-500/[0.14] hover:text-blue-100`;
    const groupUtilityNeutralClass = `${groupUtilityButtonClass} border-white/10 bg-white/[0.04] text-white/72 hover:bg-white/[0.08] hover:text-white`;
    const timerShareErrorPanel = timerShareMessage && timerShareMessage !== 'copied' ? (
      <div className={`px-3 py-2 text-center text-[11px] font-semibold leading-relaxed text-red-100/82 ${groupInsetClass}`}>
        {timerShareMessage}
      </div>
    ) : null;

    if (groupBusy) {
      return (
        <div className="p-4 md:p-8 min-h-[520px] flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-white/20 border-t-white animate-spin" />
          <span className="text-white/55 text-xs uppercase tracking-[0.16em] font-bold">Connecting...</span>
        </div>
      );
    }

    if (safeGroupSessionId) {
      const groupSyncLabel = isHost ? 'Sync Controls' : 'Accepted Sync';
      return (
        <div className="p-4 md:p-8 min-h-[520px]">
          <div className="max-w-xl mx-auto space-y-4">
            <div className="space-y-2">
              <h3 className="text-2xl font-semibold tracking-tight text-white">Group Study</h3>
            </div>

            <div className={`${groupShellClass} space-y-4`}>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11.75rem] sm:items-stretch md:grid-cols-[minmax(0,1fr)_12.75rem]">
                <button
                  type="button"
                  onClick={async () => { await copyToClipboard(safeGroupSessionId); }}
                  className={`group flex min-h-[7.15rem] min-w-0 transform-gpu flex-col justify-center gap-3 px-4 py-4 text-center transition-[background-color,border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:border-white/[0.16] hover:bg-white/[0.065] hover:shadow-[0_26px_50px_-38px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.055)] active:translate-y-0 sm:min-h-[10.55rem] md:px-5 ${groupInsetClass}`}
                  aria-label={`Copy session code ${safeGroupSessionId}`}
                >
                  <span className={`${groupSectionLabelClass} transition-colors group-hover:text-white/48`}>Session Code</span>
                  <span className="font-mono text-[1.8rem] font-bold leading-none tracking-[0.18em] text-white transition-colors group-hover:text-blue-100 sm:text-[1.95rem] md:text-[2.1rem]">
                    {safeGroupSessionId}
                  </span>
                </button>
                <div className="grid w-full grid-cols-3 gap-2 sm:h-full sm:grid-cols-1 sm:auto-rows-fr">
                  <button
                    type="button"
                    onClick={async () => { await copyToClipboard(groupInviteUrl); }}
                    className={groupUtilityPrimaryClass}
                  >
                    <LinkIcon size={13} strokeWidth={2.2} aria-hidden="true" />
                    Invite Link
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowGroupQr(prev => !prev)}
                    className={groupUtilityNeutralClass}
                  >
                    <QrCode size={13} strokeWidth={2.2} aria-hidden="true" />
                    {showGroupQr ? 'Hide QR' : 'Invite QR'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyTimerShareLink}
                    disabled={timerShareBusy}
                    className={groupUtilityNeutralClass}
                  >
                    <Share2 size={13} strokeWidth={2.2} aria-hidden="true" />
                    {timerShareBusy ? 'Preparing' : timerSharePrimaryLabel}
                  </button>
                </div>
              </div>

              {showGroupQr && (
                <div className={`space-y-3 px-4 py-4 ${groupInsetClass}`}>
                  <div className="flex justify-center rounded-lg bg-white p-4">
                    <QRCodeSVG value={groupInviteUrl} size={180} />
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between gap-3">
                  <label className={groupSectionLabelClass}>
                    Members
                  </label>
                  <div className="text-[11px] text-white/40">
                    {safeMembers.length} total
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {safeMembers.map(member => (
                    <div
                      key={member.id}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                        member.isHost
                          ? 'border-blue-400/18 bg-blue-500/[0.09] text-blue-100/90'
                          : 'border-white/[0.08] bg-white/[0.035] text-white/80'
                      }`}
                    >
                      <div className={`h-2 w-2 rounded-full ${member.isHost ? 'bg-blue-300' : 'bg-white/45'}`} />
                      <span className="font-semibold tracking-tight">{member.name}{member.isHost ? ' (Host)' : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {timerShareErrorPanel}

            <div className={`${groupShellClass} space-y-3`}>
              <button
                type="button"
                onClick={() => setGroupSyncControlsOpen(prev => !prev)}
                className="group flex w-full items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-white/[0.035] px-3.5 py-3 text-left transition-[background-color,border-color,transform] duration-200 hover:-translate-y-[1px] hover:border-white/[0.14] hover:bg-white/[0.065] active:translate-y-0"
                aria-expanded={groupSyncControlsOpen}
              >
                <span className={groupSectionLabelClass}>{groupSyncLabel}</span>
                <span className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-white/42 transition-colors group-hover:text-white/68">
                  {groupSyncControlsOpen ? 'Hide' : 'Show'}
                  <ChevronDown
                    size={14}
                    strokeWidth={2.2}
                    aria-hidden="true"
                    className={`transition-transform duration-200 ${groupSyncControlsOpen ? 'rotate-180' : ''}`}
                  />
                </span>
              </button>

              {groupSyncControlsOpen && (
                <div className="space-y-3 pt-1">
                  {isHost ? (
                    <>
                      <ToggleRow label="Sync Timers" checked={hostControls.syncTimers} onToggle={() => toggleLiveHostSync('syncTimers')} tone="quiet" switchTone="neutral" />
                      <ToggleRow label="Sync Tasks" checked={hostControls.syncTasks} onToggle={() => toggleLiveHostSync('syncTasks')} tone="quiet" switchTone="neutral" />
                      <ToggleRow label="Sync Schedule" checked={hostControls.syncSchedule} onToggle={() => toggleLiveHostSync('syncSchedule')} tone="quiet" switchTone="neutral" />
                      <ToggleRow label="Sync History" checked={hostControls.syncHistory} onToggle={() => toggleLiveHostSync('syncHistory')} tone="quiet" switchTone="neutral" />
                      <ToggleRow label="Sync Settings" checked={hostControls.syncSettings} onToggle={() => toggleLiveHostSync('syncSettings')} tone="quiet" switchTone="neutral" />
                    </>
                  ) : (
                    <>
                      <ToggleRow label="Timer Sync" checked={clientControls.syncTimers} onToggle={() => toggleLiveClientSync('syncTimers')} tone="quiet" switchTone="neutral" />
                      <ToggleRow label="Task Sync" checked={clientControls.syncTasks} onToggle={() => toggleLiveClientSync('syncTasks')} tone="quiet" switchTone="neutral" />
                      <ToggleRow label="Schedule Sync" checked={clientControls.syncSchedule} onToggle={() => toggleLiveClientSync('syncSchedule')} tone="quiet" switchTone="neutral" />
                      <ToggleRow label="History Sync" checked={clientControls.syncHistory} onToggle={() => toggleLiveClientSync('syncHistory')} tone="quiet" switchTone="neutral" />
                      <ToggleRow label="Settings Sync" checked={clientControls.syncSettings} onToggle={() => toggleLiveClientSync('syncSettings')} tone="quiet" switchTone="neutral" />
                    </>
                  )}
                </div>
              )}
            </div>

            {groupError && (
              <div className="rounded-[1rem] border border-red-500/26 bg-red-500/10 px-4 py-3 text-xs text-red-200">
                {groupError}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                leaveGroupSession();
                setShowGroupQr(false);
                setTimerShareMessage(null);
                inviteAutoJoinKeyRef.current = null;
                setInviteSessionId('');
                setGroupFlow('menu');
              }}
              className="w-full rounded-lg border border-red-400/20 bg-red-500/[0.055] py-3 text-xs font-semibold uppercase tracking-[0.16em] text-red-100/80 transition-[background-color,border-color,color,transform] duration-200 hover:-translate-y-[1px] hover:border-red-300/24 hover:bg-red-500/[0.1] hover:text-red-100"
            >
              Leave Session
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="p-4 md:p-8 min-h-[520px]">
        <div className="max-w-lg mx-auto space-y-5">
          <div className="space-y-2">
            <h3 className="text-2xl font-semibold tracking-tight text-white">Group Study</h3>
          </div>

          {groupError && (
            <div className="rounded-lg border border-red-500/26 bg-red-500/10 px-4 py-3 text-xs font-semibold text-red-100/86">
              {groupError}
            </div>
          )}

          <div className={groupShellClass}>
            <label className={`${groupSectionLabelClass} mb-2 block`}>Your Name</label>
            <input
              ref={groupNameInputRef}
              type="text"
              value={groupName}
              onChange={event => setGroupName(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && groupFlow === 'join' && groupSessionInput.trim()) {
                  event.preventDefault();
                  void handleJoinGroup();
                }
              }}
              placeholder="Enter your name"
              className="w-full rounded-lg border border-white/[0.09] bg-white/[0.045] px-4 py-3 text-center font-semibold text-white outline-none transition-[border-color,background-color] duration-200 placeholder:text-white/26 focus:border-white/[0.18] focus:bg-white/[0.065]"
            />
            {inviteSessionId && groupFlow === 'join' && (
              <div className="mt-2 text-center text-[11px] text-emerald-100/75">
                Invite ready for <span className="font-mono font-bold tracking-[0.16em]">{inviteSessionId}</span>.
                {groupName.trim()
                  ? ' Joining automatically with this name.'
                  : ' Enter your name to join.'}
              </div>
            )}
          </div>

          {groupFlow === 'menu' && (
            <div className={groupShellClass}>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {renderGroupActionButton({
                  label: 'Host Session',
                  detail: 'Create a room',
                  onClick: () => setGroupFlow('host'),
                  disabled: !groupName.trim(),
                  icon: <Plus size={15} strokeWidth={2.1} aria-hidden="true" />,
                })}
                {renderGroupActionButton({
                  label: 'Join Session',
                  detail: 'Enter a code',
                  onClick: () => setGroupFlow('join'),
                  disabled: !groupName.trim(),
                  icon: <LogIn size={15} strokeWidth={2.1} aria-hidden="true" />,
                })}
                <div className="sm:col-span-2">
                  {timerShareButton}
                </div>
              </div>
            </div>
          )}

          {groupFlow === 'menu' && timerShareErrorPanel}

          {groupFlow === 'host' && (
            <div className={`${groupShellClass} space-y-3`}>
              <div className="flex items-center justify-between">
                <div className={groupSectionLabelClass}>Host Sync</div>
                <button
                  type="button"
                  onClick={() => {
                    inviteAutoJoinKeyRef.current = null;
                    setInviteSessionId('');
                    setGroupFlow('menu');
                  }}
                  className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/42 transition-colors hover:text-white"
                >
                  Back
                </button>
              </div>
              <ToggleRow label="Sync Timers" checked={hostDraftConfig.syncTimers} onToggle={() => toggleHostDraftSync('syncTimers')} tone="quiet" switchTone="neutral" />
              <ToggleRow label="Sync Tasks" checked={hostDraftConfig.syncTasks} onToggle={() => toggleHostDraftSync('syncTasks')} tone="quiet" switchTone="neutral" />
              <ToggleRow label="Sync Schedule" checked={hostDraftConfig.syncSchedule} onToggle={() => toggleHostDraftSync('syncSchedule')} tone="quiet" switchTone="neutral" />
              <ToggleRow label="Sync History" checked={hostDraftConfig.syncHistory} onToggle={() => toggleHostDraftSync('syncHistory')} tone="quiet" switchTone="neutral" />
              <ToggleRow label="Sync Settings" checked={hostDraftConfig.syncSettings} onToggle={() => toggleHostDraftSync('syncSettings')} tone="quiet" switchTone="neutral" />
              <button
                type="button"
                onClick={handleCreateGroup}
                className="w-full rounded-lg border border-white/[0.12] bg-white/[0.08] py-3 text-xs font-bold uppercase tracking-[0.14em] text-white/86 transition-[background-color,border-color,color,transform] duration-200 hover:-translate-y-[1px] hover:border-white/[0.18] hover:bg-white/[0.12] hover:text-white"
              >
                Start Session
              </button>
            </div>
          )}

          {groupFlow === 'join' && (
            <div className={`${groupShellClass} space-y-3`}>
              <div className="flex items-center justify-between">
                <div className={groupSectionLabelClass}>Join Session</div>
                <button
                  type="button"
                  onClick={() => {
                    inviteAutoJoinKeyRef.current = null;
                    setInviteSessionId('');
                    setGroupFlow('menu');
                  }}
                  className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/42 transition-colors hover:text-white"
                >
                  Back
                </button>
              </div>

              {inviteSessionId && inviteSessionId === groupSessionInput && (
                <div className="rounded-lg border border-emerald-400/18 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-100/86">
                  Invite loaded from QR link. Enter your name and join.
                </div>
              )}

              <input
                type="text"
                value={groupSessionInput}
                onChange={event => setGroupSessionInput(event.target.value.toUpperCase())}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleJoinGroup();
                  }
                }}
                placeholder="Session ID"
                className="w-full rounded-lg border border-white/[0.09] bg-white/[0.045] px-4 py-3 text-center font-mono font-semibold tracking-[0.2em] text-white outline-none transition-[border-color,background-color] duration-200 placeholder:text-white/26 focus:border-white/[0.18] focus:bg-white/[0.065]"
              />

              <ToggleRow label="Timer Sync" checked={joinDraftConfig.syncTimers} onToggle={() => toggleJoinDraftSync('syncTimers')} tone="quiet" switchTone="neutral" />
              <ToggleRow label="Task Sync" checked={joinDraftConfig.syncTasks} onToggle={() => toggleJoinDraftSync('syncTasks')} tone="quiet" switchTone="neutral" />
              <ToggleRow label="Schedule Sync" checked={joinDraftConfig.syncSchedule} onToggle={() => toggleJoinDraftSync('syncSchedule')} tone="quiet" switchTone="neutral" />
              <ToggleRow label="History Sync" checked={joinDraftConfig.syncHistory} onToggle={() => toggleJoinDraftSync('syncHistory')} tone="quiet" switchTone="neutral" />
              <ToggleRow label="Settings Sync" checked={joinDraftConfig.syncSettings} onToggle={() => toggleJoinDraftSync('syncSettings')} tone="quiet" switchTone="neutral" />

              <button
                type="button"
                onClick={handleJoinGroup}
                className="w-full rounded-lg border border-white/[0.12] bg-white/[0.08] py-3 text-xs font-bold uppercase tracking-[0.14em] text-white/86 transition-[background-color,border-color,color,transform] duration-200 hover:-translate-y-[1px] hover:border-white/[0.18] hover:bg-white/[0.12] hover:text-white"
              >
                {inviteSessionId && inviteSessionId === groupSessionInput ? 'Join Invite' : 'Connect'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderSettingsTab = () => {
    const focusSoundVolumePercent = clampInt(Math.round(settings.focusSoundVolume ?? 100), 0, 100);
    const focusSoundSliderFill = settings.themeMode === 'light'
      ? 'rgba(15, 23, 42, 0.72)'
      : 'rgba(255, 255, 255, 0.86)';
    const focusSoundSliderTrack = settings.themeMode === 'light'
      ? 'rgba(15, 23, 42, 0.12)'
      : 'rgba(255, 255, 255, 0.08)';
    const focusSoundSliderProgressWidth = `${focusSoundVolumePercent}%`;
    const activeTimerPreset = settings.timerPreset === 'classic' || settings.timerPreset === 'compact'
      ? settings.timerPreset
      : 'custom';
    const isCompactTimerPreset = activeTimerPreset === 'compact';

    return (
      <div className="settings-panel-content p-4 pt-8 pb-12 md:px-8 md:pt-10 md:pb-14 space-y-8 md:space-y-10 max-w-2xl mx-auto">
        <div>
          <h3 className={modalPanelTitleClass}>Settings</h3>
        </div>

        <div className="space-y-4">
          <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-white/40">Alarm Sound</div>
          <div className="settings-sound-grid grid grid-cols-2 md:grid-cols-4 gap-2.5">
            {ALARM_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  updateTimerSettings({ alarmSound: option.value });
                  void playAlarm(option.value);
                }}
                className={`settings-option-btn settings-sound-option-btn p-3 rounded-xl border text-[10px] uppercase tracking-[0.12em] font-bold transition-all truncate ${
                  settings.alarmSound === option.value
                    ? 'bg-white/20 border-white/30 text-white'
                    : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4 pt-8 md:pt-9 border-t border-white/[0.08]">
          <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-white/40">Focus Sound</div>
          <div className="settings-sound-grid grid grid-cols-2 md:grid-cols-4 gap-2.5">
            {FOCUS_SOUND_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => updateTimerSettings({ focusSound: option.value })}
                className={`settings-option-btn settings-sound-option-btn p-3 rounded-xl border text-[10px] uppercase tracking-[0.12em] font-bold transition-all truncate ${
                  settings.focusSound === option.value
                    ? 'bg-white/20 border-white/30 text-white'
                    : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="rounded-[1rem] border border-white/[0.08] bg-white/[0.045] px-4 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-white/40">Volume</div>
              <div className="text-[11px] font-semibold text-white/55">{focusSoundVolumePercent}%</div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={handleFocusSoundPreviewToggle}
                disabled={settings.focusSound === 'off'}
                className={`doro-focus-preview-btn ${isFocusSoundPreviewing ? 'is-playing' : ''}`}
                aria-label={isFocusSoundPreviewing ? 'Stop focus sound preview' : 'Play focus sound preview'}
                title={settings.focusSound === 'off' ? 'Choose a focus sound to preview' : (isFocusSoundPreviewing ? 'Stop preview' : 'Play preview')}
              >
                {isFocusSoundPreviewing ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M8 5.5v13l10-6.5-10-6.5Z" />
                  </svg>
                )}
              </button>
              <div className="doro-focus-sound-slider-shell flex-1 min-w-0">
                <div
                  className="doro-focus-sound-slider-track"
                  style={{
                    backgroundColor: focusSoundSliderTrack,
                    borderColor: isLightTheme ? 'rgba(15, 23, 42, 0.12)' : 'rgba(255, 255, 255, 0.08)',
                    boxShadow: isLightTheme
                      ? 'inset 0 1px 0 rgba(255, 255, 255, 0.62)'
                      : 'inset 0 1px 1px rgba(255, 255, 255, 0.04)',
                  }}
                >
                  <div
                    className="doro-focus-sound-slider-fill"
                    style={{
                      width: focusSoundSliderProgressWidth,
                      backgroundColor: focusSoundSliderFill,
                    }}
                  />
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={focusSoundVolumePercent}
                  onChange={event => updateTimerSettings({ focusSoundVolume: clampInt(Number(event.target.value), 0, 100) })}
                  className="doro-focus-sound-slider"
                  aria-label="Focus sound volume"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-5 pt-8 md:pt-9 border-t border-white/[0.08]">
          <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-white/40">Timer Settings</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-[0.14em] font-bold text-white/35">Work (min)</label>
              <input
                type="number"
                className="doro-no-spin w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-center font-bold outline-none focus:border-white/30"
                value={Math.round(settings.workDuration / 60)}
                onChange={event => setDurationFromMinutes('workDuration', event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-[0.14em] font-bold text-white/35">Short Break</label>
              <input
                type="number"
                className="doro-no-spin w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-center font-bold outline-none focus:border-white/30"
                value={Math.round(settings.shortBreakDuration / 60)}
                onChange={event => setDurationFromMinutes('shortBreakDuration', event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-[0.14em] font-bold text-white/35">Long Break</label>
              <input
                type="number"
                className="doro-no-spin w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-center font-bold outline-none focus:border-white/30"
                value={Math.round(settings.longBreakDuration / 60)}
                onChange={event => setDurationFromMinutes('longBreakDuration', event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-[0.14em] font-bold text-white/35">Long Break Every</label>
              <input
                type="number"
                className="doro-no-spin w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-center font-bold outline-none focus:border-white/30"
                value={settings.longBreakInterval}
                onChange={event => setLongBreakInterval(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-white/40">Timer Mode</div>
              {activeTimerPreset === 'custom' && (
                <div className="rounded-full border border-white/[0.08] bg-white/[0.045] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-white/45">
                  Custom
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {TIMER_PRESET_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTimerPreset(option.value)}
                  className={`settings-option-btn rounded-xl border p-3 text-left transition-all ${
                    activeTimerPreset === option.value
                      ? 'bg-white/20 border-white/30 text-white'
                      : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                  }`}
                >
                  <div className="text-[10px] uppercase tracking-[0.14em] font-bold">{option.label}</div>
                  <div className="mt-1 text-xs font-semibold tabular-nums text-white/55">{option.detail}</div>
                </button>
              ))}
            </div>
          </div>
          {isCompactTimerPreset && (
            <div className="space-y-3">
              <ToggleRow
                label="Two-In-A-Row"
                description="Auto-starts the second focus in each pair."
                checked={settings.twoInARowMode}
                onToggle={() => updateTimerSettings({ twoInARowMode: !settings.twoInARowMode })}
                tone="quiet"
                switchTone="neutral"
              />
              {showAutoStartSoundPanel && (
                <div
                  className={`doro-auto-start-sound-panel rounded-[1rem] border border-white/[0.08] bg-white/[0.035] px-4 py-3.5 ${
                    autoStartSoundPanelExiting ? 'doro-auto-start-sound-panel-out' : 'doro-auto-start-sound-panel-in'
                  }`}
                >
                  <div className="mb-3 text-[10px] uppercase tracking-[0.14em] font-bold text-white/40">Auto-Start Sound</div>
                  <div className="settings-sound-grid settings-auto-start-sound-grid grid grid-cols-2 md:grid-cols-4 gap-2.5">
                    {ALARM_OPTIONS.map(option => (
                      <button
                        key={`two-in-a-row-sound-${option.value}`}
                        type="button"
                        onClick={() => {
                          updateTimerSettings({ twoInARowStartSound: option.value });
                          void playAlarm(option.value);
                        }}
                        className={`settings-option-btn settings-sound-option-btn p-3 rounded-xl border text-[10px] uppercase tracking-[0.12em] font-bold transition-all truncate ${
                          settings.twoInARowStartSound === option.value
                            ? 'bg-white/20 border-white/30 text-white'
                            : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div ref={categorySettingsSectionRef} className="space-y-5 pt-8 md:pt-9 border-t border-white/[0.08]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-white">Categories</div>
              <div className="text-xs text-white/45">Used for task grouping and stats.</div>
            </div>
            <button
              type="button"
              onClick={() => {
                if (showAddCategory) {
                  closeCategoryForm('cancel');
                } else {
                  openNewCategoryForm();
                }
              }}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[10px] uppercase tracking-[0.14em] font-bold transition-colors"
            >
              {showAddCategory ? 'Cancel' : 'New Category'}
            </button>
          </div>

          {showAddCategory && (
            <div
              key={`category-editor-${editingCategoryId ?? 'new'}`}
              className={`doro-category-editor-shell relative overflow-hidden rounded-[1.35rem] border px-4 py-4 ${
                categoryEditorCloseState === 'save'
                  ? 'doro-category-editor-close-save'
                  : categoryEditorCloseState === 'cancel'
                    ? 'doro-category-editor-close-cancel'
                    : 'doro-category-editor-open'
              }`}
              style={{
                borderColor: colorToRgba(newCategoryColor, 0.3),
                background: `linear-gradient(160deg, ${colorToRgba(newCategoryColor, 0.18)} 0%, rgba(15, 23, 42, 0.34) 44%, rgba(15, 23, 42, 0.18) 100%)`,
                boxShadow: `0 20px 42px -28px ${colorToRgba(newCategoryColor, 0.45)}`,
              }}
            >
              <div className="pointer-events-none absolute inset-0 opacity-80" style={{ background: `radial-gradient(circle at 14% -8%, ${colorToRgba(newCategoryColor, 0.28)} 0%, transparent 32%), radial-gradient(circle at 88% 12%, rgba(255,255,255,0.1) 0%, transparent 22%)` }} />
              <div className="doro-category-editor-content relative space-y-4">
                <div className="doro-category-editor-section flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="doro-category-preview-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/20 text-white shadow-lg"
                      style={{
                        background: `linear-gradient(160deg, ${colorToRgba(newCategoryColor, 0.98)} 0%, ${colorToRgba(newCategoryColor, 0.72)} 100%)`,
                        boxShadow: `0 14px 30px -18px ${colorToRgba(newCategoryColor, 0.68)}`,
                      }}
                    >
                      {getIcon(newCategoryIcon, { size: 20, strokeWidth: 2.15 })}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/48">
                        {editingCategoryId !== null ? 'Editing Category' : 'Creating Category'}
                      </div>
                      <div className="mt-1 truncate text-base font-bold tracking-tight text-white">
                        {activeCategoryPreviewLabel}
                      </div>
                    </div>
                  </div>
                  <div className="doro-category-editor-actions flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => closeCategoryForm('cancel')}
                      className="px-3 py-1.5 rounded-lg border border-white/10 bg-black/20 hover:bg-black/30 text-white/70 hover:text-white text-[10px] uppercase tracking-[0.14em] font-bold transition-colors"
                    >
                      Close
                    </button>
                  </div>
                </div>

                <div className="doro-category-editor-section flex flex-wrap items-start gap-4">
                  <div className="doro-category-editor-field min-w-[14rem] flex-1">
                    <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">Name</label>
                    <input
                      type="text"
                      value={newCategoryName}
                      onChange={event => {
                        setNewCategoryName(event.target.value);
                        if (categoryFormError) setCategoryFormError(null);
                      }}
                      className="w-full rounded-2xl border border-white/12 bg-black/20 px-3.5 py-3 text-white text-sm outline-none transition-colors placeholder:text-white/22 focus:border-white/28"
                      placeholder="e.g. Math"
                    />
                  </div>

                  <div className="doro-category-editor-field shrink-0">
                    <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">Color</label>
                    <div className="flex gap-2 flex-wrap">
                      {PRESET_COLORS.map((color, index) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => {
                            setNewCategoryColor(color);
                            if (categoryFormError) setCategoryFormError(null);
                          }}
                          className={`doro-category-color-swatch h-8 w-8 rounded-full border transition-all ${
                            newCategoryColor === color
                              ? 'scale-110 border-white/70 ring-2 ring-white/70 shadow-[0_0_0_6px_rgba(255,255,255,0.08)]'
                              : 'border-white/10 opacity-72 hover:opacity-100 hover:-translate-y-[1px]'
                          }`}
                          style={{
                            backgroundColor: color,
                            boxShadow: newCategoryColor === color ? `0 12px 20px -12px ${colorToRgba(color, 0.8)}` : undefined,
                            animationDelay: `${150 + (index * 18)}ms`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="doro-category-editor-section">
                  <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">Icon</label>
                  <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
                    {CATEGORY_ICON_OPTIONS.map(({ key, label }, index) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setNewCategoryIcon(key);
                          if (categoryFormError) setCategoryFormError(null);
                        }}
                        title={label}
                        aria-label={label}
                        className={`doro-category-icon-option flex h-11 items-center justify-center rounded-2xl border text-white transition-all ${
                          newCategoryIcon === key
                            ? 'border-white/32 bg-white/18 shadow-[0_14px_26px_-20px_rgba(255,255,255,0.42)]'
                            : 'border-white/8 bg-white/[0.04] opacity-65 hover:bg-white/[0.1] hover:opacity-100 hover:-translate-y-[1px]'
                        }`}
                        style={{ animationDelay: `${190 + (index * 9)}ms` }}
                      >
                        {getIcon(key, { size: 18 })}
                      </button>
                    ))}
                  </div>
                </div>

                {categoryFormError && (
                  <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    {categoryFormError}
                  </div>
                )}

                <div className="doro-category-editor-footer flex flex-wrap gap-2">
                  {editingCategoryId !== null && (
                    <button
                      type="button"
                      onClick={() => handleArchiveCategory(editingCategoryId)}
                      className="flex-1 min-w-[8rem] rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-red-100/75 transition-all hover:border-red-300/28 hover:bg-red-500/16 hover:text-red-100"
                    >
                      Archive
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => closeCategoryForm('cancel')}
                    className="flex-1 min-w-[8rem] rounded-xl border border-white/12 bg-black/20 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/72 transition-all hover:bg-black/30 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateCategory}
                    disabled={!newCategoryName.trim()}
                    className="flex-1 min-w-[8rem] rounded-xl bg-white px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-black shadow-lg transition-all hover:bg-gray-200 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {editingCategoryId !== null ? 'Save Changes' : 'Create Category'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {safeActiveCategories.length === 0 && (
              <div className="text-center text-white/35 text-xs italic py-4">No active categories.</div>
            )}
            {safeActiveCategories.map(category => (
              <div
                key={category.id}
                ref={(node) => registerCategoryRef(category.id, node)}
                onPointerDown={(event) => handleCategoryPointerDown(event, category.id)}
                className={`relative overflow-hidden flex justify-between items-center gap-3 p-3 rounded-xl border transition-[background-color,border-color,box-shadow,transform,opacity] duration-300 ease-out ${
                  editingCategoryId === category.id
                    ? 'bg-white/12 border-white/25 shadow-[0_18px_34px_-26px_rgba(255,255,255,0.34)] -translate-y-[1px]'
                    : 'bg-white/5 border-white/10 hover:bg-white/[0.075]'
                } ${draggingCategoryId === category.id ? 'opacity-45 scale-[0.985] cursor-grabbing' : 'cursor-grab active:cursor-grabbing'}`}
                style={{
                  touchAction: draggingCategoryId === category.id ? 'none' : 'pan-y',
                  boxShadow: editingCategoryId === category.id ? `0 20px 34px -28px ${colorToRgba(category.color, 0.7)}` : undefined,
                }}
              >
                {categoryDropHint && draggingCategoryId !== category.id && categoryDropHint.categoryId === category.id && (
                  <div
                    className={`pointer-events-none absolute left-2 right-2 ${categoryDropHint.position === 'before' ? 'top-0.5' : 'bottom-0.5'} h-[2px] rounded-full bg-white/75 shadow-[0_0_12px_rgba(255,255,255,0.5)]`}
                  />
                )}
                {editingCategoryId === category.id && (
                  <div className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: category.color }} />
                )}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-8 w-4 shrink-0 items-center justify-center text-white/24">
                    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
                      <circle cx="2" cy="2" r="1.1" />
                      <circle cx="8" cy="2" r="1.1" />
                      <circle cx="2" cy="7" r="1.1" />
                      <circle cx="8" cy="7" r="1.1" />
                      <circle cx="2" cy="12" r="1.1" />
                      <circle cx="8" cy="12" r="1.1" />
                    </svg>
                  </div>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white" style={{ backgroundColor: category.color }}>
                    {getIcon(category.icon)}
                  </div>
                  <div className="min-w-0 text-white font-bold text-sm truncate">{category.name}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    data-category-action="true"
                    onClick={() => openCategoryEditor(category)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                    title="Edit"
                    aria-label={`Edit ${category.name}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 pt-2 border-t border-white/10">
          <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-white/35">Appearance</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => updateTimerSettings({ themeMode: 'light' })}
              className={`settings-option-btn p-3 rounded-xl border text-[10px] uppercase tracking-[0.14em] font-bold transition-all ${
                settings.themeMode === 'light'
                  ? 'bg-white/20 border-white/30 text-white'
                  : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
              }`}
            >
              Light
            </button>
            <button
              type="button"
              onClick={() => updateTimerSettings({ themeMode: 'dark' })}
              className={`settings-option-btn p-3 rounded-xl border text-[10px] uppercase tracking-[0.14em] font-bold transition-all ${
                settings.themeMode === 'dark'
                  ? 'bg-white/20 border-white/30 text-white'
                  : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
              }`}
            >
              Dark
            </button>
          </div>
        </div>

        <div className="space-y-4 pt-8 md:pt-9 border-t border-white/[0.08]">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-white/40">Manual Focus Log</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-[0.14em] font-bold text-white/35">Hours</label>
              <input
                type="number"
                min={0}
                step={0.25}
                inputMode="decimal"
                value={manualFocusHoursInput}
                onChange={event => {
                  setManualFocusHoursInput(event.target.value);
                  if (manualFocusError) setManualFocusError(null);
                }}
                className="doro-no-spin w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-center font-bold outline-none transition-colors placeholder:text-white/22 focus:border-white/30"
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-[0.14em] font-bold text-white/35">Minutes</label>
              <input
                type="number"
                min={0}
                step={5}
                inputMode="numeric"
                value={manualFocusMinutesInput}
                onChange={event => {
                  setManualFocusMinutesInput(event.target.value);
                  if (manualFocusError) setManualFocusError(null);
                }}
                className="doro-no-spin w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-center font-bold outline-none transition-colors placeholder:text-white/22 focus:border-white/30"
                placeholder="0"
              />
            </div>
          </div>
          <input
            type="text"
            value={manualFocusNote}
            onChange={event => {
              setManualFocusNote(event.target.value);
              if (manualFocusError) setManualFocusError(null);
            }}
            className="w-full rounded-xl border border-white/10 bg-white/[0.045] px-3.5 py-3 text-sm font-semibold text-white outline-none transition-colors placeholder:text-white/24 focus:border-white/28"
            placeholder="Optional note"
          />
          {safeActiveCategories.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-white/35">Category</div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setManualFocusCategoryId(null)}
                  className={`rounded-xl border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition-all ${
                    manualFocusCategoryId === null
                      ? 'border-white/28 bg-white/18 text-white'
                      : 'border-white/10 bg-white/[0.045] text-white/58 hover:bg-white/10 hover:text-white/78'
                  }`}
                >
                  None
                </button>
                {safeActiveCategories.map(category => (
                  <button
                    key={`manual-focus-category-${category.id}`}
                    type="button"
                    onClick={() => setManualFocusCategoryId(category.id)}
                    className={`flex max-w-full items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition-all ${
                      manualFocusCategoryId === category.id
                        ? 'border-white/28 bg-white/18 text-white'
                        : 'border-white/10 bg-white/[0.045] text-white/58 hover:bg-white/10 hover:text-white/78'
                    }`}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white" style={{ backgroundColor: category.color }}>
                      {getIcon(category.icon, { size: 10, strokeWidth: 2.3 })}
                    </span>
                    <span className="truncate">{category.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {manualFocusError && (
            <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-100/80">
              {manualFocusError}
            </div>
          )}
          <button
            type="button"
            onClick={handleManualFocusLog}
            className="w-full rounded-xl border border-white/12 bg-white/12 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white transition-all hover:border-white/22 hover:bg-white/18 active:scale-[0.99]"
          >
            Log Focus Time
          </button>
        </div>

        <div className="pt-4 border-t border-white/10">
          {showResetConfirm ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 py-2 bg-white/5 hover:bg-white/10 text-white/65 font-bold uppercase text-xs tracking-[0.14em] rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  hardReset();
                  setShowResetConfirm(false);
                  onClose();
                }}
                className="flex-1 py-2 bg-red-500 text-white font-bold uppercase text-xs tracking-[0.14em] rounded-lg hover:bg-red-600 transition-colors"
              >
                Confirm Reset
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowResetConfirm(true)}
              className="w-full py-2 bg-red-500/15 hover:bg-red-500/24 text-red-200 font-bold uppercase text-xs tracking-[0.14em] rounded-lg transition-colors"
            >
              Reset App Data
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderDisplayedTab = () => {
    if (displayedTab === 'log') return renderLogTab();
    if (displayedTab === 'group') return renderGroupTab();
    if (displayedTab === 'account') return renderAccountTab();
    return renderSettingsTab();
  };

  const settingsPanelAnimationClass = settingsPanelTransitionPhase === 'leaving'
    ? (settingsPanelTransitionDirection === 'forward' ? 'doro-settings-panel-leave-forward' : 'doro-settings-panel-leave-backward')
    : settingsPanelTransitionPhase === 'entering'
      ? (settingsPanelTransitionDirection === 'forward' ? 'doro-settings-panel-enter-forward' : 'doro-settings-panel-enter-backward')
      : 'doro-settings-panel-idle';

  return (
    <>
      <style>{`
        @keyframes doro-account-stat-enter {
          0% {
            opacity: 0;
            transform: translateY(14px) scale(0.985);
          }
          60% {
            opacity: 1;
            transform: translateY(-1px) scale(1.003);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes doro-account-stat-rail {
          0% {
            opacity: 0;
            transform: scaleX(0.18);
          }
          100% {
            opacity: 1;
            transform: scaleX(1);
          }
        }
        .doro-account-stat-card {
          animation: doro-account-stat-enter 560ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          box-shadow: var(--doro-account-stat-rest-shadow);
          will-change: transform, opacity;
        }
        .doro-account-stat-card:hover {
          box-shadow: var(--doro-account-stat-hover-shadow);
        }
        .doro-account-stat-rail {
          animation: doro-account-stat-rail 720ms cubic-bezier(0.22, 1, 0.36, 1) both;
          will-change: transform, opacity;
        }
        @keyframes doro-focus-friend-section-in {
          0% {
            opacity: 0;
            transform: translateY(6px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes doro-focus-friend-item-in {
          0% {
            opacity: 0;
            transform: translateY(8px);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes doro-focus-friend-love-in {
          0% {
            opacity: 0;
            transform: translateY(10px) scale(0.955);
          }
          58% {
            opacity: 1;
            transform: translateY(-2px) scale(1.018);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes doro-focus-friend-love-out {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          34% {
            opacity: 1;
            transform: translateY(-2px) scale(1.012);
          }
          100% {
            opacity: 0;
            transform: translateY(-8px) scale(0.965);
          }
        }
        @keyframes doro-focus-friend-heart-beat {
          0%, 100% {
            transform: scale(1);
          }
          16% {
            transform: scale(1.22);
          }
          30% {
            transform: scale(0.96);
          }
          46% {
            transform: scale(1.15);
          }
          68% {
            transform: scale(1);
          }
        }
        @keyframes doro-focus-friend-heart-farewell {
          0% {
            opacity: 1;
            transform: scale(1) rotate(0deg);
          }
          38% {
            opacity: 1;
            transform: scale(1.26) rotate(-7deg);
          }
          100% {
            opacity: 0;
            transform: scale(0.72) rotate(9deg);
          }
        }
        .doro-focus-friends-section {
          animation: doro-focus-friend-section-in 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .doro-focus-friends-panel-menu-open {
          z-index: 8;
        }
        .doro-focus-friend-item {
          animation: doro-focus-friend-item-in 320ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
          will-change: transform, opacity;
        }
        .doro-focus-friend-item:hover {
          transform: translateY(-1px);
        }
        .doro-focus-friend-member-row {
          min-height: 4rem;
        }
        .doro-focus-friend-member-row:hover {
          transform: translateY(-1px);
        }
        .doro-focus-friend-card-requestable {
          cursor: pointer;
        }
        .doro-focus-friend-card-requestable:active {
          transform: translateY(0) scale(0.995);
        }
        .doro-focus-friend-card-requestable .doro-focus-friend-avatar-inner {
          transition: border-color 180ms ease, background-color 180ms ease, transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .doro-focus-friend-card-requestable:hover .doro-focus-friend-avatar-inner,
        .doro-focus-friend-card-requestable:focus-visible .doro-focus-friend-avatar-inner {
          transform: translateY(-1px);
        }
        .doro-focus-friend-card:focus {
          outline: none;
        }
        .doro-focus-friend-card:focus-visible {
          outline: 2px solid rgba(200, 109, 128, 0.48);
          outline-offset: 2px;
        }
        .doro-focus-friend-card-menu-open {
          position: relative;
          z-index: 6;
        }
        .doro-focus-friend-card-join-feedback {
          cursor: default;
        }
        .doro-focus-friend-hover-actions {
          opacity: 0;
          pointer-events: none;
          transform: translateY(4px) scale(0.985);
          transition: opacity 170ms ease, transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .doro-focus-friend-card:hover .doro-focus-friend-hover-actions,
        .doro-focus-friend-card:focus-within .doro-focus-friend-hover-actions,
        .doro-focus-friend-card-menu-open .doro-focus-friend-hover-actions {
          opacity: 1;
          pointer-events: auto;
          transform: translateY(0) scale(1);
        }
        .doro-focus-friend-hover-button {
          min-height: 2.35rem;
          padding-inline: 0.78rem;
        }
        .doro-focus-friend-member-row .doro-focus-friend-hover-button {
          min-height: 2rem;
          padding-inline: 0.58rem;
        }
        .doro-focus-friend-icon-button {
          position: relative;
          height: 2.35rem;
          width: 2.35rem;
          min-height: 2.35rem;
          padding: 0;
        }
        .doro-focus-friend-member-row .doro-focus-friend-icon-button {
          height: 2rem;
          width: 2rem;
          min-height: 2rem;
          border-radius: 0.56rem;
        }
        .doro-focus-friend-timer-icon-wrap {
          display: inline-flex;
          flex: 0 0 0.86rem;
          width: 0.86rem;
          height: 0.86rem;
          align-items: center;
          justify-content: center;
          line-height: 1;
          transform: translateY(-0.01rem);
        }
        .doro-focus-friend-timer-icon {
          display: block;
          width: 0.74rem;
          height: 0.74rem;
        }
        .doro-focus-friend-join-feedback {
          position: relative;
          overflow: hidden;
          isolation: isolate;
          line-height: 1;
          white-space: nowrap;
          animation: doro-focus-friend-love-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
          box-shadow: 0 12px 20px -16px rgba(15, 23, 42, 0.38);
        }
        .doro-focus-friend-join-feedback-sending {
          border-color: rgba(255, 255, 255, 0.16);
        }
        .doro-focus-friend-join-feedback-sent {
          border-color: rgba(200, 109, 128, 0.48);
          background: #C86D80;
          color: rgba(255, 247, 247, 0.96);
        }
        .doro-focus-friend-join-feedback-error {
          border-color: rgba(248, 113, 113, 0.34);
          background: rgba(248, 113, 113, 0.1);
        }
        .doro-settings-shell.theme-light .doro-focus-friend-join-feedback-sending {
          background: rgba(15, 23, 42, 0.06);
          color: rgba(30, 41, 59, 0.72);
        }
        .doro-settings-shell.theme-dark .doro-focus-friend-join-feedback-sending {
          background: rgba(255, 255, 255, 0.055);
          color: rgba(255, 255, 255, 0.7);
        }
        .doro-settings-shell.theme-light .doro-focus-friend-join-feedback-error {
          color: rgba(185, 28, 28, 0.9);
        }
        .doro-settings-shell.theme-dark .doro-focus-friend-join-feedback-error {
          color: rgba(254, 202, 202, 0.92);
        }
        .doro-focus-friend-join-spinner {
          height: 0.72rem;
          width: 0.72rem;
          border-radius: 999px;
          border: 2px solid currentColor;
          border-top-color: transparent;
          opacity: 0.78;
          animation: doro-focus-friend-spinner 760ms linear infinite;
        }
        @keyframes doro-focus-friend-spinner {
          to {
            transform: rotate(360deg);
          }
        }
        .doro-focus-friend-icon-button::after {
          content: attr(data-tooltip);
          position: absolute;
          bottom: calc(100% + 0.48rem);
          left: 50%;
          z-index: 42;
          max-width: 11rem;
          transform: translate3d(-50%, 4px, 0) scale(0.96);
          border-radius: 0.58rem;
          padding: 0.42rem 0.56rem;
          opacity: 0;
          pointer-events: none;
          white-space: nowrap;
          font-size: 0.68rem;
          font-weight: 800;
          letter-spacing: 0;
          line-height: 1;
          text-transform: none;
          transition: opacity 140ms ease, transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .doro-focus-friend-icon-button::before {
          content: '';
          position: absolute;
          bottom: calc(100% + 0.23rem);
          left: 50%;
          z-index: 41;
          height: 0.42rem;
          width: 0.42rem;
          opacity: 0;
          pointer-events: none;
          transform: translate3d(-50%, 4px, 0) rotate(45deg);
          transition: opacity 140ms ease, transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .doro-focus-friend-icon-button:hover::after,
        .doro-focus-friend-icon-button:focus-visible::after,
        .doro-focus-friend-icon-button:hover::before,
        .doro-focus-friend-icon-button:focus-visible::before {
          opacity: 1;
          transform: translate3d(-50%, 0, 0) scale(1);
        }
        .doro-focus-friend-icon-button.is-open::after,
        .doro-focus-friend-icon-button.is-open::before {
          opacity: 0;
        }
        .doro-settings-shell.theme-light .doro-focus-friend-icon-button::after,
        .doro-settings-shell.theme-light .doro-focus-friend-icon-button::before {
          background: rgba(15, 23, 42, 0.94);
          color: white;
          box-shadow: 0 12px 20px -18px rgba(15, 23, 42, 0.5);
        }
        .doro-settings-shell.theme-dark .doro-focus-friend-icon-button::after,
        .doro-settings-shell.theme-dark .doro-focus-friend-icon-button::before {
          background: rgba(246, 248, 252, 0.96);
          color: rgba(15, 23, 42, 0.95);
          box-shadow: 0 14px 24px -18px rgba(0, 0, 0, 0.78);
        }
        .doro-focus-friend-button:hover:not(:disabled) {
          transform: translateY(-1px);
        }
        .doro-focus-friend-confirmation {
          position: relative;
          overflow: hidden;
          isolation: isolate;
          border-color: rgba(200, 109, 128, 0.52);
          color: rgba(255, 247, 247, 0.96);
          background: #C86D80;
          animation: doro-focus-friend-love-in 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .doro-focus-friend-confirmation-inline {
          line-height: 1;
          white-space: nowrap;
          box-shadow:
            0 12px 20px -16px rgba(15, 23, 42, 0.38);
        }
        .doro-focus-friend-confirmation::before {
          content: '';
          position: absolute;
          inset: -30% -18%;
          z-index: 0;
          display: none;
        }
        .doro-focus-friend-confirmation-heart {
          position: relative;
          z-index: 1;
          fill: currentColor;
          transform-origin: center;
          animation: doro-focus-friend-heart-beat 820ms ease-in-out 120ms infinite;
        }
        .doro-focus-friend-confirmation-leaving {
          pointer-events: none;
          animation: doro-focus-friend-love-out 640ms cubic-bezier(0.42, 0, 0.2, 1) forwards;
        }
        .doro-focus-friend-confirmation-leaving::before {
          animation: none;
        }
        .doro-focus-friend-confirmation-leaving .doro-focus-friend-confirmation-heart {
          animation: doro-focus-friend-heart-farewell 640ms cubic-bezier(0.42, 0, 0.2, 1) forwards;
        }
        .doro-focus-friend-encouragement {
          position: relative;
        }
        .doro-focus-friend-encouragement-menu {
          position: absolute;
          inset: calc(100% + 0.45rem) 0 auto auto;
          z-index: 40;
          display: grid;
          width: min(20rem, calc(100vw - 3rem));
          gap: 0.18rem;
          max-height: 17rem;
          overflow-y: auto;
          border-radius: 0.9rem;
          border: 1px solid;
          padding: 0.32rem;
          animation: doro-focus-friend-section-in 150ms cubic-bezier(0.22, 1, 0.36, 1) both;
          backdrop-filter: blur(18px) saturate(165%);
          -webkit-backdrop-filter: blur(18px) saturate(165%);
        }
        .doro-focus-friend-encouragement-menu-up {
          inset: auto 0 calc(100% + 0.45rem) auto;
        }
        .doro-focus-friend-encouragement-option {
          width: 100%;
          border: 0;
          border-radius: 0.68rem;
          background: transparent;
          padding: 0.68rem 0.76rem;
          text-align: left;
          font-size: 0.8125rem;
          line-height: 1.25;
          transition: background-color 160ms ease, color 160ms ease, transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .doro-focus-friend-encouragement-option:hover,
        .doro-focus-friend-encouragement-option:focus-visible {
          transform: translateY(-1px);
          outline: none;
        }
        .doro-settings-shell.theme-light .doro-focus-friend-encouragement-menu {
          border-color: rgba(15, 23, 42, 0.12);
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 18px 32px -24px rgba(45, 60, 88, 0.44);
        }
        .doro-settings-shell.theme-light .doro-focus-friend-encouragement-option {
          color: rgba(15, 23, 42, 0.7);
        }
        .doro-settings-shell.theme-light .doro-focus-friend-encouragement-option:hover,
        .doro-settings-shell.theme-light .doro-focus-friend-encouragement-option:focus-visible {
          background: rgba(15, 23, 42, 0.065);
          color: rgba(15, 23, 42, 0.95);
        }
        .doro-settings-shell.theme-dark .doro-focus-friend-encouragement-menu {
          border-color: rgba(255, 255, 255, 0.11);
          background: rgba(13, 18, 27, 0.98);
          box-shadow: 0 20px 34px -24px rgba(0, 0, 0, 0.78);
        }
        .doro-settings-shell.theme-dark .doro-focus-friend-encouragement-option {
          color: rgba(255, 255, 255, 0.68);
        }
        .doro-settings-shell.theme-dark .doro-focus-friend-encouragement-option:hover,
        .doro-settings-shell.theme-dark .doro-focus-friend-encouragement-option:focus-visible {
          background: rgba(255, 255, 255, 0.075);
          color: rgba(255, 255, 255, 0.94);
        }
        @media (max-width: 640px) {
          .doro-focus-friends-panel {
            padding: 0.9rem !important;
            border-radius: 1.25rem !important;
          }
          .doro-focus-friends-section {
            gap: 0.72rem;
          }
          .doro-focus-friends-header {
            flex-wrap: nowrap !important;
            gap: 0.55rem !important;
          }
          .doro-focus-friends-heading {
            min-width: 0;
            white-space: nowrap;
            font-size: 1rem !important;
          }
          .doro-focus-friends-heading svg {
            width: 1rem;
            height: 1rem;
          }
          .doro-focus-friends-tabbar {
            width: min(9.8rem, 46vw) !important;
            padding: 0.24rem !important;
            border-radius: 0.78rem !important;
          }
          .doro-focus-friends-tablist {
            gap: 0.1rem !important;
          }
          .doro-focus-friends-tab-btn {
            min-height: 2rem !important;
            padding: 0.45rem 0.42rem !important;
            font-size: 0.54rem !important;
            letter-spacing: 0.09em !important;
          }
          .doro-focus-friend-member-row {
            min-height: 3.2rem;
            border-radius: 0.88rem !important;
            padding: 0.55rem 0.62rem !important;
          }
          .doro-focus-friend-card-grid {
            grid-template-columns: 2.12rem minmax(0, 1fr) auto !important;
            gap: 0.55rem !important;
          }
          .doro-focus-friend-avatar,
          .doro-focus-friend-avatar-inner {
            width: 2.12rem !important;
            height: 2.12rem !important;
          }
          .doro-focus-friend-avatar-inner {
            border-radius: 0.68rem !important;
            font-size: 0.78rem !important;
          }
          .doro-focus-friend-avatar-inner svg {
            width: 0.98rem;
            height: 0.98rem;
          }
          .doro-focus-friend-summary-row {
            flex-wrap: nowrap !important;
            gap: 0.35rem !important;
            overflow: hidden;
          }
          .doro-focus-friend-name {
            flex: 1 1 auto;
            min-width: 2.25rem;
            font-size: 0.84rem !important;
          }
          .doro-focus-friend-metric {
            height: 1rem !important;
            gap: 0.2rem !important;
            font-size: 0.56rem !important;
            letter-spacing: 0.02em;
          }
          .doro-focus-friend-timer-icon-wrap {
            flex-basis: 0.66rem;
            width: 0.66rem;
            height: 0.66rem;
          }
          .doro-focus-friend-timer-icon {
            width: 0.62rem;
            height: 0.62rem;
          }
          .doro-focus-friend-metric-detail {
            max-width: 3.8rem;
            font-size: 0.62rem !important;
          }
          .doro-focus-friend-activity-line {
            margin-top: 0.12rem !important;
            overflow: hidden;
            white-space: nowrap;
            font-size: 0.68rem !important;
          }
          .doro-focus-friend-action-rail {
            width: auto !important;
            max-width: none !important;
            gap: 0.34rem !important;
          }
          .doro-focus-friend-hover-actions {
            flex-wrap: nowrap !important;
            gap: 0.34rem !important;
          }
          .doro-focus-friend-member-row .doro-focus-friend-hover-button,
          .doro-focus-friend-member-row .doro-focus-friend-icon-button {
            width: 1.82rem !important;
            height: 1.82rem !important;
            min-height: 1.82rem !important;
            border-radius: 0.5rem !important;
            padding: 0 !important;
          }
          .doro-focus-friend-member-row .doro-focus-friend-icon-button svg {
            width: 0.82rem;
            height: 0.82rem;
          }
          .doro-focus-friend-confirmation-inline {
            width: 4.15rem !important;
            height: 1.82rem !important;
            padding: 0 0.42rem !important;
            gap: 0.28rem !important;
            font-size: 0.56rem !important;
          }
          .doro-focus-friend-confirmation-inline .doro-focus-friend-confirmation-heart {
            width: 0.78rem;
            height: 0.78rem;
          }
          .doro-focus-friend-join-feedback {
            width: 4.85rem !important;
            height: 1.82rem !important;
            padding: 0 0.42rem !important;
            gap: 0.28rem !important;
            font-size: 0.56rem !important;
          }
          .doro-focus-friend-join-feedback svg,
          .doro-focus-friend-join-spinner {
            width: 0.72rem;
            height: 0.72rem;
          }
          .doro-focus-friend-confirmation-label {
            font-size: 0;
          }
          .doro-focus-friend-confirmation-label::after {
            content: 'Sent';
            font-size: 0.56rem;
          }
          .doro-focus-friend-icon-button::after,
          .doro-focus-friend-icon-button::before {
            display: none;
          }
          .doro-focus-friend-encouragement-menu,
          .doro-focus-friend-encouragement-menu-up {
            position: fixed;
            inset: auto max(0.75rem, env(safe-area-inset-right)) max(0.75rem, env(safe-area-inset-bottom)) max(0.75rem, env(safe-area-inset-left));
            width: auto;
            max-height: min(16rem, 48vh);
            border-radius: 1rem;
            padding: 0.42rem;
          }
          .doro-focus-friend-encouragement-option {
            padding: 0.7rem 0.78rem;
            font-size: 0.78rem;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
        }
        @media (hover: none), (pointer: coarse) {
          .doro-focus-friend-hover-actions {
            opacity: 1;
            pointer-events: auto;
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .doro-account-stat-card,
          .doro-account-stat-rail,
          .doro-focus-friends-section,
          .doro-focus-friend-item,
          .doro-focus-friend-card,
          .doro-focus-friend-hover-actions,
          .doro-focus-friend-confirmation,
          .doro-focus-friend-confirmation::before,
          .doro-focus-friend-confirmation-heart,
          .doro-focus-friend-encouragement-menu,
          .doro-auto-start-sound-panel,
          .doro-auto-start-sound-panel-in,
          .doro-auto-start-sound-panel-out,
          .doro-category-editor-shell,
          .doro-category-editor-content,
          .doro-category-editor-section,
          .doro-category-editor-actions,
          .doro-category-editor-field,
          .doro-category-preview-icon,
          .doro-category-color-swatch,
          .doro-category-icon-option,
          .doro-category-editor-footer {
            animation: none !important;
            transition: none !important;
          }
          .doro-auto-start-sound-panel-out {
            max-height: 0 !important;
            opacity: 0 !important;
            padding-top: 0 !important;
            padding-bottom: 0 !important;
            transform: translateY(-4px) scale(0.99) !important;
            border-color: rgba(255, 255, 255, 0) !important;
          }
        }
        @keyframes doro-auto-start-sound-panel-in {
          0% {
            max-height: 0;
            opacity: 0;
            padding-top: 0;
            padding-bottom: 0;
            transform: translateY(6px) scale(0.982);
            filter: saturate(0.92);
            border-color: rgba(255, 255, 255, 0);
          }
          62% {
            max-height: 28rem;
            opacity: 1;
            padding-top: 0.875rem;
            padding-bottom: 0.875rem;
            transform: translateY(-1px) scale(1.006);
            filter: saturate(1.04);
            border-color: rgba(255, 255, 255, 0.09);
          }
          100% {
            max-height: 28rem;
            opacity: 1;
            padding-top: 0.875rem;
            padding-bottom: 0.875rem;
            transform: translateY(0) scale(1);
            filter: saturate(1);
            border-color: rgba(255, 255, 255, 0.08);
          }
        }
        @keyframes doro-auto-start-sound-panel-out {
          0% {
            max-height: 28rem;
            opacity: 1;
            padding-top: 0.875rem;
            padding-bottom: 0.875rem;
            transform: translateY(0) scale(1);
            filter: saturate(1);
            border-color: rgba(255, 255, 255, 0.08);
          }
          38% {
            max-height: 28rem;
            opacity: 0.92;
            padding-top: 0.875rem;
            padding-bottom: 0.875rem;
            transform: translateY(-3px) scale(0.996);
            filter: saturate(0.96);
            border-color: rgba(255, 255, 255, 0.06);
          }
          100% {
            max-height: 0;
            opacity: 0;
            padding-top: 0;
            padding-bottom: 0;
            transform: translateY(-8px) scale(0.982);
            filter: saturate(0.9);
            border-color: rgba(255, 255, 255, 0);
          }
        }
        .doro-auto-start-sound-panel {
          max-height: 28rem;
          overflow: hidden;
          transform-origin: top center;
          will-change: max-height, padding, transform, opacity, filter, border-color;
        }
        .doro-auto-start-sound-panel-in {
          animation: doro-auto-start-sound-panel-in 380ms cubic-bezier(0.18, 0.9, 0.32, 1.08);
        }
        .doro-auto-start-sound-panel-out {
          pointer-events: none;
          animation: doro-auto-start-sound-panel-out ${AUTO_START_SOUND_PANEL_EXIT_MS}ms cubic-bezier(0.45, 0, 0.2, 1) forwards;
        }
        @keyframes doro-category-editor-open {
          0% {
            max-height: 0;
            opacity: 0;
            padding-top: 0;
            padding-bottom: 0;
            transform: translateY(8px) scale(0.982);
            filter: saturate(0.92);
            border-color: rgba(255, 255, 255, 0);
          }
          66% {
            max-height: 72rem;
            opacity: 1;
            padding-top: 1rem;
            padding-bottom: 1rem;
            transform: translateY(-1px) scale(1.004);
            filter: saturate(1.04);
          }
          100% {
            max-height: 72rem;
            opacity: 1;
            padding-top: 1rem;
            padding-bottom: 1rem;
            transform: translateY(0) scale(1);
            filter: saturate(1);
          }
        }
        .doro-category-editor-open {
          animation: doro-category-editor-open 460ms cubic-bezier(0.18, 0.9, 0.32, 1.06);
        }
        .doro-category-editor-shell {
          max-height: 72rem;
          transform-origin: top center;
          transition:
            border-color 220ms ease,
            box-shadow 260ms ease,
            background 260ms ease;
          will-change: max-height, padding, transform, opacity, filter, border-color;
        }
        @keyframes doro-category-editor-content-in {
          0% {
            opacity: 0;
            transform: translateY(-10px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .doro-category-editor-open .doro-category-editor-content {
          animation: doro-category-editor-content-in 320ms cubic-bezier(0.22, 1, 0.36, 1) 70ms both;
        }
        @keyframes doro-category-editor-item-in {
          0% {
            opacity: 0;
            transform: translateY(8px) scale(0.985);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .doro-category-editor-open .doro-category-editor-section,
        .doro-category-editor-open .doro-category-editor-actions,
        .doro-category-editor-open .doro-category-editor-field,
        .doro-category-editor-open .doro-category-editor-footer {
          animation: doro-category-editor-item-in 320ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .doro-category-editor-open .doro-category-editor-section:nth-child(1) {
          animation-delay: 90ms;
        }
        .doro-category-editor-open .doro-category-editor-section:nth-child(2),
        .doro-category-editor-open .doro-category-editor-field {
          animation-delay: 145ms;
        }
        .doro-category-editor-open .doro-category-editor-section:nth-child(3) {
          animation-delay: 190ms;
        }
        .doro-category-editor-open .doro-category-editor-actions {
          animation-delay: 135ms;
        }
        .doro-category-editor-open .doro-category-editor-footer {
          animation-delay: 250ms;
        }
        @keyframes doro-category-preview-icon-in {
          0% {
            transform: scale(0.74) rotate(-8deg);
            opacity: 0;
            filter: saturate(0.9);
          }
          70% {
            transform: scale(1.08) rotate(2deg);
            opacity: 1;
            filter: saturate(1.08);
          }
          100% {
            transform: scale(1) rotate(0deg);
            opacity: 1;
            filter: saturate(1);
          }
        }
        .doro-category-editor-open .doro-category-preview-icon {
          animation: doro-category-preview-icon-in 390ms cubic-bezier(0.18, 0.9, 0.32, 1.12) 110ms both;
          transform-origin: center;
          transition:
            background 220ms ease,
            box-shadow 220ms ease,
            border-color 180ms ease;
        }
        @keyframes doro-category-option-pop {
          0% {
            opacity: 0;
            transform: translateY(5px) scale(0.88);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .doro-category-editor-open .doro-category-color-swatch,
        .doro-category-editor-open .doro-category-icon-option {
          animation-name: doro-category-option-pop;
          animation-duration: 280ms;
          animation-timing-function: cubic-bezier(0.2, 0.9, 0.3, 1.08);
          animation-fill-mode: backwards;
        }
        @keyframes doro-category-editor-close-save {
          0% {
            max-height: 72rem;
            opacity: 1;
            padding-top: 1rem;
            padding-bottom: 1rem;
            transform: translateY(0) scale(1);
            filter: brightness(1) saturate(1);
          }
          100% {
            max-height: 0;
            opacity: 0;
            padding-top: 0;
            padding-bottom: 0;
            transform: translateY(-6px) scale(0.985);
            filter: brightness(1.08) saturate(1.08);
          }
        }
        .doro-category-editor-close-save {
          animation: doro-category-editor-close-save ${CATEGORY_EDITOR_CLOSE_DURATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
          pointer-events: none;
        }
        @keyframes doro-category-editor-close-cancel {
          0% {
            max-height: 72rem;
            opacity: 1;
            padding-top: 1rem;
            padding-bottom: 1rem;
            transform: translateY(0) scale(1);
            filter: brightness(1) saturate(1);
          }
          100% {
            max-height: 0;
            opacity: 0;
            padding-top: 0;
            padding-bottom: 0;
            transform: translateY(8px) scale(0.978);
            filter: brightness(0.96) saturate(0.92);
          }
        }
        .doro-category-editor-close-cancel {
          animation: doro-category-editor-close-cancel ${CATEGORY_EDITOR_CLOSE_DURATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
          pointer-events: none;
        }
        @keyframes doro-settings-panel-leave-forward {
          0% {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
            filter: saturate(1);
          }
          100% {
            opacity: 0;
            transform: translate3d(-22px, 6px, 0) scale(0.988);
            filter: saturate(0.94);
          }
        }
        @keyframes doro-settings-panel-leave-backward {
          0% {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
            filter: saturate(1);
          }
          100% {
            opacity: 0;
            transform: translate3d(22px, 6px, 0) scale(0.988);
            filter: saturate(0.94);
          }
        }
        @keyframes doro-settings-panel-enter-forward {
          0% {
            opacity: 0;
            transform: translate3d(26px, 8px, 0) scale(0.988);
            filter: saturate(0.95);
          }
          62% {
            opacity: 1;
            transform: translate3d(-2px, -1px, 0) scale(1.006);
            filter: saturate(1.04);
          }
          100% {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
            filter: saturate(1);
          }
        }
        @keyframes doro-settings-panel-enter-backward {
          0% {
            opacity: 0;
            transform: translate3d(-26px, 8px, 0) scale(0.988);
            filter: saturate(0.95);
          }
          62% {
            opacity: 1;
            transform: translate3d(2px, -1px, 0) scale(1.006);
            filter: saturate(1.04);
          }
          100% {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
            filter: saturate(1);
          }
        }
        .doro-settings-panel-view {
          min-height: 100%;
          will-change: transform, opacity, filter;
          transform-origin: top center;
        }
        .doro-settings-panel-idle {
          opacity: 1;
          transform: translate3d(0, 0, 0);
        }
        .doro-settings-panel-leave-forward {
          animation: doro-settings-panel-leave-forward ${SETTINGS_PANEL_TRANSITION_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
        .doro-settings-panel-leave-backward {
          animation: doro-settings-panel-leave-backward ${SETTINGS_PANEL_TRANSITION_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
        .doro-settings-panel-enter-forward {
          animation: doro-settings-panel-enter-forward ${SETTINGS_PANEL_TRANSITION_MS}ms cubic-bezier(0.16, 0.88, 0.3, 1.04);
        }
        .doro-settings-panel-enter-backward {
          animation: doro-settings-panel-enter-backward ${SETTINGS_PANEL_TRANSITION_MS}ms cubic-bezier(0.16, 0.88, 0.3, 1.04);
        }
        .settings-tabbar {
          overflow: visible;
        }
        .settings-tablist {
          isolation: isolate;
          overflow: visible;
          padding-left: 0.04rem;
          padding-right: 0.28rem;
          padding-top: 0.04rem;
          padding-bottom: 0.04rem;
        }
        .settings-tab-indicator {
          position: absolute;
          top: 0.38rem;
          bottom: 0.38rem;
          left: 0;
          border-radius: 999px;
          pointer-events: none;
          will-change: transform, width, opacity;
          transition:
            transform 360ms cubic-bezier(0.2, 0.95, 0.25, 1),
            width 360ms cubic-bezier(0.2, 0.95, 0.25, 1),
            opacity 180ms ease;
          overflow: hidden;
        }
        .settings-tab-indicator::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(112deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.2) 42%, rgba(255,255,255,0.08) 58%, rgba(255,255,255,0) 100%);
          opacity: 0.72;
          transform: translateX(-110%);
          animation: doro-settings-tab-sheen 680ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @keyframes doro-settings-tab-sheen {
          0% {
            transform: translateX(-110%);
          }
          100% {
            transform: translateX(120%);
          }
        }
        .settings-tab-btn {
          position: relative;
          z-index: 1;
          border-radius: 999px;
          border: 1px solid transparent;
          background: transparent !important;
          transition:
            transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
            color 220ms ease,
            border-color 180ms ease,
            background-color 180ms ease,
            box-shadow 220ms ease,
            opacity 200ms ease;
        }
        .settings-tab-btn:hover {
          transform: none;
        }
        .settings-tab-btn:active {
          transform: scale(0.985);
        }
        .settings-tab-label {
          position: relative;
          display: block;
          transform: translateY(0.2px);
          opacity: 0.74;
          transition:
            transform 280ms cubic-bezier(0.22, 1, 0.36, 1),
            opacity 220ms ease,
            letter-spacing 260ms ease,
            text-shadow 220ms ease;
        }
        .settings-tab-btn:not(.is-active):hover .settings-tab-label {
          transform: translateY(-0.15px);
          opacity: 0.88;
        }
        .settings-tab-btn.is-active .settings-tab-label {
          transform: translateY(-0.35px);
          opacity: 1;
        }
        .settings-close-slot {
          background: transparent;
          box-shadow: none;
          transition: background-color 180ms ease, border-color 180ms ease, box-shadow 220ms ease;
        }
        .settings-close-btn {
          border-radius: 999px;
          backdrop-filter: blur(18px) saturate(165%);
          -webkit-backdrop-filter: blur(18px) saturate(165%);
          transition:
            transform 180ms cubic-bezier(0.22, 1, 0.36, 1),
            background-color 180ms ease,
            border-color 180ms ease,
            box-shadow 220ms ease,
            color 180ms ease,
            opacity 180ms ease;
        }
        .settings-close-btn:hover {
          transform: none;
        }
        .settings-close-btn:active {
          transform: scale(0.97);
        }
        .settings-option-btn {
          transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 220ms ease, background-color 180ms ease, border-color 180ms ease;
        }
        .settings-option-btn:hover {
          transform: translateY(-1px) scale(1.01);
          box-shadow: 0 10px 20px -14px rgba(15, 23, 42, 0.55);
        }
        .settings-option-btn:active {
          transform: translateY(0) scale(0.985);
        }
        .doro-focus-preview-btn {
          width: 2rem;
          height: 2rem;
          flex: 0 0 2rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 0.75rem;
          border: 1px solid rgba(255, 255, 255, 0.10);
          background: rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.68);
          transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 220ms ease, background-color 180ms ease, border-color 180ms ease, color 180ms ease;
        }
        .doro-focus-preview-btn:hover:not(:disabled) {
          transform: translateY(-1px) scale(1.03);
          border-color: rgba(255, 255, 255, 0.18);
          background: rgba(255, 255, 255, 0.10);
          color: rgba(255, 255, 255, 0.92);
          box-shadow: 0 12px 22px -16px rgba(0, 0, 0, 0.68);
        }
        .doro-focus-preview-btn:active:not(:disabled) {
          transform: translateY(0) scale(0.96);
        }
        .doro-focus-preview-btn:disabled {
          cursor: not-allowed;
          opacity: 0.36;
        }
        .doro-focus-preview-btn.is-playing {
          border-color: rgba(255, 255, 255, 0.24);
          background: rgba(255, 255, 255, 0.16);
          color: white;
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.05), 0 12px 24px -18px rgba(255, 255, 255, 0.32);
        }
        .doro-focus-preview-btn svg {
          transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .doro-focus-preview-btn:hover:not(:disabled) svg {
          transform: scale(1.08);
        }
        .doro-focus-sound-slider-shell {
          position: relative;
          display: flex;
          align-items: center;
          width: 100%;
          height: 1rem;
        }
        .doro-focus-sound-slider-track {
          position: absolute;
          inset: 50% 0 auto 0;
          height: 0.625rem;
          transform: translateY(-50%);
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          overflow: hidden;
          transition: border-color 180ms ease, box-shadow 180ms ease;
        }
        .doro-focus-sound-slider-fill {
          height: 100%;
          border-radius: inherit;
          transition: background-color 160ms ease;
        }
        .doro-focus-sound-slider {
          -webkit-appearance: none;
          appearance: none;
          position: relative;
          z-index: 1;
          width: 100%;
          height: 1rem;
          margin: 0;
          background: transparent;
          border: none;
          outline: none;
          cursor: pointer;
        }
        .doro-focus-sound-slider-shell:hover .doro-focus-sound-slider-track {
          border-color: rgba(255, 255, 255, 0.14);
          box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.06), 0 10px 18px -18px rgba(0, 0, 0, 0.68);
        }
        .doro-focus-sound-slider::-webkit-slider-runnable-track {
          -webkit-appearance: none;
          appearance: none;
          height: 1rem;
          background: transparent;
          border: none;
          border-radius: 999px;
        }
        .doro-focus-sound-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 1rem;
          height: 1rem;
          margin-top: 0;
          border-radius: 999px;
          background: #f8fafc;
          border: 2px solid rgba(15, 23, 42, 0.78);
          box-shadow: 0 8px 18px -10px rgba(0, 0, 0, 0.62);
          transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 180ms ease;
        }
        .doro-focus-sound-slider-shell:hover .doro-focus-sound-slider::-webkit-slider-thumb {
          transform: scale(1.05);
          box-shadow: 0 10px 18px -10px rgba(0, 0, 0, 0.66);
        }
        .doro-focus-sound-slider::-moz-range-track {
          height: 1rem;
          background: transparent;
          border: none;
          border-radius: 999px;
        }
        .doro-focus-sound-slider::-moz-range-progress {
          background: transparent;
          border: none;
        }
        .doro-focus-sound-slider::-moz-range-thumb {
          width: 1rem;
          height: 1rem;
          border-radius: 999px;
          background: #f8fafc;
          border: 2px solid rgba(15, 23, 42, 0.78);
          box-shadow: 0 8px 18px -10px rgba(0, 0, 0, 0.62);
          transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 180ms ease;
        }
        .doro-focus-sound-slider-shell:hover .doro-focus-sound-slider::-moz-range-thumb {
          transform: scale(1.05);
          box-shadow: 0 10px 18px -10px rgba(0, 0, 0, 0.66);
        }
        .doro-no-spin::-webkit-outer-spin-button,
        .doro-no-spin::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .doro-no-spin[type='number'] {
          -moz-appearance: textfield;
          appearance: textfield;
        }
        @media (max-width: 767px) {
          .doro-settings-shell {
            height: calc(100dvh - 1rem) !important;
            max-height: calc(100dvh - 1rem);
            border-radius: 1.45rem !important;
          }
          .doro-settings-shell input,
          .doro-settings-shell textarea,
          .doro-settings-shell select {
            font-size: 16px;
          }
          .settings-tabbar {
            padding: 0.46rem 0.38rem 0.4rem !important;
            gap: 0.25rem !important;
          }
          .settings-tablist {
            display: flex !important;
            min-width: 100% !important;
            width: max-content;
            gap: 0.16rem;
            padding-left: 0 !important;
            padding-right: 0 !important;
          }
          .settings-tab-btn {
            flex: 1 0 auto !important;
            min-width: max-content;
            width: auto;
            padding: 0.78rem 0.72rem !important;
            font-size: clamp(0.5rem, 1.72vw, 0.625rem) !important;
            letter-spacing: 0.12em !important;
            text-align: center;
          }
          .settings-tab-label {
            overflow: visible;
            text-overflow: clip;
            line-height: 1.15;
            white-space: nowrap;
          }
          .settings-tab-indicator {
            top: 0.32rem;
            bottom: 0.32rem;
          }
          .settings-close-slot {
            width: 3rem !important;
            margin-left: 0.18rem !important;
          }
          .settings-close-btn {
            width: 2.5rem !important;
            height: 2.5rem !important;
          }
          .settings-body {
            overscroll-behavior: contain;
          }
          .doro-settings-panel-view > div {
            padding-left: 0.8rem !important;
            padding-right: 0.8rem !important;
          }
          .settings-panel-content {
            padding-top: 1.25rem !important;
            padding-bottom: 2rem !important;
          }
          .settings-panel-content button {
            min-height: 2.35rem;
          }
          .settings-option-btn {
            min-height: 2.35rem;
          }
          .settings-sound-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
            gap: 0.45rem !important;
          }
          .settings-sound-option-btn {
            min-height: 2.15rem !important;
            border-radius: 0.7rem !important;
            padding: 0.52rem 0.38rem !important;
            font-size: 0.53rem !important;
            letter-spacing: 0.085em !important;
            line-height: 1.05;
          }
          .doro-auto-start-sound-panel {
            border-radius: 0.9rem !important;
            padding-left: 0.75rem !important;
            padding-right: 0.75rem !important;
          }
          .doro-focus-preview-btn {
            width: 2.5rem;
            height: 2.5rem;
            flex-basis: 2.5rem;
          }
          .doro-focus-sound-slider-shell,
          .doro-focus-sound-slider,
          .doro-focus-sound-slider::-webkit-slider-runnable-track,
          .doro-focus-sound-slider::-moz-range-track {
            height: 2.25rem !important;
          }
          .doro-focus-sound-slider {
            min-height: 2.25rem !important;
            box-sizing: border-box;
            padding-block: 0.45rem !important;
          }
          .doro-focus-sound-slider-track {
            height: 0.8rem !important;
          }
          .doro-focus-sound-slider::-webkit-slider-thumb {
            width: 1.35rem;
            height: 1.35rem;
          }
          .doro-focus-sound-slider::-moz-range-thumb {
            width: 1.35rem;
            height: 1.35rem;
          }
          .doro-category-editor-shell {
            border-radius: 1.1rem !important;
            padding: 0.875rem !important;
          }
          .doro-category-editor-field {
            min-width: 100% !important;
          }
          .doro-category-editor-actions button,
          .doro-category-editor-footer button {
            min-height: 2.75rem;
          }
        }
        .doro-settings-shell.theme-light {
          position: relative;
          isolation: isolate;
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.05)),
            linear-gradient(155deg, rgba(255, 255, 255, 0.84) 0%, rgba(247, 250, 255, 0.6) 34%, rgba(232, 240, 251, 0.42) 100%) !important;
          border-color: rgba(255, 255, 255, 0.58) !important;
          backdrop-filter: blur(34px) saturate(185%) !important;
          -webkit-backdrop-filter: blur(34px) saturate(185%) !important;
          box-shadow:
            0 44px 120px -56px rgba(67, 85, 116, 0.58),
            inset 0 1px 0 rgba(255, 255, 255, 0.82),
            inset 0 -1px 0 rgba(255, 255, 255, 0.22),
            0 0 0 1px rgba(255, 255, 255, 0.24) !important;
        }
        .doro-settings-shell.theme-light::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            radial-gradient(circle at 18% -8%, rgba(255, 255, 255, 0.96), transparent 34%),
            radial-gradient(circle at 87% 6%, rgba(122, 187, 255, 0.34), transparent 26%),
            radial-gradient(circle at 50% 120%, rgba(174, 204, 255, 0.18), transparent 42%),
            linear-gradient(180deg, rgba(255, 255, 255, 0.26), rgba(255, 255, 255, 0) 28%, rgba(255, 255, 255, 0.1) 100%);
          opacity: 0.96;
          pointer-events: none;
        }
        .doro-settings-shell.theme-light::after {
          content: '';
          position: absolute;
          inset: 1px;
          border-radius: inherit;
          border: 1px solid rgba(255, 255, 255, 0.28);
          pointer-events: none;
        }
        .doro-settings-shell.theme-light > * {
          position: relative;
          z-index: 1;
        }
        .doro-settings-shell.theme-light .settings-tabbar {
          padding: 0.76rem 0.68rem 0.62rem;
          gap: 0.4rem;
          border-color: rgba(255, 255, 255, 0.26) !important;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.34), rgba(245, 249, 255, 0.14)) !important;
          backdrop-filter: blur(18px) saturate(180%);
          -webkit-backdrop-filter: blur(18px) saturate(180%);
          box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.28);
        }
        .doro-settings-shell.theme-light .settings-tabbar .settings-tab-btn {
          color: #6b7a90 !important;
          text-shadow: 0 1px 0 rgba(255, 255, 255, 0.28);
        }
        .doro-settings-shell.theme-light .settings-tab-indicator {
          border: 1px solid rgba(255, 255, 255, 0.58);
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.7), rgba(243, 248, 255, 0.34));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.84), 0 20px 30px -26px rgba(77, 93, 123, 0.44);
        }
        .doro-settings-shell.theme-light .settings-tabbar .settings-tab-btn:not(.is-active):hover {
          color: #102133 !important;
          border-color: rgba(255, 255, 255, 0.24);
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(244, 248, 255, 0.08)) !important;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.48), 0 10px 18px -18px rgba(77, 93, 123, 0.18);
        }
        .doro-settings-shell.theme-light .settings-tabbar .settings-tab-btn.is-active {
          color: #102133 !important;
          border-color: transparent !important;
          box-shadow: none;
        }
        .doro-settings-shell.theme-light .settings-close-slot {
          border-color: rgba(255, 255, 255, 0.22) !important;
          background: transparent !important;
        }
        .doro-settings-shell.theme-light .settings-close-btn {
          border-color: rgba(255, 255, 255, 0.34) !important;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.42), rgba(241, 246, 253, 0.12)) !important;
          color: #66778f !important;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.68), 0 14px 22px -22px rgba(77, 93, 123, 0.26);
        }
        .doro-settings-shell.theme-light .settings-close-btn:hover {
          border-color: rgba(255, 255, 255, 0.44) !important;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.52), rgba(243, 248, 255, 0.18)) !important;
          color: #102133 !important;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 12px 22px -22px rgba(77, 93, 123, 0.22);
        }
        .doro-settings-shell.theme-light .settings-body {
          position: relative;
          background:
            radial-gradient(circle at 14% -10%, rgba(255, 255, 255, 0.92), transparent 28%),
            radial-gradient(circle at 100% 0%, rgba(95, 179, 255, 0.16), transparent 24%),
            linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(242, 247, 255, 0.08)),
            rgba(233, 240, 250, 0.18) !important;
          backdrop-filter: blur(24px) saturate(175%);
          -webkit-backdrop-filter: blur(24px) saturate(175%);
        }
        .doro-settings-shell.theme-light .settings-body::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            linear-gradient(145deg, rgba(255, 255, 255, 0.22), transparent 24%, rgba(255, 255, 255, 0) 62%),
            radial-gradient(circle at 78% 14%, rgba(148, 199, 255, 0.18), transparent 22%);
          pointer-events: none;
        }
        .doro-settings-shell.theme-light .settings-body > * {
          position: relative;
          z-index: 1;
        }
        .doro-settings-shell.theme-light .settings-body [class*='bg-white/'],
        .doro-settings-shell.theme-light .settings-body [class*='bg-black/'] {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.46), rgba(245, 248, 255, 0.18)) !important;
          border-color: rgba(255, 255, 255, 0.34) !important;
          backdrop-filter: blur(22px) saturate(165%);
          -webkit-backdrop-filter: blur(22px) saturate(165%);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72), 0 22px 32px -28px rgba(82, 101, 136, 0.38);
        }
        .doro-settings-shell.theme-light .settings-body input,
        .doro-settings-shell.theme-light .settings-body textarea,
        .doro-settings-shell.theme-light .settings-body select {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.58), rgba(244, 248, 255, 0.24)) !important;
          border-color: rgba(255, 255, 255, 0.42) !important;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.76), 0 18px 28px -26px rgba(82, 101, 136, 0.34);
          backdrop-filter: blur(18px) saturate(160%);
          -webkit-backdrop-filter: blur(18px) saturate(160%);
          color: #0f2033 !important;
        }
        .doro-settings-shell.theme-light .settings-body input::placeholder,
        .doro-settings-shell.theme-light .settings-body textarea::placeholder {
          color: rgba(88, 107, 133, 0.56) !important;
        }
        .doro-settings-shell.theme-light .settings-body .settings-option-btn,
        .doro-settings-shell.theme-light .settings-body button[class*='border'],
        .doro-settings-shell.theme-light .settings-body button[class*='bg-white'],
        .doro-settings-shell.theme-light .settings-body button[class*='bg-black/'] {
          backdrop-filter: blur(18px) saturate(160%);
          -webkit-backdrop-filter: blur(18px) saturate(160%);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7), 0 18px 30px -26px rgba(87, 104, 137, 0.35);
        }
        .doro-settings-shell.theme-light .settings-option-btn:hover {
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.82), 0 22px 36px -28px rgba(76, 96, 130, 0.42);
        }
        .doro-settings-shell.theme-light .doro-focus-preview-btn {
          border-color: rgba(15, 23, 42, 0.14) !important;
          background: rgba(15, 23, 42, 0.06) !important;
          color: rgba(15, 23, 42, 0.62) !important;
        }
        .doro-settings-shell.theme-light .doro-focus-preview-btn:hover:not(:disabled) {
          border-color: rgba(15, 23, 42, 0.22) !important;
          background: rgba(15, 23, 42, 0.10) !important;
          color: rgba(15, 23, 42, 0.88) !important;
          box-shadow: 0 12px 22px -16px rgba(15, 23, 42, 0.35);
        }
        .doro-settings-shell.theme-light .doro-focus-preview-btn.is-playing {
          border-color: rgba(15, 23, 42, 0.26) !important;
          background: rgba(15, 23, 42, 0.14) !important;
          color: rgb(15, 23, 42) !important;
          box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.05), 0 12px 24px -18px rgba(15, 23, 42, 0.3);
        }
        .doro-settings-shell.theme-light .doro-focus-sound-slider-shell:hover .doro-focus-sound-slider-track {
          border-color: rgba(15, 23, 42, 0.18);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.76), 0 14px 24px -22px rgba(76, 96, 130, 0.28);
        }
        .doro-settings-shell.theme-light .doro-focus-sound-slider::-webkit-slider-thumb {
          border-color: rgba(196, 209, 227, 0.96);
          box-shadow: 0 10px 18px -12px rgba(76, 96, 130, 0.28);
        }
        .doro-settings-shell.theme-light .doro-focus-sound-slider::-moz-range-thumb {
          border-color: rgba(196, 209, 227, 0.96);
          box-shadow: 0 10px 18px -12px rgba(76, 96, 130, 0.28);
        }
        .doro-settings-shell.theme-light [class*='border-white/'] {
          border-color: rgba(15, 23, 42, 0.12) !important;
        }
        .doro-settings-shell.theme-light [class*='text-white'] {
          color: #102133 !important;
        }
        .doro-settings-shell.theme-light [class*='text-white/'] {
          color: #667990 !important;
        }
        .doro-settings-shell.theme-dark .settings-tabbar {
          padding: 0.76rem 0.68rem 0.62rem;
          gap: 0.4rem;
          border-color: rgba(255, 255, 255, 0.08) !important;
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.015)),
            linear-gradient(180deg, rgba(8, 12, 20, 0.86), rgba(8, 12, 20, 0.68)) !important;
          box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.06);
        }
        .doro-settings-shell.theme-dark .settings-tab-indicator {
          border: 1px solid rgba(255, 255, 255, 0.12);
          background:
            radial-gradient(circle at 20% 24%, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.03) 54%, rgba(255, 255, 255, 0.015) 100%),
            linear-gradient(180deg, rgba(255, 255, 255, 0.075), rgba(0, 0, 0, 0.16));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 18px 24px -24px rgba(0, 0, 0, 0.78);
        }
        .doro-settings-shell.theme-dark .settings-tabbar .settings-tab-btn {
          color: rgba(255, 255, 255, 0.42);
        }
        .doro-settings-shell.theme-dark .settings-tabbar .settings-tab-btn:not(.is-active):hover {
          color: rgba(255, 255, 255, 0.72);
          border-color: rgba(255, 255, 255, 0.07);
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.032), rgba(255, 255, 255, 0.012)) !important;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 10px 18px -18px rgba(0, 0, 0, 0.62);
        }
        .doro-settings-shell.theme-dark .settings-tabbar .settings-tab-btn.is-active {
          color: rgba(255, 255, 255, 0.94);
          border-color: transparent;
        }
        .doro-settings-shell.theme-dark .settings-tabbar .settings-tab-btn.is-active .settings-tab-label {
          text-shadow: 0 1px 12px rgba(255, 255, 255, 0.12);
        }
        .doro-settings-shell.theme-dark .settings-close-slot {
          border-color: rgba(255, 255, 255, 0.08);
          background: transparent;
        }
        .doro-settings-shell.theme-dark .settings-close-btn {
          border-color: rgba(255, 255, 255, 0.11);
          background:
            radial-gradient(circle at 28% 28%, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.016) 70%),
            linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(0, 0, 0, 0.16));
          color: rgba(255, 255, 255, 0.64);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 14px 22px -24px rgba(0, 0, 0, 0.74);
        }
        .doro-settings-shell.theme-dark .settings-close-btn:hover {
          border-color: rgba(255, 255, 255, 0.14);
          background:
            radial-gradient(circle at 28% 28%, rgba(255, 255, 255, 0.11), rgba(255, 255, 255, 0.02) 70%),
            linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(0, 0, 0, 0.18));
          color: rgba(255, 255, 255, 0.82);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 12px 20px -24px rgba(0, 0, 0, 0.62);
        }
        .doro-focus-friends-tabbar {
          width: min(13rem, 100%);
          padding: 0.32rem !important;
          gap: 0 !important;
          border-radius: 0.92rem;
          border: 1px solid;
          overflow: visible;
        }
        .doro-focus-friends-tablist {
          width: 100% !important;
          min-width: 0 !important;
          gap: 0.14rem !important;
          padding: 0 !important;
        }
        .doro-focus-friends-tab-indicator {
          top: 0;
          bottom: 0;
        }
        .doro-focus-friends-tab-indicator::before {
          display: none;
        }
        .doro-focus-friends-tab-btn {
          min-height: 2.35rem !important;
          flex: 1 1 0 !important;
          min-width: 0 !important;
          width: auto !important;
          padding: 0.62rem 0.72rem !important;
          font-size: 0.625rem !important;
          letter-spacing: 0.14em !important;
          text-align: center;
        }
        .doro-focus-friends-tab-btn .settings-tab-label {
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1;
          white-space: nowrap;
        }
        .doro-settings-shell.theme-light .settings-body .doro-focus-friend-item {
          background: rgba(255, 255, 255, 0.78) !important;
          box-shadow: 0 18px 26px -18px rgba(15, 23, 42, 0.24) !important;
        }
        .doro-settings-shell.theme-dark .settings-body .doro-focus-friend-item {
          background: rgba(255, 255, 255, 0.035) !important;
          box-shadow: 0 18px 26px -18px rgba(0, 0, 0, 0.72) !important;
        }
        .doro-settings-shell.theme-light .doro-focus-friends-tabbar .doro-focus-friends-tab-btn,
        .doro-settings-shell.theme-dark .doro-focus-friends-tabbar .doro-focus-friends-tab-btn {
          text-shadow: none !important;
          box-shadow: none !important;
        }
        .doro-settings-shell.theme-light .doro-focus-friends-tabbar .doro-focus-friends-tab-btn:not(.is-active):hover {
          border-color: rgba(148, 163, 184, 0.18) !important;
          background: rgba(15, 23, 42, 0.055) !important;
          box-shadow: none !important;
        }
        .doro-settings-shell.theme-dark .doro-focus-friends-tabbar .doro-focus-friends-tab-btn:not(.is-active):hover {
          border-color: rgba(255, 255, 255, 0.08) !important;
          background: rgba(255, 255, 255, 0.055) !important;
          box-shadow: none !important;
        }
        .doro-settings-shell.theme-dark .doro-focus-friends-tabbar .doro-focus-friends-tab-btn.is-active .settings-tab-label {
          text-shadow: none !important;
        }
        .doro-settings-shell.theme-light .doro-focus-friends-tabbar {
          border-color: rgba(148, 163, 184, 0.26) !important;
          background: rgba(255, 255, 255, 0.56) !important;
          box-shadow: 0 14px 22px -20px rgba(77, 93, 123, 0.34);
        }
        .doro-settings-shell.theme-light .doro-focus-friends-tab-indicator {
          border-color: rgba(148, 163, 184, 0.18) !important;
          background: rgba(255, 255, 255, 0.92) !important;
          box-shadow: 0 12px 18px -18px rgba(77, 93, 123, 0.32) !important;
        }
        .doro-settings-shell.theme-dark .doro-focus-friends-tabbar {
          border-color: rgba(255, 255, 255, 0.08) !important;
          background: rgba(8, 12, 20, 0.76) !important;
          box-shadow: 0 14px 22px -20px rgba(0, 0, 0, 0.72);
        }
        .doro-settings-shell.theme-dark .doro-focus-friends-tab-indicator {
          border-color: rgba(255, 255, 255, 0.12) !important;
          background: rgba(255, 255, 255, 0.095) !important;
          box-shadow: 0 12px 18px -18px rgba(0, 0, 0, 0.78) !important;
        }
      `}</style>

      <div
        className={`fixed inset-0 z-40 flex items-center justify-center p-2 md:p-4 animate-fade-in ${
          isLightTheme
            ? 'bg-[rgba(16,24,38,0.18)] backdrop-blur-[20px]'
            : 'bg-black/60 backdrop-blur-xl'
        }`}
        onClick={onClose}
      >
        <div
          className={`doro-settings-shell ${isLightTheme ? 'theme-light' : 'theme-dark'} relative w-full max-w-3xl bg-[#0F0F11]/90 backdrop-blur-2xl rounded-[2rem] md:rounded-[2.5rem] shadow-2xl border border-white/10 overflow-hidden flex flex-col h-[90vh] md:h-[85vh]`}
          onClick={event => event.stopPropagation()}
        >
          <div className="settings-tabbar flex shrink-0 border-b border-white/10">
            <div className="min-w-0 flex-1 overflow-x-auto scrollbar-hide">
              <div
                ref={settingsTabListRef}
                className="settings-tablist relative flex min-w-full"
              >
                <div
                  aria-hidden="true"
                  className="settings-tab-indicator"
                  style={{
                    width: settingsTabIndicatorStyle.width,
                    opacity: settingsTabIndicatorStyle.opacity,
                    transform: `translate3d(${settingsTabIndicatorStyle.left}px, 0, 0)`,
                  }}
                />
                {SETTINGS_TAB_BUTTONS.map(tab => {
                  const isActive = tab.id !== 'schedule' && activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      ref={(node) => registerSettingsTabButton(tab.id, node)}
                      type="button"
                      onClick={() => handleTabClick(tab.id)}
                      className={`settings-tab-btn flex-1 py-4 md:py-5 px-4 font-bold text-[10px] md:text-xs uppercase tracking-[0.2em] whitespace-nowrap ${
                        isActive ? 'is-active text-white' : 'text-white/40 hover:text-white/70'
                      }`}
                    >
                      <span className="settings-tab-label">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              className="settings-close-slot md:hidden ml-1 w-[4.2rem] shrink-0 flex items-center justify-center border-l"
            >
              <button
                type="button"
                onClick={onClose}
                aria-label="Close menu"
                className="settings-close-btn flex h-10 w-10 items-center justify-center rounded-full border"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div
            ref={settingsBodyRef}
            className={`settings-body flex-1 overflow-y-auto custom-scrollbar bg-[#0F0F11]/50 relative ${
              settingsPanelTransitionPhase !== 'idle' ? 'pointer-events-none' : ''
            }`}
          >
            <div className={`doro-settings-panel-view ${settingsPanelAnimationClass}`}>
              {renderDisplayedTab()}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default LogModal;

