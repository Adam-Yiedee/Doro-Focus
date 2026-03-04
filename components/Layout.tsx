

import React, { useState, useEffect, useRef } from 'react';
import { useTimer } from '../context/TimerContext';
import TimerDisplay from './TimerDisplay';
import Tasks from './Tasks';
import AllPauseModal, { ResumeModal } from './Modals/AllPauseModal';
import LogModal from './Modals/LogModal';
import GraceModal from './Modals/GraceModal';
import TaskViewModal from './Modals/TaskViewModal';
import WeeklySchedulePanel from './Modals/WeeklySchedulePanel';
import SummaryView from './SummaryView';
import { GroupNotice } from '../types';

type GroupBannerItem = GroupNotice & { exiting: boolean };

const Layout: React.FC = () => {
  const { activeMode, activeColor, settings, pendingJoinId, isScheduleOpen, setScheduleOpen, isWeeklyScheduleOpen, setWeeklyScheduleOpen, groupNotice } = useTimer();
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [groupBanners, setGroupBanners] = useState<GroupBannerItem[]>([]);
  const bannerTimersRef = useRef<Record<string, { exit: ReturnType<typeof setTimeout>, remove: ReturnType<typeof setTimeout> }>>({});

  useEffect(() => {
    if (pendingJoinId) {
        setShowLogModal(true);
    }
  }, [pendingJoinId]);

  useEffect(() => {
    if (!groupNotice) return;
    const id = groupNotice.id;
    const existingTimers = bannerTimersRef.current[id];
    if (existingTimers) {
      clearTimeout(existingTimers.exit);
      clearTimeout(existingTimers.remove);
      delete bannerTimersRef.current[id];
    }
    setGroupBanners(prev => [...prev.filter(item => item.id !== id), { ...groupNotice, exiting: false }].slice(-3));

    const exitTimer = setTimeout(() => {
      setGroupBanners(prev => prev.map(item => item.id === id ? { ...item, exiting: true } : item));
    }, 2600);

    const removeTimer = setTimeout(() => {
      setGroupBanners(prev => prev.filter(item => item.id !== id));
      const activeTimers = bannerTimersRef.current[id];
      if (activeTimers) {
        clearTimeout(activeTimers.exit);
        clearTimeout(activeTimers.remove);
        delete bannerTimersRef.current[id];
      }
    }, 3200);

    bannerTimersRef.current[id] = { exit: exitTimer, remove: removeTimer };
  }, [groupNotice]);

  useEffect(() => {
    return () => {
      Object.values(bannerTimersRef.current).forEach(timerPair => {
        clearTimeout(timerPair.exit);
        clearTimeout(timerPair.remove);
      });
      bannerTimersRef.current = {};
    };
  }, []);

  // Use Inherited activeColor from context, or default
  const containerStyle: React.CSSProperties = {
    backgroundColor: activeMode === 'break' 
      ? '#9ECFC8' 
      : (activeColor || '#E8A6A6')
  };
  const contentStyle: React.CSSProperties = {
    transform: isWeeklyScheduleOpen
      ? 'translateX(calc(-1 * min(18vw, 260px))) scale(0.99)'
      : 'translateX(0) scale(1)',
  };

  const backdropClass = settings.disableBlur ? 'bg-black/40' : 'backdrop-blur-md bg-white/5';

  return (
    <div 
      className="min-h-screen w-full flex flex-col items-center p-4 relative overflow-x-hidden transition-colors duration-1000 ease-[cubic-bezier(0.25,1,0.5,1)]"
      style={containerStyle}
    >
      <style>{`
        @keyframes doroGroupBannerIn {
          0% { opacity: 0; transform: translateY(-14px) scale(0.98); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes doroGroupBannerProgress {
          0% { transform: scaleX(1); }
          100% { transform: scaleX(0); }
        }
        .doro-group-banner {
          animation: doroGroupBannerIn 360ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .doro-group-banner-progress {
          transform-origin: left;
          animation: doroGroupBannerProgress 3.2s linear forwards;
        }
      `}</style>

      {/* Ambient Background Elements (Conditional) */}
      {!settings.disableBlur && (
        <>
            <div className="fixed top-[-20%] left-[-10%] w-[80vw] h-[80vw] bg-white opacity-[0.03] rounded-full blur-[120px] pointer-events-none" />
            <div className="fixed bottom-[-20%] right-[-10%] w-[80vw] h-[80vw] bg-black opacity-[0.05] rounded-full blur-[150px] pointer-events-none" />
        </>
      )}

      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[72] w-[min(92vw,34rem)] pointer-events-none flex flex-col gap-2">
        {groupBanners.map((notice, i) => (
          <div
            key={notice.id}
            className={`doro-group-banner relative overflow-hidden rounded-2xl border px-4 py-3 shadow-[0_20px_45px_-28px_rgba(15,23,42,0.9)] transition-all duration-500 ${
              notice.kind === 'join'
                ? 'border-emerald-200/40 bg-emerald-300/12'
                : 'border-white/25 bg-white/10'
            } ${settings.disableBlur ? '' : 'backdrop-blur-2xl'} ${
              notice.exiting ? 'opacity-0 -translate-y-2 scale-[0.985]' : 'opacity-100 translate-y-0 scale-100'
            }`}
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <div className="absolute inset-0 opacity-60 bg-[radial-gradient(circle_at_12%_-12%,rgba(255,255,255,0.34),transparent_50%)]" />
            <div className="relative flex items-start gap-3">
              <div className={`mt-1 w-2.5 h-2.5 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.55)] ${
                notice.kind === 'join' ? 'bg-emerald-200' : 'bg-white/90'
              }`} />
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-white/55">
                  {notice.kind === 'join' ? 'Member Joined' : 'Group Action'}
                </div>
                <div className="text-sm text-white/95 leading-snug">
                  <span className="font-bold">{notice.actorName}</span>{' '}{notice.message}
                </div>
              </div>
            </div>
            <div className={`doro-group-banner-progress absolute bottom-0 left-0 h-[2px] w-full ${
              notice.kind === 'join' ? 'bg-emerald-100/55' : 'bg-white/45'
            }`} />
          </div>
        ))}
      </div>

      <div
        className={`w-full flex flex-col items-center transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${isWeeklyScheduleOpen ? 'pointer-events-none' : ''}`}
        style={contentStyle}
      >
        {/* Top Bar */}
        <div className="w-full max-w-4xl flex justify-end items-center z-30 mb-4">
          <div className="flex gap-2">
            <button 
              onClick={() => setShowPauseModal(true)}
              className={`p-2.5 rounded-xl text-white transition-all active:scale-95 shadow-sm hover:shadow-md border border-white/5 duration-500 ${backdropClass} opacity-50 hover:opacity-100`}
              title="Pause All"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-white/90"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            </button>
            <button 
              onClick={() => setShowLogModal(true)}
              className={`p-2.5 rounded-xl text-white transition-all active:scale-95 shadow-sm hover:shadow-md border border-white/5 duration-500 ${backdropClass} opacity-50 hover:opacity-100`}
              title="Menu"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="w-full max-w-5xl z-10 flex flex-col gap-12">
          
          {/* Timer Section */}
          <div className="w-full flex justify-center animate-slide-up py-8">
             <TimerDisplay />
          </div>

          {/* Tasks Section */}
          <div className="w-full flex justify-center">
            <Tasks />
          </div>
        </div>
      </div>

      {/* Modals */}
      <AllPauseModal isOpen={showPauseModal} onClose={() => setShowPauseModal(false)} />
      <ResumeModal />
      <GraceModal />
      <LogModal isOpen={showLogModal} onClose={() => setShowLogModal(false)} />
      <TaskViewModal isOpen={isScheduleOpen} onClose={() => setScheduleOpen(false)} />
      <WeeklySchedulePanel isOpen={isWeeklyScheduleOpen} onClose={() => setWeeklyScheduleOpen(false)} />
      <SummaryView />
    </div>
  );
};

export default Layout;
