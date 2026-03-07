
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTimer } from '../../context/TimerContext';

const GRACE_INACTIVITY_PROMPT_MS = 60 * 60 * 1000;

const formatDuration = (seconds: number) => {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `(${m}:${rem.toString().padStart(2, '0')})`;
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

const GraceModal: React.FC = () => {
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
  const [showInactivityPrompt, setShowInactivityPrompt] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [sessionKey, setSessionKey] = useState<string | null>(sessionStartTime);
  const [workMessageQueue, setWorkMessageQueue] = useState<string[]>(() => shuffleMessages(WORK_COMPLETE_MESSAGES));
  const [breakMessageQueue, setBreakMessageQueue] = useState<string[]>(() => shuffleMessages(BREAK_COMPLETE_MESSAGES));
  const lastInteractionAtRef = useRef<number>(Date.now());
  const canOfferNewSessionPrompt = !groupSessionId || isHost || !clientSyncConfig.syncTimers || !hostSyncConfig.syncTimers;

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
    if (graceOpen && graceContext === 'afterWork') {
      lastInteractionAtRef.current = Date.now();
      setShowInactivityPrompt(false);
      return;
    }
    setShowInactivityPrompt(false);
  }, [graceContext, graceOpen, sessionStartTime]);

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

  const evaluateInactivityPrompt = useCallback(() => {
    if (!graceOpen || graceContext !== 'afterWork' || !canOfferNewSessionPrompt) return;
    if (Date.now() - lastInteractionAtRef.current >= GRACE_INACTIVITY_PROMPT_MS) {
      setShowInactivityPrompt(true);
    }
  }, [canOfferNewSessionPrompt, graceContext, graceOpen]);

  useEffect(() => {
    if (!graceOpen || graceContext !== 'afterWork' || !canOfferNewSessionPrompt) return;

    const markInteraction = () => {
      lastInteractionAtRef.current = Date.now();
    };
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        evaluateInactivityPrompt();
      }
    };

    const intervalId = window.setInterval(evaluateInactivityPrompt, 30_000);
    window.addEventListener('pointerdown', markInteraction, { passive: true });
    window.addEventListener('keydown', markInteraction);
    window.addEventListener('wheel', markInteraction, { passive: true });
    window.addEventListener('touchstart', markInteraction, { passive: true });
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('pointerdown', markInteraction);
      window.removeEventListener('keydown', markInteraction);
      window.removeEventListener('wheel', markInteraction);
      window.removeEventListener('touchstart', markInteraction);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [canOfferNewSessionPrompt, evaluateInactivityPrompt, graceContext, graceOpen]);

  if (!graceOpen || (graceContext !== 'afterWork' && graceContext !== 'afterBreak')) return null;

  const isAfterWork = graceContext === 'afterWork';
  
  const handleWasWorking = () => {
    const nextMode = isAfterWork ? 'break' : 'work';
    resolveGrace(nextMode, { adjustBreakBalance: -(graceTotal / 5), logGraceAs: 'work' });
  };

  const handleWasResting = () => {
    const nextMode = isAfterWork ? 'break' : 'work';
    resolveGrace(nextMode, { adjustBreakBalance: graceTotal, logGraceAs: 'break' });
  };
  
  const handleNeutral = () => {
      const nextMode = isAfterWork ? 'break' : 'work';
      resolveGrace(nextMode, { logGraceAs: 'grace' });
  };

  const handleDismissInactivityPrompt = () => {
    lastInteractionAtRef.current = Date.now();
    setShowInactivityPrompt(false);
  };

  const handleStartNewSession = () => {
    setShowInactivityPrompt(false);
    endSession();
  };

  const addToBankAmount = graceTotal / 5;
  const deductFromBankAmount = graceTotal;

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
           <h2 className="text-3xl font-bold text-white/90 tracking-tight drop-shadow-lg">
             {isAfterWork ? "Session Complete" : "Break Complete"}
           </h2>
           <p className="text-[11px] tracking-[0.06em] text-white/50 font-semibold">
              {statusMessage}
           </p>
        </div>

        {/* Buttons */}
        <div className="flex flex-row items-center justify-center gap-4">
          
          {/* Button: Work */}
          <button 
            onClick={showOptions ? handleWasWorking : () => resolveGrace('work')} 
            className={`${buttonClass} shadow-[0_0_40px_-10px_rgba(248,113,113,0.2)] hover:shadow-[0_0_50px_-5px_rgba(248,113,113,0.4)]`}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            
            <div className="relative z-10 flex flex-col items-center text-center px-2">
                <span className="text-white font-bold text-xs md:text-sm tracking-widest uppercase">
                   {showOptions ? "I WAS WORKING" : (isAfterWork ? "CONTINUE WORKING" : "START FOCUS")}
                </span>
                
                {showOptions ? (
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
            onClick={showOptions ? handleWasResting : () => resolveGrace('break')} 
            className={`${buttonClass} shadow-[0_0_40px_-10px_rgba(45,212,191,0.2)] hover:shadow-[0_0_50px_-5px_rgba(45,212,191,0.4)]`}
          >
             <div className="absolute inset-0 bg-gradient-to-br from-teal-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

            <div className="relative z-10 flex flex-col items-center text-center px-2">
                <span className="text-white font-bold text-xs md:text-sm tracking-widest uppercase">
                   {showOptions ? "I WAS RESTING" : (isAfterWork ? "START BREAK" : "CONTINUE RESTING")}
                </span>

                {showOptions ? (
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
        {showOptions && (
            <button 
                onClick={handleNeutral}
                className="text-[10px] font-bold uppercase tracking-widest text-white/30 hover:text-white transition-colors"
            >
                Start {isAfterWork ? 'Break' : 'Focus'} (No Adjustment)
            </button>
        )}

        {showInactivityPrompt && (
          <div className="w-full max-w-xl rounded-[1.6rem] border border-amber-300/20 bg-white/8 backdrop-blur-2xl px-5 py-4 text-center shadow-[0_24px_60px_-36px_rgba(15,23,42,0.85)]">
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-100/70">
              Inactive Grace Menu
            </div>
            <div className="mt-2 text-lg md:text-xl font-bold tracking-tight text-white">
              Hey, it&apos;s been a while. Start New Session?
            </div>
            <div className="mt-2 text-sm leading-relaxed text-white/60">
              This will wrap up the current session and return you to a fresh timer without changing any grace calculations unless you choose it.
            </div>
            <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onClick={handleStartNewSession}
                className="w-full sm:w-auto rounded-full border border-white/15 bg-white px-5 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-black transition-all hover:bg-white/90 active:scale-[0.98]"
              >
                Start New Session
              </button>
              <button
                type="button"
                onClick={handleDismissInactivityPrompt}
                className="w-full sm:w-auto rounded-full border border-white/12 bg-white/8 px-5 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/72 transition-colors hover:bg-white/12 hover:text-white"
              >
                Keep Current Session
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default GraceModal;
