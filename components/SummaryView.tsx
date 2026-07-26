

import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarDays, CheckCircle2, Clock3, Coffee, ListChecks, RotateCcw, TrendingUp, Trophy, X } from 'lucide-react';
import { useTimer } from '../context/TimerContext';
import { getSessionPomoDisplay } from '../utils/pomodoroAccounting';
import { DEFAULT_BREAK_SURFACE, DEFAULT_WORK_SURFACE, PASTEL_SWATCHES, getMutedSurfaceColor } from '../utils/palette';
import { playCelebrationTrumpet, playSummaryCountSound, playSummaryDistributionSound, playSummaryStatPop } from '../utils/sound';
import {
  formatSummaryDeltaValue,
  getSummaryPomoDeltaLabel,
  getSummaryPomoComparison,
} from '../utils/summaryComparisons';

type SummaryConfettiPiece = {
  id: number;
  left: number;
  top: number;
  size: number;
  color: string;
  shape: 'tile' | 'circle' | 'streamer';
  driftX: number;
  fallY: number;
  rotateDeg: number;
  durationMs: number;
  delayMs: number;
};

type SummaryCategorySegment = {
  name: string;
  minutes: number;
  share: number;
  color: string;
  radius: number;
  circumference: number;
  dash: number;
  offset: number;
  midAngle: number;
};

type SummaryStatCard = {
  label: string;
  value: string | number;
  helper?: string;
  accent: string;
  icon: typeof Clock3;
  valueClassName?: string;
};

const SUMMARY_CONFETTI_COLORS = ['#FDE68A', '#F9A8D4', '#A7F3D0', '#93C5FD', '#C4B5FD', '#FDBA74', '#FCA5A5'];
const SUMMARY_STAT_COLORS = [
  DEFAULT_WORK_SURFACE, // Focus minutes: default red/pink
  DEFAULT_BREAK_SURFACE, // Break minutes: default break teal/blue
  PASTEL_SWATCHES[5], // Pomos: green
  PASTEL_SWATCHES[2], // Tasks done: blue
  PASTEL_SWATCHES[4], // Last-focus comparison: purple
  PASTEL_SWATCHES[6], // Weekly-average comparison: gold
];
const SUMMARY_OTHER_CATEGORY_COLOR = '#94A3B8';
const SUMMARY_FIRST_STAT_DELAY_MS = 320;
const SUMMARY_STAT_RAISE_MS = 300;
const SUMMARY_STAT_SEQUENCE_GAP_MS = 150;
const SUMMARY_CATEGORY_SEQUENCE_GAP_MS = 220;
const SUMMARY_DISTRIBUTION_DRAW_MS = 720;
const SUMMARY_DISTRIBUTION_SEGMENT_GAP_MS = 210;
const SUMMARY_CELEBRATION_SOUND_GUARD_MS = 2000;
let lastSummaryCelebrationSoundAt = 0;
const summaryStatSoundGuards = new Map<string, number>();
const summaryDistributionSoundGuards = new Map<string, number>();

const buildSummaryConfettiPieces = (seed: number): SummaryConfettiPiece[] => (
  Array.from({ length: 58 }, (_, index) => {
    const shape: SummaryConfettiPiece['shape'] = index % 9 === 0 ? 'streamer' : index % 4 === 0 ? 'circle' : 'tile';
    return {
      id: index,
      left: ((index * 13.7) + (seed % 29)) % 100,
      top: -12 - ((index * 7) % 24),
      size: shape === 'streamer' ? 16 + (index % 4) * 3 : 6 + (index % 5),
      color: SUMMARY_CONFETTI_COLORS[index % SUMMARY_CONFETTI_COLORS.length],
      shape,
      driftX: ((index % 2 === 0 ? 1 : -1) * (42 + ((index * 19 + seed) % 132))),
      fallY: 112 + ((index * 11) % 28),
      rotateDeg: (index % 2 === 0 ? 1 : -1) * (220 + ((index * 47) % 520)),
      durationMs: 1900 + ((index * 67) % 1500),
      delayMs: (index % 13) * 42,
    };
  })
);

