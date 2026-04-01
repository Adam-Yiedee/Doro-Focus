

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTimer } from '../context/TimerContext';
import TimerDisplay from './TimerDisplay';
import Tasks from './Tasks';
import AllPauseModal, { ResumeModal } from './Modals/AllPauseModal';
import LogModal from './Modals/LogModal';
import GraceModal from './Modals/GraceModal';
import TaskViewModal from './Modals/TaskViewModal';
import WeeklySchedulePanel from './Modals/WeeklySchedulePanel';
import SummaryView from './SummaryView';
import { GroupNotice, Task } from '../types';
import { DEFAULT_BREAK_SURFACE, DEFAULT_WORK_SURFACE, getMutedSurfaceColor } from '../utils/palette';
import { getDailyWelcomeMessage } from '../utils/dailyWelcomeMessages';
import { playCelebrationTrumpet } from '../utils/sound';

type GroupBannerItem = GroupNotice & { exiting: boolean };
type DailyWelcomeBanner = { id: string; message: string; exiting: boolean };
type CelebrationConfettiPiece = {
  id: string;
  left: number;
  topVh: number;
  width: number;
  height: number;
  delayMs: number;
  durationMs: number;
  driftX: number;
  fallY: number;
  riseY: number;
  rotateDeg: number;
  color: string;
  shape: 'tile' | 'streamer' | 'chip' | 'diamond' | 'dot';
  motion: 'burst' | 'rain' | 'spark';
  opacity: number;
  swayX: number;
};
type AllTasksCelebration = {
  id: number;
  pieces: CelebrationConfettiPiece[];
  exiting: boolean;
  taskCount: number;
  note: string;
};
type PausableTimeout = {
  timeout: ReturnType<typeof setTimeout> | null;
  remainingMs: number;
  startedAtMs: number | null;
};
type BannerTimerEntry = {
  exit: PausableTimeout;
  remove: PausableTimeout;
};

const GROUP_BANNER_EXIT_MS = 600;
const GROUP_BANNER_VISIBLE_MS = 8200;
const GROUP_BANNER_TOTAL_MS = GROUP_BANNER_VISIBLE_MS + GROUP_BANNER_EXIT_MS;
const DAILY_WELCOME_VISIBLE_MS = 9600;
const DAILY_WELCOME_TOTAL_MS = DAILY_WELCOME_VISIBLE_MS + GROUP_BANNER_EXIT_MS;
const DAILY_WELCOME_SHOW_DELAY_MS = 1150;
const DAILY_WELCOME_STORAGE_KEY = 'doro_daily_welcome_seen_date';
const ALL_TASKS_CELEBRATION_DISMISS_MS = 360;
const ALL_TASKS_CELEBRATION_COLORS = ['#FDE68A', '#FCA5A5', '#93C5FD', '#A7F3D0', '#C4B5FD', '#F9A8D4', '#FDBA74'];
const ALL_TASKS_CELEBRATION_NOTES = [
  'Every open task on today\'s board is wrapped.',
  'Board cleared. Take a breath and enjoy the win.',
  'You closed the loop on every task in sight.',
  'Everything you queued up for today is complete.',
];

const getDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const flattenTaskTree = (tasks: Task[]): Task[] => {
  const flattened: Task[] = [];
  tasks.forEach((task) => {
    flattened.push(task);
    if (task.subtasks.length > 0) {
      flattened.push(...flattenTaskTree(task.subtasks));
    }
  });
  return flattened;
};

const getActiveBoardTasks = (tasks: Task[], todayKey: string) => (
  tasks.filter((task) => !task.isFuture && (!task.scheduledDate || task.scheduledDate <= todayKey))
);

const getAllTasksCelebrationNote = (seed: number) => (
  ALL_TASKS_CELEBRATION_NOTES[Math.abs(seed) % ALL_TASKS_CELEBRATION_NOTES.length]
);

const buildAllTasksCelebrationPieces = (seed: number): CelebrationConfettiPiece[] => {
  const burstPieces = Array.from({ length: 42 }, (_, index) => {
    const left = 43 + (((index * 4.7) + (seed % 19)) % 14);
    const width = index % 7 === 0 ? 4 : index % 5 === 0 ? 6 : index % 3 === 0 ? 8 : 10;
    const height = index % 7 === 0 ? 28 : index % 5 === 0 ? 20 : index % 3 === 0 ? 12 : 10;
    const delayMs = (index % 8) * 22;
    const durationMs = 2160 + ((index * 73 + seed) % 820);
    const driftX = ((index % 2 === 0 ? 1 : -1) * (96 + ((index * 37 + seed) % 220)));
    const rotateDeg = ((index % 2 === 0 ? 1 : -1) * (260 + ((index * 51 + seed) % 420)));
    const color = ALL_TASKS_CELEBRATION_COLORS[index % ALL_TASKS_CELEBRATION_COLORS.length];
    const shape: CelebrationConfettiPiece['shape'] = index % 8 === 0 ? 'streamer' : index % 5 === 0 ? 'diamond' : index % 3 === 0 ? 'chip' : 'tile';
    return {
      id: `celebration-burst-${seed}-${index}`,
      left,
      topVh: 14 + ((index * 3) % 10),
      width,
      height,
      delayMs,
      durationMs,
      driftX,
      fallY: 82 + ((index * 9) % 20),
      riseY: 20 + ((index * 7) % 28),
      rotateDeg,
      color,
      shape,
      motion: 'burst' as const,
      opacity: 0.94,
      swayX: 12 + ((index * 13 + seed) % 24),
    };
  });

  const rainPieces = Array.from({ length: 60 }, (_, index) => {
    const left = 1 + ((index * 7.1) % 98);
    const width = index % 9 === 0 ? 3 : index % 7 === 0 ? 5 : index % 4 === 0 ? 7 : 9;
    const height = index % 9 === 0 ? 18 : index % 7 === 0 ? 24 : index % 4 === 0 ? 14 : 10;
    const delayMs = 70 + ((index % 14) * 30);
    const durationMs = 3000 + ((index * 89 + seed) % 1480);
    const driftX = ((index % 2 === 0 ? 1 : -1) * (32 + ((index * 31 + seed) % 132)));
    const rotateDeg = ((index % 2 === 0 ? 1 : -1) * (190 + ((index * 41 + seed) % 300)));
    const color = ALL_TASKS_CELEBRATION_COLORS[(index + 2) % ALL_TASKS_CELEBRATION_COLORS.length];
    const shape: CelebrationConfettiPiece['shape'] = index % 10 === 0 ? 'streamer' : index % 6 === 0 ? 'diamond' : index % 3 === 0 ? 'chip' : 'tile';
    return {
      id: `celebration-rain-${seed}-${index}`,
      left,
      topVh: -16 - ((index * 2) % 10),
      width,
      height,
      delayMs,
      durationMs,
      driftX,
      fallY: 112 + ((index * 5) % 14),
      riseY: 0,
      rotateDeg,
      color,
      shape,
      motion: 'rain' as const,
      opacity: 0.8,
      swayX: 16 + ((index * 17 + seed) % 30),
    };
  });

  const sparkPieces = Array.from({ length: 18 }, (_, index) => {
    const left = 46 + (((index * 1.9) + (seed % 7)) % 8);
    const size = index % 4 === 0 ? 6 : 4;
    const color = ALL_TASKS_CELEBRATION_COLORS[(index + 4) % ALL_TASKS_CELEBRATION_COLORS.length];
    const shape: CelebrationConfettiPiece['shape'] = index % 3 === 0 ? 'diamond' : 'dot';
    return {
      id: `celebration-spark-${seed}-${index}`,
      left,
      topVh: 22 + ((index * 1.7) % 8),
      width: size,
      height: size,
      delayMs: 80 + ((index % 6) * 44),
      durationMs: 1320 + ((index * 57 + seed) % 520),
      driftX: ((index % 2 === 0 ? 1 : -1) * (12 + ((index * 19 + seed) % 30))),
      fallY: 38 + ((index * 3) % 14),
      riseY: 10 + ((index * 5) % 16),
      rotateDeg: ((index % 2 === 0 ? 1 : -1) * (140 + ((index * 23 + seed) % 220))),
      color,
      shape,
      motion: 'spark' as const,
      opacity: 0.86,
      swayX: 6 + ((index * 7 + seed) % 12),
    };
  });

  return [...burstPieces, ...rainPieces, ...sparkPieces];
};

