import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { Check, Heart, X } from 'lucide-react';
import { TimerMode, TimerSpectatorState } from '../types';
import { DEFAULT_BREAK_SURFACE, DEFAULT_WORK_SURFACE, getMutedSurfaceColor } from '../utils/palette';
import {
  buildEncouragementOptions,
  normalizeEncouragementSubject,
  type EncouragementPrompt,
  type EncouragementPromptContext,
} from '../utils/encouragementPrompts';
import { formatPomodoroCount, getStandardPomodoroCountForTimer } from '../utils/pomodoroAccounting';
import {
  formatTimerShareEndLabel,
  getSpectatorSettingsFallback,
  getTimerShareEstimateFromSpectatorState,
} from '../utils/timerShare';
import { deriveRuntimeValues } from '../utils/timerRuntime';

interface SpectatorTimerPageProps {
  sessionId: string;
  previewEndMs?: number | null;
  previewEndLabel?: string | null;
  previewMode?: TimerMode;
  previewRemainingSeconds?: number | null;
  previewEndKind?: 'phase' | 'finish';
}

type ConnectionStatus = 'connecting' | 'live' | 'disconnected' | 'error';
type SpectatorEncouragementFeedback = {
  id: string;
  phase: 'sending' | 'sent' | 'error';
  message: string;
};

const normalizeSessionId = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 64);
const SPECTATOR_VIEWER_NAME = 'Timer Viewer';
const SPECTATOR_ENCOURAGEMENT_FEEDBACK_MS = 2600;
const SPECTATOR_ENCOURAGEMENT_ACK_TIMEOUT_MS = 7000;

const SpectatorLoadingScreen: React.FC<{ surfaceColor: string }> = ({ surfaceColor }) => (
  <div
    className="flex min-h-screen w-full items-center justify-center px-6 text-white"
    style={{ background: surfaceColor }}
    role="status"
    aria-label="Loading Workspace"
  >
    <style>{`
      @keyframes doroSpectatorBootSweep {
        0% { transform: translateX(-110%); }
        100% { transform: translateX(240%); }
      }
      @keyframes doroSpectatorBootDotPulse {
        0%, 80%, 100% {
          transform: translateY(0) scale(0.7);
          opacity: 0.28;
        }
        40% {
          transform: translateY(-3px) scale(1);
          opacity: 1;
        }
      }
      .doro-spectator-boot-shell {
        width: min(92vw, 540px);
        border-radius: 34px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.06)),
          linear-gradient(145deg, rgba(255, 255, 255, 0.16), rgba(15, 23, 42, 0.18));
        backdrop-filter: blur(24px) saturate(160%);
        -webkit-backdrop-filter: blur(24px) saturate(160%);
        box-shadow: 0 40px 80px -54px rgba(15, 23, 42, 0.72);
        padding: 28px 28px 24px;
        text-align: center;
      }
      .doro-spectator-boot-kicker {
        font-family: "Outfit", "Manrope", ui-sans-serif, sans-serif;
        font-size: clamp(18px, 3vw, 24px);
        font-weight: 500;
        letter-spacing: -0.04em;
        color: rgba(255, 255, 255, 0.74);
      }
      .doro-spectator-boot-logo {
        font-family: "Outfit", "Manrope", ui-sans-serif, sans-serif;
        font-size: clamp(56px, 10vw, 90px);
        font-weight: 700;
        letter-spacing: -0.07em;
        line-height: 0.88;
        color: rgba(255, 255, 255, 0.94);
        text-transform: lowercase;
        user-select: none;
      }
      .doro-spectator-boot-copy {
        margin-top: 18px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.56);
      }
      .doro-spectator-boot-dots {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .doro-spectator-boot-dots span {
        width: 5px;
        height: 5px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.78);
        animation: doroSpectatorBootDotPulse 1.1s ease-in-out infinite;
      }
      .doro-spectator-boot-dots span:nth-child(2) { animation-delay: 0.14s; }
      .doro-spectator-boot-dots span:nth-child(3) { animation-delay: 0.28s; }
      .doro-spectator-boot-bar {
        margin-top: 22px;
        position: relative;
        height: 8px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.1);
      }
      .doro-spectator-boot-bar::after {
        content: "";
        position: absolute;
        inset: 0;
        width: 45%;
        border-radius: inherit;
        background: linear-gradient(90deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.18));
        animation: doroSpectatorBootSweep 1.15s ease-in-out infinite;
        transform-origin: left center;
      }
      @media (prefers-reduced-motion: reduce) {
        .doro-spectator-boot-dots span,
        .doro-spectator-boot-bar::after {
          animation: none !important;
        }
      }
    `}</style>
    <div className="doro-spectator-boot-shell">
      <div className="flex flex-col items-center justify-center gap-1.5">
        <div className="doro-spectator-boot-kicker">Pomo with</div>
        <div className="doro-spectator-boot-logo">doro</div>
      </div>
      <div className="doro-spectator-boot-copy">
        <span>Loading Workspace</span>
        <span className="doro-spectator-boot-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </div>
      <div className="doro-spectator-boot-bar" />
    </div>
  </div>
);