const summaryRgba = (color: string, alpha: number) => {
  const a = Math.max(0, Math.min(1, alpha));
  const value = color.trim();
  if (/^#([0-9a-f]{3})$/i.test(value)) {
    const hex = value.slice(1);
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  if (/^#([0-9a-f]{6})$/i.test(value)) {
    const hex = value.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return `rgba(255, 255, 255, ${a})`;
};

const formatSummaryDistributionMinutes = (minutes: number) => {
  const safeMinutes = Math.max(0, minutes);
  if (safeMinutes >= 120) return `${Math.round(safeMinutes / 60)}h`;
  if (safeMinutes >= 60) return `${(safeMinutes / 60).toFixed(1).replace(/\.0$/, '')}h`;
  return `${Math.max(1, Math.round(safeMinutes))}m`;
};

const formatSummaryDistributionPercent = (share: number) => `${Math.round(Math.max(0, share) * 100)}%`;

const shouldPlaySummaryStatSound = (key: string) => {
  if (typeof window === 'undefined') return false;

  const now = Date.now();
  summaryStatSoundGuards.forEach((playedAt, guardKey) => {
    if (now - playedAt > 5000) summaryStatSoundGuards.delete(guardKey);
  });

  const lastPlayedAt = summaryStatSoundGuards.get(key) || 0;
  if (now - lastPlayedAt < 1800) return false;
  summaryStatSoundGuards.set(key, now);
  return true;
};

const shouldPlaySummaryDistributionSound = (key: string) => {
  if (typeof window === 'undefined') return false;

  const now = Date.now();
  summaryDistributionSoundGuards.forEach((playedAt, guardKey) => {
    if (now - playedAt > 7000) summaryDistributionSoundGuards.delete(guardKey);
  });

  const lastPlayedAt = summaryDistributionSoundGuards.get(key) || 0;
  if (now - lastPlayedAt < 2400) return false;
  summaryDistributionSoundGuards.set(key, now);
  return true;
};

const easeInOutSine = (progress: number) => (
  0.5 - (Math.cos(Math.PI * Math.max(0, Math.min(1, progress))) / 2)
);

const getSummaryValuePrecision = (value: string | number) => {
  const text = String(value);
  const decimal = text.split('.')[1];
  return decimal ? decimal.length : 0;
};

const formatAnimatedSummaryValue = (value: number, finalValue: string | number) => {
  const precision = getSummaryValuePrecision(finalValue);
  if (precision > 0) return value.toFixed(precision).replace(/\.0+$/, '');
  return `${Math.round(value)}`;
};

const getSummaryCountDurationMs = (value: string | number) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return 260;

  const magnitude = Math.log10(Math.abs(numericValue) + 1);
  const precisionBoost = getSummaryValuePrecision(value) > 0 ? 160 : 0;
  return Math.round(Math.min(1480, Math.max(620, 520 + (magnitude * 300) + precisionBoost)));
};

const SummaryCountUpValue: React.FC<{
  value: string | number;
  className: string;
  style?: React.CSSProperties;
  revealDelayMs: number;
  delayMs: number;
  durationMs: number;
  soundIndex: number;
}> = ({ value, className, style, revealDelayMs, delayMs, durationMs, soundIndex }) => {
  const finalText = String(value);
  const finalNumber = Number(value);
  const countVelocity = Number.isFinite(finalNumber) && durationMs > 0
    ? Math.abs(finalNumber) / durationMs
    : 0;
  const shouldUseMotionBlur = countVelocity > 0.12;
  const [displayValue, setDisplayValue] = useState('0');
  const [isCounting, setIsCounting] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const soundKey = `${soundIndex}:${finalText}:${revealDelayMs}:${delayMs}:${durationMs}`;
    if (!shouldPlaySummaryStatSound(soundKey)) return;

    void playSummaryStatPop(revealDelayMs, soundIndex);
    if (Number.isFinite(finalNumber) && finalNumber > 0) {
      void playSummaryCountSound(finalNumber, durationMs, delayMs);
    }
  }, [delayMs, durationMs, finalNumber, finalText, revealDelayMs, soundIndex]);

  useEffect(() => {
    if (!Number.isFinite(finalNumber) || finalNumber <= 0) {
      setDisplayValue(finalText);
      setIsCounting(false);
      return;
    }

    if (
      typeof window === 'undefined'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setDisplayValue(finalText);
      setIsCounting(false);
      return;
    }

    let animationFrame = 0;
    const startAt = window.performance.now() + delayMs;

    const tick = (now: number) => {
      const elapsed = Math.max(0, now - startAt);
      const progress = Math.min(1, elapsed / durationMs);
      const easedProgress = easeInOutSine(progress);
      setIsCounting(progress > 0 && progress < 1);
      setDisplayValue(formatAnimatedSummaryValue(finalNumber * easedProgress, value));

      if (progress < 1) {
        animationFrame = window.requestAnimationFrame(tick);
        return;
      }

      setIsCounting(false);
      setDisplayValue(finalText);
    };

    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [delayMs, durationMs, finalNumber, finalText, value]);

  return (
    <span
      className={`${className} doro-summary-count-value ${isCounting ? 'is-counting' : ''} ${isCounting && shouldUseMotionBlur ? 'is-fast-counting' : ''}`}
      style={style}
    >
      {displayValue}
    </span>
  );
};

