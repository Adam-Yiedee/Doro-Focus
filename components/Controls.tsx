import React from 'react';
import { useTimer } from '../context/TimerContext';

const Controls: React.FC = () => {
  const { switchMode, activeMode } = useTimer();

  return (
    <div className="flex items-center justify-center gap-4 mt-10 w-full">
      {/* Switch Mode (Hit the Clock) */}
      <button
        onClick={switchMode}
        className={`
          w-full max-w-xs h-20 rounded-2xl
          flex items-center justify-center gap-3
          backdrop-blur-md border
          transition-all duration-500 active:scale-95
          shadow-xl shadow-black/10 hover:shadow-black/20
          blur-[2px] opacity-50 hover:blur-0 hover:opacity-100
          ${activeMode === 'work' 
            ? 'bg-blue-500/20 border-blue-400/30 hover:bg-blue-500/30 text-blue-50' 
            : 'bg-red-500/20 border-red-400/30 hover:bg-red-500/30 text-red-50'
          }
        `}
      >
         <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-90"><path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/></svg>
         <span className="text-lg font-bold uppercase tracking-widest">
           {activeMode === 'work' ? 'Switch to Break' : 'Switch to Focus'}
         </span>
      </button>
    </div>
  );
};

export default Controls;