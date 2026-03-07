import React, { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useTimer } from '../../context/TimerContext';
import { AlarmSound, GroupSyncConfig, LogEntry, TimerSettings } from '../../types';
import { CATEGORY_ICON_OPTIONS, getCategoryIconLabel, getIcon } from '../../utils/icons';
import { DEFAULT_GROUP_SYNC_CONFIG as DEFAULT_GROUP_CONFIG } from '../../utils/groupStudy';
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

const formatDuration = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const formatDateTime = (iso: string) => {
  const dt = new Date(iso);
  return dt.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const clampInt = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
};

const isGraceLike = (entry: LogEntry) => {
  return entry.type === 'grace' || Boolean(entry.reason?.startsWith('Grace Period'));
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
  const reason = entry.reason?.trim() || '';
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
  if (entry.task?.name) return entry.task.name;
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

  if (categoryName && entry.task?.name && categoryName !== entry.task.name) parts.push(categoryName);
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

  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState(PRESET_COLORS[0]);
  const [newCategoryIcon, setNewCategoryIcon] = useState('star');
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const isLightTheme = settings.themeMode !== 'dark';
  const orderedLogs = useMemo(() => {
    return [...logs]
      .filter((entry) => entry.type !== 'task-complete')
      .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
  }, [logs]);
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
  const categoriesById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);

  const accountError = authLocalError || accountSyncError || null;

  const syncStateMeta = useMemo(() => {
    if (accountSyncState === 'syncing') return { label: 'Syncing', className: 'text-blue-200 bg-blue-500/15 border-blue-400/30' };
    if (accountSyncState === 'synced') return { label: 'Synced', className: 'text-emerald-200 bg-emerald-500/15 border-emerald-400/30' };
    if (accountSyncState === 'error') return { label: 'Error', className: 'text-red-200 bg-red-500/15 border-red-400/30' };
    return { label: 'Idle', className: 'text-white/70 bg-white/10 border-white/15' };
  }, [accountSyncState]);

  const categoryBreakdown = useMemo(() => {
    const breakdown = user?.lifetimeStats.categoryBreakdown || {};
    return Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  }, [user]);
  const groupInviteUrl = useMemo(() => (
    groupSessionId ? buildGroupInviteUrl(groupSessionId) : ''
  ), [groupSessionId]);

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
    if (pendingJoinId) {
      setActiveTab('group');
      setGroupFlow('join');
      setGroupSessionInput(pendingJoinId);
      setInviteSessionId(pendingJoinId);
      setGroupLocalError(null);
      setPendingJoinId(null);
    }
  }, [isOpen, pendingJoinId, setPendingJoinId]);

  useEffect(() => {
    if (!isOpen) return;
    setGroupName(prev => prev || user?.username || userName || '');
    if (groupSessionId) {
      setHostDraftConfig(hostSyncConfig || DEFAULT_GROUP_CONFIG);
      setJoinDraftConfig(clientSyncConfig || DEFAULT_GROUP_CONFIG);
      return;
    }
    setHostDraftConfig(DEFAULT_GROUP_CONFIG);
    setJoinDraftConfig(DEFAULT_GROUP_CONFIG);
  }, [isOpen, user?.username, userName, groupSessionId, hostSyncConfig, clientSyncConfig]);

  useEffect(() => {
    if (!isOpen) return;
    if (user) {
      setUsernameInput(user.username);
      setPasswordInput('');
      setAuthLocalError(null);
    }
  }, [isOpen, user]);

  if (!isOpen) return null;

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
    const username = usernameInput.trim().toLowerCase();
    if (!username || !passwordInput) {
      setAuthLocalError('Username and password are required.');
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
    setAccountActionBusy(null);
  };

  const handleRefreshCloud = async () => {
    if (accountActionBusy) return;
    setAccountActionBusy('refresh');
    setAccountMessage(null);
    const ok = await refreshAccountFromCloud();
    if (ok) setAccountMessage('Pulled latest cloud data.');
    setAccountActionBusy(null);
  };

  const toggleHostDraftSync = (key: SyncKey) => {
    setHostDraftConfig(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleJoinDraftSync = (key: SyncKey) => {
    setJoinDraftConfig(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleLiveHostSync = (key: SyncKey) => {
    updateHostSyncConfig({ ...hostSyncConfig, [key]: !hostSyncConfig[key] });
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

  const handleJoinGroup = async () => {
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
      setInviteSessionId(sessionId);
      setPendingJoinId(null);
    } catch (error) {
      setGroupLocalError(error instanceof Error ? error.message : 'Failed to join session.');
    } finally {
      setGroupBusy(false);
    }
  };

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
                        {entries.length} blocks{firstStart && lastEnd ? ` · ${formatTimeRange(firstStart, lastEnd)}` : ''}
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
    const stats = user!.lifetimeStats;
    const joinedAt = formatDateTime(user!.joinedAt);
    const activeDays = Math.max(0, Math.floor(stats.activeDays || 0));
    const dailyAvgHours = activeDays > 0 ? stats.totalFocusHours / activeDays : 0;
    const focusHoursLabel = stats.totalFocusHours >= 100
      ? `${Math.round(stats.totalFocusHours)}h`
      : `${stats.totalFocusHours.toFixed(1)}h`;

    return (
      <div className="p-4 md:p-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-blue-500 to-cyan-500 flex items-center justify-center text-2xl font-bold text-white shadow-xl">
              {user!.username.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="text-2xl font-bold text-white tracking-tight">{user!.username}</h3>
              <div className="text-xs text-white/45 uppercase tracking-[0.14em] mt-1">Joined {joinedAt}</div>
            </div>
          </div>
          <div className={`px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-[0.16em] ${syncStateMeta.className}`}>
            Cloud {syncStateMeta.label}
          </div>
        </div>

        <div className="bg-white/5 rounded-2xl p-5 border border-white/10 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-white">Cloud Sync</div>
              <div className="text-xs text-white/50 mt-1">
                Last sync: {lastAccountSyncAt ? formatDateTime(new Date(lastAccountSyncAt).toISOString()) : 'Never'}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={accountActionBusy !== null}
                onClick={handleSyncNow}
                className="px-3 py-2 rounded-lg border border-blue-400/30 bg-blue-500/15 text-blue-100 text-[10px] uppercase tracking-[0.14em] font-bold hover:bg-blue-500/25 disabled:opacity-55 transition-colors"
              >
                {accountActionBusy === 'sync' ? 'Syncing...' : 'Sync Now'}
              </button>
              <button
                type="button"
                disabled={accountActionBusy !== null}
                onClick={handleRefreshCloud}
                className="px-3 py-2 rounded-lg border border-white/15 bg-white/8 text-white text-[10px] uppercase tracking-[0.14em] font-bold hover:bg-white/14 disabled:opacity-55 transition-colors"
              >
                {accountActionBusy === 'refresh' ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>

          {accountError && (
            <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-100 text-xs">
              {accountError}
            </div>
          )}
          {accountMessage && (
            <div className="p-3 rounded-xl bg-emerald-500/12 border border-emerald-500/25 text-emerald-100 text-xs">
              {accountMessage}
            </div>
          )}
          <div className="text-xs text-white/50 leading-relaxed">
            Active timer state, tasks, logs, sessions, categories, and schedule data are stored in your account and sync across signed-in devices.
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="bg-white/5 rounded-xl p-3 border border-white/10 text-center">
            <div className="text-xl font-mono font-bold text-white">{focusHoursLabel}</div>
            <div className="text-[10px] text-white/45 uppercase tracking-[0.12em] mt-1">Focus</div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 border border-white/10 text-center">
            <div className="text-xl font-mono font-bold text-teal-200">{stats.totalPomos}</div>
            <div className="text-[10px] text-white/45 uppercase tracking-[0.12em] mt-1">Pomos</div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 border border-white/10 text-center">
            <div className="text-xl font-mono font-bold text-blue-200">{stats.totalSessions}</div>
            <div className="text-[10px] text-white/45 uppercase tracking-[0.12em] mt-1">Sessions</div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 border border-white/10 text-center">
            <div className="text-xl font-mono font-bold text-orange-200">{stats.currentStreak}</div>
            <div className="text-[10px] text-white/45 uppercase tracking-[0.12em] mt-1">Current Streak</div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 border border-white/10 text-center">
            <div className="text-xl font-mono font-bold text-yellow-200">{stats.bestStreak}</div>
            <div className="text-[10px] text-white/45 uppercase tracking-[0.12em] mt-1">Best Streak</div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 border border-white/10 text-center">
            <div className="text-xl font-mono font-bold text-purple-200">{dailyAvgHours.toFixed(1)}h</div>
            <div className="text-[10px] text-white/45 uppercase tracking-[0.12em] mt-1">Active-Day Avg</div>
            <div className="text-[10px] text-white/35 mt-1">{activeDays} day{activeDays === 1 ? '' : 's'}</div>
          </div>
        </div>

        {categoryBreakdown.length > 0 && (
          <div className="bg-white/5 rounded-2xl p-5 border border-white/10 space-y-3">
            <div className="text-sm font-bold text-white uppercase tracking-[0.14em] opacity-70">Category Focus</div>
            {categoryBreakdown.map(([name, minutes]) => {
              const pct = Math.min(100, Math.round((minutes / Math.max(1, stats.totalFocusHours * 60)) * 100));
              return (
                <div key={name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/85 font-bold">{name}</span>
                    <span className="text-white/55 font-mono">{Math.round(minutes / 60)}h</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full bg-white/55" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={logout}
          className="w-full py-3 bg-red-500/12 border border-red-500/30 text-red-200 rounded-xl font-bold uppercase text-xs tracking-[0.16em] hover:bg-red-500/22 transition-colors"
        >
          Sign Out
        </button>
      </div>
    );
  };

  const renderAccountSignedOut = () => {
    return (
      <div className="p-4 md:p-8 flex flex-col items-center min-h-[520px]">
        <div className="w-full max-w-md space-y-6 my-auto">
          <div className="text-center space-y-2">
            <h3 className="text-3xl font-bold text-white tracking-tight">
              {authMode === 'register' ? 'Create Account' : 'Welcome Back'}
            </h3>
            <p className="text-white/45 text-xs uppercase tracking-[0.14em]">
              Sign in to sync timers, tasks, and history across devices
            </p>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {accountError && (
              <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-xl text-red-200 text-xs text-center font-bold">
                {accountError}
              </div>
            )}
            {accountMessage && (
              <div className="p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-emerald-100 text-xs text-center font-bold">
                {accountMessage}
              </div>
            )}

            <div>
              <label className="block text-[10px] font-bold text-white/35 uppercase tracking-[0.14em] mb-2">Username</label>
              <input
                type="text"
                autoFocus
                value={usernameInput}
                onChange={event => setUsernameInput(event.target.value)}
                placeholder="Enter username"
                className="w-full p-4 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:border-white/30 transition-all placeholder-white/25"
                disabled={authBusy}
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-white/35 uppercase tracking-[0.14em] mb-2">Password</label>
              <input
                type="password"
                value={passwordInput}
                onChange={event => setPasswordInput(event.target.value)}
                placeholder="At least 8 characters"
                className="w-full p-4 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:border-white/30 transition-all placeholder-white/25"
                disabled={authBusy}
              />
            </div>

            <button
              type="submit"
              disabled={authBusy}
              className="w-full py-4 bg-white text-black font-bold uppercase text-xs tracking-[0.16em] rounded-xl hover:bg-gray-200 active:scale-95 transition-all shadow-lg disabled:opacity-60 flex items-center justify-center"
            >
              {authBusy ? (
                <span className="w-4 h-4 rounded-full border-2 border-black border-t-transparent animate-spin" />
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
            className="w-full text-xs text-white/45 hover:text-white transition-colors uppercase tracking-[0.14em] font-bold"
          >
            {authMode === 'register' ? 'Already have an account? Sign In' : 'New here? Create Account'}
          </button>

        </div>
      </div>
    );
  };

  const renderAccountTab = () => {
    return user ? renderAccountLoggedIn() : renderAccountSignedOut();
  };

  const renderGroupTab = () => {
    const groupError = groupLocalError || peerError;
    const hostControls = hostSyncConfig || DEFAULT_GROUP_CONFIG;
    const clientControls = clientSyncConfig || DEFAULT_GROUP_CONFIG;

    if (groupBusy) {
      return (
        <div className="p-4 md:p-8 min-h-[520px] flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-white/20 border-t-white animate-spin" />
          <span className="text-white/55 text-xs uppercase tracking-[0.16em] font-bold">Connecting...</span>
        </div>
      );
    }

    if (groupSessionId) {
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
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={async () => { await copyToClipboard(groupSessionId); }}
                    className="text-[10px] text-blue-300 hover:text-blue-200 font-bold uppercase tracking-[0.14em]"
                  >
                    Copy Code
                  </button>
                  <button
                    type="button"
                    onClick={async () => { await copyToClipboard(groupInviteUrl); }}
                    className="text-[10px] text-blue-300 hover:text-blue-200 font-bold uppercase tracking-[0.14em]"
                  >
                    Copy Link
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowGroupQr(prev => !prev)}
                    className="text-[10px] text-blue-300 hover:text-blue-200 font-bold uppercase tracking-[0.14em]"
                  >
                    {showGroupQr ? 'Hide QR' : 'Show QR'}
                  </button>
                </div>
              </div>

              <div className="text-xl md:text-2xl font-mono font-bold text-white tracking-wide bg-black/35 p-3 rounded-xl text-center border border-white/10">
                {groupSessionId}
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
                  Members ({members.length})
                </label>
                <div className="flex flex-wrap gap-2">
                  {members.map(member => (
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
              <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-2">
                <div className="text-[10px] font-bold text-white/35 uppercase tracking-[0.16em]">Accepted Sync Types</div>
                <div className="text-xs text-white/55">Timers: {clientControls.syncTimers ? 'On' : 'Off'}</div>
                <div className="text-xs text-white/55">Tasks: {clientControls.syncTasks ? 'On' : 'Off'}</div>
                <div className="text-xs text-white/55">Schedule: {clientControls.syncSchedule ? 'On' : 'Off'}</div>
                <div className="text-xs text-white/55">History: {clientControls.syncHistory ? 'On' : 'Off'}</div>
                <div className="text-xs text-white/55">Settings: {clientControls.syncSettings ? 'On' : 'Off'}</div>
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
                  onClick={() => setGroupFlow('menu')}
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
                  onClick={() => setGroupFlow('menu')}
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
                Connect
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderSettingsTab = () => {
    return (
      <div className="p-4 pb-24 md:p-8 space-y-8 max-w-2xl mx-auto">
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
            {categories.length === 0 && (
              <div className="text-center text-white/35 text-xs italic py-4">No categories created.</div>
            )}
            {categories.map(category => (
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
          <div className="settings-tabbar flex border-b border-white/10 overflow-x-auto shrink-0 scrollbar-hide">
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

          <div className="settings-body flex-1 overflow-y-auto custom-scrollbar bg-[#0F0F11]/50 relative">
            {activeTab === 'log' && renderLogTab()}
            {activeTab === 'group' && renderGroupTab()}
            {activeTab === 'account' && renderAccountTab()}
            {activeTab === 'settings' && renderSettingsTab()}
          </div>

          {activeTab === 'settings' && (
            <div className="md:hidden pointer-events-none absolute inset-x-4 bottom-4 z-20 flex justify-center">
              <button
                type="button"
                onClick={onClose}
                aria-label="Close settings"
                className={`pointer-events-auto min-h-12 px-5 py-3 rounded-full border shadow-[0_18px_40px_-22px_rgba(15,23,42,0.78)] text-sm font-bold tracking-[0.08em] transition-all active:scale-[0.98] ${
                  isLightTheme
                    ? 'bg-white/80 text-slate-900 border-white/70 backdrop-blur-2xl'
                    : 'bg-black/55 text-white border-white/15 backdrop-blur-2xl'
                }`}
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default LogModal;
