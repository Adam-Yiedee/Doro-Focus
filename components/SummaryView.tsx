

import React from 'react';
import { useTimer } from '../context/TimerContext';

const SummaryView: React.FC = () => {
  const { showSummary, sessionStats, closeSummary } = useTimer();

  if (!showSummary || !sessionStats) return null;

  const formatSummaryMinutes = (minutes: number) => {
    if (!Number.isFinite(minutes) || minutes <= 0) return '0';
    return `${Math.max(1, Math.round(minutes))}`;
  };

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto overflow-x-hidden bg-black animate-fade-in">
        <div className="absolute inset-0 z-0">
             <div className="absolute top-[-20%] left-[10%] h-[600px] w-[600px] rounded-full bg-blue-500/16 blur-[150px]" />
             <div className="absolute bottom-[-20%] right-[10%] h-[600px] w-[600px] rounded-full bg-purple-500/16 blur-[150px]" />
        </div>

        <div className="relative z-10 min-h-full px-4 py-5 sm:px-6 sm:py-6">
          <button
            onClick={closeSummary}
            className="sticky top-0 z-20 ml-auto flex h-11 items-center rounded-full border border-white/10 bg-black/45 px-4 text-[11px] font-bold uppercase tracking-[0.14em] text-white/72 backdrop-blur-md transition-colors hover:border-white/20 hover:bg-black/60 hover:text-white"
          >
            Close
          </button>

          <div className="mx-auto mt-4 flex w-full max-w-4xl flex-col items-center gap-6 sm:gap-8 md:gap-10 animate-slide-up">
            <div className="text-center space-y-3 sm:space-y-4">
                <h1 className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-bold text-white tracking-tighter drop-shadow-2xl">
                    Session Complete
                </h1>
                <p className="text-sm sm:text-base text-white/50 uppercase tracking-[0.26em] font-medium">Great Work Today</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 md:gap-6 w-full">
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-[1.5rem] sm:rounded-[2rem] p-4 sm:p-6 flex min-h-[9rem] sm:min-h-[11rem] xl:aspect-square flex-col items-center justify-center gap-2">
                    <span className="text-4xl md:text-5xl font-mono font-bold text-white">{formatSummaryMinutes(sessionStats.totalWorkMinutes)}</span>
                    <span className="text-[10px] md:text-xs uppercase tracking-widest text-white/50 text-center">Focus Mins</span>
                </div>
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-[1.5rem] sm:rounded-[2rem] p-4 sm:p-6 flex min-h-[9rem] sm:min-h-[11rem] xl:aspect-square flex-col items-center justify-center gap-2">
                    <span className="text-4xl md:text-5xl font-mono font-bold text-teal-200">{formatSummaryMinutes(sessionStats.totalBreakMinutes)}</span>
                    <span className="text-[10px] md:text-xs uppercase tracking-widest text-white/50 text-center">Break Mins</span>
                </div>
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-[1.5rem] sm:rounded-[2rem] p-4 sm:p-6 flex min-h-[9rem] sm:min-h-[11rem] xl:aspect-square flex-col items-center justify-center gap-2">
                    <span className="text-4xl md:text-5xl font-mono font-bold text-white">{sessionStats.pomosCompleted}</span>
                    <span className="text-[10px] md:text-xs uppercase tracking-widest text-white/50 text-center">Pomos</span>
                </div>
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-[1.5rem] sm:rounded-[2rem] p-4 sm:p-6 flex min-h-[9rem] sm:min-h-[11rem] xl:aspect-square flex-col items-center justify-center gap-2">
                    <span className="text-4xl md:text-5xl font-mono font-bold text-white">{sessionStats.tasksCompleted}</span>
                    <span className="text-[10px] md:text-xs uppercase tracking-widest text-white/50 text-center">Tasks Done</span>
                </div>
            </div>

            {/* Category Breakdown */}
            {Object.keys(sessionStats.categoryStats).length > 0 && (
                <div className="w-full max-w-2xl">
                     <h3 className="text-white/40 uppercase tracking-widest text-xs font-bold text-center mb-4">Focus Distribution</h3>
                     <div className="flex gap-3 sm:gap-4 flex-wrap justify-center">
                          {Object.entries(sessionStats.categoryStats).map(([name, mins]) => (
                              <div key={name} className="bg-white/10 rounded-xl px-4 py-2 border border-white/5">
                                  <span className="text-white font-bold">{name}</span>
                                  <span className="text-white/50 ml-2 text-sm">{Math.round(mins as number)}m</span>
                              </div>
                         ))}
                     </div>
                </div>
            )}

            <button 
                onClick={closeSummary}
                className="mb-3 mt-2 sm:mt-4 px-8 sm:px-12 py-4 sm:py-5 bg-white text-black rounded-full font-bold uppercase tracking-widest text-sm hover:scale-105 active:scale-95 transition-all shadow-[0_0_40px_-10px_rgba(255,255,255,0.5)] hover:shadow-[0_0_60px_-10px_rgba(255,255,255,0.8)]"
            >
                Start New Session
            </button>
          </div>
        </div>
    </div>
  );
};

export default SummaryView;
