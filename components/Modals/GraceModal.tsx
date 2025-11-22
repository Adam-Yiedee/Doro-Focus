import React, { useEffect, useState } from 'react';
import { useTimer } from '../../context/TimerContext';

const formatDuration = (seconds: number) => {
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
};

const GraceModal: React.FC = () => {
  const { graceOpen, graceTotal, graceContext, resolveGrace } = useTimer();
  const [showOptions, setShowOptions] = useState(false);

  // Reset local state when modal opens/closes
  useEffect(() => {
    if (graceOpen) {
        setShowOptions(false);
    }
  }, [graceOpen]);

  // Show options after 30 seconds
  useEffect(() => {
    if (graceOpen && graceTotal > 30 && !showOptions) {
        setShowOptions(true);
    }
  }, [graceTotal, graceOpen, showOptions]);

  if (!graceOpen) return null;

  const isAfterWork = graceContext === 'afterWork';

  // Visual Theme based on context
  const glowColor = isAfterWork ? 'shadow-red-500/20' : 'shadow-teal-500/20';
  const buttonHoverBorder = isAfterWork ? 'group-hover:border-red-400/40' : 'group-hover:border-teal-400/40';
  const gradientFrom = isAfterWork ? 'from-red-500/10' : 'from-teal-500/10';
  const accentText = isAfterWork ? 'text-red-200' : 'text-teal-200';

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

  // Button Styles: Added max-w-[12rem] to make them smaller
  const buttonBaseClass = `
    group relative w-full max-w-[12rem] aspect-square rounded-[2rem] overflow-hidden
    bg-white/5 backdrop-blur-xl border border-white/10
    flex flex-col items-center justify-center gap-2
    transition-all duration-500 ease-out
    hover:scale-[1.02] hover:bg-white/10 hover:shadow-2xl ${glowColor}
    active:scale-[0.98]
    cursor-pointer
  `;

  const secondaryButtonClass = `
    text-[10px] font-bold uppercase tracking-[0.2em] 
    text-white/40 hover:text-white transition-all duration-300
    py-3 px-4 rounded-full hover:bg-white/5 mt-2
  `;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xl animate-fade-in">
      <div className="w-full max-w-4xl flex flex-col items-center gap-8 animate-slide-up">
        
        {/* Header */}
        <h2 className="text-3xl md:text-5xl font-sans font-bold text-white tracking-tighter drop-shadow-2xl text-center mb-4">
          {isAfterWork ? "Session Complete" : "Break Ended"}
        </h2>

        {/* 2-Column Layout */}
        <div className="w-full grid grid-cols-2 gap-6 md:gap-12 px-4 md:px-12 justify-items-center">
          
          {/* Left Column: Work / Focus Actions */}
          <div className="flex flex-col items-center w-full">
             {/* Primary Button */}
             <button 
               onClick={showOptions ? handleWasWorking : () => resolveGrace('work')} 
               className={`${buttonBaseClass} ${buttonHoverBorder}`}
             >
                {/* Hover Gradient */}
                <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 bg-gradient-to-br ${gradientFrom} to-transparent`} />
                
                <div className="relative z-10 flex flex-col items-center text-center gap-2 px-4">
                    <span className="text-white font-bold text-lg md:text-xl tracking-tight uppercase leading-tight">
                       {showOptions ? "I WAS WORKING" : (isAfterWork ? "Continue Working" : "Start Focus")}
                    </span>
                    {showOptions && (
                      <span className={`text-[10px] font-bold uppercase tracking-widest opacity-60 group-hover:opacity-100 transition-opacity ${accentText}`}>
                        Add {formatDuration(addToBankAmount)}
                      </span>
                    )}
                </div>
             </button>

             {/* Secondary Button (Below) */}
             {showOptions && (
               <button onClick={() => resolveGrace('work')} className={secondaryButtonClass}>
                  {isAfterWork ? "Continue Working" : "Start Focus"}
               </button>
             )}
          </div>

          {/* Right Column: Break / Rest Actions */}
          <div className="flex flex-col items-center w-full">
             {/* Primary Button */}
             <button 
               onClick={showOptions ? handleWasResting : () => resolveGrace('break')} 
               className={`${buttonBaseClass} ${buttonHoverBorder}`}
             >
                 {/* Hover Gradient */}
                 <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 bg-gradient-to-br ${gradientFrom} to-transparent`} />

                <div className="relative z-10 flex flex-col items-center text-center gap-2 px-4">
                    <span className="text-white font-bold text-lg md:text-xl tracking-tight uppercase leading-tight">
                       {showOptions ? "I WAS RESTING" : (isAfterWork ? "Start Break" : "Continue Resting")}
                    </span>
                    {showOptions && (
                      <span className={`text-[10px] font-bold uppercase tracking-widest opacity-60 group-hover:opacity-100 transition-opacity ${accentText}`}>
                        Use {formatDuration(deductFromBankAmount)}
                      </span>
                    )}
                </div>
             </button>

             {/* Secondary Button (Below) */}
             {showOptions && (
                <button onClick={() => resolveGrace('break')} className={secondaryButtonClass}>
                   {isAfterWork ? "Start Break" : "Continue Resting"}
                </button>
             )}
          </div>

        </div>
      </div>
    </div>
  );
};

export default GraceModal;