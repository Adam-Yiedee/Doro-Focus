

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { DEFAULT_BREAK_SURFACE, DEFAULT_WORK_SURFACE, getMutedSurfaceColor } from '../utils/palette';

type GroupBannerItem = GroupNotice & { exiting: boolean };

const GROUP_BANNER_EXIT_MS = 600;
const GROUP_BANNER_VISIBLE_MS = 5600;
const GROUP_BANNER_TOTAL_MS = GROUP_BANNER_VISIBLE_MS + GROUP_BANNER_EXIT_MS;

const colorToRgba = (value: string | undefined, alpha: number) => {
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  const normalized = (value || '').trim().replace('#', '');
  if (normalized.length === 3) {
    const expanded = normalized.split('').map((char) => `${char}${char}`).join('');
    const r = Number.parseInt(expanded.slice(0, 2), 16);
    const g = Number.parseInt(expanded.slice(2, 4), 16);
    const b = Number.parseInt(expanded.slice(4, 6), 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
    }
  }
  if (normalized.length === 6) {
    const r = Number.parseInt(normalized.slice(0, 2), 16);
    const g = Number.parseInt(normalized.slice(2, 4), 16);
    const b = Number.parseInt(normalized.slice(4, 6), 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
    }
  }
  return `rgba(255, 255, 255, ${safeAlpha})`;
};

