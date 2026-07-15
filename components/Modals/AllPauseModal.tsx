
import React, { useState } from 'react';
import { useTimer } from '../../context/TimerContext';
import { DEFAULT_BREAK_SURFACE, DEFAULT_WORK_SURFACE, getMutedSurfaceColor } from '../../utils/palette';

// Helper for formatting duration
const formatDuration = (seconds: number) => {
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
};

const AllPauseModal: React.FC<{ onClose: () => void, isOpen: boolean }> = ({ onClose, isOpen }) => {
  const { confirmAllPause, activeMode, activeColor, endSession } = useTimer();
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

  const themeColor = activeMode === 'break' ? 'focus:shadow-[0_0_0_1px_rgba(94,234,212,0.22),0_24px_52px_-34px_rgba(45,212,191,0.45)]' : 'focus:shadow-[0_0_0_1px_rgba(251,113,133,0.24),0_24px_52px_-34px_rgba(251,113,133,0.45)]';
  const surfaceColor = activeMode === 'break'
    ? getMutedSurfaceColor(DEFAULT_BREAK_SURFACE, DEFAULT_BREAK_SURFACE)
    : getMutedSurfaceColor(activeColor, DEFAULT_WORK_SURFACE);
  const surfaceStyle = { backgroundColor: surfaceColor };
  const overlayClass = "fixed inset-0 z-50 flex items-center justify-center p-3 md:p-4 animate-fade-in";
  const panelClass = "w-full max-w-md overflow-hidden rounded-[1.75rem] p-6 shadow-[0_34px_90px_-44px_rgba(0,0,0,0.92),inset_0_1px_0_rgba(255,255,255,0.16)] md:p-8 animate-slide-up";
  const labelClass = "text-[10px] font-bold uppercase tracking-[0.18em] text-white/42";
  const raisedButtonClass = "rounded-xl bg-white/[0.065] px-4 py-3 text-[10px] font-bold uppercase tracking-[0.14em] shadow-[0_20px_42px_-30px_rgba(0,0,0,0.82),inset_0_1px_0_rgba(255,255,255,0.035)] transition-all duration-300 ease-out hover:-translate-y-1 hover:bg-white/[0.095] hover:shadow-[0_30px_54px_-30px_rgba(0,0,0,0.92),inset_0_1px_0_rgba(255,255,255,0.045)] active:translate-y-0 active:scale-[0.99]";
  const secondaryButtonClass = `${raisedButtonClass} text-white/62 hover:text-white`;
  const primaryButtonClass = `${raisedButtonClass} text-white bg-white/[0.10] hover:bg-white/[0.14]`;

  if (isConfirmingEnd) {
      return (
        <div className={overlayClass} style={surfaceStyle}>
          <div className="w-full max-w-sm overflow-hidden rounded-[1.6rem] p-6 shadow-[0_34px_90px_-44px_rgba(0,0,0,0.92),inset_0_1px_0_rgba(255,255,255,0.16)] md:p-7 animate-slide-up" style={surfaceStyle}>
            <div className="text-center">
              <div className={labelClass}>Confirm</div>
              <h3 className="mt-2 text-2xl font-bold text-white">End Work Session?</h3>
              <p className="mt-3 text-sm leading-relaxed text-white/46">This will clear completed tasks and reset timers.</p>
            </div>
            <div className="mt-6 flex gap-3 w-full">
              <button onClick={() => setIsConfirmingEnd(false)} className={`flex-1 ${secondaryButtonClass}`}>Back</button>
              <button onClick={handleEndSession} className="flex-1 rounded-xl bg-red-500/12 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-red-100/82 shadow-[0_20px_42px_-30px_rgba(127,29,29,0.95)] transition-all duration-300 hover:-translate-y-1 hover:bg-red-500/18 hover:text-red-100 hover:shadow-[0_30px_54px_-30px_rgba(127,29,29,0.95)] active:translate-y-0 active:scale-[0.99]">End Session</button>
            </div>
          </div>
        </div>
      );
  }

  return (
    <div className={overlayClass} style={surfaceStyle}>
      <div className={`${panelClass} flex flex-col gap-5`} style={surfaceStyle}>
        <div className="text-center">
          <div className={labelClass}>Pause Timer</div>
          <h3 className="mt-2 text-2xl font-bold text-white">Pause Session?</h3>
          <p className="mt-2 text-sm leading-relaxed text-white/46">Timer will stop completely.</p>
        </div>
        
        <input
          autoFocus
          type="text"
          placeholder="Reason (optional)"
          className={`w-full rounded-[1rem] bg-white/[0.095] px-4 py-3.5 text-center text-sm font-semibold text-white shadow-[0_22px_44px_-32px_rgba(0,0,0,0.82),inset_0_1px_0_rgba(255,255,255,0.06)] outline-none transition-all duration-300 placeholder:text-white/58 focus:-translate-y-0.5 focus:bg-white/[0.12] focus:placeholder:text-white/40 ${themeColor}`}
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
            className="mx-auto mt-1 min-h-10 rounded-full bg-red-500/[0.075] px-4 text-[10px] font-bold uppercase tracking-[0.14em] text-red-100/62 shadow-[0_18px_36px_-28px_rgba(127,29,29,0.75)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-red-500/12 hover:text-red-100/86 hover:shadow-[0_24px_44px_-28px_rgba(127,29,29,0.82)] md:min-h-0 md:py-2"
        >
            End Work Session
        </button>
      </div>
    </div>
  );
};

