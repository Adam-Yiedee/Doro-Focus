import React, { useEffect, useMemo, useRef, useState } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { TimerMode, TimerSpectatorState } from '../types';
import { DEFAULT_BREAK_SURFACE, DEFAULT_WORK_SURFACE, getMutedSurfaceColor } from '../utils/palette';
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

const normalizeSessionId = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 64);

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
        isVisible={isActive && showLiquid}
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

      <div className={`z-20 max-w-[82%] truncate text-center text-[10px] font-bold uppercase tracking-[0.18em] transition-all duration-500 md:text-xs ${labelClasses}`}>
        <span className="relative z-10 drop-shadow-md">{label || (isWork ? 'Focus' : 'Break Bank')}</span>
      </div>

      <div className={`z-20 font-sans text-[2.6rem] font-bold leading-none tracking-tighter tabular-nums transition-all duration-500 sm:text-[3.35rem] md:text-[4.45rem] lg:text-[4.9rem] ${textClasses} ${time < 0 ? 'text-red-200 drop-shadow-[0_0_15px_rgba(220,38,38,0.5)]' : ''}`}>
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
  previewEndKind = 'phase',
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
          setMessage('');
          connection.send({ type: 'SPECTATOR_REQUEST' });
        });

        connection.on('data', (data: any) => {
          if (disposed || !data || typeof data !== 'object') return;
          if (data.type === 'SPECTATOR_STATE' && isTimerSpectatorState(data.state)) {
            setRemoteState(data.state);
            setStatus('live');
            setMessage('');
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
  const spectatorSettings = remoteState?.settings || getSpectatorSettingsFallback();
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
        .doro-spectator-shell {
          animation: doroSpectatorIn 620ms cubic-bezier(0.16, 1, 0.3, 1) both;
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
          .doro-spectator-wave-slow,
          .doro-spectator-wave-med,
          .doro-spectator-wave-fast {
            animation: none !important;
          }
        }
      `}</style>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-4">
        <section className="doro-spectator-shell relative w-full overflow-hidden rounded-[1.7rem] border border-white/[0.13] bg-white/[0.072] px-4 py-5 shadow-[0_34px_78px_-48px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.065)] backdrop-blur-xl md:px-7 md:py-7">
          <div className="pointer-events-none absolute inset-0 rounded-[inherit] border border-white/[0.08] shadow-[inset_0_-34px_70px_rgba(0,0,0,0.08)]" />

          <div className="relative flex flex-col items-center gap-3">
            <div className="min-w-0 text-center">
              <div className="truncate text-sm font-semibold text-white/72">
                {hostLabel}
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
          </div>

          <div className="relative mx-auto mt-5 flex w-full max-w-[26rem] flex-row items-center justify-center gap-3 sm:max-w-[28rem] sm:gap-4 md:mt-7 md:max-w-[32rem] md:gap-6 lg:max-w-[34rem]">
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