const isTimerSpectatorState = (value: unknown): value is TimerSpectatorState => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TimerSpectatorState>;
  return candidate.version === 1
    && (candidate.activeMode === 'work' || candidate.activeMode === 'break')
    && typeof candidate.workTime === 'number'
    && typeof candidate.breakTime === 'number'
    && (candidate.sessionStartTime === undefined || candidate.sessionStartTime === null || typeof candidate.sessionStartTime === 'string')
    && (candidate.activeCategoryName === undefined || typeof candidate.activeCategoryName === 'string')
    && (candidate.activeCategoryColor === undefined || typeof candidate.activeCategoryColor === 'string');
};

const formatTimerSquareTime = (seconds: number) => {
  const absSeconds = Math.abs(seconds);
  const minutes = Math.floor(absSeconds / 60);
  const secs = Math.floor(absSeconds % 60);
  const sign = seconds < 0 ? '-' : '';
  return `${sign}${minutes}:${secs.toString().padStart(2, '0')}`;
};

const clampPercent = (value: number, max: number = 1) => Math.max(0, Math.min(max, value));

const getSafeTimestampMs = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
);

interface SpectatorTimerTileProps {
  type: TimerMode;
  time: number;
  maxTime: number;
  activeMode: TimerMode;
  label?: string;
  displayValue?: string;
  displayVariant?: 'time' | 'word';
  hideLabel?: boolean;
  hideLiquid?: boolean;
  isLiveish: boolean;
}

