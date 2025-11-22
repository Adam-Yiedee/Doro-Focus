
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

  if (isConfirmingEnd) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xl animate-fade-in">
          <div className="w-full max-w-sm bg-[#1c1c1e] rounded-[2rem] shadow-2xl border border-white/10 p-8 flex flex-col items-center gap-6 animate-slide-up">
            <h3 className="text-xl font-bold text-white tracking-tight text-center">End Work Session?</h3>
            <p className="text-white/40 text-center text-xs">This will clear completed tasks and reset timers.</p>
            <div className="flex gap-4 w-full">
              <button onClick={() => setIsConfirmingEnd(false)} className="flex-1 py-3 text-white/50 hover:text-white rounded-xl text-xs font-bold uppercase tracking-wider">Back</button>
              <button onClick={handleEndSession} className="flex-1 py-3 bg-red-500/20 text-red-200 hover:bg-red-500/30 rounded-xl text-xs font-bold uppercase tracking-wider">End Session</button>
            </div>
          </div>
        </div>
      );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xl animate-fade-in">
      <div className="w-full max-w-md bg-white/5 backdrop-blur-2xl rounded-[2.5rem] shadow-2xl border border-white/10 p-10 flex flex-col items-center gap-6 animate-slide-up">
        <div className="text-center space-y-1">
          <h3 className="text-2xl font-bold text-white tracking-tight">Pause Session?</h3>
          <p className="text-white/40 text-xs uppercase tracking-widest">Timer will stop completely</p>
        </div>
        
        <input
          autoFocus
          type="text"
          placeholder="Reason (optional)"
          className={`w-full p-4 bg-black/20 border ${themeColor} rounded-2xl text-center text-white outline-none focus:bg-black/30 transition-all placeholder-white/20`}
          value={reason}
          onChange={e => setReason(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleConfirm()}
        />
        
        <div className="flex gap-4 w-full">
          <button 
            onClick={onClose} 
            className="flex-1 py-4 text-white/40 hover:text-white bg-white/5 hover:bg-white/10 rounded-2xl font-bold uppercase text-xs tracking-widest transition-all"
          >
            Cancel
          </button>
          <button 
            onClick={handleConfirm} 
            className="flex-1 py-4 text-white bg-white/10 hover:bg-white/20 border border-white/10 rounded-2xl font-bold uppercase text-xs tracking-widest transition-all hover:shadow-lg hover:scale-105"
          >
            Pause
          </button>
        </div>

        <button 
            onClick={() => setIsConfirmingEnd(true)}
            className="mt-2 text-[10px] text-red-400 hover:text-red-300 uppercase tracking-widest font-bold opacity-60 hover:opacity-100 transition-opacity"
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

  const themeClass = activeMode === 'break' ? 'shadow-teal-500/20' : 'shadow-red-500/20';
  const buttonHoverBorder = activeMode === 'break' ? 'group-hover:border-teal-400/40' : 'group-hover:border-red-400/40';
  const gradientFrom = activeMode === 'break' ? 'from-teal-500/10' : 'from-red-500/10';
  const accentText = activeMode === 'break' ? 'text-teal-200' : 'text-red-200';

  const addToBankAmount = allPauseTime / 5; 
  const deductFromBankAmount = allPauseTime;

  const buttonBaseClass = `
    group relative w-full max-w-[12rem] aspect-square rounded-[2rem] overflow-hidden
    bg-white/5 backdrop-blur-xl border border-white/10
    flex flex-col items-center justify-center gap-2
    transition-all duration-500 ease-out
    hover:scale-[1.02] hover:bg-white/10 hover:shadow-2xl ${themeClass}
    active:scale-[0.98]
    cursor-pointer
  `;

  const secondaryButtonClass = `
    text-[10px] font-bold uppercase tracking-[0.2em] 
    text-white/40 hover:text-white transition-all duration-300
    py-3 px-4 rounded-full hover:bg-white/5 mt-2
  `;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fade-in">
       <div className="w-full max-w-4xl flex flex-col items-center gap-8 animate-slide-up">
         
         <div className="text-center space-y-2 mb-4">
            <div className="text-white/50 font-bold tracking-[0.3em] uppercase text-xs animate-pulse">System Paused</div>
            <div className="text-7xl md:text-8xl font-mono font-bold text-white tracking-tighter drop-shadow-2xl">{timeStr}</div>
         </div>

         <div className="w-full grid grid-cols-2 gap-6 md:gap-12 px-4 md:px-12 justify-items-center">
             
             {/* Left: I Was Working */}
             <div className="flex flex-col items-center w-full">
                <button 
                   onClick={() => resumeFromPause('work', -addToBankAmount, 'work')}
                   className={`${buttonBaseClass} ${buttonHoverBorder}`}
                >
                    <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 bg-gradient-to-br ${gradientFrom} to-transparent`} />
                    <div className="relative z-10 flex flex-col items-center text-center gap-2 px-4">
                        <span className="text-white font-bold text-lg md:text-xl tracking-tight uppercase leading-tight">
                           I WAS WORKING
                        </span>
                        <span className={`text-[10px] font-bold uppercase tracking-widest opacity-60 group-hover:opacity-100 transition-opacity ${accentText}`}>
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
                   className={`${buttonBaseClass} ${buttonHoverBorder}`}
                >
                    <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 bg-gradient-to-br ${gradientFrom} to-transparent`} />
                    <div className="relative z-10 flex flex-col items-center text-center gap-2 px-4">
                        <span className="text-white font-bold text-lg md:text-xl tracking-tight uppercase leading-tight">
                           I WAS RESTING
                        </span>
                        <span className={`text-[10px] font-bold uppercase tracking-widest opacity-60 group-hover:opacity-100 transition-opacity ${accentText}`}>
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
