
import React, { useState, useMemo } from 'react';
import { useTimer } from '../../context/TimerContext';
import TaskViewModal from './TaskViewModal';
import { AlarmSound } from '../../types';
import { playAlarm } from '../../utils/sound';

const LogModal: React.FC<{ onClose: () => void, isOpen: boolean }> = ({ onClose, isOpen }) => {
  const { logs, clearLogs, settings, updateSettings } = useTimer();
  const [tab, setTab] = useState<'log' | 'history' | 'settings'>('log');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [pixelsPerMin, setPixelsPerMin] = useState(2);
  
  const formatTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const formatDur = (sec: number) => {
    if (sec < 60) return `${Math.floor(sec)}s`;
    return `${Math.floor(sec/60)}m ${Math.floor(sec%60)}s`;
  };

  const historyData = useMemo(() => {
      if (tab !== 'history') return null;
      
      let blocks: any[] = [];
      let minTime = new Date().setHours(8,0,0,0);
      let maxTime = new Date().setHours(18,0,0,0);

      logs.forEach((log, i) => {
          const start = new Date(log.start);
          const end = new Date(log.end);
          if (start.getTime() < minTime) minTime = start.getTime();
          if (end.getTime() > maxTime) maxTime = end.getTime();
          
          blocks.push({
              id: i,
              start,
              end,
              type: log.type,
              label: log.task ? log.task.name : (log.type === 'work' ? 'Focus' : (log.type === 'break' ? 'Break' : 'Paused')),
              subLabel: log.reason,
              color: log.color
          });
      });

      // Sort and Merge
      blocks.sort((a, b) => a.start.getTime() - b.start.getTime());
      
      const merged: any[] = [];
      if (blocks.length > 0) {
          let current = blocks[0];
          for (let i = 1; i < blocks.length; i++) {
              const next = blocks[i];
              const gap = next.start.getTime() - current.end.getTime();
              if (next.type === current.type && next.label === current.label && gap < 120000) {
                  current.end = next.end;
              } else {
                  merged.push(current);
                  current = next;
              }
          }
          merged.push(current);
      }
      
      const startBound = new Date(minTime);
      startBound.setMinutes(startBound.getMinutes() - 30);
      const totalDurationMins = (maxTime - startBound.getTime()) / 60000 + 60; 

      const renderedBlocks = merged.map(b => {
          const top = (b.start.getTime() - startBound.getTime()) / 60000;
          const height = (b.end.getTime() - b.start.getTime()) / 60000;
          return {
              ...b,
              topPx: top * pixelsPerMin,
              heightPx: Math.max(10, height * pixelsPerMin) 
          };
      });

      return { blocks: renderedBlocks, totalHeight: totalDurationMins * pixelsPerMin, startTime: startBound };
  }, [logs, tab, pixelsPerMin]);

  const formatTime12 = (d: Date) => {
      const h = d.getHours();
      const m = d.getMinutes();
      const ampm = h >= 12 ? 'PM' : 'AM';
      const hour12 = h % 12 || 12;
      return `${hour12}:${m.toString().padStart(2, '0')} ${ampm}`;
  };

  const SOUND_OPTIONS: { val: AlarmSound, label: string }[] = [
      { val: 'bell', label: 'Classic Bell' },
      { val: 'digital', label: 'Digital Alarm' },
      { val: 'chime', label: 'Soft Chime' },
      { val: 'gong', label: 'Zen Gong' },
      { val: 'pop', label: 'Pop' },
      { val: 'wood', label: 'Woodblock' }
  ];

  if (!isOpen) return null;

  return (
    <>
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xl animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-3xl bg-white/10 backdrop-blur-2xl rounded-[2.5rem] shadow-2xl border border-white/10 overflow-hidden flex flex-col h-[85vh]" onClick={e => e.stopPropagation()}>
        
        <div className="flex border-b border-white/10 overflow-x-auto shrink-0">
          {['log', 'history', 'schedule', 'settings'].map(t => (
            <button 
              key={t}
              onClick={() => {
                  if (t === 'schedule') {
                      setShowScheduleModal(true);
                  } else {
                    setTab(t as any);
                  }
              }}
              className={`flex-1 py-5 px-4 font-bold text-xs uppercase tracking-[0.2em] transition-colors whitespace-nowrap ${tab === t ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70 hover:bg-white/5'}`}
            >
              {t === 'history' ? 'Schedule Log' : t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#0F0F11]/50 relative">
          {tab === 'log' && (
            <div className="p-8 space-y-4">
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-bold text-white text-lg tracking-tight">Activity History</h3>
                <button onClick={clearLogs} className="text-[10px] uppercase tracking-widest text-red-300 hover:text-red-200 font-bold border border-red-500/30 px-3 py-1.5 rounded-full hover:bg-red-500/10 transition-colors">Clear History</button>
              </div>
              
              {logs.length === 0 ? (
                <div className="text-white/30 text-center py-12 text-sm font-medium italic">No activity recorded yet.</div>
              ) : (
                <div className="space-y-3">
                  {logs.map((log, i) => {
                    let borderColor = 'border-white/10';
                    let bgColor = 'bg-white/5';
                    let textColor = 'text-white/80';

                    if (log.type === 'work') {
                        const c = log.color || '#BA4949';
                        borderColor = `border-[${c}]`; 
                        bgColor = ''; 
                        textColor = 'text-white';
                    } else if (log.type === 'break') {
                        borderColor = 'border-teal-500/30';
                        bgColor = 'bg-teal-500/10';
                        textColor = 'text-teal-100';
                    } else if (log.type === 'allpause') {
                        borderColor = 'border-white/10';
                        bgColor = 'bg-black/20';
                        textColor = 'text-white/50';
                    } else if (log.type === 'grace') {
                        borderColor = 'border-purple-500/30';
                        bgColor = 'bg-purple-500/10';
                        textColor = 'text-purple-200';
                    }

                    return (
                      <div 
                        key={i} 
                        className={`p-4 rounded-2xl border-l-4 backdrop-blur-sm flex flex-col gap-1 transition-all hover:bg-white/10 ${borderColor} ${bgColor}`}
                        style={log.type === 'work' ? { borderColor: log.color || '#BA4949', backgroundColor: `${log.color}15` || '#BA494915' } : {}}
                      >
                        <div className="flex justify-between items-center">
                          <span className={`capitalize font-bold text-sm tracking-wide ${textColor}`}>
                             {log.type === 'allpause' ? 'Paused' : log.type}
                          </span>
                          <span className="font-mono text-xs opacity-70">{formatDur(log.duration)}</span>
                        </div>
                        
                        <div className="flex justify-between items-end">
                           <div className="flex flex-col gap-0.5">
                              {log.task && <span className="text-sm font-medium text-white">{log.task.name}</span>}
                              {log.reason && <span className="text-xs text-white/60 italic">"{log.reason}"</span>}
                              <span className="text-[10px] text-white/30 uppercase tracking-wider mt-1">
                                {formatTime(log.start)} - {formatTime(log.end)}
                              </span>
                           </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'history' && historyData && (
             <div className="relative w-full min-h-full bg-[#0F0F11]" style={{ height: Math.max(600, historyData.totalHeight) }}>
                 <div className="sticky top-0 z-30 flex justify-end p-2 bg-black/20 backdrop-blur-md">
                     <div className="flex items-center gap-2">
                        <span className="text-[9px] font-bold text-white/30 uppercase">Zoom</span>
                        <input type="range" min="1" max="6" step="0.5" value={pixelsPerMin} onChange={e => setPixelsPerMin(Number(e.target.value))} className="w-20 accent-white/50 h-1 bg-white/10 rounded-full appearance-none cursor-pointer" />
                     </div>
                 </div>

                 {Array.from({ length: Math.ceil(historyData.totalHeight / (60 * pixelsPerMin)) + 1 }).map((_, i) => {
                     const time = new Date(historyData.startTime);
                     time.setMinutes(time.getMinutes() + i * 60);
                     return (
                         <div key={i} className="absolute w-full border-t border-white/5 flex pointer-events-none" style={{ top: i * 60 * pixelsPerMin }}>
                             <span className="text-[9px] font-mono text-white/30 pl-2 pt-1">{formatTime12(time)}</span>
                         </div>
                     )
                 })}
                 
                 {historyData.blocks.map((block: any) => (
                     <div 
                        key={block.id}
                        className={`absolute left-16 right-4 rounded border shadow-lg flex flex-col justify-center px-3 overflow-hidden hover:z-10 hover:scale-[1.01] transition-transform
                             ${block.type === 'work' ? 'bg-[#1c1c1e] border-white/10' : (block.type === 'break' ? 'bg-teal-900/20 border-teal-500/20' : 'bg-black/40 border-white/5 border-dashed')}
                        `}
                        style={{
                            top: block.topPx,
                            height: block.heightPx,
                            borderLeftWidth: '3px',
                            borderLeftColor: block.color || (block.type === 'break' ? '#2dd4bf' : '#777')
                        }}
                     >
                         <div className="flex justify-between">
                             <span className="text-xs font-bold text-white/90 truncate">{block.label}</span>
                             <span className="text-[9px] font-mono text-white/40">{formatTime12(block.start)}</span>
                         </div>
                         {block.subLabel && <span className="text-[9px] text-white/50 truncate">{block.subLabel}</span>}
                     </div>
                 ))}
                 
                 {logs.length === 0 && (
                     <div className="absolute inset-0 flex items-center justify-center text-white/30 italic">No history yet</div>
                 )}
             </div>
          )}

          {tab === 'settings' && (
            <div className="p-8 space-y-8">
              <h3 className="font-bold text-white text-lg tracking-tight">Timer Configuration</h3>
              <div className="space-y-6">
                {[
                    { label: 'Work Duration', val: settings.workDuration, key: 'workDuration', unit: 'min' },
                    { label: 'Short Break Reward', val: settings.shortBreakDuration, key: 'shortBreakDuration', unit: 'min' },
                    { label: 'Break Bank Cap', val: settings.longBreakDuration, key: 'longBreakDuration', unit: 'min' },
                    { label: 'Long Break Interval', val: settings.longBreakInterval, key: 'longBreakInterval', unit: 'pomos' }
                ].map((item) => (
                    <div key={item.key}>
                      <label className="block text-[10px] font-bold text-white/50 uppercase tracking-widest mb-2">{item.label}</label>
                      <div className="flex items-center gap-3">
                        <input 
                            type="number" 
                            value={item.unit === 'min' ? item.val / 60 : item.val}
                            onChange={e => updateSettings({ 
                                ...settings, 
                                [item.key]: item.unit === 'min' ? Number(e.target.value) * 60 : Number(e.target.value)
                            })}
                            className="w-full p-4 bg-white/5 rounded-xl border border-white/10 text-white font-mono focus:border-white/30 outline-none transition-colors"
                        />
                        <span className="text-white/30 font-bold text-sm">{item.unit}</span>
                      </div>
                    </div>
                ))}

                {/* Alarm Sound */}
                <div>
                   <label className="block text-[10px] font-bold text-white/50 uppercase tracking-widest mb-2">Alarm Sound</label>
                   <div className="grid grid-cols-2 gap-2">
                       {SOUND_OPTIONS.map(opt => (
                           <button 
                             key={opt.val}
                             onClick={() => {
                                updateSettings({ ...settings, alarmSound: opt.val });
                                playAlarm(opt.val);
                             }}
                             className={`p-3 rounded-lg text-xs font-bold text-left transition-colors border ${settings.alarmSound === opt.val ? 'bg-white text-black border-white' : 'bg-white/5 text-white/60 border-transparent hover:bg-white/10'}`}
                           >
                               {opt.label}
                           </button>
                       ))}
                   </div>
                </div>

                {/* Disable Blur */}
                <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/10">
                    <div>
                        <div className="text-sm font-bold text-white">Disable Blur Effects</div>
                        <div className="text-[10px] text-white/40">Improves performance on older devices</div>
                    </div>
                    <button 
                        onClick={() => updateSettings({ ...settings, disableBlur: !settings.disableBlur })}
                        className={`w-12 h-6 rounded-full p-1 transition-colors ${settings.disableBlur ? 'bg-green-500' : 'bg-white/10'}`}
                    >
                        <div className={`w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${settings.disableBlur ? 'translate-x-6' : ''}`} />
                    </button>
                </div>

              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-white/10 bg-white/5 flex justify-end">
          <button onClick={onClose} className="px-8 py-3 bg-white text-black rounded-2xl font-bold tracking-wide hover:bg-gray-200 transition-colors text-sm uppercase">Done</button>
        </div>
      </div>
    </div>
    
    <TaskViewModal isOpen={showScheduleModal} onClose={() => setShowScheduleModal(false)} />
    </>
  );
};

export default LogModal;
