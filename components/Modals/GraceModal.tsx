
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTimer } from '../../context/TimerContext';
import { shouldFollowHostTimerSync } from '../../utils/groupStudy';
import { LONG_GRACE_SESSION_TIMEOUT_MS } from '../../utils/timerRuntime';

const LONG_GRACE_RESPONSE_WINDOW_MS = 30 * 1000;

export interface GracePreviewConfig {
  context: 'afterWork' | 'afterBreak';
  graceTotal: number;
  showOptions?: boolean;
  showLongGracePrompt?: boolean;
  statusMessage?: string;
  isFollowingSharedGrace?: boolean;
}

interface GraceModalProps {
  preview?: GracePreviewConfig | null;
  onPreviewClose?: () => void;
}

const formatDuration = (seconds: number) => {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `(${m}:${rem.toString().padStart(2, '0')})`;
};

const formatCountdown = (ms: number) => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const WORK_COMPLETE_MESSAGES = [
  'Good job. Keep going.',
  'Nice focus block. Stay on the roll.',
  'Strong session. Keep the rhythm.',
  'You finished that round cleanly.',
  'Great work pace. Keep moving.',
  'That was sharp focus. Continue.',
  'Another pomodoro down. Nice.',
  'Good momentum. Carry it forward.',
  'Solid effort. One more step.',
  'You are locked in. Keep going.',
  'Great execution. Keep stacking wins.',
  'Focused and done. Next one.',
  'You handled that perfectly.',
  'Clean finish. Keep the streak alive.',
  'Strong discipline. Continue forward.',
  'Excellent progress. Keep it steady.',
  'You are building serious momentum.',
  'Great push. Stay in motion.',
  'Focus level was high. Nice.',
  'Another strong interval complete.',
  'Work block complete. Keep climbing.',
  'You showed up and delivered.',
  'Great consistency. Keep pressing.',
  'That was productive. Continue.',
  'Nice commitment. Keep going.',
  'Strong concentration. Next round.',
  'Progress is compounding. Keep at it.',
  'Well done. Maintain the pace.',
  'Great depth of focus there.',
  'You crushed that session.',
  'Excellent finish. Keep the flow.',
  'Another quality block in the books.',
  'Good control. Stay focused.',
  'You are moving the needle.',
  'Great follow-through. Next up.',
  'Locked in and completed. Nice.',
  'Strong output. Keep it coming.',
  'That block was efficient.',
  'Great focus, no drift. Keep going.',
  'You completed it with intention.',
  'Consistent effort pays off. Continue.',
  'Great job staying on task.',
  'One more done. Keep building.',
  'Nice form. Keep the engine running.',
  'You are doing this right.',
  'Focused work complete. Keep pushing.',
  'That was clean and productive.',
  'Excellent rep. Start the next one.',
  'Steady progress. Keep moving forward.',
  'Great work session complete.',
];

const BREAK_COMPLETE_MESSAGES = [
  'Time to get back at it. Break is over.',
  'Break done. Refocus now.',
  'Rest complete. Back to deep work.',
  'Recovery finished. Let us lock in.',
  'Break ended. Time to move.',
  'Back on track. Focus starts now.',
  'Reset complete. Start the next block.',
  'Break complete. Re-enter focus mode.',
  'Pause is over. Let us go again.',
  'Ready to work. Start strong.',
  'Done resting. Time to execute.',
  'Break has ended. Back to progress.',
  'You are recharged. Get after it.',
  'Rest period finished. Continue.',
  'Back to your plan. Start now.',
  'Break is up. Focus in.',
  'Recovered and ready. Go.',
  'Break complete. Build momentum again.',
  'Time to lock back in.',
  'Break over. Resume your flow.',
];

const shuffleMessages = (messages: string[]) => {
  const next = [...messages];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
};

