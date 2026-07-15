

import React from 'react';
import { useTimer } from '../context/TimerContext';
import { getSessionPomoDisplay } from '../utils/pomodoroAccounting';

const SummaryView: React.FC = () => {
  const { showSummary, sessionStats, closeSummary } = useTimer();

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

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto overflow-x-hidden bg-black/72 backdrop-blur-xl animate-fade-in">
        <div className="relative z-10 flex min-h-full items-center justify-center px-3 py-5 sm:px-6 sm:py-8">
          <div className="w-full max-w-4xl overflow-hidden rounded-[1.8rem] border border-white/10 bg-[#0f0f11]/88 p-4 shadow-[0_32px_90px_-48px_rgba(0,0,0,0.92)] backdrop-blur-2xl sm:p-6 md:p-8 animate-slide-up">
          <button
            onClick={closeSummary}
            className="ml-auto flex h-10 items-center rounded-full border border-white/10 bg-white/[0.045] px-4 text-[10px] font-bold uppercase tracking-[0.14em] text-white/62 transition-colors hover:border-white/18 hover:bg-white/[0.075] hover:text-white"
          >
            Close
          </button>

          <div className="mx-auto mt-3 flex w-full flex-col items-center gap-6 sm:gap-7">
            <div className="text-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/42">Session Summary</div>
                <h1 className="mt-2 text-3xl font-bold leading-tight text-white sm:text-4xl md:text-5xl">
                    Session Complete
                </h1>
                <p className="mt-3 text-sm leading-relaxed text-white/48">Great work today.</p>
            </div>

            <div className="grid w-full grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                {statCards.map((card) => (
                    <div key={card.label} className="flex min-h-[7.5rem] flex-col justify-between rounded-[1.2rem] border border-white/10 bg-white/[0.045] px-4 py-4 shadow-[0_18px_34px_-30px_rgba(0,0,0,0.65)] sm:min-h-[8.25rem] sm:px-5">
                        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/38">{card.label}</span>
                        <span className={`font-sans text-[2.35rem] font-bold leading-none tabular-nums ${card.tone} md:text-[2.75rem]`}>
                          {card.value}
                        </span>
                    </div>
                ))}
            </div>

            {categoryEntries.length > 0 && (
                <div className="w-full rounded-[1.2rem] border border-white/8 bg-white/[0.03] px-4 py-4 sm:px-5">
                     <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/38">Focus Distribution</h3>
                     <div className="mt-3 flex gap-2.5 overflow-x-auto pb-1 scrollbar-hide sm:flex-wrap sm:overflow-visible sm:pb-0">
                          {categoryEntries.map(([name, mins]) => (
                              <div key={name} className="flex shrink-0 items-center gap-2 rounded-xl border border-white/8 bg-white/[0.045] px-3 py-2">
                                  <span className="max-w-[11rem] truncate text-sm font-semibold text-white">{name}</span>
                                  <span className="text-xs font-semibold text-white/48">{Math.round(mins as number)}m</span>
                              </div>
                         ))}
                     </div>
                </div>
            )}

            <button 
                onClick={closeSummary}
                className="mt-1 w-full rounded-xl border border-white/12 bg-white/12 px-5 py-3.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white transition-all hover:border-white/22 hover:bg-white/18 active:scale-[0.99] sm:w-auto sm:min-w-[14rem]"
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
