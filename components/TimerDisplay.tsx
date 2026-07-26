
import React, { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { useTimer } from '../context/TimerContext';
import { getFocusTimerDisplaySeconds } from '../utils/focusTimerDisplay';

const formatTime = (seconds: number) => {
  const absSec = Math.abs(seconds);
  const m = Math.floor(absSec / 60);
  const s = Math.floor(absSec % 60);
  const sign = seconds < 0 ? '-' : '';
  return `${sign}${m}:${s.toString().padStart(2, '0')}`;
};

const clampPercent = (value: number, max: number = 1) => Math.max(0, Math.min(max, value));
const clampUnit = (value: number) => Math.max(-1, Math.min(1, value));

type TimerTiltState = {
  x: number;
  y: number;
  intensity: number;
};

const TIMER_TILT_REST: TimerTiltState = { x: 0, y: 0, intensity: 0 };

const usePrefersReducedMotion = () => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncPreference = () => setPrefersReducedMotion(media.matches);
    syncPreference();
    media.addEventListener('change', syncPreference);
    return () => media.removeEventListener('change', syncPreference);
  }, []);

  return prefersReducedMotion;
};

const getTimerTiltShadow = (isActive: boolean, isHovered: boolean, tilt: TimerTiltState) => {
  if (!isActive && !isHovered) return 'none';

  const activeWeight = isActive ? 1 : 0.78;
  const hoverLift = isHovered ? 4 : 0;
  const shadowX = Math.round(-tilt.x * 5.8 * activeWeight);
  const shadowY = Math.round((isActive ? 34 : 27) + hoverLift + (tilt.intensity * 4.8));
  const shadowBlur = Math.round((isActive ? 76 : 60) + hoverLift + (tilt.intensity * 6));
  const liftShadow = isActive
    ? '0 22px 42px -25px rgba(0,0,0,0.5)'
    : '0 18px 34px -24px rgba(0,0,0,0.42)';

  return [
    `${shadowX}px ${shadowY}px ${shadowBlur}px -24px rgba(0,0,0,${isActive ? 0.48 : 0.36})`,
    liftShadow,
    'inset 0 1px 0 rgba(255,255,255,0.12)',
    'inset 0 -24px 46px rgba(0,0,0,0.08)',
  ].join(', ');
};

