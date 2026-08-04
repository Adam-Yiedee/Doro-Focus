

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Flame, Heart, Users, X } from 'lucide-react';
import { useTimer } from '../context/TimerContext';
import TimerDisplay from './TimerDisplay';
import Tasks from './Tasks';
import AllPauseModal, { ResumeModal } from './Modals/AllPauseModal';
import LogModal from './Modals/LogModal';
import GraceModal, { type GracePreviewConfig } from './Modals/GraceModal';
import TaskViewModal from './Modals/TaskViewModal';
import WeeklySchedulePanel from './Modals/WeeklySchedulePanel';
import SummaryView from './SummaryView';
import StreakFlame from './StreakFlame';
import { FocusFriendAction, GroupGoalProgress, GroupGoalUnit, GroupMember, GroupSessionConfig, Task } from '../types';
import {
  preserveAppOpenStreakWithEarnedStats,
  recordAppOpenStreakWithEarnedStats,
  type AppOpenStreakSnapshot,
} from '../utils/appOpenStreak';
import { DORO_DEVELOPER_PREVIEW_EVENT, type DeveloperPreviewEventDetail } from '../utils/developerPreview';
import { DORO_DELAYED_START_SESSION_STARTED_EVENT } from '../utils/delayedStartEvents';
import { DEFAULT_BREAK_SURFACE, DEFAULT_WORK_SURFACE, getMutedSurfaceColor } from '../utils/palette';
import { getDailyWelcomeMessage } from '../utils/dailyWelcomeMessages';
import {
  playCelebrationTrumpet,
  playDefaultNotificationSound,
  playEncouragementDing,
  playFocusStreakMomentSound,
  preloadFocusStreakMomentSounds,
  resumeAudioContext,
  startPersistentAlarm,
} from '../utils/sound';
import { getFocusFriendInviteUsernameFromCurrentUrl } from '../utils/focusFriendInvite';
import {
  getGroupGoalProgressPercent,
  getGroupGoalProgressValue,
  getGroupSyncConfigForSession,
  getPooledGoalPerPersonTarget,
  getPooledGroupGoalProgressValue,
  isFocusShareSessionConfig,
  normalizeGroupSessionConfig,
  TIMER_SYNC_GROUP_SESSION_CONFIG,
} from '../utils/groupStudy';
import { formatPomodoroCount } from '../utils/pomodoroAccounting';

type NotificationBannerItem = {
  id: string;
  actorName: string;
  message: string;
  title: string;
  tone: 'join' | 'group' | 'friend' | 'encouragement';
  exiting: boolean;
  exitStyle?: 'fade' | 'pop';
  focusFriendAction?: FocusFriendAction;
  status?: 'working' | 'success' | 'error';
  statusMessage?: string;
  dismissOnClick?: boolean;
  stopAlarmOnDismiss?: boolean;
  persistUntilDismissed?: boolean;
};
type DailyWelcomeBanner = { id: string; message: string; exiting: boolean };
type FocusStreakBanner = { id: string; snapshot: AppOpenStreakSnapshot; exiting: boolean; armed: boolean };
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
const ENCOURAGEMENT_BANNER_EXIT_MS = 860;
const ENCOURAGEMENT_BANNER_TOTAL_MS = ENCOURAGEMENT_BANNER_VISIBLE_MS + ENCOURAGEMENT_BANNER_EXIT_MS;
const DAILY_WELCOME_VISIBLE_MS = 22000;
const DAILY_WELCOME_EXIT_MS = 680;
const DAILY_WELCOME_TOTAL_MS = DAILY_WELCOME_VISIBLE_MS + DAILY_WELCOME_EXIT_MS;
const DAILY_WELCOME_SHOW_DELAY_MS = 1150;
const DAILY_WELCOME_AFTER_FOCUS_DELAY_MS = 900;
const DAILY_WELCOME_STORAGE_KEY = 'doro_daily_welcome_seen_date';
const FOCUS_STREAK_VISIBLE_MS = 9200;
const FOCUS_STREAK_EXIT_MS = 720;
const FOCUS_STREAK_TOTAL_MS = FOCUS_STREAK_VISIBLE_MS + FOCUS_STREAK_EXIT_MS;
const FOCUS_STREAK_SOUND_WARMUP_MAX_MS = 420;
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

const shouldHoldFocusFriendJoinBanner = (action: FocusFriendAction | undefined) => (
  action?.type === 'join-request' || action?.type === 'join-invite'
);

type DeveloperGroupPreview = {
  sessionConfig: GroupSessionConfig;
  progress: GroupGoalProgress[];
  members?: GroupMember[];
  warning?: string | null;
};

const getGroupGoalUnitLabel = (unit: GroupGoalUnit, value: number) => {
  if (unit === 'mini-pomo') return value === 1 ? 'Mini-Pomo' : 'Mini-Pomos';
  return value === 1 ? 'Pomodoro' : 'Pomodoros';
};

const GROUP_GOAL_ROW_FALLBACK_COLORS = ['#7CB4FF', '#95D7A1', '#F5B27A', '#C6A2FF', '#F49AB1'];

const getGroupGoalParticipantColor = (item: GroupGoalProgress, index: number) => (
  item.activeCategoryColor?.trim()
  || item.activeColor?.trim()
  || GROUP_GOAL_ROW_FALLBACK_COLORS[index % GROUP_GOAL_ROW_FALLBACK_COLORS.length]
);

const getGroupGoalParticipantSubject = (item: GroupGoalProgress) => (
  item.activeCategoryName?.trim()
  || item.activeTaskName?.trim()
  || ''
);

const isGroupGoalSelfName = (name: string) => name.trim().toLowerCase() === 'you';

const getGroupGoalParticipantTooltip = (item: GroupGoalProgress, subject: string) => {
  if (isGroupGoalSelfName(item.name)) {
    if (subject) return `You are working on ${subject}.`;
    return item.activeSeconds > 0 ? 'You are focusing right now.' : 'You have not shared a focus goal yet.';
  }
  if (subject) return `${item.name} is working on ${subject}.`;
  return item.activeSeconds > 0 ? `${item.name} is focusing right now.` : `${item.name} has not shared a focus goal yet.`;
};

const getGroupGoalEncouragementOptions = ({
  item,
  rank,
  participantCount,
  value,
  unitLabel,
  subject,
}: {
  item: GroupGoalProgress;
  rank: number;
  participantCount: number;
  value: number;
  unitLabel: string;
  subject: string;
}) => {
  const name = item.name || 'You';
  const isSelf = isGroupGoalSelfName(name);
  const roundedValue = Math.max(0, Math.floor(value));
  const options: string[] = [];

  if (participantCount > 1 && rank === 1) {
    options.push(isSelf ? 'First place energy. Keep setting the pace.' : `First place energy, ${name}. Keep setting the pace.`);
  }
  if (roundedValue >= 3) {
    options.push(isSelf
      ? `${formatPomodoroCount(roundedValue)} ${unitLabel.toLowerCase()} down. That is serious momentum.`
      : `${formatPomodoroCount(roundedValue)} ${unitLabel.toLowerCase()} down, ${name}. That is serious momentum.`);
  }
  if (participantCount > 1 && rank === participantCount) {
    options.push(isSelf ? 'One focused block and you are right back in it.' : `${name}, one focused block and you are right back in it.`);
  }
  if (subject) {
    options.push(isSelf ? `${subject} is moving. Keep going.` : `${subject} is moving, ${name}. Keep going.`);
  }
  options.push(isSelf ? 'You have got this. Stay with it.' : `You have got this, ${name}. Stay with it.`);

  return Array.from(new Set(options)).slice(0, 4);
};

