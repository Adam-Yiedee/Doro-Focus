import React, { useEffect, useMemo, useRef, useState } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { TimerMode, TimerSpectatorState } from '../types';
import { DEFAULT_BREAK_SURFACE, DEFAULT_WORK_SURFACE, getMutedSurfaceColor } from '../utils/palette';
import {
  formatTimerShareDuration,
  formatTimerShareEndLabel,
  getSpectatorSettingsFallback,
  getTimerShareEstimateFromSpectatorState,
  getTimerShareModeLabel,
  getTimerShareStatusLabel,
} from '../utils/timerShare';
import { deriveRuntimeValues } from '../utils/timerRuntime';

interface SpectatorTimerPageProps {
  sessionId: string;
  previewEndMs?: number | null;
  previewEndLabel?: string | null;
  previewMode?: TimerMode;
  previewRemainingSeconds?: number | null;
}

type ConnectionStatus = 'connecting' | 'live' | 'disconnected' | 'error';

const normalizeSessionId = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 64);

const isTimerSpectatorState = (value: unknown): value is TimerSpectatorState => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TimerSpectatorState>;
  return candidate.version === 1
    && (candidate.activeMode === 'work' || candidate.activeMode === 'break')
    && typeof candidate.workTime === 'number'
    && typeof candidate.breakTime === 'number';
};

const formatTimerSquareTime = (seconds: number) => {
  const absSeconds = Math.abs(seconds);
  const minutes = Math.floor(absSeconds / 60);
  const secs = Math.floor(absSeconds % 60);
  const sign = seconds < 0 ? '-' : '';
  return `${sign}${minutes}:${secs.toString().padStart(2, '0')}`;
};

const clampPercent = (value: number, max: number = 1) => Math.max(0, Math.min(max, value));

interface SpectatorTimerTileProps {
  type: TimerMode;
  time: number;
  maxTime: number;
  activeMode: TimerMode;
  label?: string;
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
    <div className={`doro-spectator-liquid-mask absolute inset-0 z-0 overflow-hidden rounded-[3rem] transition-opacity duration-1000 pointer-events-none ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
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
        doro-spectator-liquid-shell relative flex w-full aspect-square max-w-[18.5rem] shrink-0 transform-gpu flex-col items-center justify-center gap-2 overflow-hidden rounded-[3rem] border
        transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]
        sm:max-w-[20rem] md:max-w-[20rem] lg:max-w-[23rem]
        ${containerClasses}
      `}
    >
      <SpectatorLiquidWave
        percent={fillPercent}
        isVisible={isActive && showLiquid}
        isActive={isActive}
        colorMode={liquidColor}
      />

      {isActive && (
        <>
          <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-tr from-white/10 via-white/0 to-transparent" />
          <div className="pointer-events-none absolute -left-1/2 -top-1/2 z-10 h-[200%] w-[200%] rounded-full bg-gradient-to-b from-white/10 to-transparent blur-[80px] mix-blend-overlay" />
          <div className="pointer-events-none absolute inset-0 z-20 rounded-[3rem] shadow-[inset_0_0_60px_rgba(255,255,255,0.1)]" />
        </>
      )}

      <div className={`z-20 max-w-[80%] truncate text-center text-xs font-bold uppercase tracking-[0.2em] transition-all duration-500 md:text-sm ${labelClasses}`}>
        <span className="relative z-10 drop-shadow-md">{label || (isWork ? 'Focus' : 'Break Bank')}</span>
      </div>

      <div className={`z-20 font-sans text-[4.15rem] font-bold leading-none tracking-tighter tabular-nums transition-all duration-500 sm:text-[4.75rem] md:text-8xl lg:text-9xl ${textClasses} ${time < 0 ? 'text-red-200 drop-shadow-[0_0_15px_rgba(220,38,38,0.5)]' : ''}`}>
        <span className="drop-shadow-lg filter">{formatTimerSquareTime(time)}</span>
      </div>
    </div>
  );
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