const SpectatorLiquidWave = ({
  percent,
  isVisible,
  isActive,
  colorMode = 'default',
}: {
  percent: number;
  isVisible: boolean;
  isActive: boolean;
  colorMode?: 'default' | 'red';
}) => {
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
      return undefined;
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

  const bottomVal = -300 + (displayPercent * 140);
  const waveBase = colorMode === 'red' ? 'bg-red-500' : 'bg-white';
  const backOpacity = colorMode === 'red' ? 'opacity-20' : 'opacity-10';
  const middleOpacity = colorMode === 'red' ? 'opacity-30' : 'opacity-20';
  const frontOpacity = colorMode === 'red' ? 'opacity-40' : 'opacity-30';
  const waveLevelStyle = {
    willChange: 'bottom, transform',
    transform: 'translateZ(0)',
    backfaceVisibility: 'hidden' as const,
  };

  return (
    <div className={`doro-spectator-liquid-mask absolute inset-0 z-0 overflow-hidden rounded-[inherit] transition-opacity duration-1000 pointer-events-none ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
      <div
        className={`absolute left-[-100%] w-[300%] aspect-square ${waveBase} ${backOpacity} rounded-[45%] doro-spectator-wave-slow`}
        style={{ ...waveLevelStyle, bottom: `${bottomVal}%` }}
      />
      <div
        className={`absolute left-[-100%] w-[300%] aspect-square ${waveBase} ${middleOpacity} rounded-[47%] doro-spectator-wave-med`}
        style={{ ...waveLevelStyle, bottom: `${bottomVal - 1.5}%`, animationDelay: '-8s' }}
      />
      <div
        className={`absolute left-[-100%] w-[300%] aspect-square ${waveBase} ${frontOpacity} rounded-[46%] doro-spectator-wave-fast`}
        style={{ ...waveLevelStyle, bottom: `${bottomVal - 3}%`, animationDelay: '-3s' }}
      />
    </div>
  );
};

const SpectatorTimerTile: React.FC<SpectatorTimerTileProps> = ({
  type,
  time,
  maxTime,
  activeMode,
  label,
  displayValue,
  displayVariant = 'time',
  hideLabel = false,
  hideLiquid = false,
  isLiveish,
}) => {
  const isWork = type === 'work';
  const isActive = isLiveish && activeMode === type;
  let fillPercent = 0;
  let showLiquid = true;
  let liquidColor: 'default' | 'red' = 'default';

  if (isWork) {
    const ratio = clampPercent(time / Math.max(1, maxTime));
    fillPercent = Math.pow(1 - ratio, 1.35);
  } else if (time < 0) {
    fillPercent = clampPercent(Math.abs(time) / 600);
    liquidColor = 'red';
  } else {
    fillPercent = clampPercent(time / Math.max(1, 1200));
    if (time <= 5) showLiquid = false;
  }

  const containerClasses = isActive
    ? 'z-20 scale-100 opacity-100 bg-white/10 border-white/20 shadow-[0_30px_60px_-10px_rgba(0,0,0,0.3)] ring-1 ring-white/30 backdrop-blur-xl'
    : 'z-10 scale-90 opacity-60 bg-transparent border-transparent shadow-none';
  const textClasses = isActive
    ? 'scale-100 text-white drop-shadow-2xl'
    : 'scale-90 text-white/50 saturate-50 blur-[2px]';
  const labelClasses = isActive
    ? 'text-white/90 translate-y-0'
    : 'text-white/42 blur-[2px]';

  return (
    <div
      className={`
        doro-spectator-liquid-shell relative flex aspect-square w-[42vw] max-w-[12rem] shrink-0 transform-gpu flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[1.75rem] border
        transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]
        sm:w-[12.5rem] sm:max-w-[12.5rem] md:w-[14rem] md:max-w-[14rem] md:rounded-[2.1rem] lg:w-[15rem] lg:max-w-[15rem]
        ${containerClasses}
      `}
    >
      <SpectatorLiquidWave
        percent={fillPercent}
        isVisible={isActive && showLiquid && !hideLiquid}
        isActive={isActive}
        colorMode={liquidColor}
      />

      {isActive && (
        <>
          <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-tr from-white/10 via-white/0 to-transparent" />
          <div className="pointer-events-none absolute -left-1/2 -top-1/2 z-10 h-[200%] w-[200%] rounded-full bg-gradient-to-b from-white/10 to-transparent blur-[80px] mix-blend-overlay" />
          <div className="pointer-events-none absolute inset-0 z-20 rounded-[inherit] shadow-[inset_0_0_46px_rgba(255,255,255,0.1)]" />
        </>
      )}

      {!hideLabel && (
        <div className={`z-20 max-w-[82%] truncate text-center text-[10px] font-bold uppercase tracking-[0.18em] transition-all duration-500 md:text-xs ${labelClasses}`}>
          <span className="relative z-10 drop-shadow-md">{label || (isWork ? 'Focus' : 'Break Bank')}</span>
        </div>
      )}

      <div className={`z-20 font-sans font-bold leading-none tabular-nums transition-all duration-500 ${
        displayVariant === 'word'
          ? 'text-[2.25rem] uppercase tracking-normal sm:text-[2.8rem] md:text-[3.55rem] lg:text-[3.95rem]'
          : 'text-[2.6rem] tracking-tighter sm:text-[3.35rem] md:text-[4.45rem] lg:text-[4.9rem]'
      } ${textClasses} ${displayVariant === 'time' && time < 0 ? 'text-red-200 drop-shadow-[0_0_15px_rgba(220,38,38,0.5)]' : ''}`}>
        <span className="drop-shadow-lg filter">{displayValue || formatTimerSquareTime(time)}</span>
      </div>
    </div>
  );
};

const getSpectatorFocusTimerDisplaySeconds = (
  state: TimerSpectatorState | null,
  focusTime: number,
) => {
  if (!state || state.settings.timerPreset !== 'focus') return focusTime;

  const workDuration = Number.isFinite(state.settings.workDuration)
    ? Math.max(0, state.settings.workDuration)
    : 0;
  const completedWorkSeconds = Math.max(0, Number(state.pomodoroCount) || 0) * workDuration;
  const shouldIncludeCurrentCycle = !state.isIdle && !state.graceOpen;
  const currentCycleSeconds = shouldIncludeCurrentCycle
    ? Math.max(0, workDuration - Math.max(0, focusTime))
    : 0;

  return completedWorkSeconds + currentCycleSeconds;
};

const getPreviewEstimate = (
  previewEndMs: number | null | undefined,
  previewRemainingSeconds: number | null | undefined,
  nowMs: number,
) => {
  if (typeof previewEndMs === 'number' && Number.isFinite(previewEndMs)) {
    return {
      remainingSeconds: Math.max(0, Math.round((previewEndMs - nowMs) / 1000)),
      endMs: previewEndMs,
      status: 'running' as const,
    };
  }

  if (typeof previewRemainingSeconds === 'number' && Number.isFinite(previewRemainingSeconds)) {
    const safeRemaining = Math.max(0, Math.round(previewRemainingSeconds));
    return {
      remainingSeconds: safeRemaining,
      endMs: nowMs + (safeRemaining * 1000),
      status: 'running' as const,
    };
  }

  return {
    remainingSeconds: null,
    endMs: null,
    status: 'idle' as const,
  };
};

const getSpectatorPomoPromptMeta = (state: TimerSpectatorState | null) => {
  if (!state) {
    return {
      currentPomoNumber: null,
      completedPomoCount: null,
      pomoLabel: 'first pomo',
    };
  }

  const completedPomoCount = Number.isFinite(Number(state.todayPomodoroCount))
    ? Math.max(0, Number(state.todayPomodoroCount))
    : getStandardPomodoroCountForTimer(Number(state.pomodoroCount) || 0, state.settings);
  const unitLabel = completedPomoCount === 1 ? 'pomo' : 'pomos';

  return {
    currentPomoNumber: state.isIdle ? null : completedPomoCount,
    completedPomoCount,
    pomoLabel: completedPomoCount > 0 ? `${formatPomodoroCount(completedPomoCount)} ${unitLabel}` : 'first pomo',
  };
};

const getSpectatorEncouragementContext = (
  state: TimerSpectatorState | null,
  activeMode: TimerMode,
): EncouragementPromptContext => {
  const pomoMeta = getSpectatorPomoPromptMeta(state);
  return {
    ...pomoMeta,
    taskName: normalizeEncouragementSubject(state?.activeTaskName, ['No selected task']),
    categoryName: normalizeEncouragementSubject(state?.activeCategoryName, ['Uncategorized']),
    isBreak: activeMode === 'break',
  };
};

const SpectatorTimerPage: React.FC<SpectatorTimerPageProps> = ({
  sessionId,
  previewEndMs = null,
  previewEndLabel = null,
  previewMode = 'work',
  previewRemainingSeconds = null,
  previewEndKind = 'phase',
}) => {
  const normalizedSessionId = useMemo(() => normalizeSessionId(sessionId), [sessionId]);
  const [status, setStatus] = useState<ConnectionStatus>(normalizedSessionId ? 'connecting' : 'error');
  const [remoteState, setRemoteState] = useState<TimerSpectatorState | null>(null);
  const [message, setMessage] = useState(normalizedSessionId ? 'Connecting to live timer...' : 'Missing timer link.');
  const [nowMs, setNowMs] = useState(Date.now());
  const [encouragementMenuOpen, setEncouragementMenuOpen] = useState(false);
  const [encouragementOptions, setEncouragementOptions] = useState<EncouragementPrompt[]>([]);
  const [encouragementFeedback, setEncouragementFeedback] = useState<SpectatorEncouragementFeedback | null>(null);
  const connectionRef = useRef<DataConnection | null>(null);
  const encouragementMenuRef = useRef<HTMLDivElement | null>(null);
  const pendingEncouragementIdRef = useRef<string | null>(null);
  const encouragementFeedbackTimeoutRef = useRef<number | null>(null);
  const encouragementAckTimeoutRef = useRef<number | null>(null);
  const focusDisplaySessionRef = useRef<string | null>(null);
  const focusDisplaySecondsRef = useRef(0);

  useEffect(() => {
    const tick = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  const spectatorSettings = useMemo(
    () => remoteState?.settings || getSpectatorSettingsFallback(),
    [remoteState?.settings],
  );
  const isFocusTimerPreset = spectatorSettings.timerPreset === 'focus';

  const clearEncouragementFeedbackTimer = useCallback(() => {
    if (encouragementFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(encouragementFeedbackTimeoutRef.current);
      encouragementFeedbackTimeoutRef.current = null;
    }
  }, []);

  const clearEncouragementAckTimer = useCallback(() => {
    if (encouragementAckTimeoutRef.current !== null) {
      window.clearTimeout(encouragementAckTimeoutRef.current);
      encouragementAckTimeoutRef.current = null;
    }
  }, []);

  const showEncouragementFeedback = useCallback((
    feedback: SpectatorEncouragementFeedback,
    visibleMs: number = SPECTATOR_ENCOURAGEMENT_FEEDBACK_MS,
  ) => {
    clearEncouragementFeedbackTimer();
    setEncouragementFeedback(feedback);
    encouragementFeedbackTimeoutRef.current = window.setTimeout(() => {
      encouragementFeedbackTimeoutRef.current = null;
      setEncouragementFeedback(current => current?.id === feedback.id ? null : current);
    }, visibleMs);
  }, [clearEncouragementFeedbackTimer]);

  useEffect(() => () => {
    clearEncouragementFeedbackTimer();
    clearEncouragementAckTimer();
  }, [clearEncouragementAckTimer, clearEncouragementFeedbackTimer]);

  useEffect(() => {
    if (!normalizedSessionId) return undefined;

    let disposed = false;
    let peer: Peer | null = null;
    setStatus('connecting');
    setMessage('Connecting to live timer...');

    const cleanupConnection = () => {
      try { connectionRef.current?.close(); } catch {}
      connectionRef.current = null;
    };

    try {
      // @ts-ignore PeerJS browser constructor accepts no args.
      peer = new Peer();
      peer.on('open', () => {
        if (disposed || !peer) return;
        const connection = peer.connect(normalizedSessionId, {
          metadata: { spectator: true, name: 'Timer Viewer' },
        });
        connectionRef.current = connection;

        connection.on('open', () => {
          if (disposed) return;
          setStatus('live');
          setMessage('');
          connection.send({ type: 'SPECTATOR_REQUEST' });
        });

        connection.on('data', (data: any) => {
          if (disposed || !data || typeof data !== 'object') return;
          if (data.type === 'SPECTATOR_STATE' && isTimerSpectatorState(data.state)) {
            setRemoteState(data.state);
            setStatus('live');
            setMessage('');
            return;
          }
          if (data.type === 'SPECTATOR_ENCOURAGEMENT_ACK') {
            if (typeof data.id !== 'string' || data.id !== pendingEncouragementIdRef.current) return;
            pendingEncouragementIdRef.current = null;
            clearEncouragementAckTimer();
            showEncouragementFeedback({
              id: data.id,
              phase: 'sent',
              message: 'Sent',
            });
            return;
          }
          if (data.type === 'SPECTATOR_ENCOURAGEMENT_ERROR') {
            if (typeof data.id !== 'string' || data.id !== pendingEncouragementIdRef.current) return;
            pendingEncouragementIdRef.current = null;
            clearEncouragementAckTimer();
            showEncouragementFeedback({
              id: data.id,
              phase: 'error',
              message: typeof data.error === 'string' && data.error.trim() ? data.error.trim().slice(0, 80) : 'Could not send',
            });
          }
        });

        connection.on('close', () => {
          if (disposed) return;
          setStatus('disconnected');
          setMessage('The live timer is not broadcasting right now.');
          if (pendingEncouragementIdRef.current) {
            const id = pendingEncouragementIdRef.current;
            pendingEncouragementIdRef.current = null;
            clearEncouragementAckTimer();
            showEncouragementFeedback({
              id,
              phase: 'error',
              message: 'Viewer disconnected',
            });
          }
        });

        connection.on('error', () => {
          if (disposed) return;
          setStatus('error');
          setMessage('Unable to connect to this live timer.');
          if (pendingEncouragementIdRef.current) {
            const id = pendingEncouragementIdRef.current;
            pendingEncouragementIdRef.current = null;
            clearEncouragementAckTimer();
            showEncouragementFeedback({
              id,
              phase: 'error',
              message: 'Could not send',
            });
          }
        });
      });

      peer.on('error', () => {
        if (disposed) return;
        setStatus('error');
        setMessage('Unable to connect to this live timer.');
      });
    } catch {
      setStatus('error');
      setMessage('Unable to start the viewer.');
    }

    return () => {
      disposed = true;
      cleanupConnection();
      pendingEncouragementIdRef.current = null;
      clearEncouragementAckTimer();
      try { peer?.destroy(); } catch {}
    };
  }, [clearEncouragementAckTimer, normalizedSessionId, showEncouragementFeedback]);

  const timerValues = useMemo(() => {
    if (!remoteState) {
      return {
        activeMode: previewMode,
        focusTime: previewMode === 'work' && previewRemainingSeconds ? previewRemainingSeconds : 0,
        breakTime: previewMode === 'break' && previewRemainingSeconds ? previewRemainingSeconds : 0,
        focusDisplayTime: previewMode === 'work' && previewRemainingSeconds ? previewRemainingSeconds : 0,
      };
    }

    const derived = remoteState.runtime
      ? deriveRuntimeValues(remoteState.runtime, nowMs)
      : {
          workTime: remoteState.workTime,
          breakTime: remoteState.breakTime,
          allPauseTime: remoteState.allPauseTime,
          graceTotal: 0,
        };
    const runtimeMode = remoteState.runtime?.phase === 'running-break' ? 'break' : remoteState.activeMode;

    return {
      activeMode: runtimeMode,
      focusTime: derived.workTime,
      breakTime: derived.breakTime,
      focusDisplayTime: getSpectatorFocusTimerDisplaySeconds(remoteState, derived.workTime),
    };
  }, [nowMs, previewMode, previewRemainingSeconds, remoteState]);
  const focusDisplaySessionKey = remoteState?.sessionStartTime
    || (remoteState && !remoteState.isIdle ? normalizedSessionId : null);
  if (!isFocusTimerPreset) {
    focusDisplaySessionRef.current = null;
    focusDisplaySecondsRef.current = 0;
  } else if (focusDisplaySessionRef.current !== focusDisplaySessionKey) {
    focusDisplaySessionRef.current = focusDisplaySessionKey;
    focusDisplaySecondsRef.current = 0;
  }
  if (isFocusTimerPreset && (!remoteState || remoteState.isIdle)) {
    focusDisplaySecondsRef.current = 0;
  }
  const spectatorFocusDisplayTime = isFocusTimerPreset
    ? Math.max(timerValues.focusDisplayTime, focusDisplaySecondsRef.current)
    : timerValues.focusDisplayTime;
  if (isFocusTimerPreset) {
    focusDisplaySecondsRef.current = spectatorFocusDisplayTime;
  }

  const canSendEncouragement = status === 'live' && Boolean(connectionRef.current?.open);
  const isEncouragementSending = encouragementFeedback?.phase === 'sending';

  const openEncouragementMenu = () => {
    if (!canSendEncouragement || isEncouragementSending) return;
    setEncouragementOptions(buildEncouragementOptions(getSpectatorEncouragementContext(remoteState, timerValues.activeMode)));
    setEncouragementMenuOpen(true);
  };

  const toggleEncouragementMenu = () => {
    if (encouragementMenuOpen) {
      setEncouragementMenuOpen(false);
      return;
    }
    openEncouragementMenu();
  };

  const sendSpectatorEncouragement = (prompt: EncouragementPrompt) => {
    const connection = connectionRef.current;
    const messageText = prompt.message.trim();
    if (!messageText) return;
    if (!connection?.open) {
      showEncouragementFeedback({
        id: `spectator-error-${Date.now()}`,
        phase: 'error',
        message: 'Viewer disconnected',
      });
      setEncouragementMenuOpen(false);
      return;
    }

    const id = `spectator-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pendingEncouragementIdRef.current = id;
    clearEncouragementAckTimer();
    setEncouragementMenuOpen(false);
    setEncouragementFeedback({
      id,
      phase: 'sending',
      message: 'Sending',
    });
    encouragementAckTimeoutRef.current = window.setTimeout(() => {
      if (pendingEncouragementIdRef.current !== id) return;
      pendingEncouragementIdRef.current = null;
      encouragementAckTimeoutRef.current = null;
      showEncouragementFeedback({
        id,
        phase: 'error',
        message: 'No response',
      });
    }, SPECTATOR_ENCOURAGEMENT_ACK_TIMEOUT_MS);

    try {
      connection.send({
        type: 'SPECTATOR_ENCOURAGEMENT',
        id,
        actorName: SPECTATOR_VIEWER_NAME,
        message: messageText,
      });
    } catch {
      pendingEncouragementIdRef.current = null;
      clearEncouragementAckTimer();
      showEncouragementFeedback({
        id,
        phase: 'error',
        message: 'Could not send',
      });
    }
  };

  useEffect(() => {
    if (!encouragementMenuOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (encouragementMenuRef.current?.contains(event.target as Node)) return;
      setEncouragementMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEncouragementMenuOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [encouragementMenuOpen]);

  useEffect(() => {
    if (!canSendEncouragement) setEncouragementMenuOpen(false);
  }, [canSendEncouragement]);

  const estimate = useMemo(() => (
    remoteState
      ? getTimerShareEstimateFromSpectatorState(remoteState, nowMs)
      : getPreviewEstimate(previewEndMs, previewRemainingSeconds, nowMs)
  ), [nowMs, previewEndMs, previewRemainingSeconds, remoteState]);

  const projectedFinishEndMs = remoteState
    ? getSafeTimestampMs(remoteState.projectedFinishEndMs)
    : (previewEndKind === 'finish' ? getSafeTimestampMs(previewEndMs) : null);
  const headlineEndMs = projectedFinishEndMs;
  const activeCategoryName = remoteState?.activeCategoryName?.trim() || '';
  const activeCategoryColor = remoteState?.activeCategoryColor?.trim() || remoteState?.activeColor || DEFAULT_WORK_SURFACE;
  const workTileLabel = remoteState?.activeTaskName || 'Focus';
  const endLabel = headlineEndMs
    ? formatTimerShareEndLabel(headlineEndMs)
    : (previewEndKind === 'finish' && previewEndLabel ? previewEndLabel : formatTimerShareEndLabel(null));
  const statusLabel = 'Time Finished';
  const hasKnownTimerState = remoteState
    ? (!remoteState.isIdle || estimate.status !== 'idle')
    : estimate.status === 'running';
  const hostLabel = remoteState?.hostName ? `${remoteState.hostName}'s timer` : 'Shared timer';
  const surfaceColor = getMutedSurfaceColor(
    timerValues.activeMode === 'break' ? DEFAULT_BREAK_SURFACE : (remoteState?.activeColor || DEFAULT_WORK_SURFACE),
    timerValues.activeMode === 'break' ? DEFAULT_BREAK_SURFACE : DEFAULT_WORK_SURFACE,
  );

  if (status === 'connecting' && !remoteState) {
    return <SpectatorLoadingScreen surfaceColor={surfaceColor} />;
  }

  return (
    <div
      className="flex min-h-screen w-full flex-col overflow-x-hidden overflow-y-auto px-3 pb-14 pt-4 text-white transition-colors duration-700 md:px-8 md:pb-16 md:pt-8"
      style={{ background: surfaceColor, ['--doro-spectator-surface' as any]: surfaceColor }}
    >
      <style>{`
        @keyframes doroSpectatorWaveRotate {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes doroSpectatorIn {
          0% { opacity: 0; transform: translateY(18px) scale(0.985); filter: blur(8px); }
          100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        @keyframes doroSpectatorMenuIn {
          0% { opacity: 0; transform: translate3d(-50%, 8px, 0) scale(0.96); filter: blur(7px); }
          100% { opacity: 1; transform: translate3d(-50%, 0, 0) scale(1); filter: blur(0); }
        }
        @keyframes doroSpectatorFeedbackIn {
          0% { opacity: 0; transform: translateY(5px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        .doro-spectator-shell {
          animation: doroSpectatorIn 620ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .doro-spectator-host-label {
          animation: doroSpectatorIn 560ms cubic-bezier(0.16, 1, 0.3, 1) 80ms both;
          text-shadow: 0 12px 22px rgba(0, 0, 0, 0.22);
        }
        .doro-spectator-headline-card {
          background:
            radial-gradient(circle at 18% 0%, rgba(255, 255, 255, 0.16), transparent 44%),
            linear-gradient(145deg, rgba(255, 255, 255, 0.145), rgba(255, 255, 255, 0.058)),
            color-mix(in srgb, var(--doro-spectator-surface, rgba(214, 154, 168, 0.92)) 72%, rgba(255, 255, 255, 0.12));
          box-shadow:
            0 34px 72px -44px rgba(0, 0, 0, 0.74),
            inset 0 1px 0 rgba(255, 255, 255, 0.16),
            inset 0 -22px 48px rgba(0, 0, 0, 0.045);
          backdrop-filter: blur(22px) saturate(1.16);
          -webkit-backdrop-filter: blur(22px) saturate(1.16);
        }
        .doro-spectator-wave-slow { animation: doroSpectatorWaveRotate 40s linear infinite; }
        .doro-spectator-wave-med { animation: doroSpectatorWaveRotate 32s linear infinite reverse; }
        .doro-spectator-wave-fast { animation: doroSpectatorWaveRotate 25s linear infinite; }
        .doro-spectator-encouragement-dock {
          animation: doroSpectatorIn 560ms cubic-bezier(0.16, 1, 0.3, 1) 130ms both;
        }
        .doro-spectator-encouragement-button {
          box-shadow: 0 18px 42px -32px rgba(0, 0, 0, 0.86), inset 0 1px 0 rgba(255, 255, 255, 0.08);
        }
        .doro-spectator-encouragement-button:not(:disabled):hover {
          transform: translateY(-1px);
          border-color: rgba(255, 255, 255, 0.24);
          background: rgba(255, 255, 255, 0.105);
        }
        .doro-spectator-encouragement-button:not(:disabled):active {
          transform: translateY(0);
        }
        .doro-spectator-encouragement-menu {
          animation: doroSpectatorMenuIn 180ms cubic-bezier(0.22, 1, 0.36, 1) both;
          background:
            radial-gradient(circle at 18% 0%, rgba(255, 255, 255, 0.18), transparent 42%),
            linear-gradient(145deg, rgba(255, 255, 255, 0.145), rgba(255, 255, 255, 0.06)),
            color-mix(in srgb, var(--doro-spectator-surface, rgba(214, 154, 168, 0.94)) 58%, rgba(12, 12, 14, 0.72));
          box-shadow:
            0 34px 72px -38px rgba(0, 0, 0, 0.86),
            0 18px 34px -24px rgba(0, 0, 0, 0.62),
            inset 0 1px 0 rgba(255, 255, 255, 0.18);
        }
        .doro-spectator-encouragement-menu::after {
          content: "";
          position: absolute;
          left: 50%;
          top: 100%;
          width: 0.88rem;
          height: 0.88rem;
          border-right: 1px solid rgba(255, 255, 255, 0.18);
          border-bottom: 1px solid rgba(255, 255, 255, 0.18);
          background:
            linear-gradient(145deg, rgba(255, 255, 255, 0.13), rgba(255, 255, 255, 0.06)),
            color-mix(in srgb, var(--doro-spectator-surface, rgba(214, 154, 168, 0.94)) 58%, rgba(12, 12, 14, 0.72));
          transform: translate3d(-50%, -50%, 0) rotate(45deg);
        }
        .doro-spectator-encouragement-option:hover,
        .doro-spectator-encouragement-option:focus-visible {
          background: rgba(255, 255, 255, 0.11);
          color: rgba(255, 255, 255, 0.96);
        }
        .doro-spectator-encouragement-feedback {
          animation: doroSpectatorFeedbackIn 190ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .doro-spectator-encouragement-spinner {
          height: 0.82rem;
          width: 0.82rem;
          border-radius: 999px;
          border: 2px solid currentColor;
          border-top-color: transparent;
          animation: doroSpectatorWaveRotate 760ms linear infinite;
        }
        @media (max-width: 767px) {
          .doro-spectator-liquid-shell,
          .doro-spectator-liquid-mask {
            isolation: isolate;
            clip-path: inset(0 round 3rem);
            -webkit-clip-path: inset(0 round 3rem);
            -webkit-mask-image: -webkit-radial-gradient(white, black);
            mask-image: radial-gradient(white, black);
          }
          .doro-spectator-liquid-mask > div {
            transform: translateZ(0);
          }
          .doro-spectator-encouragement-menu {
            width: min(92vw, 25rem);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .doro-spectator-shell,
          .doro-spectator-host-label,
          .doro-spectator-encouragement-dock,
          .doro-spectator-wave-slow,
          .doro-spectator-wave-med,
          .doro-spectator-wave-fast,
          .doro-spectator-encouragement-menu,
          .doro-spectator-encouragement-feedback,
          .doro-spectator-encouragement-spinner {
            animation: none !important;
          }
        }
      `}</style>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-3 md:gap-4">
        <div className="doro-spectator-host-label min-w-0 max-w-full px-3 text-center">
          <div className="truncate text-sm font-semibold text-white/78 md:text-base">
            {hostLabel}
          </div>
        </div>

        <section className="doro-spectator-shell relative w-full overflow-visible rounded-[1.7rem] border border-white/[0.13] bg-white/[0.072] px-4 py-5 shadow-[0_34px_78px_-48px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.065)] backdrop-blur-xl md:px-7 md:py-7">
          <div className="pointer-events-none absolute inset-0 rounded-[inherit] border border-white/[0.08] shadow-[inset_0_-34px_70px_rgba(0,0,0,0.08)]" />

          <div className="doro-spectator-headline-card relative mx-auto w-full max-w-[calc(84vw+0.75rem)] rounded-[1.35rem] border border-white/[0.16] px-4 py-5 text-center sm:max-w-[26rem] md:max-w-[29.5rem] md:rounded-[1.55rem] md:px-8 md:py-6 lg:max-w-[31.5rem]">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/48">
              {statusLabel}
            </div>
            <div className="mx-auto mt-2 max-w-full whitespace-nowrap font-sans text-[2.75rem] font-bold leading-none text-white drop-shadow-2xl sm:text-[4.15rem] md:text-[5.2rem] lg:text-[5.75rem]">
              {endLabel}
            </div>
          </div>

          <div className="relative mx-auto mt-5 flex w-full max-w-[calc(84vw+0.75rem)] flex-row items-center justify-center gap-3 sm:max-w-[26rem] sm:gap-4 md:mt-7 md:max-w-[29.5rem] md:gap-6 lg:max-w-[31.5rem]">
            <SpectatorTimerTile
              type="work"
              time={timerValues.focusTime}
              maxTime={spectatorSettings.workDuration}
              activeMode={timerValues.activeMode}
              label={workTileLabel}
              displayValue={isFocusTimerPreset ? formatTimerSquareTime(spectatorFocusDisplayTime) : undefined}
              hideLiquid={isFocusTimerPreset}
              isLiveish={hasKnownTimerState}
            />
            <SpectatorTimerTile
              type="break"
              time={timerValues.breakTime}
              maxTime={spectatorSettings.longBreakDuration}
              activeMode={timerValues.activeMode}
              displayValue={isFocusTimerPreset ? 'Break' : undefined}
              displayVariant={isFocusTimerPreset ? 'word' : 'time'}
              hideLabel={isFocusTimerPreset}
              hideLiquid={isFocusTimerPreset}
              isLiveish={hasKnownTimerState}
            />
          </div>

          {activeCategoryName && (
            <div className="relative mx-auto mt-4 flex max-w-full items-center justify-center gap-2 rounded-full border border-white/[0.13] bg-white/[0.065] px-3.5 py-2 text-center shadow-[0_18px_38px_-32px_rgba(0,0,0,0.78),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl sm:max-w-[28rem]">
              <span
                className="h-2 w-2 shrink-0 rounded-full shadow-[0_0_14px_rgba(255,255,255,0.18)]"
                style={{ backgroundColor: activeCategoryColor }}
                aria-hidden="true"
              />
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-white/48 sm:text-[11px]">
                Currently Working On:
              </span>
              <span className="min-w-0 truncate text-xs font-bold text-white/88 sm:text-sm">
                {activeCategoryName}
              </span>
            </div>
          )}

          {status !== 'live' && (
            <div className="relative mt-6 rounded-lg border border-white/[0.12] bg-white/[0.045] px-4 py-3 text-center text-xs font-semibold text-white/58 shadow-[0_18px_38px_-32px_rgba(0,0,0,0.72),inset_0_1px_0_rgba(255,255,255,0.05)]">
              {message}
            </div>
          )}
        </section>

        <div className="doro-spectator-encouragement-dock relative z-30 mx-auto flex flex-col items-center gap-2">
          <div ref={encouragementMenuRef} className="relative">
            <button
              type="button"
              onClick={toggleEncouragementMenu}
              disabled={!canSendEncouragement || isEncouragementSending}
              aria-haspopup="menu"
              aria-expanded={encouragementMenuOpen}
              className={`doro-spectator-encouragement-button inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-white/[0.14] bg-white/[0.07] px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/78 outline-none transition-[background-color,border-color,color,transform,opacity] duration-200 focus-visible:ring-2 focus-visible:ring-white/35 ${
                canSendEncouragement && !isEncouragementSending ? '' : 'cursor-not-allowed opacity-45'
              }`}
            >
              <Heart size={16} strokeWidth={2.35} aria-hidden="true" />
              Encourage
            </button>

            {encouragementMenuOpen && (
              <div
                role="menu"
                className="doro-spectator-encouragement-menu absolute bottom-[calc(100%+0.72rem)] left-1/2 z-50 grid w-[24rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 gap-1 rounded-2xl border border-white/[0.18] p-1.5 text-left backdrop-blur-2xl"
              >
                {encouragementOptions.map(prompt => (
                  <button
                    key={`${prompt.kind}-${prompt.message}`}
                    type="button"
                    role="menuitem"
                    onClick={() => sendSpectatorEncouragement(prompt)}
                    className="doro-spectator-encouragement-option rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold leading-snug text-white/76 outline-none transition-[background-color,color] duration-150"
                  >
                    {prompt.message}
                  </button>
                ))}
              </div>
            )}
          </div>

          {encouragementFeedback && (
            <div
              className={`doro-spectator-encouragement-feedback inline-flex min-h-8 max-w-[calc(100vw-2rem)] items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] shadow-[0_16px_32px_-28px_rgba(0,0,0,0.9)] ${
                encouragementFeedback.phase === 'sent'
                  ? 'border-rose-100/24 bg-rose-500/24 text-rose-50'
                  : encouragementFeedback.phase === 'error'
                    ? 'border-red-100/22 bg-red-950/42 text-red-100'
                    : 'border-white/[0.14] bg-white/[0.075] text-white/70'
              }`}
              role="status"
              aria-live="polite"
            >
              {encouragementFeedback.phase === 'sent' ? (
                <Check size={14} strokeWidth={2.45} aria-hidden="true" />
              ) : encouragementFeedback.phase === 'error' ? (
                <X size={14} strokeWidth={2.45} aria-hidden="true" />
              ) : (
                <span className="doro-spectator-encouragement-spinner" aria-hidden="true" />
              )}
              <span className="truncate">{encouragementFeedback.message}</span>
            </div>
          )}
        </div>
      </main>
      <footer className="fixed bottom-3 left-1/2 z-30 -translate-x-1/2 md:bottom-5">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-2.5 py-1.5 text-center shadow-[0_16px_32px_-30px_rgba(0,0,0,0.86),inset_0_1px_0_rgba(255,255,255,0.055)] backdrop-blur-xl">
          <span className="text-[8px] font-bold uppercase tracking-[0.14em] text-white/32">
            Session
          </span>
          <span className="font-mono text-[10px] font-bold uppercase leading-none tracking-[0.16em] text-white/62">
            {normalizedSessionId || 'UNKNOWN'}
          </span>
        </div>
      </footer>
    </div>
  );
};

export default SpectatorTimerPage;