// Internal Liquid Component
const LiquidWave = ({ percent, isVisible, isActive, colorMode = 'default' }: { percent: number, isVisible: boolean, isActive: boolean, colorMode?: 'default' | 'red' }) => {
  const targetPercent = clampPercent(percent, 1.1);
  const [displayPercent, setDisplayPercent] = useState(targetPercent);
  const displayPercentRef = useRef(targetPercent);

  useEffect(() => {
    displayPercentRef.current = displayPercent;
  }, [displayPercent]);

  useEffect(() => {
    const nextTarget = clampPercent(percent, 1.1);
    const startPercent = displayPercentRef.current;

    if (Math.abs(nextTarget - startPercent) < 0.001) {
      displayPercentRef.current = nextTarget;
      setDisplayPercent(nextTarget);
      return;
    }

    const durationMs = isActive ? 900 : 780;
    let frameId = 0;
    let startTime: number | null = null;

    const step = (now: number) => {
      if (startTime === null) startTime = now;
      const progress = Math.min(1, (now - startTime) / durationMs);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const nextPercent = startPercent + ((nextTarget - startPercent) * easedProgress);
      displayPercentRef.current = nextPercent;
      setDisplayPercent(nextPercent);
      if (progress < 1) frameId = window.requestAnimationFrame(step);
    };

    frameId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frameId);
  }, [percent, isActive, isVisible]);

  // Range: Start (-300%) to End (-160%). 
  // -300% is completely below the viewport. -160% covers the viewport with the wave crests.
  const safePercent = displayPercent;
  const bottomVal = -300 + (safePercent * 140);
  const waveLevelStyle = {
    willChange: 'bottom, transform',
    transform: 'translateZ(0)',
    backfaceVisibility: 'hidden' as const,
  };

  const waveBase = colorMode === 'red' ? 'bg-red-500' : 'bg-white';
  
  // Opacities
  const op1 = colorMode === 'red' ? 'opacity-20' : 'opacity-10'; // Back
  const op2 = colorMode === 'red' ? 'opacity-30' : 'opacity-20'; // Mid
  const op3 = colorMode === 'red' ? 'opacity-40' : 'opacity-30'; // Front

  return (
    <div className={`doro-mobile-liquid-mask absolute inset-0 z-0 transition-opacity duration-1000 pointer-events-none overflow-hidden rounded-[3rem] ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
       {/* Wave 1 (Back) - Slowest */}
       <div 
         className={`absolute left-[-100%] w-[300%] aspect-square ${waveBase} ${op1} rounded-[45%] animate-wave-slow`}
         style={{ ...waveLevelStyle, bottom: `${bottomVal}%` }}
       />
       {/* Wave 2 (Mid) */}
       <div 
         className={`absolute left-[-100%] w-[300%] aspect-square ${waveBase} ${op2} rounded-[47%] animate-wave-med`}
         style={{ ...waveLevelStyle, bottom: `${bottomVal - 1.5}%`, animationDelay: '-8s' }}
       />
       {/* Wave 3 (Front) */}
       <div 
         className={`absolute left-[-100%] w-[300%] aspect-square ${waveBase} ${op3} rounded-[46%] animate-wave-fast`}
         style={{ ...waveLevelStyle, bottom: `${bottomVal - 3}%`, animationDelay: '-3s' }}
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
  displayValue?: string;
  displayVariant?: 'time' | 'word';
  displayHidden?: boolean;
  hideLabel?: boolean;
  hideLiquid?: boolean;
  isIdle: boolean;
  isLocked: boolean;
  disableBlur: boolean;
  enableLockControls?: boolean;
  allowHoldWhenInactive?: boolean;
  holdHintLabel?: string;
  promoteLabelWhenDisplayHidden?: boolean;
  onActivate: (type: 'work' | 'break') => void;
  onToggleLock: (type: 'work' | 'break') => void;
  onHoldAction?: (type: 'work' | 'break') => void;
}

const TimerSquare: React.FC<TimerSquareProps> = ({
  type,
  time,
  maxTime,
  activeMode,
  label,
  displayValue,
  displayVariant = 'time',
  displayHidden = false,
  hideLabel = false,
  hideLiquid = false,
  isIdle,
  isLocked,
  disableBlur,
  enableLockControls = true,
  allowHoldWhenInactive = false,
  holdHintLabel,
  promoteLabelWhenDisplayHidden = false,
  onActivate,
  onToggleLock,
  onHoldAction,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [tilt, setTilt] = useState<TimerTiltState>(TIMER_TILT_REST);
  const prefersReducedMotion = usePrefersReducedMotion();
  const lockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tiltFrameRef = useRef<number | null>(null);
  const pendingTiltRef = useRef<TimerTiltState>(TIMER_TILT_REST);
  const suppressClickRef = useRef(false);
  const lockPressFiredRef = useRef(false);
  const isActive = !isIdle && activeMode === type;
  const isWork = type === 'work';

  const clearLockTimeout = () => {
    if (lockTimeoutRef.current) {
      clearTimeout(lockTimeoutRef.current);
      lockTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearLockTimeout();
      if (tiltFrameRef.current !== null) {
        window.cancelAnimationFrame(tiltFrameRef.current);
        tiltFrameRef.current = null;
      }
    };
  }, []);

  const commitTilt = (nextTilt: TimerTiltState) => {
    pendingTiltRef.current = nextTilt;
    if (tiltFrameRef.current !== null) return;

    tiltFrameRef.current = window.requestAnimationFrame(() => {
      tiltFrameRef.current = null;
      const pendingTilt = pendingTiltRef.current;
      setTilt(prev => {
        const didMove = Math.abs(prev.x - pendingTilt.x) > 0.01
          || Math.abs(prev.y - pendingTilt.y) > 0.01
          || Math.abs(prev.intensity - pendingTilt.intensity) > 0.01;
        return didMove ? pendingTilt : prev;
      });
    });
  };

  const resetTilt = () => {
    pendingTiltRef.current = TIMER_TILT_REST;
    if (tiltFrameRef.current !== null) {
      window.cancelAnimationFrame(tiltFrameRef.current);
      tiltFrameRef.current = null;
    }
    setTilt(TIMER_TILT_REST);
  };

  const updateTiltFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (prefersReducedMotion || (e.pointerType !== 'mouse' && e.pointerType !== 'pen')) return;

    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const x = clampUnit(((e.clientX - rect.left) / rect.width - 0.5) * 2);
    const y = clampUnit(((e.clientY - rect.top) / rect.height - 0.5) * 2);
    const easedX = Math.sign(x) * Math.pow(Math.abs(x), 0.86);
    const easedY = Math.sign(y) * Math.pow(Math.abs(y), 0.86);

    commitTilt({
      x: easedX,
      y: easedY,
      intensity: Math.min(1, Math.hypot(easedX, easedY)),
    });
  };

  const clearSuppressedClickSoon = () => {
    window.setTimeout(() => {
      suppressClickRef.current = false;
      lockPressFiredRef.current = false;
    }, 350);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!enableLockControls) return;
    if ((!isActive && !allowHoldWhenInactive) || isLocked) return;

    lockPressFiredRef.current = false;
    clearLockTimeout();
    lockTimeoutRef.current = setTimeout(() => {
      lockTimeoutRef.current = null;
      lockPressFiredRef.current = true;
      suppressClickRef.current = true;
      (onHoldAction || onToggleLock)(type);
    }, 550);
  };

  const handlePointerEnd = () => {
    clearLockTimeout();
    if (lockPressFiredRef.current) clearSuppressedClickSoon();
  };

  // Calculate Fill Percentage
  let fillPercent = 0;
  let showLiquid = true;
  let liquidColor: 'default' | 'red' = 'default';

  if (type === 'work') {
      // Ease the visual fill so the work glass does not look nearly full halfway through.
      const safeMax = Math.max(1, maxTime);
      const ratio = clampPercent(time / safeMax);
      const progress = 1 - ratio;
      fillPercent = Math.pow(progress, 1.35);
      showLiquid = true;
  } else {
      // BREAK LOGIC
      if (time < 0) {
          // Negative break (debt) -> Rise red liquid
          // Visual cap: 10 minutes (600s) of debt fills the container
          fillPercent = clampPercent(Math.abs(time) / 600);
          showLiquid = true;
          liquidColor = 'red';
      } else {
          // Normal break: Start Full (100%), Drain to Empty (0%)
          fillPercent = clampPercent(time / Math.max(1, 1200)); // Visual cap at 20 mins for fullness
          if (time <= 5) showLiquid = false; // Hide sliver when nearly empty
      }
  }

  // State Calculation for Styles
  let containerClasses = "";
  let textClasses = "";
  let labelClasses = "";
  
  const blurEffect = disableBlur ? '' : 'backdrop-blur-xl';
  const hoverBlurEffect = disableBlur ? '' : 'backdrop-blur-md';
  const shouldPromoteLabel = promoteLabelWhenDisplayHidden && displayHidden && !hideLabel;
  const labelText = label || (isWork ? 'Focus' : 'Break Bank');
  const activeHoldHint = holdHintLabel || 'Hold to Lock';

  if (isActive) {
    containerClasses = `z-20 opacity-100 blur-0 bg-white/10 border-white/20 ring-1 ring-white/30 border cursor-pointer ${blurEffect}`;
    textClasses = "scale-100 text-white drop-shadow-2xl";
    labelClasses = "text-white/90 translate-y-0";
  } else if (isHovered) {
    containerClasses = `z-30 opacity-90 blur-0 grayscale-0 bg-white/10 border-white/20 cursor-pointer border ${hoverBlurEffect}`;
    textClasses = "scale-95 text-white/90";
    labelClasses = "text-white/80 translate-y-0";
  } else {
    containerClasses = "z-10 opacity-60 bg-transparent border-transparent";
    textClasses = `scale-90 text-white/50 saturate-50 ${disableBlur ? '' : 'blur-[3px]'}`; 
    labelClasses = `text-white/40 ${disableBlur ? '' : 'blur-[3px]'}`;
  }

  const effectiveTilt = prefersReducedMotion ? TIMER_TILT_REST : tilt;
  const baseScale = isActive ? 1 : isHovered ? 1.02 : 0.9;
  const baseTranslateY = !isActive && isHovered ? -9 : 0;
  const hoverDepth = isHovered ? 4 : 0;
  const tiltBoost = isHovered ? 1 + (effectiveTilt.intensity * 0.001) : 1;
  const rotateX = -effectiveTilt.y * 1.5;
  const rotateY = effectiveTilt.x * 1.68;
  const timerSquareStyle: React.CSSProperties = {
    boxShadow: getTimerTiltShadow(isActive, isHovered, effectiveTilt),
    transform: `perspective(860px) translate3d(0, ${baseTranslateY}px, ${hoverDepth}px) scale(${baseScale * tiltBoost}) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
    transformOrigin: 'center',
    transformStyle: 'preserve-3d',
    transition: prefersReducedMotion
      ? 'background-color 220ms ease, border-color 220ms ease, opacity 220ms ease, filter 220ms ease'
      : isHovered
        ? 'transform 130ms ease-out, box-shadow 130ms ease-out, background-color 450ms ease, border-color 450ms ease, opacity 450ms ease, filter 450ms ease'
        : 'transform 560ms cubic-bezier(0.16,0.9,0.3,1), box-shadow 560ms cubic-bezier(0.16,0.9,0.3,1), background-color 700ms cubic-bezier(0.2,0.8,0.2,1), border-color 700ms cubic-bezier(0.2,0.8,0.2,1), opacity 700ms cubic-bezier(0.2,0.8,0.2,1), filter 700ms cubic-bezier(0.2,0.8,0.2,1)',
    willChange: 'transform, box-shadow',
  };
  const sheenStyle: React.CSSProperties = {
    background: `radial-gradient(circle at ${50 + effectiveTilt.x * 7}% ${42 + effectiveTilt.y * 7}%, rgba(255,255,255,0.14), rgba(255,255,255,0.035) 32%, transparent 66%)`,
    opacity: isHovered && !prefersReducedMotion ? 0.08 + (effectiveTilt.intensity * 0.03) : 0,
    transform: 'translateZ(5px)',
    transition: isHovered ? 'opacity 130ms ease-out, background 130ms ease-out' : 'opacity 420ms ease-out',
  };

  return (
    <div
      className={`
        doro-mobile-liquid-shell relative w-full aspect-square max-w-[19rem] sm:max-w-[20rem] md:max-w-[20rem] lg:max-w-[24rem] flex-shrink-0 rounded-[3rem] overflow-hidden transform-gpu
        transition-all duration-700 cubic-bezier(0.2, 0.8, 0.2, 1)
        flex flex-col items-center justify-center gap-2
        ${containerClasses}
        ${isLocked ? 'cursor-pointer' : ''}
        group
      `}
      style={timerSquareStyle}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
          setIsHovered(true);
          updateTiltFromPointer(e);
        }
      }}
      onPointerMove={updateTiltFromPointer}
      onPointerLeave={() => {
        setIsHovered(false);
        resetTilt();
        handlePointerEnd();
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerEnd}
      onPointerCancel={() => {
        resetTilt();
        handlePointerEnd();
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          lockPressFiredRef.current = false;
          return;
        }
        if (isLocked) {
          if (!enableLockControls) return;
          onToggleLock(type);
          return;
        }
        if (!isActive) {
          onActivate(type);
        }
      }}
    >
      {/* Liquid Animation Background */}
      <LiquidWave 
        percent={fillPercent} 
        isVisible={(isActive || isHovered) && showLiquid && !hideLiquid}
        isActive={isActive} 
        colorMode={liquidColor}
      />

      <div className="pointer-events-none absolute inset-0 z-10 rounded-[3rem] mix-blend-screen" style={sheenStyle} />

      {/* Inner Glow */}
      {isActive && (
        <>
          <div className="absolute inset-0 bg-gradient-to-tr from-white/10 via-white/0 to-transparent pointer-events-none z-10" />
          <div className={`absolute -top-1/2 -left-1/2 w-[200%] h-[200%] bg-gradient-to-b from-white/10 to-transparent rounded-full pointer-events-none mix-blend-overlay z-10 ${disableBlur ? '' : 'blur-[80px]'}`} />
          <div className="absolute inset-0 shadow-[inset_0_0_60px_rgba(255,255,255,0.1)] rounded-[3rem] pointer-events-none z-20" />
        </>
      )}

      {/* Label */}
      {!hideLabel && (
        <div className={`
          z-20 pointer-events-none font-bold uppercase transition-all duration-500 max-w-[82%] text-center relative
          ${shouldPromoteLabel
            ? 'font-sans tabular-nums leading-[0.9] text-[3.1rem] sm:text-[3.55rem] md:text-6xl lg:text-7xl tracking-normal whitespace-normal break-words'
            : 'text-xs md:text-sm tracking-[0.2em] truncate'
          }
          ${shouldPromoteLabel ? textClasses : labelClasses}
        `}>
          <span className="relative z-10 drop-shadow-md" style={shouldPromoteLabel ? { overflowWrap: 'anywhere' } : undefined}>{labelText}</span>
        </div>
      )}

      {/* Time Display */}
      <div className={`
        z-20 pointer-events-none font-sans tabular-nums font-bold tracking-tighter transition-all duration-500 leading-none relative
        ${displayVariant === 'word'
          ? 'text-[3.1rem] sm:text-[3.55rem] md:text-6xl lg:text-7xl uppercase tracking-normal'
          : 'text-[4.35rem] sm:text-[4.85rem] md:text-8xl lg:text-9xl'
        }
        ${textClasses}
        ${displayVariant === 'time' && time < 0 ? 'text-red-200 drop-shadow-[0_0_15px_rgba(220,38,38,0.5)]' : ''}
        ${displayHidden ? 'opacity-0 scale-75 -translate-y-4 max-h-0 overflow-hidden' : 'opacity-100 max-h-40'}
      `}>
        <span className="drop-shadow-lg filter">{displayValue || formatTime(time)}</span>
      </div>

      {/* Action Hint */}
      {enableLockControls && (
        <div className={`
           z-20 absolute bottom-8 flex items-center justify-center gap-1.5 text-[10px] text-white/80 uppercase tracking-widest whitespace-nowrap
           transition-all duration-300 transform drop-shadow-md pointer-events-none
           ${isLocked || isHovered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}
        `}>
           {isLocked ? (
             <>
               <Lock size={12} strokeWidth={2.4} className="text-white" aria-hidden="true" />
               <span className="text-white">Timer Locked</span>
             </>
           ) : (
             <span>{(isActive || (allowHoldWhenInactive && holdHintLabel)) ? activeHoldHint : `Click to ${isWork ? 'Focus' : 'Switch'}`}</span>
           )}
        </div>
      )}
    </div>
  );
};

