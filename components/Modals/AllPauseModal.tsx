
import React, { useState } from 'react';
import { ArrowLeft, Briefcase, Coffee, Pause, Play, Square, TimerReset, X } from 'lucide-react';
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

const PauseMotionStyles = () => (
  <style>{`
    @keyframes doroPauseSurfaceIn {
      0% {
        opacity: 0;
        filter: saturate(0.94);
      }
      100% {
        opacity: 1;
        filter: saturate(1);
      }
    }
    @keyframes doroPausePanelIn {
      0% {
        opacity: 0;
        transform: translateY(28px) scale(0.94);
        filter: blur(8px) saturate(0.9);
      }
      62% {
        opacity: 1;
        transform: translateY(-4px) scale(1.018);
        filter: blur(0) saturate(1.045);
      }
      100% {
        opacity: 1;
        transform: translateY(0) scale(1);
        filter: blur(0) saturate(1);
      }
    }
    @keyframes doroPauseItemIn {
      0% {
        opacity: 0;
        transform: translateY(12px) scale(0.972);
        filter: blur(3px);
      }
      68% {
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
    @keyframes doroPauseTimeIn {
      0% {
        opacity: 0;
        transform: translateY(16px) scale(0.92);
        letter-spacing: 0.02em;
        filter: blur(5px) saturate(0.9);
      }
      64% {
        opacity: 1;
        transform: translateY(-2px) scale(1.025);
        letter-spacing: 0;
        filter: blur(0) saturate(1.04);
      }
      100% {
        opacity: 1;
        transform: translateY(0) scale(1);
        letter-spacing: 0;
        filter: blur(0) saturate(1);
      }
    }
    .doro-pause-surface-in {
      animation: doroPauseSurfaceIn 360ms cubic-bezier(0.22, 1, 0.36, 1) both;
    }
    .doro-pause-panel-in {
      animation: doroPausePanelIn 520ms cubic-bezier(0.16, 0.92, 0.28, 1.08) both;
      transform-origin: center;
      will-change: transform, opacity, filter;
    }
    .doro-pause-item-in {
      animation: doroPauseItemIn 460ms cubic-bezier(0.18, 0.9, 0.32, 1.08) both;
      animation-delay: var(--doro-pause-delay, 0ms);
      transform-origin: center;
      will-change: transform, opacity, filter;
    }
    .doro-pause-time-in {
      animation: doroPauseTimeIn 560ms cubic-bezier(0.16, 0.92, 0.28, 1.08) both;
      animation-delay: 70ms;
      transform-origin: center;
      will-change: transform, opacity, filter;
    }
    @media (prefers-reduced-motion: reduce) {
      .doro-pause-surface-in,
      .doro-pause-panel-in,
      .doro-pause-item-in,
      .doro-pause-time-in {
        animation: none !important;
      }
    }
  `}</style>
);

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
  const overlayClass = "doro-pause-surface-in fixed inset-0 z-50 flex items-center justify-center p-3 md:p-4";
  const panelClass = "doro-pause-panel-in relative w-full max-w-md overflow-hidden rounded-[1.75rem] border border-white/[0.10] bg-white/[0.045] p-5 shadow-[0_34px_90px_-44px_rgba(0,0,0,0.92),inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-xl md:p-7";
  const labelClass = "text-[10px] font-bold uppercase tracking-[0.18em] text-white/42";
  const iconBadgeClass = "mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.10] bg-white/[0.075] text-white shadow-[0_22px_42px_-30px_rgba(0,0,0,0.86),inset_0_1px_0_rgba(255,255,255,0.07)]";
  const panelHighlight = "pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_1px_0_rgba(255,255,255,0.10),inset_0_0_42px_rgba(255,255,255,0.035)]";
  const closeButtonClass = "absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.045] text-white/56 shadow-[0_18px_36px_-28px_rgba(0,0,0,0.82)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/[0.08] hover:text-white active:translate-y-0 active:scale-95";
  const raisedButtonClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.065] px-4 py-3 text-[10px] font-bold uppercase tracking-[0.14em] shadow-[0_20px_42px_-30px_rgba(0,0,0,0.82),inset_0_1px_0_rgba(255,255,255,0.035)] transition-all duration-300 ease-out hover:-translate-y-1 hover:bg-white/[0.095] hover:shadow-[0_30px_54px_-30px_rgba(0,0,0,0.92),inset_0_1px_0_rgba(255,255,255,0.045)] active:translate-y-0 active:scale-[0.99]";
  const secondaryButtonClass = `${raisedButtonClass} text-white/62 hover:text-white`;
  const primaryButtonClass = `${raisedButtonClass} text-white bg-white/[0.12] hover:bg-white/[0.16]`;
  const dangerButtonClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200/[0.10] bg-red-500/12 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-red-100/82 shadow-[0_20px_42px_-30px_rgba(127,29,29,0.95)] transition-all duration-300 hover:-translate-y-1 hover:bg-red-500/18 hover:text-red-100 hover:shadow-[0_30px_54px_-30px_rgba(127,29,29,0.95)] active:translate-y-0 active:scale-[0.99]";

  if (isConfirmingEnd) {
      return (
        <div className={overlayClass} style={surfaceStyle}>
          <PauseMotionStyles />
          <div className={`${panelClass} max-w-sm`} style={surfaceStyle}>
            <div className={panelHighlight} />
            <div className="relative z-10">
            <div className="doro-pause-item-in text-center" style={{ ['--doro-pause-delay' as any]: '80ms' }}>
              <div className={`${iconBadgeClass} text-red-100/88`}>
                <Square size={20} strokeWidth={2.3} />
              </div>
              <div className={labelClass}>Confirm</div>
              <h3 className="mt-2 text-2xl font-bold text-white">End Work Session?</h3>
              <p className="mt-3 text-sm leading-relaxed text-white/46">This will clear completed tasks and reset timers.</p>
            </div>
            <div className="doro-pause-item-in mt-6 flex gap-3 w-full" style={{ ['--doro-pause-delay' as any]: '150ms' }}>
              <button onClick={() => setIsConfirmingEnd(false)} className={`flex-1 ${secondaryButtonClass}`}>
                <ArrowLeft size={14} strokeWidth={2.4} />
                Back
              </button>
              <button onClick={handleEndSession} className={`flex-1 ${dangerButtonClass}`}>
                <Square size={13} strokeWidth={2.6} />
                End Session
              </button>
            </div>
            </div>
          </div>
        </div>
      );
  }

  return (
    <div className={overlayClass} style={surfaceStyle}>
      <PauseMotionStyles />
      <div className={`${panelClass} flex flex-col gap-5`} style={surfaceStyle}>
        <div className={panelHighlight} />
        <button className={closeButtonClass} onClick={onClose} aria-label="Close pause dialog">
          <X size={16} strokeWidth={2.4} />
        </button>

        <div className="relative z-10 doro-pause-item-in text-center" style={{ ['--doro-pause-delay' as any]: '70ms' }}>
          <div className={iconBadgeClass}>
            <Pause size={20} strokeWidth={2.5} />
          </div>
          <div className={labelClass}>Pause Timer</div>
          <h3 className="mt-2 text-2xl font-bold text-white">Pause Session</h3>
          <p className="mt-2 text-sm leading-relaxed text-white/46">Timer will stop completely.</p>
        </div>
        
        <input
          autoFocus
          type="text"
          placeholder="Reason (optional)"
          className={`relative z-10 doro-pause-item-in w-full rounded-[1rem] border border-white/[0.08] bg-white/[0.085] px-4 py-3.5 text-center text-sm font-semibold text-white shadow-[0_22px_44px_-32px_rgba(0,0,0,0.82),inset_0_1px_0_rgba(255,255,255,0.06)] outline-none transition-all duration-300 placeholder:text-white/54 focus:-translate-y-0.5 focus:bg-white/[0.12] focus:placeholder:text-white/40 ${themeColor}`}
          style={{ ['--doro-pause-delay' as any]: '125ms' }}
          value={reason}
          onChange={e => setReason(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleConfirm()}
        />
        
        <div className="relative z-10 doro-pause-item-in flex gap-3 w-full" style={{ ['--doro-pause-delay' as any]: '185ms' }}>
          <button 
            onClick={onClose} 
            className={`flex-1 ${secondaryButtonClass}`}
          >
            <X size={14} strokeWidth={2.4} />
            Cancel
          </button>
          <button 
            onClick={handleConfirm} 
            className={`flex-1 ${primaryButtonClass}`}
          >
            <Pause size={14} strokeWidth={2.6} />
            Pause
          </button>
        </div>

        <button 
            onClick={() => setIsConfirmingEnd(true)}
            style={{ ['--doro-pause-delay' as any]: '245ms' }}
            className="relative z-10 doro-pause-item-in mx-auto mt-1 inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-red-200/[0.08] bg-red-500/[0.075] px-4 text-[10px] font-bold uppercase tracking-[0.14em] text-red-100/62 shadow-[0_18px_36px_-28px_rgba(127,29,29,0.75)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-red-500/12 hover:text-red-100/86 hover:shadow-[0_24px_44px_-28px_rgba(127,29,29,0.82)] md:min-h-0 md:py-2"
        >
            <Square size={12} strokeWidth={2.5} />
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
    doro-pause-item-in group relative w-full overflow-hidden rounded-[1.35rem]
    border border-white/[0.08] bg-white/[0.055] px-5 py-5 backdrop-blur-xl
    text-center shadow-[0_24px_54px_-34px_rgba(0,0,0,0.86),inset_0_1px_0_rgba(255,255,255,0.035)]
    transition-all duration-300 ease-out
    hover:-translate-y-1.5 hover:bg-white/[0.085] ${accentGlow}
    active:translate-y-0 active:scale-[0.99]
    cursor-pointer
  `;

  const secondaryButtonClass = `
    doro-pause-item-in mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.055] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em]
    text-white/52 shadow-[0_18px_36px_-28px_rgba(0,0,0,0.78)]
    transition-all duration-300 hover:-translate-y-1 hover:bg-white/[0.085] hover:text-white hover:shadow-[0_26px_46px_-28px_rgba(0,0,0,0.86)]
    active:translate-y-0 active:scale-[0.99]
  `;

  return (
    <div className="doro-pause-surface-in fixed inset-0 z-[60] flex items-center justify-center p-3 md:p-4" style={surfaceStyle}>
       <PauseMotionStyles />
       <div className="doro-pause-panel-in relative w-full max-w-3xl overflow-hidden rounded-[1.8rem] border border-white/[0.10] bg-white/[0.045] p-5 shadow-[0_34px_90px_-44px_rgba(0,0,0,0.92),inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-xl md:p-8" style={surfaceStyle}>
         <div className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_1px_0_rgba(255,255,255,0.10),inset_0_0_48px_rgba(255,255,255,0.035)]" />
         
         <div className="relative z-10 text-center">
            <div className="doro-pause-item-in mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.10] bg-white/[0.075] text-white shadow-[0_22px_42px_-30px_rgba(0,0,0,0.86),inset_0_1px_0_rgba(255,255,255,0.07)]" style={{ ['--doro-pause-delay' as any]: '35ms' }}>
              <TimerReset size={20} strokeWidth={2.4} />
            </div>
            <div className="doro-pause-item-in mt-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/42" style={{ ['--doro-pause-delay' as any]: '50ms' }}>System Paused</div>
            <div className="doro-pause-time-in mt-3 font-sans text-[4.25rem] font-bold leading-none text-white tabular-nums md:text-[5.75rem]">{timeStr}</div>
            <div className="doro-pause-item-in mt-3 text-sm text-white/44" style={{ ['--doro-pause-delay' as any]: '150ms' }}>Choose how to treat the paused time.</div>
         </div>

         <div className="relative z-10 mt-7 grid w-full grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
             
             {/* Left: I Was Working */}
             <div className="flex flex-col items-center w-full">
                <button 
                   onClick={() => resumeFromPause('work', -addToBankAmount, 'work')}
                   className={buttonBaseClass}
                   style={{ ['--doro-pause-delay' as any]: '210ms' }}
                >
                    <div className={`pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 ${accentSurface}`} />
                    <div className="relative z-10 flex min-h-[6.4rem] flex-col items-center justify-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.075] text-white/82 shadow-[0_16px_30px_-24px_rgba(0,0,0,0.8)]">
                          <Briefcase size={18} strokeWidth={2.3} />
                        </span>
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
                    style={{ ['--doro-pause-delay' as any]: '280ms' }}
                >
                    <Play size={13} strokeWidth={2.5} />
                    Resume Work
                </button>
             </div>

             {/* Right: I Was Resting */}
             <div className="flex flex-col items-center w-full">
                <button 
                   onClick={() => resumeFromPause('break', deductFromBankAmount, 'break')}
                   className={buttonBaseClass}
                   style={{ ['--doro-pause-delay' as any]: '260ms' }}
                >
                    <div className={`pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 ${accentSurface}`} />
                    <div className="relative z-10 flex min-h-[6.4rem] flex-col items-center justify-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.075] text-white/82 shadow-[0_16px_30px_-24px_rgba(0,0,0,0.8)]">
                          <Coffee size={18} strokeWidth={2.3} />
                        </span>
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
                    style={{ ['--doro-pause-delay' as any]: '330ms' }}
                >
                    <Play size={13} strokeWidth={2.5} />
                    Resume Break
                </button>
             </div>

         </div>
       </div>
    </div>
  );
};

export default AllPauseModal;
