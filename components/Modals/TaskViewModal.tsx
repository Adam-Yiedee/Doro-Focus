
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTimer, ScheduleBreak } from '../../context/TimerContext';
import { Task } from '../../types';

interface WorkUnit {
    taskId: number;
    subtaskId?: number;
    name: string;
    subtaskName?: string;
    color?: string;
    pomoIndex: number; 
    estimatedTotal: number;
}

interface TimeBlock {
    id: string;
    type: 'work' | 'break' | 'scheduled-break' | 'log-work' | 'log-break' | 'log-pause';
    startTime: Date;
    endTime: Date;
    durationMinutes: number;
    label: string;
    subLabel?: string;
    color?: string;
    topPx: number;
    heightPx: number;
    isPast?: boolean;
}

const PRESET_COLORS = [
  '#BA4949', '#38858a', '#397097', '#8c5e32', '#7a5c87', '#547a59'
];

const TaskViewModal: React.FC<{ isOpen: boolean, onClose: () => void }> = ({ isOpen, onClose }) => {
    const { tasks, settings, pomodoroCount, logs, workTime, timerStarted, moveTask, moveSubtask, addDetailedTask, splitTask, deleteTask, scheduleBreaks, addScheduleBreak, deleteScheduleBreak, scheduleStartTime, setScheduleStartTime, sessionStartTime } = useTimer();
    
    // Start Time State
    const [stHourStr, setStHourStr] = useState('08');
    const [stMinStr, setStMinStr] = useState('00');
    const [stAmPm, setStAmPm] = useState<'AM'|'PM'>('AM');

    const [isCreating, setIsCreating] = useState(false);
    const [newTaskName, setNewTaskName] = useState('');
    const [newTaskEst, setNewTaskEst] = useState(2);
    const [newTaskColor, setNewTaskColor] = useState(PRESET_COLORS[0]);
    const [newSubtasks, setNewSubtasks] = useState<{name: string, est: number}[]>([]);
    const [subInputName, setSubInputName] = useState('');
    const [subInputEst, setSubInputEst] = useState(1);

    // Break Form State
    const [isAddingBreak, setIsAddingBreak] = useState(false);
    const [breakLabel, setBreakLabel] = useState('Lunch');
    const [breakHourStr, setBreakHourStr] = useState('');
    const [breakMinStr, setBreakMinStr] = useState('');
    const [breakAmPm, setBreakAmPm] = useState<'AM'|'PM'>('PM');
    const [breakDuration, setBreakDuration] = useState(30);

    const [splittingTaskId, setSplittingTaskId] = useState<number | null>(null);
    const [splitValue, setSplitValue] = useState(2);
    const [pixelsPerMin, setPixelsPerMin] = useState(3);

    const [draggedId, setDraggedId] = useState<{ type: 'task' | 'subtask', id: number, parentId?: number } | null>(null);
    const [dropTargetId, setDropTargetId] = useState<{ id: number, parentId?: number, type: 'task' | 'subtask' } | null>(null);

    const calendarRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            const [hStr, mStr] = scheduleStartTime.split(':');
            let h = parseInt(hStr) || 8;
            const m = parseInt(mStr) || 0;
            const isPm = h >= 12;
            if (h > 12) h -= 12;
            if (h === 0) h = 12;
            setStHourStr(h.toString().padStart(2,'0'));
            setStMinStr(m.toString().padStart(2,'0'));
            setStAmPm(isPm ? 'PM' : 'AM');
            
            // Break Defaults to Now
            const now = new Date();
            let curH = now.getHours();
            const curM = now.getMinutes();
            const curIsPm = curH >= 12;
            if (curH > 12) curH -= 12;
            if (curH === 0) curH = 12;
            setBreakHourStr(curH.toString());
            setBreakMinStr(curM.toString().padStart(2, '0'));
            setBreakAmPm(curIsPm ? 'PM' : 'AM');
        }
    }, [isOpen, scheduleStartTime]);

    const updateScheduleStart = () => {
        let h = parseInt(stHourStr);
        const m = parseInt(stMinStr);
        if (isNaN(h) || isNaN(m)) return;
        if (stAmPm === 'PM' && h !== 12) h += 12;
        if (stAmPm === 'AM' && h === 12) h = 0;
        setScheduleStartTime(`${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`);
    };

    // Auto-update schedule start when inputs change (debounce?)
    useEffect(() => {
        const t = setTimeout(updateScheduleStart, 800);
        return () => clearTimeout(t);
    }, [stHourStr, stMinStr, stAmPm]);

    const flattenedWorkUnits = useMemo(() => {
        const units: WorkUnit[] = [];
        tasks.forEach(task => {
            if (task.checked) return; 
            const taskColor = task.color || '#BA4949';
            if (task.subtasks.length > 0) {
                task.subtasks.forEach(sub => {
                    if (sub.checked) return;
                    const remaining = Math.max(1, sub.estimated - sub.completed);
                    for (let i = 0; i < remaining; i++) {
                        units.push({
                            taskId: task.id, subtaskId: sub.id, name: task.name, subtaskName: sub.name, color: taskColor, pomoIndex: i + 1, estimatedTotal: remaining
                        });
                    }
                });
            } else {
                const remaining = Math.max(1, task.estimated - task.completed);
                for (let i = 0; i < remaining; i++) {
                    units.push({
                        taskId: task.id, name: task.name, color: taskColor, pomoIndex: i + 1, estimatedTotal: remaining
                    });
                }
            }
        });
        return units;
    }, [tasks]);
    
    const timelineData = useMemo(() => {
        const blocks: TimeBlock[] = [];
        const now = new Date();
        const [schH, schM] = scheduleStartTime.split(':').map(Number);
        
        // 1. Establish Schedule Anchor
        // Timeline starts at Schedule Start Time today.
        let timelineStart = new Date();
        timelineStart.setHours(schH, schM, 0, 0);
        
        // Filter logs to "Current Session" logs (e.g. today or since session start).
        // If sessionStartTime exists, use that as cutoff for logs to ensure relevancy.
        const sessionLogs = sessionStartTime 
            ? logs.filter(l => l.start >= sessionStartTime)
            : logs.filter(l => {
                 // Fallback: logs from today
                 const d = new Date(l.start);
                 const today = new Date();
                 return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
            });
        
        // Map Logs to Blocks (Past)
        let lastLogEnd = new Date(timelineStart);
        
        // Sort logs ASC
        const sortedLogs = [...sessionLogs].sort((a,b) => new Date(a.start).getTime() - new Date(b.start).getTime());
        
        sortedLogs.forEach((log, i) => {
            const start = new Date(log.start);
            const end = new Date(log.end);
            if (end > lastLogEnd) lastLogEnd = end;
            
            const diffMins = (start.getTime() - timelineStart.getTime()) / 60000;
            const durMins = (end.getTime() - start.getTime()) / 60000;
            
            blocks.push({
                id: `log-${i}`, 
                type: log.type === 'work' ? 'log-work' : (log.type === 'break' ? 'log-break' : 'log-pause'),
                startTime: start, 
                endTime: end, 
                durationMinutes: durMins,
                label: log.task ? log.task.name : (log.type === 'work' ? 'Focus' : 'Break'),
                subLabel: log.reason || (log.type === 'allpause' ? 'Paused' : undefined),
                color: log.color,
                topPx: diffMins * pixelsPerMin, 
                heightPx: durMins * pixelsPerMin,
                isPast: true
            });
        });

        // 2. Determine Projection Start
        // Projection starts at NOW.
        let projectionTime = new Date();
        if (projectionTime < timelineStart) projectionTime = timelineStart; 

        // If Timer is Started, we are inside a block.
        let virtualPomoCount = pomodoroCount;
        
        if (timerStarted) {
            // Add current running block
            const remainingMins = workTime / 60; 
            const endTime = new Date(projectionTime.getTime() + remainingMins * 60000);
            
            const currentUnit = flattenedWorkUnits[0]; 
            if (currentUnit) {
                 const diffMins = (projectionTime.getTime() - timelineStart.getTime()) / 60000;
                 blocks.push({
                    id: `current-work`, type: 'work', startTime: projectionTime, endTime: endTime, durationMinutes: remainingMins,
                    label: currentUnit.name, subLabel: 'Current Session', color: currentUnit.color,
                    topPx: diffMins * pixelsPerMin, heightPx: remainingMins * pixelsPerMin
                });
                // Remove first unit from projection list
                flattenedWorkUnits.shift();
                virtualPomoCount++;
                projectionTime = endTime;
                
                // Add Break after this?
                const isLongBreak = virtualPomoCount > 0 && (virtualPomoCount % settings.longBreakInterval === 0);
                const breakDur = isLongBreak ? (settings.longBreakDuration/60) : (settings.shortBreakDuration/60);
                const bEnd = new Date(projectionTime.getTime() + breakDur * 60000);
                const bDiff = (projectionTime.getTime() - timelineStart.getTime()) / 60000;
                blocks.push({
                    id: `current-break-proj`, type: 'break', startTime: projectionTime, endTime: bEnd, durationMinutes: breakDur,
                    label: isLongBreak ? 'Long Break' : 'Short Break',
                    topPx: bDiff * pixelsPerMin, heightPx: breakDur * pixelsPerMin, color: isLongBreak ? '#2dd4bf' : undefined
                });
                projectionTime = bEnd;
            }
        }
        
        // 3. Project Future
        const dailyBreaks = scheduleBreaks.map(b => {
            const [h, m] = b.startTime.split(':').map(Number);
            const start = new Date(timelineStart);
            start.setHours(h, m, 0, 0);
            if (start < timelineStart && h < schH) start.setDate(start.getDate() + 1);
            const end = new Date(start.getTime() + b.duration * 60000);
            return { ...b, start, end };
        });

        // Add Scheduled Breaks (Fixed)
        dailyBreaks.forEach(brk => {
             const diffMins = (brk.start.getTime() - timelineStart.getTime()) / 60000;
             blocks.push({
                id: brk.id, type: 'scheduled-break', startTime: brk.start, endTime: brk.end, durationMinutes: brk.duration, label: brk.label,
                topPx: diffMins * pixelsPerMin, heightPx: brk.duration * pixelsPerMin, color: '#555'
            });
        });

        const advanceTimeIfBreak = (time: Date): Date => {
            let updatedTime = new Date(time);
            let overlap = true;
            while (overlap) {
                overlap = false;
                for (const brk of dailyBreaks) {
                    // If time is inside a break
                    if (updatedTime >= brk.start && updatedTime < brk.end) {
                        updatedTime = new Date(brk.end);
                        overlap = true;
                    }
                }
            }
            return updatedTime;
        };

        flattenedWorkUnits.forEach((unit, index) => {
            projectionTime = advanceTimeIfBreak(projectionTime);
            const workStart = new Date(projectionTime);
            const workDuration = settings.workDuration / 60;
            const diffMins = (workStart.getTime() - timelineStart.getTime()) / 60000;
            
            blocks.push({
                id: `work-proj-${index}`, type: 'work', startTime: workStart, endTime: new Date(workStart.getTime() + workDuration * 60000), durationMinutes: workDuration,
                label: unit.name, subLabel: unit.subtaskName, color: unit.color,
                topPx: diffMins * pixelsPerMin, heightPx: workDuration * pixelsPerMin
            });
            
            projectionTime = new Date(projectionTime.getTime() + workDuration * 60000);
            virtualPomoCount++;
            
            const isLongBreak = virtualPomoCount > 0 && (virtualPomoCount % settings.longBreakInterval === 0);
            const breakDur = isLongBreak ? (settings.longBreakDuration / 60) : (settings.shortBreakDuration / 60);
            
            projectionTime = advanceTimeIfBreak(projectionTime);
            const breakStart = new Date(projectionTime);
            const breakDiffMins = (breakStart.getTime() - timelineStart.getTime()) / 60000;

            blocks.push({
                id: `break-proj-${index}`, type: 'break', startTime: breakStart, endTime: new Date(breakStart.getTime() + breakDur * 60000), durationMinutes: breakDur,
                label: isLongBreak ? 'Long Break' : 'Short Break',
                topPx: breakDiffMins * pixelsPerMin, heightPx: breakDur * pixelsPerMin, color: isLongBreak ? '#2dd4bf' : undefined
            });

            projectionTime = new Date(projectionTime.getTime() + breakDur * 60000);
        });

        const lastBlock = blocks.sort((a,b) => (a.topPx + a.heightPx) - (b.topPx + b.heightPx)).pop();
        const endMins = lastBlock ? (lastBlock.topPx / pixelsPerMin) + lastBlock.durationMinutes : 0;
        const totalHeight = Math.max(1440, endMins + 60) * pixelsPerMin;

        return { blocks, totalHeight, timelineStart };
    }, [scheduleStartTime, sessionStartTime, logs, flattenedWorkUnits, settings, pomodoroCount, scheduleBreaks, pixelsPerMin, timerStarted, workTime]);

    useEffect(() => {
        if (isOpen && calendarRef.current) {
            // Scroll to NOW
            const now = new Date();
            const start = timelineData.timelineStart;
            const diffMins = (now.getTime() - start.getTime()) / 60000;
            const top = diffMins * pixelsPerMin;
            // Add slight delay to ensure layout
            setTimeout(() => {
                calendarRef.current?.scrollTo({ top: Math.max(0, top - 200), behavior: 'smooth' });
            }, 100);
        }
    }, [isOpen]); 

    const onDragStart = (e: React.DragEvent, type: 'task' | 'subtask', id: number, parentId?: number) => {
        e.stopPropagation();
        setDraggedId({ type, id, parentId });
    };

    const onDragOver = (e: React.DragEvent, id: number, type: 'task' | 'subtask', parentId?: number) => {
        e.preventDefault();
        e.stopPropagation();
        if (!draggedId) return;
        setDropTargetId({ id, parentId, type });
    };

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!draggedId || !dropTargetId) return;

        if (draggedId.type === 'task' && dropTargetId.type === 'task') {
            if (draggedId.id !== dropTargetId.id) moveTask(draggedId.id, dropTargetId.id);
        } else if (draggedId.type === 'subtask') {
             if (draggedId.parentId === undefined) return;
             if (dropTargetId.type === 'task') moveSubtask(draggedId.parentId, dropTargetId.id, draggedId.id, null);
             else moveSubtask(draggedId.parentId, dropTargetId.parentId!, draggedId.id, dropTargetId.id);
        }
        setDraggedId(null);
        setDropTargetId(null);
    };

    const handleAddSubtaskToForm = () => {
        if (!subInputName.trim()) return;
        setNewSubtasks(prev => [...prev, { name: subInputName, est: subInputEst }]);
        setSubInputName('');
        setSubInputEst(1);
    };

    const handleCreateTask = () => {
        if (!newTaskName.trim()) return;
        const subTaskObjects = newSubtasks.map(s => ({
            id: Date.now() + Math.random(), name: s.name, estimated: s.est, completed: 0, checked: false, selected: false, categoryId: null, subtasks: [], isExpanded: false
        }));
        addDetailedTask({ name: newTaskName, estimated: newTaskEst, color: newTaskColor, subtasks: subTaskObjects });
        setNewTaskName(''); setNewTaskEst(2); setNewSubtasks([]); setIsCreating(false);
    };

    const handleAddBreak = () => {
        let h = parseInt(breakHourStr);
        const m = parseInt(breakMinStr);
        if (isNaN(h) || isNaN(m)) return;
        if (breakAmPm === 'PM' && h !== 12) h += 12;
        if (breakAmPm === 'AM' && h === 12) h = 0;
        const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        addScheduleBreak({ id: Date.now().toString(), startTime: timeStr, duration: breakDuration, label: breakLabel });
        setIsAddingBreak(false);
        setBreakLabel('Lunch');
    };

    const formatTime12 = (h: number, m: number = 0) => {
        const ampm = h >= 12 ? 'PM' : 'AM';
        const hour12 = h % 12 || 12;
        return `${hour12}:${m.toString().padStart(2, '0')} ${ampm}`;
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fade-in" onClick={onClose}>
             <div className="w-full max-w-7xl h-[90vh] bg-[#0F0F11] rounded-[2.5rem] shadow-2xl border border-white/10 flex flex-col md:flex-row overflow-hidden relative" onClick={e => e.stopPropagation()}>
                {/* Priority Queue (Left) */}
                <div className="w-full md:w-4/12 bg-[#141416] border-r border-white/5 flex flex-col relative z-10">
                    <div className="h-16 px-6 border-b border-white/5 flex items-center justify-between bg-[#18181a] shrink-0">
                        <h2 className="text-white/80 font-bold uppercase tracking-widest text-xs">Priority Queue</h2>
                        <button onClick={() => setIsCreating(!isCreating)} className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-2 border border-transparent ${isCreating ? 'bg-red-500/20 text-red-200' : 'bg-white/10 text-white'}`}>{isCreating ? 'Cancel' : '+ Task'}</button>
                    </div>
                    {/* Creator Form */}
                    <div className={`overflow-hidden transition-all duration-500 ease-in-out bg-[#1c1c1e] ${isCreating ? 'max-h-[600px] opacity-100 border-b border-white/5' : 'max-h-0 opacity-0'}`}>
                         <div className="p-5 space-y-4">
                             <div>
                                 <label className="text-white/40 text-[10px] uppercase font-bold mb-1 block">Task Name</label>
                                 <input autoFocus={isCreating} type="text" placeholder="e.g. Civil Procedure" className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-white/30" value={newTaskName} onChange={e => setNewTaskName(e.target.value)} />
                             </div>
                             <div className="flex gap-4">
                                 <div className="flex-1">
                                     <label className="text-white/40 text-[10px] uppercase font-bold mb-1 block">Color</label>
                                     <div className="flex gap-1.5 items-center">{PRESET_COLORS.map(c => (<button key={c} onClick={() => setNewTaskColor(c)} className={`w-5 h-5 rounded-full transition-transform ${newTaskColor === c ? 'ring-1 ring-white scale-110' : 'opacity-40 hover:opacity-100'}`} style={{ backgroundColor: c }} />))}</div>
                                 </div>
                                 <div className="w-20">
                                    <label className="text-white/40 text-[10px] uppercase font-bold mb-1 block">Pomos</label>
                                    <input type="number" min="1" max="99" value={newTaskEst} onChange={e => setNewTaskEst(Number(e.target.value))} className="w-full bg-black/20 border border-white/10 rounded-xl px-2 py-2 text-white text-sm text-center outline-none focus:border-white/30" />
                                 </div>
                             </div>
                             <div className="pt-2 border-t border-white/5">
                                 <div className="flex gap-2 mb-2">
                                     <input type="text" placeholder="Add subtask..." className="flex-1 bg-black/20 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none" value={subInputName} onChange={e => setSubInputName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddSubtaskToForm()} />
                                      <input type="number" min="1" max="10" className="w-8 bg-black/20 border border-white/10 rounded-lg px-1 text-center text-xs text-white outline-none" value={subInputEst} onChange={e => setSubInputEst(Number(e.target.value))} />
                                     <button onClick={handleAddSubtaskToForm} className="px-2 bg-white/10 hover:bg-white/20 rounded-lg text-white text-xs">+</button>
                                 </div>
                                 {newSubtasks.length > 0 && (<div className="space-y-1 max-h-24 overflow-y-auto custom-scrollbar">{newSubtasks.map((sub, i) => (<div key={i} className="flex justify-between items-center bg-white/5 px-2 py-1 rounded border border-white/5"><span className="text-xs text-white/70">{sub.name} ({sub.est})</span><button onClick={() => setNewSubtasks(p => p.filter((_, idx) => idx !== i))} className="text-white/20 hover:text-red-400">×</button></div>))}</div>)}
                             </div>
                             <button onClick={handleCreateTask} className="w-full py-3 bg-white text-black text-xs font-bold uppercase tracking-widest rounded-xl hover:bg-gray-200 active:scale-95 transition-all">Add to Queue</button>
                         </div>
                    </div>
                    {/* Task List */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2 relative">
                        {tasks.filter(t => !t.checked).map((task, index) => {
                            const isSplitting = splittingTaskId === task.id;
                            const isDragged = draggedId?.type === 'task' && draggedId.id === task.id;
                            const isDropTarget = dropTargetId?.type === 'task' && dropTargetId.id === task.id;
                            return (
                                <div key={task.id} className="transition-all duration-300 ease-out" style={{opacity: isDragged ? 0.3 : 1}}>
                                    <div 
                                        draggable 
                                        onDragStart={(e) => onDragStart(e, 'task', task.id)} 
                                        onDragOver={(e) => onDragOver(e, task.id, 'task')} 
                                        onDrop={onDrop} 
                                        className={`relative rounded-xl border transition-all duration-200 group overflow-hidden bg-[#1c1c1e] ${isDropTarget ? 'border-white/50 scale-[1.02]' : 'border-white/5 hover:border-white/20'}`}
                                    >
                                        <div className="absolute left-0 top-0 bottom-0 w-1.5 transition-colors" style={{ backgroundColor: task.color || '#BA4949' }} />
                                        <div className="pl-4 pr-3 py-3">
                                            <div className="flex justify-between items-center cursor-grab active:cursor-grabbing">
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-bold text-white/90 truncate">{task.name}</div>
                                                    <div className="text-[10px] text-white/40 font-mono flex items-center gap-2 mt-0.5"><span>{task.estimated - task.completed} left</span>{task.subtasks.length > 0 && <span className="text-white/20">• {task.subtasks.length} sub</span>}</div>
                                                </div>
                                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                     {(task.estimated - task.completed > 1) && (<button onClick={() => { setSplittingTaskId(isSplitting ? null : task.id); setSplitValue(Math.floor((task.estimated - task.completed) / 2)); }} className={`p-1.5 rounded hover:bg-white/10 text-white/30 hover:text-white`}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M9 21H4v-5"/></svg></button>)}
                                                     <button onClick={() => deleteTask(task.id)} className="p-1.5 text-white/30 hover:text-red-400 rounded hover:bg-white/10"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                                                </div>
                                            </div>
                                            {isSplitting && (<div className="mt-2 pt-2 border-t border-white/5 flex justify-between items-center animate-slide-up"><span className="text-[10px] text-white/50 uppercase font-bold">Split at</span><div className="flex items-center gap-2"><button onClick={() => setSplitValue(v => Math.max(1, v-1))} className="w-5 h-5 flex items-center justify-center bg-white/10 rounded text-white">-</button><span className="text-xs font-mono text-white">{splitValue}</span><button onClick={() => setSplitValue(v => Math.min(task.estimated - task.completed - 1, v+1))} className="w-5 h-5 flex items-center justify-center bg-white/10 rounded text-white">+</button></div><button onClick={() => { splitTask(task.id, splitValue); setSplittingTaskId(null); }} className="px-2 py-1 bg-white text-black text-[10px] font-bold rounded">OK</button></div>)}
                                            {task.subtasks.length > 0 && (
                                                <div className="mt-2 space-y-1">
                                                     {task.subtasks.map((sub) => (
                                                        <div 
                                                            key={sub.id} 
                                                            className={`pl-2 py-1 rounded text-xs text-white/60 hover:bg-white/5 cursor-grab flex justify-between group/sub transition-all duration-200 ${(dropTargetId?.id === sub.id) ? 'bg-white/10' : ''}`} 
                                                            draggable 
                                                            onDragStart={(e) => onDragStart(e, 'subtask', sub.id, task.id)} 
                                                            onDragOver={(e) => onDragOver(e, sub.id, 'subtask', task.id)} 
                                                            onDrop={onDrop}
                                                        >
                                                            <span>{sub.name} ({sub.estimated})</span>
                                                        </div>
                                                     ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Schedule (Right) */}
                <div className="flex-1 flex flex-col bg-[#0F0F11] relative z-0">
                    <div className="h-16 px-8 border-b border-white/5 flex items-center justify-between bg-[#141416] shadow-xl shrink-0">
                        <div className="flex items-center gap-4">
                            <h2 className="text-lg font-bold text-white tracking-tight">Schedule</h2>
                            
                            {/* Start Time Input */}
                            <div className="flex items-center gap-1 bg-black/30 border border-white/5 rounded px-2 py-1">
                                <span className="text-[10px] font-bold text-white/30 mr-1 uppercase">Start</span>
                                <input type="text" maxLength={2} value={stHourStr} onChange={e => setStHourStr(e.target.value.replace(/\D/g,''))} className="bg-transparent text-xs text-white outline-none w-5 text-center font-mono" />
                                <span className="text-white/30">:</span>
                                <input type="text" maxLength={2} value={stMinStr} onChange={e => setStMinStr(e.target.value.replace(/\D/g,''))} className="bg-transparent text-xs text-white outline-none w-5 text-center font-mono" />
                                <button onClick={() => setStAmPm(p => p === 'AM' ? 'PM' : 'AM')} className="ml-1 px-1 py-0.5 rounded bg-white/10 text-[9px] font-bold text-white hover:bg-white/20">{stAmPm}</button>
                            </div>
                            
                            {/* Zoom Slider */}
                             <div className="flex items-center gap-2 ml-4">
                                <span className="text-[9px] font-bold text-white/30 uppercase">Zoom</span>
                                <input type="range" min="1" max="6" step="0.5" value={pixelsPerMin} onChange={e => setPixelsPerMin(Number(e.target.value))} className="w-20 accent-white/50 h-1 bg-white/10 rounded-full appearance-none cursor-pointer" />
                             </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <button onClick={() => setIsAddingBreak(!isAddingBreak)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border border-white/10 hover:bg-white/5 text-white/60 hover:text-white transition-colors ${isAddingBreak ? 'bg-white/10 text-white' : ''}`}>+ Add Break</button>
                            <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-white/40 hover:text-white flex items-center justify-center transition-all">✕</button>
                        </div>
                    </div>
                    {isAddingBreak && (
                        <div className="absolute top-16 left-0 right-0 z-20 bg-[#1c1c1e] border-b border-white/10 p-4 flex items-center justify-center gap-4 animate-slide-up shadow-2xl">
                            <input autoFocus value={breakLabel} onChange={e => setBreakLabel(e.target.value)} className="bg-black/30 border border-white/10 rounded px-3 py-2 text-sm text-white outline-none w-32 focus:border-white/40" placeholder="Label" />
                            <div className="flex items-center gap-1 bg-black/30 border border-white/10 rounded px-2 py-1">
                                <input type="text" maxLength={2} value={breakHourStr} onChange={e => setBreakHourStr(e.target.value.replace(/\D/g,''))} className="bg-transparent text-sm text-white outline-none w-8 text-center" placeholder="HH" />
                                <span className="text-white/50">:</span>
                                <input type="text" maxLength={2} value={breakMinStr} onChange={e => setBreakMinStr(e.target.value.replace(/\D/g,''))} className="bg-transparent text-sm text-white outline-none w-8 text-center" placeholder="MM" />
                                <button onClick={() => setBreakAmPm(p => p === 'AM' ? 'PM' : 'AM')} className="ml-1 px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-bold text-white hover:bg-white/20">{breakAmPm}</button>
                            </div>
                            <div className="flex items-center gap-2"><input type="text" value={breakDuration} onChange={e => setBreakDuration(Number(e.target.value.replace(/\D/g,'')))} className="bg-black/30 border border-white/10 rounded px-3 py-2 text-sm text-white outline-none w-16 focus:border-white/40" /><span className="text-xs text-white/50">min</span></div>
                            <button onClick={handleAddBreak} className="px-4 py-2 bg-white text-black text-xs font-bold rounded hover:bg-gray-200 uppercase tracking-wider">Add</button>
                        </div>
                    )}
                    <div ref={calendarRef} className="flex-1 overflow-y-auto custom-scrollbar relative bg-[#0F0F11]">
                        <div className="relative w-full" style={{ height: timelineData.totalHeight }}>
                            {/* Grid Lines */}
                            {Array.from({ length: Math.ceil(timelineData.totalHeight / (60 * pixelsPerMin)) + 1 }).map((_, i) => {
                                const totalMins = i * 60;
                                const timeDate = new Date(timelineData.timelineStart);
                                timeDate.setMinutes(timeDate.getMinutes() + totalMins);
                                return (<div key={i} className="absolute left-0 right-0 border-t border-white/5 flex items-start pointer-events-none" style={{ top: totalMins * pixelsPerMin }}><div className="w-16 pl-4 pt-2 text-[10px] font-mono text-white/30 select-none">{formatTime12(timeDate.getHours(), timeDate.getMinutes())}</div></div>);
                            })}
                            
                            {/* Now Line */}
                            {(() => {
                                const now = new Date();
                                const diff = (now.getTime() - timelineData.timelineStart.getTime()) / 60000;
                                if (diff >= 0) {
                                    return <div className="absolute left-0 right-0 border-t-2 border-red-500 z-20 pointer-events-none" style={{ top: diff * pixelsPerMin }}><div className="absolute right-2 -top-2.5 bg-red-500 text-black text-[9px] font-bold px-1 rounded">NOW</div></div>
                                }
                                return null;
                            })()}

                            {/* Blocks */}
                            {timelineData.blocks.map((block) => {
                                const isWork = block.type === 'work' || block.type === 'log-work';
                                const isBreak = block.type === 'break' || block.type === 'log-break' || block.type === 'log-pause';
                                const isScheduled = block.type === 'scheduled-break';
                                const isPast = block.isPast;
                                
                                let bgClass = '';
                                let borderClass = '';
                                if (block.type === 'log-work') { bgClass = 'bg-blue-900/30'; borderClass = 'border-blue-500/30'; }
                                else if (block.type === 'log-break') { bgClass = 'bg-teal-900/30'; borderClass = 'border-teal-500/30'; }
                                else if (block.type === 'log-pause') { bgClass = 'bg-gray-800/50'; borderClass = 'border-white/10'; }
                                else if (isWork) { bgClass = 'bg-[#1c1c1e]'; borderClass = 'border-white/10'; }
                                else if (isScheduled) { bgClass = 'bg-[#222]'; borderClass = 'border-white/5'; }
                                else { bgClass = 'bg-[#152e2e]'; borderClass = 'border-teal-500/20'; }

                                return (
                                    <div key={block.id} className={`absolute left-16 right-4 rounded-lg border shadow-sm overflow-hidden transition-all hover:z-30 hover:shadow-lg flex flex-col justify-center px-4 ${bgClass} ${borderClass} ${isPast ? 'opacity-80 grayscale-[0.3]' : ''}`} style={{ top: block.topPx, height: Math.max(2, block.heightPx - 1), borderLeftWidth: '4px', borderLeftColor: block.color || (isBreak ? '#2dd4bf' : '#555') }}>
                                        <div className="flex justify-between items-start">
                                            <div className="flex flex-col overflow-hidden leading-tight">
                                                <span className={`text-xs font-bold truncate ${isWork ? 'text-white' : 'text-white/70'} ${isPast ? 'line-through decoration-white/30' : ''}`}>{block.label}</span>
                                                {block.subLabel && <span className="text-[9px] text-white/40 truncate">{block.subLabel}</span>}
                                            </div>
                                            <div className="text-[9px] font-mono text-white/30 pl-2 flex-shrink-0">{formatTime12(block.startTime.getHours(), block.startTime.getMinutes())} - {formatTime12(block.endTime.getHours(), block.endTime.getMinutes())}</div>
                                        </div>
                                        {isScheduled && (<button onClick={(e) => { e.stopPropagation(); deleteScheduleBreak(block.id); }} className="absolute top-1 right-1 p-1 text-white/20 hover:text-red-400">✕</button>)}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
             </div>
        </div>
    );
};

export default TaskViewModal;