export const ResumeModal: React.FC = () => {
  const { allPauseActive, allPauseTime, resumeFromPause, activeMode, activeColor } = useTimer();

  if (!allPauseActive) return null;

  const mins = Math.floor(allPauseTime / 60);
  const secs = Math.floor(allPauseTime % 60);
  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

  const accentSurface = activeMode === 'break' ? 'bg-teal-300/[0.13]' : 'bg-rose-300/[0.13]';
  const accentText = 'text-white/82';
  const surfaceColor = activeMode === 'break'
    ? getMutedSurfaceColor(DEFAULT_BREAK_SURFACE, DEFAULT_BREAK_SURFACE)
    : getMutedSurfaceColor(activeColor, DEFAULT_WORK_SURFACE);
  const surfaceStyle = { backgroundColor: surfaceColor };
  const accentGlow = activeMode === 'break'
    ? 'hover:shadow-[0_34px_68px_-34px_rgba(20,184,166,0.42),0_30px_72px_-44px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.045)]'
    : 'hover:shadow-[0_34px_68px_-34px_rgba(244,63,94,0.38),0_30px_72px_-44px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.045)]';

  const addToBankAmount = allPauseTime / 5; 
  const deductFromBankAmount = allPauseTime;

  const buttonBaseClass = `
    group relative w-full overflow-hidden rounded-[1.35rem]
    bg-white/[0.065] px-5 py-5 backdrop-blur-xl
    text-center shadow-[0_24px_54px_-34px_rgba(0,0,0,0.86),inset_0_1px_0_rgba(255,255,255,0.035)]
    transition-all duration-300 ease-out
    hover:-translate-y-1.5 hover:bg-white/[0.085] ${accentGlow}
    active:translate-y-0 active:scale-[0.99]
    cursor-pointer
  `;

  const secondaryButtonClass = `
    mt-3 w-full rounded-full bg-white/[0.055] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em]
    text-white/52 shadow-[0_18px_36px_-28px_rgba(0,0,0,0.78)]
    transition-all duration-300 hover:-translate-y-1 hover:bg-white/[0.085] hover:text-white hover:shadow-[0_26px_46px_-28px_rgba(0,0,0,0.86)]
    active:translate-y-0 active:scale-[0.99]
  `;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 md:p-4 animate-fade-in" style={surfaceStyle}>
       <div className="w-full max-w-3xl overflow-hidden rounded-[1.8rem] p-5 shadow-[0_34px_90px_-44px_rgba(0,0,0,0.92),inset_0_1px_0_rgba(255,255,255,0.16)] md:p-8 animate-slide-up" style={surfaceStyle}>
         
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
                   className={buttonBaseClass}
                >
                    <div className={`pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 ${accentSurface}`} />
                    <div className="relative z-10 flex min-h-[5.9rem] flex-col items-center justify-center gap-3">
                        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/42">
                           Paused Time
                        </span>
                        <span className="text-xl font-bold leading-tight text-white">
                           I WAS WORKING
                        </span>
                        <span className={`rounded-full bg-white/[0.085] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] shadow-[0_14px_28px_-22px_rgba(0,0,0,0.8)] transition-all group-hover:bg-white/[0.11] ${accentText}`}>
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
                   className={buttonBaseClass}
                >
                    <div className={`pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 ${accentSurface}`} />
                    <div className="relative z-10 flex min-h-[5.9rem] flex-col items-center justify-center gap-3">
                        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/42">
                           Paused Time
                        </span>
                        <span className="text-xl font-bold leading-tight text-white">
                           I WAS RESTING
                        </span>
                        <span className={`rounded-full bg-white/[0.085] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] shadow-[0_14px_28px_-22px_rgba(0,0,0,0.8)] transition-all group-hover:bg-white/[0.11] ${accentText}`}>
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
