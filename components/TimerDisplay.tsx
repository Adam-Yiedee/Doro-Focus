
import React, { useEffect, useRef, useState } from 'react';
import { Check, Clock, HelpCircle, Lock, Play, Timer as TimerIcon, Volume2, VolumeX } from 'lucide-react';
import { useTimer } from '../context/TimerContext';
import type { MiniPomoAutoStartBlock, TimerPreset, TimerSettings } from '../types';
import { getFocusTimerDisplaySeconds } from '../utils/focusTimerDisplay';
import { DEFAULT_WORK_SURFACE, getMutedSurfaceColor } from '../utils/palette';
import { TIMER_PRESETS } from '../utils/timerRuntime';

const formatTime = (seconds: number) => {
  const absSec = Math.abs(seconds);
  const m = Math.floor(absSec / 60);
  const s = Math.floor(absSec % 60);
  const sign = seconds < 0 ? '-' : '';
  return `${sign}${m}:${s.toString().padStart(2, '0')}`;
};

export const getBreakSquareDisplayOptions = ({
  isFocusTimerPreset,
  isDelayedStartCountdown,
}: {
  isFocusTimerPreset: boolean;
  isDelayedStartCountdown: boolean;
}) => {
  if (!isFocusTimerPreset) {
    return {
      displayValue: undefined,
      displayVariant: 'time' as const,
      hideLabel: false,
      hideLiquid: false,
    };
  }

  if (isDelayedStartCountdown) {
    return {
      displayValue: undefined,
      displayVariant: 'time' as const,
      hideLabel: false,
      hideLiquid: false,
    };
  }

  return {
    displayValue: 'Break',
    displayVariant: 'word' as const,
    hideLabel: true,
    hideLiquid: true,
  };
};