const TimerDisplay: React.FC = () => {
  const {
    workTime,
    breakTime,
    activeMode,
    timerStarted,
    isIdle,
    lockedTimerMode,
    allPauseActive,
    graceOpen,
    activateMode,
    toggleTimerLock,
    restartActiveTimer,
    activeTask,
    settings,
    logs,
    sessionStartTime,
    timerActivityStartTime,
  } = useTimer();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [isFocusTimerHidden, setIsFocusTimerHidden] = useState(false);
  
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressRef = useRef(false);
  const isPressingResetRef = useRef(false);
  const focusDisplaySessionRef = useRef<string | null>(null);
  const focusDisplaySecondsRef = useRef(0);

  const clearResetTimeout = () => {
    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current);
      resetTimeoutRef.current = null;
    }
  };

  const handleResetDown = () => {
    isPressingResetRef.current = true;
    isLongPressRef.current = false;
    clearResetTimeout();
    resetTimeoutRef.current = setTimeout(() => {
      if (!isPressingResetRef.current) return;
      isLongPressRef.current = true;
      isPressingResetRef.current = false;
      openEdit();
    }, 500);
  };

  const handleResetUp = () => {
    if (!isPressingResetRef.current) return;
    isPressingResetRef.current = false;
    clearResetTimeout();
    if (!isLongPressRef.current) {
      restartActiveTimer();
    }
  };

  const handleResetLeave = () => {
    if (!isPressingResetRef.current) return;
    isPressingResetRef.current = false;
    clearResetTimeout();
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

  const isFocusTimerPreset = settings.timerPreset === 'focus';
  useEffect(() => {
    if (!isFocusTimerPreset) setIsFocusTimerHidden(false);
  }, [isFocusTimerPreset]);

  const toggleFocusTimerHidden = () => {
    setIsFocusTimerHidden(prev => !prev);
  };

  const focusTimerNowMs = Date.now();
  const rawFocusTimerDisplaySeconds = isFocusTimerPreset
    ? getFocusTimerDisplaySeconds({
      logs,
      sessionStartTime,
      nowMs: focusTimerNowMs,
      timerStarted,
      isIdle,
      activeMode,
      currentActivityStartTime: timerActivityStartTime,
      workTime,
      workDuration: settings.workDuration,
      allPauseActive,
      graceOpen,
    })
    : 0;
  if (!isFocusTimerPreset) {
    focusDisplaySessionRef.current = null;
    focusDisplaySecondsRef.current = 0;
  } else if (focusDisplaySessionRef.current !== sessionStartTime) {
    focusDisplaySessionRef.current = sessionStartTime;
    focusDisplaySecondsRef.current = 0;
  }
  if (isFocusTimerPreset && !sessionStartTime && isIdle) {
    focusDisplaySecondsRef.current = 0;
  }
  const focusTimerDisplaySeconds = isFocusTimerPreset
    ? Math.max(rawFocusTimerDisplaySeconds, focusDisplaySecondsRef.current)
    : 0;
  if (isFocusTimerPreset) {
    focusDisplaySecondsRef.current = focusTimerDisplaySeconds;
  }
  const focusTimerDisplayValue = formatTime(focusTimerDisplaySeconds);

  return (
    <div className="relative w-full flex flex-col items-center py-4 px-2">
      <style>{`
        @keyframes wave-rotate { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes doro-reset-icon-spin {
          from {
            transform: rotate(0turn);
          }
          to {
            transform: rotate(-1turn);
          }
        }
        /* Slower animations for more satisfying, less chaotic feel */
        .animate-wave-slow { animation: wave-rotate 40s linear infinite; }
        .animate-wave-med { animation: wave-rotate 32s linear infinite reverse; }
        .animate-wave-fast { animation: wave-rotate 25s linear infinite; }
        .doro-reset-icon {
          transform-origin: center;
          transform-box: fill-box;
        }
        .group:hover .doro-reset-icon {
          animation: doro-reset-icon-spin 820ms linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .group:hover .doro-reset-icon {
            animation: none;
          }
        }
        @media (max-width: 767px) {
          .doro-mobile-liquid-shell,
          .doro-mobile-liquid-mask {
            isolation: isolate;
            clip-path: inset(0 round 3rem);
            -webkit-clip-path: inset(0 round 3rem);
            -webkit-mask-image: -webkit-radial-gradient(white, black);
            mask-image: radial-gradient(white, black);
          }
          .doro-mobile-liquid-mask > div {
            transform: translateZ(0);
          }
        }
        .doro-no-spin::-webkit-outer-spin-button,
        .doro-no-spin::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .doro-no-spin[type='number'] {
          -moz-appearance: textfield;
          appearance: textfield;
        }
      `}</style>
      
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
                    className="doro-no-spin w-48 bg-transparent text-8xl text-white font-sans tabular-nums font-bold text-center outline-none border-b border-white/10 focus:border-white/50 transition-colors pb-2 placeholder-white/10"
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
            onMouseLeave={handleResetLeave}
            onTouchStart={handleResetDown}
            onTouchEnd={handleResetUp}
            onTouchCancel={handleResetLeave}
            className={`absolute -top-5 md:-top-12 z-50 flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white/40 hover:text-white transition-all duration-500 group active:scale-95 select-none opacity-50 hover:opacity-100 ${settings.disableBlur ? '' : 'backdrop-blur-md blur-[2px] hover:blur-0'}`}
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="doro-reset-icon transform-gpu will-change-transform"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            <div className="flex flex-col items-start leading-none">
                <span className="text-xs font-bold tracking-wider uppercase">Reset</span>
                <span className="text-[8px] tracking-wide opacity-0 group-hover:opacity-60 transition-opacity h-0 group-hover:h-auto overflow-visible absolute top-full mt-1 w-32 left-1/2 -translate-x-1/2 text-center">Hold to Edit</span>
            </div>
        </button>
      )}

      {/* Timer Container */}
      <div className="flex flex-col md:flex-row items-center justify-center gap-6 md:gap-10 lg:gap-24 w-full mt-8 md:mt-0">
        <TimerSquare 
            type="work" 
            time={workTime}
            maxTime={settings.workDuration}
            activeMode={activeMode} 
            label={activeTask ? activeTask.name : (isFocusTimerPreset ? 'Focus Timer' : 'Focus')}
            displayValue={isFocusTimerPreset ? focusTimerDisplayValue : undefined}
            displayHidden={isFocusTimerPreset && isFocusTimerHidden}
            hideLiquid={isFocusTimerPreset}
            isIdle={isIdle} 
            isLocked={!isFocusTimerPreset && lockedTimerMode === 'work'}
            disableBlur={settings.disableBlur}
            enableLockControls
            allowHoldWhenInactive={isFocusTimerPreset}
            holdHintLabel={isFocusTimerPreset ? (isFocusTimerHidden ? 'Hold to Show Timer' : 'Hold to Hide Timer') : undefined}
            promoteLabelWhenDisplayHidden={isFocusTimerPreset}
            onActivate={activateMode} 
            onToggleLock={toggleTimerLock}
            onHoldAction={isFocusTimerPreset ? toggleFocusTimerHidden : undefined}
        />
        <TimerSquare 
            type="break" 
            time={breakTime}
            maxTime={settings.longBreakDuration}
            activeMode={activeMode} 
            displayValue={isFocusTimerPreset ? 'Break' : undefined}
            displayVariant={isFocusTimerPreset ? 'word' : 'time'}
            hideLabel={isFocusTimerPreset}
            hideLiquid={isFocusTimerPreset}
            isIdle={isIdle} 
            isLocked={!isFocusTimerPreset && lockedTimerMode === 'break'}
            disableBlur={settings.disableBlur}
            enableLockControls={!isFocusTimerPreset}
            onActivate={activateMode} 
            onToggleLock={toggleTimerLock}
        />
      </div>
    </div>
  );
};

export default TimerDisplay;