const GroupStudyGoalPanel: React.FC<{
  sessionConfig: GroupSessionConfig;
  progress: GroupGoalProgress[];
  members?: GroupMember[];
  warning?: string | null;
  isPreview?: boolean;
  onSendEncouragement?: (member: GroupGoalProgress, message: string) => boolean | void;
}> = ({ sessionConfig, progress, members = [], warning, isPreview = false, onSendEncouragement }) => {
  const [encouragementMenuMemberId, setEncouragementMenuMemberId] = useState<string | null>(null);
  const [sentEncouragementMemberId, setSentEncouragementMemberId] = useState<string | null>(null);
  const encouragementMenuRef = useRef<HTMLDivElement | null>(null);
  const normalizedConfig = normalizeGroupSessionConfig(sessionConfig, TIMER_SYNC_GROUP_SESSION_CONFIG);
  const goal = normalizedConfig.goal;

  useEffect(() => {
    if (!encouragementMenuMemberId) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (encouragementMenuRef.current?.contains(target)) return;
      setEncouragementMenuMemberId(null);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [encouragementMenuMemberId]);

  if (normalizedConfig.mode !== 'shared-goal' || !goal) {
    const sortedMembers = [...members]
      .filter(member => typeof member.name === 'string' && member.name.trim())
      .sort((a, b) => Number(b.isHost) - Number(a.isHost) || a.name.localeCompare(b.name));
    const memberCount = sortedMembers.length;
    const memberSummary = memberCount === 0
      ? 'Waiting for study partners'
      : memberCount === 1
        ? 'Just you for now'
        : `${memberCount} people in this session`;

    return (
      <aside className="doro-group-goal-panel w-full max-w-[21rem] shrink-0 rounded-[1.25rem] border p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-white/42">{isPreview ? 'Preview' : 'Group Study'}</div>
            <div className="mt-1 text-sm font-bold text-white/90">Studying with...</div>
            <div className="mt-1 text-xs font-semibold leading-relaxed text-white/48">{memberSummary}</div>
          </div>
          <div className="doro-group-goal-icon flex h-9 w-9 items-center justify-center rounded-[0.72rem] border text-white/72">
            <Users size={16} strokeWidth={2.2} />
          </div>
        </div>

        {sortedMembers.length > 0 && (
          <div className="mt-4 space-y-2">
            {sortedMembers.map(member => (
              <div key={member.id} className="doro-group-goal-row rounded-[0.85rem] border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-xs font-bold text-white/78">{member.name}{member.isHost ? ' (Host)' : ''}</div>
                  <div className="h-2 w-2 shrink-0 rounded-full bg-white/55" />
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>
    );
  }

  const isPooled = goal.type === 'pooled-total';
  const pooledValue = getPooledGroupGoalProgressValue(progress, goal.unit);
  const totalValue = isPooled ? pooledValue : 0;
  const headlineValue = isPooled
    ? totalValue
    : Math.max(0, ...progress.map(item => getGroupGoalProgressValue(item.totalSeconds, goal.unit)));
  const headlinePercent = getGroupGoalProgressPercent(isPooled ? totalValue : headlineValue, goal.target);
  const rowTarget = isPooled ? getPooledGoalPerPersonTarget(goal) : goal.target;
  const sortedProgress = [...progress].sort((a, b) => Number(b.isHost) - Number(a.isHost) || b.totalSeconds - a.totalSeconds);
  const rankedProgress = [...progress].sort((a, b) => b.totalSeconds - a.totalSeconds || a.name.localeCompare(b.name));
  const rankByMemberId = new Map(rankedProgress.map((item, index) => [item.memberId, index + 1]));

  return (
    <aside className="doro-group-goal-panel w-full max-w-[21rem] shrink-0 rounded-[1.25rem] border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-white/42">{isPreview ? 'Preview Goal' : 'Group Goal'}</div>
          <div className="mt-1 text-sm font-bold text-white/90">{isPooled ? 'Pooled Total' : 'Everyone Live'}</div>
        </div>
        <div className="doro-group-goal-icon flex h-9 w-9 items-center justify-center rounded-[0.72rem] border text-white/72">
          <Users size={16} strokeWidth={2.2} />
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-end justify-between gap-3">
          <div className="text-3xl font-black leading-none text-white">{formatPomodoroCount(headlineValue)}</div>
          <div className="pb-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/42">
            / {formatPomodoroCount(goal.target)}
          </div>
        </div>
        <div className="doro-group-goal-rail mt-3 h-2 overflow-hidden rounded-full border">
          <div
            className="h-full rounded-full bg-white/72 transition-[width] duration-500"
            style={{ width: `${headlinePercent}%` }}
          />
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {sortedProgress.map((item, index) => {
          const value = getGroupGoalProgressValue(item.totalSeconds, goal.unit);
          const rowPercent = getGroupGoalProgressPercent(value, rowTarget);
          const participantColor = getGroupGoalParticipantColor(item, index);
          const subject = getGroupGoalParticipantSubject(item);
          const tooltip = getGroupGoalParticipantTooltip(item, subject);
          const encouragementOptions = getGroupGoalEncouragementOptions({
            item,
            rank: rankByMemberId.get(item.memberId) || index + 1,
            participantCount: rankedProgress.length,
            value,
            unitLabel: getGroupGoalUnitLabel(goal.unit, value),
            subject,
          });
          const isEncouragementOpen = encouragementMenuMemberId === item.memberId;
          const encouragementSent = sentEncouragementMemberId === item.memberId;

          return (
            <div
              key={item.memberId}
              className={`doro-group-goal-row rounded-[0.85rem] border px-3 py-2 ${isEncouragementOpen ? 'doro-group-goal-row-menu-open' : ''}`}
              style={{ '--doro-group-goal-color': participantColor } as React.CSSProperties}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 text-xs font-bold text-white/78">
                  <span
                    className="doro-group-goal-name-tip"
                    title={tooltip}
                    data-tooltip={tooltip}
                    tabIndex={0}
                  >
                    <span className="doro-group-goal-name-label">
                      {item.name}{item.isHost ? ' (Host)' : ''}
                    </span>
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {onSendEncouragement && (
                    <div
                      ref={isEncouragementOpen ? encouragementMenuRef : undefined}
                      className={`doro-group-goal-encouragement relative ${isEncouragementOpen ? 'is-open' : ''} ${encouragementSent ? 'is-sent' : ''}`}
                    >
                      <button
                        type="button"
                        className={`doro-group-goal-heart-button ${isEncouragementOpen ? 'is-open' : ''} ${encouragementSent ? 'is-sent' : ''}`}
                        title={encouragementSent ? `Encouragement sent to ${item.name}` : `Encourage ${item.name}`}
                        aria-label={encouragementSent ? `Encouragement sent to ${item.name}` : `Encourage ${item.name}`}
                        aria-expanded={isEncouragementOpen}
                        onClick={() => setEncouragementMenuMemberId(current => current === item.memberId ? null : item.memberId)}
                      >
                        <Heart size={12} strokeWidth={2.4} fill={encouragementSent ? 'currentColor' : 'none'} />
                      </button>

                      {isEncouragementOpen && (
                        <div className="doro-group-goal-encouragement-menu">
                          {encouragementOptions.map(option => (
                            <button
                              key={option}
                              type="button"
                              className="doro-group-goal-encouragement-option"
                              onClick={() => {
                                const sent = onSendEncouragement(item, option);
                                if (sent !== false) {
                                  setSentEncouragementMemberId(item.memberId);
                                  window.setTimeout(() => {
                                    setSentEncouragementMemberId(current => current === item.memberId ? null : current);
                                  }, 1500);
                                }
                                setEncouragementMenuMemberId(null);
                              }}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="text-[11px] font-black tabular-nums text-white/72">{formatPomodoroCount(value)}</div>
                </div>
              </div>
              <div className="doro-group-goal-rail mt-1.5 h-1.5 overflow-hidden rounded-full border">
                <div className="doro-group-goal-row-fill h-full rounded-full transition-[width,background-color] duration-500" style={{ width: `${rowPercent}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {warning && (
        <div className="doro-group-goal-note mt-3 rounded-[0.85rem] border px-3 py-2 text-[11px] font-semibold leading-relaxed text-white/76">
          {warning}
        </div>
      )}
    </aside>
  );
};

const Layout: React.FC = () => {
  const {
    activeMode,
    activeColor,
    settings,
    tasks,
    user,
    userName,
    pendingJoinId,
    pendingMenuAction,
    isScheduleOpen,
    setScheduleOpen,
    isWeeklyScheduleOpen,
    setWeeklyScheduleOpen,
    groupNotice,
    groupSessionId,
    groupSessionConfig,
    groupGoalProgress,
    groupGoalPresetWarning,
    members,
    guestTimerLockNotice,
    focusFriendNotice,
    createGroupSession,
    joinGroupSession,
    approveFocusFriendJoinRequest,
    declineFocusFriendJoinRequest,
    markFocusFriendActionRead,
    sendGroupEncouragement,
    dismissGuestTimerLockNotice,
    leaveGroupSession,
  } = useTimer();
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [groupBanners, setGroupBanners] = useState<NotificationBannerItem[]>([]);
  const [dailyWelcomeBanner, setDailyWelcomeBanner] = useState<DailyWelcomeBanner | null>(null);
  const [focusStreakBanner, setFocusStreakBanner] = useState<FocusStreakBanner | null>(null);
  const [gracePreview, setGracePreview] = useState<GracePreviewConfig | null>(null);
  const [developerGroupPreview, setDeveloperGroupPreview] = useState<DeveloperGroupPreview | null>(null);
  const [allTasksCelebration, setAllTasksCelebration] = useState<AllTasksCelebration | null>(null);
  const [taskCreationPreviewColor, setTaskCreationPreviewColor] = useState<string | undefined>(undefined);
  const [notificationTimersActive, setNotificationTimersActive] = useState(areNotificationTimersActive);
  const [notificationAudioUnlockRevision, setNotificationAudioUnlockRevision] = useState(0);
  const [focusFriendJoinBusyId, setFocusFriendJoinBusyId] = useState<string | null>(null);
  const bannerTimersRef = useRef<Record<string, BannerTimerEntry>>({});
  const bannerDismissTimeoutsRef = useRef<Record<string, number>>({});
  const renderedGroupNoticeIdsRef = useRef<Set<string>>(new Set());
  const renderedFocusFriendNoticeIdsRef = useRef<Set<string>>(new Set());
  const playedDefaultNotificationSoundIdsRef = useRef<Set<string>>(new Set());
  const dailyWelcomeBannerRef = useRef<DailyWelcomeBanner | null>(null);
  const focusStreakBannerRef = useRef<FocusStreakBanner | null>(null);
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
  const focusStreakTimersRef = useRef({
    exit: createPausableTimeout(FOCUS_STREAK_VISIBLE_MS),
    remove: createPausableTimeout(FOCUS_STREAK_TOTAL_MS),
  });
  const playedFocusStreakSoundIdsRef = useRef<Set<string>>(new Set());
  const pendingFocusStreakSoundIdsRef = useRef<Set<string>>(new Set());
  const allTasksCelebrationTimeoutRef = useRef<number | null>(null);
  const queuedAllTasksCelebrationIdRef = useRef<number | null>(null);
  const didRecordAppOpenStreakRef = useRef(false);
  const previousOpenBoardTaskCountRef = useRef<number | null>(null);
  const previousTaskCheckedMapRef = useRef<Map<number, boolean>>(new Map());
  const didInitCelebrationRef = useRef(false);
  const previousGroupSessionIdRef = useRef<string | null>(null);
  const selectedAlarmSoundRef = useRef(settings.alarmSound);
  const selectedAlarmSoundVolumeRef = useRef(settings.alarmSoundVolume);
  const delayedStartAlarmStopRef = useRef<(() => void) | null>(null);

  const stopDelayedStartAlarm = () => {
    const stopAlarm = delayedStartAlarmStopRef.current;
    delayedStartAlarmStopRef.current = null;
    stopAlarm?.();
  };

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
    stopDelayedStartAlarm();
  };

  const clearDailyWelcomeTimers = () => {
    clearPausableTimeout(dailyWelcomeTimersRef.current.show);
    clearPausableTimeout(dailyWelcomeTimersRef.current.exit);
    clearPausableTimeout(dailyWelcomeTimersRef.current.remove);
  };

  const clearFocusStreakTimers = () => {
    clearPausableTimeout(focusStreakTimersRef.current.exit);
    clearPausableTimeout(focusStreakTimersRef.current.remove);
  };

  const resetDailyWelcomeTimers = () => {
    clearDailyWelcomeTimers();
    dailyWelcomeTimersRef.current.show.remainingMs = DAILY_WELCOME_SHOW_DELAY_MS;
    dailyWelcomeTimersRef.current.exit.remainingMs = DAILY_WELCOME_VISIBLE_MS;
    dailyWelcomeTimersRef.current.remove.remainingMs = DAILY_WELCOME_TOTAL_MS;
  };

  const holdDailyWelcomeUntilAfterFocusMoment = () => {
    clearDailyWelcomeTimers();
    dailyWelcomeTimersRef.current.show.remainingMs = DAILY_WELCOME_AFTER_FOCUS_DELAY_MS;
    dailyWelcomeTimersRef.current.exit.remainingMs = DAILY_WELCOME_VISIBLE_MS;
    dailyWelcomeTimersRef.current.remove.remainingMs = DAILY_WELCOME_TOTAL_MS;
    setDailyWelcomeBanner((current) => {
      if (!current) return current;
      return null;
    });
  };

  const resetFocusStreakTimers = () => {
    clearFocusStreakTimers();
    focusStreakTimersRef.current.exit.remainingMs = FOCUS_STREAK_VISIBLE_MS;
    focusStreakTimersRef.current.remove.remainingMs = FOCUS_STREAK_TOTAL_MS;
  };

  const pauseAllNotificationTimers = () => {
    Object.values(bannerTimersRef.current).forEach((timers) => {
      pausePausableTimeout(timers.exit);
      pausePausableTimeout(timers.remove);
    });
    pausePausableTimeout(dailyWelcomeTimersRef.current.show);
    pausePausableTimeout(dailyWelcomeTimersRef.current.exit);
    pausePausableTimeout(dailyWelcomeTimersRef.current.remove);
    pausePausableTimeout(focusStreakTimersRef.current.exit);
    pausePausableTimeout(focusStreakTimersRef.current.remove);
  };

  const scheduleDailyWelcomeLifecycle = () => {
    if (!notificationTimersActive) return;
    if (focusStreakBannerRef.current) return;
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

  const scheduleFocusStreakLifecycle = () => {
    if (!notificationTimersActive || !focusStreakBanner?.armed) return;
    const bannerId = focusStreakBanner.id;

    startPausableTimeout(focusStreakTimersRef.current.exit, () => {
      setFocusStreakBanner((prev) => (
        prev && prev.id === bannerId ? { ...prev, exiting: true } : prev
      ));
    });

    startPausableTimeout(focusStreakTimersRef.current.remove, () => {
      setFocusStreakBanner((prev) => (prev && prev.id === bannerId ? null : prev));
      clearFocusStreakTimers();
    });
  };

  const dismissFocusStreakBanner = () => {
    setFocusStreakBanner((current) => {
      if (!current || current.exiting) return current;
      const closingId = current.id;

      clearFocusStreakTimers();
      focusStreakTimersRef.current.remove.remainingMs = FOCUS_STREAK_EXIT_MS;
      startPausableTimeout(focusStreakTimersRef.current.remove, () => {
        setFocusStreakBanner((latest) => (latest?.id === closingId ? null : latest));
        clearFocusStreakTimers();
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
    if (currentBanner?.stopAlarmOnDismiss) {
      stopDelayedStartAlarm();
    }
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

  const updateFocusFriendBannerStatus = (
    bannerId: string,
    status: NotificationBannerItem['status'],
    statusMessage: string,
  ) => {
    setGroupBanners((prev) => prev.map((item) => (
      item.id === bannerId ? { ...item, status, statusMessage } : item
    )));
  };

  const scheduleFocusFriendBannerDismiss = (bannerId: string, delayMs = 1050) => {
    clearBannerDismissTimeout(bannerId);
    bannerDismissTimeoutsRef.current[bannerId] = window.setTimeout(() => {
      dismissBanner(bannerId, 'fade');
    }, delayMs);
  };

  const getLayoutFocusFriendSessionName = (fallback?: string | null) => (
    user?.username || userName || fallback || 'Focus Friend'
  );

  const getSafeFocusFriendSessionId = (value: string | null | undefined) => (
    typeof value === 'string' && value.trim()
      ? value.trim().toUpperCase().slice(0, 64)
      : ''
  );

  const getFocusFriendJoinerName = (fallback?: string | null) => (
    getLayoutFocusFriendSessionName(fallback).trim() || 'Focus Friend'
  );

  const handleApproveFocusFriendJoinBanner = async (action: FocusFriendAction, bannerId: string) => {
    if (focusFriendJoinBusyId) return;
    setFocusFriendJoinBusyId(bannerId);
    clearBannerTimer(bannerId);
    clearBannerDismissTimeout(bannerId);
    updateFocusFriendBannerStatus(bannerId, 'working', 'Opening your focus session...');

    try {
      let sessionConfig = normalizeGroupSessionConfig(groupSessionConfig, TIMER_SYNC_GROUP_SESSION_CONFIG);
      let sessionId = getSafeFocusFriendSessionId(groupSessionId);
      if (!sessionId) {
        sessionConfig = { ...TIMER_SYNC_GROUP_SESSION_CONFIG, createdAt: Date.now() };
        sessionId = await createGroupSession(
          getFocusFriendJoinerName(action.toUsername),
          getGroupSyncConfigForSession(sessionConfig),
          sessionConfig,
        );
      }

      const result = await approveFocusFriendJoinRequest(action.id, sessionId, sessionConfig);
      if (!result.ok) throw new Error(result.error || 'Could not approve join request.');
      updateFocusFriendBannerStatus(bannerId, 'success', 'Allowed. Joining them now.');
      scheduleFocusFriendBannerDismiss(bannerId);
    } catch (error) {
      updateFocusFriendBannerStatus(
        bannerId,
        'error',
        error instanceof Error ? error.message : 'Could not approve join request.',
      );
    } finally {
      setFocusFriendJoinBusyId(null);
    }
  };

  const handleDeclineFocusFriendJoinBanner = async (action: FocusFriendAction, bannerId: string) => {
    if (focusFriendJoinBusyId) return;
    setFocusFriendJoinBusyId(bannerId);
    clearBannerTimer(bannerId);
    clearBannerDismissTimeout(bannerId);
    updateFocusFriendBannerStatus(bannerId, 'working', 'Declining request...');

    try {
      const result = await declineFocusFriendJoinRequest(action.id);
      if (!result.ok) throw new Error(result.error || 'Could not decline join request.');
      updateFocusFriendBannerStatus(bannerId, 'success', 'Request declined.');
      scheduleFocusFriendBannerDismiss(bannerId, 800);
    } catch (error) {
      updateFocusFriendBannerStatus(
        bannerId,
        'error',
        error instanceof Error ? error.message : 'Could not decline join request.',
      );
    } finally {
      setFocusFriendJoinBusyId(null);
    }
  };

  const handleAutoJoinFocusFriendInvite = async (action: FocusFriendAction, bannerId: string) => {
    const sessionId = getSafeFocusFriendSessionId(action.sessionId);
    if (!sessionId || focusFriendJoinBusyId) return;
    setFocusFriendJoinBusyId(bannerId);
    clearBannerTimer(bannerId);
    clearBannerDismissTimeout(bannerId);
    updateFocusFriendBannerStatus(bannerId, 'working', 'Joining focus session...');

    try {
      const sessionConfig = normalizeGroupSessionConfig(action.groupStudy, TIMER_SYNC_GROUP_SESSION_CONFIG);
      if (getSafeFocusFriendSessionId(groupSessionId) !== sessionId) {
        await joinGroupSession(
          sessionId,
          getFocusFriendJoinerName(action.toUsername),
          getGroupSyncConfigForSession(sessionConfig),
          sessionConfig,
        );
      }
      if (!action.readAt) {
        const readResult = await markFocusFriendActionRead(action.id);
        if (!readResult.ok) {
          updateFocusFriendBannerStatus(
            bannerId,
            'success',
            'Joined. Invite will clear after refresh.',
          );
          scheduleFocusFriendBannerDismiss(bannerId, 1200);
          return;
        }
      }
      updateFocusFriendBannerStatus(bannerId, 'success', 'Joined focus session.');
      scheduleFocusFriendBannerDismiss(bannerId, 900);
    } catch (error) {
      updateFocusFriendBannerStatus(
        bannerId,
        'error',
        error instanceof Error ? error.message : 'Could not join focus session.',
      );
    } finally {
      setFocusFriendJoinBusyId(null);
    }
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
    if (typeof window === 'undefined') return;
    if (didRecordAppOpenStreakRef.current) return;
    didRecordAppOpenStreakRef.current = true;

    try {
      const snapshot = recordAppOpenStreakWithEarnedStats(window.localStorage, user?.lifetimeStats);
      if (snapshot.openedToday) {
        setFocusStreakBanner(null);
        return;
      }
      resetFocusStreakTimers();
      setFocusStreakBanner({
        id: `focus-streak-${snapshot.todayDate}-${Date.now()}`,
        snapshot,
        exiting: false,
        armed: false,
      });
    } catch {
      setFocusStreakBanner(null);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !user?.lifetimeStats) return;

    try {
      const snapshot = preserveAppOpenStreakWithEarnedStats(window.localStorage, user.lifetimeStats);
      setFocusStreakBanner((current) => (
        current ? { ...current, snapshot } : current
      ));
    } catch {
      // Ignore storage failures; account stats remain the source of truth.
    }
  }, [user?.lifetimeStats?.bestStreak, user?.lifetimeStats?.currentStreak, user?.lifetimeStats?.lastActiveDate]);

  useEffect(() => {
    dailyWelcomeBannerRef.current = dailyWelcomeBanner;
  }, [dailyWelcomeBanner]);

  useEffect(() => {
    focusStreakBannerRef.current = focusStreakBanner;
  }, [focusStreakBanner]);

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
      scheduleFocusStreakLifecycle();
      if (queuedAllTasksCelebrationIdRef.current !== null) {
        startAllTasksCelebration(queuedAllTasksCelebrationIdRef.current);
      }
      return;
    }

    pauseAllNotificationTimers();
  }, [notificationTimersActive, user?.lifetimeStats?.bestStreak, user?.lifetimeStats?.currentStreak]);

  useEffect(() => {
    selectedAlarmSoundRef.current = settings.alarmSound;
    selectedAlarmSoundVolumeRef.current = settings.alarmSoundVolume;
  }, [settings.alarmSound, settings.alarmSoundVolume]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleDelayedStartSessionStarted = () => {
      const id = `delayed-start-session-started-${Date.now()}`;
      const banner: NotificationBannerItem = {
        id,
        actorName: '',
        message: 'Session Started!',
        title: 'Delayed Start',
        tone: 'group',
        exiting: false,
        dismissOnClick: true,
        stopAlarmOnDismiss: true,
        persistUntilDismissed: true,
      };

      stopDelayedStartAlarm();
      delayedStartAlarmStopRef.current = startPersistentAlarm(
        selectedAlarmSoundRef.current,
        3200,
        selectedAlarmSoundVolumeRef.current,
      );

      setGroupBanners((prev) => {
        prev.forEach((item) => {
          if (item.stopAlarmOnDismiss) {
            clearBannerTimer(item.id);
            clearBannerDismissTimeout(item.id);
          }
        });

        const next = [
          ...prev.filter((item) => !item.stopAlarmOnDismiss),
          banner,
        ];
        const trimmed = next.slice(-3);
        const visibleBannerIds = new Set(trimmed.map(item => item.id));
        Object.keys(bannerTimersRef.current).forEach(timerId => {
          if (!visibleBannerIds.has(timerId)) {
            clearBannerTimer(timerId);
          }
        });
        Object.keys(bannerDismissTimeoutsRef.current).forEach(timerId => {
          if (!visibleBannerIds.has(timerId)) {
            clearBannerDismissTimeout(timerId);
          }
        });
        return trimmed;
      });
    };

    window.addEventListener(DORO_DELAYED_START_SESSION_STARTED_EVENT, handleDelayedStartSessionStarted);
    return () => {
      window.removeEventListener(DORO_DELAYED_START_SESSION_STARTED_EVENT, handleDelayedStartSessionStarted);
      stopDelayedStartAlarm();
    };
  }, []);

  useEffect(() => {
    void preloadFocusStreakMomentSounds();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const unlockNotificationAudio = () => {
      void resumeAudioContext()
        .then((ctx) => {
          void preloadFocusStreakMomentSounds();
          if (!ctx || ctx.state !== 'suspended') {
            setNotificationAudioUnlockRevision((revision) => revision + 1);
          }
        });
    };

    window.addEventListener('pointerdown', unlockNotificationAudio, { passive: true });
    window.addEventListener('keydown', unlockNotificationAudio);

    return () => {
      window.removeEventListener('pointerdown', unlockNotificationAudio);
      window.removeEventListener('keydown', unlockNotificationAudio);
    };
  }, []);

  useEffect(() => {
    if (focusStreakBanner) {
      holdDailyWelcomeUntilAfterFocusMoment();
      return;
    }

    scheduleDailyWelcomeLifecycle();
  }, [focusStreakBanner?.id, focusStreakBanner?.exiting, notificationTimersActive]);

  useEffect(() => {
    if (!focusStreakBanner || focusStreakBanner.exiting || focusStreakBanner.armed || !notificationTimersActive) return;
    const bannerId = focusStreakBanner.id;
    let cancelled = false;

    const armFocusStreakMoment = () => {
      if (cancelled) return;
      setFocusStreakBanner((current) => (
        current && current.id === bannerId
          ? { ...current, armed: true }
          : current
      ));
    };

    const armFocusStreakMomentIfAudioReady = async () => {
      const ctx = await resumeAudioContext({ timeoutMs: 140 });
      if (cancelled) return;
      if (ctx?.state === 'suspended') return;
      armFocusStreakMoment();
    };

    const fallbackTimeout = window.setTimeout(() => {
      void armFocusStreakMomentIfAudioReady();
    }, FOCUS_STREAK_SOUND_WARMUP_MAX_MS);
    void preloadFocusStreakMomentSounds()
      .catch(() => {
        // The sound helper logs load/decode failures. The visual should still run on time.
      })
      .finally(() => {
        window.clearTimeout(fallbackTimeout);
        void armFocusStreakMomentIfAudioReady();
      });

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimeout);
    };
  }, [
    focusStreakBanner?.id,
    focusStreakBanner?.armed,
    focusStreakBanner?.exiting,
    notificationAudioUnlockRevision,
    notificationTimersActive,
  ]);

  useEffect(() => {
    if (!notificationTimersActive) return;

    const visibleNotificationIds = [
      ...(dailyWelcomeBanner && !dailyWelcomeBanner.exiting ? [`daily:${dailyWelcomeBanner.id}`] : []),
      ...groupBanners
        .filter((banner) => !banner.exiting)
        .map((banner) => `banner:${banner.id}`),
    ];
    const playedIds = playedDefaultNotificationSoundIdsRef.current;

    visibleNotificationIds.forEach((id) => {
      if (playedIds.has(id)) return;
      playedIds.add(id);
      void playDefaultNotificationSound();
    });

    if (playedIds.size > 80) {
      const visibleIds = new Set(visibleNotificationIds);
      Array.from(playedIds).forEach((id) => {
        if (!visibleIds.has(id) && playedIds.size > 60) {
          playedIds.delete(id);
        }
      });
    }
  }, [dailyWelcomeBanner?.id, dailyWelcomeBanner?.exiting, groupBanners, notificationTimersActive]);

  useEffect(() => {
    scheduleFocusStreakLifecycle();
  }, [focusStreakBanner?.id, focusStreakBanner?.armed, notificationTimersActive]);

  useEffect(() => {
    if (!focusStreakBanner || focusStreakBanner.exiting || !focusStreakBanner.armed || !notificationTimersActive) return;
    if (playedFocusStreakSoundIdsRef.current.has(focusStreakBanner.id)) return;
    if (pendingFocusStreakSoundIdsRef.current.has(focusStreakBanner.id)) return;

    const bannerId = focusStreakBanner.id;
    pendingFocusStreakSoundIdsRef.current.add(bannerId);
    void playFocusStreakMomentSound(focusStreakBanner.snapshot.rollingDays, {
      streakIncreased: !focusStreakBanner.snapshot.streakBroken,
    })
      .then((didPlay) => {
        pendingFocusStreakSoundIdsRef.current.delete(bannerId);
        if (didPlay) {
          playedFocusStreakSoundIdsRef.current.add(bannerId);
        }
      })
      .catch(() => {
        pendingFocusStreakSoundIdsRef.current.delete(bannerId);
      });
  }, [focusStreakBanner, notificationAudioUnlockRevision, notificationTimersActive]);

  useEffect(() => {
    if (previousGroupSessionIdRef.current !== groupSessionId) {
      clearAllBannerTimers();
      setGroupBanners((prev) => prev.filter((banner) => (
        banner.id === focusFriendJoinBusyId
        && (banner.focusFriendAction?.type === 'join-request' || banner.focusFriendAction?.type === 'join-invite')
      )));
      previousGroupSessionIdRef.current = groupSessionId;
    }
  }, [focusFriendJoinBusyId, groupSessionId]);

  useEffect(() => {
    if (!groupNotice) return;
    if (groupNotice.kind === 'encouragement' && !notificationTimersActive) return;
    const id = groupNotice.id;
    if (renderedGroupNoticeIdsRef.current.has(id)) return;
    renderedGroupNoticeIdsRef.current.add(id);
    clearBannerTimer(id);
    clearBannerDismissTimeout(id);
    const tone = groupNotice.kind === 'join'
      ? 'join' as const
      : groupNotice.kind === 'encouragement'
        ? 'encouragement' as const
        : 'group' as const;
    const title = groupNotice.kind === 'join'
      ? 'Member Joined'
      : groupNotice.kind === 'encouragement'
        ? 'Encouragement'
        : 'Group Action';
    setGroupBanners(prev => {
      const next = [
        ...prev.filter(item => item.id !== id),
        {
          id,
          actorName: groupNotice.actorName,
          message: groupNotice.message,
          title,
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

    if (tone === 'encouragement') {
      void playEncouragementDing();
    }

    const lifecycle = getBannerLifecycle(tone);
    bannerTimersRef.current[id] = {
      exit: createPausableTimeout(lifecycle.visibleMs),
      remove: createPausableTimeout(lifecycle.totalMs),
    };
    scheduleBannerTimer(id);
  }, [groupNotice, notificationTimersActive]);

  useEffect(() => {
    if (!focusFriendNotice) return;
    if (!notificationTimersActive) return;
    const id = focusFriendNotice.id;
    if (renderedFocusFriendNoticeIdsRef.current.has(id)) return;
    renderedFocusFriendNoticeIdsRef.current.add(id);
    const focusFriendAction = focusFriendNotice.type === 'action' ? focusFriendNotice.action : undefined;
    const banner = focusFriendNotice.type === 'request'
      ? {
          actorName: focusFriendNotice.request.fromDisplayName || focusFriendNotice.request.fromUsername,
          message: 'sent you a Focus Friend request.',
          title: 'Friend Request',
          tone: 'friend' as const,
          focusFriendAction: undefined,
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
          focusFriendAction,
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
          focusFriendAction: banner.focusFriendAction,
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

    if (focusFriendAction?.type === 'encouragement' && !focusFriendAction.readAt) {
      void markFocusFriendActionRead(focusFriendAction.id);
    }

    if (!shouldHoldFocusFriendJoinBanner(focusFriendAction)) {
      const lifecycle = getBannerLifecycle(banner.tone);
      bannerTimersRef.current[id] = {
        exit: createPausableTimeout(lifecycle.visibleMs),
        remove: createPausableTimeout(lifecycle.totalMs),
      };
      scheduleBannerTimer(id);
    }

    if (focusFriendAction?.type === 'join-invite' && !focusFriendAction.readAt) {
      void handleAutoJoinFocusFriendInvite(focusFriendAction, id);
    }
  }, [focusFriendNotice, markFocusFriendActionRead, notificationTimersActive]);

  useEffect(() => {
    const createDeveloperGroupBanner = (
      tone: NotificationBannerItem['tone'],
      title: string,
      actorName: string,
      message: string,
    ) => {
      const id = `developer-${tone}-${Date.now()}`;
      clearBannerTimer(id);
      clearBannerDismissTimeout(id);

      const banner: NotificationBannerItem = {
        id,
        actorName,
        message,
        title,
        tone,
        exiting: false,
      };

      setGroupBanners(prev => {
        const next = [...prev.filter(item => item.id !== id), banner];
        const trimmed = next.slice(-3);
        const visibleBannerIds = new Set(trimmed.map(item => item.id));
        Object.keys(bannerTimersRef.current).forEach(timerId => {
          if (timerId.startsWith('developer-') && !visibleBannerIds.has(timerId)) {
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
      if (tone === 'encouragement') void playEncouragementDing();
    };

    const showDeveloperDailyWelcome = () => {
      const id = `developer-daily-${Date.now()}`;
      clearDailyWelcomeTimers();
      dailyWelcomeConfigRef.current = { bannerId: null, todayKey: null, message: null };
      setDailyWelcomeBanner({
        id,
        message: 'Developer preview notification. The entrance, progress bar, and dismissal are live.',
        exiting: false,
      });

      dailyWelcomeTimersRef.current.exit.remainingMs = DAILY_WELCOME_VISIBLE_MS;
      dailyWelcomeTimersRef.current.remove.remainingMs = DAILY_WELCOME_TOTAL_MS;
      if (!notificationTimersActive) return;
      startPausableTimeout(dailyWelcomeTimersRef.current.exit, () => {
        setDailyWelcomeBanner(prev => (prev?.id === id ? { ...prev, exiting: true } : prev));
      });
      startPausableTimeout(dailyWelcomeTimersRef.current.remove, () => {
        setDailyWelcomeBanner(prev => (prev?.id === id ? null : prev));
        clearDailyWelcomeTimers();
      });
    };

    const showDeveloperFocusStreak = () => {
      if (typeof window === 'undefined') return;
      const snapshot = preserveAppOpenStreakWithEarnedStats(window.localStorage, user?.lifetimeStats);
      resetFocusStreakTimers();
      setFocusStreakBanner({
        id: `developer-focus-streak-${Date.now()}`,
        snapshot,
        exiting: false,
        armed: false,
      });
    };

    const createDeveloperGroupPreview = (kind: 'timer-sync' | 'everyone' | 'pooled' | 'complete') => {
      const now = Date.now();
      const makeProgress = (
        unit: GroupGoalUnit,
        rows: Array<{ id: string; name: string; isHost?: boolean; value: number; subject?: string; color?: string; task?: string }>,
      ): GroupGoalProgress[] => {
        const unitSeconds = unit === 'mini-pomo' ? 15 * 60 : 25 * 60;
        return rows.map((row, index) => {
          const totalSeconds = Math.max(0, Math.round(row.value * unitSeconds));
          const subject = row.subject?.trim();
          const color = row.color?.trim();
          return {
            memberId: row.id,
            name: row.name,
            isHost: Boolean(row.isHost),
            completedSeconds: totalSeconds,
            activeSeconds: 0,
            totalSeconds,
            activeTaskName: row.task?.trim() || subject || null,
            activeCategoryName: subject || null,
            activeCategoryColor: color || undefined,
            activeColor: color || undefined,
            updatedAt: now - index * 1200,
          };
        });
      };
      const makeMembers = (rows: Array<{ id: string; name: string; isHost?: boolean }>): GroupMember[] => (
        rows.map(row => ({
          id: row.id,
          name: row.name,
          isHost: Boolean(row.isHost),
        }))
      );
      const localName = user?.username || userName || 'You';
      const timerSyncMembers = makeMembers([
        { id: 'developer-host', name: localName, isHost: true },
        { id: 'developer-mira', name: 'Mira' },
        { id: 'developer-sam', name: 'Sam' },
      ]);

      if (kind === 'timer-sync') {
        setDeveloperGroupPreview({
          sessionConfig: { ...TIMER_SYNC_GROUP_SESSION_CONFIG, createdAt: now },
          members: timerSyncMembers,
          progress: [],
        });
        return;
      }

      if (kind === 'everyone') {
        setDeveloperGroupPreview({
          sessionConfig: {
            mode: 'shared-goal',
            createdAt: now,
            goal: {
              type: 'everyone-live',
              unit: 'pomodoro',
              target: 4,
              expectedParticipants: 3,
              invitedUsernames: ['mira', 'sam'],
            },
          },
          progress: makeProgress('pomodoro', [
            { id: 'developer-host', name: localName, isHost: true, value: 1.4, subject: 'Deep Work', color: '#7CB4FF' },
            { id: 'developer-mira', name: 'Mira', value: 1, subject: 'Biology', color: '#95D7A1' },
            { id: 'developer-sam', name: 'Sam', value: 0.5, subject: 'Writing', color: '#F5B27A' },
          ]),
          members: timerSyncMembers,
          warning: 'Preview warning: this goal was set up for the Classic preset.',
        });
        return;
      }

      if (kind === 'pooled') {
        setDeveloperGroupPreview({
          sessionConfig: {
            mode: 'shared-goal',
            createdAt: now,
            goal: {
              type: 'pooled-total',
              unit: 'pomodoro',
              target: 10,
              expectedParticipants: 4,
              invitedUsernames: ['mira', 'sam', 'lee'],
            },
          },
          progress: makeProgress('pomodoro', [
            { id: 'developer-host', name: localName, isHost: true, value: 2.2, subject: 'Deep Work', color: '#7CB4FF' },
            { id: 'developer-mira', name: 'Mira', value: 1.8, subject: 'Biology', color: '#95D7A1' },
            { id: 'developer-sam', name: 'Sam', value: 1.25, subject: 'Writing', color: '#F5B27A' },
            { id: 'developer-lee', name: 'Lee', value: 0.75, subject: 'Chemistry', color: '#C6A2FF' },
          ]),
          members: makeMembers([
            { id: 'developer-host', name: localName, isHost: true },
            { id: 'developer-mira', name: 'Mira' },
            { id: 'developer-sam', name: 'Sam' },
            { id: 'developer-lee', name: 'Lee' },
          ]),
        });
        return;
      }

      setDeveloperGroupPreview({
        sessionConfig: {
          mode: 'shared-goal',
          createdAt: now,
          goal: {
            type: 'pooled-total',
            unit: 'mini-pomo',
            target: 8,
            expectedParticipants: 3,
            invitedUsernames: ['mira', 'sam'],
          },
        },
        progress: makeProgress('mini-pomo', [
          { id: 'developer-host', name: localName, isHost: true, value: 3.5, subject: 'Deep Work', color: '#7CB4FF' },
          { id: 'developer-mira', name: 'Mira', value: 2.5, subject: 'Biology', color: '#95D7A1' },
          { id: 'developer-sam', name: 'Sam', value: 2.25, subject: 'Writing', color: '#F5B27A' },
        ]),
        members: timerSyncMembers,
      });
    };

    const clearDeveloperPreviews = () => {
      Object.keys(bannerTimersRef.current).forEach(timerId => {
        if (timerId.startsWith('developer-')) clearBannerTimer(timerId);
      });
      Object.keys(bannerDismissTimeoutsRef.current).forEach(timerId => {
        if (timerId.startsWith('developer-')) clearBannerDismissTimeout(timerId);
      });
      setGroupBanners(prev => prev.filter(item => !item.id.startsWith('developer-')));
      setDailyWelcomeBanner(prev => (prev?.id.startsWith('developer-') ? null : prev));
      setFocusStreakBanner(prev => (prev?.id.startsWith('developer-') ? null : prev));
      setGracePreview(null);
      setDeveloperGroupPreview(null);
    };

    const handleDeveloperPreview = (event: Event) => {
      const action = (event as CustomEvent<DeveloperPreviewEventDetail>).detail?.action;

      switch (action) {
        case 'focus-streak-notification':
          showDeveloperFocusStreak();
          break;
        case 'daily-welcome-notification':
          showDeveloperDailyWelcome();
          break;
        case 'group-notification':
          createDeveloperGroupBanner('group', 'Developer Notice', 'Preview', 'opened a regular group-style notification.');
          break;
        case 'friend-notification':
          createDeveloperGroupBanner('friend', 'Friend Action', 'Preview Friend', 'wants to join your focus session.');
          break;
        case 'encouragement-notification':
          createDeveloperGroupBanner('encouragement', 'Encouragement', 'Preview Friend', 'This is the encouragement banner animation.');
          break;
        case 'grace-after-work':
          setGracePreview({
            context: 'afterWork',
            graceTotal: 84,
            showOptions: true,
            statusMessage: 'Developer preview for the post-work grace menu.',
          });
          break;
        case 'grace-after-break':
          setGracePreview({
            context: 'afterBreak',
            graceTotal: 96,
            showOptions: true,
            statusMessage: 'Developer preview for the post-break grace menu.',
          });
          break;
        case 'long-grace':
          setGracePreview({
            context: 'afterWork',
            graceTotal: 3 * 60 * 60,
            showOptions: true,
            showLongGracePrompt: true,
            statusMessage: 'Developer preview for long-grace session protection.',
          });
          break;
        case 'group-timer-sync':
          createDeveloperGroupPreview('timer-sync');
          break;
        case 'group-goal-everyone':
          createDeveloperGroupPreview('everyone');
          break;
        case 'group-goal-pooled':
          createDeveloperGroupPreview('pooled');
          break;
        case 'group-goal-complete':
          createDeveloperGroupPreview('complete');
          break;
        case 'clear-previews':
          clearDeveloperPreviews();
          break;
        default:
          break;
      }
    };

    window.addEventListener(DORO_DEVELOPER_PREVIEW_EVENT, handleDeveloperPreview);
    return () => window.removeEventListener(DORO_DEVELOPER_PREVIEW_EVENT, handleDeveloperPreview);
  }, [notificationTimersActive]);

  useEffect(() => {
    return () => {
      clearAllBannerTimers();
      clearDailyWelcomeTimers();
      clearFocusStreakTimers();
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
  const focusStreakSnapshot = focusStreakBanner?.snapshot || null;
  const shouldRenderFocusStreakMoment = Boolean(focusStreakBanner?.armed && focusStreakSnapshot);
  const shouldShowGroupStudyPanel = Boolean(groupSessionId && !isFocusShareSessionConfig(groupSessionConfig));
  const groupStudyPanel = developerGroupPreview
    ? {
      ...developerGroupPreview,
      isPreview: true,
    }
    : shouldShowGroupStudyPanel
      ? {
        sessionConfig: groupSessionConfig,
        progress: groupGoalProgress,
        members,
        warning: groupGoalPresetWarning,
        isPreview: false,
      }
      : null;

  return (
    <div 
      className="doro-app-shell min-h-screen w-full flex flex-col items-center p-4 relative overflow-x-hidden transition-[background-color,background-image] duration-1000 ease-[cubic-bezier(0.25,1,0.5,1)]"
      style={containerStyle}
    >
      <style>{`
        .doro-group-goal-panel {
          --doro-group-goal-ease: cubic-bezier(0.16, 1, 0.3, 1);
          overflow: visible;
          background:
            linear-gradient(145deg, rgba(255,255,255,0.145), rgba(255,255,255,0.06)),
            rgba(255,255,255,0.075);
          border-color: rgba(255, 255, 255, 0.18);
          box-shadow:
            0 38px 82px -40px rgba(0,0,0,0.84),
            0 18px 38px -22px rgba(0,0,0,0.64),
            inset 0 1px 0 rgba(255,255,255,0.16);
          transform: translateZ(0);
          backface-visibility: hidden;
        }
        .doro-group-goal-icon,
        .doro-group-goal-row,
        .doro-group-goal-note {
          background:
            linear-gradient(145deg, rgba(255,255,255,0.07), rgba(255,255,255,0.025)),
            rgba(0, 0, 0, 0.24);
          border-color: rgba(255, 255, 255, 0.16);
          box-shadow: 0 14px 26px -24px rgba(0, 0, 0, 0.54);
        }
        .doro-group-goal-row {
          position: relative;
          overflow: visible;
          transition:
            transform 370ms var(--doro-group-goal-ease),
            background-color 280ms ease,
            border-color 280ms ease,
            box-shadow 300ms ease,
            filter 280ms ease;
          will-change: transform, box-shadow, background-color;
          backface-visibility: hidden;
        }
        .doro-group-goal-row:hover {
          background:
            linear-gradient(145deg, rgba(255,255,255,0.095), rgba(255,255,255,0.035)),
            rgba(0, 0, 0, 0.3);
          border-color: rgba(255, 255, 255, 0.28);
          box-shadow:
            0 18px 28px -24px rgba(0, 0, 0, 0.6),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
          transform: translate3d(0, -1px, 0) scale(1.003);
          filter: brightness(1.018);
        }
        .doro-group-goal-row-menu-open {
          z-index: 8;
        }
        .doro-group-goal-rail {
          background: rgba(0, 0, 0, 0.24);
          border-color: rgba(255, 255, 255, 0.12);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
        }
        .doro-group-goal-row-fill {
          background: var(--doro-group-goal-color, rgba(255, 255, 255, 0.45));
          box-shadow: 0 0 14px -7px var(--doro-group-goal-color, rgba(255, 255, 255, 0.45));
        }
        .doro-group-goal-name-tip {
          position: relative;
          display: block;
          max-width: 100%;
          outline: none;
        }
        .doro-group-goal-name-label {
          display: block;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .doro-group-goal-name-tip::after {
          content: attr(data-tooltip);
          position: absolute;
          left: 0;
          bottom: calc(100% + 0.5rem);
          z-index: 45;
          width: max-content;
          max-width: min(15rem, calc(100vw - 2rem));
          padding: 0.45rem 0.6rem;
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 0.65rem;
          background:
            linear-gradient(145deg, rgba(255, 255, 255, 0.13), rgba(255, 255, 255, 0.055)),
            rgba(20, 24, 38, 0.9);
          box-shadow: 0 18px 34px -24px rgba(0, 0, 0, 0.74);
          color: rgba(255, 255, 255, 0.9);
          font-size: 0.68rem;
          font-weight: 800;
          line-height: 1.25;
          white-space: normal;
          opacity: 0;
          pointer-events: none;
          transform: translate3d(0, 0.3rem, 0) scale(0.98);
          transition:
            opacity 180ms ease,
            transform 220ms var(--doro-group-goal-ease);
        }
        .doro-group-goal-name-tip:hover::after,
        .doro-group-goal-name-tip:focus-visible::after {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
        }
        .doro-group-goal-encouragement {
          display: inline-flex;
          width: 1.5rem;
          height: 1.5rem;
          flex: 0 0 1.5rem;
          align-items: center;
          justify-content: center;
          opacity: 0;
          pointer-events: none;
          transform: translate3d(0.28rem, 0.16rem, 0) scale(0.86);
          transition:
            opacity 170ms ease,
            transform 210ms cubic-bezier(0.22, 1, 0.36, 1);
          will-change: opacity, transform;
        }
        .doro-group-goal-row:hover .doro-group-goal-encouragement,
        .doro-group-goal-row:focus-within .doro-group-goal-encouragement,
        .doro-group-goal-encouragement.is-open,
        .doro-group-goal-encouragement.is-sent {
          opacity: 1;
          pointer-events: auto;
          transform: translate3d(0, 0, 0) scale(1);
        }
        .doro-group-goal-heart-button {
          display: flex;
          width: 1.5rem;
          height: 1.5rem;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.075);
          color: rgba(255, 255, 255, 0.62);
          outline: none;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
          transition:
            color 180ms ease,
            background-color 180ms ease,
            border-color 180ms ease,
            transform 180ms ease,
            box-shadow 200ms ease;
        }
        .doro-group-goal-heart-button:hover,
        .doro-group-goal-heart-button:focus-visible,
        .doro-group-goal-heart-button.is-open,
        .doro-group-goal-heart-button.is-sent {
          background: rgba(255, 255, 255, 0.16);
          border-color: rgba(255, 255, 255, 0.3);
          color: rgba(255, 255, 255, 0.94);
          box-shadow:
            0 12px 22px -18px rgba(0, 0, 0, 0.72),
            0 0 16px -9px var(--doro-group-goal-color, rgba(255, 255, 255, 0.45));
          transform: translateY(-1px) scale(1.04);
        }
        .doro-group-goal-heart-button.is-sent {
          color: #F49AB1;
        }
        .doro-group-goal-encouragement-menu {
          position: absolute;
          top: calc(100% + 0.45rem);
          right: -0.15rem;
          z-index: 80;
          display: grid;
          width: min(15.5rem, calc(100vw - 2rem));
          max-height: 13rem;
          overflow-y: auto;
          gap: 0.12rem;
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 0.85rem;
          background: rgba(10, 14, 24, 0.98);
          box-shadow:
            0 28px 52px -26px rgba(0, 0, 0, 0.86),
            0 8px 18px -12px rgba(0, 0, 0, 0.78),
            inset 0 1px 0 rgba(255, 255, 255, 0.12);
          padding: 0.35rem;
          animation: doroGroupEncouragementMenuIn 180ms var(--doro-group-goal-ease);
          transform-origin: top right;
          backdrop-filter: blur(18px) saturate(160%);
          -webkit-backdrop-filter: blur(18px) saturate(160%);
        }
        .doro-group-goal-encouragement-option {
          display: block;
          width: 100%;
          border: 0;
          border-radius: 0.62rem;
          background: transparent;
          padding: 0.5rem 0.55rem;
          color: rgba(255, 255, 255, 0.88);
          font-size: 0.72rem;
          font-weight: 800;
          line-height: 1.25;
          text-align: left;
          outline: none;
          transition:
            background-color 160ms ease,
            color 160ms ease,
            transform 160ms ease;
        }
        .doro-group-goal-encouragement-option:hover,
        .doro-group-goal-encouragement-option:focus-visible {
          background: rgba(255, 255, 255, 0.12);
          color: rgba(255, 255, 255, 0.98);
          transform: translateX(1px);
        }
        @media (hover: none) {
          .doro-group-goal-encouragement {
            opacity: 1;
            pointer-events: auto;
            transform: translate3d(0, 0, 0) scale(1);
          }
        }
        @keyframes doroGroupEncouragementMenuIn {
          0% { opacity: 0; transform: translate3d(0, -0.35rem, 0) scale(0.96); }
          100% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
        }
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
        @keyframes doroFocusStreakOverlayIn {
          0% {
            opacity: 0;
            backdrop-filter: blur(0) saturate(1);
            -webkit-backdrop-filter: blur(0) saturate(1);
          }
          100% {
            opacity: 1;
            backdrop-filter: blur(14px) saturate(1.08);
            -webkit-backdrop-filter: blur(14px) saturate(1.08);
          }
        }
        @keyframes doroFocusStreakOverlayOut {
          0% {
            opacity: 1;
            backdrop-filter: blur(14px) saturate(1.08);
            -webkit-backdrop-filter: blur(14px) saturate(1.08);
          }
          100% {
            opacity: 0;
            backdrop-filter: blur(0) saturate(1);
            -webkit-backdrop-filter: blur(0) saturate(1);
          }
        }
        @keyframes doroFocusStreakCardIn {
          0% {
            opacity: 0;
            transform: translateY(30px) scale(0.9);
            filter: blur(12px) saturate(0.86);
          }
          58% {
            opacity: 1;
            transform: translateY(-5px) scale(1.018);
            filter: blur(0) saturate(1.08);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0) saturate(1);
          }
        }
        @keyframes doroFocusStreakCardOut {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0) saturate(1);
          }
          36% {
            opacity: 1;
            transform: translateY(5px) scale(1.012);
            filter: blur(0) saturate(1.1);
          }
          100% {
            opacity: 0;
            transform: translateY(24px) scale(0.9);
            filter: blur(14px) saturate(0.78);
          }
        }
        @keyframes doroFocusStreakFireReveal {
          0% {
            opacity: 0;
            transform: scale(1.01);
            filter: blur(12px) saturate(0.94) contrast(0.94);
          }
          14% {
            opacity: 0.92;
            transform: scale(1.01);
            filter: blur(0) saturate(1.08) contrast(0.98);
          }
          58% {
            opacity: 0.96;
            transform: scale(1.01);
            filter: blur(0) saturate(1.16) contrast(1.02);
          }
          76% {
            opacity: 0.84;
            transform: scale(1.01);
            filter: blur(0.6px) saturate(1.12) contrast(1);
          }
          90% {
            opacity: 0.36;
            transform: scale(1.01);
            filter: blur(5px) saturate(1.02) contrast(0.94);
          }
          100% {
            opacity: 0;
            transform: scale(1.01);
            filter: blur(10px) saturate(0.92) contrast(0.9);
          }
        }
        @keyframes doroFocusStreakNumberReveal {
          0%,
          18% {
            opacity: 0;
            transform: scale(0.9);
            filter: blur(10px);
            text-shadow:
              0 2px 0 rgba(255,255,255,0.12),
              0 13px 24px rgba(0,0,0,0.44);
          }
          68% {
            opacity: 0.9;
            transform: scale(0.918);
            filter: blur(1.4px);
            text-shadow:
              0 2px 0 rgba(255,255,255,0.12),
              0 13px 24px rgba(0,0,0,0.44);
          }
          100% {
            opacity: 1;
            transform: scale(0.92);
            filter: none;
            text-shadow:
              0 2px 0 rgba(255,255,255,0.12),
              0 13px 24px rgba(0,0,0,0.44);
          }
        }
        @keyframes doroFocusStreakNumberShine {
          0%,
          12% {
            opacity: 0;
            background-position: 142% 50%;
          }
          22% {
            opacity: 0.98;
          }
          64% {
            opacity: 0.92;
          }
          100% {
            opacity: 0;
            background-position: -42% 50%;
          }
        }
        @keyframes doroFocusStreakNumberSheenBreath {
          0%,
          100% {
            opacity: 0;
          }
          46% {
            opacity: 0.36;
          }
          58% {
            opacity: 0.16;
          }
        }
        @keyframes doroFocusStreakLabelIn {
          0% {
            opacity: 0;
            transform: translateY(10px);
            filter: blur(4px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
            filter: blur(0);
          }
        }
        @keyframes doroFocusStreakGlowIn {
          0% {
            opacity: 0;
            transform: scale(1);
            filter: blur(20px);
          }
          100% {
            opacity: 0.38;
            transform: scale(1);
            filter: blur(18px);
          }
        }
        @keyframes doroFocusStreakWeekIn {
          0% {
            opacity: 0;
            transform: translateY(26px) scale(0.72);
            filter: blur(12px) saturate(0.82);
          }
          54% {
            opacity: 1;
            transform: translateY(-6px) scale(1.1);
            filter: blur(0) saturate(1.16);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0) saturate(1);
          }
        }
        @keyframes doroFocusStreakDayIn {
          0% {
            opacity: 0;
            transform: translateY(18px) scale(0.48) rotate(-8deg);
            filter: blur(8px) saturate(0.85);
          }
          64% {
            opacity: 1;
            transform: translateY(-5px) scale(1.18) rotate(3deg);
            filter: blur(0) saturate(1.14);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0) saturate(1);
          }
        }
        @keyframes doroFocusStreakTodayIgnite {
          0% {
            transform: scale(0.62);
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,0.16),
              0 0 0 rgba(251,191,36,0);
          }
          48% {
            transform: scale(1.3);
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,0.24),
              0 0 34px rgba(251,191,36,0.68),
              0 14px 26px rgba(0,0,0,0.42);
          }
          72% {
            transform: scale(0.93);
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,0.2),
              0 0 17px rgba(251,191,36,0.42),
              0 7px 15px rgba(0,0,0,0.28);
          }
          100% {
            transform: scale(1);
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,0.2),
              0 0 14px rgba(251,191,36,0.38),
              0 7px 15px rgba(0,0,0,0.26);
          }
        }
        @keyframes doroFocusStreakTodayFlameIn {
          0% {
            opacity: 0;
            transform: translateY(3px) scale(0.32) rotate(-10deg);
            filter: blur(4px) brightness(1.5);
          }
          58% {
            opacity: 1;
            transform: translateY(-1px) scale(1.2) rotate(4deg);
            filter: blur(0) brightness(1.18);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1) rotate(0deg);
            filter: blur(0) brightness(1);
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
          42% {
            opacity: 1;
            transform: translateY(2px) scale(1.008);
            filter: blur(0) saturate(1.16) brightness(1.04);
          }
          100% {
            opacity: 0;
            transform: translateY(-24px) scale(0.955);
            filter: blur(13px) saturate(0.76) brightness(1.08);
          }
        }
        @keyframes doroEncouragementBannerPop {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0) saturate(1);
          }
          28% {
            opacity: 1;
            transform: translateY(-3px) scale(1.035);
            filter: blur(0) saturate(1.28) brightness(1.12);
          }
          52% {
            opacity: 0.92;
            transform: translateY(3px) scale(0.972);
            filter: blur(1px) saturate(1.08) brightness(1.04);
          }
          100% {
            opacity: 0;
            transform: translateY(-28px) scale(0.86);
            filter: blur(16px) saturate(0.72) brightness(1.2);
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
        .doro-focus-friend-action-banner {
          background: #c98290;
          border-color: rgba(255, 255, 255, 0.28);
          box-shadow:
            0 28px 62px -28px rgba(54, 14, 23, 0.82),
            0 18px 32px -22px rgba(0, 0, 0, 0.68),
            inset 0 1px 0 rgba(255, 255, 255, 0.2);
        }
        .doro-focus-friend-action-banner .doro-group-banner-progress {
          background: rgba(255, 255, 255, 0.56);
        }
        .doro-focus-friend-action-banner .doro-group-banner-title {
          color: rgba(255, 255, 255, 0.62);
        }
        .doro-focus-friend-action-banner .doro-group-banner-message {
          color: rgba(255, 255, 255, 0.96);
          text-shadow: 0 1px 0 rgba(255, 255, 255, 0.12), 0 7px 16px rgba(72, 16, 27, 0.34);
        }
        .doro-focus-friend-action-banner .doro-group-banner-status {
          color: rgba(255, 255, 255, 0.72);
        }
        .doro-focus-friend-action-banner .doro-focus-friend-join-accept {
          background: rgba(255, 255, 255, 0.94);
          color: #22151a;
        }
        .doro-focus-friend-action-banner .doro-focus-friend-join-accept:hover {
          background: #ffffff;
        }
        .doro-focus-friend-action-banner .doro-focus-friend-join-decline {
          background: rgba(83, 24, 36, 0.18);
          border-color: rgba(255, 255, 255, 0.22);
          color: rgba(255, 255, 255, 0.86);
        }
        .doro-focus-friend-action-banner .doro-focus-friend-join-decline:hover {
          background: rgba(83, 24, 36, 0.28);
          border-color: rgba(255, 255, 255, 0.3);
          color: #ffffff;
        }
        .doro-encouragement-banner {
          animation: doroEncouragementBannerIn 620ms cubic-bezier(0.16, 1, 0.3, 1) both;
          box-shadow:
            0 34px 84px -20px rgba(76, 5, 25, 0.72),
            0 22px 46px -22px rgba(0, 0, 0, 0.72),
            0 10px 28px -16px rgba(190, 18, 60, 0.64),
            inset 0 1px 0 rgba(255, 255, 255, 0.18),
            inset 0 -24px 46px rgba(76, 5, 25, 0.3);
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
          inset: -58% -18%;
          z-index: 0;
          background: linear-gradient(100deg, transparent 0%, rgba(255, 255, 255, 0.25) 45%, transparent 66%);
          animation: doroEncouragementSheen 1250ms cubic-bezier(0.16, 1, 0.3, 1) 120ms both;
        }
        .doro-encouragement-heart {
          animation: doroEncouragementHeartBeat 1050ms ease-in-out 360ms infinite;
          fill: currentColor;
          filter:
            drop-shadow(0 0 9px rgba(255, 228, 230, 0.72))
            drop-shadow(0 8px 13px rgba(76, 5, 25, 0.42));
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
          animation: doroGroupBannerIn 360ms cubic-bezier(0.22, 1, 0.36, 1) both;
          will-change: transform, opacity, filter;
        }
        .doro-focus-streak-overlay {
          animation: doroFocusStreakOverlayIn 360ms cubic-bezier(0.22, 1, 0.36, 1) both;
          background: rgba(0, 0, 0, 0.42);
          will-change: opacity, backdrop-filter;
        }
        .doro-focus-streak-overlay.is-exiting {
          pointer-events: none;
          animation: doroFocusStreakOverlayOut ${FOCUS_STREAK_EXIT_MS}ms cubic-bezier(0.45, 0, 0.2, 1) forwards;
        }
        .doro-focus-streak-overlay.is-paused,
        .doro-focus-streak-overlay.is-paused *,
        .doro-focus-streak-overlay.is-paused *::before,
        .doro-focus-streak-overlay.is-paused *::after {
          animation-play-state: paused !important;
        }
        .doro-focus-streak-card {
          width: min(78vw, 24rem);
          aspect-ratio: 1 / 1;
          animation: doroFocusStreakCardIn 620ms cubic-bezier(0.16, 0.92, 0.28, 1.08) both;
          background:
            radial-gradient(circle at 50% 16%, rgba(255,255,255,0.14), transparent 38%),
            linear-gradient(145deg, rgba(255,255,255,0.145), rgba(255,255,255,0.06)),
            rgba(255,255,255,0.075);
          box-shadow:
            0 44px 100px -42px rgba(0,0,0,0.94),
            0 26px 52px -30px rgba(0,0,0,0.78),
            inset 0 1px 0 rgba(255,255,255,0.16),
            inset 0 -34px 68px rgba(0,0,0,0.11);
          transform-origin: center;
          will-change: transform, opacity, filter;
        }
        .doro-focus-streak-overlay.is-exiting .doro-focus-streak-card {
          animation: doroFocusStreakCardOut ${FOCUS_STREAK_EXIT_MS}ms cubic-bezier(0.45, 0, 0.2, 1) forwards;
        }
        .doro-focus-streak-card:not(.no-blur) {
          backdrop-filter: blur(22px) saturate(1.18);
          -webkit-backdrop-filter: blur(22px) saturate(1.18);
        }
        .doro-focus-streak-card::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          pointer-events: none;
          box-shadow:
            inset 0 0 0 1px rgba(255,255,255,0.12),
            inset 0 0 58px rgba(255,255,255,0.045);
        }
        .doro-focus-streak-fire-field {
          position: absolute;
          inset: 0;
          z-index: 36;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          border-radius: inherit;
          opacity: 0;
          animation: doroFocusStreakFireReveal 2200ms cubic-bezier(0.16, 1, 0.3, 1) 620ms both;
          mix-blend-mode: normal;
          pointer-events: none;
          transform-origin: center;
          will-change: opacity, transform, filter;
        }
        .doro-focus-streak-fire-field::after {
          content: none;
        }
        .doro-focus-streak-fire {
          position: relative;
          z-index: 1;
          width: 100%;
          height: 100%;
          transform: translate3d(0, 0, 0) scale(1.34);
          transform-origin: center;
          mix-blend-mode: screen;
        }
        .doro-focus-streak-fire svg {
          display: block;
          width: 100% !important;
          height: 100% !important;
          overflow: hidden;
        }
        .doro-focus-streak-label {
          position: relative;
          z-index: 40;
          animation: doroFocusStreakLabelIn 520ms cubic-bezier(0.22, 1, 0.36, 1) 3060ms both;
          text-shadow: 0 12px 22px rgba(0,0,0,0.46);
        }
        .doro-focus-streak-content {
          width: min(100%, 19rem);
          padding: 2.2rem 1.35rem 1.45rem;
        }
        .doro-focus-streak-number {
          position: relative;
          z-index: 10;
          isolation: isolate;
          overflow: visible;
          animation:
            doroFocusStreakNumberReveal 1120ms cubic-bezier(0.16, 1, 0.3, 1) 1360ms both;
          color: rgba(238,244,250,0.94);
          font-variant-numeric: tabular-nums;
          transform-origin: center;
          text-shadow:
            0 2px 0 rgba(255,255,255,0.12),
            0 13px 24px rgba(0,0,0,0.44);
          will-change: transform, opacity, filter;
        }
        .doro-focus-streak-number-value {
          position: relative;
          z-index: 2;
          display: block;
          color: rgba(248,250,252,0.98);
        }
        .doro-focus-streak-number-shine,
        .doro-focus-streak-number-shine-soft {
          position: absolute;
          inset: 0;
          display: block;
          pointer-events: none;
          color: transparent;
          -webkit-text-fill-color: transparent;
          -webkit-background-clip: text;
          background-clip: text;
          background-repeat: no-repeat;
          mix-blend-mode: screen;
        }
        .doro-focus-streak-number-shine {
          z-index: 4;
          opacity: 0;
          background-image:
            linear-gradient(
              106deg,
              rgba(255,255,255,0) 0%,
              rgba(255,255,255,0) 36%,
              rgba(255,255,255,0.18) 42%,
              rgba(255,255,255,0.98) 48%,
              rgba(255,246,203,0.96) 51%,
              rgba(255,255,255,0.92) 54%,
              rgba(255,255,255,0.16) 60%,
              rgba(255,255,255,0) 68%,
              rgba(255,255,255,0) 100%
            );
          background-size: 245% 100%;
          background-position: 142% 50%;
          filter: drop-shadow(0 0 0.45rem rgba(255,255,255,0.22));
          animation: doroFocusStreakNumberShine 1480ms cubic-bezier(0.16, 1, 0.3, 1) 3020ms both;
          will-change: background-position, opacity;
        }
        .doro-focus-streak-number-shine-soft {
          opacity: 0;
          z-index: 3;
          background-image:
            linear-gradient(
              112deg,
              rgba(255,255,255,0) 0%,
              rgba(255,255,255,0) 34%,
              rgba(255,255,255,0.3) 49%,
              rgba(255,255,255,0) 64%,
              rgba(255,255,255,0) 100%
            );
          background-size: 210% 100%;
          background-position: 120% 50%;
          animation:
            doroFocusStreakNumberShine 1560ms cubic-bezier(0.18, 0.84, 0.24, 1) 2980ms both,
            doroFocusStreakNumberSheenBreath 900ms ease-out 3200ms both;
          will-change: background-position, opacity;
        }
        .doro-focus-streak-number::before {
          content: none;
        }
        .doro-focus-streak-number::after {
          content: none;
        }
        .doro-focus-streak-moment-week {
          position: relative;
          z-index: 40;
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 0.34rem;
          width: min(100%, 18.25rem);
          margin-top: -0.12rem;
          animation: doroFocusStreakWeekIn 760ms cubic-bezier(0.16, 1, 0.3, 1) 3060ms both;
          transform-origin: center;
          will-change: transform, opacity, filter;
        }
        .doro-focus-streak-moment-day {
          display: flex;
          min-width: 0;
          flex-direction: column;
          align-items: center;
          gap: 0.26rem;
          opacity: 0;
          animation: doroFocusStreakDayIn 540ms cubic-bezier(0.16, 1, 0.3, 1) var(--doro-streak-day-delay, 3740ms) both;
          transform-origin: center;
          will-change: transform, opacity, filter;
        }
        .doro-focus-streak-moment-day-label {
          max-width: 100%;
          overflow: hidden;
          text-overflow: clip;
          white-space: nowrap;
          font-size: 0.49rem;
          font-weight: 900;
          line-height: 1;
          letter-spacing: 0.09em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.52);
          text-shadow: 0 7px 14px rgba(0,0,0,0.32);
        }
        .doro-focus-streak-moment-day-circle {
          display: flex;
          width: 1.72rem;
          height: 1.72rem;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.2);
          background: rgba(255,255,255,0.075);
          color: rgba(255,255,255,0.44);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.1);
          transform-origin: center;
        }
        .doro-focus-streak-moment-day-circle.is-active {
          border-color: rgba(253,224,71,0.48);
          background:
            radial-gradient(circle at 50% 28%, rgba(255,255,255,0.25), transparent 42%),
            linear-gradient(180deg, rgba(251,191,36,0.34), rgba(249,115,22,0.2));
          color: #fde68a;
        }
        .doro-focus-streak-moment-day-circle.is-frozen {
          border-color: rgba(147,197,253,0.5);
          background:
            radial-gradient(circle at 50% 26%, rgba(255,255,255,0.26), transparent 42%),
            linear-gradient(180deg, rgba(96,165,250,0.36), rgba(59,130,246,0.2));
          color: #bfdbfe;
        }
        .doro-focus-streak-moment-day-circle.is-today.is-active {
          animation: doroFocusStreakTodayIgnite 760ms cubic-bezier(0.16, 1, 0.3, 1) 3820ms both;
        }
        .doro-focus-streak-moment-day-circle.is-today.is-active svg {
          animation: doroFocusStreakTodayFlameIn 640ms cubic-bezier(0.16, 1, 0.3, 1) 3920ms both;
        }
        .doro-focus-streak-moment-day-circle svg {
          width: 0.94rem;
          height: 0.94rem;
          fill: currentColor;
          stroke-width: 2.45;
          filter: drop-shadow(0 4px 7px rgba(0,0,0,0.28));
        }
        .doro-focus-streak-glow {
          display: none;
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
            width: calc(100vw - 0.75rem);
            gap: 0.38rem;
          }
          .doro-daily-welcome-banner,
          .doro-encouragement-banner,
          .doro-group-banner {
            border-radius: 1rem !important;
            padding: 0.65rem 0.75rem !important;
          }
          .doro-focus-streak-card {
            width: min(86vw, 21rem);
            border-radius: 1.55rem !important;
          }
          .doro-focus-streak-number {
            font-size: clamp(5.5rem, 28vw, 8.25rem) !important;
          }
          .doro-focus-streak-content {
            width: min(100%, 17.5rem);
            padding: 1.85rem 1rem 1.25rem;
          }
          .doro-focus-streak-moment-week {
            width: min(100%, 16.35rem);
            gap: 0.24rem;
            margin-top: -0.05rem;
          }
          .doro-focus-streak-moment-day-label {
            font-size: 0.42rem;
            letter-spacing: 0.07em;
          }
          .doro-focus-streak-moment-day-circle {
            width: 1.48rem;
            height: 1.48rem;
          }
          .doro-focus-streak-moment-day-circle svg {
            width: 0.82rem;
            height: 0.82rem;
          }
          .doro-encouragement-banner {
            min-height: 2.55rem !important;
            padding: 0.56rem 0.68rem !important;
          }
          .doro-encouragement-content {
            gap: 0.45rem !important;
          }
          .doro-encouragement-text-3d {
            align-items: center !important;
            gap: 0.36rem !important;
            font-size: 0.78rem !important;
          }
          .doro-encouragement-actor {
            max-width: min(6.4rem, 28vw);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 0.55rem !important;
            letter-spacing: 0.12em !important;
          }
          .doro-encouragement-message {
            min-width: 0;
            font-size: 0.82rem !important;
          }
          .doro-encouragement-heart {
            width: 1.12rem;
            height: 1.12rem;
          }
          .doro-group-banner {
            padding: 0.62rem 0.72rem !important;
          }
          .doro-group-banner-content {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: center;
            column-gap: 0.55rem;
            text-align: left !important;
          }
          .doro-group-banner-title,
          .doro-group-banner-message,
          .doro-group-banner-status {
            grid-column: 1;
            min-width: 0;
          }
          .doro-group-banner-title {
            font-size: 0.56rem !important;
            letter-spacing: 0.12em !important;
            white-space: nowrap;
          }
          .doro-group-banner-message {
            margin-top: 0.18rem !important;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 0.78rem !important;
            line-height: 1.1 !important;
          }
          .doro-group-banner-status {
            margin-top: 0.22rem !important;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 0.64rem !important;
          }
          .doro-group-banner-actions {
            grid-column: 2;
            grid-row: 1 / span 3;
            margin-top: 0 !important;
            gap: 0.35rem !important;
          }
          .doro-group-banner-actions button {
            min-height: 1.9rem;
            gap: 0.25rem;
            border-radius: 0.55rem;
            padding-inline: 0.52rem;
            font-size: 0.56rem;
            letter-spacing: 0.08em;
            white-space: nowrap;
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
          .doro-daily-welcome-banner-exit,
          .doro-focus-streak-overlay,
          .doro-focus-streak-card,
          .doro-focus-streak-label,
          .doro-focus-streak-number,
          .doro-focus-streak-number-value,
          .doro-focus-streak-number-shine,
          .doro-focus-streak-number-shine-soft,
          .doro-focus-streak-number::before,
          .doro-focus-streak-number::after,
          .doro-focus-streak-moment-week,
          .doro-focus-streak-moment-day,
          .doro-focus-streak-moment-day-circle.is-today.is-active,
          .doro-focus-streak-moment-day-circle.is-today.is-active svg,
          .doro-focus-streak-fire-field,
          .doro-focus-streak-fire-field::after,
          .doro-focus-streak-glow {
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
          .doro-focus-streak-overlay.is-exiting {
            opacity: 0 !important;
            filter: none !important;
          }
          .doro-focus-streak-overlay.is-exiting .doro-focus-streak-card {
            opacity: 0 !important;
            transform: scale(0.98) !important;
            filter: none !important;
          }
          .doro-focus-streak-number::before,
          .doro-focus-streak-number::after {
            opacity: 0 !important;
          }
          .doro-focus-streak-moment-week,
          .doro-focus-streak-moment-day {
            opacity: 1 !important;
            transform: none !important;
            filter: none !important;
          }
        }
      `}</style>

      {focusStreakBanner && focusStreakSnapshot && shouldRenderFocusStreakMoment && (
        <div
          className={`doro-focus-streak-overlay fixed inset-0 z-[82] flex items-center justify-center p-4 ${
            focusStreakBanner.exiting ? 'is-exiting' : ''
          } ${notificationTimersActive ? '' : 'is-paused'}`}
        >
          <button
            type="button"
            key={focusStreakBanner.id}
            onClick={dismissFocusStreakBanner}
            aria-label={`Dismiss streak notification. Current streak ${focusStreakSnapshot.currentStreak}.`}
            className={`doro-focus-streak-card relative isolate flex flex-col items-center justify-center overflow-hidden rounded-[1.8rem] border border-white/[0.16] text-center text-white outline-none transition-[border-color,box-shadow,transform] duration-300 hover:border-white/24 focus-visible:ring-2 focus-visible:ring-white/45 ${
              settings.disableBlur ? 'no-blur bg-black/80' : ''
            }`}
          >
            <div className="doro-focus-streak-glow pointer-events-none absolute inset-[17%] z-0 rounded-full" />
            <div className="doro-focus-streak-fire-field">
              <StreakFlame className="doro-focus-streak-fire" delayMs={680} paused={!notificationTimersActive} />
            </div>
            <div className="doro-focus-streak-content relative flex flex-col items-center justify-center">
              <div className="doro-focus-streak-label text-[0.78rem] font-black uppercase leading-none tracking-[0.24em] text-white/64">
                Streak
              </div>
              <div
                className="doro-focus-streak-number mt-1 font-mono text-[clamp(6.75rem,22vw,10.75rem)] font-black leading-none tracking-[0] text-white"
                data-streak-value={focusStreakSnapshot.currentStreak}
              >
                <span className="doro-focus-streak-number-value">{focusStreakSnapshot.currentStreak}</span>
                <span className="doro-focus-streak-number-shine-soft" aria-hidden="true">{focusStreakSnapshot.currentStreak}</span>
                <span className="doro-focus-streak-number-shine" aria-hidden="true">{focusStreakSnapshot.currentStreak}</span>
              </div>
              <div className="doro-focus-streak-moment-week" aria-label="Last seven days of focus streak">
                {focusStreakSnapshot.rollingDays.map((day, index) => {
                  const isToday = day.dateKey === focusStreakSnapshot.todayDate;
                  return (
                    <div
                      key={day.dateKey}
                      className="doro-focus-streak-moment-day"
                      style={{
                        '--doro-streak-day-delay': `${3120 + index * 48}ms`,
                      } as React.CSSProperties}
                    >
                      <span className="doro-focus-streak-moment-day-label">{day.weekdayLabel}</span>
                      <span
                        className={`doro-focus-streak-moment-day-circle ${
                          day.status ? `is-${day.status}` : ''
                        } ${isToday ? 'is-today' : ''}`}
                        aria-label={`${day.weekdayLabel}: ${
                          day.status === 'active'
                            ? 'active streak day'
                            : day.status === 'frozen'
                              ? 'streak freeze'
                              : 'no streak'
                        }`}
                      >
                        {day.status && <Flame aria-hidden="true" />}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </button>
        </div>
      )}

      <div className="doro-notification-stack fixed top-4 left-1/2 -translate-x-1/2 z-[72] w-[min(92vw,42rem)] pointer-events-none flex flex-col gap-2">
        {dailyWelcomeBanner && (
          <button
            type="button"
            key={dailyWelcomeBanner.id}
            onClick={dismissDailyWelcomeBanner}
            aria-label="Dismiss welcome message"
            className={`doro-daily-welcome-banner doro-group-banner doro-focus-friend-action-banner pointer-events-auto isolate relative w-full overflow-hidden rounded-2xl border px-4 py-3 text-left outline-none transition-all duration-500 focus-visible:ring-2 focus-visible:ring-white/45 ${
              dailyWelcomeBanner.exiting ? 'doro-daily-welcome-banner-exit' : ''
            }`}
          >
            <div className="pointer-events-none absolute inset-0 opacity-60 bg-[radial-gradient(circle_at_12%_-12%,rgba(255,255,255,0.34),transparent_50%)]" />
            <div className="doro-group-banner-content relative z-10 min-w-0 text-center">
              <div className="doro-group-banner-title text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">
                Welcome Back
              </div>
              <div className="doro-group-banner-message mt-1 text-sm leading-snug text-white/95">
                {dailyWelcomeBanner.message}
              </div>
            </div>
            <div
              className="doro-group-banner-progress pointer-events-none absolute bottom-0 left-0 z-10 h-[2px] w-full bg-white/40"
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
          const isJoinRequestBanner = notice.focusFriendAction?.type === 'join-request' && !notice.focusFriendAction.readAt;
          const isFocusFriendBannerBusy = focusFriendJoinBusyId === notice.id;
          const hasTimedProgress = !notice.persistUntilDismissed && !shouldHoldFocusFriendJoinBanner(notice.focusFriendAction);
          const bannerMessage = notice.actorName.trim()
            ? (
                <>
                  <span className="font-bold">{notice.actorName}</span>{' '}{notice.message}
                </>
              )
            : notice.message;
          const focusFriendStatusClassName = notice.status === 'error'
            ? 'text-red-100/88'
            : notice.status === 'success'
              ? 'text-emerald-100/88'
              : 'text-white/62';

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
                className={`doro-encouragement-banner pointer-events-auto relative w-full min-h-[3.05rem] overflow-hidden rounded-xl border border-rose-100/28 px-4 py-2.5 text-left text-white outline-none transition-[border-color,box-shadow,transform] duration-300 hover:border-rose-50/50 focus-visible:ring-2 focus-visible:ring-rose-100/55 ${
                  settings.disableBlur
                    ? 'bg-red-950'
                    : 'bg-[linear-gradient(135deg,#7f1d1d_0%,#be123c_48%,#f43f5e_100%)]'
                } ${encouragementExitClass}`}
                style={{ animationDelay: `${i * 70}ms` }}
              >
                <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_9%_-18%,rgba(255,228,230,0.32),transparent_38%),radial-gradient(circle_at_96%_-12%,rgba(255,255,255,0.16),transparent_34%)]" />
                <div className="doro-encouragement-content relative z-10 flex min-w-0 items-center gap-2.5">
                  <Heart size={24} strokeWidth={2.35} className="doro-encouragement-heart shrink-0 text-rose-50" aria-hidden="true" />
                  <span className="doro-encouragement-text-3d min-w-0 flex flex-1 items-baseline gap-2 overflow-hidden whitespace-nowrap text-[0.95rem] font-black leading-none text-white">
                    <span className="doro-encouragement-actor shrink-0 text-[10px] font-black uppercase leading-none tracking-[0.18em] text-rose-100/78">
                      {notice.actorName}
                    </span>
                    <span className="doro-encouragement-message min-w-0 truncate">
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
              role={notice.dismissOnClick ? 'button' : undefined}
              tabIndex={notice.dismissOnClick ? 0 : undefined}
              onClick={notice.dismissOnClick ? () => dismissBanner(notice.id, 'pop') : undefined}
              onKeyDown={notice.dismissOnClick ? (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                dismissBanner(notice.id, 'pop');
              } : undefined}
              aria-label={notice.dismissOnClick ? `Dismiss ${notice.title}: ${notice.message}` : undefined}
              className={`doro-group-banner pointer-events-auto isolate relative overflow-hidden rounded-2xl border px-4 py-3 shadow-[0_20px_45px_-28px_rgba(15,23,42,0.9)] transition-all duration-500 ${
                notice.tone === 'join'
                  ? 'border-emerald-200/40 bg-emerald-300/12'
                  : notice.tone === 'friend'
                    ? 'doro-focus-friend-action-banner'
                  : 'border-white/25 bg-white/10'
              } ${settings.disableBlur || notice.tone === 'friend' ? '' : 'backdrop-blur-2xl'} ${
                notice.exiting ? 'opacity-0 -translate-y-2 scale-[0.985]' : 'opacity-100 translate-y-0 scale-100'
              } ${notice.dismissOnClick ? 'cursor-pointer outline-none hover:-translate-y-[1px] hover:border-white/35 hover:bg-white/[0.13] focus-visible:ring-2 focus-visible:ring-white/45' : ''}`}
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <div className="pointer-events-none absolute inset-0 opacity-60 bg-[radial-gradient(circle_at_12%_-12%,rgba(255,255,255,0.34),transparent_50%)]" />
              <div className="doro-group-banner-content relative z-10 min-w-0 text-center">
                <div className="doro-group-banner-title text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">
                  {notice.title}
                </div>
                <div className="doro-group-banner-message mt-1 text-sm leading-snug text-white/95">
                  {bannerMessage}
                </div>
                {notice.statusMessage && (
                  <div className={`doro-group-banner-status mt-2 text-[11px] font-semibold leading-tight ${focusFriendStatusClassName}`}>
                    {notice.statusMessage}
                  </div>
                )}
                {isJoinRequestBanner && notice.status !== 'working' && notice.status !== 'success' && (
                  <div className="doro-group-banner-actions relative z-10 mt-3 flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleApproveFocusFriendJoinBanner(notice.focusFriendAction!, notice.id)}
                      disabled={Boolean(focusFriendJoinBusyId)}
                      className="doro-focus-friend-join-accept pointer-events-auto inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-white/18 bg-white text-slate-950 px-3 text-[10px] font-black uppercase tracking-[0.14em] transition-[transform,background-color,border-color,opacity] duration-200 hover:-translate-y-[1px] hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Check size={13} strokeWidth={2.5} aria-hidden="true" />
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeclineFocusFriendJoinBanner(notice.focusFriendAction!, notice.id)}
                      disabled={Boolean(focusFriendJoinBusyId)}
                      className="doro-focus-friend-join-decline pointer-events-auto inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-white/14 bg-white/[0.08] px-3 text-[10px] font-black uppercase tracking-[0.14em] text-white/82 transition-[transform,background-color,border-color,color,opacity] duration-200 hover:-translate-y-[1px] hover:border-white/22 hover:bg-white/[0.12] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <X size={13} strokeWidth={2.5} aria-hidden="true" />
                      No
                    </button>
                  </div>
                )}
                {isFocusFriendBannerBusy && !notice.statusMessage && (
                  <div className="mt-2 text-[11px] font-semibold leading-tight text-white/62">
                    Working...
                  </div>
                )}
              </div>
              {hasTimedProgress && (
                <div
                  className={`doro-group-banner-progress pointer-events-none absolute bottom-0 left-0 z-10 h-[2px] w-full ${
                    notice.tone === 'join' ? 'bg-emerald-100/55' : notice.tone === 'friend' ? 'bg-sky-100/55' : 'bg-white/45'
                  }`}
                  style={progressStyle}
                />
              )}
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
                <div className="flex w-full flex-col items-center justify-center gap-4 xl:flex-row xl:items-center">
                  <TimerDisplay />
                  {groupStudyPanel && (
                    <GroupStudyGoalPanel
                      sessionConfig={groupStudyPanel.sessionConfig}
                      progress={groupStudyPanel.progress}
                      members={groupStudyPanel.members}
                      warning={groupStudyPanel.warning}
                      isPreview={groupStudyPanel.isPreview}
                      onSendEncouragement={(member, message) => sendGroupEncouragement(member.name, message, member.memberId)}
                    />
                  )}
                </div>
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
      <GraceModal preview={gracePreview} onPreviewClose={() => setGracePreview(null)} />
      <LogModal isOpen={showLogModal} onClose={() => setShowLogModal(false)} />
      <TaskViewModal isOpen={isScheduleOpen} onClose={() => setScheduleOpen(false)} />
      <WeeklySchedulePanel isOpen={isWeeklyScheduleOpen} onClose={() => setWeeklyScheduleOpen(false)} />
      <SummaryView />
    </div>
  );
};

export default Layout;
