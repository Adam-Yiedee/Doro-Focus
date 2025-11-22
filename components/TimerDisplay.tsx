
import React, { useRef, useState } from 'react';
import { useTimer } from '../context/TimerContext';

const formatTime = (seconds: number) => {
  const absSec = Math.abs(seconds);
  const m = Math.floor(absSec / 60);
  const s = Math.floor(absSec % 60);
  const sign = seconds < 0 ? '-' : '';
  return `${sign}${m}:${s.toString().padStart(2, '0')}`;
};

// Internal Liquid Component
const LiquidWave = ({ percent, isVisible, isActive, colorMode = 'default' }: { percent: number, isVisible: boolean, isActive: boolean, colorMode?: 'default' | 'red' }) => {
  // Calculate bottom position to transition from -300% (Empty/Low) to -185% (Full/High)
  // Increased size to 300% to ensure corners are filled and liquid spans full width properly
  const safePercent = Math.max(0, Math.min(1.1, percent));
  const bottomVal = -300 + (safePercent * 115);

  const primaryClass = colorMode === 'red' ? 'bg-red-500/20' : 'bg-white/5';
  const secondaryClass = colorMode === 'red' ? 'bg-red-500/10' : 'bg-white/3';

  return (
    <div className={`absolute inset-0 z-0 transition-opacity duration-700 pointer-events-none ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
       <div 
         className={`absolute left-[-100%] w-[300%] aspect-square ${primaryClass} rounded-[40%] transition-all duration-1000 ease-in-out ${isActive ? 'animate-spin-slow' : ''}`}
         style={{ bottom: `${bottomVal}%` }}
       />
       <div 
         className={`absolute left-[-100%] w-[300%] aspect-square ${secondaryClass} rounded-[42%] transition-all duration-1000 ease-in-out ${isActive ? 'animate-spin-slower' : ''}`}
         style={{ bottom: `${bottomVal}%` }}
       />
    </div>
  );
};

interface TimerSquareProps {
  type: 'work' | 'break';
  time: number;
  maxTime: number;
  activeMode: 'work' | 'break';
  label?: string;
  isIdle: boolean;
  disableBlur: boolean;
  onActivate: (type: 'work' | 'break') => void;
}

const TimerSquare: React.FC<TimerSquareProps> = ({ type, time, maxTime, activeMode, label, isIdle, disableBlur, onActivate }) => {
  const [isHovered, setIsHovered] = useState(false);
  const isActive = !isIdle && activeMode === type;
  const isWork = type === 'work';

  // Calculate Fill Percentage
  let fillPercent = 0;
  let showLiquid = true;
  let liquidColor: 'default' | 'red' = 'default';

  if (type === 'work') {
      // Work fills UP as time counts DOWN
      const ratio = time / Math.max(1, maxTime);
      fillPercent = 1 - ratio;
      
      if (fillPercent <= 0.001) showLiquid = false;
  } else {
      // Break Logic
      if (time < 0) {
          // NEGATIVE BREAK (Red Liquid)
          // User logic: Empty at -5s, Full at -10:00 (-600s)
          const absTime = Math.abs(time);
          if (absTime < 5) {
              fillPercent = 0;
              showLiquid = false;
          } else {
              // Scale from 5s to 600s
              const range = 600 - 5;
              fillPercent = Math.min(1, (absTime - 5) / range);
              showLiquid = true;
          }
          liquidColor = 'red';
      } else {
          // POSITIVE BREAK (White Liquid)
          fillPercent = Math.max(0, time) / Math.max(1, maxTime);
          // If less than 5 seconds left (and positive), hide liquid
          if (time <= 5) showLiquid = false;
      }
  }

  // State Calculation for Styles
  let containerClasses = "";
  let textClasses = "";
  let labelClasses = "";
  
  const blurEffect = disableBlur ? '' : 'backdrop-blur-xl';
  const hoverBlurEffect = disableBlur ? '' : 'backdrop-blur-md';

  if (isActive) {
    // ACTIVE STATE
    containerClasses = `z-20 scale-100 opacity-100 blur-0 bg-white/10 border-white/20 shadow-[0_30px_60px_-10px_rgba(0,0,0,0.3)] ring-1 ring-white/30 border ${blurEffect}`;
    textClasses = "scale-100 text-white drop-shadow-2xl";
    labelClasses = "text-white/90 translate-y-0";
  } else if (isHovered) {
    // HOVERED STATE
    containerClasses = `z-30 scale-[1.02] opacity-90 blur-0 grayscale-0 bg-white/10 border-white/20 shadow-[0_20px_40px_-5px_rgba(0,0,0,0.2)] -translate-y-2 cursor-pointer border ${hoverBlurEffect}`;
    textClasses = "scale-95 text-white/90";
    labelClasses = "text-white/80 translate-y-0";
  } else {
    // IDLE STATE
    containerClasses = "z-10 scale-90 opacity-60 bg-transparent border-transparent shadow-none";
    textClasses = `scale-90 text-white/50 saturate-50 ${disableBlur ? '' : 'blur-[3px]'}`; 
    labelClasses = `text-white/40 ${disableBlur ? '' : 'blur-[3px]'}`;
  }

  return (
    <div
      className={`
        relative w-72 h-72 md:w-96 md:h-96 flex-shrink-0 rounded-[3rem] overflow-hidden transform-gpu
        transition-all duration-700 cubic-bezier(0.2, 0.8, 0.2, 1)
        flex flex-col items-center justify-center gap-2
        ${containerClasses}
      `}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={(e) => {
        e.stopPropagation();
        if (!isActive) {
          onActivate(type);
        }
      }}
    >
      {/* Liquid Animation Background */}
      <LiquidWave 
        percent={fillPercent} 
        // Ensure liquid is hidden unless Active or Hovered, even for negative break time
        isVisible={(isActive || isHovered) && showLiquid} 
        isActive={isActive} 
        colorMode={liquidColor}
      />

      {/* Inner Glow */}
      {isActive && (
        <>
          <div className="absolute inset-0 bg-gradient-to-tr from-white/10 via-white/0 to-transparent pointer-events-none z-10" />
          <div className={`absolute -top-1/2 -left-1/2 w-[200%] h-[200%] bg-gradient-to-b from-white/10 to-transparent rounded-full pointer-events-none mix-blend-overlay z-10 ${disableBlur ? '' : 'blur-[80px]'}`} />
          <div className="absolute inset-0 shadow-[inset_0_0_60px_rgba(255,255,255,0.1)] rounded-[3rem] pointer-events-none z-20" />
        </>
      )}

      {/* Label */}
      <div className={`
        z-20 pointer-events-none text-xs md:text-sm font-bold uppercase tracking-[0.2em] transition-all duration-500 max-w-[80%] text-center truncate
        ${labelClasses}
      `}>
        {label || (isWork ? 'Focus' : 'Break Bank')}
      </div>

      {/* Time Display */}
      <div className={`
        z-20 pointer-events-none font-sans tabular-nums font-bold tracking-tighter transition-all duration-500 leading-none
        text-7xl md:text-9xl
        ${textClasses}
        ${time < 0 ? 'text-red-200 drop-shadow-[0_0_15px_rgba(220,38,38,0.5)]' : ''}
      `}>
        {formatTime(time)}
      </div>

      {/* Action Hint */}
      {!isActive && (
        <div className={`
           z-20 absolute bottom-8 text-[10px] text-white/80 uppercase tracking-widest 
           transition-all duration-300 transform
           ${isHovered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}
        `}>
           Click to {isWork ? 'Focus' : 'Switch'}
        </div>
      )}
    </div>
  );
};

const TimerDisplay: React.FC = () => {
  const { workTime, breakTime, activeMode, isIdle, activateMode, restartActiveTimer, activeTask, settings } = useTimer();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressRef = useRef(false);

  const handleResetDown = () => {
    isLongPressRef.current = false;
    resetTimeoutRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      openEdit();
    }, 500);
  };

  const handleResetUp = () => {
    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current);
      resetTimeoutRef.current = null;
    }
    if (!isLongPressRef.current) {
      restartActiveTimer();
    }
  };

  const handleTimeSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const mins = parseFloat(editValue);
    if (!isNaN(mins)) {
      restartActiveTimer(Math.floor(mins * 60));
    }
    setIsEditing(false);
  };

  const openEdit = () => {
      const currentTime = activeMode === 'work' ? workTime : breakTime;
      setEditValue(Math.floor(Math.abs(currentTime) / 60).toString());
      setIsEditing(true);
  };

  return (
    <div className="relative w-full flex flex-col items-center py-4">
      {/* Edit Modal */}
      {isEditing && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md animate-fade-in" onClick={() => setIsEditing(false)}>
           <div className="bg-white/10 backdrop-blur-2xl p-10 rounded-[3rem] border border-white/20 shadow-2xl flex flex-col items-center gap-8 transform transition-all animate-slide-up w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
              <div className="text-center space-y-1">
                <h3 className="text-white/90 uppercase tracking-[0.2em] text-xs font-bold">Manual Override</h3>
                <p className="text-white/40 text-xs">Set custom duration for {activeMode}</p>
              </div>
              
              <form onSubmit={handleTimeSubmit} className="flex flex-col items-center w-full gap-6">
                <div className="relative w-full flex justify-center items-baseline gap-2">
                    <input 
                    autoFocus
                    type="number"
                    step="1"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    className="w-48 bg-transparent text-8xl text-white font-sans tabular-nums font-bold text-center outline-none border-b border-white/10 focus:border-white/50 transition-colors pb-2 placeholder-white/10"
                    placeholder="0"
                    />
                    <span className="text-xl text-white/40 font-medium">min</span>
                </div>
                <button type="submit" className="w-full py-4 bg-white/10 hover:bg-white/20 rounded-2xl text-white/90 font-bold tracking-wider uppercase text-sm transition-all hover:scale-[1.02] active:scale-[0.98] border border-white/5">
                  Update Timer
                </button>
              </form>
           </div>
        </div>
      )}

      {/* Reset Button */}
      {!isIdle && (
        <button 
            onMouseDown={handleResetDown}
            onMouseUp={handleResetUp}
            onMouseLeave={handleResetUp}
            onTouchStart={handleResetDown}
            onTouchEnd={handleResetUp}
            className={`absolute -top-6 md:-top-12 z-50 flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white/40 hover:text-white transition-all duration-500 group active:scale-95 select-none opacity-50 hover:opacity-100 ${settings.disableBlur ? '' : 'backdrop-blur-md blur-[2px] hover:blur-0'}`}
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-hover:rotate-[-180deg] transition-transform duration-500"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            <div className="flex flex-col items-start leading-none">
                <span className="text-xs font-bold tracking-wider uppercase">Reset</span>
                <span className="text-[8px] tracking-wide opacity-0 group-hover:opacity-60 transition-opacity h-0 group-hover:h-auto overflow-visible absolute top-full mt-1 w-32 left-1/2 -translate-x-1/2 text-center">Hold to Edit</span>
            </div>
        </button>
      )}

      {/* Timer Container */}
      <div className="flex flex-col md:flex-row items-center justify-center gap-8 md:gap-24 w-full px-4">
        <TimerSquare 
            type="work" 
            time={workTime}
            maxTime={settings.workDuration}
            activeMode={activeMode} 
            label={activeTask ? activeTask.name : 'Focus'}
            isIdle={isIdle} 
            disableBlur={settings.disableBlur}
            onActivate={activateMode} 
        />
        <TimerSquare 
            type="break" 
            time={breakTime}
            maxTime={settings.longBreakDuration}
            activeMode={activeMode} 
            isIdle={isIdle} 
            disableBlur={settings.disableBlur}
            onActivate={activateMode} 
        />
      </div>
    </div>
  );
};

export default TimerDisplay;
