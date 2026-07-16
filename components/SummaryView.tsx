

import React, { useMemo } from 'react';
import { BarChart3, CheckCircle2, Clock3, Coffee, ListChecks, RotateCcw, Trophy, X } from 'lucide-react';
import { useTimer } from '../context/TimerContext';
import { getSessionPomoDisplay } from '../utils/pomodoroAccounting';
import { DEFAULT_BREAK_SURFACE, DEFAULT_WORK_SURFACE, getMutedSurfaceColor } from '../utils/palette';

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

const SUMMARY_CONFETTI_COLORS = ['#FDE68A', '#F9A8D4', '#A7F3D0', '#93C5FD', '#C4B5FD', '#FDBA74', '#FCA5A5'];

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

const SummaryView: React.FC = () => {
  const { showSummary, sessionStats, closeSummary, activeMode, activeColor } = useTimer();
  const confettiPieces = useMemo(() => buildSummaryConfettiPieces(Date.now()), [showSummary]);

  if (!showSummary || !sessionStats) return null;

  const formatSummaryMinutes = (minutes: number) => {
    if (!Number.isFinite(minutes) || minutes <= 0) return '0';
    return `${Math.max(1, Math.round(minutes))}`;
  };
  const pomoDisplay = getSessionPomoDisplay(sessionStats);
  const statCards = [
    { label: 'Focus Minutes', value: formatSummaryMinutes(sessionStats.totalWorkMinutes), tone: 'text-white', icon: Clock3 },
    { label: 'Break Minutes', value: formatSummaryMinutes(sessionStats.totalBreakMinutes), tone: 'text-teal-200', icon: Coffee },
    { label: pomoDisplay.label, value: pomoDisplay.value, tone: 'text-white', icon: CheckCircle2 },
    { label: 'Tasks Done', value: sessionStats.tasksCompleted, tone: 'text-white', icon: ListChecks },
  ];
  const categoryEntries = Object.entries(sessionStats.categoryStats);
  const surfaceColor = activeMode === 'break'
    ? getMutedSurfaceColor(DEFAULT_BREAK_SURFACE, DEFAULT_BREAK_SURFACE)
    : getMutedSurfaceColor(activeColor, DEFAULT_WORK_SURFACE);
  const surfaceStyle = { backgroundColor: surfaceColor };
  const raisedCardClass = 'doro-summary-raised-card doro-summary-item-in rounded-[1.2rem] border border-white/[0.08] bg-white/[0.055] shadow-[0_24px_54px_-34px_rgba(0,0,0,0.86),inset_0_1px_0_rgba(255,255,255,0.035)] transition-[transform,box-shadow,background-color] duration-300 ease-out hover:-translate-y-1 hover:bg-white/[0.075] hover:shadow-[0_34px_66px_-34px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.045)]';
  const compactButtonClass = 'inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.055] px-3.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/62 shadow-[0_18px_36px_-28px_rgba(0,0,0,0.76)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/[0.085] hover:text-white hover:shadow-[0_24px_44px_-28px_rgba(0,0,0,0.82)] active:translate-y-0 active:scale-95';
  const primaryButtonClass = 'doro-summary-item-in mt-1 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.10] bg-white/12 px-5 py-3.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_24px_48px_-32px_rgba(0,0,0,0.86),inset_0_1px_0_rgba(255,255,255,0.045)] transition-all duration-300 hover:-translate-y-1 hover:bg-white/18 hover:shadow-[0_32px_56px_-32px_rgba(0,0,0,0.92)] active:translate-y-0 active:scale-[0.99] sm:w-auto sm:min-w-[14rem]';

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
              transform: translateY(32px) scale(0.94);
              filter: blur(8px) saturate(0.9);
            }
            62% {
              opacity: 1;
              transform: translateY(-5px) scale(1.018);
              filter: blur(0) saturate(1.045);
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
              transform: translateY(18px) scale(0.94);
              filter: blur(5px) saturate(0.92);
            }
            64% {
              opacity: 1;
              transform: translateY(-2px) scale(1.016);
              filter: blur(0) saturate(1.04);
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
              transform: translateY(14px) scale(0.968);
              filter: blur(4px);
            }
            66% {
              opacity: 1;
              transform: translateY(-1px) scale(1.006);
              filter: blur(0);
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
            animation: doroSummaryPanelIn 560ms cubic-bezier(0.16, 0.92, 0.28, 1.08) both;
            transform-origin: center;
            will-change: transform, opacity, filter;
          }
          .doro-summary-title-in {
            animation: doroSummaryTitleIn 560ms cubic-bezier(0.16, 0.92, 0.28, 1.08) 80ms both;
            transform-origin: center;
            will-change: transform, opacity, filter;
          }
          .doro-summary-item-in {
            animation: doroSummaryItemIn 460ms cubic-bezier(0.18, 0.9, 0.32, 1.08) both;
            animation-delay: var(--doro-summary-delay, 0ms);
            transform-origin: center;
            will-change: transform, opacity, filter;
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
          <button
            onClick={closeSummary}
            className={`doro-summary-item-in ml-auto ${compactButtonClass}`}
            style={{ ['--doro-summary-delay' as any]: '120ms' }}
          >
            <X size={14} strokeWidth={2.4} />
            Close
          </button>

          <div className="mx-auto mt-3 flex w-full flex-col items-center gap-6 sm:gap-7">
            <div className="doro-summary-title-in text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.10] bg-white/[0.075] text-white shadow-[0_24px_48px_-32px_rgba(0,0,0,0.86),inset_0_1px_0_rgba(255,255,255,0.07)]">
                  <Trophy size={24} strokeWidth={2.3} />
                </div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/42">Session Wrap</div>
                <h1 className="text-3xl font-bold leading-tight text-white sm:text-4xl md:text-5xl">
                    Session Complete
                </h1>
                <p className="mt-3 text-sm leading-relaxed text-white/48">Great work today.</p>
            </div>

            <div className="grid w-full grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                {statCards.map((card, index) => {
                  const Icon = card.icon;
                  return (
                    <div
                      key={card.label}
                      className={`flex min-h-[7.5rem] flex-col items-center justify-center gap-3 px-3 py-4 text-center sm:min-h-[8.25rem] sm:px-5 ${raisedCardClass}`}
                      style={{ ['--doro-summary-delay' as any]: `${170 + index * 48}ms` }}
                    >
                        <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.07] text-white/72 shadow-[0_16px_30px_-24px_rgba(0,0,0,0.78)]">
                          <Icon size={16} strokeWidth={2.4} />
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/38">{card.label}</span>
                        <span className={`font-sans text-[2.35rem] font-bold leading-none tabular-nums ${card.tone} md:text-[2.75rem]`}>
                          {card.value}
                        </span>
                    </div>
                  );
                })}
            </div>

            {categoryEntries.length > 0 && (
                <div className={`w-full px-4 py-4 sm:px-5 ${raisedCardClass}`} style={{ ['--doro-summary-delay' as any]: '370ms' }}>
                     <h3 className="flex items-center justify-center gap-2 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-white/38 sm:justify-start sm:text-left">
                       <BarChart3 size={14} strokeWidth={2.4} />
                       Focus Distribution
                     </h3>
                     <div className="mt-3 flex justify-center gap-2.5 overflow-x-auto pb-1 scrollbar-hide sm:flex-wrap sm:justify-start sm:overflow-visible sm:pb-0">
                          {categoryEntries.map(([name, mins], index) => (
                              <div
                                key={name}
                                className="doro-summary-item-in flex shrink-0 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.065] px-3 py-2 shadow-[0_16px_30px_-24px_rgba(0,0,0,0.74)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/[0.09] hover:shadow-[0_22px_38px_-24px_rgba(0,0,0,0.82)]"
                                style={{ ['--doro-summary-delay' as any]: `${420 + index * 42}ms` }}
                              >
                                  <span className="max-w-[11rem] truncate text-sm font-semibold text-white">{name}</span>
                                  <span className="text-xs font-semibold text-white/48">{Math.round(mins as number)}m</span>
                              </div>
                         ))}
                     </div>
                </div>
            )}

            <button 
                onClick={closeSummary}
                className={primaryButtonClass}
                style={{ ['--doro-summary-delay' as any]: '470ms' }}
            >
                <RotateCcw size={14} strokeWidth={2.5} />
                Start New Session
            </button>
          </div>
          </div>
          </div>
        </div>
    </div>
  );
};

export default SummaryView;
