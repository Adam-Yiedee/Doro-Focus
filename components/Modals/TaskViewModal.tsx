
import React, { useState, useEffect, useMemo } from 'react';
import { useTimer } from '../../context/TimerContext';

interface TimeSlot {
    id: string;
    type: 'work' | 'short-break' | 'long-break' | 'pause';
    startTime: Date;
    endTime: Date;
    durationMinutes: number;
    label?: string;
}

const TaskViewModal: React.FC<{ isOpen: boolean, onClose: () => void }> = ({ isOpen, onClose }) => {
    const { settings, pomodoroCount } = useTimer();
    
    const [startHour, setStartHour] = useState(new Date().getHours());
    const [startMinute, setStartMinute] = useState(Math.ceil(new Date().getMinutes() / 15) * 15); 
    const [targetPomos, setTargetPomos] = useState(8);
    const [pauses, setPauses] = useState<{ index: number, duration: number, label: string }[]>([]);

    useEffect(() => {
        if (isOpen) {
            const now = new Date();
            setStartHour(now.getHours());
            setStartMinute(Math.ceil(now.getMinutes() / 5) * 5);
        }
    }, [isOpen]);

    const timeline = useMemo(() => {
        const slots: TimeSlot[] = [];
        let currentTime = new Date();
        currentTime.setHours(startHour, startMinute, 0, 0);

        // Start calculation from current pomo count to correctly predict long breaks
        // Assuming the schedule starts *now* or is a plan for the immediate future
        let virtualPomoCount = pomodoroCount; 

        for (let i = 0; i < targetPomos; i++) {
            // 1. Work Slot
            const workStart = new Date(currentTime);
            const workDuration = settings.workDuration / 60; 
            currentTime = new Date(currentTime.getTime() + workDuration * 60000);
            
            slots.push({
                id: `work-${i}`,
                type: 'work',
                startTime: workStart,
                endTime: currentTime,
                durationMinutes: workDuration,
            });

            // Check for Pause
            const pause = pauses.find(p => p.index === i);
            if (pause) {
                 const pauseStart = new Date(currentTime);
                 currentTime = new Date(currentTime.getTime() + pause.duration * 60000);
                 slots.push({
                     id: `pause-${i}`,
                     type: 'pause',
                     startTime: pauseStart,
                     endTime: currentTime,
                     durationMinutes: pause.duration,
                     label: pause.label
                 });
            }

            // 2. Break Slot (Only if not last, or if user wants breaks after last)
            // Usually beneficial to see the break earned after the last session
            virtualPomoCount++;
            const isLongBreak = virtualPomoCount > 0 && (virtualPomoCount % settings.longBreakInterval === 0);
            const breakDuration = isLongBreak ? (settings.longBreakDuration / 60) : (settings.shortBreakDuration / 60);
            
            const breakStart = new Date(currentTime);
            currentTime = new Date(currentTime.getTime() + breakDuration * 60000);
            
            slots.push({
                id: `break-${i}`,
                type: isLongBreak ? 'long-break' : 'short-break',
                startTime: breakStart,
                endTime: currentTime,
                durationMinutes: breakDuration
            });
        }
        return slots;
    }, [startHour, startMinute, targetPomos, settings, pomodoroCount, pauses]);

    const formatTime = (date: Date) => {
        return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '');
    };

    const handleAddPause = (slotIndex: number) => {
        setPauses(prev => [...prev, { index: slotIndex, duration: 30, label: 'Lunch' }]);
    };

    const handleRemovePause = (slotIndex: number) => {
        setPauses(prev => prev.filter(p => p.index !== slotIndex));
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fade-in" onClick={onClose}>
             <div className="w-full max-w-5xl h-[90vh] bg-[#0a0a0a] rounded-[2rem] shadow-2xl border border-white/10 flex flex-col overflow-hidden relative" onClick={e => e.stopPropagation()}>
                
                {/* Ambient Glow */}
                <div className="absolute top-0 left-1/4 w-1/2 h-1/2 bg-blue-500/10 blur-[100px] pointer-events-none" />

                {/* Header */}
                <div className="relative z-10 p-8 border-b border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-white/5 backdrop-blur-xl">
                    <div>
                        <h2 className="text-2xl font-bold text-white tracking-tight">Session Schedule</h2>
                        <p className="text-white/40 text-xs uppercase tracking-widest mt-1">Plan your day</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-8">
                        {/* Start Time */}
                        <div className="flex flex-col gap-1.5">
                            <label className="text-[9px] font-bold text-white/40 uppercase tracking-widest">Start Time</label>
                            <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2 border border-white/10 hover:border-white/20 transition-colors">
                                <input 
                                    type="number" min="0" max="23"
                                    value={startHour} onChange={e => setStartHour(Number(e.target.value))}
                                    className="w-8 bg-transparent text-center text-white font-mono text-lg outline-none"
                                />
                                <span className="text-white/30 text-lg font-light">:</span>
                                <input 
                                    type="number" min="0" max="59" step="5"
                                    value={startMinute} onChange={e => setStartMinute(Number(e.target.value))}
                                    className="w-8 bg-transparent text-center text-white font-mono text-lg outline-none"
                                />
                            </div>
                        </div>

                        {/* Duration */}
                        <div className="flex flex-col gap-1.5">
                             <label className="text-[9px] font-bold text-white/40 uppercase tracking-widest">Sessions</label>
                             <div className="flex items-center gap-3 bg-white/5 rounded-lg px-3 py-2 border border-white/10">
                                <button onClick={() => setTargetPomos(p => Math.max(1, p - 1))} className="text-white/40 hover:text-white text-lg font-bold px-2">-</button>
                                <span className="text-white font-mono text-lg w-6 text-center">{targetPomos}</span>
                                <button onClick={() => setTargetPomos(p => Math.min(20, p + 1))} className="text-white/40 hover:text-white text-lg font-bold px-2">+</button>
                             </div>
                        </div>
                    </div>
                </div>

                {/* Timeline Scroll Area */}
                <div className="relative z-10 flex-1 overflow-y-auto custom-scrollbar p-6 md:p-10 space-y-0">
                    {timeline.map((slot, i) => {
                        const isWork = slot.type === 'work';
                        const isPause = slot.type === 'pause';
                        const isLong = slot.type === 'long-break';
                        
                        // Parse ID to get original index for pause logic
                        const rawIndex = parseInt(slot.id.split('-')[1]);
                        const hasPauseAfter = pauses.some(p => p.index === rawIndex);

                        return (
                            <div key={slot.id} className="flex group">
                                {/* Left Time Column */}
                                <div className="w-16 md:w-24 flex flex-col items-end pr-4 pt-0 relative">
                                    <span className="text-[11px] font-mono text-white/30 sticky top-0">
                                        {formatTime(slot.startTime)}
                                    </span>
                                </div>

                                {/* Center Line */}
                                <div className="relative flex flex-col items-center mx-2">
                                    <div className={`w-3 h-3 rounded-full z-10 border-2 transition-colors duration-300 ${
                                        isWork ? 'bg-white border-white shadow-[0_0_15px_rgba(255,255,255,0.6)]' : 
                                        isPause ? 'bg-amber-400 border-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.5)]' :
                                        isLong ? 'bg-teal-400 border-teal-400' : 
                                        'bg-[#0a0a0a] border-white/20'
                                    }`} />
                                    <div className={`w-0.5 flex-1 -my-1 opacity-20 ${
                                        isWork ? 'bg-gradient-to-b from-white via-white to-transparent' : 'bg-white'
                                    }`} />
                                </div>

                                {/* Right Card */}
                                <div className="flex-1 pb-8 pl-4">
                                    <div className={`
                                        relative overflow-hidden rounded-2xl border transition-all duration-500
                                        flex items-center justify-between px-6
                                        ${isWork 
                                            ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 hover:shadow-2xl h-24' 
                                            : isPause
                                                ? 'bg-amber-500/10 border-amber-500/20 h-20'
                                                : isLong 
                                                    ? 'bg-teal-500/10 border-teal-500/20 h-16'
                                                    : 'bg-white/5 border-white/5 opacity-50 hover:opacity-100 h-14'
                                        }
                                    `}>
                                        {/* Content */}
                                        <div>
                                            <div className={`text-sm font-bold tracking-wide uppercase ${
                                                isWork ? 'text-white' : 
                                                isPause ? 'text-amber-200' : 
                                                isLong ? 'text-teal-200' : 'text-white/60'
                                            }`}>
                                                {isWork ? 'Focus Block' : isPause ? slot.label : (isLong ? 'Long Break' : 'Short Break')}
                                            </div>
                                            <div className="text-[10px] font-mono opacity-50 mt-1">
                                                {slot.durationMinutes} minutes
                                            </div>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center gap-4">
                                            {isWork && !hasPauseAfter && (
                                                <button 
                                                    onClick={() => handleAddPause(rawIndex)}
                                                    className="opacity-0 group-hover:opacity-100 transition-all px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-[10px] uppercase tracking-wider font-bold text-white/60 hover:text-white border border-white/5 hover:border-white/20 transform hover:scale-105"
                                                >
                                                    + Pause
                                                </button>
                                            )}
                                            {isPause && (
                                                <button 
                                                    onClick={() => handleRemovePause(rawIndex)}
                                                    className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/20 text-white/40 hover:text-white transition-colors"
                                                >
                                                    ✕
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {/* End Marker */}
                    <div className="flex">
                        <div className="w-16 md:w-24 text-right pr-4">
                             <span className="text-[11px] font-mono text-white/30">
                                {timeline.length > 0 && formatTime(timeline[timeline.length-1].endTime)}
                             </span>
                        </div>
                        <div className="mx-2 flex flex-col items-center">
                            <div className="w-3 h-3 rounded-full border border-white/20 bg-[#0a0a0a]" />
                        </div>
                        <div className="pl-4 text-[10px] uppercase tracking-[0.2em] text-white/20 font-bold pt-0.5">
                            End of Session
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-white/5 bg-white/5 flex justify-end backdrop-blur-xl">
                    <button onClick={onClose} className="px-8 py-3 bg-white text-black rounded-xl font-bold text-xs uppercase tracking-widest hover:scale-105 transition-transform shadow-lg hover:shadow-white/20">
                        Close Schedule
                    </button>
                </div>
             </div>
        </div>
    );
};

export default TaskViewModal;