const colorToRgba = (value: string | undefined, alpha: number) => {
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  const normalized = (value || '').trim().replace('#', '');
  if (normalized.length === 3) {
    const expanded = normalized.split('').map((char) => `${char}${char}`).join('');
    const r = Number.parseInt(expanded.slice(0, 2), 16);
    const g = Number.parseInt(expanded.slice(2, 4), 16);
    const b = Number.parseInt(expanded.slice(4, 6), 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
    }
  }
  if (normalized.length === 6) {
    const r = Number.parseInt(normalized.slice(0, 2), 16);
    const g = Number.parseInt(normalized.slice(2, 4), 16);
    const b = Number.parseInt(normalized.slice(4, 6), 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
    }
  }
  return `rgba(255, 255, 255, ${safeAlpha})`;
};

const createPausableTimeout = (delayMs: number): PausableTimeout => ({
  timeout: null,
  remainingMs: delayMs,
  startedAtMs: null,
});

const clearPausableTimeout = (timer: PausableTimeout) => {
  if (timer.timeout) {
    clearTimeout(timer.timeout);
    timer.timeout = null;
  }
  timer.startedAtMs = null;
};

const pausePausableTimeout = (timer: PausableTimeout) => {
  if (!timer.timeout || timer.startedAtMs === null) return;
  timer.remainingMs = Math.max(0, timer.remainingMs - (Date.now() - timer.startedAtMs));
  clearTimeout(timer.timeout);
  timer.timeout = null;
  timer.startedAtMs = null;
};

const startPausableTimeout = (timer: PausableTimeout, callback: () => void) => {
  if (timer.remainingMs <= 0) {
    callback();
    return;
  }
  clearPausableTimeout(timer);
  timer.startedAtMs = Date.now();
  timer.timeout = window.setTimeout(() => {
    timer.timeout = null;
    timer.startedAtMs = null;
    timer.remainingMs = 0;
    callback();
  }, timer.remainingMs);
};

const areNotificationTimersActive = () => (
  typeof document === 'undefined'
    ? true
    : document.visibilityState === 'visible' && (typeof document.hasFocus !== 'function' || document.hasFocus())
);

