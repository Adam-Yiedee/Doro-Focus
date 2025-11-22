
import React from 'react';
import { useTimer } from '../context/TimerContext';

const SummaryView: React.FC = () => {
  const { showSummary, sessionStats, closeSummary } = useTimer();

  if (!showSummary || !sessionStats) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center p-6 animate-fade-in overflow-hidden">
        {/* Animated Background Elements */}
        <div className="absolute inset-0 z-0">
             <div className="absolute top-[-20%] left-[10%] w-[600px] h-[600px] bg-blue-500/20 rounded-full blur-[150px] animate-pulse" />
             <div className="absolute bottom-[-20%] right-[10%] w-[600px] h-[600px] bg-purple-500/20 rounded-full blur-[150px] animate-pulse" style={{ animationDelay: '2s' }} />
        </div>

        <div className="relative z-10 flex flex-col items-center gap-12 w-full max-w-4xl animate-slide-up">
            <div className="text-center space-y-4">
                <h1 className="text-6xl md:text-8xl font-bold text-white tracking-tighter drop-shadow-2xl">
                    Session Complete
                </h1>
                <p className="text-xl text-white/50 uppercase tracking-[0.3em] font-medium">Great Work Today</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 w-full">
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-[2rem] p-6 flex flex-col items-center justify-center gap-2 aspect-square">
                    <span className="text-4xl md:text-5xl font-mono font-bold text-white">{Math.floor(sessionStats.totalWorkMinutes)}</span>
                    <span className="text-[10px] md:text-xs uppercase tracking-widest text-white/50 text-center">Focus Mins</span>
                </div>
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-[2rem] p-6 flex flex-col items-center justify-center gap-2 aspect-square">
                    <span className="text-4xl md:text-5xl font-mono font-bold text-teal-200">{Math.floor(sessionStats.totalBreakMinutes)}</span>
                    <span className="text-[10px] md:text-xs uppercase tracking-widest text-white/50 text-center">Break Mins</span>
                </div>
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-[2rem] p-6 flex flex-col items-center justify-center gap-2 aspect-square">
                    <span className="text-4xl md:text-5xl font-mono font-bold text-white">{sessionStats.pomosCompleted}</span>
                    <span className="text-[10px] md:text-xs uppercase tracking-widest text-white/50 text-center">Pomos</span>
                </div>
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-[2rem] p-6 flex flex-col items-center justify-center gap-2 aspect-square">
                    <span className="text-4xl md:text-5xl font-mono font-bold text-white">{sessionStats.tasksCompleted}</span>
                    <span className="text-[10px] md:text-xs uppercase tracking-widest text-white/50 text-center">Tasks Done</span>
                </div>
            </div>

            <button 
                onClick={closeSummary}
                className="mt-8 px-12 py-5 bg-white text-black rounded-full font-bold uppercase tracking-widest text-sm hover:scale-105 active:scale-95 transition-all shadow-[0_0_40px_-10px_rgba(255,255,255,0.5)] hover:shadow-[0_0_60px_-10px_rgba(255,255,255,0.8)]"
            >
                Start New Session
            </button>
        </div>
    </div>
  );
};

export default SummaryView;
