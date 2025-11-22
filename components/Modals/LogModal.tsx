import React from 'react';
import { useTimer } from '../../context/TimerContext';

const LogModal: React.FC<{ onClose: () => void, isOpen: boolean }> = ({ onClose, isOpen }) => {
  const { logs, clearLogs, settings, updateSettings, categories, addCategory, deleteCategory, activeMode } = useTimer();
  const [tab, setTab] = React.useState<'log' | 'settings' | 'categories'>('log');
  
  const [newCatName, setNewCatName] = React.useState('');
  const [newCatColor, setNewCatColor] = React.useState('#BA4949');

  if (!isOpen) return null;

  const formatTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const formatDur = (sec: number) => {
    if (sec < 60) return `${Math.floor(sec)}s`;
    return `${Math.floor(sec/60)}m ${Math.floor(sec%60)}s`;
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xl animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white/10 backdrop-blur-2xl rounded-[2.5rem] shadow-2xl border border-white/10 overflow-hidden flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        
        <div className="flex border-b border-white/10">
          {['log', 'categories', 'settings'].map(t => (
            <button 
              key={t}
              onClick={() => setTab(t as any)}
              className={`flex-1 py-5 font-bold text-xs uppercase tracking-[0.2em] transition-colors ${tab === t ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70 hover:bg-white/5'}`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          {tab === 'log' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-bold text-white text-lg tracking-tight">Activity History</h3>
                <button onClick={clearLogs} className="text-[10px] uppercase tracking-widest text-red-300 hover:text-red-200 font-bold border border-red-500/30 px-3 py-1.5 rounded-full hover:bg-red-500/10 transition-colors">Clear History</button>
              </div>
              
              {logs.length === 0 ? (
                <div className="text-white/30 text-center py-12 text-sm font-medium italic">No activity recorded yet.</div>
              ) : (
                <div className="space-y-3">
                  {logs.map((log, i) => {
                    // Determine Colors
                    let borderColor = 'border-white/10';
                    let bgColor = 'bg-white/5';
                    let textColor = 'text-white/80';

                    if (log.type === 'work') {
                        // Use stored color, or fallback to white/red
                        const c = log.color || '#BA4949';
                        borderColor = `border-[${c}]`; // Note: Tailwind arbitrary values won't interpolate perfectly without full config, using inline style for border/bg is safer
                        bgColor = ''; // Will use inline
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

          {tab === 'settings' && (
            <div className="space-y-8">
              <h3 className="font-bold text-white text-lg tracking-tight">Timer Configuration</h3>
              <div className="space-y-6">
                {[
                    { label: 'Work Duration', val: settings.workDuration, key: 'workDuration' },
                    { label: 'Short Break Reward', val: settings.shortBreakDuration, key: 'shortBreakDuration' },
                    { label: 'Break Bank Cap', val: settings.longBreakDuration, key: 'longBreakDuration' }
                ].map((item) => (
                    <div key={item.key}>
                      <label className="block text-[10px] font-bold text-white/50 uppercase tracking-widest mb-2">{item.label}</label>
                      <div className="flex items-center gap-3">
                        <input 
                            type="number" 
                            value={item.val / 60}
                            onChange={e => updateSettings({ ...settings, [item.key]: Number(e.target.value) * 60 })}
                            className="w-full p-4 bg-white/5 rounded-xl border border-white/10 text-white font-mono focus:border-white/30 outline-none transition-colors"
                        />
                        <span className="text-white/30 font-bold text-sm">min</span>
                      </div>
                    </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'categories' && (
            <div className="space-y-6">
              <h3 className="font-bold text-white text-lg tracking-tight">Categories</h3>
              <div className="flex gap-2">
                <input 
                  value={newCatName}
                  onChange={e => setNewCatName(e.target.value)}
                  placeholder="New Category..."
                  className="flex-1 p-3 bg-white/5 rounded-xl border border-white/10 text-white placeholder-white/20 outline-none focus:border-white/30"
                />
                <input 
                  type="color" 
                  value={newCatColor}
                  onChange={e => setNewCatColor(e.target.value)}
                  className="w-12 h-full rounded-xl overflow-hidden p-0 border-none cursor-pointer"
                />
                <button 
                  onClick={() => { if(newCatName) { addCategory(newCatName, newCatColor); setNewCatName(''); } }}
                  className="px-6 bg-white text-black rounded-xl font-bold text-sm hover:scale-105 transition-transform"
                >
                  Add
                </button>
              </div>
              <div className="space-y-2">
                {categories.map(cat => (
                  <div key={cat.id} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5 group hover:border-white/20 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded-full shadow-lg" style={{ backgroundColor: cat.color }} />
                      <span className="font-medium text-white/90">{cat.name}</span>
                    </div>
                    <button onClick={() => deleteCategory(cat.id)} className="text-white/20 hover:text-red-400 px-2 transition-colors">×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-white/10 bg-white/5 flex justify-end">
          <button onClick={onClose} className="px-8 py-3 bg-white text-black rounded-2xl font-bold tracking-wide hover:bg-gray-200 transition-colors text-sm uppercase">Done</button>
        </div>
      </div>
    </div>
  );
};

export default LogModal;