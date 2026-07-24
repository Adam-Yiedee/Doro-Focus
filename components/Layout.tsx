

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Heart } from 'lucide-react';
import { useTimer } from '../context/TimerContext';
import TimerDisplay from './TimerDisplay';
import Tasks from './Tasks';
import AllPauseModal, { ResumeModal } from './Modals/AllPauseModal';
import LogModal from './Modals/LogModal';
import GraceModal from './Modals/GraceModal';
import TaskViewModal from './Modals/TaskViewModal';
import WeeklySchedulePanel from './Modals/WeeklySchedulePanel';
import SummaryView from './SummaryView';
import { Task } from '../types';
import { DEFAULT_BREAK_SURFACE, DEFAULT_WORK_SURFACE, getMutedSurfaceColor } from '../utils/palette';
import { getDailyWelcomeMessage } from '../utils/dailyWelcomeMessages';
import { playCelebrationTrumpet, playEncouragementDing } from '../utils/sound';
import { getFocusFriendInviteUsernameFromCurrentUrl } from '../utils/focusFriendInvite';

type NotificationBannerItem = {
  id: string;
  actorName: string;
  message: string;
  title: string;
  tone: 'join' | 'group' | 'friend' | 'encouragement';
  exiting: boolean;
  exitStyle?: 'fade' | 'pop';
};
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
};
type PausableTimeout = {
  timeout: number | null;
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
const ENCOURAGEMENT_BANNER_VISIBLE_MS = 120_000;
const ENCOURAGEMENT_BANNER_EXIT_MS = 720;
const ENCOURAGEMENT_BANNER_TOTAL_MS = ENCOURAGEMENT_BANNER_VISIBLE_MS + ENCOURAGEMENT_BANNER_EXIT_MS;
const DAILY_WELCOME_VISIBLE_MS = 9600;
const DAILY_WELCOME_EXIT_MS = 680;
const DAILY_WELCOME_TOTAL_MS = DAILY_WELCOME_VISIBLE_MS + DAILY_WELCOME_EXIT_MS;
const DAILY_WELCOME_SHOW_DELAY_MS = 1150;
const DAILY_WELCOME_STORAGE_KEY = 'doro_daily_welcome_seen_date';
const ALL_TASKS_CELEBRATION_DISMISS_MS = 360;
const ALL_TASKS_CELEBRATION_BUFFER_MS = 280;
const ALL_TASKS_CELEBRATION_COLORS = ['#FDE68A', '#FCA5A5', '#93C5FD', '#A7F3D0', '#C4B5FD', '#F9A8D4', '#FDBA74'];

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

const getAllTasksCelebrationLifetime = (pieces: CelebrationConfettiPiece[]) => (
  pieces.reduce((maxDuration, piece) => Math.max(maxDuration, piece.delayMs + piece.durationMs), 0) + ALL_TASKS_CELEBRATION_BUFFER_MS
);

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

const getBannerLifecycle = (tone: NotificationBannerItem['tone']) => (
  tone === 'encouragement'
    ? {
        visibleMs: ENCOURAGEMENT_BANNER_VISIBLE_MS,
        exitMs: ENCOURAGEMENT_BANNER_EXIT_MS,
        totalMs: ENCOURAGEMENT_BANNER_TOTAL_MS,
      }
    : {
        visibleMs: GROUP_BANNER_VISIBLE_MS,
        exitMs: GROUP_BANNER_EXIT_MS,
        totalMs: GROUP_BANNER_TOTAL_MS,
      }
);

const Layout: React.FC = () => {
  const { activeMode, activeColor, settings, tasks, pendingJoinId, pendingMenuAction, isScheduleOpen, setScheduleOpen, isWeeklyScheduleOpen, setWeeklyScheduleOpen, groupNotice, groupSessionId, guestTimerLockNotice, focusFriendNotice, dismissGuestTimerLockNotice, leaveGroupSession } = useTimer();
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [groupBanners, setGroupBanners] = useState<NotificationBannerItem[]>([]);
  const [dailyWelcomeBanner, setDailyWelcomeBanner] = useState<DailyWelcomeBanner | null>(null);
  const [allTasksCelebration, setAllTasksCelebration] = useState<AllTasksCelebration | null>(null);
  const [taskCreationPreviewColor, setTaskCreationPreviewColor] = useState<string | undefined>(undefined);
  const [notificationTimersActive, setNotificationTimersActive] = useState(areNotificationTimersActive);
  const bannerTimersRef = useRef<Record<string, BannerTimerEntry>>({});
  const bannerDismissTimeoutsRef = useRef<Record<string, number>>({});
  const renderedFocusFriendNoticeIdsRef = useRef<Set<string>>(new Set());
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
  const allTasksCelebrationTimeoutRef = useRef<number | null>(null);
  const queuedAllTasksCelebrationIdRef = useRef<number | null>(null);
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

  const clearBannerDismissTimeout = (id: string) => {
    const timeout = bannerDismissTimeoutsRef.current[id];
    if (!timeout) return;
    clearTimeout(timeout);
    delete bannerDismissTimeoutsRef.current[id];
  };

  const clearAllBannerTimers = () => {
    Object.keys(bannerTimersRef.current).forEach(clearBannerTimer);
    Object.keys(bannerDismissTimeoutsRef.current).forEach(clearBannerDismissTimeout);
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

  const dismissDailyWelcomeBanner = () => {
    setDailyWelcomeBanner((current) => {
      if (!current || current.exiting) return current;
      const closingId = current.id;

      clearDailyWelcomeTimers();
      dailyWelcomeTimersRef.current.remove.remainingMs = DAILY_WELCOME_EXIT_MS;
      startPausableTimeout(dailyWelcomeTimersRef.current.remove, () => {
        setDailyWelcomeBanner((latest) => (latest?.id === closingId ? null : latest));
        clearDailyWelcomeTimers();
        dailyWelcomeConfigRef.current = { bannerId: null, todayKey: null, message: null };
      });

      return { ...current, exiting: true };
    });
  };

  const scheduleBannerTimer = (id: string) => {
    if (!notificationTimersActive) return;
    const timers = bannerTimersRef.current[id];
    if (!timers) return;

    startPausableTimeout(timers.exit, () => {
      setGroupBanners((prev) => prev.map((item) => (
        item.id === id ? { ...item, exiting: true, exitStyle: 'fade' } : item
      )));
    });

    startPausableTimeout(timers.remove, () => {
      setGroupBanners((prev) => prev.filter((item) => item.id !== id));
      clearBannerTimer(id);
    });
  };

  const dismissBanner = (id: string, exitStyle: NotificationBannerItem['exitStyle'] = 'pop') => {
    const currentBanner = groupBanners.find((item) => item.id === id);
    const exitMs = getBannerLifecycle(currentBanner?.tone || 'group').exitMs;
    clearBannerTimer(id);
    clearBannerDismissTimeout(id);

    setGroupBanners((prev) => prev.map((item) => (
      item.id === id ? { ...item, exiting: true, exitStyle } : item
    )));

    bannerDismissTimeoutsRef.current[id] = window.setTimeout(() => {
      setGroupBanners((prev) => prev.filter((item) => item.id !== id));
      clearBannerDismissTimeout(id);
    }, exitMs);
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

  const startAllTasksCelebration = (celebrationId: number) => {
    const pieces = buildAllTasksCelebrationPieces(celebrationId);
    queuedAllTasksCelebrationIdRef.current = null;
    clearAllTasksCelebrationTimer();
    setAllTasksCelebration({
      id: celebrationId,
      pieces,
      exiting: false,
    });
    allTasksCelebrationTimeoutRef.current = window.setTimeout(() => {
      dismissAllTasksCelebration();
    }, getAllTasksCelebrationLifetime(pieces));
    void playCelebrationTrumpet();
  };

  const triggerAllTasksCelebration = (celebrationId: number) => {
    if (!notificationTimersActive) {
      queuedAllTasksCelebrationIdRef.current = celebrationId;
      return;
    }
    startAllTasksCelebration(celebrationId);
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
    if (getFocusFriendInviteUsernameFromCurrentUrl()) {
      setShowLogModal(true);
    }
  }, []);

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
      if (queuedAllTasksCelebrationIdRef.current !== null) {
        startAllTasksCelebration(queuedAllTasksCelebrationIdRef.current);
      }
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
    clearBannerDismissTimeout(id);
    const tone = groupNotice.kind === 'join' ? 'join' as const : 'group' as const;
    setGroupBanners(prev => {
      const next = [
        ...prev.filter(item => item.id !== id),
        {
          id,
          actorName: groupNotice.actorName,
          message: groupNotice.message,
          title: groupNotice.kind === 'join' ? 'Member Joined' : 'Group Action',
          tone,
          exiting: false,
        },
      ];
      const trimmed = next.slice(-3);
      const visibleBannerIds = new Set(trimmed.map(item => item.id));
      Object.keys(bannerTimersRef.current).forEach(timerId => {
        if (!visibleBannerIds.has(timerId)) {
          clearBannerTimer(timerId);
        }
      });
      return trimmed;
    });

    const lifecycle = getBannerLifecycle(tone);
    bannerTimersRef.current[id] = {
      exit: createPausableTimeout(lifecycle.visibleMs),
      remove: createPausableTimeout(lifecycle.totalMs),
    };
    scheduleBannerTimer(id);
  }, [groupNotice]);

  useEffect(() => {
    if (!focusFriendNotice) return;
    if (!notificationTimersActive) return;
    const id = focusFriendNotice.id;
    if (renderedFocusFriendNoticeIdsRef.current.has(id)) return;
    renderedFocusFriendNoticeIdsRef.current.add(id);
    const banner = focusFriendNotice.type === 'request'
      ? {
          actorName: focusFriendNotice.request.fromDisplayName || focusFriendNotice.request.fromUsername,
          message: 'sent you a Focus Friend request.',
          title: 'Friend Request',
          tone: 'friend' as const,
        }
      : {
          actorName: focusFriendNotice.action.fromDisplayName || focusFriendNotice.action.fromUsername,
          message: focusFriendNotice.action.message || (
            focusFriendNotice.action.type === 'join-request'
              ? 'wants to join your focus session.'
              : focusFriendNotice.action.type === 'join-invite'
                ? 'sent you a focus session invite.'
                : 'sent encouragement.'
          ),
          title: focusFriendNotice.action.type === 'join-request'
            ? 'Join Request'
            : focusFriendNotice.action.type === 'join-invite'
              ? 'Session Invite'
              : 'Encouragement',
          tone: focusFriendNotice.action.type === 'encouragement' ? 'encouragement' as const : 'friend' as const,
        };
    clearBannerTimer(id);
    clearBannerDismissTimeout(id);
    setGroupBanners(prev => {
      const next = [
        ...prev.filter(item => item.id !== id),
        {
          id,
          actorName: banner.actorName,
          message: banner.message,
          title: banner.title,
          tone: banner.tone,
          exiting: false,
        },
      ];
      const trimmed = next.slice(-3);
      const visibleBannerIds = new Set(trimmed.map(item => item.id));
      Object.keys(bannerTimersRef.current).forEach(timerId => {
        if (!visibleBannerIds.has(timerId)) {
          clearBannerTimer(timerId);
        }
      });
      return trimmed;
    });

    if (banner.tone === 'encouragement') {
      void playEncouragementDing();
    }

    const lifecycle = getBannerLifecycle(banner.tone);
    bannerTimersRef.current[id] = {
      exit: createPausableTimeout(lifecycle.visibleMs),
      remove: createPausableTimeout(lifecycle.totalMs),
    };
    scheduleBannerTimer(id);
  }, [focusFriendNotice, notificationTimersActive]);

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
      triggerAllTasksCelebration(celebrationId);
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
      className="doro-app-shell min-h-screen w-full flex flex-col items-center p-4 relative overflow-x-hidden transition-[background-color,background-image] duration-1000 ease-[cubic-bezier(0.25,1,0.5,1)]"
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
        @keyframes doroDailyWelcomeIn {
          0% {
            opacity: 0;
            transform: translateY(-18px) scale(0.972);
            filter: blur(6px) saturate(0.9);
          }
          64% {
            opacity: 1;
            transform: translateY(2px) scale(1.006);
            filter: blur(0) saturate(1.05);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0) saturate(1);
          }
        }
        @keyframes doroDailyWelcomeOut {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0) saturate(1);
          }
          32% {
            opacity: 1;
            transform: translateY(4px) scale(1.006);
            filter: blur(0) saturate(1.06);
          }
          100% {
            opacity: 0;
            transform: translateY(-24px) scale(0.94);
            filter: blur(8px) saturate(0.82);
          }
        }
        @keyframes doroEncouragementBannerIn {
          0% {
            opacity: 0;
            transform: translateY(-22px) scale(0.965);
            filter: blur(12px) saturate(0.76);
          }
          58% {
            opacity: 1;
            transform: translateY(3px) scale(1.012);
            filter: blur(0) saturate(1.14);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0) saturate(1);
          }
        }
        @keyframes doroEncouragementBannerFade {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0) saturate(1);
          }
          100% {
            opacity: 0;
            transform: translateY(-16px) scale(0.985);
            filter: blur(8px) saturate(0.82);
          }
        }
        @keyframes doroEncouragementBannerPop {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0) saturate(1);
          }
          34% {
            opacity: 1;
            transform: translateY(-2px) scale(1.045);
            filter: blur(0) saturate(1.2) brightness(1.08);
          }
          100% {
            opacity: 0;
            transform: translateY(-18px) scale(0.82);
            filter: blur(10px) saturate(0.72) brightness(1.18);
          }
        }
        @keyframes doroEncouragementHeartBeat {
          0%, 100% {
            transform: scale(1);
          }
          36% {
            transform: scale(1.18);
          }
          62% {
            transform: scale(0.97);
          }
        }
        @keyframes doroEncouragementHeartPop {
          0% {
            opacity: 1;
            transform: scale(1) rotate(0deg);
          }
          46% {
            opacity: 1;
            transform: scale(1.42) rotate(-8deg);
          }
          100% {
            opacity: 0;
            transform: scale(0.42) rotate(15deg);
          }
        }
        @keyframes doroEncouragementSheen {
          0% {
            opacity: 0;
            transform: translateX(-120%) skewX(-16deg);
          }
          18% {
            opacity: 0.32;
          }
          100% {
            opacity: 0;
            transform: translateX(180%) skewX(-16deg);
          }
        }
        .doro-group-banner {
          animation: doroGroupBannerIn 360ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .doro-encouragement-banner {
          animation: doroEncouragementBannerIn 620ms cubic-bezier(0.16, 1, 0.3, 1) both;
          box-shadow:
            0 34px 76px -24px rgba(0, 0, 0, 0.48),
            0 22px 42px -25px rgba(0, 0, 0, 0.5),
            inset 0 1px 0 rgba(255, 255, 255, 0.16),
            inset 0 -24px 46px rgba(0, 0, 0, 0.12);
          will-change: transform, opacity, filter;
        }
        .doro-encouragement-banner-fade {
          pointer-events: none;
          animation: doroEncouragementBannerFade ${ENCOURAGEMENT_BANNER_EXIT_MS}ms cubic-bezier(0.45, 0, 0.2, 1) forwards;
        }
        .doro-encouragement-banner-pop {
          pointer-events: none;
          animation: doroEncouragementBannerPop ${ENCOURAGEMENT_BANNER_EXIT_MS}ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .doro-encouragement-banner::before {
          content: '';
          position: absolute;
          inset: -34% -18%;
          z-index: 0;
          background: linear-gradient(100deg, transparent 0%, rgba(255, 255, 255, 0.26) 46%, transparent 66%);
          animation: doroEncouragementSheen 1250ms cubic-bezier(0.16, 1, 0.3, 1) 120ms both;
        }
        .doro-encouragement-heart {
          animation: doroEncouragementHeartBeat 1050ms ease-in-out 420ms infinite;
          fill: currentColor;
          filter: drop-shadow(0 0 12px rgba(255, 190, 202, 0.62));
          transform-origin: center;
        }
        .doro-encouragement-banner-pop .doro-encouragement-heart {
          animation: doroEncouragementHeartPop ${ENCOURAGEMENT_BANNER_EXIT_MS}ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .doro-encouragement-text-3d {
          text-shadow:
            0 1px 0 rgba(255, 255, 255, 0.18),
            0 -1px 0 rgba(76, 5, 25, 0.62),
            0 10px 22px rgba(76, 5, 25, 0.48),
            0 0 18px rgba(255, 205, 213, 0.16);
        }
        .doro-daily-welcome-banner {
          animation: doroDailyWelcomeIn 520ms cubic-bezier(0.16, 1, 0.3, 1) both;
          will-change: transform, opacity, filter;
        }
        .doro-daily-welcome-banner-exit {
          pointer-events: none;
          animation: doroDailyWelcomeOut ${DAILY_WELCOME_EXIT_MS}ms cubic-bezier(0.45, 0, 0.2, 1) forwards;
        }
        .doro-daily-welcome-banner-exit .doro-group-banner-progress {
          opacity: 0;
          transition: opacity 220ms ease-out;
        }
        .doro-group-banner-progress {
          transform-origin: left;
          animation: doroGroupBannerProgress var(--doro-banner-progress-ms, ${GROUP_BANNER_TOTAL_MS}ms) linear forwards;
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
        @media (max-width: 767px) {
          .doro-app-shell {
            min-height: 100dvh;
            padding: max(0.75rem, env(safe-area-inset-top)) 0.75rem max(0.9rem, env(safe-area-inset-bottom));
          }
          .doro-notification-stack {
            top: max(0.5rem, env(safe-area-inset-top));
            width: calc(100vw - 1rem);
            gap: 0.45rem;
          }
          .doro-daily-welcome-banner,
          .doro-encouragement-banner,
          .doro-group-banner {
            border-radius: 1.15rem !important;
            padding: 0.75rem 0.875rem !important;
          }
          .doro-mobile-topbar {
            margin-bottom: 0.55rem;
            padding-inline: 0.25rem;
          }
          .doro-mobile-topbar button {
            min-width: 2.75rem;
            min-height: 2.75rem;
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
          .doro-main-surface {
            border-radius: 1.6rem !important;
            padding: 0.875rem 0.75rem 1rem !important;
          }
          .doro-main-surface-inner {
            gap: 2rem !important;
          }
          .doro-timer-section {
            padding-top: 1rem !important;
            padding-bottom: 0.75rem !important;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .doro-all-tasks-celebration,
          .doro-all-tasks-celebration-backdrop,
          .doro-all-tasks-celebration-card,
          .doro-all-tasks-celebration-glow,
          .doro-all-tasks-celebration-halo,
          .doro-all-tasks-celebration-sheen,
          .doro-all-tasks-confetti-piece,
          .doro-encouragement-banner,
          .doro-encouragement-banner::before,
          .doro-encouragement-heart,
          .doro-daily-welcome-banner,
          .doro-daily-welcome-banner-exit {
            animation: none !important;
          }
          .doro-encouragement-banner-fade,
          .doro-encouragement-banner-pop {
            opacity: 0 !important;
            transform: translateY(-8px) scale(0.98) !important;
            filter: none !important;
          }
          .doro-daily-welcome-banner-exit {
            opacity: 0 !important;
            transform: translateY(-8px) scale(0.98) !important;
            filter: none !important;
          }
        }
      `}</style>

      <div className="doro-notification-stack fixed top-4 left-1/2 -translate-x-1/2 z-[72] w-[min(92vw,34rem)] pointer-events-none flex flex-col gap-2">
        {dailyWelcomeBanner && (
          <button
            type="button"
            key={dailyWelcomeBanner.id}
            onClick={dismissDailyWelcomeBanner}
            aria-label="Dismiss welcome message"
            className={`doro-daily-welcome-banner pointer-events-auto relative w-full overflow-hidden rounded-[1.7rem] border px-4 py-4 text-left shadow-[0_20px_45px_-28px_rgba(15,23,42,0.9)] transition-[border-color,box-shadow] duration-300 hover:border-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/45 ${
              settings.disableBlur
                ? 'border-white/18 bg-black/70'
                : 'border-white/22 bg-[linear-gradient(160deg,rgba(255,245,247,0.18),rgba(255,255,255,0.07))] backdrop-blur-2xl'
            } ${
              dailyWelcomeBanner.exiting ? 'doro-daily-welcome-banner-exit' : ''
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
          </button>
        )}
        {groupBanners.map((notice, i) => {
          const lifecycle = getBannerLifecycle(notice.tone);
          const progressStyle = {
            animationDuration: `${notice.tone === 'encouragement' ? lifecycle.visibleMs : lifecycle.totalMs}ms`,
            animationPlayState: notificationTimersActive ? 'running' : 'paused',
          } as React.CSSProperties;

          if (notice.tone === 'encouragement') {
            const encouragementExitClass = notice.exiting
              ? notice.exitStyle === 'pop'
                ? 'doro-encouragement-banner-pop'
                : 'doro-encouragement-banner-fade'
              : '';

            return (
              <button
                type="button"
                key={notice.id}
                onClick={() => dismissBanner(notice.id, 'pop')}
                aria-label={`Dismiss encouragement from ${notice.actorName}`}
                className={`doro-encouragement-banner pointer-events-auto relative w-full overflow-hidden rounded-xl border border-rose-200/32 px-4 py-3 text-left text-white outline-none transition-[border-color,box-shadow,transform] duration-300 hover:border-rose-100/48 focus-visible:ring-2 focus-visible:ring-rose-100/55 ${
                  settings.disableBlur
                    ? 'bg-red-950/92'
                    : 'bg-[linear-gradient(135deg,rgba(127,29,29,0.94),rgba(190,18,60,0.88)_48%,rgba(244,63,94,0.72))] backdrop-blur-2xl'
                } ${encouragementExitClass}`}
                style={{ animationDelay: `${i * 70}ms` }}
              >
                <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_10%_-8%,rgba(255,228,230,0.34),transparent_46%),radial-gradient(circle_at_92%_8%,rgba(255,255,255,0.12),transparent_28%)]" />
                <div className="relative z-10 flex min-w-0 items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-rose-100/24 bg-white/12 text-rose-50 shadow-[0_18px_34px_-24px_rgba(0,0,0,0.78),inset_0_1px_0_rgba(255,255,255,0.12)]">
                    <Heart size={22} strokeWidth={2.35} className="doro-encouragement-heart" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-black uppercase leading-none tracking-[0.18em] text-rose-100/76">
                      {notice.actorName}
                    </span>
                    <span className="doro-encouragement-text-3d mt-1.5 block text-[0.95rem] font-black leading-snug text-white">
                      {notice.message}
                    </span>
                  </span>
                </div>
                <div
                  className="doro-group-banner-progress absolute bottom-0 left-0 z-10 h-[2px] w-full bg-rose-100/62"
                  style={progressStyle}
                />
              </button>
            );
          }

          return (
            <div
              key={notice.id}
              className={`doro-group-banner relative overflow-hidden rounded-2xl border px-4 py-3 shadow-[0_20px_45px_-28px_rgba(15,23,42,0.9)] transition-all duration-500 ${
                notice.tone === 'join'
                  ? 'border-emerald-200/40 bg-emerald-300/12'
                  : notice.tone === 'friend'
                    ? 'border-sky-200/35 bg-sky-300/12'
                  : 'border-white/25 bg-white/10'
              } ${settings.disableBlur ? '' : 'backdrop-blur-2xl'} ${
                notice.exiting ? 'opacity-0 -translate-y-2 scale-[0.985]' : 'opacity-100 translate-y-0 scale-100'
              }`}
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <div className="absolute inset-0 opacity-60 bg-[radial-gradient(circle_at_12%_-12%,rgba(255,255,255,0.34),transparent_50%)]" />
              <div className="relative min-w-0 text-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">
                  {notice.title}
                </div>
                <div className="mt-1 text-sm leading-snug text-white/95">
                  <span className="font-bold">{notice.actorName}</span>{' '}{notice.message}
                </div>
              </div>
              <div
                className={`doro-group-banner-progress absolute bottom-0 left-0 h-[2px] w-full ${
                  notice.tone === 'join' ? 'bg-emerald-100/55' : notice.tone === 'friend' ? 'bg-sky-100/55' : 'bg-white/45'
                }`}
                style={progressStyle}
              />
            </div>
          );
        })}
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
          className={`doro-all-tasks-celebration pointer-events-none fixed inset-0 z-[94] overflow-hidden ${allTasksCelebration.exiting ? 'is-exiting' : ''}`}
          aria-hidden="true"
        >
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
        </div>
      )}

      <div
        className={`w-full flex flex-col items-center transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${isWeeklyScheduleOpen ? 'pointer-events-none' : ''}`}
        style={contentStyle}
      >
        {/* Top Bar */}
        <div className="doro-mobile-topbar w-full max-w-4xl flex justify-end items-center z-30 mb-4">
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
            className={`doro-main-surface relative overflow-hidden rounded-[2rem] md:rounded-[2.6rem] px-4 py-5 md:px-7 md:py-7 ${mainSurfaceClass}`}
            style={mainSurfaceShellStyle}
          >
            <div className="pointer-events-none absolute inset-0" style={{ borderRadius: 'inherit', ...mainSurfaceEdgeStyle }} />
            <div className="doro-main-surface-inner relative flex flex-col gap-12">
              {/* Timer Section */}
              <div className="doro-timer-section w-full flex justify-center animate-slide-up py-6 md:py-8">
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
