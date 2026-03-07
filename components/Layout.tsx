

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
  const { activeMode, activeColor, settings, pendingJoinId, isScheduleOpen, setScheduleOpen, isWeeklyScheduleOpen, setWeeklyScheduleOpen, groupNotice, groupSessionId } = useTimer();
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
    }, 2600);

    const removeTimer = setTimeout(() => {
      setGroupBanners(prev => prev.filter(item => item.id !== id));
      clearBannerTimer(id);
    }, 3200);

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
  const ambientColor = activeMode === 'break'
    ? DEFAULT_BREAK_SURFACE
    : activeColor || DEFAULT_WORK_SURFACE;
  const secondaryAccent = activeMode === 'break' ? DEFAULT_WORK_SURFACE : DEFAULT_BREAK_SURFACE;
  const ambientStyles = useMemo(() => {
    const primaryGlow = colorToRgba(ambientColor, isLightTheme ? 0.28 : 0.22);
    const secondaryGlow = colorToRgba(secondaryAccent, isLightTheme ? 0.22 : 0.18);
    const tertiaryGlow = colorToRgba(surfaceColor, isLightTheme ? 0.24 : 0.12);

    return {
      container: {
        backgroundColor: surfaceColor,
        backgroundImage: isLightTheme
          ? `linear-gradient(180deg, rgba(255, 255, 255, 0.54), rgba(255, 255, 255, 0.08)), radial-gradient(circle at 14% 10%, ${primaryGlow} 0%, transparent 34%), radial-gradient(circle at 84% 18%, ${secondaryGlow} 0%, transparent 30%), radial-gradient(circle at 50% 115%, ${tertiaryGlow} 0%, transparent 42%)`
          : `linear-gradient(180deg, rgba(7, 10, 18, 0.36), rgba(7, 10, 18, 0.08)), radial-gradient(circle at 14% 10%, ${primaryGlow} 0%, transparent 34%), radial-gradient(circle at 84% 18%, ${secondaryGlow} 0%, transparent 30%), radial-gradient(circle at 50% 115%, ${tertiaryGlow} 0%, transparent 42%)`,
      } as React.CSSProperties,
      topLeft: {
        background: `radial-gradient(circle, ${colorToRgba(ambientColor, isLightTheme ? 0.4 : 0.24)} 0%, transparent 68%)`,
      } as React.CSSProperties,
      topRight: {
        background: `radial-gradient(circle, ${colorToRgba(secondaryAccent, isLightTheme ? 0.34 : 0.22)} 0%, transparent 68%)`,
      } as React.CSSProperties,
      bottomGlow: {
        background: `radial-gradient(circle, ${colorToRgba(ambientColor, isLightTheme ? 0.22 : 0.16)} 0%, transparent 70%)`,
      } as React.CSSProperties,
      sheen: {
        background: isLightTheme
          ? 'linear-gradient(140deg, rgba(255,255,255,0.42), rgba(255,255,255,0) 28%, rgba(255,255,255,0.12) 72%, rgba(255,255,255,0.24))'
          : 'linear-gradient(140deg, rgba(255,255,255,0.08), rgba(255,255,255,0) 28%, rgba(255,255,255,0.04) 72%, rgba(255,255,255,0.08))',
      } as React.CSSProperties,
    };
  }, [ambientColor, isLightTheme, secondaryAccent, surfaceColor]);

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
      ? 'border-white/40 bg-white/68 shadow-[0_34px_80px_-52px_rgba(66,88,122,0.45)]'
      : 'border-white/10 bg-black/28 shadow-[0_36px_90px_-58px_rgba(0,0,0,0.72)]'
    : isLightTheme
      ? 'border-white/45 bg-white/20 backdrop-blur-[24px] shadow-[0_38px_90px_-58px_rgba(66,88,122,0.45)]'
      : 'border-white/10 bg-white/[0.06] backdrop-blur-[26px] shadow-[0_42px_100px_-64px_rgba(0,0,0,0.78)]';
  const mainSurfaceStyle = useMemo<React.CSSProperties>(() => ({
    backgroundImage: isLightTheme
      ? `linear-gradient(180deg, rgba(255,255,255,0.24), rgba(255,255,255,0.06)), linear-gradient(145deg, ${colorToRgba(ambientColor, 0.18)} 0%, rgba(255,255,255,0.48) 48%, ${colorToRgba(secondaryAccent, 0.1)} 100%)`
      : `linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02)), linear-gradient(145deg, ${colorToRgba(ambientColor, 0.18)} 0%, rgba(7,10,18,0.52) 48%, ${colorToRgba(secondaryAccent, 0.08)} 100%)`,
  }), [ambientColor, isLightTheme, secondaryAccent]);
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
          animation: doroGroupBannerProgress 3.2s linear forwards;
        }
      `}</style>

      {/* Ambient Background Elements (Conditional) */}
      {!settings.disableBlur && (
        <>
          <div className="pointer-events-none fixed inset-0 overflow-hidden">
            <div className="absolute -top-[22vh] -left-[16vw] h-[46rem] w-[46rem] rounded-full blur-[128px]" style={ambientStyles.topLeft} />
            <div className="absolute -top-[14vh] right-[-14vw] h-[40rem] w-[40rem] rounded-full blur-[132px]" style={ambientStyles.topRight} />
            <div className="absolute bottom-[-28vh] left-1/2 h-[42rem] w-[54rem] -translate-x-1/2 rounded-full blur-[150px]" style={ambientStyles.bottomGlow} />
            <div className="absolute inset-0 opacity-70" style={ambientStyles.sheen} />
          </div>
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
            className={`relative overflow-hidden rounded-[2rem] md:rounded-[2.6rem] border px-4 py-5 md:px-7 md:py-7 ${mainSurfaceClass}`}
            style={mainSurfaceStyle}
          >
            <div className="absolute inset-0 opacity-80 bg-[radial-gradient(circle_at_14%_-8%,rgba(255,255,255,0.22),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.06),transparent_24%,rgba(255,255,255,0.03)_100%)]" />
            <div className="absolute inset-x-10 top-0 h-px bg-white/40" />
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
