
import React, { useState } from 'react';
import { useTimer } from '../context/TimerContext';
import TimerDisplay from './TimerDisplay';
import Tasks from './Tasks';
import AllPauseModal, { ResumeModal } from './Modals/AllPauseModal';
import LogModal from './Modals/LogModal';
import GraceModal from './Modals/GraceModal';
import TaskViewModal from './Modals/TaskViewModal';
import SummaryView from './SummaryView';

const Layout: React.FC = () => {
  const { activeMode, activeColor, settings } = useTimer();
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);

  // Use Inherited activeColor from context, or default
  const containerStyle: React.CSSProperties = {
    backgroundColor: activeMode === 'break' 
      ? '#38858a' 
      : (activeColor || '#BA4949')
  };

  const backdropClass = settings.disableBlur ? 'bg-black/40' : 'backdrop-blur-md bg-white/5';

  return (
    <div 
      className="min-h-screen w-full flex flex-col items-center p-4 relative overflow-x-hidden transition-colors duration-1000 ease-[cubic-bezier(0.25,1,0.5,1)]"
      style={containerStyle}
    >
      {/* Ambient Background Elements (Conditional) */}
      {!settings.disableBlur && (
        <>
            <div className="fixed top-[-20%] left-[-10%] w-[80vw] h-[80vw] bg-white opacity-[0.03] rounded-full blur-[120px] pointer-events-none" />
            <div className="fixed bottom-[-20%] right-[-10%] w-[80vw] h-[80vw] bg-black opacity-[0.05] rounded-full blur-[150px] pointer-events-none" />
        </>
      )}

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

      {/* Modals */}
      <AllPauseModal isOpen={showPauseModal} onClose={() => setShowPauseModal(false)} />
      <ResumeModal />
      <GraceModal />
      <LogModal isOpen={showLogModal} onClose={() => setShowLogModal(false)} />
      <SummaryView />
    </div>
  );
};

export default Layout;