const GraceModal: React.FC<GraceModalProps> = ({ preview = null, onPreviewClose }) => {
  const {
    graceOpen,
    graceTotal,
    graceContext,
    resolveGrace,
    sessionStartTime,
    endSession,
    groupSessionId,
    isHost,
    hostSyncConfig,
    clientSyncConfig,
  } = useTimer();
  const [showOptions, setShowOptions] = useState(false);
  const [showLongGracePrompt, setShowLongGracePrompt] = useState(false);
  const [isFollowerGraceDismissed, setIsFollowerGraceDismissed] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [sessionKey, setSessionKey] = useState<string | null>(sessionStartTime);
  const [workMessageQueue, setWorkMessageQueue] = useState<string[]>(() => shuffleMessages(WORK_COMPLETE_MESSAGES));
  const [breakMessageQueue, setBreakMessageQueue] = useState<string[]>(() => shuffleMessages(BREAK_COMPLETE_MESSAGES));
  const [graceStartedAtMs, setGraceStartedAtMs] = useState<number | null>(null);
  const [longGraceDeadlineMs, setLongGraceDeadlineMs] = useState<number | null>(null);
  const [longGraceCountdownMs, setLongGraceCountdownMs] = useState(LONG_GRACE_RESPONSE_WINDOW_MS);
  const [hasKeptCurrentGraceOpen, setHasKeptCurrentGraceOpen] = useState(false);
  const wasGraceOpenRef = useRef(false);
  const hasAutoEndedLongGraceRef = useRef(false);
  const isFollowingSharedGrace = shouldFollowHostTimerSync({
    groupSessionId,
    isHost,
    hostSyncConfig,
    clientSyncConfig,
    awaitingInitialHostState: false,
  });
  const canResolveLongGraceLocally = !isFollowingSharedGrace;
  const isPreview = Boolean(preview);
  const effectiveGraceOpen = isPreview || graceOpen;
  const effectiveGraceTotal = preview?.graceTotal ?? graceTotal;
  const effectiveGraceContext = preview?.context ?? graceContext;
  const effectiveShowOptions = preview?.showOptions ?? showOptions;
  const effectiveShowLongGracePrompt = preview?.showLongGracePrompt ?? showLongGracePrompt;
  const effectiveStatusMessage = preview?.statusMessage ?? statusMessage;
  const effectiveIsFollowingSharedGrace = preview?.isFollowingSharedGrace ?? isFollowingSharedGrace;

  const consumeMessage = (isAfterWork: boolean) => {
    if (isAfterWork) {
      setWorkMessageQueue(prev => {
        const queue = prev.length === 0 ? shuffleMessages(WORK_COMPLETE_MESSAGES) : prev;
        const [nextMessage, ...rest] = queue;
        setStatusMessage(nextMessage || WORK_COMPLETE_MESSAGES[0]);
        return rest;
      });
      return;
    }
    setBreakMessageQueue(prev => {
      const queue = prev.length === 0 ? shuffleMessages(BREAK_COMPLETE_MESSAGES) : prev;
      const [nextMessage, ...rest] = queue;
      setStatusMessage(nextMessage || BREAK_COMPLETE_MESSAGES[0]);
      return rest;
    });
  };

  useEffect(() => {
    if (graceOpen) {
      setShowOptions(false);
    }
  }, [graceOpen]);

  useEffect(() => {
    setIsFollowerGraceDismissed(false);
  }, [graceContext, graceOpen, sessionStartTime]);

  useEffect(() => {
    if (graceOpen && !wasGraceOpenRef.current) {
      setGraceStartedAtMs(Date.now() - (Math.max(0, graceTotal) * 1000));
      setHasKeptCurrentGraceOpen(false);
      setShowLongGracePrompt(false);
      setLongGraceDeadlineMs(null);
      setLongGraceCountdownMs(LONG_GRACE_RESPONSE_WINDOW_MS);
      hasAutoEndedLongGraceRef.current = false;
    } else if (!graceOpen && wasGraceOpenRef.current) {
      setGraceStartedAtMs(null);
      setHasKeptCurrentGraceOpen(false);
      setShowLongGracePrompt(false);
      setLongGraceDeadlineMs(null);
      setLongGraceCountdownMs(LONG_GRACE_RESPONSE_WINDOW_MS);
      hasAutoEndedLongGraceRef.current = false;
    }
    wasGraceOpenRef.current = graceOpen;
  }, [graceOpen, graceTotal]);

  useEffect(() => {
    if (sessionStartTime !== sessionKey) {
      setSessionKey(sessionStartTime);
      setWorkMessageQueue(shuffleMessages(WORK_COMPLETE_MESSAGES));
      setBreakMessageQueue(shuffleMessages(BREAK_COMPLETE_MESSAGES));
    }
  }, [sessionStartTime, sessionKey]);

  useEffect(() => {
    if (!graceOpen) return;
    consumeMessage(graceContext === 'afterWork');
  }, [graceOpen, graceContext]);

  // Reveal options after delay
  useEffect(() => {
    if (graceOpen && graceTotal > 30 && !showOptions) {
        setShowOptions(true);
    }
  }, [graceTotal, graceOpen, showOptions]);

  const handleEndLongGraceSession = useCallback(() => {
    if (isPreview) {
      onPreviewClose?.();
      return;
    }
    if (hasAutoEndedLongGraceRef.current) return;
    hasAutoEndedLongGraceRef.current = true;
    setShowLongGracePrompt(false);
    setLongGraceDeadlineMs(null);
    setLongGraceCountdownMs(0);
    endSession({
      effectiveEndMs: graceStartedAtMs ?? (Date.now() - Math.max(0, graceTotal) * 1000),
      showSummary: false,
    });
  }, [endSession, graceStartedAtMs, graceTotal, isPreview, onPreviewClose]);

  useEffect(() => {
    if (!graceOpen || !canResolveLongGraceLocally || hasKeptCurrentGraceOpen || hasAutoEndedLongGraceRef.current) return;
    if ((graceTotal * 1000) < LONG_GRACE_SESSION_TIMEOUT_MS) {
      setShowLongGracePrompt(false);
      setLongGraceDeadlineMs(null);
      setLongGraceCountdownMs(LONG_GRACE_RESPONSE_WINDOW_MS);
      return;
    }

    if (document.visibilityState !== 'visible' || !document.hasFocus()) {
      handleEndLongGraceSession();
      return;
    }

    setShowLongGracePrompt(true);
    setLongGraceDeadlineMs(prev => prev ?? (Date.now() + LONG_GRACE_RESPONSE_WINDOW_MS));
  }, [
    canResolveLongGraceLocally,
    graceOpen,
    graceTotal,
    handleEndLongGraceSession,
    hasKeptCurrentGraceOpen,
  ]);

  useEffect(() => {
    if (!graceOpen || hasKeptCurrentGraceOpen || hasAutoEndedLongGraceRef.current) return;

    const handleVisibilityChange = () => {
      if ((graceTotal * 1000) >= LONG_GRACE_SESSION_TIMEOUT_MS && (document.visibilityState !== 'visible' || !document.hasFocus())) {
        handleEndLongGraceSession();
      }
    };

    window.addEventListener('blur', handleVisibilityChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('blur', handleVisibilityChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [graceOpen, graceTotal, handleEndLongGraceSession, hasKeptCurrentGraceOpen]);

  useEffect(() => {
    if (!showLongGracePrompt || longGraceDeadlineMs === null || hasKeptCurrentGraceOpen || hasAutoEndedLongGraceRef.current) return;

    const syncCountdown = () => {
      const remainingMs = Math.max(0, longGraceDeadlineMs - Date.now());
      setLongGraceCountdownMs(remainingMs);
      if (remainingMs <= 0) {
        handleEndLongGraceSession();
      }
    };

    syncCountdown();
    const intervalId = window.setInterval(syncCountdown, 1000);
    return () => window.clearInterval(intervalId);
  }, [handleEndLongGraceSession, hasKeptCurrentGraceOpen, longGraceDeadlineMs, showLongGracePrompt]);

  if (!effectiveGraceOpen || (effectiveGraceContext !== 'afterWork' && effectiveGraceContext !== 'afterBreak')) return null;
  if (!isPreview && effectiveIsFollowingSharedGrace && isFollowerGraceDismissed) return null;

  const isAfterWork = effectiveGraceContext === 'afterWork';
  const closePreview = () => onPreviewClose?.();
  
  const handleWasWorking = () => {
    if (isPreview) {
      closePreview();
      return;
    }
    const nextMode = isAfterWork ? 'break' : 'work';
    resolveGrace(nextMode, { adjustBreakBalance: -(effectiveGraceTotal / 5), logGraceAs: 'work' });
  };

  const handleContinueWorking = () => {
    if (isPreview) {
      closePreview();
      return;
    }
    resolveGrace('work', isAfterWork ? { logGraceAs: 'work' } : undefined);
  };

  const handleWasResting = () => {
    if (isPreview) {
      closePreview();
      return;
    }
    const nextMode = isAfterWork ? 'break' : 'work';
    resolveGrace(nextMode, { adjustBreakBalance: effectiveGraceTotal, logGraceAs: 'break' });
  };
  
  const handleNeutral = () => {
      if (isPreview) {
        closePreview();
        return;
      }
      const nextMode = isAfterWork ? 'break' : 'work';
      resolveGrace(nextMode, { logGraceAs: 'grace' });
  };

  const handleDismissFollowerGrace = () => {
    setIsFollowerGraceDismissed(true);
  };

  const handleKeepCurrentGraceOpen = () => {
    setHasKeptCurrentGraceOpen(true);
    setShowLongGracePrompt(false);
    setLongGraceDeadlineMs(null);
    setLongGraceCountdownMs(LONG_GRACE_RESPONSE_WINDOW_MS);
  };

  const addToBankAmount = effectiveGraceTotal / 5;
  const deductFromBankAmount = effectiveGraceTotal;
  const graceHeaderTitleClassName = 'text-[2.65rem] leading-none md:text-[3.4rem] font-semibold tracking-tight text-white/95 drop-shadow-[0_18px_32px_rgba(0,0,0,0.35)]';
  const graceHeaderMessageClassName = 'mx-auto max-w-2xl text-base md:text-[1.15rem] leading-snug tracking-[-0.01em] text-white/60 font-medium';

  const buttonClass = `
    group relative w-32 h-32 md:w-40 md:h-40 rounded-[1.5rem] overflow-hidden
    bg-white/5 backdrop-blur-2xl border border-white/10
    flex flex-col items-center justify-center gap-2
    transition-all duration-500 cubic-bezier(0.25, 0.8, 0.25, 1)
    hover:scale-105 hover:bg-white/10 hover:shadow-2xl
    hover:border-white/30 active:scale-95 cursor-pointer
  `;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-3xl flex flex-col items-center gap-10 animate-slide-up">
        
        {/* Header Area */}
        <div className="text-center space-y-2">
           <h2 className={graceHeaderTitleClassName}>
             {isAfterWork ? "Session Complete" : "Break Complete"}
           </h2>
           <p className={graceHeaderMessageClassName}>
              {effectiveStatusMessage}
           </p>
        </div>

        {effectiveIsFollowingSharedGrace ? (
          <div className="w-full max-w-xl rounded-[1.8rem] border border-white/10 bg-white/8 backdrop-blur-2xl px-6 py-5 text-center shadow-[0_24px_60px_-36px_rgba(15,23,42,0.85)]">
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
              Host Controlled Grace
            </div>
            <div className="mt-2 text-lg md:text-xl font-bold tracking-tight text-white">
              Waiting for the host to choose the next timer state.
            </div>
            <div className="mt-2 text-sm leading-relaxed text-white/58">
              Your timer is synced to the host in this group session, so the host resolves grace for everyone.
            </div>
            <button
              type="button"
              onClick={handleDismissFollowerGrace}
              className="mt-5 rounded-full border border-white/12 bg-white/8 px-5 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/72 transition-colors hover:bg-white/12 hover:text-white"
            >
              Dismiss For Now
            </button>
          </div>
        ) : (
          <>
            {/* Buttons */}
            <div className="flex flex-row items-center justify-center gap-4">
              
              {/* Button: Work */}
              <button 
              onClick={effectiveShowOptions ? handleWasWorking : handleContinueWorking}
                className={`${buttonClass} shadow-[0_0_40px_-10px_rgba(248,113,113,0.2)] hover:shadow-[0_0_50px_-5px_rgba(248,113,113,0.4)]`}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                
                <div className="relative z-10 flex flex-col items-center text-center px-2">
                    <span className="text-white font-bold text-xs md:text-sm tracking-widest uppercase">
                       {effectiveShowOptions ? "I WAS WORKING" : (isAfterWork ? "CONTINUE WORKING" : "START FOCUS")}
                    </span>
                    
                    {effectiveShowOptions ? (
                      <span className="text-[10px] font-mono font-medium text-red-200/80 mt-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        Add {formatDuration(addToBankAmount)}
                      </span>
                    ) : (
                      <div className="w-8 h-0.5 bg-white/20 rounded-full mt-2 group-hover:w-12 group-hover:bg-red-400 transition-all" />
                    )}
                </div>
              </button>

              {/* Button: Rest */}
              <button 
                onClick={effectiveShowOptions ? handleWasResting : () => (isPreview ? closePreview() : resolveGrace('break'))}
                className={`${buttonClass} shadow-[0_0_40px_-10px_rgba(45,212,191,0.2)] hover:shadow-[0_0_50px_-5px_rgba(45,212,191,0.4)]`}
              >
                 <div className="absolute inset-0 bg-gradient-to-br from-teal-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                <div className="relative z-10 flex flex-col items-center text-center px-2">
                    <span className="text-white font-bold text-xs md:text-sm tracking-widest uppercase">
                       {effectiveShowOptions ? "I WAS RESTING" : (isAfterWork ? "START BREAK" : "CONTINUE RESTING")}
                    </span>

                    {effectiveShowOptions ? (
                      <span className="text-[10px] font-mono font-medium text-teal-200/80 mt-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        Use {formatDuration(deductFromBankAmount)}
                      </span>
                    ) : (
                      <div className="w-8 h-0.5 bg-white/20 rounded-full mt-2 group-hover:w-12 group-hover:bg-teal-400 transition-all" />
                    )}
                </div>
              </button>
            </div>

            {/* Neutral Option */}
            {effectiveShowOptions && (
                <button 
                    onClick={handleNeutral}
                    className="text-[10px] font-bold uppercase tracking-widest text-white/30 hover:text-white transition-colors"
                >
                    Start {isAfterWork ? 'Break' : 'Focus'} (No Adjustment)
                </button>
            )}
          </>
        )}

        {effectiveShowLongGracePrompt && (
          <div className="w-full max-w-xl rounded-[1.6rem] border border-amber-300/20 bg-white/8 backdrop-blur-2xl px-5 py-4 text-center shadow-[0_24px_60px_-36px_rgba(15,23,42,0.85)]">
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-100/70">
              Long Grace Detected
            </div>
            <div className="mt-2 text-lg md:text-xl font-bold tracking-tight text-white">
              This grace period has been open for over 3 hours.
            </div>
            <div className="mt-2 text-sm leading-relaxed text-white/60">
              Unless you keep it open, Doro will end this session from when grace started. Auto-ending in {formatCountdown(longGraceCountdownMs)}.
            </div>
            <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onClick={handleKeepCurrentGraceOpen}
                className="w-full sm:w-auto rounded-full border border-white/15 bg-white px-5 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-black transition-all hover:bg-white/90 active:scale-[0.98]"
              >
                Keep Session Open
              </button>
              <button
                type="button"
                onClick={handleEndLongGraceSession}
                className="w-full sm:w-auto rounded-full border border-white/12 bg-white/8 px-5 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/72 transition-colors hover:bg-white/12 hover:text-white"
              >
                End Session Now
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default GraceModal;