const SummaryDistributionSoundCue: React.FC<{
  soundKey: string;
  sharesKey: string;
  baseDelayMs: number;
  segmentGapMs: number;
  drawDurationMs: number;
}> = ({ soundKey, sharesKey, baseDelayMs, segmentGapMs, drawDurationMs }) => {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const guardKey = `${soundKey}:${sharesKey}:${baseDelayMs}:${segmentGapMs}:${drawDurationMs}`;
    if (!shouldPlaySummaryDistributionSound(guardKey)) return;

    const segments = sharesKey
      .split('|')
      .map((share) => ({ share: Number(share) }))
      .filter((segment) => Number.isFinite(segment.share));

    void playSummaryDistributionSound(segments, baseDelayMs, segmentGapMs, drawDurationMs);
  }, [baseDelayMs, drawDurationMs, segmentGapMs, sharesKey, soundKey]);

  return null;
};

const SummaryView: React.FC = () => {
  const { showSummary, sessionStats, closeSummary, activeMode, activeColor, pastSessions } = useTimer();
  const confettiPieces = useMemo(() => buildSummaryConfettiPieces(Date.now()), [showSummary]);
  const [activeSummaryCategoryName, setActiveSummaryCategoryName] = useState<string | null>(null);
  const [isSummaryCategoryChartHovered, setIsSummaryCategoryChartHovered] = useState(false);

  useEffect(() => {
    if (!showSummary || !sessionStats) return;

    const now = Date.now();
    if (now - lastSummaryCelebrationSoundAt < SUMMARY_CELEBRATION_SOUND_GUARD_MS) return;
    lastSummaryCelebrationSoundAt = now;
    void playCelebrationTrumpet();
  }, [showSummary, sessionStats]);

  useEffect(() => {
    if (!showSummary) return;
    setActiveSummaryCategoryName(null);
    setIsSummaryCategoryChartHovered(false);
  }, [showSummary]);

  if (!showSummary || !sessionStats) return null;

  const formatSummaryMinutes = (minutes: number) => {
    const safeMinutes = Number(minutes);
    if (!Number.isFinite(safeMinutes) || safeMinutes <= 0) return '0';
    if (safeMinutes < 1) return '<1';
    if (safeMinutes < 10) return safeMinutes.toFixed(1).replace(/\.0$/, '');
    return `${Math.round(safeMinutes)}`;
  };
  const pomoDisplay = getSessionPomoDisplay(sessionStats);
  const {
    previousDayDelta,
    previousDayTargetLabel,
    weeklyComparisonDays,
    weeklyAverageDelta,
  } = getSummaryPomoComparison({ pastSessions, sessionStats });

  const statCards: SummaryStatCard[] = [
    { label: 'Focus Minutes', value: formatSummaryMinutes(sessionStats.totalWorkMinutes), accent: SUMMARY_STAT_COLORS[0], icon: Clock3 },
    { label: 'Break Minutes', value: formatSummaryMinutes(sessionStats.totalBreakMinutes), accent: SUMMARY_STAT_COLORS[1], icon: Coffee },
    { label: pomoDisplay.label, value: pomoDisplay.value, accent: SUMMARY_STAT_COLORS[2], icon: CheckCircle2 },
    { label: 'Tasks Done', value: sessionStats.tasksCompleted, accent: SUMMARY_STAT_COLORS[3], icon: ListChecks },
    {
      label: getSummaryPomoDeltaLabel(previousDayDelta, previousDayTargetLabel),
      value: formatSummaryDeltaValue(previousDayDelta),
      accent: SUMMARY_STAT_COLORS[4],
      icon: CalendarDays,
    },
    {
      label: getSummaryPomoDeltaLabel(weeklyAverageDelta, 'Average'),
      value: weeklyComparisonDays.length > 0 ? formatSummaryDeltaValue(weeklyAverageDelta) : '0',
      accent: SUMMARY_STAT_COLORS[5],
      icon: TrendingUp,
    },
  ];
  let nextSummaryStatDelayMs = SUMMARY_FIRST_STAT_DELAY_MS;
  const statTimings = statCards.map((card) => {
    const revealDelayMs = nextSummaryStatDelayMs;
    const countDelayMs = revealDelayMs + SUMMARY_STAT_RAISE_MS;
    const countDurationMs = getSummaryCountDurationMs(card.value);
    nextSummaryStatDelayMs = countDelayMs + countDurationMs + SUMMARY_STAT_SEQUENCE_GAP_MS;
    return { revealDelayMs, countDelayMs, countDurationMs };
  });
  const focusDistributionDelayMs = nextSummaryStatDelayMs + SUMMARY_CATEGORY_SEQUENCE_GAP_MS;
  const focusDistributionSegmentBaseDelayMs = focusDistributionDelayMs + 260;
  const categoryEntries = Object.entries(sessionStats.categoryStats)
    .map(([name, minutes], index) => ({
      name: name || 'Uncategorized',
      minutes: Math.max(0, Number(minutes) || 0),
      color: name === 'Other'
        ? SUMMARY_OTHER_CATEGORY_COLOR
        : PASTEL_SWATCHES[index % PASTEL_SWATCHES.length],
    }))
    .filter((category) => category.minutes > 0)
    .sort((left, right) => right.minutes - left.minutes);
  const categoryTotalMinutes = categoryEntries.reduce((total, category) => total + category.minutes, 0);
  const categorySegments: SummaryCategorySegment[] = categoryTotalMinutes > 0
    ? (() => {
      const radius = 46;
      const circumference = 2 * Math.PI * radius;
      let cumulativeShare = 0;
      return categoryEntries.map((category) => {
        const share = category.minutes / categoryTotalMinutes;
        const startShare = cumulativeShare;
        const segment = {
          ...category,
          share,
          radius,
          circumference,
          dash: share * circumference,
          offset: -cumulativeShare * circumference,
          midAngle: ((startShare + (share / 2)) * Math.PI * 2) - (Math.PI / 2),
        };
        cumulativeShare += share;
        return segment;
      });
    })()
    : [];
  const distributionAnimationEndMs = focusDistributionSegmentBaseDelayMs
    + (Math.max(0, categorySegments.length - 1) * SUMMARY_DISTRIBUTION_SEGMENT_GAP_MS)
    + SUMMARY_DISTRIBUTION_DRAW_MS
    + 60;
  const categoryDistributionSoundKey = categorySegments
    .map((segment) => `${segment.name}:${Math.round(segment.minutes * 100)}`)
    .join('|');
  const categoryDistributionSharesKey = categorySegments
    .map((segment) => segment.share.toFixed(4))
    .join('|');
  const startButtonDelayMs = categorySegments.length > 0
    ? distributionAnimationEndMs + 140
    : focusDistributionDelayMs;
  const surfaceColor = activeMode === 'break'
    ? getMutedSurfaceColor(DEFAULT_BREAK_SURFACE, DEFAULT_BREAK_SURFACE)
    : getMutedSurfaceColor(activeColor, DEFAULT_WORK_SURFACE);
  const surfaceStyle = { backgroundColor: surfaceColor };
  const taskSurfaceClass = 'rounded-lg border border-white/[0.13] bg-white/[0.072] shadow-[0_26px_54px_-34px_rgba(0,0,0,0.78),inset_0_1px_0_rgba(255,255,255,0.065)] transform-gpu transition-[background-color,border-color,box-shadow,transform,color] duration-300 ease-out hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.12] hover:shadow-[0_34px_68px_-34px_rgba(0,0,0,0.92),inset_0_1px_0_rgba(255,255,255,0.085)]';
  const statCardClass = `relative flex h-full min-h-[8.7rem] overflow-hidden flex-col items-center justify-center gap-2.5 px-3 py-4 text-center sm:min-h-[9.25rem] sm:gap-3 sm:px-5 ${taskSurfaceClass}`;
  const sectionCardClass = `w-full px-4 py-4 sm:px-5 ${taskSurfaceClass}`;
  const compactButtonClass = `inline-flex h-10 items-center justify-center gap-2 px-3.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/62 hover:text-white active:translate-y-0 active:scale-95 ${taskSurfaceClass}`;
  const primaryButtonClass = `inline-flex min-h-12 w-full items-center justify-center gap-2 px-5 py-3.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/74 hover:text-white active:translate-y-0 active:scale-[0.99] sm:w-auto sm:min-w-[14rem] ${taskSurfaceClass}`;

  return (
    <div className="doro-summary-surface-in fixed inset-0 z-[100] overflow-y-auto overflow-x-hidden" style={surfaceStyle}>
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
          {confettiPieces.map((piece) => (
            <span
              key={piece.id}
              className={`doro-summary-confetti-piece absolute ${piece.shape === 'circle' ? 'is-circle' : piece.shape === 'streamer' ? 'is-streamer' : 'is-tile'}`}
              style={{
                left: `${piece.left}%`,
                top: `${piece.top}vh`,
                width: piece.shape === 'streamer' ? `${Math.max(3, Math.round(piece.size * 0.34))}px` : `${piece.size}px`,
                height: piece.shape === 'streamer' ? `${piece.size}px` : `${Math.max(5, Math.round(piece.size * 0.72))}px`,
                backgroundColor: piece.color,
                ['--doro-summary-confetti-drift' as any]: `${piece.driftX}px`,
                ['--doro-summary-confetti-fall' as any]: `${piece.fallY}vh`,
                ['--doro-summary-confetti-rotate' as any]: `${piece.rotateDeg}deg`,
                ['--doro-summary-confetti-duration' as any]: `${piece.durationMs}ms`,
                ['--doro-summary-confetti-delay' as any]: `${piece.delayMs}ms`,
              }}
            />
          ))}
        </div>
        <style>{`
          @keyframes doroSummarySurfaceIn {
            0% {
              opacity: 0;
              filter: saturate(0.94);
            }
            100% {
              opacity: 1;
              filter: saturate(1);
            }
          }
          @keyframes doroSummaryPanelIn {
            0% {
              opacity: 0;
              transform: translateY(24px) scale(0.965);
              filter: blur(7px) saturate(0.94);
            }
            100% {
              opacity: 1;
              transform: translateY(0) scale(1);
              filter: blur(0) saturate(1);
            }
          }
          @keyframes doroSummaryTitleIn {
            0% {
              opacity: 0;
              transform: translateY(14px) scale(0.975);
              filter: blur(4px) saturate(0.96);
            }
            100% {
              opacity: 1;
              transform: translateY(0) scale(1);
              filter: blur(0) saturate(1);
            }
          }
          @keyframes doroSummaryItemIn {
            0% {
              opacity: 0;
              transform: translateY(12px) scale(0.982);
              filter: blur(3px);
            }
            100% {
              opacity: 1;
              transform: translateY(0) scale(1);
              filter: blur(0);
            }
          }
          .doro-summary-surface-in {
            animation: doroSummarySurfaceIn 360ms cubic-bezier(0.22, 1, 0.36, 1) both;
          }
          .doro-summary-panel-in {
            animation: doroSummaryPanelIn 620ms cubic-bezier(0.22, 1, 0.36, 1) both;
            transform-origin: center;
            will-change: transform, opacity, filter;
          }
          .doro-summary-title-in {
            animation: doroSummaryTitleIn 620ms cubic-bezier(0.22, 1, 0.36, 1) 90ms both;
            transform-origin: center;
            will-change: transform, opacity, filter;
          }
          .doro-summary-item-in {
            animation: doroSummaryItemIn 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
            animation-delay: var(--doro-summary-delay, 0ms);
            transform-origin: center;
            will-change: transform, opacity, filter;
          }
          .doro-summary-count-value {
            display: inline-block;
            min-width: 2ch;
            transform-origin: center bottom;
            transition: filter 180ms ease, transform 260ms cubic-bezier(0.22, 1, 0.36, 1), text-shadow 260ms ease;
          }
          .doro-summary-count-value.is-counting {
            transform: translateY(-1px) scale(1.012);
            text-shadow: 0 10px 26px rgba(255, 255, 255, 0.12);
          }
          .doro-summary-count-value.is-fast-counting {
            filter: blur(0.48px);
            transform: translateY(-1px) skewX(-2deg) scale(1.018);
          }
          @keyframes doroSummaryDonutDraw {
            0% {
              opacity: 0;
              stroke-dasharray: 0 var(--doro-summary-donut-rest, 289);
            }
            62% {
              opacity: 1;
            }
            100% {
              opacity: 1;
              stroke-dasharray: var(--doro-summary-donut-dash, 0) var(--doro-summary-donut-rest, 289);
            }
          }
          @keyframes doroSummaryDonutCenterIn {
            0% {
              opacity: 0;
              transform: translateY(8px) scale(0.94);
              filter: blur(3px);
            }
            100% {
              opacity: 1;
              transform: translateY(0) scale(1);
              filter: blur(0);
            }
          }
          .doro-summary-donut-segment {
            animation: doroSummaryDonutDraw ${SUMMARY_DISTRIBUTION_DRAW_MS}ms cubic-bezier(0.18, 0.88, 0.26, 1) var(--doro-summary-donut-delay, 0ms) both;
            will-change: stroke-dasharray, opacity, filter;
            transition: opacity 360ms ease, stroke-width 420ms cubic-bezier(0.22, 1, 0.36, 1), filter 420ms cubic-bezier(0.22, 1, 0.36, 1);
          }
          .doro-summary-donut-center {
            animation: doroSummaryDonutCenterIn 440ms cubic-bezier(0.22, 1, 0.36, 1) var(--doro-summary-donut-center-delay, 0ms) both;
            transform-origin: center;
          }
          @keyframes doroSummaryConfettiFall {
            0% {
              opacity: 0;
              transform: translate3d(0, -10vh, 0) rotate(0deg) scale(0.72);
            }
            8% {
              opacity: 0.95;
            }
            44% {
              transform: translate3d(calc(var(--doro-summary-confetti-drift, 0px) * 0.42), 48vh, 0) rotate(calc(var(--doro-summary-confetti-rotate, 360deg) * 0.46)) scale(1);
            }
            100% {
              opacity: 0;
              transform: translate3d(var(--doro-summary-confetti-drift, 0px), var(--doro-summary-confetti-fall, 118vh), 0) rotate(var(--doro-summary-confetti-rotate, 360deg)) scale(0.82);
            }
          }
          .doro-summary-confetti-piece {
            border-radius: 2px;
            opacity: 0;
            filter: drop-shadow(0 8px 14px rgba(0, 0, 0, 0.18));
            animation: doroSummaryConfettiFall var(--doro-summary-confetti-duration, 2400ms) cubic-bezier(0.2, 0.76, 0.34, 1) var(--doro-summary-confetti-delay, 0ms) both;
          }
          .doro-summary-confetti-piece.is-circle {
            border-radius: 999px;
          }
          .doro-summary-confetti-piece.is-streamer {
            border-radius: 999px;
          }
          @media (prefers-reduced-motion: reduce) {
            .doro-summary-confetti-piece,
            .doro-summary-raised-card,
            .doro-summary-surface-in,
            .doro-summary-panel-in,
            .doro-summary-title-in,
            .doro-summary-donut-center,
            .doro-summary-donut-segment,
            .doro-summary-count-value,
            .doro-summary-item-in {
              animation: none !important;
              transition: none !important;
            }
          }
        `}</style>
        <div className="relative z-10 flex min-h-full items-center justify-center px-3 py-5 sm:px-6 sm:py-8">
          <div className="doro-summary-panel-in relative w-full max-w-4xl overflow-hidden rounded-[1.8rem] border border-white/[0.10] bg-white/[0.045] p-4 shadow-[0_34px_96px_-48px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-xl sm:p-6 md:p-8" style={surfaceStyle}>
          <div className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_1px_0_rgba(255,255,255,0.10),inset_0_0_50px_rgba(255,255,255,0.035)]" />
          <div className="relative z-10">
          <div
            className="doro-summary-item-in flex justify-end"
            style={{ ['--doro-summary-delay' as any]: '120ms' }}
          >
            <button onClick={closeSummary} className={compactButtonClass}>
              <X size={14} strokeWidth={2.4} />
              Close
            </button>
          </div>

          <div className="mx-auto mt-3 flex w-full flex-col items-center gap-6 sm:gap-7">
            <div className="doro-summary-title-in text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.10] bg-white/[0.075] text-white shadow-[0_24px_48px_-32px_rgba(0,0,0,0.86),inset_0_1px_0_rgba(255,255,255,0.07)]">
                  <Trophy size={24} strokeWidth={2.3} />
                </div>
                <h1 className="text-3xl font-bold leading-tight text-white sm:text-4xl md:text-5xl">
                    Session Complete
                </h1>
                <p className="mt-3 text-sm leading-relaxed text-white/48">Great work today.</p>
            </div>

            <div className="grid w-full grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
                {statCards.map((card, index) => {
                  const Icon = card.icon;
                  const timing = statTimings[index];
                  const valueClassName = card.valueClassName || 'text-[2.35rem] md:text-[2.75rem]';
                  return (
                    <div
                      key={card.label}
                      className="doro-summary-item-in"
                      style={{ ['--doro-summary-delay' as any]: `${timing.revealDelayMs}ms` }}
                    >
                      <div
                        className={statCardClass}
                        style={{
                          background: `linear-gradient(180deg, rgba(255,255,255,0.155), rgba(255,255,255,0.078)), ${summaryRgba(card.accent, 0.07)}`,
                          borderColor: 'rgba(255,255,255,0.16)',
                          boxShadow: `0 24px 54px -38px rgba(0,0,0,0.82), 0 10px 24px -22px ${summaryRgba(card.accent, 0.34)}, inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -22px 42px rgba(0,0,0,0.08)`,
                        }}
                      >
                        <span className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_48px_rgba(255,255,255,0.065),inset_0_-14px_30px_rgba(0,0,0,0.05)]" />
                        <span
                          className="relative z-10 flex h-8 w-8 items-center justify-center rounded-xl border shadow-[0_18px_34px_-24px_rgba(0,0,0,0.84)]"
                          style={{
                            color: '#ffffff',
                            backgroundColor: summaryRgba(card.accent, 0.34),
                            borderColor: 'rgba(255,255,255,0.2)',
                            boxShadow: `0 18px 34px -24px rgba(0,0,0,0.78), 0 8px 18px -12px ${summaryRgba(card.accent, 0.46)}, inset 0 1px 0 rgba(255,255,255,0.14)`,
                          }}
                        >
                          <Icon size={16} strokeWidth={2.4} />
                        </span>
                        <span
                          className="relative z-10 max-w-[11rem] text-center text-[11px] font-bold uppercase leading-snug tracking-[0.09em]"
                          style={{
                            color: '#ffffff',
                            textShadow: `0 1px 2px rgba(0,0,0,0.28), 0 8px 18px ${summaryRgba(card.accent, 0.18)}`,
                          }}
                        >
                          {card.label}
                        </span>
                        <SummaryCountUpValue
                          value={card.value}
                          revealDelayMs={timing.revealDelayMs}
                          delayMs={timing.countDelayMs}
                          durationMs={timing.countDurationMs}
                          soundIndex={index}
                          className={`relative z-10 font-sans font-bold leading-none tabular-nums ${valueClassName}`}
                          style={{
                            color: '#ffffff',
                            textShadow: `0 1px 2px rgba(0,0,0,0.22), 0 14px 30px ${summaryRgba(card.accent, 0.28)}, 0 0 20px rgba(255, 255, 255, 0.13)`,
                          }}
                        />
                        {card.helper && (
                          <span className="min-h-[1.75rem] max-w-[12rem] text-center text-[11px] font-semibold leading-snug text-white/52">
                            {card.helper}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>

            {categorySegments.length > 0 && (
                <div className="doro-summary-item-in w-full" style={{ ['--doro-summary-delay' as any]: `${focusDistributionDelayMs}ms` }}>
                  <div className={sectionCardClass}>
                     <SummaryDistributionSoundCue
                       soundKey={categoryDistributionSoundKey}
                       sharesKey={categoryDistributionSharesKey}
                       baseDelayMs={focusDistributionSegmentBaseDelayMs}
                       segmentGapMs={SUMMARY_DISTRIBUTION_SEGMENT_GAP_MS}
                       drawDurationMs={SUMMARY_DISTRIBUTION_DRAW_MS}
                     />
                     <h3 className="flex items-center justify-center gap-2 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-white/58 sm:justify-start sm:text-left">
                       <BarChart3 size={14} strokeWidth={2.4} />
                       Focus Distribution
                     </h3>
                     <div
                       className="mt-4 grid items-center gap-4 sm:grid-cols-[minmax(10rem,0.72fr)_1fr] sm:gap-5"
                       onMouseLeave={() => {
                         setActiveSummaryCategoryName(null);
                         setIsSummaryCategoryChartHovered(false);
                       }}
                     >
                        <div className="mx-auto flex w-full max-w-[13rem] items-center justify-center sm:max-w-[14rem]">
                          <div
                            className="relative aspect-square w-full overflow-visible rounded-full"
                            onMouseEnter={() => setIsSummaryCategoryChartHovered(true)}
                            onMouseLeave={() => {
                              setActiveSummaryCategoryName(null);
                              setIsSummaryCategoryChartHovered(false);
                            }}
                            style={{
                              transform: isSummaryCategoryChartHovered ? 'translate3d(0, -1.5px, 0)' : 'translate3d(0, 0, 0)',
                              filter: isSummaryCategoryChartHovered
                                ? 'drop-shadow(0 19px 25px rgba(0, 0, 0, 0.34))'
                                : 'drop-shadow(0 15px 21px rgba(0, 0, 0, 0.26))',
                              transition: 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1), filter 420ms cubic-bezier(0.22, 1, 0.36, 1)',
                            }}
                          >
                            <svg viewBox="-14 -14 148 148" className="h-full w-full overflow-visible">
                              <circle
                                cx="60"
                                cy="60"
                                r="46"
                                fill="none"
                                stroke="rgba(255,255,255,0.105)"
                                strokeWidth="16"
                              />
                              {categorySegments.map((segment, index) => {
                                const active = activeSummaryCategoryName === segment.name;
                                const dimmed = Boolean(activeSummaryCategoryName) && !active;
                                const dashGap = index === categorySegments.length - 1
                                  ? 0
                                  : Math.min(1.5, Math.max(0.45, segment.dash * 0.35));
                                const visibleDash = Math.max(0, segment.dash - dashGap);
                                const segmentDelayMs = focusDistributionSegmentBaseDelayMs + (index * SUMMARY_DISTRIBUTION_SEGMENT_GAP_MS);
                                const translateDistance = active
                                  ? (isSummaryCategoryChartHovered ? 3.2 : 2.4)
                                  : 0;
                                const translateX = Math.cos(segment.midAngle) * translateDistance;
                                const translateY = Math.sin(segment.midAngle) * translateDistance;

                                return (
                                  <g
                                    key={segment.name}
                                    transform={`translate(${translateX} ${translateY})`}
                                    style={{
                                      transition: 'transform 440ms cubic-bezier(0.22, 1, 0.36, 1)',
                                    }}
                                  >
                                    <circle
                                      cx="60"
                                      cy="60"
                                      r={segment.radius}
                                      fill="none"
                                      stroke={segment.color}
                                      strokeWidth={active ? 18 : 17}
                                      strokeLinecap="butt"
                                      strokeDasharray={`${visibleDash} ${segment.circumference}`}
                                      strokeDashoffset={segment.offset}
                                      transform="rotate(-90 60 60)"
                                      className="doro-summary-donut-segment cursor-pointer"
                                      style={{
                                        ['--doro-summary-donut-dash' as any]: visibleDash,
                                        ['--doro-summary-donut-rest' as any]: segment.circumference,
                                        ['--doro-summary-donut-delay' as any]: `${segmentDelayMs}ms`,
                                        opacity: active ? 1 : dimmed ? 0.68 : 0.9,
                                        filter: active
                                          ? `drop-shadow(0 10px 16px ${summaryRgba(segment.color, 0.42)})`
                                          : `drop-shadow(0 7px 13px ${summaryRgba(segment.color, 0.22)})`,
                                      }}
                                      onMouseEnter={() => setActiveSummaryCategoryName(segment.name)}
                                      onMouseLeave={() => setActiveSummaryCategoryName(null)}
                                    />
                                  </g>
                                );
                              })}
                            </svg>
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                              <div
                                className="doro-summary-donut-center text-center"
                                style={{ ['--doro-summary-donut-center-delay' as any]: `${distributionAnimationEndMs - 360}ms` }}
                              >
                                <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/42">Total</div>
                                <div className="mt-1 text-2xl font-bold leading-none text-white tabular-nums">
                                  {formatSummaryDistributionMinutes(categoryTotalMinutes)}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-2">
                          {categorySegments.map((segment, index) => {
                            const segmentDelayMs = focusDistributionSegmentBaseDelayMs + (index * SUMMARY_DISTRIBUTION_SEGMENT_GAP_MS);

                            return (
                              <div
                                key={segment.name}
                                className={`doro-summary-item-in flex min-w-0 items-center justify-between gap-3 px-3 py-2.5 ${taskSurfaceClass}`}
                                onMouseEnter={() => setActiveSummaryCategoryName(segment.name)}
                                onMouseLeave={() => setActiveSummaryCategoryName(null)}
                                style={{
                                  ['--doro-summary-delay' as any]: `${segmentDelayMs + 90}ms`,
                                  transform: activeSummaryCategoryName === segment.name
                                    ? 'translate3d(2px, -1px, 0)'
                                    : undefined,
                                  borderColor: summaryRgba(segment.color, activeSummaryCategoryName === segment.name ? 0.34 : 0.22),
                                  boxShadow: activeSummaryCategoryName === segment.name
                                    ? `0 28px 52px -32px rgba(0,0,0,0.86), 0 12px 26px -18px ${summaryRgba(segment.color, 0.58)}, inset 0 1px 0 rgba(255,255,255,0.08)`
                                    : `0 22px 42px -32px rgba(0,0,0,0.74), 0 10px 24px -22px ${summaryRgba(segment.color, 0.45)}, inset 0 1px 0 rgba(255,255,255,0.06)`,
                                }}
                              >
                                <div className="flex min-w-0 items-center gap-2.5">
                                  <span
                                    className="h-3 w-3 shrink-0 rounded-full shadow-[0_0_0_4px_rgba(255,255,255,0.045)]"
                                    style={{ backgroundColor: segment.color }}
                                  />
                                  <span className="truncate text-sm font-semibold text-white/88">{segment.name}</span>
                                </div>
                                <div className="shrink-0 text-right">
                                  <div className="text-xs font-bold text-white tabular-nums">{formatSummaryDistributionPercent(segment.share)}</div>
                                  <div className="mt-0.5 text-[11px] font-semibold text-white/46 tabular-nums">{formatSummaryDistributionMinutes(segment.minutes)}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                     </div>
                  </div>
                </div>
            )}

            <div
              className="doro-summary-item-in mt-1 w-full sm:w-auto"
              style={{ ['--doro-summary-delay' as any]: `${startButtonDelayMs}ms` }}
            >
              <button onClick={closeSummary} className={primaryButtonClass}>
                <RotateCcw size={14} strokeWidth={2.5} />
                Start New Session
              </button>
            </div>
          </div>
          </div>
          </div>
        </div>
    </div>
  );
};

export default SummaryView;
