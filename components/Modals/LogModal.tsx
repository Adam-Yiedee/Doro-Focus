
import React, { useState, useMemo } from 'react';
import { useTimer } from '../../context/TimerContext';
import TaskViewModal from './TaskViewModal';
import { AlarmSound } from '../../types';
import { playAlarm } from '../../utils/sound';

const LogModal: React.FC<{ onClose: () => void, isOpen: boolean }> = ({ onClose, isOpen }) => {
  const { logs, clearLogs, settings, updateSettings, hardReset, pomodoroCount, setPomodoroCount, groupSessionId, userName, createGroupSession, joinGroupSession, leaveGroupSession } = useTimer();
  const [tab, setTab] = useState<'log' | 'history' | 'group' | 'settings'>('log');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [pixelsPerMin, setPixelsPerMin] = useState(2);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  
  // Group Study Form State
  const [inputName, setInputName] = useState(userName || '');
  const [inputSessionId, setInputSessionId] = useState('');

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
  
  const handleStartGroup = () => {
      if(!inputName.trim()) return;
      createGroupSession(inputName);
  };
  
  const handleJoinGroup = () => {
      if(!inputName.trim() || !inputSessionId.trim()) return;
      joinGroupSession(inputSessionId.toUpperCase(), inputName);
      setInputSessionId('');
  };

  if (!isOpen) return null;

  return (
    <>
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xl animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-3xl bg-white/10 backdrop-blur-2xl rounded-[2.5rem] shadow-2xl border border-white/10 overflow-hidden flex flex-col h-[85vh]" onClick={e => e.stopPropagation()}>
        
        <div className="flex border-b border-white/10 overflow-x-auto shrink-0">
          {['log', 'history', 'schedule', 'group', 'settings'].map(t => (
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
              {t === 'history' ? 'Schedule Log' : (t === 'group' ? 'Group Study' : t)}
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
                    const isGrace = log.type === 'grace' || (log.reason && log.reason.startsWith('Grace Period'));

                    if (isGrace) {
                        let displayType = 'Unmarked';
                        if (log.reason?.includes('Working')) displayType = 'Working';
                        if (log.reason?.includes('Resting')) displayType = 'Resting';

                        return (
                            <div key={i} className="px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20 flex justify-between items-center text-xs">
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-purple-400/50" />
                                    <span className="text-purple-200 font-medium">Grace: {displayType}</span>
                                </div>
                                <span className="font-mono text-purple-200/60">{formatDur(log.duration)}</span>
                            </div>
                        );
                    }

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
                        <input type="range" min="1" max="12" step="0.5" value={pixelsPerMin} onChange={e => setPixelsPerMin(Number(e.target.value))} className="w-20 accent-white/50 h-1 bg-white/10 rounded-full appearance-none cursor-pointer" />
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

          {tab === 'group' && (
              <div className="p-8 flex flex-col items-center justify-center min-h-[500px]">
                  {!groupSessionId ? (
                      <div className="w-full max-w-sm space-y-8 animate-slide-up">
                          <div className="text-center space-y-2">
                              <h2 className="text-2xl font-bold text-white tracking-tight">Join the Hive</h2>
                              <p className="text-white/40 text-xs uppercase tracking-widest">Collaborative Focus Sessions</p>
                          </div>
                          
                          <div className="space-y-4">
                              <div>
                                  <label className="block text-[10px] font-bold text-white/30 uppercase tracking-widest mb-2">Username</label>
                                  <input 
                                      type="text" 
                                      placeholder="Your Name"
                                      className="w-full p-4 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:border-white/30 focus:bg-white/10 transition-all placeholder-white/20"
                                      value={inputName}
                                      onChange={e => setInputName(e.target.value)}
                                  />
                              </div>

                              <div className="pt-4 flex flex-col gap-4">
                                  <button 
                                      onClick={handleStartGroup}
                                      disabled={!inputName.trim()}
                                      className="w-full py-4 bg-white text-black font-bold uppercase text-xs tracking-widest rounded-xl hover:bg-gray-200 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                      Start Group Study
                                  </button>
                                  
                                  <div className="relative flex items-center py-2">
                                      <div className="flex-grow border-t border-white/10"></div>
                                      <span className="flex-shrink-0 mx-4 text-white/20 text-[10px] uppercase font-bold">Or Join Existing</span>
                                      <div className="flex-grow border-t border-white/10"></div>
                                  </div>

                                  <div className="flex gap-2">
                                      <input 
                                          type="text" 
                                          placeholder="Session ID"
                                          className="flex-1 p-4 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:border-white/30 transition-all placeholder-white/20 uppercase font-mono text-sm"
                                          value={inputSessionId}
                                          onChange={e => setInputSessionId(e.target.value)}
                                      />
                                      <button 
                                          onClick={handleJoinGroup}
                                          disabled={!inputName.trim() || !inputSessionId.trim()}
                                          className="px-6 bg-white/10 hover:bg-white/20 text-white font-bold uppercase text-xs tracking-widest rounded-xl transition-all disabled:opacity-50"
                                      >
                                          Join
                                      </button>
                                  </div>
                              </div>
                          </div>
                      </div>
                  ) : (
                      <div className="w-full max-w-sm flex flex-col items-center gap-8 animate-fade-in">
                          <div className="w-24 h-24 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center mb-2 animate-pulse">
                              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-400"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                          </div>
                          
                          <div className="text-center space-y-1">
                              <h2 className="text-xl font-bold text-white tracking-tight">Connected to Hive</h2>
                              <p className="text-green-400 text-xs uppercase tracking-widest font-bold">Synchronized</p>
                          </div>
                          
                          <div className="w-full bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                              <div>
                                  <label className="block text-[10px] font-bold text-white/30 uppercase tracking-widest mb-1">Session ID</label>
                                  <div 
                                      onClick={() => navigator.clipboard.writeText(groupSessionId || '')}
                                      className="text-2xl font-mono font-bold text-white tracking-widest cursor-pointer hover:text-white/80 select-all"
                                  >
                                      {groupSessionId}
                                  </div>
                              </div>
                              <div>
                                  <label className="block text-[10px] font-bold text-white/30 uppercase tracking-widest mb-1">Signed in as</label>
                                  <div className="text-sm font-bold text-white">{userName}</div>
                              </div>
                          </div>

                          <button 
                              onClick={leaveGroupSession}
                              className="px-8 py-3 border border-red-500/30 text-red-300 hover:bg-red-500/10 rounded-xl font-bold uppercase text-xs tracking-widest transition-all"
                          >
                              Leave Study Session
                          </button>
                          
                          <p className="text-[10px] text-white/30 text-center max-w-xs">
                              All timers, tasks, and schedules are currently synced with the group host.
                          </p>
                      </div>
                  )}
              </div>
          )}

          {tab === 'settings' && (
            <div className="p-8 space-y-8 pb-16">
              <h3 className="font-bold text-white text-lg tracking-tight">Timer Configuration</h3>
              <div className="space-y-6">
                
                {/* Manual Pomo Count */}
                <div>
                   <label className="block text-[10px] font-bold text-white/50 uppercase tracking-widest mb-2">Current Session Pomos</label>
                   <div className="flex items-center gap-3">
                       <input 
                           type="number" 
                           min="0"
                           value={pomodoroCount}
                           onChange={e => setPomodoroCount(Math.max(0, parseInt(e.target.value) || 0))}
                           className="w-full p-4 bg-white/5 rounded-xl border border-white/10 text-white font-mono focus:border-white/30 outline-none transition-colors"
                       />
                       <span className="text-white/30 font-bold text-sm">pomos</span>
                   </div>
                   <p className="text-[10px] text-white/30 mt-1">Adjusts "until long break" calculation.</p>
                </div>

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

                {/* Danger Zone */}
                <div className="pt-8 mt-8 border-t border-white/10">
                    <h4 className="text-red-400 font-bold text-xs uppercase tracking-widest mb-4">Danger Zone</h4>
                    {!showResetConfirm ? (
                        <button 
                            onClick={() => setShowResetConfirm(true)}
                            className="w-full py-4 border border-red-500/30 text-red-300 hover:bg-red-500/10 rounded-xl font-bold text-xs uppercase tracking-widest transition-all"
                        >
                            Reset App Data
                        </button>
                    ) : (
                        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-center space-y-4 animate-fade-in">
                            <p className="text-red-200 text-sm font-medium">Are you sure? This will delete all tasks and history.</p>
                            <div className="flex gap-3">
                                <button 
                                    onClick={() => setShowResetConfirm(false)}
                                    className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white rounded-lg text-xs font-bold uppercase tracking-wide"
                                >
                                    Cancel
                                </button>
                                <button 
                                    onClick={() => { hardReset(); onClose(); }}
                                    className="flex-1 py-3 bg-red-500 text-white hover:bg-red-600 rounded-lg text-xs font-bold uppercase tracking-wide shadow-lg"
                                >
                                    Confirm Reset
                                </button>
                            </div>
                        </div>
                    )}
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