const SpectatorTimerPage: React.FC<SpectatorTimerPageProps> = ({
  sessionId,
  previewEndMs = null,
  previewEndLabel = null,
  previewMode = 'work',
  previewRemainingSeconds = null,
}) => {
  const normalizedSessionId = useMemo(() => normalizeSessionId(sessionId), [sessionId]);
  const [status, setStatus] = useState<ConnectionStatus>(normalizedSessionId ? 'connecting' : 'error');
  const [remoteState, setRemoteState] = useState<TimerSpectatorState | null>(null);
  const [message, setMessage] = useState(normalizedSessionId ? 'Connecting to live timer...' : 'Missing timer link.');
  const [nowMs, setNowMs] = useState(Date.now());
  const connectionRef = useRef<DataConnection | null>(null);

  useEffect(() => {
    const tick = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);

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
          setMessage('Live timer connected.');
          connection.send({ type: 'SPECTATOR_REQUEST' });
        });

        connection.on('data', (data: any) => {
          if (disposed || !data || typeof data !== 'object') return;
          if (data.type === 'SPECTATOR_STATE' && isTimerSpectatorState(data.state)) {
            setRemoteState(data.state);
            setStatus('live');
            setMessage('Live timer connected.');
          }
        });

        connection.on('close', () => {
          if (disposed) return;
          setStatus('disconnected');
          setMessage('The live timer is not broadcasting right now.');
        });

        connection.on('error', () => {
          if (disposed) return;
          setStatus('error');
          setMessage('Unable to connect to this live timer.');
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
      try { peer?.destroy(); } catch {}
    };
  }, [normalizedSessionId]);

  const timerValues = useMemo(() => {
    if (!remoteState) {
      return {
        activeMode: previewMode,
        focusTime: previewMode === 'work' && previewRemainingSeconds ? previewRemainingSeconds : 0,
        breakTime: previewMode === 'break' && previewRemainingSeconds ? previewRemainingSeconds : 0,
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
    };
  }, [nowMs, previewMode, previewRemainingSeconds, remoteState]);

  const estimate = useMemo(() => (
    remoteState
      ? getTimerShareEstimateFromSpectatorState(remoteState, nowMs)
      : getPreviewEstimate(previewEndMs, previewRemainingSeconds, nowMs)
  ), [nowMs, previewEndMs, previewRemainingSeconds, remoteState]);

  const modeLabel = getTimerShareModeLabel(timerValues.activeMode);
  const workTileLabel = remoteState?.activeTaskName || 'Focus';
  const endLabel = estimate.endMs
    ? formatTimerShareEndLabel(estimate.endMs)
    : (previewEndLabel || formatTimerShareEndLabel(null));
  const statusLabel = remoteState ? getTimerShareStatusLabel(estimate, timerValues.activeMode) : 'Estimated end';
  const remainingLabel = estimate.status === 'overdue'
    ? `${formatTimerShareDuration(estimate.remainingSeconds)} overdue`
    : formatTimerShareDuration(estimate.remainingSeconds);
  const isLive = status === 'live' && Boolean(remoteState);
  const spectatorSettings = remoteState?.settings || getSpectatorSettingsFallback();
  const hasKnownTimerState = remoteState
    ? (!remoteState.isIdle || estimate.status !== 'idle')
    : estimate.status === 'running';
  const hostLabel = remoteState?.hostName ? `${remoteState.hostName}'s timer` : 'Shared timer';
  const surfaceColor = getMutedSurfaceColor(
    timerValues.activeMode === 'break' ? DEFAULT_BREAK_SURFACE : (remoteState?.activeColor || DEFAULT_WORK_SURFACE),
    timerValues.activeMode === 'break' ? DEFAULT_BREAK_SURFACE : DEFAULT_WORK_SURFACE,
  );

  return (
    <div
      className="min-h-screen w-full overflow-x-hidden overflow-y-auto px-3 py-4 text-white transition-colors duration-700 md:px-8 md:py-8"
      style={{ background: surfaceColor }}
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
        @keyframes doroSpectatorPulse {
          0%, 100% { opacity: 0.56; transform: scale(0.86); }
          50% { opacity: 1; transform: scale(1); }
        }
        .doro-spectator-shell {
          animation: doroSpectatorIn 620ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .doro-spectator-dot {
          animation: doroSpectatorPulse 1.8s ease-in-out infinite;
        }
        .doro-spectator-wave-slow { animation: doroSpectatorWaveRotate 40s linear infinite; }
        .doro-spectator-wave-med { animation: doroSpectatorWaveRotate 32s linear infinite reverse; }
        .doro-spectator-wave-fast { animation: doroSpectatorWaveRotate 25s linear infinite; }
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
        }
        @media (prefers-reduced-motion: reduce) {
          .doro-spectator-shell,
          .doro-spectator-dot,
          .doro-spectator-wave-slow,
          .doro-spectator-wave-med,
          .doro-spectator-wave-fast {
            animation: none !important;
          }
        }
      `}</style>

      <main className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col items-center justify-center gap-4 md:min-h-[calc(100vh-4rem)]">
        <section className="doro-spectator-shell relative w-full overflow-hidden rounded-[1.7rem] border border-white/[0.13] bg-white/[0.072] px-4 py-5 shadow-[0_34px_78px_-48px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.065)] backdrop-blur-xl md:px-7 md:py-7">
          <div className="pointer-events-none absolute inset-0 rounded-[inherit] border border-white/[0.08] shadow-[inset_0_-34px_70px_rgba(0,0,0,0.08)]" />

          <div className="relative flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 text-center md:text-left">
              <div className="inline-flex items-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.07] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/68 shadow-[0_18px_36px_-32px_rgba(0,0,0,0.78),inset_0_1px_0_rgba(255,255,255,0.06)]">
                <span className={`h-1.5 w-1.5 rounded-full ${isLive ? 'doro-spectator-dot bg-emerald-200' : 'bg-white/42'}`} />
                {isLive ? 'Live Timer' : status === 'connecting' ? 'Connecting' : 'Shared Timer'}
              </div>
              <div className="mt-2 truncate text-sm font-semibold text-white/72">
                {hostLabel}
              </div>
            </div>
            <div className="mx-auto rounded-lg border border-white/[0.12] bg-white/[0.055] px-3.5 py-2 text-center shadow-[0_18px_36px_-32px_rgba(0,0,0,0.78),inset_0_1px_0_rgba(255,255,255,0.055)] md:mx-0 md:text-right">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/38">
                Session
              </div>
              <div className="mt-1 font-mono text-xs font-bold tracking-[0.18em] text-white/72">
                {normalizedSessionId || 'UNKNOWN'}
              </div>
            </div>
          </div>

          <div className="relative mt-7 text-center md:mt-8">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/48">
              {statusLabel}
            </div>
            <div className="mx-auto mt-2 max-w-full break-words font-sans text-[3.5rem] font-bold leading-none tracking-tighter text-white drop-shadow-2xl sm:text-[5.25rem] md:text-[6.8rem] lg:text-[7.5rem]">
              {endLabel}
            </div>
            <div className="mt-3 text-[10px] font-bold uppercase tracking-[0.16em] text-white/46">
              {modeLabel} - {remainingLabel} remaining
            </div>
          </div>

          <div className="relative mt-6 flex w-full flex-col items-center justify-center gap-6 md:mt-8 md:flex-row md:gap-10 lg:gap-20">
            <SpectatorTimerTile
              type="work"
              time={timerValues.focusTime}
              maxTime={spectatorSettings.workDuration}
              activeMode={timerValues.activeMode}
              label={workTileLabel}
              isLiveish={hasKnownTimerState}
            />
            <SpectatorTimerTile
              type="break"
              time={timerValues.breakTime}
              maxTime={spectatorSettings.longBreakDuration}
              activeMode={timerValues.activeMode}
              isLiveish={hasKnownTimerState}
            />
          </div>

          <div className="relative mt-6 rounded-lg border border-white/[0.12] bg-white/[0.045] px-4 py-3 text-center text-xs font-semibold text-white/58 shadow-[0_18px_38px_-32px_rgba(0,0,0,0.72),inset_0_1px_0_rgba(255,255,255,0.05)]">
            {message}
          </div>
        </section>
      </main>
    </div>
  );
};

export default SpectatorTimerPage;
