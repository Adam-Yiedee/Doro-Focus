

import React, { useMemo } from 'react';
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
    { label: 'Focus Minutes', value: formatSummaryMinutes(sessionStats.totalWorkMinutes), tone: 'text-white' },
    { label: 'Break Minutes', value: formatSummaryMinutes(sessionStats.totalBreakMinutes), tone: 'text-teal-200' },
    { label: pomoDisplay.label, value: pomoDisplay.value, tone: 'text-white' },
    { label: 'Tasks Done', value: sessionStats.tasksCompleted, tone: 'text-white' },
  ];
  const categoryEntries = Object.entries(sessionStats.categoryStats);
  const surfaceColor = activeMode === 'break'
    ? getMutedSurfaceColor(DEFAULT_BREAK_SURFACE, DEFAULT_BREAK_SURFACE)
    : getMutedSurfaceColor(activeColor, DEFAULT_WORK_SURFACE);
  const surfaceStyle = { backgroundColor: surfaceColor };
  const raisedCardClass = 'doro-summary-raised-card rounded-[1.2rem] bg-white/[0.06] shadow-[0_24px_54px_-34px_rgba(0,0,0,0.86),inset_0_1px_0_rgba(255,255,255,0.035)] transition-[transform,box-shadow,background-color] duration-300 ease-out hover:-translate-y-1 hover:bg-white/[0.075] hover:shadow-[0_34px_66px_-34px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.045)]';

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto overflow-x-hidden animate-fade-in" style={surfaceStyle}>
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
            .doro-summary-raised-card {
              animation: none !important;
              transition: none !important;
            }
          }
        `}</style>
        <div className="relative z-10 flex min-h-full items-center justify-center px-3 py-5 sm:px-6 sm:py-8">
          <div className="w-full max-w-4xl overflow-hidden rounded-[1.8rem] p-4 shadow-[0_34px_96px_-48px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.16)] sm:p-6 md:p-8 animate-slide-up" style={surfaceStyle}>
          <button
            onClick={closeSummary}
            className="ml-auto flex h-10 items-center rounded-full bg-white/[0.055] px-4 text-[10px] font-bold uppercase tracking-[0.14em] text-white/62 shadow-[0_18px_36px_-28px_rgba(0,0,0,0.76)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/[0.085] hover:text-white hover:shadow-[0_24px_44px_-28px_rgba(0,0,0,0.82)]"
          >
            Close
          </button>

          <div className="mx-auto mt-3 flex w-full flex-col items-center gap-6 sm:gap-7">
            <div className="text-center">
                <h1 className="text-3xl font-bold leading-tight text-white sm:text-4xl md:text-5xl">
                    Session Complete
                </h1>
                <p className="mt-3 text-sm leading-relaxed text-white/48">Great work today.</p>
            </div>

            <div className="grid w-full grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                {statCards.map((card) => (
                    <div key={card.label} className={`flex min-h-[7.5rem] flex-col items-center justify-center gap-3 px-4 py-4 text-center sm:min-h-[8.25rem] sm:px-5 ${raisedCardClass}`}>
                        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/38">{card.label}</span>
                        <span className={`font-sans text-[2.35rem] font-bold leading-none tabular-nums ${card.tone} md:text-[2.75rem]`}>
                          {card.value}
                        </span>
                    </div>
                ))}
            </div>

            {categoryEntries.length > 0 && (
                <div className={`w-full px-4 py-4 sm:px-5 ${raisedCardClass}`}>
                     <h3 className="text-center text-[10px] font-bold uppercase tracking-[0.14em] text-white/38 sm:text-left">Focus Distribution</h3>
                     <div className="mt-3 flex justify-center gap-2.5 overflow-x-auto pb-1 scrollbar-hide sm:flex-wrap sm:justify-start sm:overflow-visible sm:pb-0">
                          {categoryEntries.map(([name, mins]) => (
                              <div key={name} className="flex shrink-0 items-center gap-2 rounded-xl bg-white/[0.07] px-3 py-2 shadow-[0_16px_30px_-24px_rgba(0,0,0,0.74)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/[0.09] hover:shadow-[0_22px_38px_-24px_rgba(0,0,0,0.82)]">
                                  <span className="max-w-[11rem] truncate text-sm font-semibold text-white">{name}</span>
                                  <span className="text-xs font-semibold text-white/48">{Math.round(mins as number)}m</span>
                              </div>
                         ))}
                     </div>
                </div>
            )}

            <button 
                onClick={closeSummary}
                className="mt-1 w-full rounded-xl bg-white/12 px-5 py-3.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_24px_48px_-32px_rgba(0,0,0,0.86)] transition-all duration-300 hover:-translate-y-1 hover:bg-white/18 hover:shadow-[0_32px_56px_-32px_rgba(0,0,0,0.92)] active:scale-[0.99] sm:w-auto sm:min-w-[14rem]"
            >
                Start New Session
            </button>
          </div>
          </div>
        </div>
    </div>
  );
};

export default SummaryView;