const Layout: React.FC = () => {
  const { activeMode, activeColor, settings, pendingJoinId, pendingMenuAction, isScheduleOpen, setScheduleOpen, isWeeklyScheduleOpen, setWeeklyScheduleOpen, groupNotice, groupSessionId, guestTimerLockNotice, dismissGuestTimerLockNotice, leaveGroupSession } = useTimer();
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [groupBanners, setGroupBanners] = useState<GroupBannerItem[]>([]);
  const bannerTimersRef = useRef<Record<string, { exit: ReturnType<typeof setTimeout>, remove: ReturnType<typeof setTimeout> }>>({});
  const previousGroupSessionIdRef = useRef<string | null>(null);

  const clearBannerTimer = (id: string) => {
    const timers = bannerTimersRef.current[id];
    if (!timers) return;
    clearTimeout(timers.exit);
    clearTimeout(timers.remove);
    delete bannerTimersRef.current[id];
  };

  const clearAllBannerTimers = () => {
    Object.keys(bannerTimersRef.current).forEach(clearBannerTimer);
  };

  useEffect(() => {
    if (pendingJoinId) {
        setShowLogModal(true);
    }
  }, [pendingJoinId]);

  useEffect(() => {
    if (pendingMenuAction) {
      setShowLogModal(true);
    }
  }, [pendingMenuAction]);

  useEffect(() => {
    if (previousGroupSessionIdRef.current !== groupSessionId) {
      clearAllBannerTimers();
      setGroupBanners([]);
      previousGroupSessionIdRef.current = groupSessionId;
    }
  }, [groupSessionId]);

  useEffect(() => {
    if (!groupNotice) return;
    const id = groupNotice.id;
    clearBannerTimer(id);
    setGroupBanners(prev => {
      const next = [...prev.filter(item => item.id !== id), { ...groupNotice, exiting: false }];
      const trimmed = next.slice(-3);
      const visibleBannerIds = new Set(trimmed.map(item => item.id));
      Object.keys(bannerTimersRef.current).forEach(timerId => {
        if (!visibleBannerIds.has(timerId)) {
          clearBannerTimer(timerId);
        }
      });
      return trimmed;
    });

    const exitTimer = setTimeout(() => {
      setGroupBanners(prev => prev.map(item => item.id === id ? { ...item, exiting: true } : item));
    }, GROUP_BANNER_VISIBLE_MS);

    const removeTimer = setTimeout(() => {
      setGroupBanners(prev => prev.filter(item => item.id !== id));
      clearBannerTimer(id);
    }, GROUP_BANNER_TOTAL_MS);

    bannerTimersRef.current[id] = { exit: exitTimer, remove: removeTimer };
  }, [groupNotice]);

  useEffect(() => {
    return () => {
      clearAllBannerTimers();
    };
  }, []);

  const isLightTheme = settings.themeMode !== 'dark';
  const surfaceColor = activeMode === 'break'
    ? getMutedSurfaceColor(DEFAULT_BREAK_SURFACE, DEFAULT_BREAK_SURFACE)
    : getMutedSurfaceColor(activeColor, DEFAULT_WORK_SURFACE);

  useEffect(() => {
    document.documentElement.style.backgroundColor = surfaceColor;
    document.body.style.background = surfaceColor;
  }, [surfaceColor]);

  const ambientStyles = useMemo(() => {
    return {
      container: {
        backgroundColor: surfaceColor,
        backgroundImage: 'none',
      } as React.CSSProperties,
    };
  }, [surfaceColor]);

  const containerStyle: React.CSSProperties = ambientStyles.container;
  const contentStyle: React.CSSProperties = {
    transform: isWeeklyScheduleOpen
      ? 'translateX(calc(-1 * min(18vw, 260px))) scale(0.99)'
      : 'translateX(0) scale(1)',
  };

  const chromeButtonClass = settings.disableBlur
    ? isLightTheme
      ? 'border-white/40 bg-white/72 text-slate-700 shadow-[0_18px_36px_-28px_rgba(66,88,122,0.55)]'
      : 'border-white/10 bg-black/40 text-white shadow-[0_18px_36px_-28px_rgba(0,0,0,0.75)]'
    : isLightTheme
      ? 'border-white/45 bg-white/32 text-slate-700 backdrop-blur-xl shadow-[0_20px_40px_-28px_rgba(66,88,122,0.55)]'
      : 'border-white/5 bg-white/5 text-white backdrop-blur-md shadow-[0_18px_36px_-28px_rgba(0,0,0,0.72)]';
  const mainSurfaceClass = settings.disableBlur
    ? isLightTheme
      ? 'shadow-[0_34px_80px_-52px_rgba(66,88,122,0.45)]'
      : 'shadow-[0_36px_90px_-58px_rgba(0,0,0,0.72)]'
    : isLightTheme
      ? 'backdrop-blur-[24px] shadow-[0_38px_90px_-58px_rgba(66,88,122,0.45)]'
      : 'backdrop-blur-[26px] shadow-[0_42px_100px_-64px_rgba(0,0,0,0.78)]';
  const mainSurfaceStyle = useMemo<React.CSSProperties>(() => ({
    backgroundColor: colorToRgba(surfaceColor, settings.disableBlur
      ? (isLightTheme ? 0.84 : 0.56)
      : (isLightTheme ? 0.72 : 0.44)),
    backgroundImage: 'none',
  }), [isLightTheme, settings.disableBlur, surfaceColor]);
  const mainSurfaceShellStyle = useMemo<React.CSSProperties>(() => ({
    ...mainSurfaceStyle,
    isolation: 'isolate',
    contain: 'paint',
    transform: 'translateZ(0)',
    backfaceVisibility: 'hidden',
    outline: '1px solid transparent',
    WebkitMaskImage: '-webkit-radial-gradient(white, black)',
    WebkitMaskRepeat: 'no-repeat',
    maskImage: 'linear-gradient(white, white)',
    maskRepeat: 'no-repeat',
  }), [mainSurfaceStyle]);
  const mainSurfaceEdgeStyle = useMemo<React.CSSProperties>(() => ({
    boxShadow: isLightTheme
      ? 'inset 0 0 0 1px rgba(255,255,255,0.34), inset 0 1px 0 rgba(255,255,255,0.5)'
      : 'inset 0 0 0 1px rgba(255,255,255,0.14), inset 0 1px 0 rgba(255,255,255,0.22)',
  }), [isLightTheme]);
  const topIconClass = isLightTheme ? 'text-slate-700' : 'text-white/90';

  return (
    <div 
      className="min-h-screen w-full flex flex-col items-center p-4 relative overflow-x-hidden transition-[background-color,background-image] duration-1000 ease-[cubic-bezier(0.25,1,0.5,1)]"
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
          animation: doroGroupBannerProgress ${GROUP_BANNER_TOTAL_MS}ms linear forwards;
        }
      `}</style>

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
        {guestTimerLockNotice && (
          <div
            key={guestTimerLockNotice.id}
            className={`doro-group-banner pointer-events-auto relative overflow-hidden rounded-[1.65rem] border px-4 py-4 shadow-[0_22px_52px_-30px_rgba(15,23,42,0.9)] ${
              settings.disableBlur
                ? 'border-amber-200/35 bg-black/85'
                : 'border-amber-100/20 bg-[linear-gradient(160deg,rgba(255,245,230,0.14),rgba(255,255,255,0.06))] backdrop-blur-2xl'
            }`}
          >
            <div className="absolute inset-0 opacity-70 bg-[radial-gradient(circle_at_10%_-10%,rgba(251,191,36,0.28),transparent_46%)]" />
            <div className="relative">
              <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-amber-100/70">
                Guest Timer Lock
              </div>
              <div className="mt-1 text-sm font-bold text-white/95">
                {guestTimerLockNotice.title}
              </div>
              <div className="mt-1 text-sm leading-relaxed text-white/68">
                {guestTimerLockNotice.message}
              </div>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={dismissGuestTimerLockNotice}
                  className="rounded-full border border-white/12 bg-white/8 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/72 transition-colors hover:bg-white/12 hover:text-white"
                >
                  Stay in Group
                </button>
                <button
                  type="button"
                  onClick={() => {
                    dismissGuestTimerLockNotice();
                    leaveGroupSession();
                  }}
                  className="rounded-full border border-amber-200/20 bg-amber-100 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-950 transition-colors hover:bg-amber-50"
                >
                  Leave Group
                </button>
              </div>
            </div>
          </div>
        )}
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
              className={`p-2.5 rounded-xl transition-all active:scale-95 hover:shadow-md duration-500 ${chromeButtonClass} opacity-70 hover:opacity-100`}
              title="Pause All"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className={topIconClass}><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            </button>
            <button 
              onClick={() => setShowLogModal(true)}
              className={`p-2.5 rounded-xl transition-all active:scale-95 hover:shadow-md duration-500 ${chromeButtonClass} opacity-70 hover:opacity-100`}
              title="Menu"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className={topIconClass} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="w-full max-w-5xl z-10">
          <div
            className={`relative overflow-hidden rounded-[2rem] md:rounded-[2.6rem] px-4 py-5 md:px-7 md:py-7 ${mainSurfaceClass}`}
            style={mainSurfaceShellStyle}
          >
            <div className="pointer-events-none absolute inset-0" style={{ borderRadius: 'inherit', ...mainSurfaceEdgeStyle }} />
            <div className="relative flex flex-col gap-12">
              {/* Timer Section */}
              <div className="w-full flex justify-center animate-slide-up py-6 md:py-8">
                <TimerDisplay />
              </div>

              {/* Tasks Section */}
              <div className="w-full flex justify-center">
                <Tasks />
              </div>
            </div>
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
