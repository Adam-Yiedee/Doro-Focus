import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useTimer } from '../../context/TimerContext';
import { AlarmSound, Category, FocusSound, GroupMember, GroupSyncConfig, LogEntry, SessionRecord, TimerSettings, User } from '../../types';
import AccountInsights from './AccountInsights';
import { CATEGORY_ICON_OPTIONS, getIcon } from '../../utils/icons';
import { computeAccountInsights } from '../../utils/accountInsights';
import { getCategoryMapById, resolveLogEntryCategory } from '../../utils/categoryTracking';
import { DEFAULT_GROUP_SYNC_CONFIG as DEFAULT_GROUP_CONFIG } from '../../utils/groupStudy';
import { calculateLifetimeStatsFromData } from '../../utils/lifetimeStats';
import { PASTEL_SWATCHES as PRESET_COLORS } from '../../utils/palette';
import { playAlarm } from '../../utils/sound';

interface LogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ModalTab = 'log' | 'group' | 'account' | 'settings';
type TabButton = ModalTab | 'schedule';
type GroupFlow = 'menu' | 'host' | 'join';
type SyncKey = keyof GroupSyncConfig;
type AccountAction = 'sync' | 'refresh' | null;
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

const formatCompactHours = (hours: number) => {
  const safe = Math.max(0, hours);
  return safe >= 100 ? `${Math.round(safe)}h` : `${safe.toFixed(1)}h`;
};