const Layout: React.FC = () => {
  const { activeMode, activeColor, settings, tasks, pendingJoinId, pendingMenuAction, isScheduleOpen, setScheduleOpen, isWeeklyScheduleOpen, setWeeklyScheduleOpen, groupNotice, groupSessionId, guestTimerLockNotice, dismissGuestTimerLockNotice, leaveGroupSession } = useTimer();
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [groupBanners, setGroupBanners] = useState<GroupBannerItem[]>([]);
  const [dailyWelcomeBanner, setDailyWelcomeBanner] = useState<DailyWelcomeBanner | null>(null);
  const [allTasksCelebration, setAllTasksCelebration] = useState<AllTasksCelebration | null>(null);
  const [taskCreationPreviewColor, setTaskCreationPreviewColor] = useState<string | undefined>(undefined);
  const [notificationTimersActive, setNotificationTimersActive] = useState(areNotificationTimersActive);
  const bannerTimersRef = useRef<Record<string, BannerTimerEntry>>({});
  const dailyWelcomeTimersRef = useRef({
    show: createPausableTimeout(DAILY_WELCOME_SHOW_DELAY_MS),
    exit: createPausableTimeout(DAILY_WELCOME_VISIBLE_MS),
    remove: createPausableTimeout(DAILY_WELCOME_TOTAL_MS),
  });
  const dailyWelcomeConfigRef = useRef<{ bannerId: string | null; todayKey: string | null; message: string | null }>({
    bannerId: null,
    todayKey: null,
    message: null,
  });
  const allTasksCelebrationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allTasksCelebrationBackdropPressRef = useRef(false);
  const previousOpenBoardTaskCountRef = useRef<number | null>(null);
  const previousTaskCheckedMapRef = useRef<Map<number, boolean>>(new Map());
  const didInitCelebrationRef = useRef(false);
  const previousGroupSessionIdRef = useRef<string | null>(null);

  const clearBannerTimer = (id: string) => {
    const timers = bannerTimersRef.current[id];
    if (!timers) return;
    clearPausableTimeout(timers.exit);
    clearPausableTimeout(timers.remove);
    delete bannerTimersRef.current[id];
  };

  const clearAllBannerTimers = () => {
    Object.keys(bannerTimersRef.current).forEach(clearBannerTimer);
  };

  const clearDailyWelcomeTimers = () => {
    clearPausableTimeout(dailyWelcomeTimersRef.current.show);
    clearPausableTimeout(dailyWelcomeTimersRef.current.exit);
    clearPausableTimeout(dailyWelcomeTimersRef.current.remove);
  };

  const resetDailyWelcomeTimers = () => {
    clearDailyWelcomeTimers();
    dailyWelcomeTimersRef.current.show.remainingMs = DAILY_WELCOME_SHOW_DELAY_MS;
    dailyWelcomeTimersRef.current.exit.remainingMs = DAILY_WELCOME_VISIBLE_MS;
    dailyWelcomeTimersRef.current.remove.remainingMs = DAILY_WELCOME_TOTAL_MS;
  };

  const pauseAllNotificationTimers = () => {
    Object.values(bannerTimersRef.current).forEach((timers) => {
      pausePausableTimeout(timers.exit);
      pausePausableTimeout(timers.remove);
    });
    pausePausableTimeout(dailyWelcomeTimersRef.current.show);
    pausePausableTimeout(dailyWelcomeTimersRef.current.exit);
    pausePausableTimeout(dailyWelcomeTimersRef.current.remove);
  };

  const scheduleDailyWelcomeLifecycle = () => {
    if (!notificationTimersActive) return;
    const { bannerId, todayKey, message } = dailyWelcomeConfigRef.current;
    if (!bannerId || !todayKey || !message) return;

    if (dailyWelcomeTimersRef.current.show.remainingMs > 0) {
      startPausableTimeout(dailyWelcomeTimersRef.current.show, () => {
        try {
          window.localStorage.setItem(DAILY_WELCOME_STORAGE_KEY, todayKey);
        } catch {
          // Ignore storage failures so the banner can still render.
        }

        setDailyWelcomeBanner({ id: bannerId, message, exiting: false });
        scheduleDailyWelcomeLifecycle();
      });
      return;
    }

    startPausableTimeout(dailyWelcomeTimersRef.current.exit, () => {
      setDailyWelcomeBanner((prev) => (
        prev && prev.id === bannerId ? { ...prev, exiting: true } : prev
      ));
    });

    startPausableTimeout(dailyWelcomeTimersRef.current.remove, () => {
      setDailyWelcomeBanner((prev) => (prev && prev.id === bannerId ? null : prev));
      clearDailyWelcomeTimers();
      dailyWelcomeConfigRef.current = { bannerId: null, todayKey: null, message: null };
    });
  };

  const scheduleBannerTimer = (id: string) => {
    if (!notificationTimersActive) return;
    const timers = bannerTimersRef.current[id];
    if (!timers) return;

    startPausableTimeout(timers.exit, () => {
      setGroupBanners((prev) => prev.map((item) => (item.id === id ? { ...item, exiting: true } : item)));
    });

    startPausableTimeout(timers.remove, () => {
      setGroupBanners((prev) => prev.filter((item) => item.id !== id));
      clearBannerTimer(id);
    });
  };

  const clearAllTasksCelebrationTimer = () => {
    if (!allTasksCelebrationTimeoutRef.current) return;
    clearTimeout(allTasksCelebrationTimeoutRef.current);
    allTasksCelebrationTimeoutRef.current = null;
  };

  const dismissAllTasksCelebration = () => {
    setAllTasksCelebration((current) => {
      if (!current || current.exiting) return current;
      const closingId = current.id;
      clearAllTasksCelebrationTimer();
      allTasksCelebrationTimeoutRef.current = window.setTimeout(() => {
        setAllTasksCelebration((latest) => (latest?.id === closingId ? null : latest));
        allTasksCelebrationTimeoutRef.current = null;
      }, ALL_TASKS_CELEBRATION_DISMISS_MS);
      return { ...current, exiting: true };
    });
  };

  const handleAllTasksCelebrationBackdropPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    allTasksCelebrationBackdropPressRef.current = event.target === event.currentTarget;
  };

  const handleAllTasksCelebrationBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !allTasksCelebrationBackdropPressRef.current) {
      allTasksCelebrationBackdropPressRef.current = false;
      return;
    }
    allTasksCelebrationBackdropPressRef.current = false;
    dismissAllTasksCelebration();
  };

  useEffect(() => {
    if (pendingJoinId) {
        setShowLogModal(true);
    }
  }, [pendingJoinId]);

  useEffect(() => {
    if (pendingMenuAction) {
      setShowLogModal(true);
    }
  }, [pendingMenuAction]);

  useEffect(() => {
    const updateNotificationTimerState = () => {
      setNotificationTimersActive(areNotificationTimersActive());
    };

    updateNotificationTimerState();
    window.addEventListener('focus', updateNotificationTimerState);
    window.addEventListener('blur', updateNotificationTimerState);
    document.addEventListener('visibilitychange', updateNotificationTimerState);

    return () => {
      window.removeEventListener('focus', updateNotificationTimerState);
      window.removeEventListener('blur', updateNotificationTimerState);
      document.removeEventListener('visibilitychange', updateNotificationTimerState);
    };
  }, []);

  useEffect(() => {
    if (notificationTimersActive) {
      Object.keys(bannerTimersRef.current).forEach(scheduleBannerTimer);
      scheduleDailyWelcomeLifecycle();
      return;
    }

    pauseAllNotificationTimers();
  }, [notificationTimersActive]);

  useEffect(() => {
    if (previousGroupSessionIdRef.current !== groupSessionId) {
      clearAllBannerTimers();
      setGroupBanners([]);
      previousGroupSessionIdRef.current = groupSessionId;
    }
  }, [groupSessionId]);

  useEffect(() => {
    if (!groupNotice) return;
    const id = groupNotice.id;
    clearBannerTimer(id);
    setGroupBanners(prev => {
      const next = [...prev.filter(item => item.id !== id), { ...groupNotice, exiting: false }];
      const trimmed = next.slice(-3);
      const visibleBannerIds = new Set(trimmed.map(item => item.id));
      Object.keys(bannerTimersRef.current).forEach(timerId => {
        if (!visibleBannerIds.has(timerId)) {
          clearBannerTimer(timerId);
        }
      });
      return trimmed;
    });

    bannerTimersRef.current[id] = {
      exit: createPausableTimeout(GROUP_BANNER_VISIBLE_MS),
      remove: createPausableTimeout(GROUP_BANNER_TOTAL_MS),
    };
    scheduleBannerTimer(id);
  }, [groupNotice]);

  useEffect(() => {
    return () => {
      clearAllBannerTimers();
      clearDailyWelcomeTimers();
      clearAllTasksCelebrationTimer();
    };
  }, []);

  useEffect(() => {
    const todayKey = getDateKey(new Date());
    try {
      if (window.localStorage.getItem(DAILY_WELCOME_STORAGE_KEY) === todayKey) {
        return undefined;
      }
    } catch {
      // Ignore storage errors and still show the welcome banner for this session.
    }

    const bannerId = `daily-welcome-${todayKey}`;
    const message = getDailyWelcomeMessage(todayKey);
    dailyWelcomeConfigRef.current = { bannerId, todayKey, message };
    resetDailyWelcomeTimers();
    scheduleDailyWelcomeLifecycle();

    return () => {
      clearDailyWelcomeTimers();
      dailyWelcomeConfigRef.current = { bannerId: null, todayKey: null, message: null };
    };
  }, []);

  const todayKey = useMemo(() => getDateKey(new Date()), [tasks]);
  const activeBoardTasks = useMemo(() => getActiveBoardTasks(tasks, todayKey), [tasks, todayKey]);
  const openBoardTaskCount = useMemo(
    () => activeBoardTasks.filter((task) => !task.checked).length,
    [activeBoardTasks]
  );
  const flattenedBoardTasks = useMemo(() => flattenTaskTree(activeBoardTasks), [activeBoardTasks]);

  useEffect(() => {
    const nextCheckedMap = new Map(flattenedBoardTasks.map((task) => [task.id, task.checked]));

    if (!didInitCelebrationRef.current) {
      didInitCelebrationRef.current = true;
      previousOpenBoardTaskCountRef.current = openBoardTaskCount;
      previousTaskCheckedMapRef.current = nextCheckedMap;
      return;
    }

    const previousOpenCount = previousOpenBoardTaskCountRef.current ?? openBoardTaskCount;
    const previousCheckedMap = previousTaskCheckedMapRef.current;
    const taskJustCompleted = flattenedBoardTasks.some((task) => (
      task.checked && previousCheckedMap.get(task.id) === false
    ));

    if (previousOpenCount === 1 && openBoardTaskCount === 0 && taskJustCompleted) {
      const celebrationId = Date.now();
      const celebrationNote = getAllTasksCelebrationNote(celebrationId);
      clearAllTasksCelebrationTimer();
      setAllTasksCelebration({
        id: celebrationId,
        pieces: buildAllTasksCelebrationPieces(celebrationId),
        exiting: false,
        taskCount: activeBoardTasks.length,
        note: celebrationNote,
      });
      void playCelebrationTrumpet();
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('All Tasks Completed!', {
            body: activeBoardTasks.length > 0
              ? `${activeBoardTasks.length} ${activeBoardTasks.length === 1 ? 'task is' : 'tasks are'} wrapped. ${celebrationNote}`
              : celebrationNote,
            tag: 'doro-all-tasks-completed',
            requireInteraction: true,
            renotify: true,
          } as NotificationOptions);
        } catch {
          // no-op
        }
      }
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([120, 40, 160, 40, 220]);
      }
    }

    previousOpenBoardTaskCountRef.current = openBoardTaskCount;
    previousTaskCheckedMapRef.current = nextCheckedMap;
  }, [flattenedBoardTasks, openBoardTaskCount]);

  const isLightTheme = settings.themeMode !== 'dark';
  const effectiveActiveColor = taskCreationPreviewColor || activeColor;
  const surfaceColor = activeMode === 'break'
    ? getMutedSurfaceColor(DEFAULT_BREAK_SURFACE, DEFAULT_BREAK_SURFACE)
    : getMutedSurfaceColor(effectiveActiveColor, DEFAULT_WORK_SURFACE);

  useEffect(() => {
    document.documentElement.style.backgroundColor = surfaceColor;
    document.body.style.background = surfaceColor;
  }, [surfaceColor]);

  const ambientStyles = useMemo(() => {
    return {
      container: {
        backgroundColor: surfaceColor,
        backgroundImage: 'none',
      } as React.CSSProperties,
    };
  }, [surfaceColor]);

  const containerStyle: React.CSSProperties = ambientStyles.container;
  const contentStyle: React.CSSProperties = {
    transform: isWeeklyScheduleOpen
      ? 'translateX(calc(-1 * min(18vw, 260px))) scale(0.99)'
      : 'translateX(0) scale(1)',
  };

  const chromeButtonClass = settings.disableBlur
    ? isLightTheme
      ? 'border-white/40 bg-white/72 text-slate-700 shadow-[0_18px_36px_-28px_rgba(66,88,122,0.55)]'
      : 'border-white/10 bg-black/40 text-white shadow-[0_18px_36px_-28px_rgba(0,0,0,0.75)]'
    : isLightTheme
      ? 'border-white/45 bg-white/32 text-slate-700 backdrop-blur-xl shadow-[0_20px_40px_-28px_rgba(66,88,122,0.55)]'
      : 'border-white/5 bg-white/5 text-white backdrop-blur-md shadow-[0_18px_36px_-28px_rgba(0,0,0,0.72)]';
  const mainSurfaceClass = settings.disableBlur
    ? isLightTheme
      ? 'shadow-[0_34px_80px_-52px_rgba(66,88,122,0.45)]'
      : 'shadow-[0_36px_90px_-58px_rgba(0,0,0,0.72)]'
    : isLightTheme
      ? 'backdrop-blur-[24px] shadow-[0_38px_90px_-58px_rgba(66,88,122,0.45)]'
      : 'backdrop-blur-[26px] shadow-[0_42px_100px_-64px_rgba(0,0,0,0.78)]';
  const mainSurfaceStyle = useMemo<React.CSSProperties>(() => ({
    backgroundColor: colorToRgba(surfaceColor, settings.disableBlur
      ? (isLightTheme ? 0.84 : 0.56)
      : (isLightTheme ? 0.72 : 0.44)),
    backgroundImage: 'none',
  }), [isLightTheme, settings.disableBlur, surfaceColor]);
  const mainSurfaceShellStyle = useMemo<React.CSSProperties>(() => ({
    ...mainSurfaceStyle,
    isolation: 'isolate',
    contain: 'paint',
    transform: 'translateZ(0)',
    backfaceVisibility: 'hidden',
    outline: '1px solid transparent',
    WebkitMaskImage: '-webkit-radial-gradient(white, black)',
    WebkitMaskRepeat: 'no-repeat',
    maskImage: 'linear-gradient(white, white)',
    maskRepeat: 'no-repeat',
  }), [mainSurfaceStyle]);
  const mainSurfaceEdgeStyle = useMemo<React.CSSProperties>(() => ({
    boxShadow: isLightTheme
      ? 'inset 0 0 0 1px rgba(255,255,255,0.34), inset 0 1px 0 rgba(255,255,255,0.5)'
      : 'inset 0 0 0 1px rgba(255,255,255,0.14), inset 0 1px 0 rgba(255,255,255,0.22)',
  }), [isLightTheme]);
  const topIconClass = isLightTheme ? 'text-slate-700' : 'text-white/90';

  return (
    <div 
      className="min-h-screen w-full flex flex-col items-center p-4 relative overflow-x-hidden transition-[background-color,background-image] duration-1000 ease-[cubic-bezier(0.25,1,0.5,1)]"
      style={containerStyle}
    >
      <style>{`
        @keyframes doroGroupBannerIn {
          0% { opacity: 0; transform: translateY(-14px) scale(0.98); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes doroGroupBannerProgress {
          0% { transform: scaleX(1); }
          100% { transform: scaleX(0); }
        }
        .doro-group-banner {
          animation: doroGroupBannerIn 360ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .doro-group-banner-progress {
          transform-origin: left;
          animation: doroGroupBannerProgress ${GROUP_BANNER_TOTAL_MS}ms linear forwards;
        }
        @keyframes doroAllTasksCelebrationIn {
          0% { opacity: 0; transform: scale(0.985); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes doroAllTasksCelebrationBackdrop {
          0% { opacity: 0; transform: scale(0.96); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes doroAllTasksCelebrationCard {
          0% { opacity: 0; transform: translateY(34px) scale(0.86); filter: saturate(0.9) blur(9px); }
          58% { opacity: 1; transform: translateY(-6px) scale(1.035); filter: saturate(1) blur(0); }
          100% { opacity: 1; transform: translateY(0) scale(1); filter: saturate(1) blur(0); }
        }
        @keyframes doroAllTasksCelebrationCardFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        @keyframes doroAllTasksCelebrationGlow {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.72); }
          18% { opacity: 0.9; }
          100% { opacity: 0.16; transform: translate(-50%, -50%) scale(1.08); }
        }
        @keyframes doroAllTasksCelebrationHalo {
          0%, 100% { opacity: 0.34; transform: translate(-50%, -50%) scale(0.94); }
          50% { opacity: 0.58; transform: translate(-50%, -50%) scale(1.03); }
        }
        @keyframes doroAllTasksCelebrationSheen {
          0% { opacity: 0; transform: translateX(-120%) skewX(-18deg); }
          16% { opacity: 0.2; }
          58% { opacity: 0.12; }
          100% { opacity: 0; transform: translateX(180%) skewX(-18deg); }
        }
        @keyframes doroAllTasksConfettiRain {
          0% {
            opacity: 0;
            transform: translate3d(0, -18vh, 0) rotate(0deg) scale(0.82);
          }
          10% {
            opacity: 1;
            transform: translate3d(calc(var(--doro-confetti-sway, 0px) * -0.14), 6vh, 0) rotate(calc(var(--doro-confetti-rotate, 360deg) * 0.08)) scale(0.92);
          }
          28% {
            opacity: 1;
            transform: translate3d(calc(var(--doro-confetti-sway, 0px) * -0.38), 28vh, 0) rotate(calc(var(--doro-confetti-rotate, 360deg) * 0.28)) scale(0.97);
          }
          48% {
            opacity: 1;
            transform: translate3d(calc(var(--doro-confetti-drift, 0px) * 0.28 + var(--doro-confetti-sway, 0px) * -0.08), 52vh, 0) rotate(calc(var(--doro-confetti-rotate, 360deg) * 0.5)) scale(1);
          }
          70% {
            opacity: 0.94;
            transform: translate3d(calc(var(--doro-confetti-drift, 0px) * 0.58 + var(--doro-confetti-sway, 0px) * 0.16), 76vh, 0) rotate(calc(var(--doro-confetti-rotate, 360deg) * 0.72)) scale(1.01);
          }
          86% {
            opacity: 0.7;
            transform: translate3d(calc(var(--doro-confetti-drift, 0px) * 0.86 + var(--doro-confetti-sway, 0px) * 0.08), 96vh, 0) rotate(calc(var(--doro-confetti-rotate, 360deg) * 0.88)) scale(0.99);
          }
          100% {
            opacity: 0;
            transform: translate3d(calc(var(--doro-confetti-drift, 0px) + var(--doro-confetti-sway, 0px) * -0.06), var(--doro-confetti-fall, 112vh), 0) rotate(var(--doro-confetti-rotate, 360deg)) scale(0.97);
          }
        }
        @keyframes doroAllTasksConfettiBurst {
          0% {
            opacity: 0;
            transform: translate3d(0, 0, 0) rotate(0deg) scale(0.46);
          }
          12% {
            opacity: 1;
            transform: translate3d(calc(var(--doro-confetti-drift, 0px) * 0.08), calc(-1 * var(--doro-confetti-rise, 18vh) * 0.22), 0) rotate(calc(var(--doro-confetti-rotate, 360deg) * 0.12)) scale(0.82);
          }
          28% {
            opacity: 1;
            transform: translate3d(calc(var(--doro-confetti-drift, 0px) * 0.3), calc(-1 * var(--doro-confetti-rise, 18vh) * 0.9), 0) rotate(calc(var(--doro-confetti-rotate, 360deg) * 0.34)) scale(1.04);
          }
          50% {
            opacity: 1;
            transform: translate3d(calc(var(--doro-confetti-drift, 0px) * 0.56 + var(--doro-confetti-sway, 0px) * 0.1), calc(var(--doro-confetti-fall, 84vh) * 0.22), 0) rotate(calc(var(--doro-confetti-rotate, 360deg) * 0.56)) scale(1.02);
          }
          74% {
            opacity: 0.9;
            transform: translate3d(calc(var(--doro-confetti-drift, 0px) * 0.82 + var(--doro-confetti-sway, 0px) * 0.16), calc(var(--doro-confetti-fall, 84vh) * 0.58), 0) rotate(calc(var(--doro-confetti-rotate, 360deg) * 0.8)) scale(0.98);
          }
          100% {
            opacity: 0;
            transform: translate3d(calc(var(--doro-confetti-drift, 0px) + var(--doro-confetti-sway, 0px) * -0.08), var(--doro-confetti-fall, 84vh), 0) rotate(var(--doro-confetti-rotate, 360deg)) scale(0.9);
          }
        }
        @keyframes doroAllTasksConfettiSpark {
          0% {
            opacity: 0;
            transform: translate3d(0, 0, 0) scale(0.28) rotate(0deg);
          }
          16% {
            opacity: 1;
            transform: translate3d(calc(var(--doro-confetti-drift, 0px) * 0.12), calc(-1 * var(--doro-confetti-rise, 12vh) * 0.24), 0) scale(0.82) rotate(calc(var(--doro-confetti-rotate, 180deg) * 0.16));
          }
          42% {
            opacity: 1;
            transform: translate3d(calc(var(--doro-confetti-drift, 0px) * 0.34 + var(--doro-confetti-sway, 0px) * 0.12), calc(-1 * var(--doro-confetti-rise, 12vh) * 0.92), 0) scale(1.02) rotate(calc(var(--doro-confetti-rotate, 180deg) * 0.48));
          }
          72% {
            opacity: 0.72;
            transform: translate3d(calc(var(--doro-confetti-drift, 0px) * 0.48 + var(--doro-confetti-sway, 0px) * -0.1), calc(-1 * var(--doro-confetti-rise, 12vh) * 1.12), 0) scale(0.72) rotate(calc(var(--doro-confetti-rotate, 180deg) * 0.78));
          }
          100% {
            opacity: 0;
            transform: translate3d(calc(var(--doro-confetti-drift, 0px) * 0.58), calc(-1 * var(--doro-confetti-rise, 12vh) * 1.28), 0) scale(0.42) rotate(var(--doro-confetti-rotate, 180deg));
          }
        }
        .doro-all-tasks-celebration {
          animation: doroAllTasksCelebrationIn 260ms ease-out both;
          transition: opacity ${ALL_TASKS_CELEBRATION_DISMISS_MS}ms ease, transform ${ALL_TASKS_CELEBRATION_DISMISS_MS}ms ease;
        }
        .doro-all-tasks-celebration-backdrop {
          animation: doroAllTasksCelebrationBackdrop 360ms cubic-bezier(0.16, 0.84, 0.24, 1) both;
          transition: opacity ${ALL_TASKS_CELEBRATION_DISMISS_MS}ms ease;
        }
        .doro-all-tasks-celebration-card {
          animation:
            doroAllTasksCelebrationCard 720ms cubic-bezier(0.22, 1, 0.36, 1) both,
            doroAllTasksCelebrationCardFloat 2800ms ease-in-out 720ms infinite;
          transition: opacity ${ALL_TASKS_CELEBRATION_DISMISS_MS}ms ease, transform ${ALL_TASKS_CELEBRATION_DISMISS_MS}ms ease;
        }
        .doro-all-tasks-celebration-glow {
          animation: doroAllTasksCelebrationGlow 1800ms cubic-bezier(0.16, 0.84, 0.24, 1) both;
          transition: opacity ${ALL_TASKS_CELEBRATION_DISMISS_MS}ms ease;
        }
        .doro-all-tasks-celebration-halo {
          animation:
            doroAllTasksCelebrationGlow 1200ms cubic-bezier(0.16, 0.84, 0.24, 1) both,
            doroAllTasksCelebrationHalo 3600ms ease-in-out 1200ms infinite;
          transition: opacity ${ALL_TASKS_CELEBRATION_DISMISS_MS}ms ease;
        }
        .doro-all-tasks-confetti-piece {
          animation-delay: var(--doro-confetti-delay, 0ms);
          will-change: transform, opacity;
          transition: opacity ${ALL_TASKS_CELEBRATION_DISMISS_MS}ms ease;
          backface-visibility: hidden;
          contain: layout style paint;
          mix-blend-mode: screen;
        }
        .doro-all-tasks-confetti-piece.is-rain {
          animation: doroAllTasksConfettiRain var(--doro-confetti-duration, 2600ms) linear both;
        }
        .doro-all-tasks-confetti-piece.is-burst {
          animation: doroAllTasksConfettiBurst var(--doro-confetti-duration, 2200ms) linear both;
        }
        .doro-all-tasks-confetti-piece.is-spark {
          animation: doroAllTasksConfettiSpark var(--doro-confetti-duration, 1400ms) linear both;
        }
        .doro-all-tasks-celebration-sheen {
          animation: doroAllTasksCelebrationSheen 2400ms cubic-bezier(0.16, 0.84, 0.24, 1) 380ms both;
        }
        .doro-all-tasks-celebration.is-exiting {
          opacity: 0;
          transform: scale(0.992);
        }
        .doro-all-tasks-celebration.is-exiting .doro-all-tasks-celebration-backdrop,
        .doro-all-tasks-celebration.is-exiting .doro-all-tasks-celebration-glow,
        .doro-all-tasks-celebration.is-exiting .doro-all-tasks-celebration-halo,
        .doro-all-tasks-celebration.is-exiting .doro-all-tasks-confetti-piece {
          opacity: 0;
        }
        .doro-all-tasks-celebration.is-exiting .doro-all-tasks-celebration-card {
          opacity: 0;
          transform: translateY(12px) scale(0.96);
        }
        @media (prefers-reduced-motion: reduce) {
          .doro-all-tasks-celebration,
          .doro-all-tasks-celebration-backdrop,
          .doro-all-tasks-celebration-card,
          .doro-all-tasks-celebration-glow,
          .doro-all-tasks-celebration-halo,
          .doro-all-tasks-celebration-sheen,
          .doro-all-tasks-confetti-piece {
            animation: none !important;
          }
        }
      `}</style>

      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[72] w-[min(92vw,34rem)] pointer-events-none flex flex-col gap-2">
        {dailyWelcomeBanner && (
          <div
            key={dailyWelcomeBanner.id}
            className={`doro-group-banner relative overflow-hidden rounded-[1.7rem] border px-4 py-4 shadow-[0_20px_45px_-28px_rgba(15,23,42,0.9)] transition-all duration-500 ${
              settings.disableBlur
                ? 'border-white/18 bg-black/70'
                : 'border-white/22 bg-[linear-gradient(160deg,rgba(255,245,247,0.18),rgba(255,255,255,0.07))] backdrop-blur-2xl'
            } ${
              dailyWelcomeBanner.exiting ? 'opacity-0 -translate-y-2 scale-[0.985]' : 'opacity-100 translate-y-0 scale-100'
            }`}
          >
            <div className="absolute inset-0 opacity-70 bg-[radial-gradient(circle_at_12%_-18%,rgba(255,255,255,0.34),transparent_44%)]" />
            <div className="relative min-w-0 text-center">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">
                Welcome Back
              </div>
              <div className="mt-1.5 text-sm leading-snug text-white/95">
                {dailyWelcomeBanner.message}
              </div>
            </div>
            <div
              className="doro-group-banner-progress absolute bottom-0 left-0 h-[2px] w-full bg-white/40"
              style={{
                animationDuration: `${DAILY_WELCOME_TOTAL_MS}ms`,
                animationPlayState: notificationTimersActive ? 'running' : 'paused',
              }}
            />
          </div>
        )}
        {groupBanners.map((notice, i) => (
          <div
            key={notice.id}
            className={`doro-group-banner relative overflow-hidden rounded-2xl border px-4 py-3 shadow-[0_20px_45px_-28px_rgba(15,23,42,0.9)] transition-all duration-500 ${
              notice.kind === 'join'
                ? 'border-emerald-200/40 bg-emerald-300/12'
                : 'border-white/25 bg-white/10'
            } ${settings.disableBlur ? '' : 'backdrop-blur-2xl'} ${
              notice.exiting ? 'opacity-0 -translate-y-2 scale-[0.985]' : 'opacity-100 translate-y-0 scale-100'
            }`}
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <div className="absolute inset-0 opacity-60 bg-[radial-gradient(circle_at_12%_-12%,rgba(255,255,255,0.34),transparent_50%)]" />
            <div className="relative min-w-0 text-center">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">
                {notice.kind === 'join' ? 'Member Joined' : 'Group Action'}
              </div>
              <div className="mt-1 text-sm leading-snug text-white/95">
                <span className="font-bold">{notice.actorName}</span>{' '}{notice.message}
              </div>
            </div>
            <div
              className={`doro-group-banner-progress absolute bottom-0 left-0 h-[2px] w-full ${
                notice.kind === 'join' ? 'bg-emerald-100/55' : 'bg-white/45'
              }`}
              style={{ animationPlayState: notificationTimersActive ? 'running' : 'paused' }}
            />
          </div>
        ))}
        {guestTimerLockNotice && (
          <div
            key={guestTimerLockNotice.id}
            className={`doro-group-banner pointer-events-auto relative overflow-hidden rounded-[1.65rem] border px-4 py-4 shadow-[0_22px_52px_-30px_rgba(15,23,42,0.9)] ${
              settings.disableBlur
                ? 'border-amber-200/35 bg-black/85'
                : 'border-amber-100/20 bg-[linear-gradient(160deg,rgba(255,245,230,0.14),rgba(255,255,255,0.06))] backdrop-blur-2xl'
            }`}
          >
            <div className="absolute inset-0 opacity-70 bg-[radial-gradient(circle_at_10%_-10%,rgba(251,191,36,0.28),transparent_46%)]" />
            <div className="relative text-center">
              <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-amber-100/70">
                Guest Timer Lock
              </div>
              <div className="mt-1.5 text-sm font-bold text-white/95">
                {guestTimerLockNotice.title}
              </div>
              <div className="mt-1.5 text-sm leading-relaxed text-white/68">
                {guestTimerLockNotice.message}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={dismissGuestTimerLockNotice}
                  className="rounded-full border border-white/12 bg-white/8 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/72 transition-colors hover:bg-white/12 hover:text-white"
                >
                  Stay in Group
                </button>
                <button
                  type="button"
                  onClick={() => {
                    dismissGuestTimerLockNotice();
                    leaveGroupSession();
                  }}
                  className="rounded-full border border-amber-200/20 bg-amber-100 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-950 transition-colors hover:bg-amber-50"
                >
                  Leave Group
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {allTasksCelebration && (
        <div
          className={`doro-all-tasks-celebration pointer-events-auto fixed inset-0 z-[94] overflow-hidden ${allTasksCelebration.exiting ? 'is-exiting' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label="All tasks completed"
          onPointerDown={handleAllTasksCelebrationBackdropPointerDown}
          onClick={handleAllTasksCelebrationBackdropClick}
        >
          <div className="doro-all-tasks-celebration-backdrop pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_16%,rgba(255,255,255,0.2),transparent_22%),radial-gradient(circle_at_50%_120%,rgba(251,191,36,0.08),transparent_28%),linear-gradient(180deg,rgba(15,23,42,0.26),rgba(2,6,23,0.58))]" />
          <div className="doro-all-tasks-celebration-glow pointer-events-none absolute left-1/2 top-[26%] h-[30rem] w-[30rem] rounded-full bg-[radial-gradient(circle,rgba(253,224,71,0.2),rgba(96,165,250,0.14)_44%,transparent_74%)]" />
          <div className="doro-all-tasks-celebration-halo pointer-events-none absolute left-1/2 top-[30%] h-[24rem] w-[24rem] rounded-full border border-white/10" />

          <div className="absolute inset-0 pointer-events-none">
            {allTasksCelebration.pieces.map((piece) => (
              <span
                key={piece.id}
                className={`doro-all-tasks-confetti-piece absolute ${
                  piece.motion === 'burst' ? 'is-burst' : piece.motion === 'spark' ? 'is-spark' : 'is-rain'
                } ${
                  piece.shape === 'streamer'
                    ? 'rounded-full'
                    : piece.shape === 'chip' || piece.shape === 'dot'
                      ? 'rounded-[999px]'
                      : 'rounded-[2px]'
                }`}
                style={{
                  left: `${piece.left}%`,
                  top: `${piece.topVh}vh`,
                  width: `${piece.width}px`,
                  height: `${piece.height}px`,
                  opacity: piece.opacity,
                  background: piece.shape === 'streamer'
                    ? `linear-gradient(180deg, ${colorToRgba('#ffffff', 0.44)}, ${piece.color})`
                    : `linear-gradient(180deg, ${colorToRgba('#ffffff', 0.28)}, ${piece.color})`,
                  boxShadow: piece.shape === 'dot'
                    ? `0 0 0 1px ${colorToRgba('#ffffff', 0.08)}`
                    : `0 0 0 1px ${colorToRgba('#ffffff', 0.1)}, 0 5px 12px -12px ${colorToRgba(piece.color, 0.42)}`,
                  clipPath: piece.shape === 'diamond'
                    ? 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)'
                    : undefined,
                  ['--doro-confetti-drift' as any]: `${piece.driftX}px`,
                  ['--doro-confetti-fall' as any]: `${piece.fallY}vh`,
                  ['--doro-confetti-rise' as any]: `${piece.riseY}vh`,
                  ['--doro-confetti-rotate' as any]: `${piece.rotateDeg}deg`,
                  ['--doro-confetti-duration' as any]: `${piece.durationMs}ms`,
                  ['--doro-confetti-delay' as any]: `${piece.delayMs}ms`,
                  ['--doro-confetti-sway' as any]: `${piece.swayX}px`,
                }}
              />
            ))}
          </div>

          <div className="pointer-events-none absolute inset-0 flex items-start justify-center px-4 pt-[14vh]">
            <div
              className="doro-all-tasks-celebration-card pointer-events-auto relative w-[min(92vw,35rem)] overflow-hidden rounded-[2.15rem] border border-white/16 bg-[rgba(9,13,20,0.78)] px-6 py-6 text-center shadow-[0_38px_110px_-46px_rgba(15,23,42,0.98)] backdrop-blur-2xl md:px-8 md:py-7"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={dismissAllTasksCelebration}
                className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-white/8 text-white/62 transition-colors hover:bg-white/14 hover:text-white"
                aria-label="Close celebration"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_-12%,rgba(255,255,255,0.16),transparent_42%),radial-gradient(circle_at_82%_120%,rgba(96,165,250,0.12),transparent_34%)]" />
              <div className="doro-all-tasks-celebration-sheen pointer-events-none absolute inset-y-0 left-[-18%] w-[28%] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.08),transparent)]" />
              <div className="relative">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.25rem] border border-white/14 bg-white/7 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                  <div className="flex h-11 w-11 items-center justify-center rounded-[1rem] bg-[linear-gradient(180deg,rgba(250,204,21,0.94),rgba(251,191,36,0.78))] text-slate-950 shadow-[0_14px_30px_-18px_rgba(250,204,21,0.88)]">
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m5 12 4.25 4.25L19 6.5" />
                    </svg>
                  </div>
                </div>
                <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/54">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-200" />
                  Board Cleared
                </div>
                <div className="mt-4 text-[clamp(2.2rem,5vw,3.55rem)] font-bold leading-[0.96] tracking-[-0.052em] text-white">
                  All Tasks Completed!
                </div>
                <div className="mt-3 text-[15px] font-medium leading-relaxed text-white/72 md:text-base">
                  {allTasksCelebration.note}
                </div>
                <div className="mt-5 flex items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/46">
                  <span>{allTasksCelebration.taskCount > 0 ? `${allTasksCelebration.taskCount} ${allTasksCelebration.taskCount === 1 ? 'task' : 'tasks'} wrapped` : 'Board wrapped'}</span>
                  <span className="h-1 w-1 rounded-full bg-white/20" />
                  <span>Click anywhere to close</span>
                </div>
                <div className="mt-6 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={dismissAllTasksCelebration}
                    className="rounded-full border border-white/14 bg-white px-5 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-950 transition-colors hover:bg-white/90"
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        className={`w-full flex flex-col items-center transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${isWeeklyScheduleOpen ? 'pointer-events-none' : ''}`}
        style={contentStyle}
      >
        {/* Top Bar */}
        <div className="w-full max-w-4xl flex justify-end items-center z-30 mb-4">
          <div className="flex gap-2">
            <button 
              onClick={() => setShowPauseModal(true)}
              className={`p-2.5 rounded-xl transition-all active:scale-95 hover:shadow-md duration-500 ${chromeButtonClass} opacity-70 hover:opacity-100`}
              title="Pause All"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className={topIconClass}><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            </button>
            <button 
              onClick={() => setShowLogModal(true)}
              className={`p-2.5 rounded-xl transition-all active:scale-95 hover:shadow-md duration-500 ${chromeButtonClass} opacity-70 hover:opacity-100`}
              title="Menu"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className={topIconClass} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="w-full max-w-5xl z-10">
          <div
            className={`relative overflow-hidden rounded-[2rem] md:rounded-[2.6rem] px-4 py-5 md:px-7 md:py-7 ${mainSurfaceClass}`}
            style={mainSurfaceShellStyle}
          >
            <div className="pointer-events-none absolute inset-0" style={{ borderRadius: 'inherit', ...mainSurfaceEdgeStyle }} />
            <div className="relative flex flex-col gap-12">
              {/* Timer Section */}
              <div className="w-full flex justify-center animate-slide-up py-6 md:py-8">
                <TimerDisplay />
              </div>

              {/* Tasks Section */}
              <div className="w-full flex justify-center">
                <Tasks onPreviewSurfaceColorChange={setTaskCreationPreviewColor} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <AllPauseModal isOpen={showPauseModal} onClose={() => setShowPauseModal(false)} />
      <ResumeModal />
      <GraceModal />
      <LogModal isOpen={showLogModal} onClose={() => setShowLogModal(false)} />
      <TaskViewModal isOpen={isScheduleOpen} onClose={() => setScheduleOpen(false)} />
      <WeeklySchedulePanel isOpen={isWeeklyScheduleOpen} onClose={() => setWeeklyScheduleOpen(false)} />
      <SummaryView />
    </div>
  );
};

export default Layout;
