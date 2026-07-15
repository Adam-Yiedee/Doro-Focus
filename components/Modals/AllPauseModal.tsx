
import React, { useState } from 'react';
import { useTimer } from '../../context/TimerContext';

// Helper for formatting duration
const formatDuration = (seconds: number) => {
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
};

const AllPauseModal: React.FC<{ onClose: () => void, isOpen: boolean }> = ({ onClose, isOpen }) => {
  const { confirmAllPause, activeMode, endSession } = useTimer();
  const [reason, setReason] = useState('');
  const [isConfirmingEnd, setIsConfirmingEnd] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = () => {
    confirmAllPause(reason);
    setReason('');
    onClose();
  };

  const handleEndSession = () => {
      endSession();
      onClose();
  };

  const themeColor = activeMode === 'break' ? 'text-teal-200 border-teal-500/30' : 'text-red-200 border-red-500/30';
  const overlayClass = "fixed inset-0 z-50 flex items-center justify-center p-3 md:p-4 bg-black/65 backdrop-blur-xl animate-fade-in";
  const panelClass = "w-full max-w-md overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#0f0f11]/88 p-6 shadow-[0_28px_70px_-42px_rgba(0,0,0,0.85)] backdrop-blur-2xl md:p-8 animate-slide-up";
  const labelClass = "text-[10px] font-bold uppercase tracking-[0.18em] text-white/42";
  const secondaryButtonClass = "rounded-xl border border-white/10 bg-white/[0.045] px-4 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/62 transition-all hover:border-white/18 hover:bg-white/[0.075] hover:text-white active:scale-[0.99]";
  const primaryButtonClass = "rounded-xl border border-white/12 bg-white/12 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white transition-all hover:border-white/22 hover:bg-white/18 active:scale-[0.99]";

  if (isConfirmingEnd) {
      return (
        <div className={overlayClass}>
          <div className="w-full max-w-sm overflow-hidden rounded-[1.6rem] border border-white/10 bg-[#0f0f11]/90 p-6 shadow-[0_28px_70px_-42px_rgba(0,0,0,0.85)] backdrop-blur-2xl md:p-7 animate-slide-up">
            <div className="text-center">
              <div className={labelClass}>Confirm</div>
              <h3 className="mt-2 text-2xl font-bold text-white">End Work Session?</h3>
              <p className="mt-3 text-sm leading-relaxed text-white/46">This will clear completed tasks and reset timers.</p>
            </div>
            <div className="mt-6 flex gap-3 w-full">
              <button onClick={() => setIsConfirmingEnd(false)} className={`flex-1 ${secondaryButtonClass}`}>Back</button>
              <button onClick={handleEndSession} className="flex-1 rounded-xl border border-red-400/24 bg-red-500/12 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-red-100/82 transition-all hover:border-red-300/30 hover:bg-red-500/18 hover:text-red-100 active:scale-[0.99]">End Session</button>
            </div>
          </div>
        </div>
      );
  }

  return (
    <div className={overlayClass}>
      <div className={`${panelClass} flex flex-col gap-5`}>
        <div className="text-center">
          <div className={labelClass}>Pause Timer</div>
          <h3 className="mt-2 text-2xl font-bold text-white">Pause Session?</h3>
          <p className="mt-2 text-sm leading-relaxed text-white/46">Timer will stop completely.</p>
        </div>
        
        <input
          autoFocus
          type="text"
          placeholder="Reason (optional)"
          className={`w-full rounded-[1rem] border bg-white/[0.045] px-4 py-3.5 text-center text-sm font-semibold text-white outline-none transition-all placeholder:text-white/24 focus:bg-white/[0.07] ${themeColor}`}
          value={reason}
          onChange={e => setReason(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleConfirm()}
        />
        
        <div className="flex gap-3 w-full">
          <button 
            onClick={onClose} 
            className={`flex-1 ${secondaryButtonClass}`}
          >
            Cancel
          </button>
          <button 
            onClick={handleConfirm} 
            className={`flex-1 ${primaryButtonClass}`}
          >
            Pause
          </button>
        </div>

        <button 
            onClick={() => setIsConfirmingEnd(true)}
            className="mx-auto mt-1 min-h-10 rounded-full border border-red-400/12 bg-red-500/[0.055] px-4 text-[10px] font-bold uppercase tracking-[0.14em] text-red-100/58 transition-all hover:border-red-400/22 hover:bg-red-500/10 hover:text-red-100/82 md:min-h-0 md:py-2"
        >
            End Work Session
        </button>
      </div>
    </div>
  );
};

export const ResumeModal: React.FC = () => {
  const { allPauseActive, allPauseTime, resumeFromPause, activeMode } = useTimer();

  if (!allPauseActive) return null;

  const mins = Math.floor(allPauseTime / 60);
  const secs = Math.floor(allPauseTime % 60);
  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

  const accentHoverBorder = activeMode === 'break' ? 'hover:border-teal-300/28' : 'hover:border-red-300/28';
  const accentSurface = activeMode === 'break' ? 'bg-teal-400/[0.08]' : 'bg-red-400/[0.08]';
  const accentText = activeMode === 'break' ? 'text-teal-200' : 'text-red-200';

  const addToBankAmount = allPauseTime / 5; 
  const deductFromBankAmount = allPauseTime;

  const buttonBaseClass = `
    group relative w-full overflow-hidden rounded-[1.35rem]
    border border-white/10 bg-white/[0.045] px-4 py-5 backdrop-blur-xl
    text-left transition-all duration-300 ease-out
    hover:-translate-y-[1px] hover:border-white/18 hover:bg-white/[0.075]
    active:translate-y-0 active:scale-[0.99]
    cursor-pointer
  `;

  const secondaryButtonClass = `
    mt-2 rounded-full px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em]
    text-white/48 transition-all duration-300 hover:bg-white/[0.055] hover:text-white
  `;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 md:p-4 bg-black/72 backdrop-blur-xl animate-fade-in">
       <div className="w-full max-w-3xl overflow-hidden rounded-[1.8rem] border border-white/10 bg-[#0f0f11]/88 p-5 shadow-[0_28px_80px_-44px_rgba(0,0,0,0.9)] backdrop-blur-2xl md:p-8 animate-slide-up">
         
         <div className="text-center">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/42">System Paused</div>
            <div className="mt-3 font-sans text-[4.75rem] font-bold leading-none text-white tabular-nums md:text-[6rem]">{timeStr}</div>
            <div className="mt-3 text-sm text-white/44">Choose how to treat the paused time.</div>
         </div>

         <div className="mt-7 grid w-full grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
             
             {/* Left: I Was Working */}
             <div className="flex flex-col items-center w-full">
                <button 
                   onClick={() => resumeFromPause('work', -addToBankAmount, 'work')}
                   className={`${buttonBaseClass} ${accentHoverBorder}`}
                >
                    <div className={`absolute inset-x-0 top-0 h-[3px] ${accentSurface}`} />
                    <div className="relative z-10 flex min-h-[5.4rem] flex-col justify-between gap-4">
                        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/42">
                           Paused Time
                        </span>
                        <span className="text-xl font-bold leading-tight text-white">
                           I WAS WORKING
                        </span>
                        <span className={`text-[10px] font-bold uppercase tracking-[0.14em] transition-opacity ${accentText}`}>
                            Add {formatDuration(addToBankAmount)}
                        </span>
                    </div>
                </button>
                <button 
                    onClick={() => resumeFromPause('work', 0)} 
                    className={secondaryButtonClass}
                >
                    Resume Work
                </button>
             </div>

             {/* Right: I Was Resting */}
             <div className="flex flex-col items-center w-full">
                <button 
                   onClick={() => resumeFromPause('break', deductFromBankAmount, 'break')}
                   className={`${buttonBaseClass} ${accentHoverBorder}`}
                >
                    <div className={`absolute inset-x-0 top-0 h-[3px] ${accentSurface}`} />
                    <div className="relative z-10 flex min-h-[5.4rem] flex-col justify-between gap-4">
                        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/42">
                           Paused Time
                        </span>
                        <span className="text-xl font-bold leading-tight text-white">
                           I WAS RESTING
                        </span>
                        <span className={`text-[10px] font-bold uppercase tracking-[0.14em] transition-opacity ${accentText}`}>
                            Use {formatDuration(deductFromBankAmount)}
                        </span>
                    </div>
                </button>
                <button 
                    onClick={() => resumeFromPause('break', 0)} 
                    className={secondaryButtonClass}
                >
                    Resume Break
                </button>
             </div>

         </div>
       </div>
    </div>
  );
};

export default AllPauseModal;