const formatCompactMinutes = (minutes: number) => {
  const safe = Math.max(0, minutes);
  if (safe >= 60) {
    return `${(safe / 60).toFixed(safe >= 120 ? 0 : 1)}h`;
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
const PREVIEW_ACCOUNT_USERNAME = 'master';
const PREVIEW_ACCOUNT_PASSWORD = 'master';
const CATEGORY_EDITOR_CLOSE_DURATION_MS = 220;
const SETTINGS_PANEL_TRANSITION_MS = 240;
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

const validateAccountPasswordInput = (value: string, username = '') => {
  if (isPreviewAccountCredentials(username, value)) {
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

const getSafeLifetimeStats = (user: User | null): User['lifetimeStats'] => {
  const rawStats = user?.lifetimeStats;
  const rawBreakdown = rawStats?.categoryBreakdown;
  const safeTotalFocusHours = Number(rawStats?.totalFocusHours);
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
    totalSessions: Math.max(0, Math.floor(Number(rawStats?.totalSessions || 0))),
    totalPomos: Math.max(0, Math.floor(Number(rawStats?.totalPomos || 0))),
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
  if (normalized === 'pomodoro complete' || normalized === 'session end') return '';
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
  if (entry.mode === 'focus') return `Switched to ${entry.taskName || 'Focus'}`;
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
}> = ({ label, description, checked, onToggle, disabled = false }) => {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`settings-option-btn group w-full flex items-center justify-between gap-4 rounded-[1rem] border px-4 py-3 text-left transition-[background-color,border-color,transform,color] duration-200 ${
        disabled
          ? 'cursor-not-allowed opacity-60'
          : checked
            ? 'border-white/14 bg-white/[0.065] text-white hover:bg-white/[0.08]'
            : 'border-white/8 bg-white/[0.025] text-white/72 hover:border-white/12 hover:bg-white/[0.05] hover:text-white/88'
      }`}
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold tracking-tight">{label}</div>
        {description && <div className="mt-1 text-[11px] leading-relaxed text-white/42">{description}</div>}
      </div>
      <div
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-[background-color,border-color] duration-200 ${
          checked ? 'border-blue-300/30 bg-blue-500/70' : 'border-white/8 bg-white/8'
        }`}
      >
        <div
          className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white transition-[left,transform,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            checked ? 'left-[1.35rem] shadow-[0_8px_18px_-10px_rgba(96,165,250,0.7)]' : 'left-1'
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
    settings,
    updateSettings,
    hardReset,
    pastSessions,
    categories,
    addCategory,
    updateCategory,
    deleteCategory,
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

  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authLocalError, setAuthLocalError] = useState<string | null>(null);
  const [accountActionBusy, setAccountActionBusy] = useState<AccountAction>(null);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);

  const [groupFlow, setGroupFlow] = useState<GroupFlow>('menu');
  const [groupName, setGroupName] = useState('');
  const [groupSessionInput, setGroupSessionInput] = useState('');
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupLocalError, setGroupLocalError] = useState<string | null>(null);
  const [showGroupQr, setShowGroupQr] = useState(false);
  const [hostDraftConfig, setHostDraftConfig] = useState<GroupSyncConfig>(DEFAULT_GROUP_CONFIG);
  const [joinDraftConfig, setJoinDraftConfig] = useState<GroupSyncConfig>(DEFAULT_GROUP_CONFIG);
  const [inviteSessionId, setInviteSessionId] = useState('');
  const groupNameInputRef = useRef<HTMLInputElement | null>(null);
  const inviteAutoJoinKeyRef = useRef<string | null>(null);
  const settingsBodyRef = useRef<HTMLDivElement | null>(null);
  const settingsTabListRef = useRef<HTMLDivElement | null>(null);
  const settingsTabButtonRefsRef = useRef(new Map<TabButton, HTMLButtonElement>());
  const settingsPanelTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCategoryCommitRef = useRef<(() => void) | null>(null);
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
  const categoryEditorTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const safeCategoryIds = useMemo(() => safeCategories.map((category) => category.id), [safeCategories]);
  const safeCategoryOrderKey = useMemo(() => safeCategoryIds.join('|'), [safeCategoryIds]);
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
  const safeLifetimeStats = useMemo(() => {
    if (!safeUser) return getSafeLifetimeStats(null);
    return getSafeLifetimeStats({
      ...safeUser,
      lifetimeStats: calculateLifetimeStatsFromData(safePastSessions, safeLogs, safeCategories),
    });
  }, [safeCategories, safeLogs, safePastSessions, safeUser]);
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

  const accountError = authLocalError || accountSyncError || null;
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
  const isPreviewAccountAuth = isPreviewAccountCredentials(normalizedUsernameInput, passwordInput);
  const usernameValidationMessage = normalizedUsernameInput
    ? validateAccountUsernameInput(normalizedUsernameInput)
    : null;
  const passwordValidationMessage = passwordInput
    ? validateAccountPasswordInput(passwordInput, normalizedUsernameInput)
    : null;
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

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

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
    safeCategoryIds.forEach((categoryId) => {
      const node = categoryCardRefsRef.current.get(categoryId);
      if (!node) return;
      const rect = node.getBoundingClientRect();
      tops.set(categoryId, rect.top + windowScrollY);
    });
    previousCategoryTopsRef.current = tops;
  }, [safeCategoryIds]);

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

    const categoryIdsWithoutDragged = safeCategoryIds.filter((id) => id !== draggingCategoryId);
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
  }, [draggingCategoryId, moveCategory, safeCategoryIds]);

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
    }
  }, [clearCategoryDragState, clearSettingsPanelTransitionTimeout, isOpen]);

  useEffect(() => {
    if (displayedTab !== 'settings') {
      clearCategoryDragState();
    }
  }, [clearCategoryDragState, displayedTab]);

  useEffect(() => {
    if (draggingCategoryId && !safeCategoryIds.includes(draggingCategoryId)) {
      clearCategoryDragState();
    }
  }, [clearCategoryDragState, draggingCategoryId, safeCategoryIds]);

  useLayoutEffect(() => {
    const nextTops = new Map<number, number>();
    const windowScrollY = typeof window !== 'undefined' ? window.scrollY : 0;
    safeCategoryIds.forEach((categoryId) => {
      const node = categoryCardRefsRef.current.get(categoryId);
      if (!node) return;
      const rect = node.getBoundingClientRect();
      nextTops.set(categoryId, rect.top + windowScrollY);
    });

    if (draggingCategoryId === null) {
      previousCategoryTopsRef.current = nextTops;
      return;
    }

    if (safeCategoryIds.length > CATEGORY_FLIP_MAX_ITEMS) {
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
  }, [draggingCategoryId, safeCategoryIds, safeCategoryOrderKey]);

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

  useEffect(() => {
    if (!isOpen) return;
    if (safeUser) {
      setUsernameInput(safeUser.username);
      setPasswordInput('');
      setAuthLocalError(null);
    }
  }, [isOpen, safeUser]);

  const updateTimerSettings = (patch: Partial<TimerSettings>) => {
    updateSettings({ ...settings, ...patch });
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

    const authResult = authMode === 'register'
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
    if (groupSessionId) {
      inviteAutoJoinKeyRef.current = null;
    }
  }, [groupSessionId]);

  useEffect(() => {
    return () => {
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
    const duplicateCategory = safeCategories.find((category) => (
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

  const handleDeleteCategory = (id: number) => {
    pendingCategoryCommitRef.current = null;
    deleteCategory(id);
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

      const targetCategory = safeCategories.find((category) => {
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
  }, [clearCategoryHoldTimer, draggingCategoryId, handleCategoryDragHover, releaseCategoryPointer, safeCategories]);

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
    syncDisplayedTabImmediately('settings');
    openNewCategoryForm();
    clearPendingMenuAction();
  }, [clearPendingMenuAction, isOpen, openNewCategoryForm, pendingMenuAction, syncDisplayedTabImmediately]);

  if (!isOpen) return null;

  const renderLogTab = () => {
    return (
      <div className="p-4 md:p-8 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-lg font-bold text-white tracking-tight">Activity Log</h3>
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
                        {entries.length} timer block{entries.length === 1 ? '' : 's'}
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
                      const modeLabel = entry.mode === 'focus'
                        ? 'Focus'
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
    const insights = computeAccountInsights({
      logs: safeLogs,
      categories: safeCategories,
      joinedAt: safeUser.joinedAt,
    });
    const joinedAt = formatDateTime(safeUser.joinedAt, 'Unknown');
    const activeDays = Math.max(0, Math.floor(stats.activeDays || 0));
    const dailyAvgHours = activeDays > 0 ? stats.totalFocusHours / activeDays : 0;
    const focusHoursLabel = formatCompactHours(stats.totalFocusHours);
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
    const statCards: Array<{
      label: string;
      value: string;
      color: string;
      valueClassName?: string;
    }> = [
      { label: 'Focus Time', value: focusHoursLabel, color: accountPrimaryColor },
      { label: 'Pomodoros', value: `${stats.totalPomos}`, color: PRESET_COLORS[2] },
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
    ];
    const todayStatCards: Array<{
      label: string;
      value: string;
      color: string;
      valueClassName?: string;
    }> = [
      { label: 'Focus Today', value: insights.today.focusMinutes > 0 ? formatCompactMinutes(insights.today.focusMinutes) : '0m', color: accountPrimaryColor },
      { label: 'Pomodoros', value: `${insights.today.pomodoros}`, color: PRESET_COLORS[2] },
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
    const getAccountOverviewCardStyle = (color: string): React.CSSProperties => ({
      borderColor: isLightTheme ? 'rgba(148, 163, 184, 0.16)' : 'rgba(255, 255, 255, 0.08)',
      backgroundColor: isLightTheme ? colorToRgba(color, 0.065) : 'rgba(255, 255, 255, 0.028)',
      boxShadow: isLightTheme
        ? '0 16px 30px -28px rgba(15, 23, 42, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.74)'
        : '0 18px 34px -30px rgba(0, 0, 0, 0.58), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
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
        className={`doro-account-stat-card group relative overflow-hidden rounded-[1.2rem] border px-4 py-4 md:px-5 md:py-5 transform-gpu transition-[transform,border-color,background-color,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform hover:-translate-y-[3px] hover:scale-[1.012] ${
          isLightTheme
            ? 'hover:border-slate-300/70 hover:shadow-[0_22px_34px_-30px_rgba(15,23,42,0.22)]'
            : 'hover:border-white/14 hover:shadow-[0_22px_34px_-28px_rgba(0,0,0,0.72)]'
        }`}
        style={{
          ...getAccountOverviewCardStyle(card.color),
          animationDelay: `${index * 70}ms`,
        }}
      >
        <div className="relative">
          <div className={`${overviewCardLabelClassName} truncate`}>{card.label}</div>
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

    return (
      <div className="p-4 md:p-8 space-y-5">
        {(accountError || accountMessage) && (
          <div className="grid gap-3 md:grid-cols-2">
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

            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
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
                <div className={`${overviewHeadingClassName} mt-0`}>Lifetime totals</div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
      ? 'Create an account to track statistics and save across devices.'
      : 'Sign in to track statistics and save across devices.';

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
                minLength={isPreviewAccountAuth ? undefined : ACCOUNT_PASSWORD_MIN_LENGTH}
                maxLength={ACCOUNT_PASSWORD_MAX_LENGTH}
                value={passwordInput}
                onChange={event => setPasswordInput(event.target.value)}
                placeholder="Password"
                aria-invalid={Boolean(passwordValidationMessage)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-white outline-none transition-all placeholder-white/25 focus:border-white/30"
                disabled={authBusy}
              />
              <div className="mt-2 min-h-[1.25rem] text-[11px] leading-relaxed text-white/50">
                {passwordValidationMessage || (isPreviewAccountAuth ? 'Preview account password accepted.' : 'Use at least 8 characters.')}
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

    if (groupBusy) {
      return (
        <div className="p-4 md:p-8 min-h-[520px] flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-white/20 border-t-white animate-spin" />
          <span className="text-white/55 text-xs uppercase tracking-[0.16em] font-bold">Connecting...</span>
        </div>
      );
    }

    if (safeGroupSessionId) {
      return (
        <div className="p-4 md:p-8 min-h-[520px]">
          <div className="max-w-xl mx-auto space-y-5">
            <div className="text-center space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-400/18 bg-blue-500/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-200/85">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-300" />
                Live Session
              </div>
              <h3 className="text-[2rem] font-semibold text-white tracking-tight">Group Study Active</h3>
              <p className="text-sm text-white/42">
                {safeMembers.length} member{safeMembers.length === 1 ? '' : 's'} connected {isHost ? '· You are hosting' : '· Connected to host'}
              </p>
            </div>

            <div className="rounded-[1.75rem] border border-white/8 bg-white/[0.03] p-5 md:p-6 space-y-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1">
                  <label className="text-[10px] font-bold text-white/32 uppercase tracking-[0.16em]">Session Code</label>
                  <div className="mt-3 rounded-[1.2rem] border border-white/8 bg-black/20 px-4 py-4 md:px-5">
                    <div className="text-[1.9rem] md:text-[2.2rem] font-mono font-bold tracking-[0.18em] text-center text-white">
                      {safeGroupSessionId}
                    </div>
                    <div className="mt-2 text-center text-[11px] leading-relaxed text-white/40">
                      Share the code, link, or QR to bring someone into the room.
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 md:max-w-[15rem] md:justify-end">
                  <button
                    type="button"
                    onClick={async () => { await copyToClipboard(safeGroupSessionId); }}
                    className="rounded-[0.95rem] border border-blue-400/18 bg-blue-500/[0.09] px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-200 transition-[background-color,border-color,color,transform] duration-200 hover:-translate-y-[1px] hover:bg-blue-500/[0.14] hover:text-blue-100"
                  >
                    Copy Code
                  </button>
                  <button
                    type="button"
                    onClick={async () => { await copyToClipboard(groupInviteUrl); }}
                    className="rounded-[0.95rem] border border-blue-400/18 bg-blue-500/[0.09] px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-200 transition-[background-color,border-color,color,transform] duration-200 hover:-translate-y-[1px] hover:bg-blue-500/[0.14] hover:text-blue-100"
                  >
                    Copy Link
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowGroupQr(prev => !prev)}
                    className="rounded-[0.95rem] border border-white/10 bg-white/[0.035] px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/72 transition-[background-color,border-color,color,transform] duration-200 hover:-translate-y-[1px] hover:bg-white/[0.08] hover:text-white"
                  >
                    {showGroupQr ? 'Hide QR' : 'Show QR'}
                  </button>
                </div>
              </div>

              {showGroupQr && (
                <div className="space-y-3 rounded-[1.2rem] border border-white/8 bg-white/[0.025] px-4 py-4">
                  <div className="flex justify-center rounded-[1rem] bg-white p-4">
                    <QRCodeSVG value={groupInviteUrl} size={180} />
                  </div>
                  <div className="text-center text-[11px] leading-relaxed text-white/46">
                    Scan to open the site and jump into this group invite.
                  </div>
                </div>
              )}

              <div className="border-t border-white/6 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <label className="block text-[10px] font-bold text-white/32 uppercase tracking-[0.16em]">
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
                      className={`flex items-center gap-2 rounded-full border px-3 py-2 text-sm ${
                        member.isHost
                          ? 'border-blue-400/22 bg-blue-500/[0.13] text-blue-100'
                          : 'border-white/8 bg-white/[0.04] text-white/84'
                      }`}
                    >
                      <div className={`h-2 w-2 rounded-full ${member.isHost ? 'bg-blue-300' : 'bg-white/45'}`} />
                      <span className="font-semibold tracking-tight">{member.name}{member.isHost ? ' (Host)' : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {isHost ? (
              <div className="rounded-[1.75rem] border border-white/8 bg-white/[0.03] p-5 md:p-6 space-y-3">
                <div>
                  <div className="text-[10px] font-bold text-white/32 uppercase tracking-[0.16em]">Host Sync Controls</div>
                  <div className="mt-1 text-sm text-white/44">Choose what the room follows in real time.</div>
                </div>
                <ToggleRow label="Sync Timers" checked={hostControls.syncTimers} onToggle={() => toggleLiveHostSync('syncTimers')} />
                <ToggleRow label="Sync Tasks" checked={hostControls.syncTasks} onToggle={() => toggleLiveHostSync('syncTasks')} />
                <ToggleRow label="Sync Schedule" checked={hostControls.syncSchedule} onToggle={() => toggleLiveHostSync('syncSchedule')} />
                <ToggleRow label="Sync History" checked={hostControls.syncHistory} onToggle={() => toggleLiveHostSync('syncHistory')} />
                <ToggleRow label="Sync Settings" checked={hostControls.syncSettings} onToggle={() => toggleLiveHostSync('syncSettings')} />
              </div>
            ) : (
              <div className="rounded-[1.75rem] border border-white/8 bg-white/[0.03] p-5 md:p-6 space-y-3">
                <div>
                  <div className="text-[10px] font-bold text-white/32 uppercase tracking-[0.16em]">Accepted Sync Types</div>
                  <div className="mt-1 text-sm leading-relaxed text-white/44">
                    Turn off any sync you want to manage locally without affecting the host.
                  </div>
                </div>
                <ToggleRow label="Accept Timer Sync" checked={clientControls.syncTimers} onToggle={() => toggleLiveClientSync('syncTimers')} />
                <ToggleRow label="Accept Task Sync" checked={clientControls.syncTasks} onToggle={() => toggleLiveClientSync('syncTasks')} />
                <ToggleRow label="Accept Schedule Sync" checked={clientControls.syncSchedule} onToggle={() => toggleLiveClientSync('syncSchedule')} />
                <ToggleRow label="Accept History Sync" checked={clientControls.syncHistory} onToggle={() => toggleLiveClientSync('syncHistory')} />
                <ToggleRow label="Accept Settings Sync" checked={clientControls.syncSettings} onToggle={() => toggleLiveClientSync('syncSettings')} />
              </div>
            )}

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
                inviteAutoJoinKeyRef.current = null;
                setInviteSessionId('');
                setGroupFlow('menu');
              }}
              className="w-full rounded-[1rem] border border-red-500/24 bg-red-500/[0.06] py-3 text-xs font-semibold uppercase tracking-[0.16em] text-red-200 transition-[background-color,border-color,color] duration-200 hover:border-red-400/28 hover:bg-red-500/[0.12] hover:text-red-100"
            >
              Leave Session
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="p-4 md:p-8 min-h-[520px]">
        <div className="max-w-md mx-auto space-y-6">
          <div className="text-center space-y-2">
            <h3 className="text-3xl font-bold text-white tracking-tight">Group Study</h3>
            <p className="text-white/45 text-xs uppercase tracking-[0.14em]">
              Sync timers and study with friends.
            </p>
          </div>

          {groupError && (
            <div className="p-3 bg-red-500/15 border border-red-500/30 rounded-xl text-red-200 text-xs text-center font-bold">
              {groupError}
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold text-white/35 uppercase tracking-[0.14em] mb-2">Your Name</label>
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
              className="w-full p-4 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:border-white/30 text-center font-bold"
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                disabled={!groupName.trim()}
                onClick={() => setGroupFlow('host')}
                className="p-5 rounded-2xl bg-white/10 border border-white/10 hover:bg-white/20 text-white transition-all disabled:opacity-55 disabled:cursor-not-allowed"
              >
                <div className="text-sm font-bold uppercase tracking-[0.12em]">Host Session</div>
                <div className="text-[10px] text-white/45 mt-2">Create a room and share ID/QR.</div>
              </button>
              <button
                type="button"
                disabled={!groupName.trim()}
                onClick={() => setGroupFlow('join')}
                className="p-5 rounded-2xl bg-white/10 border border-white/10 hover:bg-white/20 text-white transition-all disabled:opacity-55 disabled:cursor-not-allowed"
              >
                <div className="text-sm font-bold uppercase tracking-[0.12em]">Join Session</div>
                <div className="text-[10px] text-white/45 mt-2">Connect with a session ID.</div>
              </button>
            </div>
          )}

          {groupFlow === 'host' && (
            <div className="space-y-4 bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-white/70">Host Sync Options</div>
                <button
                  type="button"
                  onClick={() => {
                    inviteAutoJoinKeyRef.current = null;
                    setInviteSessionId('');
                    setGroupFlow('menu');
                  }}
                  className="text-[10px] text-white/45 hover:text-white uppercase tracking-[0.14em] font-bold"
                >
                  Back
                </button>
              </div>
              <ToggleRow label="Sync Timers" checked={hostDraftConfig.syncTimers} onToggle={() => toggleHostDraftSync('syncTimers')} />
              <ToggleRow label="Sync Tasks" checked={hostDraftConfig.syncTasks} onToggle={() => toggleHostDraftSync('syncTasks')} />
              <ToggleRow label="Sync Schedule" checked={hostDraftConfig.syncSchedule} onToggle={() => toggleHostDraftSync('syncSchedule')} />
              <ToggleRow label="Sync History" checked={hostDraftConfig.syncHistory} onToggle={() => toggleHostDraftSync('syncHistory')} />
              <ToggleRow label="Sync Settings" checked={hostDraftConfig.syncSettings} onToggle={() => toggleHostDraftSync('syncSettings')} />
              <button
                type="button"
                onClick={handleCreateGroup}
                className="w-full py-3 bg-blue-500/20 border border-blue-500/35 text-blue-100 rounded-xl text-xs font-bold uppercase tracking-[0.14em] hover:bg-blue-500/28 transition-colors"
              >
                Start Session
              </button>
            </div>
          )}

          {groupFlow === 'join' && (
            <div className="space-y-4 bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-white/70">Join Session</div>
                <button
                  type="button"
                  onClick={() => {
                    inviteAutoJoinKeyRef.current = null;
                    setInviteSessionId('');
                    setGroupFlow('menu');
                  }}
                  className="text-[10px] text-white/45 hover:text-white uppercase tracking-[0.14em] font-bold"
                >
                  Back
                </button>
              </div>

              {inviteSessionId && inviteSessionId === groupSessionInput && (
                <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-100/90">
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
                className="w-full p-4 bg-black/25 border border-white/10 rounded-xl text-center text-white font-mono tracking-[0.2em] outline-none focus:border-white/30"
              />

              <ToggleRow label="Accept Timer Sync" checked={joinDraftConfig.syncTimers} onToggle={() => toggleJoinDraftSync('syncTimers')} />
              <ToggleRow label="Accept Task Sync" checked={joinDraftConfig.syncTasks} onToggle={() => toggleJoinDraftSync('syncTasks')} />
              <ToggleRow label="Accept Schedule Sync" checked={joinDraftConfig.syncSchedule} onToggle={() => toggleJoinDraftSync('syncSchedule')} />
              <ToggleRow label="Accept History Sync" checked={joinDraftConfig.syncHistory} onToggle={() => toggleJoinDraftSync('syncHistory')} />
              <ToggleRow label="Accept Settings Sync" checked={joinDraftConfig.syncSettings} onToggle={() => toggleJoinDraftSync('syncSettings')} />

              <button
                type="button"
                onClick={handleJoinGroup}
                className="w-full py-3 bg-purple-500/20 border border-purple-500/35 text-purple-100 rounded-xl text-xs font-bold uppercase tracking-[0.14em] hover:bg-purple-500/30 transition-colors"
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
    const focusSoundSliderProgressWidth = focusSoundVolumePercent <= 0
      ? '0%'
      : focusSoundVolumePercent >= 100
        ? '100%'
        : `calc(${focusSoundVolumePercent}% + 0.5rem)`;

    return (
      <div className="p-4 pt-16 pb-10 md:p-8 space-y-8 max-w-2xl mx-auto">
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-white tracking-tight">Timer Settings</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
        </div>

        <div className="space-y-3 pt-2 border-t border-white/10">
          <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-white/35">Alarm Sound</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {ALARM_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  updateTimerSettings({ alarmSound: option.value });
                  void playAlarm(option.value);
                }}
                className={`settings-option-btn p-3 rounded-xl border text-[10px] uppercase tracking-[0.12em] font-bold transition-all truncate ${
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

        <div className="space-y-3 pt-2 border-t border-white/10">
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-white/35">Focus Sound</div>
            <div className="mt-1 text-xs text-white/45">
              Build an auditory association by selecting a focus sound
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {FOCUS_SOUND_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => updateTimerSettings({ focusSound: option.value })}
                className={`settings-option-btn p-3 rounded-xl border text-[10px] uppercase tracking-[0.12em] font-bold transition-all truncate ${
                  settings.focusSound === option.value
                    ? 'bg-white/20 border-white/30 text-white'
                    : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="rounded-[1rem] border border-white/10 bg-white/5 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-white/35">Volume</div>
              <div className="text-[11px] font-semibold text-white/55">{focusSoundVolumePercent}%</div>
            </div>
            <div className="mt-3">
              <div className="doro-focus-sound-slider-shell">
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

        <div className="space-y-4 pt-2 border-t border-white/10">
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
              className={`doro-category-editor-shell relative overflow-hidden rounded-[1.35rem] border p-4 ${
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
              <div className="relative space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/20 text-white shadow-lg"
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
                      <div className="mt-1 text-[11px] text-white/55">
                        {editingCategoryId !== null
                          ? 'Update the category name, color, or icon.'
                          : 'Add a category for tasks, filters, and account stats.'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {editingCategoryId !== null && (
                      <button
                        type="button"
                        onClick={openNewCategoryForm}
                        className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-white/70 text-[10px] uppercase tracking-[0.14em] font-bold transition-colors"
                      >
                        Create New
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => closeCategoryForm('cancel')}
                      className="px-3 py-1.5 rounded-lg border border-white/10 bg-black/20 hover:bg-black/30 text-white/70 hover:text-white text-[10px] uppercase tracking-[0.14em] font-bold transition-colors"
                    >
                      Close
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
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

                  <div>
                    <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">Color</label>
                    <div className="flex gap-2 flex-wrap">
                      {PRESET_COLORS.map(color => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => {
                            setNewCategoryColor(color);
                            if (categoryFormError) setCategoryFormError(null);
                          }}
                          className={`h-8 w-8 rounded-full border transition-all ${
                            newCategoryColor === color
                              ? 'scale-110 border-white/70 ring-2 ring-white/70 shadow-[0_0_0_6px_rgba(255,255,255,0.08)]'
                              : 'border-white/10 opacity-72 hover:opacity-100 hover:-translate-y-[1px]'
                          }`}
                          style={{
                            backgroundColor: color,
                            boxShadow: newCategoryColor === color ? `0 12px 20px -12px ${colorToRgba(color, 0.8)}` : undefined,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-white/35">Icon</label>
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {CATEGORY_ICON_OPTIONS.map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setNewCategoryIcon(key);
                          if (categoryFormError) setCategoryFormError(null);
                        }}
                        title={label}
                        aria-label={label}
                        className={`rounded-2xl border p-2.5 text-white transition-all ${
                          newCategoryIcon === key
                            ? 'border-white/32 bg-white/18 shadow-[0_14px_26px_-20px_rgba(255,255,255,0.42)]'
                            : 'border-white/8 bg-white/[0.04] opacity-65 hover:bg-white/[0.1] hover:opacity-100 hover:-translate-y-[1px]'
                        }`}
                      >
                        <div className="flex flex-col items-center justify-center gap-1.5">
                          {getIcon(key, { size: 16 })}
                          <span className="text-[9px] font-semibold tracking-[0.08em] uppercase leading-none text-white/70">
                            {label}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {categoryFormError && (
                  <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    {categoryFormError}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
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
            {safeCategories.length === 0 && (
              <div className="text-center text-white/35 text-xs italic py-4">No categories created.</div>
            )}
            {safeCategories.map(category => (
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
                    className="px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-[10px] uppercase tracking-[0.14em] font-bold transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    data-category-action="true"
                    onClick={() => handleDeleteCategory(category.id)}
                    className="text-white/30 hover:text-red-400 p-1 transition-colors"
                    aria-label={`Delete ${category.name}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
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

        <div className="pt-4 border-t border-white/10">
          <div className="bg-red-500/7 border border-red-500/20 rounded-xl p-4 space-y-3">
            <div>
              <div className="text-sm font-bold text-red-200">Danger Zone</div>
              <div className="text-xs text-red-200/55">Resets local app data for this browser profile.</div>
            </div>
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
          animation: doro-account-stat-enter 560ms cubic-bezier(0.22, 1, 0.36, 1) both;
          will-change: transform, opacity;
        }
        .doro-account-stat-rail {
          animation: doro-account-stat-rail 720ms cubic-bezier(0.22, 1, 0.36, 1) both;
          will-change: transform, opacity;
        }
        @media (prefers-reduced-motion: reduce) {
          .doro-account-stat-card,
          .doro-account-stat-rail {
            animation: none !important;
            transition: none !important;
          }
        }
        @keyframes doro-category-editor-open {
          0% {
            opacity: 0;
            transform: translateY(10px) scale(0.972);
            filter: saturate(0.92);
          }
          58% {
            opacity: 1;
            transform: translateY(-1px) scale(1.01);
            filter: saturate(1.04);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: saturate(1);
          }
        }
        .doro-category-editor-open {
          animation: doro-category-editor-open 420ms cubic-bezier(0.16, 0.88, 0.3, 1.08);
          transform-origin: top center;
          will-change: transform, opacity, filter;
        }
        @keyframes doro-category-editor-close-save {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: brightness(1) saturate(1);
          }
          100% {
            opacity: 0;
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
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: brightness(1) saturate(1);
          }
          100% {
            opacity: 0;
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
          transition: width 160ms ease;
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