export const getFocusTimerSingleLabel = ({
  isReadyToStart,
  activeTaskName,
}: {
  isReadyToStart: boolean;
  activeTaskName?: string | null;
}) => {
  if (isReadyToStart) return 'Click to Start';
  const normalizedTaskName = typeof activeTaskName === 'string' ? activeTaskName.trim() : '';
  return normalizedTaskName || 'Focus Timer';
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
  const isFocusTimerRevealMode = promoteLabelWhenDisplayHidden && !hideLabel;
  const [isHoldPriming, setIsHoldPriming] = useState(false);

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
    if (isFocusTimerRevealMode && onHoldAction) setIsHoldPriming(true);
    clearLockTimeout();
    lockTimeoutRef.current = setTimeout(() => {
      lockTimeoutRef.current = null;
      lockPressFiredRef.current = true;
      suppressClickRef.current = true;
      setIsHoldPriming(false);
      (onHoldAction || onToggleLock)(type);
    }, 550);
  };

  const handlePointerEnd = () => {
    setIsHoldPriming(false);
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
  const shouldPromoteLabel = isFocusTimerRevealMode && displayHidden;
  const labelText = label || (isWork ? 'Focus' : 'Break Bank');
  const activeHoldHint = holdHintLabel || 'Hold to Lock';
  const labelLength = labelText.trim().length;
  const focusLabelLengthClass = !isFocusTimerRevealMode
    ? ''
    : labelLength > 42
      ? 'doro-focus-label-long'
      : labelLength > 18
        ? 'doro-focus-label-medium'
        : 'doro-focus-label-short';

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
  const focusToneClasses = isActive
    ? 'text-white drop-shadow-2xl'
    : isHovered
      ? 'text-white/90'
      : `text-white/50 saturate-50 ${disableBlur ? '' : 'blur-[2px]'}`;

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
        ${isFocusTimerRevealMode ? `doro-focus-timer-shell ${displayHidden ? 'doro-focus-timer-is-hidden' : 'doro-focus-timer-is-visible'} ${focusLabelLengthClass}` : ''}
        ${isHoldPriming ? 'doro-focus-timer-hold-priming' : ''}
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
          z-20 pointer-events-none font-bold text-center relative
          ${isFocusTimerRevealMode
            ? `doro-focus-timer-label font-sans tabular-nums ${focusToneClasses}`
            : `uppercase transition-all duration-500 max-w-[82%] ${shouldPromoteLabel
                ? 'font-sans tabular-nums leading-[0.9] text-[3.1rem] sm:text-[3.55rem] md:text-6xl lg:text-7xl tracking-normal whitespace-normal break-words'
                : 'text-xs md:text-sm tracking-[0.2em] truncate'
              } ${shouldPromoteLabel ? textClasses : labelClasses}`
          }
        `}>
          <span className={`relative z-10 drop-shadow-md ${isFocusTimerRevealMode ? 'doro-focus-timer-label-text' : ''}`} style={!isFocusTimerRevealMode && shouldPromoteLabel ? { overflowWrap: 'anywhere' } : undefined}>{labelText}</span>
        </div>
      )}

      {/* Time Display */}
      <div className={`
        z-20 pointer-events-none font-sans tabular-nums font-bold tracking-tighter leading-none relative
        ${isFocusTimerRevealMode ? 'doro-focus-timer-time' : 'transition-all duration-500'}
        ${displayVariant === 'word'
          ? 'text-[3.1rem] sm:text-[3.55rem] md:text-6xl lg:text-7xl uppercase tracking-normal'
          : 'text-[4.35rem] sm:text-[4.85rem] md:text-8xl lg:text-9xl'
        }
        ${isFocusTimerRevealMode ? focusToneClasses : textClasses}
        ${displayVariant === 'time' && time < 0 ? 'text-red-200 drop-shadow-[0_0_15px_rgba(220,38,38,0.5)]' : ''}
        ${isFocusTimerRevealMode ? '' : displayHidden ? 'opacity-0 scale-75 -translate-y-4 max-h-0 overflow-hidden' : 'opacity-100 max-h-40'}
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

const FOCUS_TIMER_FLIP_ANIMATION_MS = 440;
const FOCUS_TIMER_FLIP_EASING = 'cubic-bezier(0.42, 0, 0.58, 1)';
const requestDoroAnimationFrame = (callback: FrameRequestCallback) => {
  if (typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(Date.now()), 16);
};
const cancelDoroAnimationFrame = (handle: number) => {
  if (typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(handle);
    return;
  }
  window.clearTimeout(handle);
};

type FocusTimerSingleFace = 'work' | 'break';
type FocusTimerFlipAction = 'pause' | 'resume' | null;

export const getFocusTimerFlipAction = ({
  nextFace,
  timerStarted,
  focusFlipPauseActive,
}: {
  nextFace: FocusTimerSingleFace;
  timerStarted: boolean;
  focusFlipPauseActive: boolean;
}): FocusTimerFlipAction => {
  if (nextFace === 'break' && timerStarted && !focusFlipPauseActive) return 'pause';
  if (nextFace === 'work' && focusFlipPauseActive) return 'resume';
  return null;
};

interface FocusTimerSingleDisplayProps {
  workTime: number;
  breakTime: number;
  activeMode: 'work' | 'break';
  focusLabel: string;
  focusDisplayValue: string;
  focusDisplayHidden: boolean;
  breakLabel?: string;
  breakDisplayValue?: string;
  breakDisplayVariant: 'time' | 'word';
  breakHideLabel: boolean;
  isIdle: boolean;
  timerStarted: boolean;
  focusFlipPauseActive: boolean;
  surfaceColor: string;
  disableBlur: boolean;
  canStartOnClick: boolean;
  onStart: () => void;
  onPauseForFlip: () => void;
  onResumeFromFlip: () => void;
  onToggleFocusHidden: () => void;
}

const FocusTimerSingleDisplay: React.FC<FocusTimerSingleDisplayProps> = ({
  workTime,
  breakTime,
  activeMode,
  focusLabel,
  focusDisplayValue,
  focusDisplayHidden,
  breakLabel,
  breakDisplayValue,
  breakDisplayVariant,
  breakHideLabel,
  isIdle,
  timerStarted,
  focusFlipPauseActive,
  surfaceColor,
  disableBlur,
  canStartOnClick,
  onStart,
  onPauseForFlip,
  onResumeFromFlip,
  onToggleFocusHidden,
}) => {
  const [displaySide, setDisplaySide] = useState<'active' | 'alternate'>(focusFlipPauseActive ? 'alternate' : 'active');
  const [isFlipAnimating, setIsFlipAnimating] = useState(false);
  const [flipDirection, setFlipDirection] = useState<'to-active' | 'to-alternate' | null>(null);
  const [isHoldPriming, setIsHoldPriming] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [tilt, setTilt] = useState<TimerTiltState>(TIMER_TILT_REST);
  const prefersReducedMotion = usePrefersReducedMotion();
  const flipStepTimeoutRef = useRef<number | null>(null);
  const flipRunIdRef = useRef(0);
  const flipTargetSideRef = useRef<'active' | 'alternate' | null>(null);
  const flipAnimatingRef = useRef(false);
  const holdTimeoutRef = useRef<number | null>(null);
  const tiltFrameRef = useRef<number | null>(null);
  const pendingTiltRef = useRef<TimerTiltState>(TIMER_TILT_REST);
  const suppressClickRef = useRef(false);

  const activeFace: FocusTimerSingleFace = activeMode === 'break' ? 'break' : 'work';
  const alternateFace: FocusTimerSingleFace = activeFace === 'work' ? 'break' : 'work';
  const visibleFace = displaySide === 'active' ? activeFace : alternateFace;
  const isFlipped = displaySide === 'alternate';

  const clearFlipStepTimeout = () => {
    if (flipStepTimeoutRef.current !== null) {
      window.clearTimeout(flipStepTimeoutRef.current);
      flipStepTimeoutRef.current = null;
    }
  };

  const finishFlip = (runId: number) => {
    if (runId !== flipRunIdRef.current) return;
    const targetSide = flipTargetSideRef.current;
    clearFlipStepTimeout();
    if (targetSide) {
      setDisplaySide(targetSide);
    }
    flipTargetSideRef.current = null;
    setFlipDirection(null);
    setIsFlipAnimating(false);
    flipAnimatingRef.current = false;
  };

  const clearHoldTimeout = () => {
    if (holdTimeoutRef.current !== null) {
      window.clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
  };

  const clearTiltFrame = () => {
    if (tiltFrameRef.current !== null) {
      cancelDoroAnimationFrame(tiltFrameRef.current);
      tiltFrameRef.current = null;
    }
  };

  const commitTilt = (nextTilt: TimerTiltState) => {
    pendingTiltRef.current = nextTilt;
    if (tiltFrameRef.current !== null) return;

    tiltFrameRef.current = requestDoroAnimationFrame(() => {
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
    clearTiltFrame();
    setTilt(TIMER_TILT_REST);
  };

  const updateTiltFromPointer = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (prefersReducedMotion || (event.pointerType !== 'mouse' && event.pointerType !== 'pen')) return;

    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const x = clampUnit(((event.clientX - rect.left) / rect.width - 0.5) * 2);
    const y = clampUnit(((event.clientY - rect.top) / rect.height - 0.5) * 2);
    const easedX = Math.sign(x) * Math.pow(Math.abs(x), 0.86);
    const easedY = Math.sign(y) * Math.pow(Math.abs(y), 0.86);

    commitTilt({
      x: easedX,
      y: easedY,
      intensity: Math.min(1, Math.hypot(easedX, easedY)),
    });
  };

  useEffect(() => {
    setDisplaySide('active');
    setIsFlipAnimating(false);
    setFlipDirection(null);
    flipTargetSideRef.current = null;
    flipAnimatingRef.current = false;
    setIsHoldPriming(false);
    setIsHovered(false);
    resetTilt();
    flipRunIdRef.current += 1;
    clearFlipStepTimeout();
    clearHoldTimeout();
  }, [activeMode]);

  useEffect(() => () => {
    flipRunIdRef.current += 1;
    flipTargetSideRef.current = null;
    clearFlipStepTimeout();
    clearHoldTimeout();
    clearTiltFrame();
  }, []);

  const beginFlip = () => {
    if (flipAnimatingRef.current) return;
    flipRunIdRef.current += 1;
    clearFlipStepTimeout();
    const flipRunId = flipRunIdRef.current;
    const nextDisplaySide = displaySide === 'active' ? 'alternate' : 'active';
    const nextFlipDirection = nextDisplaySide === 'alternate' ? 'to-alternate' : 'to-active';
    const nextFace = nextDisplaySide === 'active' ? activeFace : alternateFace;
    const timerAction = getFocusTimerFlipAction({
      nextFace,
      timerStarted,
      focusFlipPauseActive,
    });
    if (timerAction === 'pause') onPauseForFlip();
    else if (timerAction === 'resume') onResumeFromFlip();
    flipTargetSideRef.current = nextDisplaySide;
    setFlipDirection(nextFlipDirection);
    if (prefersReducedMotion) {
      setDisplaySide(nextDisplaySide);
      setFlipDirection(null);
      flipTargetSideRef.current = null;
      return;
    }
    flipAnimatingRef.current = true;
    setIsFlipAnimating(true);
    flipStepTimeoutRef.current = window.setTimeout(() => {
      finishFlip(flipRunId);
    }, FOCUS_TIMER_FLIP_ANIMATION_MS + 80);
  };

  const beginHold = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (flipAnimatingRef.current) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
      setIsHovered(true);
      updateTiltFromPointer(event);
    }

    clearHoldTimeout();
    suppressClickRef.current = false;
    if (visibleFace === 'work') setIsHoldPriming(true);
    holdTimeoutRef.current = window.setTimeout(() => {
      holdTimeoutRef.current = null;
      setIsHoldPriming(false);
      if (visibleFace !== 'work') return;
      suppressClickRef.current = true;
      onToggleFocusHidden();
    }, 550);
  };

  const endHold = () => {
    clearHoldTimeout();
    setIsHoldPriming(false);
  };

  const handleClick = () => {
    if (suppressClickRef.current) {
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      return;
    }
    if (canStartOnClick) {
      onStart();
      return;
    }
    beginFlip();
  };

  const focusLabelLength = focusLabel.trim().length;
  const focusLabelLengthClass = focusLabelLength > 42
    ? 'doro-focus-label-long'
    : focusLabelLength > 18
      ? 'doro-focus-label-medium'
      : 'doro-focus-label-short';
  const effectiveTilt = prefersReducedMotion || isFlipAnimating ? TIMER_TILT_REST : tilt;
  const raisedByInteraction = isHovered || isFlipAnimating;
  const baseTranslateY = isHovered ? -9 : 0;
  const hoverDepth = isHovered ? 4 : 0;
  const baseScale = isHovered ? 1.02 : 1;
  const tiltBoost = isHovered && !isFlipAnimating ? 1 + (effectiveTilt.intensity * 0.001) : 1;
  const rotateX = -effectiveTilt.y * 1.5;
  const rotateY = effectiveTilt.x * 1.68;
  const focusCardStyle: React.CSSProperties = {
    transform: `translate3d(0, ${baseTranslateY}px, ${hoverDepth}px) scale(${baseScale * tiltBoost}) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
    transformOrigin: 'center',
    transformStyle: 'preserve-3d',
    transition: prefersReducedMotion
      ? 'opacity 220ms ease'
      : isFlipAnimating
        ? `transform ${FOCUS_TIMER_FLIP_ANIMATION_MS}ms ${FOCUS_TIMER_FLIP_EASING}, opacity 240ms ease`
        : isHovered
          ? 'transform 130ms ease-out, opacity 450ms ease'
          : 'transform 420ms cubic-bezier(0.16,0.9,0.3,1), opacity 560ms cubic-bezier(0.2,0.8,0.2,1)',
    willChange: 'transform',
  };
  const sheenStyle: React.CSSProperties = {
    background: `radial-gradient(circle at ${50 + effectiveTilt.x * 7}% ${42 + effectiveTilt.y * 7}%, rgba(255,255,255,0.14), rgba(255,255,255,0.035) 32%, transparent 66%)`,
    opacity: isHovered && !prefersReducedMotion ? 0.08 + (effectiveTilt.intensity * 0.03) : 0,
    transform: 'translateZ(5px)',
    transition: isHovered ? 'opacity 130ms ease-out, background 130ms ease-out' : 'opacity 420ms ease-out',
  };
  const cardInnerStyle: React.CSSProperties = {
    boxShadow: getTimerTiltShadow(true, raisedByInteraction, effectiveTilt),
    transition: prefersReducedMotion
      ? 'box-shadow 220ms ease'
      : isFlipAnimating
        ? `box-shadow ${FOCUS_TIMER_FLIP_ANIMATION_MS}ms ${FOCUS_TIMER_FLIP_EASING}`
        : isHovered
          ? 'box-shadow 130ms ease-out'
          : 'box-shadow 420ms cubic-bezier(0.16,0.9,0.3,1)',
  };
  const renderFace = (face: FocusTimerSingleFace) => {
    if (face === 'work') {
      return (
        <div className={`doro-focus-single-face-content ${focusDisplayHidden ? 'is-display-hidden' : ''}`}>
          <div className="doro-focus-single-label">
            <span>{focusLabel}</span>
          </div>
          <div className="doro-focus-single-value">
            <span>{focusDisplayHidden ? focusLabel : focusDisplayValue || formatTime(workTime)}</span>
          </div>
          <div className="doro-focus-single-hint">
            {canStartOnClick ? 'Click to Start' : focusDisplayHidden ? 'Hold to Show Timer' : 'Hold to Hide Timer'}
          </div>
        </div>
      );
    }

    const breakValue = breakDisplayValue || formatTime(breakTime);
    return (
      <div className={`doro-focus-single-face-content is-break-face ${breakDisplayVariant === 'word' ? 'is-word-face' : ''}`}>
        {!breakHideLabel && breakLabel && (
          <div className="doro-focus-single-label">
            <span>{breakLabel}</span>
          </div>
        )}
        <div className="doro-focus-single-value">
          <span>{breakValue}</span>
        </div>
      </div>
    );
  };

  return (
    <button
      type="button"
      aria-label={canStartOnClick ? 'Start focus timer' : visibleFace === 'work' ? 'Show break timer' : 'Show active timer'}
      className={`doro-focus-single-card ${focusLabelLengthClass} ${isFlipped ? 'is-flipped' : ''} ${isFlipAnimating ? 'is-flip-animating' : ''} ${flipDirection ? `is-flip-${flipDirection}` : ''} ${isHoldPriming ? 'is-hold-priming' : ''} ${canStartOnClick ? 'is-ready-to-start' : ''} ${isIdle ? 'is-idle' : ''} ${disableBlur ? 'is-blur-disabled' : ''}`}
      style={{
        ...focusCardStyle,
        ['--doro-focus-single-surface' as any]: surfaceColor,
      }}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
          setIsHovered(true);
          updateTiltFromPointer(event);
        }
      }}
      onPointerMove={updateTiltFromPointer}
      onPointerDown={beginHold}
      onPointerUp={endHold}
      onPointerLeave={() => {
        setIsHovered(false);
        resetTilt();
        endHold();
      }}
      onPointerCancel={() => {
        setIsHovered(false);
        resetTilt();
        endHold();
      }}
      onClick={handleClick}
    >
      <span className="doro-focus-single-card-lift">
        <span
          className="doro-focus-single-card-inner"
          style={cardInnerStyle}
          onAnimationEnd={(event) => {
            if (!event.animationName.startsWith('doro-focus-single-card-flip-')) return;
            if (!isFlipAnimating) return;
            finishFlip(flipRunIdRef.current);
          }}
        >
          <span className="doro-focus-single-face doro-focus-single-front">
            <span className="doro-focus-single-sheen" style={sheenStyle} />
            {renderFace(activeFace)}
          </span>
          <span className="doro-focus-single-face doro-focus-single-back">
            <span className="doro-focus-single-sheen" style={sheenStyle} />
            {renderFace(alternateFace)}
          </span>
        </span>
      </span>
    </button>
  );
};

type IdlePresetMenuValue = Exclude<TimerPreset, 'custom'>;
type IdlePresetMenuView = 'choices' | 'timer' | 'delayed';
const START_SESSION_MENU_CLOSE_SETTLE_MS = 660;
const START_SESSION_EXIT_DURATION_MS = 840;
const TIMER_MODE_TRANSITION_OUT_MS = 300;
const TIMER_MODE_TRANSITION_IN_MS = 520;

interface IdlePresetControlProps {
  isRendered: boolean;
  isVisible: boolean;
  isOpen: boolean;
  settings: TimerSettings;
  surfaceColor: string;
  chromeButtonClass: string;
  topIconClass: string;
  onOpenChange: (isOpen: boolean) => void;
  onSelectPreset: (preset: IdlePresetMenuValue) => void;
  onSelectMiniPomoBlock: (block: MiniPomoAutoStartBlock) => void;
  onToggleMiniPomoAutoStartSound: () => void;
  onStartDelayedStart: (minutes: number) => void;
}

const formatPresetMinutes = (workSeconds: number, shortBreakSeconds: number, longBreakSeconds: number) => (
  `${Math.round(workSeconds / 60)} / ${Math.round(shortBreakSeconds / 60)} / ${Math.round(longBreakSeconds / 60)}`
);

const getDelayedStartPreviewDate = (minutes: number, nowMs: number) => {
  const target = new Date(nowMs);
  target.setSeconds(0, 0);
  target.setMinutes(target.getMinutes() + Math.min(30, Math.max(1, Math.round(minutes))));
  if (target.getTime() <= nowMs) {
    target.setMinutes(target.getMinutes() + 1);
  }
  return target;
};

const formatDelayedStartTime = (date: Date) => (
  date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
);

const MINI_POMO_BLOCK_OPTIONS: Array<{ value: MiniPomoAutoStartBlock; label: string }> = [
  { value: 1, label: '1 mini-pomo' },
  { value: 2, label: '2 mini-pomo' },
  { value: 3, label: '3 mini-pomo' },
  { value: 4, label: '4 mini-pomo' },
];

type MiniPomoPopoutSide = 'right' | 'left' | 'below';

const getMiniPomoAutoStartBlock = (settings: TimerSettings): MiniPomoAutoStartBlock => {
  const value = settings.miniPomoAutoStartBlock;
  return value === 1 || value === 2 || value === 3 || value === 4
    ? value
    : settings.twoInARowMode ? 2 : 1;
};

const IdlePresetControl: React.FC<IdlePresetControlProps> = ({
  isRendered,
  isVisible,
  isOpen,
  settings,
  surfaceColor,
  chromeButtonClass,
  topIconClass,
  onOpenChange,
  onSelectPreset,
  onSelectMiniPomoBlock,
  onToggleMiniPomoAutoStartSound,
  onStartDelayedStart,
}) => {
  const controlRef = useRef<HTMLDivElement | null>(null);
  const miniPomoBranchRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(isOpen);
  const [, forceClosedSettledRender] = useState(0);
  const [menuView, setMenuView] = useState<IdlePresetMenuView>('choices');
  const [isMenuViewSettled, setIsMenuViewSettled] = useState(false);
  const [miniPomoPopoutSide, setMiniPomoPopoutSide] = useState<MiniPomoPopoutSide>('right');
  const [delayedMinutes, setDelayedMinutes] = useState(5);
  const [previewNowMs, setPreviewNowMs] = useState(() => Date.now());
  const wasOpenOnPreviousRender = wasOpenRef.current;
  const isClosingFromOpen = !isOpen && wasOpenOnPreviousRender;

  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
      return undefined;
    }

    if (!wasOpenRef.current) return undefined;

    const timeoutId = window.setTimeout(() => {
      wasOpenRef.current = false;
      forceClosedSettledRender(value => value + 1);
    }, START_SESSION_MENU_CLOSE_SETTLE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (controlRef.current?.contains(target)) return;
      onOpenChange(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    if (!isOpen) {
      const timeoutId = window.setTimeout(() => setMenuView('choices'), START_SESSION_MENU_CLOSE_SETTLE_MS);
      setIsMenuViewSettled(false);
      return () => window.clearTimeout(timeoutId);
    }

    setPreviewNowMs(Date.now());
    const intervalId = window.setInterval(() => setPreviewNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    setIsMenuViewSettled(false);
    const timeoutId = window.setTimeout(() => setIsMenuViewSettled(true), 760);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen, menuView]);

  useEffect(() => {
    if (!isOpen || menuView !== 'timer') return undefined;

    const updatePopoutSide = () => {
      const branch = miniPomoBranchRef.current;
      if (!branch) return;

      const rect = branch.getBoundingClientRect();
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      const popoutWidth = 224;
      const gap = 18;
      const margin = 12;
      const fitsRight = viewportWidth - rect.right >= popoutWidth + gap + margin;
      const fitsLeft = rect.left >= popoutWidth + gap + margin;

      setMiniPomoPopoutSide(fitsRight ? 'right' : fitsLeft ? 'left' : 'below');
    };

    updatePopoutSide();
    const settleTimeout = window.setTimeout(updatePopoutSide, 640);
    window.addEventListener('resize', updatePopoutSide);
    window.addEventListener('scroll', updatePopoutSide, true);

    return () => {
      window.clearTimeout(settleTimeout);
      window.removeEventListener('resize', updatePopoutSide);
      window.removeEventListener('scroll', updatePopoutSide, true);
    };
  }, [isOpen, menuView]);

  if (!isRendered) return null;

  const activePreset: IdlePresetMenuValue = (
    settings.timerPreset === 'classic' || settings.timerPreset === 'compact'
      ? settings.timerPreset
      : 'focus'
  );
  const activeMiniPomoBlock = getMiniPomoAutoStartBlock(settings);
  const isMiniPomoAutoStartSoundEnabled = settings.miniPomoAutoStartSoundEnabled !== false;

  const presetOptions: Array<{ value: IdlePresetMenuValue; label: string; detail: string; recommended?: boolean }> = [
    {
      value: 'compact',
      label: 'Mini Pomos',
      recommended: true,
      detail: formatPresetMinutes(
        TIMER_PRESETS.compact.workDuration,
        TIMER_PRESETS.compact.shortBreakDuration,
        TIMER_PRESETS.compact.longBreakDuration,
      ),
    },
    {
      value: 'classic',
      label: 'Traditional',
      detail: formatPresetMinutes(
        TIMER_PRESETS.classic.workDuration,
        TIMER_PRESETS.classic.shortBreakDuration,
        TIMER_PRESETS.classic.longBreakDuration,
      ),
    },
    {
      value: 'focus',
      label: 'Focus Timer',
      detail: 'Unstructured Focus',
    },
  ];

  const shellStateClass = !isVisible
    ? `is-exiting${isClosingFromOpen ? ' is-exiting-from-menu' : ''}`
    : isOpen
      ? 'is-open'
      : isClosingFromOpen
        ? 'is-closing'
        : 'is-closed';
  const shellViewClass = (isOpen || isClosingFromOpen) ? `view-${menuView}` : 'view-choices';
  const shellViewMotionClass = isOpen
    ? isMenuViewSettled
      ? 'is-view-settled'
      : 'is-view-entering'
    : '';
  const choicePanelStateClass = menuView === 'choices'
    ? 'is-active'
    : menuView === 'timer'
      ? 'is-drilling-timer'
      : 'is-drilling-delayed';
  const delayedStartDate = getDelayedStartPreviewDate(delayedMinutes, previewNowMs);
  const delayedStartTimeLabel = formatDelayedStartTime(delayedStartDate);
  const delayedSliderPercent = ((delayedMinutes - 1) / 29) * 100;

  return (
    <div ref={controlRef} className="relative z-40 flex shrink-0 items-center justify-center self-center">
      <div
        className={`
          doro-start-session-shell ${shellStateClass} ${shellViewClass} ${shellViewMotionClass}
          relative ${isOpen ? 'overflow-visible' : 'overflow-hidden'} border transform-gpu
          ${chromeButtonClass}
        `}
        style={{ ['--doro-start-popout-surface' as any]: surfaceColor }}
      >
        <button
          type="button"
          aria-label="Open start session menu"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          title="Start Session"
          tabIndex={isOpen ? -1 : 0}
          onClick={() => onOpenChange(true)}
          className={`
            doro-start-session-button absolute inset-0 flex items-center justify-center
            focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40
          `}
        >
          <Clock size={18} strokeWidth={2.15} className={topIconClass} />
        </button>

        <div
          role="menu"
          aria-label="Timer mode"
          aria-hidden={!isOpen}
          className={`
            doro-start-session-menu relative h-full min-w-0
            ${isOpen ? '' : 'pointer-events-none'}
          `}
        >
          <div className={`doro-start-session-panel doro-start-choice-panel ${choicePanelStateClass}`}>
            <button
              type="button"
              role="menuitem"
              tabIndex={isOpen && menuView === 'choices' ? 0 : -1}
              onClick={() => {
                setIsMenuViewSettled(false);
                setMenuView('timer');
              }}
              className="doro-start-session-choice doro-start-session-choice-timer group/choice"
              style={{ ['--doro-start-choice-delay' as any]: '130ms' }}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.12] bg-white/[0.08] text-white/88">
                <TimerIcon size={16} strokeWidth={2.2} />
              </span>
              <span className="min-w-0 text-left">
                <span className="block text-[10px] font-bold uppercase leading-tight tracking-[0.13em] text-white">Focus Timers</span>
                <span className="mt-0.5 block truncate font-mono text-[10px] font-semibold text-white/[0.52] group-hover/choice:text-white/[0.68]">
                  Select Mode
                </span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              tabIndex={isOpen && menuView === 'choices' ? 0 : -1}
              onClick={() => {
                setIsMenuViewSettled(false);
                setMenuView('delayed');
              }}
              className="doro-start-session-choice doro-start-session-choice-delayed group/choice"
              style={{ ['--doro-start-choice-delay' as any]: '205ms' }}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.12] bg-white/[0.08] text-white/88">
                <span className="doro-start-sleep-icon" aria-hidden="true">Zzz</span>
              </span>
              <span className="min-w-0 text-left">
                <span className="block text-[10px] font-bold uppercase leading-tight tracking-[0.13em] text-white">Delayed Start</span>
                <span className="mt-0.5 block truncate font-mono text-[10px] font-semibold text-white/[0.52] group-hover/choice:text-white/[0.68]">
                  Procrastinate
                </span>
              </span>
            </button>
          </div>

          <div
            className={`doro-start-session-panel doro-start-timer-panel flex-col gap-1.5 ${menuView === 'timer' ? 'is-active' : ''}`}
            aria-hidden={menuView !== 'timer'}
          >
            {presetOptions.map((option, index) => {
              const isActivePreset = activePreset === option.value;
              const optionButton = (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActivePreset}
                  tabIndex={isOpen && menuView === 'timer' ? 0 : -1}
                  onClick={() => onSelectPreset(option.value)}
                  className={`
                    doro-start-session-option group/preset flex min-h-[3rem] w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left
                    transition-[background-color,border-color,color,transform] duration-300 active:scale-[0.98]
                    ${isActivePreset
                      ? 'border-white/[0.24] bg-black/[0.36] text-white hover:border-white/[0.34] hover:bg-black/[0.44]'
                      : 'border-white/[0.16] bg-black/[0.26] text-white/[0.86] hover:border-white/[0.28] hover:bg-black/[0.36] hover:text-white'
                    }
                  `}
                  style={{
                    ['--doro-start-option-delay' as any]: `${150 + (index * 72)}ms`,
                  }}
                >
                  <span className="min-w-0 flex-1 overflow-hidden pr-0.5">
                    <span className="flex max-w-full flex-nowrap items-baseline gap-x-1.5 overflow-hidden text-[10px] font-bold leading-tight">
                      <span className="shrink-0 whitespace-nowrap uppercase tracking-[0.105em]">{option.label}</span>
                      {option.recommended && (
                        <span className="shrink-0 whitespace-nowrap text-[8px] font-semibold normal-case tracking-normal text-white/[0.38]">
                          (Recommended)
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] font-semibold text-white/[0.54] group-hover/preset:text-white/[0.7]">
                      {option.detail}
                    </span>
                  </span>
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all duration-300 ${
                    isActivePreset
                      ? 'border-white/25 bg-white/[0.16] text-white'
                      : 'border-white/10 bg-white/5 text-white/0'
                  }`}>
                    <Check size={12} strokeWidth={2.4} />
                  </span>
                </button>
              );

              if (option.value !== 'compact') return optionButton;

              return (
                <div
                  key={option.value}
                  ref={miniPomoBranchRef}
                  className={`doro-start-mini-pomo-branch is-popout-${miniPomoPopoutSide}`}
                >
                  {optionButton}
                  <div className="doro-start-mini-pomo-popout" role="menu" aria-label="Mini Pomo auto-start sessions">
                    <div className="doro-start-mini-pomo-popout-header">
                      <span className="min-w-0 truncate">Auto-Start</span>
                      <span className="doro-start-mini-pomo-header-actions">
                        <span
                          className="doro-start-mini-pomo-help-wrap"
                          data-tooltip="Auto-start starts mini-pomos back-to-back so you can focus for longer periods of time."
                        >
                          <button
                            type="button"
                            aria-label="What is auto-start?"
                            onClick={(event) => event.stopPropagation()}
                            className="doro-start-mini-pomo-help-button"
                          >
                            <HelpCircle size={13} strokeWidth={2.4} aria-hidden="true" />
                          </button>
                        </span>
                        <span className="doro-start-mini-pomo-sound-wrap" data-tooltip="Auto-start sound">
                          <button
                            type="button"
                            aria-label={isMiniPomoAutoStartSoundEnabled ? 'Turn off auto-start sound' : 'Turn on auto-start sound'}
                            aria-pressed={!isMiniPomoAutoStartSoundEnabled}
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggleMiniPomoAutoStartSound();
                            }}
                            className={`doro-start-mini-pomo-sound-button ${isMiniPomoAutoStartSoundEnabled ? '' : 'is-off'}`}
                          >
                            {isMiniPomoAutoStartSoundEnabled ? (
                              <Volume2 size={13} strokeWidth={2.3} aria-hidden="true" />
                            ) : (
                              <VolumeX size={13} strokeWidth={2.3} aria-hidden="true" />
                            )}
                          </button>
                        </span>
                      </span>
                    </div>
                    <div className="doro-start-mini-pomo-block-list">
                      {MINI_POMO_BLOCK_OPTIONS.map((blockOption, blockIndex) => {
                        const isActiveBlock = activeMiniPomoBlock === blockOption.value;
                        return (
                          <button
                            key={blockOption.value}
                            type="button"
                            role="menuitemradio"
                            aria-checked={isActiveBlock}
                            tabIndex={isOpen && menuView === 'timer' ? 0 : -1}
                            onClick={(event) => {
                              event.stopPropagation();
                              onSelectMiniPomoBlock(blockOption.value);
                            }}
                            className={`doro-start-mini-pomo-block-option ${isActiveBlock ? 'is-active' : ''}`}
                            style={{
                              ['--doro-mini-block-delay' as any]: `${135 + blockIndex * 62}ms`,
                            }}
                          >
                            <span className="doro-start-mini-pomo-block-text">
                              <span className="doro-start-mini-pomo-block-title">{blockOption.label}</span>
                            </span>
                            <span className="doro-start-mini-pomo-block-number">{blockOption.value * 15} minutes</span>
                            <span className="doro-start-mini-pomo-block-check">
                              <Check size={10} strokeWidth={2.5} />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div
            className={`doro-start-session-panel doro-start-delayed-panel flex-col ${menuView === 'delayed' ? 'is-active' : ''}`}
            aria-hidden={menuView !== 'delayed'}
          >
            <div className="doro-start-delayed-time text-center">
              <span className="doro-start-delayed-time-label">Start At:</span>
              <span className="doro-start-delayed-time-value">
                {delayedStartTimeLabel}
              </span>
            </div>
            <div
              className="doro-start-delay-slider-wrap mt-3"
              style={{ ['--doro-delay-progress' as any]: `${delayedSliderPercent}%` }}
            >
              <div className="doro-start-delay-minutes-label" aria-hidden="true">
                {delayedMinutes} min
              </div>
              <input
                type="range"
                min={1}
                max={30}
                step={1}
                value={delayedMinutes}
                aria-label="Delayed start minutes"
                aria-valuetext={`${delayedMinutes} minutes`}
                onChange={(event) => setDelayedMinutes(Number(event.target.value))}
                className="doro-start-delay-slider"
              />
            </div>
            <button
              type="button"
              role="menuitem"
              tabIndex={isOpen && menuView === 'delayed' ? 0 : -1}
              onClick={() => onStartDelayedStart(delayedMinutes)}
              className="doro-start-delayed-start-button mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white"
            >
              <Play size={13} strokeWidth={2.4} fill="currentColor" />
              Start
            </button>
          </div>
        </div>
      </div>
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
    focusFlipPauseActive,
    graceOpen,
    activateMode,
    toggleTimerLock,
    restartActiveTimer,
    startTimer,
    pauseFocusTimerForFlip,
    resumeFocusTimerFromFlip,
    activeTask,
    activeColor,
    settings,
    logs,
    sessionStartTime,
    delayedStartTargetTime,
    timerActivityStartTime,
    focusTimerDisplayOffsetSeconds,
    updateSettings,
    startDelayedStart,
  } = useTimer();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [isFocusTimerHidden, setIsFocusTimerHidden] = useState(false);
  const shouldShowIdlePresetControl = isIdle && !timerStarted;
  const [shouldRenderIdlePresetControl, setShouldRenderIdlePresetControl] = useState(shouldShowIdlePresetControl);
  const [isIdlePresetControlVisible, setIsIdlePresetControlVisible] = useState(shouldShowIdlePresetControl);
  const [isIdlePresetMenuOpen, setIsIdlePresetMenuOpen] = useState(false);
  
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressRef = useRef(false);
  const isPressingResetRef = useRef(false);
  const focusDisplaySessionRef = useRef<string | null>(null);
  const focusDisplaySecondsRef = useRef(0);
  const timerModeTransitionTimeoutsRef = useRef<number[]>([]);

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
  const prefersReducedMotion = usePrefersReducedMotion();
  const [renderedIsFocusTimerPreset, setRenderedIsFocusTimerPreset] = useState(isFocusTimerPreset);
  const renderedFocusTimerPresetRef = useRef(isFocusTimerPreset);
  const [timerModeTransition, setTimerModeTransition] = useState<{
    phase: 'out' | 'in';
    fromFocus: boolean;
    toFocus: boolean;
  } | null>(null);
  const isFocusTimerReadyToStart = renderedIsFocusTimerPreset && isIdle && !timerStarted;
  const focusTimerLabel = getFocusTimerSingleLabel({
    isReadyToStart: isFocusTimerReadyToStart,
    activeTaskName: activeTask?.name,
  });

  const clearTimerModeTransitionTimeouts = () => {
    timerModeTransitionTimeoutsRef.current.forEach(timeoutId => {
      window.clearTimeout(timeoutId);
    });
    timerModeTransitionTimeoutsRef.current = [];
  };

  const setRenderedFocusTimerPreset = (nextIsFocusTimerPreset: boolean) => {
    renderedFocusTimerPresetRef.current = nextIsFocusTimerPreset;
    setRenderedIsFocusTimerPreset(nextIsFocusTimerPreset);
  };

  useEffect(() => {
    const fromFocus = renderedFocusTimerPresetRef.current;
    const toFocus = isFocusTimerPreset;

    if (fromFocus === toFocus) {
      clearTimerModeTransitionTimeouts();
      setTimerModeTransition(null);
      return undefined;
    }

    clearTimerModeTransitionTimeouts();

    if (prefersReducedMotion) {
      setRenderedFocusTimerPreset(toFocus);
      setTimerModeTransition(null);
      return undefined;
    }

    setTimerModeTransition({ phase: 'out', fromFocus, toFocus });

    const swapTimeout = window.setTimeout(() => {
      setRenderedFocusTimerPreset(toFocus);
      setTimerModeTransition({ phase: 'in', fromFocus, toFocus });
    }, TIMER_MODE_TRANSITION_OUT_MS);

    const settleTimeout = window.setTimeout(() => {
      setTimerModeTransition(null);
    }, TIMER_MODE_TRANSITION_OUT_MS + TIMER_MODE_TRANSITION_IN_MS + 40);

    timerModeTransitionTimeoutsRef.current = [swapTimeout, settleTimeout];
    return undefined;
  }, [isFocusTimerPreset, prefersReducedMotion]);

  useEffect(() => () => {
    clearTimerModeTransitionTimeouts();
  }, []);

  useEffect(() => {
    if (!isFocusTimerPreset && !renderedIsFocusTimerPreset) setIsFocusTimerHidden(false);
  }, [isFocusTimerPreset, renderedIsFocusTimerPreset]);

  useEffect(() => {
    if (isFocusTimerPreset || renderedIsFocusTimerPreset || !focusFlipPauseActive) return;
    resumeFocusTimerFromFlip();
  }, [focusFlipPauseActive, isFocusTimerPreset, renderedIsFocusTimerPreset, resumeFocusTimerFromFlip]);

  const toggleFocusTimerHidden = () => {
    setIsFocusTimerHidden(prev => !prev);
  };

  const shouldComputeFocusTimerDisplay = isFocusTimerPreset || renderedIsFocusTimerPreset;
  const focusTimerNowMs = Date.now();
  const rawFocusTimerDisplaySeconds = shouldComputeFocusTimerDisplay
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
  if (!shouldComputeFocusTimerDisplay) {
    focusDisplaySessionRef.current = null;
    focusDisplaySecondsRef.current = 0;
  } else if (focusDisplaySessionRef.current !== sessionStartTime) {
    focusDisplaySessionRef.current = sessionStartTime;
    focusDisplaySecondsRef.current = 0;
  }
  if (shouldComputeFocusTimerDisplay && !sessionStartTime && isIdle) {
    focusDisplaySecondsRef.current = 0;
  }
  const focusTimerDisplaySeconds = shouldComputeFocusTimerDisplay
    ? Math.max(rawFocusTimerDisplaySeconds + focusTimerDisplayOffsetSeconds, focusDisplaySecondsRef.current)
    : 0;
  if (shouldComputeFocusTimerDisplay) {
    focusDisplaySecondsRef.current = focusTimerDisplaySeconds;
  }
  const focusTimerDisplayValue = formatTime(focusTimerDisplaySeconds);
  const delayedStartBeginLabel = (() => {
    if (!delayedStartTargetTime || !timerStarted || isIdle || activeMode !== 'break') return undefined;
    const delayedStartDate = new Date(delayedStartTargetTime);
    if (Number.isNaN(delayedStartDate.getTime())) return undefined;
    return `Begin At ${formatDelayedStartTime(delayedStartDate)}`;
  })();
  const isDelayedStartCountdown = Boolean(delayedStartBeginLabel);
  const breakSquareDisplayOptions = getBreakSquareDisplayOptions({
    isFocusTimerPreset: renderedIsFocusTimerPreset,
    isDelayedStartCountdown,
  });

  useEffect(() => {
    if (shouldShowIdlePresetControl) {
      setShouldRenderIdlePresetControl(true);
      const frameId = window.requestAnimationFrame(() => {
        setIsIdlePresetControlVisible(true);
      });
      return () => window.cancelAnimationFrame(frameId);
    }

    setIsIdlePresetControlVisible(false);
    setIsIdlePresetMenuOpen(false);
    const timeoutId = window.setTimeout(() => {
      setShouldRenderIdlePresetControl(false);
    }, START_SESSION_EXIT_DURATION_MS + 80);
    return () => window.clearTimeout(timeoutId);
  }, [shouldShowIdlePresetControl]);

  const selectIdlePreset = (preset: IdlePresetMenuValue) => {
    const compactAutoStartBlock = preset === 'compact' ? getMiniPomoAutoStartBlock(settings) : 1;
    updateSettings({
      ...settings,
      timerPreset: preset,
      ...TIMER_PRESETS[preset],
      miniPomoAutoStartBlock: compactAutoStartBlock,
      twoInARowMode: preset === 'compact' && compactAutoStartBlock > 1,
    });
    setIsIdlePresetMenuOpen(false);
  };

  const selectMiniPomoAutoStartBlock = (block: MiniPomoAutoStartBlock) => {
    updateSettings({
      ...settings,
      timerPreset: 'compact',
      ...TIMER_PRESETS.compact,
      miniPomoAutoStartBlock: block,
      twoInARowMode: block > 1,
    });
    setIsIdlePresetMenuOpen(false);
  };

  const toggleMiniPomoAutoStartSound = () => {
    updateSettings({
      ...settings,
      miniPomoAutoStartSoundEnabled: settings.miniPomoAutoStartSoundEnabled === false,
    });
  };

  const isLightTheme = settings.themeMode !== 'dark';
  const chromeButtonClass = settings.disableBlur
    ? isLightTheme
      ? 'border-white/40 bg-white/72 text-slate-700 shadow-[0_18px_36px_-28px_rgba(66,88,122,0.55)]'
      : 'border-white/10 bg-black/40 text-white shadow-[0_18px_36px_-28px_rgba(0,0,0,0.75)]'
    : isLightTheme
      ? 'border-white/45 bg-white/32 text-slate-700 backdrop-blur-xl shadow-[0_20px_40px_-28px_rgba(66,88,122,0.55)]'
      : 'border-white/5 bg-white/5 text-white backdrop-blur-md shadow-[0_18px_36px_-28px_rgba(0,0,0,0.72)]';
  const topIconClass = isLightTheme ? 'text-slate-700' : 'text-white/90';
  const timerContainerGapClass = shouldRenderIdlePresetControl
    ? 'gap-4'
    : 'gap-6 md:gap-10 lg:gap-24';
  const idlePresetSurfaceColor = getMutedSurfaceColor(activeColor || activeTask?.color, DEFAULT_WORK_SURFACE);
  const timerModeTransitionClassName = timerModeTransition
    ? `is-${timerModeTransition.phase} ${timerModeTransition.fromFocus ? 'is-from-focus' : 'is-from-dual'} ${timerModeTransition.toFocus ? 'is-to-focus' : 'is-to-dual'}`
    : '';

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
        @keyframes doro-start-session-exit {
          0% {
            opacity: 0.98;
            transform: translate3d(0, 0, 0) scale(1);
            filter: blur(0);
          }
          38% {
            opacity: 0.82;
            transform: translate3d(0, -1px, 0) scale(0.965);
            filter: blur(0.2px);
          }
          72% {
            opacity: 0.34;
            transform: translate3d(0, -4px, 0) scale(0.82);
            filter: blur(1.35px);
          }
          100% {
            opacity: 0;
            transform: translate3d(0, -7px, 0) scale(0.72);
            filter: blur(2.6px);
          }
        }
        /* Slower animations for more satisfying, less chaotic feel */
        .animate-wave-slow { animation: wave-rotate 40s linear infinite; }
        .animate-wave-med { animation: wave-rotate 32s linear infinite reverse; }
        .animate-wave-fast { animation: wave-rotate 25s linear infinite; }
        @keyframes doro-focus-single-enter {
          0% {
            opacity: 0;
            transform: translate3d(0, 18px, 0) scale(0.965);
            filter: blur(8px);
          }
          58% {
            opacity: 1;
            filter: blur(0);
          }
          100% {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
            filter: blur(0);
          }
        }
        @keyframes doro-focus-single-hold-prime {
          0% {
            clip-path: inset(0 100% 0 0 round 2.4rem);
            opacity: 0.35;
          }
          100% {
            clip-path: inset(0 0 0 0 round 2.4rem);
            opacity: 1;
          }
        }
        @keyframes doro-focus-single-hidden-value-in {
          0% {
            opacity: 0.08;
            transform: translate3d(0, 0.9rem, 0) scale(0.82);
            filter: blur(10px);
          }
          58% {
            opacity: 1;
            filter: blur(0);
          }
          100% {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
            filter: blur(0);
          }
        }
        @keyframes doro-focus-single-card-flip-left {
          0% {
            transform: rotateY(0deg);
          }
          100% {
            transform: rotateY(-180deg);
          }
        }
        @keyframes doro-focus-single-card-flip-right {
          0% {
            transform: rotateY(-180deg);
          }
          100% {
            transform: rotateY(0deg);
          }
        }
        @keyframes doro-focus-single-card-lift {
          0% {
            transform: translate3d(0, 0, 0) scale(1);
          }
          50% {
            transform: translate3d(0, -0.58rem, 24px) scale(1.012);
          }
          100% {
            transform: translate3d(0, 0, 0) scale(1);
          }
        }
        @keyframes doro-focus-single-face-out {
          0%,
          49.5% {
            opacity: 1;
            visibility: visible;
          }
          50.5%,
          100% {
            opacity: 0;
            visibility: hidden;
          }
        }
        @keyframes doro-focus-single-face-in {
          0%,
          49.5% {
            opacity: 0;
            visibility: hidden;
          }
          50.5%,
          100% {
            opacity: 1;
            visibility: visible;
          }
        }
        @keyframes doro-focus-single-content-out {
          0%,
          38% {
            opacity: 1;
          }
          49.5%,
          100% {
            opacity: 0;
          }
        }
        @keyframes doro-focus-single-content-in {
          0%,
          50.5% {
            opacity: 0;
          }
          62%,
          100% {
            opacity: 1;
          }
        }
        @keyframes doro-timer-mode-blur-out {
          0% {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
            filter: blur(0);
          }
          48% {
            opacity: 0.78;
            transform: translate3d(0, 2px, 0) scale(0.975);
            filter: blur(12px);
          }
          100% {
            opacity: 0;
            transform: translate3d(0, 8px, 0) scale(0.9);
            filter: blur(30px);
          }
        }
        @keyframes doro-timer-mode-focus-in {
          0% {
            opacity: 0;
            transform: translate3d(0, 18px, 0) scale(0.88);
            filter: blur(36px);
          }
          58% {
            opacity: 1;
            transform: translate3d(0, 1px, 0) scale(1.006);
            filter: blur(6px);
          }
          100% {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
            filter: blur(0);
          }
        }
        @keyframes doro-timer-mode-dual-in {
          0% {
            opacity: 0;
            transform: translate3d(0, 12px, 0) scale(0.93);
            filter: blur(32px);
          }
          58% {
            opacity: 1;
            transform: translate3d(0, 1px, 0) scale(1.004);
            filter: blur(6px);
          }
          100% {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
            filter: blur(0);
          }
        }
        .doro-timer-mode-stage {
          display: flex;
          width: 100%;
          align-items: center;
          justify-content: center;
          perspective: 1200px;
        }
        .doro-timer-mode-content {
          width: 100%;
          transform-origin: center;
          will-change: opacity, transform, filter;
        }
        .doro-timer-mode-stage.is-out .doro-timer-mode-content {
          pointer-events: none;
          animation: doro-timer-mode-blur-out ${TIMER_MODE_TRANSITION_OUT_MS}ms cubic-bezier(0.4, 0, 0.2, 1) both;
        }
        .doro-timer-mode-stage.is-in.is-to-focus .doro-timer-mode-content {
          animation: doro-timer-mode-focus-in ${TIMER_MODE_TRANSITION_IN_MS}ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .doro-timer-mode-stage.is-in.is-to-dual .doro-timer-mode-content {
          animation: doro-timer-mode-dual-in ${TIMER_MODE_TRANSITION_IN_MS}ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .doro-timer-mode-stage.is-out .doro-focus-single-stage,
        .doro-timer-mode-stage.is-in .doro-focus-single-stage,
        .doro-timer-mode-stage.is-out .doro-focus-single-start-slot,
        .doro-timer-mode-stage.is-in .doro-focus-single-start-slot {
          animation: none;
        }
        .doro-focus-single-stage {
          display: flex;
          width: 100%;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1.05rem;
          perspective: 1100px;
          perspective-origin: center 42%;
          animation: doro-focus-single-enter 760ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .doro-focus-single-start-slot {
          display: flex;
          min-height: 2.75rem;
          align-items: center;
          justify-content: center;
          animation: doro-focus-single-enter 760ms cubic-bezier(0.16, 1, 0.3, 1) 80ms both;
        }
        .doro-focus-single-card {
          position: relative;
          display: block;
          width: min(100%, 19rem);
          max-width: min(82vw, 24rem);
          aspect-ratio: 1;
          padding: 0;
          border: 0;
          border-radius: 3rem;
          background: transparent;
          color: #fff;
          cursor: pointer;
          font: inherit;
          transform: translate3d(0, 0, 0) scale(1);
          transform-style: preserve-3d;
          perspective: 1100px;
          perspective-origin: center 42%;
          overflow: visible;
          filter: none;
          box-shadow: none;
          will-change: transform;
          -webkit-tap-highlight-color: transparent;
          appearance: none;
          touch-action: manipulation;
          user-select: none;
        }
        .doro-focus-single-card::after {
          content: '';
          position: absolute;
          inset: 0.95rem;
          z-index: 5;
          border-radius: 2.35rem;
          border: 1px solid rgba(255, 255, 255, 0.24);
          opacity: 0;
          pointer-events: none;
          transform: scale(0.965);
          box-shadow:
            0 0 0 0 rgba(255, 255, 255, 0),
            inset 0 0 34px rgba(255, 255, 255, 0.04);
          transition:
            opacity 240ms ease,
            transform 540ms cubic-bezier(0.22, 1, 0.36, 1),
            box-shadow 540ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .doro-focus-single-card.is-hold-priming::after {
          opacity: 1;
          transform: scale(1);
          box-shadow:
            0 0 40px -18px rgba(255, 255, 255, 0.52),
            inset 0 0 38px rgba(255, 255, 255, 0.08);
          animation: doro-focus-single-hold-prime 550ms linear both;
        }
        .doro-focus-single-card.is-flip-animating::after {
          opacity: 0;
          transform: scale(0.965);
          animation: none;
        }
        .doro-focus-single-card:hover,
        .doro-focus-single-card:focus-visible {
          outline: none;
        }
        .doro-focus-single-card:active {
          background: transparent;
          color: #fff;
        }
        .doro-focus-single-card-lift {
          position: absolute;
          inset: 0;
          display: block;
          border-radius: inherit;
          transform: translate3d(0, 0, 0) scale(1);
          transform-style: preserve-3d;
          -webkit-transform-style: preserve-3d;
        }
        .doro-focus-single-card-inner {
          position: absolute;
          inset: 0;
          display: block;
          border-radius: inherit;
          transform: rotateY(0deg);
          transform-origin: center;
          transform-style: preserve-3d;
          -webkit-transform-style: preserve-3d;
          transform-box: border-box;
          isolation: isolate;
          will-change: transform, box-shadow;
        }
        .doro-focus-single-card.is-flipped .doro-focus-single-card-inner {
          transform: rotateY(-180deg);
        }
        .doro-focus-single-card.is-flip-animating .doro-focus-single-card-inner {
          transition: none;
          will-change: transform, box-shadow;
        }
        .doro-focus-single-face {
          position: absolute;
          inset: 0;
          z-index: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.22);
          border-radius: inherit;
          background: rgba(255, 255, 255, 0.1);
          box-shadow:
            0 0 0 1px rgba(255, 255, 255, 0.3),
            inset 0 1px 0 rgba(255, 255, 255, 0.12),
            inset 0 -24px 46px rgba(0, 0, 0, 0.08),
            inset 0 0 60px rgba(255, 255, 255, 0.1);
          opacity: 1;
          visibility: visible;
          pointer-events: none;
          backface-visibility: visible;
          -webkit-backface-visibility: visible;
          isolation: isolate;
          transform-origin: center;
          transform-style: flat;
          -webkit-transform-style: flat;
          transition:
            background-color 700ms cubic-bezier(0.2, 0.8, 0.2, 1),
            border-color 700ms cubic-bezier(0.2, 0.8, 0.2, 1),
            box-shadow 560ms cubic-bezier(0.16, 0.9, 0.3, 1);
        }
        .doro-focus-single-front {
          transform: rotateY(0deg) translateZ(0.5px);
        }
        .doro-focus-single-back {
          opacity: 0;
          visibility: hidden;
          transform: rotateY(180deg) translateZ(0.5px);
        }
        .doro-focus-single-card.is-flipped .doro-focus-single-front {
          opacity: 0;
          visibility: hidden;
        }
        .doro-focus-single-card.is-flipped .doro-focus-single-back {
          opacity: 1;
          visibility: visible;
        }
        .doro-focus-single-card.is-flip-animating .doro-focus-single-face {
          display: flex;
          visibility: visible;
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
          transition: none;
          will-change: transform, opacity;
        }
        .doro-focus-single-card.is-flip-animating.is-flip-to-alternate .doro-focus-single-card-inner {
          animation: doro-focus-single-card-flip-left ${FOCUS_TIMER_FLIP_ANIMATION_MS}ms ${FOCUS_TIMER_FLIP_EASING} both;
        }
        .doro-focus-single-card.is-flip-animating.is-flip-to-active .doro-focus-single-card-inner {
          animation: doro-focus-single-card-flip-right ${FOCUS_TIMER_FLIP_ANIMATION_MS}ms ${FOCUS_TIMER_FLIP_EASING} both;
        }
        .doro-focus-single-card.is-flip-animating .doro-focus-single-card-lift {
          animation: doro-focus-single-card-lift ${FOCUS_TIMER_FLIP_ANIMATION_MS}ms ${FOCUS_TIMER_FLIP_EASING} both;
        }
        .doro-focus-single-card.is-flip-animating.is-flip-to-alternate .doro-focus-single-front,
        .doro-focus-single-card.is-flip-animating.is-flip-to-active .doro-focus-single-back {
          animation: doro-focus-single-face-out ${FOCUS_TIMER_FLIP_ANIMATION_MS}ms linear both;
        }
        .doro-focus-single-card.is-flip-animating.is-flip-to-alternate .doro-focus-single-back,
        .doro-focus-single-card.is-flip-animating.is-flip-to-active .doro-focus-single-front {
          animation: doro-focus-single-face-in ${FOCUS_TIMER_FLIP_ANIMATION_MS}ms linear both;
        }
        .doro-focus-single-card.is-flip-animating.is-flip-to-alternate .doro-focus-single-front .doro-focus-single-face-content,
        .doro-focus-single-card.is-flip-animating.is-flip-to-active .doro-focus-single-back .doro-focus-single-face-content {
          animation: doro-focus-single-content-out ${FOCUS_TIMER_FLIP_ANIMATION_MS}ms linear both;
        }
        .doro-focus-single-card.is-flip-animating.is-flip-to-alternate .doro-focus-single-back .doro-focus-single-face-content,
        .doro-focus-single-card.is-flip-animating.is-flip-to-active .doro-focus-single-front .doro-focus-single-face-content {
          animation: doro-focus-single-content-in ${FOCUS_TIMER_FLIP_ANIMATION_MS}ms linear both;
        }
        .doro-focus-single-card.is-flip-animating .doro-focus-single-sheen {
          opacity: 0 !important;
        }
        .doro-focus-single-card:not(.is-blur-disabled):not(.is-flip-animating) .doro-focus-single-face {
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
        }
        .doro-focus-single-card:hover .doro-focus-single-face,
        .doro-focus-single-card:focus-visible .doro-focus-single-face {
          border-color: rgba(255, 255, 255, 0.24);
          background: rgba(255, 255, 255, 0.11);
        }
        .doro-focus-single-card.is-flip-animating .doro-focus-single-face,
        .doro-focus-single-card.is-flip-animating:hover .doro-focus-single-face,
        .doro-focus-single-card.is-flip-animating:focus-visible .doro-focus-single-face {
          background-color: color-mix(in srgb, var(--doro-focus-single-surface, ${DEFAULT_WORK_SURFACE}) 90%, white 10%);
          background-image: none;
        }
        .doro-focus-single-card:not(.is-blur-disabled):not(.is-flip-animating):hover .doro-focus-single-face,
        .doro-focus-single-card:not(.is-blur-disabled):not(.is-flip-animating):focus-visible .doro-focus-single-face {
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }
        .doro-focus-single-card.is-idle:not(:hover):not(:focus-visible) .doro-focus-single-face {
          background: rgba(255, 255, 255, 0.09);
          border-color: rgba(255, 255, 255, 0.2);
          box-shadow:
            0 0 0 1px rgba(255, 255, 255, 0.24),
            inset 0 1px 0 rgba(255, 255, 255, 0.11),
            inset 0 -24px 46px rgba(0, 0, 0, 0.075),
            inset 0 0 54px rgba(255, 255, 255, 0.085);
        }
        .doro-focus-single-face::before {
          content: '';
          position: absolute;
          inset: 0;
          z-index: 0;
          background:
            linear-gradient(to top right, rgba(255,255,255,0.1), transparent 46%),
            radial-gradient(circle at 50% 0%, rgba(255,255,255,0.12), transparent 54%);
          opacity: 1;
          pointer-events: none;
          transform: translateZ(0.2px);
        }
        .doro-focus-single-sheen {
          position: absolute;
          inset: 0;
          z-index: 1;
          border-radius: inherit;
          pointer-events: none;
          mix-blend-mode: screen;
        }
        .doro-focus-single-face-content {
          container-type: inline-size;
          position: relative;
          z-index: 2;
          display: flex;
          width: 100%;
          height: 100%;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 2.35rem 1.05rem;
          text-align: center;
          backface-visibility: visible;
          -webkit-backface-visibility: visible;
          transform: translateZ(1.6px);
          transform-style: preserve-3d;
          -webkit-transform-style: preserve-3d;
          transition:
            transform 400ms cubic-bezier(0.32, 0, 0.2, 1),
            filter 260ms ease;
        }
        .doro-focus-single-card.is-flip-animating .doro-focus-single-face-content {
          transition: none;
          filter: none;
        }
        .doro-focus-single-card.is-flip-animating .doro-focus-single-label,
        .doro-focus-single-card.is-flip-animating .doro-focus-single-value,
        .doro-focus-single-card.is-flip-animating .doro-focus-single-hint {
          animation: none !important;
          transition: none !important;
          filter: none !important;
        }
        .doro-focus-single-card.is-flip-animating .doro-focus-single-face-content.is-display-hidden .doro-focus-single-value {
          animation: none !important;
          opacity: 1;
          transform: translate3d(0, -0.05rem, 0) scale(1);
          filter: none;
        }
        .doro-focus-single-label {
          max-width: 82%;
          color: rgba(255, 255, 255, 0.88);
          font-size: 0.75rem;
          font-weight: 800;
          line-height: 1.05;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          text-shadow: 0 9px 18px rgba(0, 0, 0, 0.32);
          transform: translate3d(0, 0, 0) scale(1);
          filter: blur(0);
          transition:
            opacity 360ms ease,
            transform 680ms cubic-bezier(0.18, 0.9, 0.24, 1),
            filter 420ms ease,
            color 420ms ease,
            font-size 680ms cubic-bezier(0.18, 0.9, 0.24, 1),
            line-height 680ms cubic-bezier(0.18, 0.9, 0.24, 1),
            letter-spacing 520ms ease;
          will-change: opacity, transform, filter, font-size, letter-spacing;
        }
        .doro-focus-single-label span {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .doro-focus-single-value {
          display: flex;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          margin-top: 0.6rem;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-size: clamp(4.05rem, 25cqw, 4.35rem);
          font-weight: 800;
          font-variant-numeric: tabular-nums;
          line-height: 0.9;
          letter-spacing: 0;
          text-align: center;
          text-shadow: 0 18px 28px rgba(0, 0, 0, 0.34);
          transform: translate3d(0, 0, 0) scale(1);
          filter: blur(0);
          overflow: visible;
          overflow-wrap: normal;
          white-space: nowrap;
          word-break: keep-all;
          transition:
            margin-top 680ms cubic-bezier(0.18, 0.9, 0.24, 1),
            opacity 360ms ease,
            transform 680ms cubic-bezier(0.18, 0.9, 0.24, 1),
            filter 420ms ease,
            font-size 680ms cubic-bezier(0.18, 0.9, 0.24, 1),
            line-height 680ms cubic-bezier(0.18, 0.9, 0.24, 1);
          will-change: opacity, transform, filter, font-size;
        }
        .doro-focus-single-value span {
          display: inline-flex;
          max-width: 100%;
          min-width: 0;
          align-items: center;
          justify-content: center;
          text-align: center;
          overflow-wrap: normal;
          white-space: nowrap;
          word-break: keep-all;
        }
        .doro-focus-single-face-content.is-display-hidden .doro-focus-single-label {
          opacity: 0;
          transform: translate3d(0, -0.85rem, 0) scale(0.86);
          filter: blur(6px);
        }
        .doro-focus-single-face-content.is-display-hidden .doro-focus-single-value {
          margin-top: 0;
          font-size: 3.1rem;
          line-height: 0.98;
          text-transform: none;
          text-shadow: none;
          transform: translate3d(0, -0.05rem, 0) scale(1);
          animation: doro-focus-single-hidden-value-in 680ms cubic-bezier(0.18, 0.9, 0.24, 1) both;
        }
        .doro-focus-single-face-content.is-display-hidden .doro-focus-single-value span {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          overflow: hidden;
          overflow-wrap: anywhere;
          padding-bottom: 0.08em;
          text-wrap: balance;
          white-space: normal;
        }
        .doro-focus-single-card.doro-focus-label-short .doro-focus-single-face-content.is-display-hidden .doro-focus-single-value span {
          -webkit-line-clamp: 2;
        }
        .doro-focus-single-card.doro-focus-label-medium .doro-focus-single-face-content.is-display-hidden .doro-focus-single-value {
          font-size: 2.45rem;
          line-height: 0.98;
        }
        .doro-focus-single-card.doro-focus-label-medium .doro-focus-single-face-content.is-display-hidden .doro-focus-single-value span {
          -webkit-line-clamp: 3;
        }
        .doro-focus-single-card.doro-focus-label-long .doro-focus-single-face-content.is-display-hidden .doro-focus-single-value {
          font-size: 1.7rem;
          line-height: 1.04;
        }
        .doro-focus-single-card.doro-focus-label-long .doro-focus-single-face-content.is-display-hidden .doro-focus-single-value span {
          -webkit-line-clamp: 4;
        }
        .doro-focus-single-card.is-ready-to-start .doro-focus-single-label {
          color: rgba(255, 255, 255, 0.96);
        }
        .doro-focus-single-face-content.is-break-face .doro-focus-single-value {
          margin-top: 0;
        }
        .doro-focus-single-face-content.is-word-face .doro-focus-single-value {
          font-size: 3.1rem;
          text-transform: uppercase;
        }
        .doro-focus-single-hint {
          position: absolute;
          right: 1.8rem;
          bottom: 1.7rem;
          left: 1.8rem;
          color: rgba(255, 255, 255, 0.68);
          font-size: 0.62rem;
          font-weight: 800;
          line-height: 1;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          opacity: 0;
          transform: translate3d(0, 0.65rem, 0);
          transition:
            opacity 260ms ease,
            transform 420ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .doro-focus-single-card:hover .doro-focus-single-hint,
        .doro-focus-single-card:focus-visible .doro-focus-single-hint {
          opacity: 1;
          transform: translate3d(0, 0, 0);
        }
        @media (min-width: 640px) {
          .doro-focus-single-card {
            width: min(100%, 20rem);
          }
          .doro-focus-single-value {
            font-size: clamp(4.35rem, 25cqw, 4.85rem);
          }
          .doro-focus-single-face-content.is-display-hidden .doro-focus-single-value,
          .doro-focus-single-face-content.is-word-face .doro-focus-single-value {
            font-size: 3.55rem;
          }
          .doro-focus-single-card.doro-focus-label-medium .doro-focus-single-face-content.is-display-hidden .doro-focus-single-value {
            font-size: 2.85rem;
          }
          .doro-focus-single-card.doro-focus-label-long .doro-focus-single-face-content.is-display-hidden .doro-focus-single-value {
            font-size: 2.05rem;
          }
        }
        @media (min-width: 768px) {
          .doro-focus-single-label {
            font-size: 0.875rem;
          }
          .doro-focus-single-value {
            font-size: clamp(4.6rem, 25cqw, 6rem);
          }
          .doro-focus-single-face-content.is-display-hidden .doro-focus-single-value {
            font-size: 3.75rem;
            line-height: 0.92;
          }
          .doro-focus-single-card.doro-focus-label-medium .doro-focus-single-face-content.is-display-hidden .doro-focus-single-value {
            font-size: 3.15rem;
          }
          .doro-focus-single-card.doro-focus-label-long .doro-focus-single-face-content.is-display-hidden .doro-focus-single-value {
            font-size: 2.35rem;
          }
          .doro-focus-single-face-content.is-word-face .doro-focus-single-value {
            font-size: 3.75rem;
          }
        }
        @media (min-width: 1024px) {
          .doro-focus-single-card {
            width: min(100%, 24rem);
          }
          .doro-focus-single-value {
            font-size: clamp(5.4rem, 30cqw, 7.5rem);
          }
          .doro-focus-single-face-content.is-display-hidden .doro-focus-single-value,
          .doro-focus-single-face-content.is-word-face .doro-focus-single-value {
            font-size: 4.5rem;
          }
          .doro-focus-single-card.doro-focus-label-medium .doro-focus-single-face-content.is-display-hidden .doro-focus-single-value {
            font-size: 3.45rem;
          }
          .doro-focus-single-card.doro-focus-label-long .doro-focus-single-face-content.is-display-hidden .doro-focus-single-value {
            font-size: 2.55rem;
          }
          .doro-focus-single-stage {
            gap: 1.2rem;
          }
        }
        .doro-focus-timer-shell {
          container-type: inline-size;
          isolation: isolate;
        }
        .doro-focus-timer-shell::after {
          content: '';
          position: absolute;
          inset: 1.15rem;
          z-index: 26;
          border-radius: 2.25rem;
          border: 1px solid rgba(255, 255, 255, 0.22);
          opacity: 0;
          pointer-events: none;
          transform: scale(0.965);
          box-shadow:
            0 0 0 0 rgba(255, 255, 255, 0),
            inset 0 0 34px rgba(255, 255, 255, 0.04);
          transition:
            opacity 240ms ease,
            transform 540ms cubic-bezier(0.22, 1, 0.36, 1),
            box-shadow 540ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .doro-focus-timer-shell.doro-focus-timer-hold-priming::after {
          opacity: 1;
          transform: scale(1);
          box-shadow:
            0 0 38px -18px rgba(255, 255, 255, 0.5),
            inset 0 0 38px rgba(255, 255, 255, 0.07);
        }
        .doro-focus-timer-label,
        .doro-focus-timer-time {
          position: absolute;
          left: 9%;
          right: 9%;
          max-width: none;
          text-align: center;
          transform-origin: center;
          will-change: top, opacity, transform, filter, font-size, letter-spacing;
          backface-visibility: hidden;
          transition:
            top 680ms cubic-bezier(0.18, 0.9, 0.24, 1),
            opacity 360ms ease,
            transform 680ms cubic-bezier(0.18, 0.9, 0.24, 1),
            filter 420ms ease,
            color 420ms ease,
            font-size 680ms cubic-bezier(0.18, 0.9, 0.24, 1),
            line-height 680ms cubic-bezier(0.18, 0.9, 0.24, 1),
            letter-spacing 520ms ease;
        }
        .doro-focus-timer-label {
          top: 33%;
          margin: 0;
          font-size: clamp(0.72rem, 4cqw, 0.95rem);
          line-height: 1.05;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          transform: translate3d(0, -50%, 0) scale(1);
          opacity: 0.92;
        }
        .doro-focus-timer-label-text {
          display: block;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          overflow-wrap: anywhere;
        }
        .doro-focus-timer-time {
          top: 52%;
          margin: 0;
          font-size: clamp(4.15rem, 30cqw, 8rem);
          line-height: 0.86;
          letter-spacing: -0.04em;
          opacity: 1;
          transform: translate3d(0, -50%, 0) scale(1);
          filter: blur(0);
        }
        .doro-focus-timer-is-hidden .doro-focus-timer-label {
          top: 50%;
          letter-spacing: 0;
          text-transform: none;
          opacity: 1;
          transform: translate3d(0, -50%, 0) scale(1);
        }
        .doro-focus-timer-is-hidden .doro-focus-timer-label-text {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          white-space: normal;
          overflow: hidden;
          text-overflow: clip;
          overflow-wrap: anywhere;
          text-wrap: balance;
        }
        .doro-focus-timer-is-hidden.doro-focus-label-short .doro-focus-timer-label {
          font-size: clamp(2.35rem, 16cqw, 4.55rem);
          line-height: 0.9;
        }
        .doro-focus-timer-is-hidden.doro-focus-label-short .doro-focus-timer-label-text {
          -webkit-line-clamp: 2;
        }
        .doro-focus-timer-is-hidden.doro-focus-label-medium .doro-focus-timer-label {
          font-size: clamp(1.75rem, 12cqw, 3.45rem);
          line-height: 0.94;
        }
        .doro-focus-timer-is-hidden.doro-focus-label-medium .doro-focus-timer-label-text {
          -webkit-line-clamp: 3;
        }
        .doro-focus-timer-is-hidden.doro-focus-label-long .doro-focus-timer-label {
          font-size: clamp(1.22rem, 8.7cqw, 2.55rem);
          line-height: 1.03;
        }
        .doro-focus-timer-is-hidden.doro-focus-label-long .doro-focus-timer-label-text {
          -webkit-line-clamp: 4;
        }
        .doro-focus-timer-is-hidden .doro-focus-timer-time {
          top: 57%;
          opacity: 0;
          transform: translate3d(0, -50%, 0) scale(0.84);
          filter: blur(8px);
        }
        .doro-focus-timer-is-visible .doro-focus-timer-time {
          opacity: 1;
          transform: translate3d(0, -50%, 0) scale(1);
          filter: blur(0);
        }
        .doro-start-session-shell {
          --doro-start-ease: cubic-bezier(0.16, 1, 0.3, 1);
          --doro-start-ease-soft: cubic-bezier(0.22, 0.76, 0.26, 1);
          --doro-start-ease-close: cubic-bezier(0.34, 0, 0.2, 1);
          --doro-start-ease-exit: cubic-bezier(0.32, 0, 0.2, 1);
          width: 2.75rem;
          max-width: 78vw;
          height: 2.75rem;
          padding: 0.625rem;
          top: 0;
          border-radius: 0.75rem;
          opacity: 0.6;
          background-image: none;
          transform: translate3d(0, 0, 0) scale(1);
          transform-origin: center;
          transition:
            width 620ms var(--doro-start-ease),
            height 620ms var(--doro-start-ease),
            padding 620ms var(--doro-start-ease),
            top 520ms var(--doro-start-ease),
            border-radius 620ms var(--doro-start-ease),
            opacity 380ms ease,
            transform 520ms var(--doro-start-ease),
            box-shadow 520ms ease,
            border-color 420ms ease,
            background-color 420ms ease,
            filter 420ms ease;
          will-change: width, height, transform, opacity;
          backface-visibility: hidden;
          contain: layout;
        }
        .doro-start-session-shell.is-open {
          contain: none;
          overflow: visible;
        }
        .doro-start-session-shell.is-closed,
        .doro-start-session-shell.is-closing,
        .doro-start-session-shell.is-exiting {
          overflow: hidden;
        }
        .doro-start-session-shell.is-closed {
          background-color: transparent;
          background-image: none;
          border-color: transparent;
          box-shadow: none;
        }
        .doro-start-session-shell.is-closed:hover {
          opacity: 0.92;
          background:
            linear-gradient(145deg, rgba(255,255,255,0.13), rgba(255,255,255,0.055));
          border-color: rgba(255,255,255,0.18);
          box-shadow:
            0 34px 74px -38px rgba(0,0,0,0.82),
            0 16px 32px -20px rgba(0,0,0,0.62),
            inset 0 1px 0 rgba(255,255,255,0.16);
          transform: perspective(680px) translate3d(0, -8px, 12px) scale(1.045) rotateX(1.4deg);
        }
        .doro-start-session-shell.is-closed:active {
          transform: perspective(680px) translate3d(0, -5px, 8px) scale(0.98) rotateX(0.8deg);
        }
        .doro-start-session-shell.is-open {
          width: 14rem;
          height: 11.75rem;
          padding: 0.75rem;
          top: -8px;
          border-radius: 1.45rem;
          opacity: 1;
          background:
            linear-gradient(145deg, rgba(255,255,255,0.145), rgba(255,255,255,0.06)),
            rgba(255,255,255,0.075);
          border-color: rgba(255,255,255,0.18);
          box-shadow:
            0 38px 82px -40px rgba(0,0,0,0.84),
            0 18px 38px -22px rgba(0,0,0,0.64),
            inset 0 1px 0 rgba(255,255,255,0.16);
          transform: none;
        }
        .doro-start-session-shell.is-open.view-choices {
          width: 14rem;
          height: 8rem;
          border-radius: 1.25rem;
        }
        .doro-start-session-shell.is-open.view-timer {
          width: 14rem;
          height: 11.75rem;
        }
        .doro-start-session-shell.is-open.view-delayed {
          width: 15rem;
          height: 11.5rem;
        }
        .doro-start-session-shell.is-closing {
          opacity: 0.72;
          background:
            linear-gradient(145deg, rgba(255,255,255,0.11), rgba(255,255,255,0.035));
          border-color: rgba(255,255,255,0.11);
          top: -2px;
          box-shadow:
            0 22px 52px -36px rgba(0,0,0,0.72),
            0 10px 24px -21px rgba(0,0,0,0.54),
            inset 0 1px 0 rgba(255,255,255,0.12);
          transform: scale(0.985);
          transition:
            width ${START_SESSION_MENU_CLOSE_SETTLE_MS}ms var(--doro-start-ease-close),
            height ${START_SESSION_MENU_CLOSE_SETTLE_MS}ms var(--doro-start-ease-close),
            padding ${START_SESSION_MENU_CLOSE_SETTLE_MS}ms var(--doro-start-ease-close),
            top 520ms var(--doro-start-ease-close),
            border-radius ${START_SESSION_MENU_CLOSE_SETTLE_MS}ms var(--doro-start-ease-close),
            opacity 360ms ease 130ms,
            transform 520ms var(--doro-start-ease-close),
            box-shadow 520ms ease,
            border-color 420ms ease,
            background-color 420ms ease,
            filter 420ms ease;
        }
        .doro-start-session-shell.is-exiting {
          pointer-events: none;
          width: 0;
          max-width: 0;
          height: 0;
          padding: 0;
          border-color: rgba(255,255,255,0);
          background: transparent;
          box-shadow: none;
          animation: doro-start-session-exit ${START_SESSION_EXIT_DURATION_MS}ms var(--doro-start-ease-soft) both;
          transition:
            width ${START_SESSION_EXIT_DURATION_MS}ms var(--doro-start-ease-exit),
            max-width ${START_SESSION_EXIT_DURATION_MS}ms var(--doro-start-ease-exit),
            height ${START_SESSION_EXIT_DURATION_MS}ms var(--doro-start-ease-exit),
            padding ${Math.max(620, START_SESSION_EXIT_DURATION_MS - 120)}ms var(--doro-start-ease-exit),
            border-radius ${START_SESSION_EXIT_DURATION_MS}ms var(--doro-start-ease-exit),
            border-color 360ms ease,
            background-color 360ms ease,
            box-shadow 360ms ease;
        }
        .doro-start-session-shell.is-exiting.is-exiting-from-menu.view-choices {
          width: 0;
          max-width: 0;
          height: 0;
          padding: 0;
          border-radius: 1.25rem;
        }
        .doro-start-session-shell.is-exiting.is-exiting-from-menu.view-timer {
          width: 0;
          max-width: 0;
          height: 0;
          padding: 0;
          border-radius: 1.45rem;
        }
        .doro-start-session-shell.is-exiting.is-exiting-from-menu.view-delayed {
          width: 0;
          max-width: 0;
          height: 0;
          padding: 0;
          border-radius: 1.45rem;
        }
        .doro-start-session-button {
          z-index: 3;
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
          filter: blur(0);
          transition:
            opacity 220ms ease,
            transform 420ms var(--doro-start-ease),
            filter 260ms ease;
          will-change: opacity, transform, filter;
        }
        .doro-start-session-shell.is-open .doro-start-session-button,
        .doro-start-session-shell.is-closing .doro-start-session-button,
        .doro-start-session-shell.is-exiting .doro-start-session-button {
          opacity: 0;
          transform: translate3d(0, -2px, 0) scale(0.64) rotate(-8deg);
          filter: blur(0.7px);
          pointer-events: none;
        }
        .doro-start-session-menu {
          z-index: 2;
          opacity: 0;
          pointer-events: none;
          transform: translate3d(0, 11px, 0) scale(0.925);
          filter: blur(0.7px);
          transition:
            opacity 190ms ease,
            transform 360ms var(--doro-start-ease-close),
            filter 260ms ease;
          will-change: opacity, transform, filter;
          transform-origin: center;
        }
        .doro-start-session-shell.is-open .doro-start-session-menu {
          opacity: 1;
          pointer-events: auto;
          transform: translate3d(0, 0, 0) scale(1);
          filter: blur(0);
          transition:
            opacity 260ms ease 105ms,
            transform 500ms var(--doro-start-ease) 105ms,
            filter 300ms ease 105ms;
        }
        .doro-start-session-shell.is-closing .doro-start-session-menu,
        .doro-start-session-shell.is-exiting .doro-start-session-menu {
          opacity: 0;
          pointer-events: none;
          transform: translate3d(0, 5px, 0) scale(0.975);
          filter: blur(1px);
          transition-delay: 0ms;
        }
        .doro-start-session-shell.is-closed .doro-start-session-panel,
        .doro-start-session-shell.is-closing .doro-start-session-panel,
        .doro-start-session-shell.is-exiting .doro-start-session-panel {
          opacity: 0;
          pointer-events: none;
          transform: translate3d(0, 6px, 0) scale(0.965);
          filter: blur(1px);
        }
        .doro-start-session-panel {
          position: absolute;
          inset: 0;
          display: flex;
          min-width: 0;
          justify-content: center;
          opacity: 0;
          pointer-events: none;
          transform: translate3d(0, 12px, 0) scale(0.955);
          filter: blur(0.7px);
          transition:
            opacity 230ms ease,
            transform 500ms var(--doro-start-ease),
            filter 300ms ease;
          will-change: opacity, transform, filter;
        }
        .doro-start-session-panel.is-active {
          opacity: 1;
          pointer-events: auto;
          transform: translate3d(0, 0, 0) scale(1);
          filter: blur(0);
        }
        .doro-start-choice-panel {
          flex-direction: column;
          gap: 0.5rem;
        }
        .doro-start-choice-panel.is-drilling-timer,
        .doro-start-choice-panel.is-drilling-delayed {
          opacity: 0;
          transform: translate3d(0, -4px, 0) scale(1.03);
          filter: blur(2px);
          transition-duration: 260ms;
        }
        .doro-start-session-choice {
          display: flex;
          min-height: 3rem;
          width: 100%;
          align-items: center;
          gap: 0.65rem;
          border-radius: 0.85rem;
          border: 1px solid rgba(255, 255, 255, 0.16);
          background:
            linear-gradient(145deg, rgba(255,255,255,0.07), rgba(255,255,255,0.025)),
            rgba(0, 0, 0, 0.24);
          padding: 0.55rem 0.7rem;
          color: rgba(255, 255, 255, 0.88);
          box-shadow: 0 14px 26px -24px rgba(0, 0, 0, 0.54);
          transform: translate3d(0, 8px, 0) scale(0.97);
          opacity: 0;
          transition:
            opacity 240ms ease,
            transform 370ms var(--doro-start-ease),
            background-color 280ms ease,
            border-color 280ms ease,
            box-shadow 300ms ease,
            filter 280ms ease;
          transition-delay: 0ms;
          will-change: transform, opacity, box-shadow, background-color;
          backface-visibility: hidden;
        }
        .doro-start-session-shell.is-open.is-view-entering.view-choices .doro-start-session-choice {
          transition-delay: var(--doro-start-choice-delay, 120ms);
        }
        .doro-start-sleep-icon {
          display: inline-block;
          font-family: inherit;
          font-size: 0.77rem;
          font-weight: 800;
          line-height: 1;
          letter-spacing: 0;
          color: rgba(255, 255, 255, 0.88);
          transform: translate3d(0, -0.5px, 0) rotate(-8deg);
          text-shadow: 0 9px 16px rgba(0, 0, 0, 0.38);
        }
        .doro-start-choice-panel.is-active .doro-start-session-choice {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
        }
        .doro-start-choice-panel.is-drilling-timer .doro-start-session-choice-delayed,
        .doro-start-choice-panel.is-drilling-delayed .doro-start-session-choice-timer {
          opacity: 0;
          transform: translate3d(0, 12px, 0) scale(0.88);
          filter: blur(3px);
        }
        .doro-start-choice-panel.is-drilling-timer .doro-start-session-choice-timer,
        .doro-start-choice-panel.is-drilling-delayed .doro-start-session-choice-delayed {
          opacity: 0;
          transform: translate3d(0, -3px, 0) scale(1.08);
          filter: blur(1.5px);
        }
        .doro-start-session-shell.is-open.view-choices .doro-start-choice-panel.is-active .doro-start-session-choice:hover {
          background:
            linear-gradient(145deg, rgba(255,255,255,0.095), rgba(255,255,255,0.035)),
            rgba(0, 0, 0, 0.3);
          border-color: rgba(255, 255, 255, 0.28);
          box-shadow:
            0 18px 28px -24px rgba(0, 0, 0, 0.6),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
          transform: translateY(-1px);
          filter: none;
        }
        .doro-start-timer-panel,
        .doro-start-delayed-panel {
          justify-content: flex-start;
          transition-delay: 90ms;
        }
        .doro-start-timer-panel.is-active,
        .doro-start-delayed-panel.is-active {
          transition-delay: 150ms;
        }
        .doro-start-session-option {
          opacity: 0;
          transform: translate3d(0, 10px, 0) scale(0.96);
          box-shadow: 0 10px 20px -22px rgba(0, 0, 0, 0.46);
          transition:
            opacity 180ms ease,
            transform 370ms var(--doro-start-ease),
            box-shadow 300ms ease,
            background-color 280ms ease,
            border-color 280ms ease,
            color 260ms ease,
            filter 280ms ease;
          transition-delay: 0ms;
          will-change: transform, opacity, box-shadow, background-color;
          backface-visibility: hidden;
        }
        .doro-start-session-shell.is-open.view-timer .doro-start-session-option {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
          box-shadow: 0 16px 28px -24px rgba(0, 0, 0, 0.54);
        }
        .doro-start-session-shell.is-open.is-view-entering.view-timer .doro-start-session-option {
          transition-delay: var(--doro-start-option-delay, 180ms);
        }
        .doro-start-session-shell.is-open .doro-start-session-option:hover {
          transform: translateY(-1px);
          box-shadow:
            0 18px 28px -24px rgba(0, 0, 0, 0.6),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
          filter: none;
        }
        .doro-start-session-shell.is-open .doro-start-session-option:active {
          transform: perspective(520px) translate3d(0, 0, 1px) scale(0.996) rotateX(0.08deg);
          box-shadow: 0 14px 24px -23px rgba(0, 0, 0, 0.54);
        }
        .doro-start-session-shell.is-open.is-view-settled {
          backface-visibility: visible;
          will-change: width, height, opacity;
        }
        .doro-start-session-shell.is-open.is-view-settled .doro-start-session-menu,
        .doro-start-session-shell.is-open.is-view-settled .doro-start-session-panel.is-active {
          transform: none;
          filter: none;
          will-change: auto;
        }
        .doro-start-session-shell.is-open.is-view-settled .doro-start-session-choice,
        .doro-start-session-shell.is-open.is-view-settled .doro-start-session-option {
          backface-visibility: visible;
          will-change: auto;
        }
        .doro-start-session-shell.is-open.is-view-settled .doro-start-session-choice:not(:hover):not(:active),
        .doro-start-session-shell.is-open.is-view-settled .doro-start-session-option:not(:hover):not(:active) {
          transform: none;
        }
        .doro-start-mini-pomo-branch {
          position: relative;
          width: 100%;
          min-width: 0;
        }
        .doro-start-mini-pomo-branch::after {
          content: '';
          position: absolute;
          pointer-events: auto;
        }
        .doro-start-mini-pomo-branch.is-popout-right::after {
          top: -0.9rem;
          bottom: -0.35rem;
          left: 100%;
          width: 1.18rem;
        }
        .doro-start-mini-pomo-branch.is-popout-left::after {
          top: -0.9rem;
          right: 100%;
          bottom: -0.35rem;
          width: 1.18rem;
        }
        .doro-start-mini-pomo-branch.is-popout-below::after {
          top: 100%;
          right: -0.2rem;
          left: -0.2rem;
          height: 0.62rem;
        }
        .doro-start-mini-pomo-popout {
          position: absolute;
          top: -0.9rem;
          z-index: 12;
          width: 14rem;
          max-width: calc(100vw - 1.5rem);
          padding: 0.58rem;
          border-radius: 1rem;
          border: 1px solid rgba(255, 255, 255, 0.2);
          background:
            radial-gradient(circle at 18% 0%, rgba(255,255,255,0.2), transparent 42%),
            linear-gradient(145deg, rgba(255,255,255,0.145), rgba(255,255,255,0.06)),
            var(--doro-start-popout-surface, rgba(214, 154, 168, 0.92));
          box-shadow:
            0 34px 72px -38px rgba(0, 0, 0, 0.82),
            0 18px 34px -24px rgba(0, 0, 0, 0.62),
            inset 0 1px 0 rgba(255, 255, 255, 0.2);
          opacity: 0;
          pointer-events: none;
          filter: blur(1.6px) saturate(0.92);
          transition:
            opacity 260ms ease,
            transform 500ms var(--doro-start-ease),
            filter 300ms ease,
            box-shadow 420ms ease,
            border-color 420ms ease,
            background-color 420ms ease;
          will-change: opacity, transform, filter;
          backdrop-filter: blur(22px) saturate(1.18);
          -webkit-backdrop-filter: blur(22px) saturate(1.18);
        }
        .doro-start-mini-pomo-branch.is-popout-right .doro-start-mini-pomo-popout {
          left: calc(100% + 1.08rem);
          transform: translate3d(-10px, 7px, 0) scale(0.955);
          transform-origin: left top;
        }
        .doro-start-mini-pomo-branch.is-popout-left .doro-start-mini-pomo-popout {
          right: calc(100% + 1.08rem);
          transform: translate3d(10px, 7px, 0) scale(0.955);
          transform-origin: right top;
        }
        .doro-start-mini-pomo-branch.is-popout-below .doro-start-mini-pomo-popout {
          top: calc(100% + 0.42rem);
          right: 0;
          left: 0;
          width: 100%;
          transform: translate3d(0, -8px, 0) scale(0.955);
          transform-origin: top center;
        }
        .doro-start-mini-pomo-branch:hover .doro-start-mini-pomo-popout,
        .doro-start-mini-pomo-branch:focus-within .doro-start-mini-pomo-popout {
          opacity: 1;
          pointer-events: auto;
          transform: translate3d(0, 0, 0) scale(1);
          filter: blur(0) saturate(1);
        }
        .doro-start-mini-pomo-popout-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          padding: 0 0.08rem 0.45rem;
          color: rgba(255, 255, 255, 0.72);
          font-size: 0.58rem;
          font-weight: 900;
          line-height: 1;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .doro-start-mini-pomo-header-actions {
          display: inline-flex;
          flex: 0 0 auto;
          align-items: center;
          gap: 0.32rem;
        }
        .doro-start-mini-pomo-help-wrap,
        .doro-start-mini-pomo-sound-wrap {
          position: relative;
          display: inline-flex;
          flex: 0 0 auto;
        }
        .doro-start-mini-pomo-sound-wrap::after {
          content: attr(data-tooltip);
          position: absolute;
          right: -0.15rem;
          bottom: calc(100% + 0.45rem);
          z-index: 3;
          width: max-content;
          max-width: 9rem;
          padding: 0.34rem 0.48rem;
          border-radius: 0.55rem;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(12, 12, 14, 0.92);
          color: rgba(255,255,255,0.78);
          box-shadow: 0 12px 22px -16px rgba(0,0,0,0.82);
          opacity: 0;
          pointer-events: none;
          transform: translate3d(0, 4px, 0) scale(0.96);
          transition:
            opacity 150ms ease,
            transform 260ms var(--doro-start-ease);
          font-size: 0.52rem;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: none;
          white-space: nowrap;
        }
        .doro-start-mini-pomo-help-wrap::after {
          content: attr(data-tooltip);
          position: absolute;
          right: -0.15rem;
          bottom: calc(100% + 0.45rem);
          z-index: 4;
          width: 12.75rem;
          max-width: min(12.75rem, calc(100vw - 2rem));
          padding: 0.7rem 0.78rem;
          border-radius: 0.85rem;
          border: 1px solid rgba(255,255,255,0.2);
          background:
            radial-gradient(circle at 18% 0%, rgba(255,255,255,0.18), transparent 42%),
            linear-gradient(145deg, rgba(255,255,255,0.145), rgba(255,255,255,0.06)),
            var(--doro-start-popout-surface, rgba(214,154,168,0.94));
          color: rgba(255,255,255,0.82);
          box-shadow:
            0 26px 54px -34px rgba(0,0,0,0.82),
            0 14px 26px -20px rgba(0,0,0,0.56),
            inset 0 1px 0 rgba(255,255,255,0.18);
          opacity: 0;
          pointer-events: none;
          transform: translate3d(0, 7px, 0) scale(0.955);
          transform-origin: right bottom;
          transition:
            opacity 220ms ease,
            transform 430ms var(--doro-start-ease),
            filter 260ms ease;
          font-size: 0.64rem;
          font-weight: 800;
          line-height: 1.32;
          letter-spacing: 0.015em;
          text-align: left;
          text-transform: none;
          white-space: normal;
          filter: blur(0.7px) saturate(0.96);
          backdrop-filter: blur(18px) saturate(1.12);
          -webkit-backdrop-filter: blur(18px) saturate(1.12);
        }
        .doro-start-mini-pomo-sound-wrap:hover::after,
        .doro-start-mini-pomo-sound-wrap:focus-within::after,
        .doro-start-mini-pomo-help-wrap:hover::after,
        .doro-start-mini-pomo-help-wrap:focus-within::after {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
          filter: blur(0) saturate(1);
        }
        .doro-start-mini-pomo-help-button,
        .doro-start-mini-pomo-sound-button {
          position: relative;
          display: inline-flex;
          width: 1.45rem;
          height: 1.45rem;
          align-items: center;
          justify-content: center;
          border-radius: 0.48rem;
          border: 1px solid rgba(255,255,255,0.15);
          background: rgba(255,255,255,0.09);
          color: rgba(255,255,255,0.78);
          transition:
            transform 240ms var(--doro-start-ease),
            background-color 220ms ease,
            border-color 220ms ease,
            color 220ms ease,
            box-shadow 260ms ease;
        }
        .doro-start-mini-pomo-help-button:hover,
        .doro-start-mini-pomo-help-button:focus-visible,
        .doro-start-mini-pomo-sound-button:hover,
        .doro-start-mini-pomo-sound-button:focus-visible {
          border-color: rgba(255,255,255,0.28);
          background: rgba(255,255,255,0.15);
          color: rgba(255,255,255,0.92);
          box-shadow: 0 12px 20px -16px rgba(0,0,0,0.78);
          transform: translate3d(0, -1px, 0);
          outline: none;
        }
        .doro-start-mini-pomo-sound-button.is-off {
          color: rgba(255,255,255,0.48);
          background: rgba(255,255,255,0.045);
        }
        .doro-start-mini-pomo-block-list {
          display: grid;
          gap: 0.38rem;
        }
        .doro-start-mini-pomo-block-option {
          display: flex;
          min-height: 2.45rem;
          width: 100%;
          align-items: center;
          gap: 0.58rem;
          border-radius: 0.72rem;
          border: 1px solid rgba(255,255,255,0.16);
          background:
            linear-gradient(145deg, rgba(255,255,255,0.065), rgba(255,255,255,0.022)),
            rgba(0,0,0,0.26);
          padding: 0.46rem 0.5rem;
          color: rgba(255,255,255,0.86);
          font-size: 0.62rem;
          font-weight: 800;
          line-height: 1;
          opacity: 0;
          transform: translate3d(0, 10px, 0) scale(0.96);
          filter: blur(0.7px);
          transition:
            opacity 180ms ease,
            transform 370ms var(--doro-start-ease),
            filter 300ms ease,
            background-color 280ms ease,
            border-color 280ms ease,
            color 260ms ease,
            box-shadow 300ms ease;
          transition-delay: 0ms;
          will-change: transform, opacity, box-shadow, background-color;
          backface-visibility: hidden;
        }
        .doro-start-mini-pomo-branch:hover .doro-start-mini-pomo-block-option,
        .doro-start-mini-pomo-branch:focus-within .doro-start-mini-pomo-block-option {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
          filter: blur(0);
          transition-delay: var(--doro-mini-block-delay, 150ms);
        }
        .doro-start-mini-pomo-block-option:hover,
        .doro-start-mini-pomo-block-option:focus-visible {
          border-color: rgba(255,255,255,0.28);
          background:
            linear-gradient(145deg, rgba(255,255,255,0.09), rgba(255,255,255,0.035)),
            rgba(0,0,0,0.36);
          color: #fff;
          box-shadow:
            0 14px 24px -20px rgba(0,0,0,0.66),
            inset 0 1px 0 rgba(255,255,255,0.09);
          transform: translate3d(0, -1px, 0) scale(1.003);
          outline: none;
        }
        .doro-start-mini-pomo-branch:hover .doro-start-mini-pomo-block-option:hover,
        .doro-start-mini-pomo-branch:focus-within .doro-start-mini-pomo-block-option:focus-visible {
          opacity: 1;
          border-color: rgba(255,255,255,0.28);
          background:
            linear-gradient(145deg, rgba(255,255,255,0.09), rgba(255,255,255,0.035)),
            rgba(0,0,0,0.36);
          color: #fff;
          box-shadow:
            0 18px 28px -24px rgba(0, 0, 0, 0.6),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
          filter: brightness(1.018);
          transform: translate3d(0, -1px, 0) scale(1.003);
          transition-delay: 0ms;
        }
        .doro-start-mini-pomo-block-option:active,
        .doro-start-mini-pomo-branch:hover .doro-start-mini-pomo-block-option:active,
        .doro-start-mini-pomo-branch:focus-within .doro-start-mini-pomo-block-option:active {
          transform: perspective(520px) translate3d(0, 0, 1px) scale(0.996) rotateX(0.08deg);
          box-shadow: 0 14px 24px -23px rgba(0, 0, 0, 0.54);
          filter: brightness(1);
          transition-delay: 0ms;
        }
        .doro-start-mini-pomo-block-option.is-active {
          border-color: rgba(255,255,255,0.24);
          background:
            linear-gradient(145deg, rgba(255,255,255,0.075), rgba(255,255,255,0.025)),
            rgba(0,0,0,0.36);
          color: #fff;
        }
        .doro-start-mini-pomo-block-number {
          display: inline-flex;
          width: 4.45rem;
          height: 1.45rem;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          border-radius: 0.46rem;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.075);
          font-family: inherit;
          font-size: 0.58rem;
          font-weight: 900;
          font-variant-numeric: tabular-nums;
          line-height: 1;
          letter-spacing: 0.045em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.82);
        }
        .doro-start-mini-pomo-block-text {
          display: flex;
          min-width: 0;
          flex: 1 1 auto;
          flex-direction: column;
          text-align: left;
        }
        .doro-start-mini-pomo-block-title {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: rgba(255,255,255,0.92);
          font-size: 0.68rem;
          font-weight: 900;
          line-height: 1;
          letter-spacing: 0.015em;
          text-transform: none;
        }
        .doro-start-mini-pomo-block-check {
          display: inline-flex;
          width: 1rem;
          height: 1rem;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.08);
          color: rgba(255,255,255,0);
          transition:
            color 220ms ease,
            border-color 220ms ease,
            background-color 220ms ease;
        }
        .doro-start-mini-pomo-block-option.is-active .doro-start-mini-pomo-block-check {
          border-color: rgba(255,255,255,0.25);
          background: rgba(255,255,255,0.16);
          color: #fff;
        }
        .doro-start-delayed-time,
        .doro-start-delay-slider-wrap,
        .doro-start-delayed-start-button {
          opacity: 0;
          transform: translate3d(0, 12px, 0) scale(0.97);
          transition:
            opacity 260ms ease,
            transform 500ms var(--doro-start-ease),
            box-shadow 280ms ease,
            background-color 280ms ease,
            border-color 280ms ease;
        }
        .doro-start-delayed-time {
          padding: 0 0.25rem;
          text-shadow: 0 13px 24px rgba(0, 0, 0, 0.34);
        }
        .doro-start-delayed-time-label {
          display: block;
          font-family: inherit;
          font-size: 0.625rem;
          font-weight: 700;
          line-height: 1;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.5);
        }
        .doro-start-delayed-time-value {
          display: block;
          margin-top: 0.22rem;
          font-family: inherit;
          font-size: 2.45rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          line-height: 0.9;
          letter-spacing: 0;
          color: #fff;
        }
        .doro-start-delay-slider-wrap {
          position: relative;
          padding: 1rem 0.2rem 0;
        }
        .doro-start-delay-minutes-label {
          position: absolute;
          top: 0;
          left: clamp(1.15rem, var(--doro-delay-progress, 0%), calc(100% - 1.15rem));
          transform: translate3d(-50%, 0, 0);
          color: rgba(255, 255, 255, 0.62);
          font-family: inherit;
          font-size: 0.625rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          line-height: 1;
          letter-spacing: 0.04em;
          text-shadow: 0 10px 18px rgba(0, 0, 0, 0.46);
          white-space: nowrap;
          pointer-events: none;
          transition:
            left 130ms ease-out,
            color 240ms ease,
            opacity 240ms ease;
        }
        .doro-start-delayed-start-button {
          border-color: rgba(255, 255, 255, 0.2);
          background:
            linear-gradient(145deg, rgba(255,255,255,0.075), rgba(255,255,255,0.025)),
            rgba(0, 0, 0, 0.28);
          box-shadow:
            0 14px 26px -24px rgba(0, 0, 0, 0.58),
            inset 0 1px 0 rgba(255, 255, 255, 0.08);
          font-family: inherit;
          transform-origin: center;
          transition:
            opacity 180ms ease,
            transform 370ms var(--doro-start-ease),
            box-shadow 300ms ease,
            background-color 280ms ease,
            border-color 280ms ease,
            color 260ms ease,
            filter 280ms ease;
          will-change: transform, opacity, box-shadow, background-color;
        }
        .doro-start-delayed-panel.is-active .doro-start-delayed-time,
        .doro-start-delayed-panel.is-active .doro-start-delay-slider-wrap,
        .doro-start-delayed-panel.is-active .doro-start-delayed-start-button {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
        }
        .doro-start-delayed-panel.is-active .doro-start-delayed-time {
          transition-delay: 0ms;
        }
        .doro-start-delayed-panel.is-active .doro-start-delay-slider-wrap {
          transition-delay: 0ms;
        }
        .doro-start-delayed-panel.is-active .doro-start-delayed-start-button {
          transition-delay: 0ms;
        }
        .doro-start-session-shell.is-view-entering .doro-start-delayed-panel.is-active .doro-start-delayed-time {
          transition-delay: 185ms;
        }
        .doro-start-session-shell.is-view-entering .doro-start-delayed-panel.is-active .doro-start-delay-slider-wrap {
          transition-delay: 245ms;
        }
        .doro-start-session-shell.is-view-entering .doro-start-delayed-panel.is-active .doro-start-delayed-start-button {
          transition-delay: 305ms;
        }
        .doro-start-delayed-start-button:hover {
          border-color: rgba(255, 255, 255, 0.3);
          background:
            linear-gradient(145deg, rgba(255,255,255,0.08), rgba(255,255,255,0.025)),
            rgba(0, 0, 0, 0.35);
          box-shadow:
            0 18px 28px -24px rgba(0, 0, 0, 0.62),
            inset 0 1px 0 rgba(255, 255, 255, 0.11);
          transform: translate3d(0, -1px, 0) scale(1.003);
        }
        .doro-start-delayed-start-button:active {
          transform: perspective(520px) translate3d(0, 0, 1px) scale(0.996) rotateX(0.06deg);
          box-shadow: 0 14px 24px -23px rgba(0, 0, 0, 0.54);
        }
        .doro-start-delay-slider {
          width: 100%;
          height: 1.05rem;
          appearance: none;
          -webkit-appearance: none;
          background: transparent;
          cursor: pointer;
          display: block;
        }
        .doro-start-delay-slider::-webkit-slider-runnable-track {
          height: 0.38rem;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background:
            linear-gradient(
              90deg,
              rgba(255,255,255,0.55) 0%,
              rgba(255,255,255,0.42) var(--doro-delay-progress, 0%),
              rgba(255,255,255,0.16) var(--doro-delay-progress, 0%),
              rgba(255,255,255,0.12) 100%
            );
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.34);
          transition: background 160ms ease;
        }
        .doro-start-delay-slider::-webkit-slider-thumb {
          width: 1.05rem;
          height: 1.05rem;
          margin-top: -0.38rem;
          appearance: none;
          -webkit-appearance: none;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.72);
          background: rgba(255,255,255,0.92);
          box-shadow: 0 12px 22px -12px rgba(0,0,0,0.72);
          transition:
            transform 160ms ease,
            box-shadow 160ms ease,
            background-color 160ms ease;
        }
        .doro-start-delay-slider:hover::-webkit-slider-thumb {
          transform: scale(1.08);
          background: rgba(255,255,255,0.98);
          box-shadow: 0 15px 24px -12px rgba(0,0,0,0.78);
        }
        .doro-start-delay-slider::-moz-range-track {
          height: 0.38rem;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background:
            linear-gradient(
              90deg,
              rgba(255,255,255,0.55) 0%,
              rgba(255,255,255,0.42) var(--doro-delay-progress, 0%),
              rgba(255,255,255,0.16) var(--doro-delay-progress, 0%),
              rgba(255,255,255,0.12) 100%
            );
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.34);
        }
        .doro-start-delay-slider::-moz-range-thumb {
          width: 1.05rem;
          height: 1.05rem;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.72);
          background: rgba(255,255,255,0.92);
          box-shadow: 0 12px 22px -12px rgba(0,0,0,0.72);
          transition:
            transform 160ms ease,
            box-shadow 160ms ease,
            background-color 160ms ease;
        }
        .doro-start-delay-slider:hover::-moz-range-thumb {
          transform: scale(1.08);
          background: rgba(255,255,255,0.98);
          box-shadow: 0 15px 24px -12px rgba(0,0,0,0.78);
        }
        .doro-reset-icon {
          transform-origin: center;
          transform-box: fill-box;
        }
        .group:hover .doro-reset-icon {
          animation: doro-reset-icon-spin 820ms linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .doro-timer-mode-stage,
          .doro-timer-mode-content,
          .doro-focus-single-stage,
          .doro-focus-single-start-slot,
          .doro-focus-single-card,
          .doro-focus-single-card::after,
          .doro-focus-single-card-lift,
          .doro-focus-single-card-inner,
          .doro-focus-single-face,
          .doro-focus-single-sheen,
          .doro-focus-single-face-content,
          .doro-focus-single-label,
          .doro-focus-single-value,
          .doro-focus-single-hint,
          .doro-start-session-shell,
          .doro-start-session-button,
          .doro-start-session-menu,
          .doro-start-session-panel,
          .doro-start-session-choice,
          .doro-start-session-option,
          .doro-start-mini-pomo-popout,
          .doro-start-mini-pomo-block-option,
          .doro-start-mini-pomo-help-button,
          .doro-start-mini-pomo-help-wrap::after,
          .doro-start-mini-pomo-sound-button,
          .doro-start-mini-pomo-sound-wrap::after,
          .doro-start-delayed-time,
          .doro-start-delay-slider-wrap,
          .doro-start-delay-minutes-label,
          .doro-start-delayed-start-button,
          .doro-focus-timer-label,
          .doro-focus-timer-time,
          .doro-focus-timer-shell::after {
            animation: none !important;
            transition-duration: 1ms !important;
            transition-delay: 0ms !important;
          }
          .doro-start-session-panel.is-active,
          .doro-start-choice-panel.is-active .doro-start-session-choice,
          .doro-start-session-shell.is-open.view-timer .doro-start-session-option,
          .doro-start-mini-pomo-branch:hover .doro-start-mini-pomo-popout,
          .doro-start-mini-pomo-branch:focus-within .doro-start-mini-pomo-popout,
          .doro-start-mini-pomo-branch:hover .doro-start-mini-pomo-block-option,
          .doro-start-mini-pomo-branch:focus-within .doro-start-mini-pomo-block-option,
          .doro-start-delayed-panel.is-active .doro-start-delayed-time,
          .doro-start-delayed-panel.is-active .doro-start-delay-slider-wrap,
          .doro-start-delayed-panel.is-active .doro-start-delayed-start-button {
            opacity: 1;
            transform: none;
            filter: none;
          }
          .doro-start-session-shell.is-exiting {
            opacity: 0;
            transform: scale(0.7);
          }
          .doro-timer-mode-stage,
          .doro-timer-mode-content,
          .doro-focus-single-stage,
          .doro-focus-single-start-slot,
          .doro-focus-single-card,
          .doro-focus-single-card.is-flip-animating {
            transform: none !important;
            filter: none !important;
          }
          .doro-focus-single-sheen,
          .doro-focus-single-face-content {
            transform: none !important;
            filter: none !important;
          }
          .doro-focus-single-face-content,
          .doro-focus-single-card:hover,
          .doro-focus-single-card:focus-visible {
            transform: none !important;
          }
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
      <div className={`doro-timer-mode-stage ${timerModeTransitionClassName}`}>
        <div className="doro-timer-mode-content">
          {renderedIsFocusTimerPreset ? (
            <div className="doro-focus-single-stage w-full mt-8 md:mt-0">
          <FocusTimerSingleDisplay
            workTime={workTime}
            breakTime={breakTime}
            activeMode={activeMode}
            focusLabel={focusTimerLabel}
            focusDisplayValue={focusTimerDisplayValue}
            focusDisplayHidden={isFocusTimerHidden}
            breakLabel={delayedStartBeginLabel}
            breakDisplayValue={breakSquareDisplayOptions.displayValue}
            breakDisplayVariant={breakSquareDisplayOptions.displayVariant}
            breakHideLabel={breakSquareDisplayOptions.hideLabel}
            isIdle={isIdle}
            timerStarted={timerStarted}
            focusFlipPauseActive={focusFlipPauseActive}
            surfaceColor={idlePresetSurfaceColor}
            disableBlur={settings.disableBlur}
            canStartOnClick={isFocusTimerReadyToStart}
            onStart={startTimer}
            onPauseForFlip={pauseFocusTimerForFlip}
            onResumeFromFlip={resumeFocusTimerFromFlip}
            onToggleFocusHidden={toggleFocusTimerHidden}
          />
          <div className="doro-focus-single-start-slot">
            <IdlePresetControl
                isRendered={shouldRenderIdlePresetControl}
                isVisible={isIdlePresetControlVisible}
                isOpen={isIdlePresetMenuOpen}
                settings={settings}
                surfaceColor={idlePresetSurfaceColor}
                chromeButtonClass={chromeButtonClass}
                topIconClass={topIconClass}
                onOpenChange={setIsIdlePresetMenuOpen}
                onSelectPreset={selectIdlePreset}
                onSelectMiniPomoBlock={selectMiniPomoAutoStartBlock}
                onToggleMiniPomoAutoStartSound={toggleMiniPomoAutoStartSound}
                onStartDelayedStart={startDelayedStart}
            />
          </div>
        </div>
      ) : (
        <div className={`flex flex-col md:flex-row items-center justify-center ${timerContainerGapClass} w-full mt-8 md:mt-0 transition-[gap] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]`}>
          <TimerSquare
              type="work"
              time={workTime}
              maxTime={settings.workDuration}
              activeMode={activeMode}
              label={activeTask ? activeTask.name : (renderedIsFocusTimerPreset ? 'Focus Timer' : 'Focus')}
              displayValue={renderedIsFocusTimerPreset ? focusTimerDisplayValue : undefined}
              displayHidden={renderedIsFocusTimerPreset && isFocusTimerHidden}
              hideLiquid={renderedIsFocusTimerPreset}
              isIdle={isIdle}
              isLocked={!renderedIsFocusTimerPreset && lockedTimerMode === 'work'}
              disableBlur={settings.disableBlur}
              enableLockControls
              allowHoldWhenInactive={renderedIsFocusTimerPreset}
              holdHintLabel={renderedIsFocusTimerPreset ? (isFocusTimerHidden ? 'Hold to Show Timer' : 'Hold to Hide Timer') : undefined}
              promoteLabelWhenDisplayHidden={renderedIsFocusTimerPreset}
              onActivate={activateMode}
              onToggleLock={toggleTimerLock}
              onHoldAction={renderedIsFocusTimerPreset ? toggleFocusTimerHidden : undefined}
          />
          <IdlePresetControl
              isRendered={shouldRenderIdlePresetControl}
              isVisible={isIdlePresetControlVisible}
              isOpen={isIdlePresetMenuOpen}
              settings={settings}
              surfaceColor={idlePresetSurfaceColor}
              chromeButtonClass={chromeButtonClass}
              topIconClass={topIconClass}
              onOpenChange={setIsIdlePresetMenuOpen}
              onSelectPreset={selectIdlePreset}
              onSelectMiniPomoBlock={selectMiniPomoAutoStartBlock}
              onToggleMiniPomoAutoStartSound={toggleMiniPomoAutoStartSound}
              onStartDelayedStart={startDelayedStart}
          />
          <TimerSquare
              type="break"
              time={breakTime}
              maxTime={settings.longBreakDuration}
              activeMode={activeMode}
              label={delayedStartBeginLabel}
              displayValue={breakSquareDisplayOptions.displayValue}
              displayVariant={breakSquareDisplayOptions.displayVariant}
              hideLabel={breakSquareDisplayOptions.hideLabel}
              hideLiquid={breakSquareDisplayOptions.hideLiquid}
              isIdle={isIdle}
              isLocked={!renderedIsFocusTimerPreset && lockedTimerMode === 'break'}
              disableBlur={settings.disableBlur}
              enableLockControls={!renderedIsFocusTimerPreset}
              onActivate={activateMode}
              onToggleLock={toggleTimerLock}
          />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TimerDisplay;
