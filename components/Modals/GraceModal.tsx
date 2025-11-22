
import React, { useEffect, useState } from 'react';
import { useTimer } from '../../context/TimerContext';

const formatDuration = (seconds: number) => {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `(${m}:${rem.toString().padStart(2, '0')})`;
};

const GraceModal: React.FC = () => {
  const { graceOpen, graceTotal, graceContext, resolveGrace } = useTimer();
  const [showOptions, setShowOptions] = useState(false);

  useEffect(() => {
    if (graceOpen) {
        setShowOptions(false);
    }
  }, [graceOpen]);

  // Reveal options after delay (simulating user settling in)
  useEffect(() => {
    if (graceOpen && graceTotal > 30 && !showOptions) {
        setShowOptions(true);
    }
  }, [graceTotal, graceOpen, showOptions]);

  if (!graceOpen) return null;

  const isAfterWork = graceContext === 'afterWork';
  
  const handleWasWorking = () => {
    const nextMode = isAfterWork ? 'break' : 'work';
    resolveGrace(nextMode, { adjustBreakBalance: -(graceTotal / 5) });
  };

  const handleWasResting = () => {
    const nextMode = isAfterWork ? 'break' : 'work';
    resolveGrace(nextMode, { adjustBreakBalance: graceTotal });
  };

  const addToBankAmount = graceTotal / 5;
  const deductFromBankAmount = graceTotal;

  const buttonClass = `
    group relative w-32 h-32 md:w-40 md:h-40 rounded-[1.5rem] overflow-hidden
    bg-white/5 backdrop-blur-2xl border border-white/10
    flex flex-col items-center justify-center gap-2
    transition-all duration-500 cubic-bezier(0.25, 0.8, 0.25, 1)
    hover:scale-105 hover:bg-white/10 hover:shadow-2xl
    hover:border-white/30 active:scale-95 cursor-pointer
  `;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-3xl flex flex-col items-center gap-10 animate-slide-up">
        
        {/* Header Area */}
        <div className="text-center space-y-2">
           <h2 className="text-3xl font-bold text-white/90 tracking-tight drop-shadow-lg">
             {isAfterWork ? "Session Complete" : "Break Complete"}
           </h2>
           <p className="text-[10px] uppercase tracking-[0.25em] text-white/40 font-bold">
              Waiting for input
           </p>
        </div>

        {/* Buttons Centered & Close */}
        <div className="flex flex-row items-center justify-center gap-6">
          
          {/* Button: Work */}
          <button 
            onClick={showOptions ? handleWasWorking : () => resolveGrace('work')} 
            className={`${buttonClass} shadow-[0_0_40px_-10px_rgba(248,113,113,0.2)] hover:shadow-[0_0_50px_-5px_rgba(248,113,113,0.4)]`}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            
            <div className="relative z-10 flex flex-col items-center text-center px-2">
                <span className="text-white font-bold text-xs md:text-sm tracking-widest uppercase">
                   {showOptions ? "I WAS WORKING" : (isAfterWork ? "CONTINUE WORKING" : "START FOCUS")}
                </span>
                
                {showOptions ? (
                  <span className="text-[10px] font-mono font-medium text-red-200/80 mt-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    Add {formatDuration(addToBankAmount)}
                  </span>
                ) : (
                  <div className="w-8 h-0.5 bg-white/20 rounded-full mt-2 group-hover:w-12 group-hover:bg-red-400 transition-all" />
                )}
            </div>
          </button>

          {/* Button: Rest */}
          <button 
            onClick={showOptions ? handleWasResting : () => resolveGrace('break')} 
            className={`${buttonClass} shadow-[0_0_40px_-10px_rgba(45,212,191,0.2)] hover:shadow-[0_0_50px_-5px_rgba(45,212,191,0.4)]`}
          >
             <div className="absolute inset-0 bg-gradient-to-br from-teal-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

            <div className="relative z-10 flex flex-col items-center text-center px-2">
                <span className="text-white font-bold text-xs md:text-sm tracking-widest uppercase">
                   {showOptions ? "I WAS RESTING" : (isAfterWork ? "START BREAK" : "CONTINUE RESTING")}
                </span>

                {showOptions ? (
                  <span className="text-[10px] font-mono font-medium text-teal-200/80 mt-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    Use {formatDuration(deductFromBankAmount)}
                  </span>
                ) : (
                  <div className="w-8 h-0.5 bg-white/20 rounded-full mt-2 group-hover:w-12 group-hover:bg-teal-400 transition-all" />
                )}
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default GraceModal;
