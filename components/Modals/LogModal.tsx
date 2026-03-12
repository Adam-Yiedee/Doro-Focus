import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useTimer } from '../../context/TimerContext';
import { AlarmSound, Category, GroupMember, GroupSyncConfig, LogEntry, SessionRecord, TimerSettings, User } from '../../types';
import AccountInsights from './AccountInsights';
import { CATEGORY_ICON_OPTIONS, getCategoryIconLabel, getIcon } from '../../utils/icons';
import { computeAccountInsights } from '../../utils/accountInsights';
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

const formatHourWindow = (hour: number | null) => {
  if (hour === null || !Number.isFinite(hour)) return '--';
  const normalized = ((Math.round(hour) % 24) + 24) % 24;
  const suffix = normalized >= 12 ? 'PM' : 'AM';
  const base = normalized % 12 || 12;
  return `${base} ${suffix}`;
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
const ACCOUNT_SYNC_SCOPE_LABELS = ['Live Timer', 'Tasks', 'History', 'Schedule', 'Categories', 'Settings', 'Profile Name'];
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

const validateAccountPasswordInput = (value: string) => {
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

const getLogBlockHeight = (seconds: number) => {
  const minutes = Math.max(1, seconds / 60);
  return clampInt(64 + minutes * 3.6, 78, 204);
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

const getLogBlockTitle = (entry: LogEntry, categoryName?: string) => {
  const detail = getLogDisplayReason(entry);
  if (typeof entry.task?.name === 'string' && entry.task.name.trim()) return entry.task.name;
  if (categoryName) return categoryName;
  if (detail) return detail;
  if (entry.type === 'break') return 'Reset Window';
  if (entry.type === 'allpause') return 'Pause Window';
  if (isGraceLike(entry)) return 'Grace Window';
  return 'Focus Block';
};

const getLogBlockSubtitle = (entry: LogEntry, categoryName?: string) => {
  const detail = getLogDisplayReason(entry);
  const parts: string[] = [];

  if (categoryName && typeof entry.task?.name === 'string' && categoryName !== entry.task.name) parts.push(categoryName);
  if (detail && detail !== categoryName) parts.push(detail);

  return parts.join(' / ');
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
      className={`settings-option-btn w-full flex items-center justify-between p-3 rounded-xl border transition-all ${
        disabled ? 'opacity-60 cursor-not-allowed' : 'hover:bg-white/10'
      } ${checked ? 'bg-white/14 border-white/25 text-white' : 'bg-white/5 border-white/10 text-white/70'}`}
    >
      <div className="text-left">
        <div className="text-xs font-bold uppercase tracking-[0.14em]">{label}</div>
        {description && <div className="text-[10px] text-white/45 mt-1">{description}</div>}
      </div>
      <div className={`w-12 h-6 rounded-full p-1 transition-colors ${checked ? 'bg-green-500' : 'bg-white/10'}`}>
        <div className={`w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : ''}`} />
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
    deleteCategory,
    user,
    login,
    register,
    logout,
    syncAccountNow,
    refreshAccountFromCloud,
    accountSyncState,
    accountSyncError,
    lastAccountSyncAt,
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
    setPendingJoinId,
    setWeeklyScheduleOpen,
  } = useTimer();

  const [activeTab, setActiveTab] = useState<ModalTab>('log');

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

  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState(PRESET_COLORS[0]);
  const [newCategoryIcon, setNewCategoryIcon] = useState('star');
  const [showResetConfirm, setShowResetConfirm] = useState(false);

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
        entries: sortedEntries,
        totals,
        tracked,
        firstStart: firstEntry?.start || null,
        lastEnd: lastEntry?.end || firstEntry?.end || null,
      };
    });
  }, [orderedLogs]);
  const categoriesById = useMemo(() => new Map(safeCategories.map((category) => [category.id, category])), [safeCategories]);

  const accountError = authLocalError || accountSyncError || null;
  const lastSyncRelative = useMemo(() => formatRelativeTimeFromMs(safeLastAccountSyncAt), [safeLastAccountSyncAt]);

  const syncStateMeta = useMemo(() => {
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
  }, [accountError, accountSyncState, lastSyncRelative, safeLastAccountSyncAt]);

  const normalizedUsernameInput = usernameInput.trim().toLowerCase();
  const usernameValidationMessage = normalizedUsernameInput
    ? validateAccountUsernameInput(normalizedUsernameInput)
    : null;
  const passwordValidationMessage = passwordInput
    ? validateAccountPasswordInput(passwordInput)
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
  const categoryColorsByName = useMemo(
    () => new Map(safeCategories.map((category) => [category.name, category.color])),
    [safeCategories],
  );
  const accountPrimaryColor = useMemo(() => {
    for (const [name] of categoryBreakdown) {
      const categoryColor = categoryColorsByName.get(name);
      if (categoryColor) return categoryColor;
    }
    return PRESET_COLORS[0];
  }, [categoryBreakdown, categoryColorsByName]);
  const syncHealthFacts = useMemo(() => {
    const queueState = accountSyncState === 'syncing'
      ? {
          value: 'In Flight',
          helper: 'The cloud request is active right now.',
          color: '#60A5FA',
        }
      : accountSyncState === 'pending'
        ? {
            value: accountError ? 'Retrying' : 'Queued',
            helper: accountError
              ? 'Unsynced changes are waiting for the next successful attempt.'
              : 'Meaningful local changes are waiting for auto-sync.',
            color: '#F59E0B',
          }
        : accountError
          ? {
              value: 'Blocked',
              helper: 'The last sync failed and needs another attempt.',
              color: '#F87171',
            }
          : {
              value: 'Clean',
              helper: 'No queued account changes at the moment.',
              color: '#34D399',
            };

    return [
      {
        label: 'Local Queue',
        ...queueState,
      },
      {
        label: 'Cloud Check',
        value: safeLastAccountSyncAt !== null ? lastSyncRelative : 'Never',
        helper: safeLastAccountSyncAt !== null
          ? formatTimestampDateTime(safeLastAccountSyncAt, 'Never')
          : 'No successful cloud check yet.',
        color: PRESET_COLORS[5],
      },
      {
        label: 'Stats Source',
        value: 'Live History',
        helper: 'This page rebuilds from the device history in memory first.',
        color: accountPrimaryColor,
      },
      {
        label: 'Sync Mode',
        value: accountError ? 'Manual Retry' : 'Automatic',
        helper: accountError
          ? 'Use Sync Now after the current account issue is resolved.'
          : 'Important account changes push automatically after updates.',
        color: accountError ? '#F87171' : PRESET_COLORS[2],
      },
    ];
  }, [accountError, accountPrimaryColor, accountSyncState, lastSyncRelative, safeLastAccountSyncAt]);
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

  useEffect(() => {
    if (!isOpen) return;
    const normalizedPendingJoinId = getSafeSessionId(pendingJoinId);
    if (normalizedPendingJoinId) {
      inviteAutoJoinKeyRef.current = null;
      setActiveTab('group');
      setGroupFlow('join');
      setGroupSessionInput(normalizedPendingJoinId);
      setInviteSessionId(normalizedPendingJoinId);
      setGroupLocalError(null);
      setPendingJoinId(null);
    }
  }, [isOpen, pendingJoinId, setPendingJoinId]);

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
    if (tab === 'schedule') {
      setWeeklyScheduleOpen(true);
      onClose();
      return;
    }
    setActiveTab(tab);
  };

  const handleAuthSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (authBusy) return;
    const username = normalizedUsernameInput;
    if (!username || !passwordInput) {
      setAuthLocalError('Username and password are required.');
      return;
    }
    const usernameError = validateAccountUsernameInput(username);
    if (usernameError) {
      setAuthLocalError(usernameError);
      return;
    }
    const passwordError = validateAccountPasswordInput(passwordInput);
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
    setAccountMessage(authMode === 'register' ? 'Account created and synced.' : 'Signed in and synced.');
  };

  const handleSyncNow = async () => {
    if (accountActionBusy) return;
    setAccountActionBusy('sync');
    setAccountMessage(null);
    const ok = await syncAccountNow();
    if (ok) setAccountMessage('Cloud sync complete.');
    else if (!accountSyncError) setAccountMessage('Cloud sync did not complete.');
    setAccountActionBusy(null);
  };

  const handleRefreshCloud = async () => {
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

  if (!isOpen) return null;

  const handleCreateCategory = () => {
    const name = newCategoryName.trim();
    if (!name) return;
    addCategory(name, newCategoryColor, newCategoryIcon);
    setNewCategoryName('');
    setNewCategoryColor(PRESET_COLORS[0]);
    setNewCategoryIcon('star');
    setShowAddCategory(false);
  };

  const renderLogTab = () => {
    return (
      <div className="p-4 md:p-8 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white tracking-tight">Activity Log</h3>
          <button
            type="button"
            onClick={clearLogs}
            className="text-[10px] uppercase tracking-widest text-red-300 hover:text-red-200 font-bold border border-red-500/30 px-3 py-1.5 rounded-full hover:bg-red-500/10 transition-colors"
          >
            Clear
          </button>
        </div>

        {orderedLogs.length === 0 && (
          <div className="text-white/35 text-center py-12 text-sm italic">No timed blocks recorded yet.</div>
        )}

        {orderedLogs.length > 0 && (
          <div className="space-y-3">
            {groupedLogDays.map(({ dateKey, entries, totals }) => {
              const dayTracked = totals.work + totals.break + totals.pause + totals.grace;
              const firstStart = entries[0]?.start || null;
              const lastEnd = entries[entries.length - 1]?.end || null;
              return (
                <div key={`log-day-${dateKey}`} className="rounded-2xl border border-white/10 bg-white/[0.05] p-3 md:p-4">
                  <div className="mb-3 flex flex-col md:flex-row md:items-end justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-white/45 font-bold">
                        {formatLogDayLabel(dateKey)}
                      </div>
                      <div className="text-xs text-white/70 font-medium tracking-[0.04em]">
                        {entries.length} blocks{firstStart && lastEnd ? ` Â· ${formatTimeRange(firstStart, lastEnd)}` : ''}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <div className="px-2.5 py-1 rounded-lg border border-white/15 bg-white/[0.07] text-[10px] text-white/75 font-mono">
                        Total {formatDuration(dayTracked)}
                      </div>
                      {totals.work > 0 && (
                        <div className="px-2.5 py-1 rounded-lg border text-[10px] font-mono" style={{
                          borderColor: colorToRgba(PRESET_COLORS[0], 0.34),
                          backgroundColor: colorToRgba(PRESET_COLORS[0], 0.16),
                          color: '#f8fafc',
                        }}>
                          Focus {formatDuration(totals.work)}
                        </div>
                      )}
                      {totals.break > 0 && (
                        <div className="px-2.5 py-1 rounded-lg border text-[10px] font-mono" style={{
                          borderColor: colorToRgba(PRESET_COLORS[1], 0.34),
                          backgroundColor: colorToRgba(PRESET_COLORS[1], 0.16),
                          color: '#f8fafc',
                        }}>
                          Break {formatDuration(totals.break)}
                        </div>
                      )}
                      {totals.pause > 0 && (
                        <div className="px-2.5 py-1 rounded-lg border text-[10px] font-mono" style={{
                          borderColor: colorToRgba('#94a3b8', 0.34),
                          backgroundColor: colorToRgba('#94a3b8', 0.16),
                          color: '#f8fafc',
                        }}>
                          Pause {formatDuration(totals.pause)}
                        </div>
                      )}
                      {totals.grace > 0 && (
                        <div className="px-2.5 py-1 rounded-lg border text-[10px] font-mono" style={{
                          borderColor: colorToRgba(PRESET_COLORS[4], 0.34),
                          backgroundColor: colorToRgba(PRESET_COLORS[4], 0.16),
                          color: '#f8fafc',
                        }}>
                          Grace {formatDuration(totals.grace)}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    {entries.map((entry, index) => {
                      const category = typeof entry.categoryId === 'number' ? categoriesById.get(entry.categoryId) : undefined;
                      const isWork = entry.type === 'work';
                      const isBreak = entry.type === 'break';
                      const isPause = entry.type === 'allpause';
                      const accentColor = category?.color || entry.color || (
                        isWork
                          ? PRESET_COLORS[0]
                          : isBreak
                            ? PRESET_COLORS[1]
                            : isPause
                              ? '#94a3b8'
                              : PRESET_COLORS[4]
                      );
                      const title = getLogBlockTitle(entry, category?.name);
                      const subtitle = getLogBlockSubtitle(entry, category?.name);
                      const cardStyle: React.CSSProperties = {
                        minHeight: `${getLogBlockHeight(entry.duration)}px`,
                        borderColor: colorToRgba(accentColor, isLightTheme ? 0.26 : 0.34),
                        background: isLightTheme
                          ? `linear-gradient(160deg, ${colorToRgba(accentColor, 0.24)} 0%, ${colorToRgba(accentColor, 0.12)} 44%, rgba(255, 255, 255, 0.66) 100%)`
                          : `linear-gradient(160deg, ${colorToRgba(accentColor, 0.28)} 0%, ${colorToRgba(accentColor, 0.14)} 44%, rgba(255, 255, 255, 0.04) 100%)`,
                        boxShadow: `0 14px 30px -22px ${colorToRgba(accentColor, isLightTheme ? 0.26 : 0.58)}`,
                      };
                      const durationStyle: React.CSSProperties = {
                        borderColor: colorToRgba(accentColor, isLightTheme ? 0.24 : 0.3),
                        backgroundColor: colorToRgba(accentColor, isLightTheme ? 0.14 : 0.14),
                        color: isLightTheme ? '#102033' : '#f8fafc',
                      };

                      return (
                        <div
                          key={`log-row-${dateKey}-${entry.start}-${entry.type}-${index}`}
                          className="relative pl-[4.5rem] md:pl-[5.5rem]"
                        >
                          <div
                            className="absolute left-0 top-0 bottom-0 w-[4rem] md:w-[5rem] flex flex-col justify-between py-3 pr-3"
                          >
                            <div className="text-right text-[11px] font-mono font-bold text-white/90">
                              {formatClockTime(entry.start)}
                            </div>
                            <div className="text-right text-[11px] font-mono text-white/45">
                              {formatClockTime(entry.end)}
                            </div>
                          </div>

                          <div className="absolute left-[3.95rem] md:left-[4.95rem] top-4 bottom-4 w-px bg-white/10" />

                          <div className="relative ml-2 overflow-hidden rounded-2xl border" style={cardStyle}>
                            <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ backgroundColor: accentColor }} />
                            <div className="absolute inset-0 opacity-60 bg-[linear-gradient(158deg,rgba(255,255,255,0.22),transparent_40%,rgba(255,255,255,0)_72%)]" />
                            <div className="relative h-full p-3 md:p-3.5 flex flex-col justify-between gap-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  {subtitle && (
                                    <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-white/55">
                                      {subtitle}
                                    </div>
                                  )}
                                  <div className={`${subtitle ? 'mt-2' : ''} text-sm md:text-[15px] font-bold text-white tracking-tight truncate`}>
                                    {title}
                                  </div>
                                </div>
                                <div className="shrink-0 rounded-xl border px-2.5 py-1.5 text-[11px] font-mono font-bold" style={durationStyle}>
                                  {formatDuration(entry.duration)}
                                </div>
                              </div>

                              <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.12em] font-bold text-white/45">
                                <div>Start {formatClockTime(entry.start)}</div>
                                <div>Finish {formatClockTime(entry.end)}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
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
    const displayName = safeUserName.trim();
    const hasCustomDisplayName = Boolean(displayName && displayName !== safeUser.username);
    const lastActiveLabel = formatDateKeyLabel(stats.lastActiveDate);
    const accountMeta = [
      { label: 'Joined', value: joinedAt },
      { label: 'Last Active', value: lastActiveLabel },
    ];
    const syncScopeLabel = `${ACCOUNT_SYNC_SCOPE_LABELS.length} synced areas`;
    const syncScopeSummary = 'Live timer, tasks, history, schedule, categories, settings, and profile name.';
    const statCards = [
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
    const todayStatCards = [
      { label: 'Focus Today', value: insights.today.focusMinutes > 0 ? formatCompactMinutes(insights.today.focusMinutes) : '0m', color: accountPrimaryColor },
      { label: 'Pomodoros', value: `${insights.today.pomodoros}`, color: PRESET_COLORS[2] },
      { label: 'Sessions', value: `${insights.today.sessions}`, color: PRESET_COLORS[1] },
      { label: 'Peak Window', value: formatHourWindow(insights.today.peakHour), color: PRESET_COLORS[3] },
    ];
    const todayMeta = insights.today.firstStartMinutes !== null
      ? `First start ${formatClockMinutes(insights.today.firstStartMinutes)}`
      : null;

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
          style={{
            borderColor: isLightTheme ? 'rgba(148, 163, 184, 0.18)' : 'rgba(255, 255, 255, 0.08)',
            background: isLightTheme
              ? `linear-gradient(160deg, rgba(255,255,255,0.95) 0%, ${colorToRgba(accountPrimaryColor, 0.09)} 100%)`
              : `linear-gradient(160deg, rgba(255,255,255,0.05) 0%, ${colorToRgba(accountPrimaryColor, 0.08)} 100%)`,
            boxShadow: `0 28px 56px -42px ${colorToRgba(accountPrimaryColor, isLightTheme ? 0.24 : 0.64)}`,
          }}
        >
          <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: `radial-gradient(circle at 14% -10%, ${colorToRgba(accountPrimaryColor, 0.2)} 0%, transparent 34%), radial-gradient(circle at 88% 12%, ${colorToRgba(PRESET_COLORS[2], 0.08)} 0%, transparent 24%)` }} />
          <div className="relative space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">Today</div>
                <div className="mt-1 text-lg font-bold tracking-tight text-white">Current snapshot</div>
              </div>
              {todayMeta && (
                <div className="rounded-full border border-white/12 bg-white/6 px-3 py-1.5 text-[11px] font-bold text-white/70">
                  {todayMeta}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {todayStatCards.map((card) => (
                <div
                  key={card.label}
                  className="relative overflow-hidden rounded-[1.35rem] border border-white/10 px-4 py-4"
                  style={{
                    background: isLightTheme
                      ? `linear-gradient(165deg, rgba(255,255,255,0.94) 0%, ${colorToRgba(card.color, 0.12)} 100%)`
                      : `linear-gradient(165deg, rgba(255,255,255,0.06) 0%, ${colorToRgba(card.color, 0.1)} 100%)`,
                    boxShadow: `0 20px 40px -32px ${colorToRgba(card.color, isLightTheme ? 0.22 : 0.6)}`,
                  }}
                >
                  <div className="absolute inset-0 opacity-60" style={{ background: `radial-gradient(circle at 88% 10%, ${colorToRgba(card.color, 0.16)}, transparent 26%)` }} />
                  <div className="relative">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: card.color }} />
                      {card.label}
                    </div>
                    <div className="mt-3 text-[1.8rem] font-mono font-bold tracking-tight text-white">{card.value}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3 px-1">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">All Time</div>
              <div className="mt-1 text-lg font-bold tracking-tight text-white">Lifetime totals</div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {statCards.map((card) => (
              <div
                key={card.label}
                className="relative overflow-hidden rounded-[1.45rem] border border-white/10 p-4"
                style={{
                  background: isLightTheme
                    ? `linear-gradient(160deg, rgba(255,255,255,0.94) 0%, ${colorToRgba(card.color, 0.12)} 100%)`
                    : `linear-gradient(160deg, rgba(255,255,255,0.06) 0%, ${colorToRgba(card.color, 0.1)} 100%)`,
                  boxShadow: `0 20px 40px -32px ${colorToRgba(card.color, isLightTheme ? 0.24 : 0.6)}`,
                }}
              >
                <div className="absolute inset-0 opacity-60" style={{ background: `radial-gradient(circle at 88% 12%, ${colorToRgba(card.color, 0.18)}, transparent 26%)` }} />
                <div className="relative">
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: card.color }} />
                    {card.label}
                  </div>
                  <div className="mt-3 text-[1.8rem] font-mono font-bold tracking-tight text-white">{card.value}</div>
                  <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: '100%',
                        background: `linear-gradient(90deg, ${colorToRgba(card.color, 0.98)}, ${colorToRgba(card.color, 0.58)})`,
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
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

        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3 px-1">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">Account & Sync</div>
              <div className="mt-1 text-lg font-bold tracking-tight text-white">{safeUser.username}</div>
            </div>
            <div className={`rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${syncStateMeta.className}`}>
              {syncStateMeta.label}
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[0.92fr_1.08fr]">
            <div className="rounded-[1.6rem] border border-white/10 bg-white/5 p-5">
              <div className="flex items-start gap-3">
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1rem] border border-white/16 text-lg font-bold text-white"
                  style={{
                    background: `linear-gradient(145deg, ${colorToRgba(accountPrimaryColor, 0.92)}, ${colorToRgba(accountPrimaryColor, 0.62)})`,
                  }}
                >
                  {safeUser.username.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">Account</div>
                  <div className="mt-1 text-xl font-bold text-white">{safeUser.username}</div>
                  {hasCustomDisplayName && (
                    <div className="mt-1 text-[11px] text-white/55">Group name: {displayName}</div>
                  )}
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {accountMeta.map((item) => (
                  <div key={item.label} className="rounded-[1rem] border border-white/10 bg-black/10 px-3 py-2.5">
                    <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-white/42">{item.label}</div>
                    <div className="mt-1 text-[12px] font-medium leading-snug text-white/78">{item.value}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-[1.2rem] border border-white/10 bg-black/10 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-white/42">Sync Scope</div>
                  <div className="rounded-full border border-white/12 bg-white/8 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-white/70">
                    {syncScopeLabel}
                  </div>
                </div>
                <div className="mt-2 text-sm leading-relaxed text-white/58">{syncScopeSummary}</div>
              </div>

              <button
                type="button"
                onClick={logout}
                className="mt-5 w-full rounded-2xl border border-red-500/28 bg-red-500/12 py-3 text-xs font-bold uppercase tracking-[0.16em] text-red-200 transition-colors hover:bg-red-500/20"
              >
                Sign Out
              </button>
            </div>

            <div
              className="rounded-[1.6rem] border border-white/12 bg-black/10 p-5"
              style={{
                boxShadow: `0 24px 44px -34px ${colorToRgba(syncStateMeta.accent, isLightTheme ? 0.28 : 0.7)}`,
              }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/50">Sync</div>
                  <div className="mt-2 flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${accountSyncState === 'syncing' ? 'animate-pulse' : ''}`}
                      style={{
                        backgroundColor: syncStateMeta.accent,
                        boxShadow: `0 0 0 5px ${colorToRgba(syncStateMeta.accent, 0.16)}`,
                      }}
                    />
                    <div className="text-lg font-bold text-white">{syncStateMeta.label}</div>
                  </div>
                  <div className="mt-2 text-sm leading-relaxed text-white/60">{syncStateMeta.detail}</div>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {syncHealthFacts.map((fact) => (
                  <div key={fact.label} className="flex items-center justify-between gap-3 rounded-[1rem] border border-white/10 bg-white/6 px-3 py-2.5">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/42">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: fact.color }} />
                      {fact.label}
                    </div>
                    <div className="text-sm font-bold text-white">{fact.value}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={accountActionBusy !== null}
                  onClick={handleSyncNow}
                  className="rounded-xl border border-blue-400/30 bg-blue-500/15 px-3 py-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-blue-100 transition-colors hover:bg-blue-500/24 disabled:opacity-55"
                >
                  {accountActionBusy === 'sync' ? 'Syncing...' : 'Sync Now'}
                </button>
                <button
                  type="button"
                  disabled={accountActionBusy !== null}
                  onClick={handleRefreshCloud}
                  className="rounded-xl border border-white/15 bg-white/8 px-3 py-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white transition-colors hover:bg-white/14 disabled:opacity-55"
                >
                  {accountActionBusy === 'refresh' ? 'Pulling...' : 'Pull Cloud'}
                </button>
              </div>

              <div className="mt-3 text-[11px] leading-relaxed text-white/50">
                Local history first. Last cloud check: {formatTimestampDateTime(safeLastAccountSyncAt, 'Never')}.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderAccountSignedOut = () => {
    const usernamePreview = normalizedUsernameInput || 'focus.sync';
    const heroAccent = authMode === 'register' ? PRESET_COLORS[2] : PRESET_COLORS[1];
    const authHeroStyle: React.CSSProperties = {
      background: isLightTheme
        ? `linear-gradient(152deg, ${colorToRgba(heroAccent, 0.24)} 0%, rgba(255, 255, 255, 0.86) 56%, rgba(247, 250, 255, 0.66) 100%)`
        : `linear-gradient(152deg, ${colorToRgba(heroAccent, 0.28)} 0%, rgba(11, 15, 24, 0.92) 56%, rgba(255, 255, 255, 0.05) 100%)`,
      boxShadow: `0 32px 64px -44px ${colorToRgba(heroAccent, isLightTheme ? 0.3 : 0.68)}`,
    };
    const authBenefits = [
      'Carry your live timer state, pauses, and current mode across devices.',
      'Keep tasks, schedule, categories, and settings aligned with your account.',
      'Restore full history and server-recomputed lifetime stats when you sign in.',
    ];

    return (
      <div className="p-4 md:p-8 min-h-[520px]">
        <div className="grid gap-4 md:grid-cols-[1.04fr_0.96fr]">
          <div className="relative overflow-hidden rounded-[1.9rem] border border-white/10 p-5 md:p-6" style={authHeroStyle}>
            <div className="absolute inset-0 opacity-75 bg-[radial-gradient(circle_at_18%_-10%,rgba(255,255,255,0.34),transparent_34%),radial-gradient(circle_at_92%_8%,rgba(255,255,255,0.16),transparent_24%)]" />
            <div className="relative flex h-full flex-col justify-between gap-6">
              <div>
                <div className="inline-flex rounded-full border border-white/15 bg-black/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white/60">
                  Account Sync
                </div>
                <h3 className="mt-4 text-3xl font-bold tracking-tight text-white">
                  {authMode === 'register' ? 'Create your cloud account' : 'Sign back in'}
                </h3>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-white/60">
                  Keep your timer, schedule, categories, and history tied to one account so a new browser or device picks up where you left off.
                </p>
              </div>

              <div className="space-y-3">
                {authBenefits.map((benefit, index) => (
                  <div key={benefit} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
                    <span
                      className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: PRESET_COLORS[index % PRESET_COLORS.length] }}
                    />
                    <div className="text-sm leading-relaxed text-white/70">{benefit}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-[1.4rem] border border-white/12 bg-black/10 p-4">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/50">Username Preview</div>
                <div className="mt-2 text-xl font-mono font-bold tracking-tight text-white">{usernamePreview}</div>
                <div className="mt-2 text-xs leading-relaxed text-white/55">
                  Usernames are stored in lowercase and must use 3-32 letters, numbers, periods, underscores, or hyphens.
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-center rounded-[1.9rem] border border-white/10 bg-white/5 p-5 md:p-6">
            <div className="mb-6">
              <div className="inline-flex rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white/55">
                {authMode === 'register' ? 'Register' : 'Login'}
              </div>
              <div className="mt-4 text-2xl font-bold tracking-tight text-white">
                {authMode === 'register' ? 'Start syncing this device' : 'Reconnect this device'}
              </div>
              <div className="mt-2 text-sm leading-relaxed text-white/55">
                {authMode === 'register'
                  ? 'New accounts are seeded from your current browser data and synced immediately.'
                  : 'Sign in to merge this device with your saved cloud account.'}
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
                  placeholder="focus.sync"
                  aria-invalid={Boolean(usernameValidationMessage)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-white outline-none transition-all placeholder-white/25 focus:border-white/30"
                  disabled={authBusy}
                />
                <div className="mt-2 min-h-[1.25rem] text-[11px] leading-relaxed text-white/50">
                  {usernameValidationMessage
                    ? usernameValidationMessage
                    : usernameInput.trim() && normalizedUsernameInput !== usernameInput.trim()
                      ? `Will be saved as ${normalizedUsernameInput}.`
                      : 'Lowercase username used for sign-in across devices.'}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">Password</label>
                <input
                  type="password"
                  autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                  minLength={ACCOUNT_PASSWORD_MIN_LENGTH}
                  maxLength={ACCOUNT_PASSWORD_MAX_LENGTH}
                  value={passwordInput}
                  onChange={event => setPasswordInput(event.target.value)}
                  placeholder="At least 8 characters"
                  aria-invalid={Boolean(passwordValidationMessage)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-white outline-none transition-all placeholder-white/25 focus:border-white/30"
                  disabled={authBusy}
                />
                <div className="mt-2 min-h-[1.25rem] text-[11px] leading-relaxed text-white/50">
                  {passwordValidationMessage || `Use ${ACCOUNT_PASSWORD_MIN_LENGTH}-${ACCOUNT_PASSWORD_MAX_LENGTH} characters.`}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">
                <div className="rounded-full border border-white/10 bg-black/10 px-3 py-1.5">3-32 char username</div>
                <div className="rounded-full border border-white/10 bg-black/10 px-3 py-1.5">8+ char password</div>
                <div className="rounded-full border border-white/10 bg-black/10 px-3 py-1.5">Syncs current device</div>
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

            <div className="mt-5 text-xs leading-relaxed text-white/45">
              Account sync includes your live timer, schedule, categories, settings, and saved history.
            </div>

            <button
              type="button"
              onClick={() => {
                setAuthMode(prev => (prev === 'register' ? 'login' : 'register'));
                setAuthLocalError(null);
                setAccountMessage(null);
              }}
              disabled={authBusy}
              className="mt-5 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-bold uppercase tracking-[0.16em] text-white/65 transition-colors hover:bg-white/10 hover:text-white"
            >
              {authMode === 'register' ? 'Already have an account? Sign In' : 'New here? Create Account'}
            </button>
          </div>
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
          <div className="max-w-lg mx-auto space-y-6">
            <div className="text-center space-y-1">
              <h3 className="text-2xl font-bold text-white tracking-tight">Group Study Active</h3>
              <p className="text-blue-300 text-xs uppercase tracking-[0.16em] font-bold">Live Session</p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-white/35 uppercase tracking-[0.16em]">Session ID</label>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={async () => { await copyToClipboard(safeGroupSessionId); }}
                    className="px-3 py-1.5 rounded-full border border-blue-400/20 bg-blue-500/10 text-[10px] text-blue-300 hover:text-blue-200 hover:bg-blue-500/15 font-bold uppercase tracking-[0.14em] transition-colors"
                  >
                    Copy Code
                  </button>
                  <button
                    type="button"
                    onClick={async () => { await copyToClipboard(groupInviteUrl); }}
                    className="px-3 py-1.5 rounded-full border border-blue-400/20 bg-blue-500/10 text-[10px] text-blue-300 hover:text-blue-200 hover:bg-blue-500/15 font-bold uppercase tracking-[0.14em] transition-colors"
                  >
                    Copy Link
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowGroupQr(prev => !prev)}
                    className="px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-[10px] text-white/75 hover:text-white hover:bg-white/10 font-bold uppercase tracking-[0.14em] transition-colors"
                  >
                    {showGroupQr ? 'Hide QR' : 'Show QR'}
                  </button>
                </div>
              </div>

              <div className="text-xl md:text-2xl font-mono font-bold text-white tracking-wide bg-black/35 p-3 rounded-xl text-center border border-white/10">
                {safeGroupSessionId}
              </div>

              {showGroupQr && (
                <div className="space-y-3">
                  <div className="flex justify-center p-4 bg-white rounded-xl">
                    <QRCodeSVG value={groupInviteUrl} size={180} />
                  </div>
                  <div className="text-center text-[11px] text-white/55 leading-relaxed">
                    Scan to open the site and jump into this group invite.
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-white/35 uppercase tracking-[0.16em] mb-2">
                  Members ({safeMembers.length})
                </label>
                <div className="flex flex-wrap gap-2">
                  {safeMembers.map(member => (
                    <div
                      key={member.id}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs ${
                        member.isHost
                          ? 'bg-blue-500/20 border-blue-400/30 text-blue-100'
                          : 'bg-white/5 border-white/10 text-white/85'
                      }`}
                    >
                      <div className={`w-2 h-2 rounded-full ${member.isHost ? 'bg-blue-400' : 'bg-white/45'}`} />
                      <span className="font-bold">{member.name}{member.isHost ? ' (Host)' : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {isHost ? (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-3">
                <div className="text-[10px] font-bold text-white/35 uppercase tracking-[0.16em]">Host Sync Controls</div>
                <ToggleRow label="Sync Timers" checked={hostControls.syncTimers} onToggle={() => toggleLiveHostSync('syncTimers')} />
                <ToggleRow label="Sync Tasks" checked={hostControls.syncTasks} onToggle={() => toggleLiveHostSync('syncTasks')} />
                <ToggleRow label="Sync Schedule" checked={hostControls.syncSchedule} onToggle={() => toggleLiveHostSync('syncSchedule')} />
                <ToggleRow label="Sync History" checked={hostControls.syncHistory} onToggle={() => toggleLiveHostSync('syncHistory')} />
                <ToggleRow label="Sync Settings" checked={hostControls.syncSettings} onToggle={() => toggleLiveHostSync('syncSettings')} />
              </div>
            ) : (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-3">
                <div className="text-[10px] font-bold text-white/35 uppercase tracking-[0.16em]">Accepted Sync Types</div>
                <div className="text-xs text-white/55 leading-relaxed">
                  Turn timer sync off if you want to control your own focus/break timer without affecting the host.
                </div>
                <ToggleRow label="Accept Timer Sync" checked={clientControls.syncTimers} onToggle={() => toggleLiveClientSync('syncTimers')} />
                <ToggleRow label="Accept Task Sync" checked={clientControls.syncTasks} onToggle={() => toggleLiveClientSync('syncTasks')} />
                <ToggleRow label="Accept Schedule Sync" checked={clientControls.syncSchedule} onToggle={() => toggleLiveClientSync('syncSchedule')} />
                <ToggleRow label="Accept History Sync" checked={clientControls.syncHistory} onToggle={() => toggleLiveClientSync('syncHistory')} />
                <ToggleRow label="Accept Settings Sync" checked={clientControls.syncSettings} onToggle={() => toggleLiveClientSync('syncSettings')} />
              </div>
            )}

            {groupError && (
              <div className="p-3 bg-red-500/15 border border-red-500/30 rounded-xl text-red-200 text-xs">
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
              className="w-full py-3 border border-red-500/30 text-red-300 hover:bg-red-500/10 rounded-xl font-bold uppercase text-xs tracking-[0.16em] transition-colors"
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
              Timer sync is enabled by default. Task/history sync stays off unless you enable it.
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
          <ToggleRow
            label="Disable Blur Effects"
            description="Improves performance on older devices"
            checked={settings.disableBlur}
            onToggle={() => updateTimerSettings({ disableBlur: !settings.disableBlur })}
          />
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

        <div className="space-y-4 pt-2 border-t border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-white">Categories</div>
              <div className="text-xs text-white/45">Used for task grouping and stats.</div>
            </div>
            <button
              type="button"
              onClick={() => setShowAddCategory(prev => !prev)}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[10px] uppercase tracking-[0.14em] font-bold transition-colors"
            >
              {showAddCategory ? 'Cancel' : 'New Category'}
            </button>
          </div>

          {showAddCategory && (
            <div className="bg-black/25 border border-white/10 rounded-xl p-4 space-y-4">
              <div>
                <label className="block text-[10px] uppercase tracking-[0.14em] font-bold text-white/35 mb-2">Name</label>
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={event => setNewCategoryName(event.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-white/30"
                  placeholder="e.g. Math"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-[0.14em] font-bold text-white/35 mb-2">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {PRESET_COLORS.map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewCategoryColor(color)}
                      className={`w-6 h-6 rounded-full transition-transform ${
                        newCategoryColor === color ? 'scale-110 ring-2 ring-white' : 'opacity-60 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-[0.14em] font-bold text-white/35 mb-2">Icon</label>
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                  {CATEGORY_ICON_OPTIONS.map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setNewCategoryIcon(key)}
                      title={label}
                      aria-label={label}
                      className={`p-2.5 rounded-xl flex flex-col items-center justify-center gap-1.5 text-white transition-colors border ${
                        newCategoryIcon === key
                          ? 'bg-white/18 border-white/30'
                          : 'bg-white/5 hover:bg-white/10 opacity-60 hover:opacity-100'
                      }`}
                    >
                      {getIcon(key, { size: 16 })}
                      <span className="text-[9px] font-semibold tracking-[0.08em] uppercase leading-none text-white/70">
                        {label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={handleCreateCategory}
                className="w-full py-2 bg-white text-black font-bold text-xs uppercase rounded-lg hover:bg-gray-200 transition-colors"
              >
                Create Category
              </button>
            </div>
          )}

          <div className="space-y-2">
            {safeCategories.length === 0 && (
              <div className="text-center text-white/35 text-xs italic py-4">No categories created.</div>
            )}
            {safeCategories.map(category => (
              <div
                key={category.id}
                className="flex justify-between items-center p-3 bg-white/5 rounded-xl border border-white/10"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white" style={{ backgroundColor: category.color }}>
                    {getIcon(category.icon)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-white font-bold text-sm">{category.name}</div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-white/35">
                      {getCategoryIconLabel(category.icon)}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => deleteCategory(category.id)}
                  className="text-white/30 hover:text-red-400 p-1 transition-colors"
                  aria-label={`Delete ${category.name}`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
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

  return (
    <>
      <style>{`
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
          padding: 0.6rem;
          gap: 0.45rem;
          border-color: rgba(255, 255, 255, 0.26) !important;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.34), rgba(245, 249, 255, 0.14)) !important;
          backdrop-filter: blur(18px) saturate(180%);
          -webkit-backdrop-filter: blur(18px) saturate(180%);
          box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.28);
        }
        .doro-settings-shell.theme-light .settings-tabbar button {
          position: relative;
          border: 1px solid transparent;
          border-radius: 999px;
          background: transparent !important;
          color: #6b7a90 !important;
          text-shadow: 0 1px 0 rgba(255, 255, 255, 0.28);
          transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), background-color 180ms ease, border-color 180ms ease, box-shadow 220ms ease, color 180ms ease;
        }
        .doro-settings-shell.theme-light .settings-tabbar button:hover {
          transform: translateY(-1px);
          color: #102133 !important;
          border-color: rgba(255, 255, 255, 0.34);
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.34), rgba(244, 248, 255, 0.16)) !important;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.64), 0 18px 28px -26px rgba(77, 93, 123, 0.42);
        }
        .doro-settings-shell.theme-light .settings-tabbar button[class*='bg-white/10'] {
          color: #102133 !important;
          border-color: rgba(255, 255, 255, 0.58) !important;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.66), rgba(243, 248, 255, 0.32)) !important;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.84), 0 20px 30px -26px rgba(77, 93, 123, 0.44);
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
        .doro-settings-shell.theme-light [class*='border-white/'] {
          border-color: rgba(15, 23, 42, 0.12) !important;
        }
        .doro-settings-shell.theme-light [class*='text-white'] {
          color: #102133 !important;
        }
        .doro-settings-shell.theme-light [class*='text-white/'] {
          color: #667990 !important;
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
              <div className="flex min-w-full">
                {([
                  { id: 'log', label: 'Log' },
                  { id: 'schedule', label: 'Schedule' },
                  { id: 'group', label: 'Group Study' },
                  { id: 'account', label: 'Account' },
                  { id: 'settings', label: 'Settings' },
                ] as Array<{ id: TabButton; label: string }>).map(tab => {
                  const isActive = tab.id !== 'schedule' && activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => handleTabClick(tab.id)}
                      className={`flex-1 py-4 md:py-5 px-4 font-bold text-[10px] md:text-xs uppercase tracking-[0.2em] transition-colors whitespace-nowrap ${
                        isActive ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              className={`md:hidden w-[4.5rem] shrink-0 flex items-center justify-center border-l ${
                isLightTheme ? 'border-slate-300/60 bg-white/35' : 'border-white/10 bg-white/[0.03]'
              }`}
            >
              <button
                type="button"
                onClick={onClose}
                aria-label="Close menu"
                className={`flex h-11 w-11 items-center justify-center rounded-full border transition-all duration-200 active:scale-[0.96] ${
                  isLightTheme
                    ? 'border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(235,241,248,0.58))] text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_16px_28px_-22px_rgba(15,23,42,0.42)]'
                    : 'border-white/18 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.18),rgba(255,255,255,0.02)_72%),linear-gradient(180deg,rgba(255,255,255,0.08),rgba(0,0,0,0.3))] text-white/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_18px_30px_-24px_rgba(0,0,0,0.9)]'
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="settings-body flex-1 overflow-y-auto custom-scrollbar bg-[#0F0F11]/50 relative">
            {activeTab === 'log' && renderLogTab()}
            {activeTab === 'group' && renderGroupTab()}
            {activeTab === 'account' && renderAccountTab()}
            {activeTab === 'settings' && renderSettingsTab()}
          </div>
        </div>
      </div>
    </>
  );
};

export default LogModal;
