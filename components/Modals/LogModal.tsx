

import React, { useState, useEffect } from 'react';
import { useTimer } from '../../context/TimerContext';
import { AlarmSound, GroupSyncConfig } from '../../types';
import { playAlarm } from '../../utils/sound';
import { QRCodeSVG } from 'qrcode.react';

const LogModal: React.FC<{ onClose: () => void, isOpen: boolean }> = ({ onClose, isOpen }) => {
  const { logs, clearLogs, settings, updateSettings, hardReset, groupSessionId, userName, createGroupSession, joinGroupSession, leaveGroupSession, isHost, peerError, members, hostSyncConfig, updateHostSyncConfig, pendingJoinId, user, login, register, logout, exportData, importData, startMigrationHost, joinMigration } = useTimer();
  const [tab, setTab] = useState<'log' | 'schedule' | 'group' | 'account' | 'settings'>('log');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showQR, setShowQR] = useState(false);
  
  // Auth Form State
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  // Cloud/Export State
  const [exportString, setExportString] = useState('');
  const [importString, setImportString] = useState('');
  const [importStatus, setImportStatus] = useState<string>('');
  
  // Migration Sync State
  const [migrationCode, setMigrationCode] = useState<string | null>(null);
  const [migrationInput, setMigrationInput] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');

  // Group Study Flow State: 'menu' | 'host' | 'join'
  const [groupMode, setGroupMode] = useState<'menu' | 'host' | 'join'>('menu');
  const [inputName, setInputName] = useState(userName || '');
  const [inputSessionId, setInputSessionId] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  // Auto-fill from URL
  useEffect(() => {
    if (isOpen && pendingJoinId && !groupSessionId) {
        setTab('group');
        setGroupMode('join');
        setInputSessionId(pendingJoinId);
    }
  }, [isOpen, pendingJoinId, groupSessionId]);

  // Reset internal state when tab or modal closes
  useEffect(() => {
      if(!isOpen) {
          setGroupMode('menu');
          setMigrationCode(null);
          setIsSyncing(false);
      }
  }, [isOpen]);

  // Sync Options State for New Session
  const [tempSyncConfig, setTempSyncConfig] = useState<GroupSyncConfig>({
      syncTimers: true,
      syncTasks: true,
      syncSchedule: true,
      syncHistory: false,
      syncSettings: true
  });

  const formatTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const formatDur = (sec: number) => {
    if (sec < 60) return `${Math.floor(sec)}s`;
    return `${Math.floor(sec/60)}m ${Math.floor(sec%60)}s`;
  };

  const SOUND_OPTIONS: { val: AlarmSound, label: string }[] = [
      { val: 'bell', label: 'Classic Bell' },
      { val: 'digital', label: 'Digital Alarm' },
      { val: 'chime', label: 'Soft Chime' },
      { val: 'gong', label: 'Zen Gong' },
      { val: 'pop', label: 'Pop' },
      { val: 'wood', label: 'Woodblock' },
      { val: 'marimba', label: 'Marimba' },
      { val: 'crystal', label: 'Crystal' },
      { val: 'blade', label: 'Blade Runner' },
      { val: 'cosmic', label: 'Cosmic Echo' },
      { val: 'ripple', label: 'Water Ripple' },
      { val: 'news', label: 'Breaking News' }
  ];
  
  const handleStartGroup = async () => {
      if(!inputName.trim()) return;
      setIsConnecting(true);
      try {
        await createGroupSession(inputName, tempSyncConfig);
      } catch (e) {
          console.error(e);
      }
      setIsConnecting(false);
  };
  
  const handleJoinGroup = async () => {
      if(!inputName.trim() || !inputSessionId.trim()) return;
      setIsConnecting(true);
      try {
        await joinGroupSession(inputSessionId.trim(), inputName, tempSyncConfig);
      } catch(e) {
          console.error(e);
      }
      setInputSessionId('');
      setIsConnecting(false);
  };

  const handleAuthSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      setAuthError('');
      if (!authUsername.trim() || !authPassword.trim()) {
          setAuthError('Username and password required');
          return;
      }
      
      let success = false;
      if (isRegistering) {
          success = register(authUsername, authPassword);
          if (!success) setAuthError('Username already taken');
      } else {
          success = login(authUsername, authPassword);
          if (!success) setAuthError('Invalid username or password');
      }

      if (success) {
          setAuthUsername('');
          setAuthPassword('');
      }
  };

  const handleExport = () => {
      const data = exportData();
      setExportString(data);
  };

  const handleImport = () => {
      if (!importString) return;
      const success = importData(importString);
      if (success) {
          setImportStatus('Data imported successfully!');
          setImportString('');
      } else {
          setImportStatus('Invalid Data String.');
      }
      setTimeout(() => setImportStatus(''), 3000);
  };

  const handleStartMigration = async () => {
      setIsSyncing(true);
      try {
          const code = await startMigrationHost();
          setMigrationCode(code);
      } catch (e) {
          setSyncStatus('Error starting sync.');
          setIsSyncing(false);
      }
  };

  const handleJoinMigration = async () => {
      if (!migrationInput.trim()) return;
      setIsSyncing(true);
      setSyncStatus('Connecting...');
      try {
          await joinMigration(migrationInput.trim());
          setSyncStatus('Sync Complete!');
          setTimeout(() => setIsSyncing(false), 2000);
      } catch (e) {
          setSyncStatus('Failed to sync. Check code.');
          setTimeout(() => setIsSyncing(false), 3000);
      }
  };

  const toggleTempSync = (key: keyof GroupSyncConfig) => {
      setTempSyncConfig(prev => ({ ...prev, [key]: !prev[key] }));
  };
  
  const toggleHostSync = (key: keyof GroupSyncConfig) => {
      if (!isHost) return;
      updateHostSyncConfig({ ...hostSyncConfig, [key]: !hostSyncConfig[key] });
  };

  if (!isOpen) return null;

  if (showQR && groupSessionId) {
      return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fade-in" onClick={() => setShowQR(false)}>
              <div className="bg-white p-8 rounded-[2rem] flex flex-col items-center gap-6 animate-slide-up max-w-sm w-full" onClick={e => e.stopPropagation()}>
                  <h3 className="text-black font-bold text-xl tracking-tight">Join Session</h3>
                  <div className="p-2 bg-white border-2 border-black rounded-xl">
                      <QRCodeSVG value={`https://dorofocus.netlify.app/?session=${groupSessionId}`} size={200} level="H" />
                  </div>
                  <div className="text-center w-full">
                      <div className="text-black/40 text-xs font-bold uppercase tracking-widest mb-1">Session ID</div>
                      <div className="text-2xl md:text-3xl font-mono font-bold text-black break-all">{groupSessionId}</div>
                  </div>
                  <button onClick={() => setShowQR(false)} className="text-black/50 hover:text-black text-sm font-bold uppercase tracking-wide">Close</button>
              </div>
          </div>
      );
  }

  const SyncOptionToggle = ({ label, checked, onChange, disabled = false }: { label: string, checked: boolean, onChange: () => void, disabled?: boolean }) => (
      <div className={`flex items-center justify-between p-3 rounded-lg border ${checked ? 'bg-white/10 border-white/20' : 'bg-black/20 border-white/5'} ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
          <span className="text-xs text-white/80 font-medium">{label}</span>
          <button 
            onClick={onChange}
            className={`w-10 h-5 rounded-full p-0.5 transition-colors ${checked ? 'bg-green-500' : 'bg-white/10'}`}
          >
             <div className={`w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${checked ? 'translate-x-5' : ''}`} />
          </button>
      </div>
  );

  return (
    <>
    <div className="fixed inset-0 z-40 flex items-center justify-center p-2 md:p-4 bg-black/60 backdrop-blur-xl animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-3xl bg-[#0F0F11]/90 backdrop-blur-2xl rounded-[2rem] md:rounded-[2.5rem] shadow-2xl border border-white/10 overflow-hidden flex flex-col h-[90vh] md:h-[85vh]" onClick={e => e.stopPropagation()}>
        
        <div className="flex border-b border-white/10 overflow-x-auto shrink-0 scrollbar-hide">
          {['log', 'schedule', 'group', 'account', 'settings'].map(t => (
            <button 
              key={t}
              onClick={() => {
                  if (t === 'schedule') {
                      setShowScheduleModal(true);
                  } else {
                    setTab(t as any);
                  }
              }}
              className={`flex-1 py-4 md:py-5 px-4 font-bold text-[10px] md:text-xs uppercase tracking-[0.2em] transition-colors whitespace-nowrap ${tab === t ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70 hover:bg-white/5'}`}
            >
              {t === 'group' ? 'Group Study' : (t === 'schedule' ? 'Schedule' : t)}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#0F0F11]/50 relative">
          {tab === 'log' && (
            <div className="p-4 md:p-8 space-y-4">
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-bold text-white text-lg tracking-tight">Activity Log</h3>
                <button onClick={clearLogs} className="text-[10px] uppercase tracking-widest text-red-300 hover:text-red-200 font-bold border border-red-500/30 px-3 py-1.5 rounded-full hover:bg-red-500/10 transition-colors">Clear</button>
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
                            <div key={i} className="px-4 py-3 rounded-xl bg-[#1a1523] border border-purple-500/30 flex justify-between items-center text-xs group hover:border-purple-500/50 transition-colors">
                                <div className="flex items-center gap-3">
                                    <div className="w-2 h-2 rounded-full bg-purple-400 shadow-[0_0_10px_rgba(192,132,252,0.5)]" />
                                    <div className="flex flex-col">
                                        <span className="text-purple-200 font-bold tracking-wide uppercase text-[10px]">Grace Period</span>
                                        <span className="text-white/60 text-xs">{displayType}</span>
                                    </div>
                                </div>
                                <span className="font-mono font-bold text-purple-200/80 bg-purple-500/10 px-2 py-1 rounded">{formatDur(log.duration)}</span>
                            </div>
                        );
                    }

                    let borderColor = 'border-white/10';
                    let bgColor = 'bg-white/5';
                    let textColor = 'text-white/80';
                    
                    if (log.type === 'work') {
                        const c = log.color || '#BA4949';
                        borderColor = `border-[${c}]`; 
                        bgColor = 'bg-[#1c1c1e]'; 
                        textColor = 'text-white';
                    } else if (log.type === 'break') {
                        borderColor = 'border-teal-500/30';
                        bgColor = 'bg-[#132020]';
                        textColor = 'text-teal-100';
                    } else if (log.type === 'allpause') {
                        borderColor = 'border-white/10';
                        bgColor = 'bg-[#18181a]';
                        textColor = 'text-white/50';
                    }

                    return (
                      <div 
                        key={i} 
                        className={`p-4 rounded-2xl border-l-[6px] backdrop-blur-sm flex flex-col gap-2 transition-all hover:bg-white/10 ${borderColor} ${bgColor}`}
                        style={log.type === 'work' ? { borderLeftColor: log.color || '#BA4949' } : {}}
                      >
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                              <span className={`uppercase font-bold text-[10px] tracking-widest opacity-70 ${textColor}`}>
                                {log.type === 'allpause' ? 'PAUSED' : log.type}
                              </span>
                          </div>
                          <span className="font-mono text-xs font-bold opacity-70 bg-black/20 px-2 py-1 rounded">{formatDur(log.duration)}</span>
                        </div>
                        
                        <div className="flex justify-between items-end">
                           <div className="flex flex-col gap-1">
                              {log.task ? (
                                  <span className="text-sm font-bold text-white tracking-tight">{log.task.name}</span>
                              ) : (
                                  <span className="text-sm font-medium text-white/40 italic">No active task</span>
                              )}
                              
                              {log.reason && <span className="text-xs text-white/50 italic">"{log.reason}"</span>}
                              
                              <div className="flex items-center gap-2 mt-1">
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/30"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                  <span className="text-[10px] text-white/30 font-mono uppercase tracking-wider">
                                    {formatTime(log.start)} - {formatTime(log.end)}
                                  </span>
                              </div>
                           </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'account' && (
              <div className="p-4 md:p-8 flex flex-col items-center min-h-[500px]">
                  {user ? (
                      <div className="w-full max-w-lg space-y-8 animate-slide-up">
                          <div className="flex flex-col items-center gap-4">
                              <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-blue-500 to-purple-600 flex items-center justify-center text-3xl font-bold text-white shadow-xl">
                                  {user.username.charAt(0).toUpperCase()}
                              </div>
                              <div className="text-center">
                                  <h2 className="text-2xl font-bold text-white tracking-tight">{user.username}</h2>
                                  <p className="text-white/40 text-xs uppercase tracking-widest">Premium Member</p>
                              </div>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 w-full">
                              <div className="bg-white/5 rounded-2xl p-4 border border-white/10 text-center space-y-1">
                                  <div className="text-2xl font-mono font-bold text-white">{Math.floor(user.lifetimeStats.totalFocusHours)}<span className="text-sm opacity-50">h</span></div>
                                  <div className="text-[10px] uppercase font-bold text-white/30 tracking-wider">Total Focus</div>
                              </div>
                              <div className="bg-white/5 rounded-2xl p-4 border border-white/10 text-center space-y-1">
                                  <div className="text-2xl font-mono font-bold text-teal-200">{user.lifetimeStats.totalPomos}</div>
                                  <div className="text-[10px] uppercase font-bold text-white/30 tracking-wider">Pomos</div>
                              </div>
                              <div className="bg-white/5 rounded-2xl p-4 border border-white/10 text-center space-y-1 col-span-2 md:col-span-1">
                                  <div className="text-2xl font-mono font-bold text-blue-200">{user.lifetimeStats.totalSessions}</div>
                                  <div className="text-[10px] uppercase font-bold text-white/30 tracking-wider">Sessions</div>
                              </div>
                              
                              {/* New Stats */}
                              <div className="bg-white/5 rounded-2xl p-4 border border-white/10 text-center space-y-1">
                                  <div className="text-2xl font-mono font-bold text-orange-200">{user.lifetimeStats.currentStreak} <span className="text-sm">days</span></div>
                                  <div className="text-[10px] uppercase font-bold text-white/30 tracking-wider">Current Streak</div>
                              </div>
                              <div className="bg-white/5 rounded-2xl p-4 border border-white/10 text-center space-y-1">
                                  <div className="text-2xl font-mono font-bold text-yellow-200">{user.lifetimeStats.bestStreak} <span className="text-sm">days</span></div>
                                  <div className="text-[10px] uppercase font-bold text-white/30 tracking-wider">Best Streak</div>
                              </div>
                              <div className="bg-white/5 rounded-2xl p-4 border border-white/10 text-center space-y-1">
                                  <div className="text-2xl font-mono font-bold text-purple-200">
                                      {(user.lifetimeStats.totalFocusHours / Math.max(1, (new Date().getTime() - new Date(user.joinedAt).getTime()) / (1000 * 3600 * 24))).toFixed(1)}h
                                  </div>
                                  <div className="text-[10px] uppercase font-bold text-white/30 tracking-wider">Daily Avg</div>
                              </div>
                          </div>

                          <div className="bg-white/5 rounded-2xl p-6 border border-white/10 space-y-6">
                              <div>
                                  <h3 className="text-white font-bold text-sm uppercase tracking-widest opacity-60 mb-2">Device Sync</h3>
                                  <p className="text-xs text-white/50 leading-relaxed mb-4">
                                      Link your account to another device wirelessly to transfer all data instantly.
                                  </p>
                                  
                                  {isSyncing ? (
                                      <div className="p-6 bg-black/40 rounded-xl border border-white/10 flex flex-col items-center gap-4 text-center">
                                           {migrationCode ? (
                                               <>
                                                  <div className="text-3xl font-mono font-bold text-blue-400 tracking-widest bg-white/5 px-4 py-2 rounded-lg">{migrationCode}</div>
                                                  <p className="text-xs text-white/50">Enter this code on your new device</p>
                                                  <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                                               </>
                                           ) : (
                                               <span className="text-white/70 text-sm">{syncStatus || 'Initializing...'}</span>
                                           )}
                                      </div>
                                  ) : (
                                      <div className="flex gap-4">
                                          <button onClick={handleStartMigration} className="flex-1 py-3 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 rounded-xl text-blue-100 font-bold uppercase text-[10px] tracking-widest transition-all">
                                              Sync to New Device
                                          </button>
                                          <button onClick={() => { setIsSyncing(true); setMigrationCode(null); }} className="flex-1 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white font-bold uppercase text-[10px] tracking-widest transition-all">
                                              Sync From Old Device
                                          </button>
                                      </div>
                                  )}
                              </div>

                              <div className="pt-4 border-t border-white/5">
                                  <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-2">Manual Backup (Legacy)</p>
                                  <button onClick={handleExport} className="w-full py-2 bg-white/5 hover:bg-white/10 text-white/40 hover:text-white rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all">
                                      Show Data Key
                                  </button>
                                  {exportString && (
                                      <div className="mt-2 bg-black/40 p-4 rounded-xl border border-white/10 relative">
                                          <textarea readOnly value={exportString} className="w-full bg-transparent text-[10px] font-mono text-white/60 h-24 outline-none resize-none" onClick={e => e.currentTarget.select()} />
                                          <div className="absolute top-2 right-2 text-[10px] bg-white/10 px-2 py-1 rounded text-white/40">Copy</div>
                                      </div>
                                  )}
                              </div>
                          </div>

                          <button onClick={logout} className="w-full py-4 bg-white/5 hover:bg-white/10 border border-white/5 text-red-300 rounded-xl font-bold uppercase text-xs tracking-widest transition-all">
                              Sign Out
                          </button>
                      </div>
                  ) : (
                      <div className="w-full max-w-sm space-y-8 animate-slide-up my-auto">
                          <div className="text-center space-y-2">
                              <h2 className="text-3xl font-bold text-white tracking-tight">{isRegistering ? 'Create Account' : 'Welcome Back'}</h2>
                              <p className="text-white/40 text-xs uppercase tracking-widest">Sign in to sync your progress</p>
                          </div>

                          {isSyncing ? (
                               <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                                   <div className="text-center">
                                       <h3 className="text-white font-bold text-sm uppercase tracking-widest mb-1">Enter Sync Code</h3>
                                       <p className="text-[10px] text-white/40">From your other device</p>
                                   </div>
                                   <input 
                                      autoFocus
                                      type="text" 
                                      className="w-full bg-black/20 border border-white/10 rounded-xl p-4 text-center text-xl font-mono text-white outline-none focus:border-white/30 uppercase"
                                      placeholder="XXXXXX"
                                      value={migrationInput}
                                      onChange={e => setMigrationInput(e.target.value.toUpperCase())}
                                   />
                                   <div className="flex gap-2">
                                       <button onClick={() => setIsSyncing(false)} className="flex-1 py-3 text-white/40 hover:text-white text-xs font-bold uppercase tracking-widest">Cancel</button>
                                       <button onClick={handleJoinMigration} className="flex-1 py-3 bg-blue-500/20 text-blue-100 rounded-xl text-xs font-bold uppercase tracking-widest">Connect</button>
                                   </div>
                                   {syncStatus && <div className="text-center text-xs text-blue-300 font-bold">{syncStatus}</div>}
                               </div>
                          ) : (
                            <>
                                <form onSubmit={handleAuthSubmit} className="space-y-4">
                                    {authError && (
                                        <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-xl text-red-200 text-xs text-center font-bold">
                                            {authError}
                                        </div>
                                    )}
                                    <div>
                                        <label className="block text-[10px] font-bold text-white/30 uppercase tracking-widest mb-2">Username</label>
                                        <input 
                                            type="text" 
                                            autoFocus
                                            className="w-full p-4 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:border-white/30 transition-all placeholder-white/20"
                                            placeholder="Enter username"
                                            value={authUsername}
                                            onChange={e => setAuthUsername(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-white/30 uppercase tracking-widest mb-2">Password</label>
                                        <input 
                                            type="password" 
                                            className="w-full p-4 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:border-white/30 transition-all placeholder-white/20"
                                            placeholder="Enter password"
                                            value={authPassword}
                                            onChange={e => setAuthPassword(e.target.value)}
                                        />
                                    </div>

                                    <button type="submit" className="w-full py-4 bg-white text-black font-bold uppercase text-xs tracking-widest rounded-xl hover:bg-gray-200 active:scale-95 transition-all shadow-lg mt-4">
                                        {isRegistering ? 'Create Account' : 'Sign In'}
                                    </button>
                                </form>

                                <div className="text-center space-y-4">
                                    <button 
                                        onClick={() => { setIsRegistering(!isRegistering); setAuthError(''); }}
                                        className="text-xs text-white/40 hover:text-white transition-colors uppercase tracking-wider font-bold block w-full"
                                    >
                                        {isRegistering ? 'Already have an account? Sign In' : 'New here? Create Account'}
                                    </button>

                                    <div className="pt-4 border-t border-white/10">
                                        <button onClick={() => setIsSyncing(true)} className="text-xs text-blue-300 hover:text-blue-200 font-bold uppercase tracking-widest">
                                            Sync from existing device?
                                        </button>
                                    </div>
                                </div>
                            </>
                          )}
                      </div>
                  )}
              </div>
          )}

          {tab === 'group' && (
              <div className="p-4 md:p-8 flex flex-col items-center justify-center min-h-[500px]">
                  {isConnecting ? (
                      <div className="flex flex-col items-center justify-center gap-4">
                          <div className="w-12 h-12 rounded-full border-2 border-white/20 border-t-white animate-spin"></div>
                          <span className="text-white/50 text-xs font-bold uppercase tracking-widest">Connecting...</span>
                      </div>
                  ) : groupSessionId ? (
                      <div className="w-full flex flex-col items-center gap-8 animate-fade-in max-w-lg">
                          <div className="text-center space-y-1">
                              <h2 className="text-2xl font-bold text-white tracking-tight">Group Study Active</h2>
                              <p className="text-blue-300 text-xs uppercase tracking-widest font-bold">Live Synchronized</p>
                          </div>
                          
                          <div className="w-full bg-white/5 border border-white/10 rounded-2xl p-6 space-y-6 backdrop-blur-md">
                              <div>
                                  <div className="flex justify-between items-center mb-2">
                                      <label className="block text-[10px] font-bold text-white/30 uppercase tracking-widest">Session ID</label>
                                      <button onClick={() => setShowQR(true)} className="text-[10px] text-blue-300 hover:text-blue-200 font-bold uppercase tracking-widest flex items-center gap-1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg> Show QR</button>
                                  </div>
                                  <div 
                                      onClick={() => navigator.clipboard.writeText(groupSessionId || '')}
                                      className="text-xl md:text-2xl font-mono font-bold text-white tracking-wide cursor-pointer hover:text-white/80 select-all bg-black/40 p-4 rounded-xl break-all border border-white/5 shadow-inner text-center"
                                  >
                                      {groupSessionId}
                                  </div>
                              </div>

                              <div>
                                  <label className="block text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">Members ({members.length})</label>
                                  <div className="flex flex-wrap gap-2">
                                      {members.map(m => (
                                          <div key={m.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${m.isHost ? 'bg-blue-500/20 border-blue-400/30 text-blue-100' : 'bg-white/5 border-white/10 text-white/80'}`}>
                                              <div className={`w-2 h-2 rounded-full ${m.isHost ? 'bg-blue-400' : 'bg-white/40'}`} />
                                              <span className="text-xs font-bold">{m.name} {m.id === 'host' || m.isHost ? '(Host)' : ''}</span>
                                          </div>
                                      ))}
                                  </div>
                              </div>
                              
                              {isHost ? (
                                  <div>
                                     <label className="block text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">Host Controls (Shared Data)</label>
                                     <div className="space-y-2">
                                        <SyncOptionToggle label="Sync Timers" checked={hostSyncConfig.syncTimers} onChange={() => toggleHostSync('syncTimers')} />
                                        <SyncOptionToggle label="Sync Tasks" checked={hostSyncConfig.syncTasks} onChange={() => toggleHostSync('syncTasks')} />
                                        <SyncOptionToggle label="Sync Schedule" checked={hostSyncConfig.syncSchedule} onChange={() => toggleHostSync('syncSchedule')} />
                                     </div>
                                  </div>
                              ) : (
                                  <div>
                                     <label className="block text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">Client Preferences (Accept Data)</label>
                                     <div className="space-y-2">
                                        <div className="p-3 bg-white/5 rounded-lg border border-white/5 text-center text-xs text-white/50 italic">
                                            Controlled by initial join settings. Rejoin to change.
                                        </div>
                                     </div>
                                  </div>
                              )}
                          </div>

                          <button 
                              onClick={() => { leaveGroupSession(); setGroupMode('menu'); }}
                              className="w-full py-4 border border-red-500/30 text-red-300 hover:bg-red-500/10 rounded-xl font-bold uppercase text-xs tracking-widest transition-all"
                          >
                              Leave Session
                          </button>
                      </div>
                  ) : (
                      <div className="w-full max-w-sm space-y-8 animate-slide-up">
                          <div className="text-center space-y-2">
                              <h2 className="text-3xl font-bold text-white tracking-tight">Group Study</h2>
                              <p className="text-white/40 text-xs uppercase tracking-widest">Sync Timers & Tasks</p>
                          </div>

                          {peerError && (
                              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-200 text-xs text-center font-bold">
                                  {peerError}
                              </div>
                          )}

                          {groupMode === 'menu' && (
                              <div className="space-y-4">
                                  <div>
                                      <label className="block text-[10px] font-bold text-white/30 uppercase tracking-widest mb-2">Username</label>
                                      <input 
                                          type="text" 
                                          placeholder="Enter Your Name"
                                          className="w-full p-4 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:border-white/30 focus:bg-white/10 transition-all placeholder-white/20 text-center font-bold"
                                          value={inputName}
                                          onChange={e => setInputName(e.target.value)}
                                      />
                                  </div>
                                  
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                                      <button 
                                          onClick={() => setGroupMode('host')}
                                          disabled={!inputName.trim()}
                                          className="p-6 bg-white/10 hover:bg-white/20 border border-white/5 rounded-2xl flex flex-col items-center gap-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98]"
                                      >
                                          <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-200">
                                              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                                          </div>
                                          <div className="text-center">
                                              <div className="text-sm font-bold text-white uppercase tracking-wider">Host Session</div>
                                              <div className="text-[10px] text-white/40 mt-1">Create a room & sync data</div>
                                          </div>
                                      </button>

                                      <button 
                                          onClick={() => setGroupMode('join')}
                                          disabled={!inputName.trim()}
                                          className="p-6 bg-white/10 hover:bg-white/20 border border-white/5 rounded-2xl flex flex-col items-center gap-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98]"
                                      >
                                          <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-200">
                                              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                                          </div>
                                          <div className="text-center">
                                              <div className="text-sm font-bold text-white uppercase tracking-wider">Join Session</div>
                                              <div className="text-[10px] text-white/40 mt-1">Connect via ID or Code</div>
                                          </div>
                                      </button>
                                  </div>
                              </div>
                          )}

                          {groupMode === 'host' && (
                              <div className="space-y-6">
                                  <div className="flex items-center gap-2 mb-4">
                                      <button onClick={() => setGroupMode('menu')} className="text-white/40 hover:text-white text-xs uppercase font-bold tracking-widest">Back</button>
                                      <span className="text-white/20">/</span>
                                      <span className="text-white text-xs uppercase font-bold tracking-widest">Host Settings</span>
                                  </div>

                                  <div className="space-y-3">
                                      <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Data to Sync</p>
                                      <SyncOptionToggle label="Sync Timers" checked={tempSyncConfig.syncTimers} onChange={() => toggleTempSync('syncTimers')} />
                                      <SyncOptionToggle label="Sync Tasks" checked={tempSyncConfig.syncTasks} onChange={() => toggleTempSync('syncTasks')} />
                                      <SyncOptionToggle label="Sync Schedule" checked={tempSyncConfig.syncSchedule} onChange={() => toggleTempSync('syncSchedule')} />
                                      <SyncOptionToggle label="Sync Settings" checked={tempSyncConfig.syncSettings} onChange={() => toggleTempSync('syncSettings')} />
                                  </div>

                                  <button onClick={handleStartGroup} className="w-full py-4 bg-blue-500/20 hover:bg-blue-500/30 text-blue-100 font-bold uppercase text-xs tracking-widest rounded-xl border border-blue-500/30 transition-all">
                                      Start Session
                                  </button>
                              </div>
                          )}

                          {groupMode === 'join' && (
                              <div className="space-y-6">
                                   <div className="flex items-center gap-2 mb-4">
                                      <button onClick={() => setGroupMode('menu')} className="text-white/40 hover:text-white text-xs uppercase font-bold tracking-widest">Back</button>
                                      <span className="text-white/20">/</span>
                                      <span className="text-white text-xs uppercase font-bold tracking-widest">Join Session</span>
                                  </div>

                                  <div>
                                      <label className="block text-[10px] font-bold text-white/30 uppercase tracking-widest mb-2">Session ID</label>
                                      <input 
                                          type="text" 
                                          autoFocus
                                          placeholder="e.g. A1B2C3"
                                          className="w-full p-4 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:border-white/30 text-center font-mono font-bold uppercase"
                                          value={inputSessionId}
                                          onChange={e => setInputSessionId(e.target.value.toUpperCase())}
                                      />
                                  </div>

                                  <div className="space-y-3">
                                      <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Accept Data</p>
                                      <SyncOptionToggle label="Accept Timer Sync" checked={tempSyncConfig.syncTimers} onChange={() => toggleTempSync('syncTimers')} />
                                      <SyncOptionToggle label="Accept Task Sync" checked={tempSyncConfig.syncTasks} onChange={() => toggleTempSync('syncTasks')} />
                                  </div>

                                  <button onClick={handleJoinGroup} disabled={!inputSessionId.trim()} className="w-full py-4 bg-purple-500/20 hover:bg-purple-500/30 text-purple-100 font-bold uppercase text-xs tracking-widest rounded-xl border border-purple-500/30 transition-all disabled:opacity-50">
                                      Connect
                                  </button>
                              </div>
                          )}
                      </div>
                  )}
              </div>
          )}

          {tab === 'settings' && (
              <div className="p-4 md:p-8 space-y-8 animate-slide-up max-w-2xl mx-auto">
                  <div className="flex justify-between items-center border-b border-white/10 pb-4">
                      <h3 className="text-lg font-bold text-white tracking-tight">Timer Settings</h3>
                      <button onClick={() => updateSettings({ ...settings, workDuration: 1500, shortBreakDuration: 300, longBreakDuration: 900 })} className="hidden text-xs text-white/50 hover:text-white uppercase font-bold tracking-widest">Reset Defaults</button>
                  </div>

                  <div className="space-y-6">
                      <div className="grid grid-cols-3 gap-4">
                           <div className="space-y-2">
                               <label className="block text-[10px] font-bold text-white/30 uppercase tracking-widest">Work</label>
                               <input type="number" value={settings.workDuration / 60} onChange={e => updateSettings({...settings, workDuration: Number(e.target.value) * 60})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-center font-bold outline-none focus:border-white/30" />
                           </div>
                           <div className="space-y-2">
                               <label className="block text-[10px] font-bold text-white/30 uppercase tracking-widest">Short Break</label>
                               <input type="number" value={settings.shortBreakDuration / 60} onChange={e => updateSettings({...settings, shortBreakDuration: Number(e.target.value) * 60})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-center font-bold outline-none focus:border-white/30" />
                           </div>
                           <div className="space-y-2">
                               <label className="block text-[10px] font-bold text-white/30 uppercase tracking-widest">Long Break</label>
                               <input type="number" value={settings.longBreakDuration / 60} onChange={e => updateSettings({...settings, longBreakDuration: Number(e.target.value) * 60})} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-center font-bold outline-none focus:border-white/30" />
                           </div>
                      </div>

                      <div className="space-y-3 pt-4 border-t border-white/5">
                           <label className="block text-[10px] font-bold text-white/30 uppercase tracking-widest mb-2">Alarm Sound</label>
                           <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                               {SOUND_OPTIONS.map(opt => (
                                   <button 
                                     key={opt.val}
                                     onClick={() => { updateSettings({...settings, alarmSound: opt.val}); playAlarm(opt.val); }}
                                     className={`p-3 rounded-xl border text-[10px] uppercase tracking-wide font-bold transition-all truncate ${settings.alarmSound === opt.val ? 'bg-white/20 border-white/30 text-white' : 'bg-white/5 border-white/5 text-white/50 hover:bg-white/10'}`}
                                   >
                                       {opt.label}
                                   </button>
                               ))}
                           </div>
                      </div>
                      
                      <div className="pt-4 border-t border-white/5">
                           <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/5">
                               <div>
                                   <div className="text-sm font-bold text-white">Disable Blur Effects</div>
                                   <div className="text-xs text-white/40">Improves performance on older devices</div>
                               </div>
                               <button 
                                onClick={() => updateSettings({...settings, disableBlur: !settings.disableBlur})}
                                className={`w-12 h-6 rounded-full p-1 transition-colors relative ${settings.disableBlur ? 'bg-green-500' : 'bg-white/10'}`}
                               >
                                  <div className={`w-4 h-4 bg-white rounded-full transition-transform shadow-sm ${settings.disableBlur ? 'translate-x-6' : ''}`} />
                               </button>
                           </div>
                      </div>

                      <div className="pt-8 border-t border-white/5">
                           <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-4 flex flex-col gap-4">
                               <div>
                                   <div className="text-sm font-bold text-red-200">Danger Zone</div>
                                   <div className="text-xs text-red-200/50">Irreversible actions</div>
                               </div>
                               {!showResetConfirm ? (
                                   <button onClick={() => setShowResetConfirm(true)} className="w-full py-3 bg-red-500/10 hover:bg-red-500/20 text-red-300 font-bold uppercase text-xs tracking-widest rounded-lg transition-all">
                                       Reset App Data
                                   </button>
                               ) : (
                                   <div className="flex gap-2">
                                       <button onClick={() => setShowResetConfirm(false)} className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white/60 font-bold uppercase text-xs tracking-widest rounded-lg transition-all">Cancel</button>
                                       <button onClick={() => { hardReset(); onClose(); }} className="flex-1 py-3 bg-red-500 text-white font-bold uppercase text-xs tracking-widest rounded-lg transition-all hover:bg-red-600">Confirm Reset</button>
                                   </div>
                               )}
                           </div>
                      </div>
                  </div>
              </div>
          )}

        </div>
      </div>
    </div>
    </>
  );
};

export default LogModal;