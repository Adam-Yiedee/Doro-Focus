

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
    type: 'work' | 'break' | 'scheduled-break' | 'log-work' | 'log-break' | 'log-pause' | 'past-session' | 'future-task';
    startTime: Date;
    endTime: Date;
    durationMinutes: number;
    label: string;
    subLabel?: string;
    color?: string;
    topPx: number;
    heightPx: number;
    isPast?: boolean;
    taskId?: number;
}

const PRESET_COLORS = [
  '#BA4949', '#38858a', '#397097', '#8c5e32', '#7a5c87', '#547a59'
];

const GripIcon = () => (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
        <circle cx="2" cy="2" r="1.5" />
        <circle cx="2" cy="8" r="1.5" />
        <circle cx="2" cy="14" r="1.5" />
        <circle cx="8" cy="2" r="1.5" />
        <circle cx="8" cy="8" r="1.5" />
        <circle cx="8" cy="14" r="1.5" />
    </svg>
);

const TaskViewModal: React.FC<{ isOpen: boolean, onClose: () => void }> = ({ isOpen, onClose }) => {
    const { tasks, pastSessions, settings, pomodoroCount, logs, workTime, timerStarted, moveTask, moveSubtask, addDetailedTask, splitTask, deleteTask, scheduleBreaks, addScheduleBreak, deleteScheduleBreak, scheduleStartTime, setScheduleStartTime, sessionStartTime, activeMode, toggleTaskFuture, setTaskSchedule } = useTimer();
    
    // UI State
    const [mobileTab, setMobileTab] = useState<'queue' | 'schedule' | 'backlog'>('schedule');

    // Start Time State
    const [stHourStr, setStHourStr] = useState('08');
    const [stMinStr, setStMinStr] = useState('00');
    const [stAmPm, setStAmPm] = useState<'AM'|'PM'>('AM');

    const [isCreating, setIsCreating] = useState(false);
    const [isFuture, setIsFuture] = useState(false);
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

    // Drag and Drop State (Positional)
    const [dragState, setDragState] = useState<{ type: 'task' | 'subtask' | 'future-task', id: number, parentId?: number } | null>(null);
    const [dropTarget, setDropTarget] = useState<{ id: number, position: 'top' | 'bottom', type: 'task' | 'subtask', parentId?: number } | null>(null);

    const calendarRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            // Determine Start Time: Use Session Start if active, otherwise Current Time
            let targetTime = scheduleStartTime;
            
            if (!sessionStartTime) {
                 const now = new Date();
                 const h = now.getHours().toString().padStart(2, '0');
                 const m = now.getMinutes().toString().padStart(2, '0');
                 targetTime = `${h}:${m}`;
                 setScheduleStartTime(targetTime); 
            } else {
                 const d = new Date(sessionStartTime);
                 targetTime = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
            }
            
            const [hStr, mStr] = targetTime.split(':');
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
    }, [isOpen]); 

    // Center view helper
    const centerView = () => {
        if (calendarRef.current) {
            const now = new Date();
            const start = timelineData.timelineStart;
            const diffMins = (now.getTime() - start.getTime()) / 60000;
            const top = diffMins * pixelsPerMin;
            calendarRef.current.scrollTo({ top: Math.max(0, top - 200), behavior: 'smooth' });
        }
    };

    const updateScheduleStart = () => {
        // Only allow updating schedule start if no session is running
        if(sessionStartTime) return; 

        let h = parseInt(stHourStr);
        const m = parseInt(stMinStr);
        if (isNaN(h) || isNaN(m)) return;
        if (stAmPm === 'PM' && h !== 12) h += 12;
        if (stAmPm === 'AM' && h === 12) h = 0;
        setScheduleStartTime(`${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`);
    };

    useEffect(() => {
        const t = setTimeout(updateScheduleStart, 800);
        return () => clearTimeout(t);
    }, [stHourStr, stMinStr, stAmPm]);

    const activeTasks = tasks.filter(t => !t.isFuture);
    const futureTasks = tasks.filter(t => t.isFuture);
    const scheduledFutureTasks = futureTasks.filter(t => t.scheduledStart);

    const flattenedWorkUnits = useMemo(() => {
        const units: WorkUnit[] = [];
        activeTasks.forEach(task => {
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
    }, [activeTasks]);
    
    const timelineData = useMemo(() => {
        const blocks: TimeBlock[] = [];
        const [schH, schM] = scheduleStartTime.split(':').map(Number);
        
        let timelineStart = new Date();
        timelineStart.setHours(schH, schM, 0, 0);
        
        // --- 1. Past Sessions (Background) ---
        pastSessions.forEach(session => {
            const start = new Date(session.startTime);
            const end = new Date(session.endTime);
            if (Math.abs(start.getTime() - timelineStart.getTime()) < 86400000) {
                 const diffMins = (start.getTime() - timelineStart.getTime()) / 60000;
                 const durMins = (end.getTime() - start.getTime()) / 60000;
                 blocks.push({
                     id: `past-${session.id}`,
                     type: 'past-session',
                     startTime: start, endTime: end, durationMinutes: durMins,
                     label: 'Past Session', subLabel: `${session.stats.pomosCompleted} Pomos`,
                     topPx: diffMins * pixelsPerMin, heightPx: durMins * pixelsPerMin,
                     color: '#333'
                 });
            }
        });

        // --- 2. Activity Logs ---
        const relevantLogs = logs.filter(l => {
             const d = new Date(l.start);
             const today = new Date();
             const isToday = d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
             const isSession = sessionStartTime && l.start >= sessionStartTime;
             return isToday || isSession;
        });
        
        if (relevantLogs.length > 0) {
            const earliestLog = relevantLogs.reduce((a, b) => new Date(a.start) < new Date(b.start) ? a : b);
            if (new Date(earliestLog.start) < timelineStart) {
                const newStart = new Date(earliestLog.start);
                newStart.setMinutes(0, 0, 0);
                timelineStart = newStart;
            }
        }
        
        let lastLogEnd = new Date(timelineStart);
        const sortedLogs = [...relevantLogs].sort((a,b) => new Date(a.start).getTime() - new Date(b.start).getTime());
        
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

        // --- 3. Scheduled Future Tasks ---
        scheduledFutureTasks.forEach(t => {
            if (!t.scheduledStart) return;
            const [h, m] = t.scheduledStart.split(':').map(Number);
            const start = new Date(timelineStart);
            start.setHours(h, m, 0, 0);
            
            // If time is earlier than timelineStart's hour but likely meant for today (e.g. late night), adjust day? 
            // For now assume same day or next day if past.
            if (start < timelineStart && h < schH) start.setDate(start.getDate() + 1);

            // Duration: Estimated Pomos * Work Duration + Breaks
            const pomos = Math.max(1, t.estimated - t.completed);
            const totalWorkMins = pomos * (settings.workDuration / 60);
            const totalBreakMins = (pomos - 1) * (settings.shortBreakDuration / 60); // simplified
            const totalDur = totalWorkMins + totalBreakMins;

            const diffMins = (start.getTime() - timelineStart.getTime()) / 60000;
            
            blocks.push({
                id: `future-${t.id}`,
                taskId: t.id,
                type: 'future-task',
                startTime: start,
                endTime: new Date(start.getTime() + totalDur * 60000),
                durationMinutes: totalDur,
                label: t.name,
                subLabel: 'Scheduled Task',
                color: t.color,
                topPx: diffMins * pixelsPerMin,
                heightPx: totalDur * pixelsPerMin
            });
        });

        // Projection logic
        let projectionTime = new Date();
        if (lastLogEnd > projectionTime) projectionTime = lastLogEnd;
        if (projectionTime < timelineStart) projectionTime = timelineStart; 

        let virtualPomoCount = pomodoroCount;
        const workQueue = [...flattenedWorkUnits];
        
        if (timerStarted && activeMode === 'work') {
            const remainingMins = workTime / 60; 
            const endTime = new Date(projectionTime.getTime() + remainingMins * 60000);
            
            const currentUnit = workQueue[0]; 
            if (currentUnit) {
                 const diffMins = (projectionTime.getTime() - timelineStart.getTime()) / 60000;
                 blocks.push({
                    id: `current-work`, type: 'work', startTime: projectionTime, endTime: endTime, durationMinutes: remainingMins,
                    label: currentUnit.name, subLabel: 'Current Session', color: currentUnit.color,
                    topPx: diffMins * pixelsPerMin, heightPx: remainingMins * pixelsPerMin
                });
                workQueue.shift();
                virtualPomoCount++;
                projectionTime = endTime;
                
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
        
        // Scheduled Fixed Breaks
        const dailyBreaks = scheduleBreaks.map(b => {
            const [h, m] = b.startTime.split(':').map(Number);
            const start = new Date(timelineStart);
            start.setHours(h, m, 0, 0);
            if (start < timelineStart && h < schH) start.setDate(start.getDate() + 1);
            const end = new Date(start.getTime() + b.duration * 60000);
            return { ...b, start, end };
        });

        dailyBreaks.forEach(brk => {
             const diffMins = (brk.start.getTime() - timelineStart.getTime()) / 60000;
             blocks.push({
                id: brk.id, type: 'scheduled-break', startTime: brk.start, endTime: brk.end, durationMinutes: brk.duration, label: brk.label,
                topPx: diffMins * pixelsPerMin, heightPx: brk.duration * pixelsPerMin, color: '#555'
            });
        });

        // Function to advance projection past breaks AND scheduled future tasks
        const advanceTimeIfBlocked = (time: Date): Date => {
            let updatedTime = new Date(time);
            let overlap = true;
            while (overlap) {
                overlap = false;
                // Check Schedule Breaks
                for (const brk of dailyBreaks) {
                    if (updatedTime >= brk.start && updatedTime < brk.end) {
                        updatedTime = new Date(brk.end);
                        overlap = true;
                    }
                }
                // Check Future Tasks (Treat them as blocks that push the queue)
                for (const ft of blocks.filter(b => b.type === 'future-task')) {
                    if (updatedTime >= ft.startTime && updatedTime < ft.endTime) {
                         updatedTime = new Date(ft.endTime);
                         overlap = true;
                    }
                }
            }
            return updatedTime;
        };

        // Project remaining tasks
        workQueue.forEach((unit, index) => {
            projectionTime = advanceTimeIfBlocked(projectionTime);
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
            
            projectionTime = advanceTimeIfBlocked(projectionTime);
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
    }, [scheduleStartTime, sessionStartTime, logs, flattenedWorkUnits, settings, pomodoroCount, scheduleBreaks, pixelsPerMin, timerStarted, workTime, activeMode, pastSessions, futureTasks]);

    useEffect(() => {
        if (isOpen && calendarRef.current) {
            setTimeout(centerView, 100);
        }
    }, [isOpen]); 

    // ---- DRAG AND DROP LOGIC (Positional & Timeline) ----
    const onDragStart = (e: React.DragEvent, type: 'task' | 'subtask' | 'future-task', id: number, parentId?: number) => {
        e.dataTransfer.effectAllowed = "move";
        setDragState({ type, id, parentId });
    };

    const onDragOver = (e: React.DragEvent, id: number, type: 'task' | 'subtask', parentId?: number) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (!dragState) return;
        if (dragState.type !== type) return;
        if (dragState.id === id) return; // Ignore self

        const rect = e.currentTarget.getBoundingClientRect();
        const midY = rect.top + (rect.height / 2);
        const position = e.clientY < midY ? 'top' : 'bottom';
        
        setDropTarget({ id, position, type, parentId });
    };

    const onTimelineDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const onTimelineDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (!dragState || !calendarRef.current) return;
        
        // Dropping Task onto Timeline -> Converts to Future Task with Scheduled Time
        if (dragState.type === 'task' || dragState.type === 'future-task') {
             const rect = calendarRef.current.getBoundingClientRect();
             const scrollTop = calendarRef.current.scrollTop;
             const clickY = e.clientY - rect.top + scrollTop;
             const totalMins = clickY / pixelsPerMin;
             
             // Convert to Time String
             const dropTime = new Date(timelineData.timelineStart);
             dropTime.setMinutes(dropTime.getMinutes() + totalMins);
             const h = dropTime.getHours().toString().padStart(2, '0');
             const m = Math.floor(dropTime.getMinutes() / 15) * 15; // Snap to 15m
             const mStr = m.toString().padStart(2, '0');
             const timeStr = `${h}:${mStr}`;
             
             setTaskSchedule(dragState.id, timeStr);
        }
    };

    const onQueueDrop = (e: React.DragEvent) => {
         e.preventDefault();
         e.stopPropagation();
         
         // Dropping from Timeline back to Queue
         if (dragState && dragState.type === 'future-task') {
             toggleTaskFuture(dragState.id); // Removes from future, adds to queue
         }
    };

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (dragState && dropTarget) {
            if (dragState.type === 'task' && dropTarget.type === 'task') {
                if (dropTarget.position === 'top') {
                    moveTask(dragState.id, dropTarget.id);
                } else {
                    const idx = tasks.findIndex(t => t.id === dropTarget.id);
                    if (idx !== -1 && idx < tasks.length - 1) {
                        moveTask(dragState.id, tasks[idx + 1].id);
                    } else {
                        moveTask(dragState.id, -1);
                    }
                }
            } else if (dragState.type === 'subtask' && dropTarget.type === 'subtask') {
                 if (dragState.parentId !== undefined && dropTarget.parentId !== undefined) {
                    const parent = tasks.find(t => t.id === dropTarget.parentId);
                    if (parent) {
                        if (dropTarget.position === 'top') {
                             moveSubtask(dragState.parentId, dropTarget.parentId, dragState.id, dropTarget.id);
                        } else {
                             const sIdx = parent.subtasks.findIndex(s => s.id === dropTarget.id);
                             if (sIdx !== -1 && sIdx < parent.subtasks.length - 1) {
                                  moveSubtask(dragState.parentId, dropTarget.parentId, dragState.id, parent.subtasks[sIdx+1].id);
                             } else {
                                  moveSubtask(dragState.parentId, dropTarget.parentId, dragState.id, null);
                             }
                        }
                    }
                 }
            }
        }
        
        setDragState(null);
        setDropTarget(null);
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
        addDetailedTask({ name: newTaskName, estimated: newTaskEst, color: newTaskColor, subtasks: subTaskObjects, isFuture });
        setNewTaskName(''); setNewTaskEst(2); setNewSubtasks([]); setIsCreating(false); setIsFuture(false);
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 md:p-4 bg-black/80 backdrop-blur-xl animate-fade-in" onClick={onClose}>
             <div className="w-full max-w-7xl h-[95vh] md:h-[90vh] bg-[#0F0F11] rounded-2xl md:rounded-[2.5rem] shadow-2xl border border-white/10 flex flex-col md:flex-row overflow-hidden relative" onClick={e => e.stopPropagation()}>
                
                {/* Mobile Tab Switcher */}
                <div className="md:hidden shrink-0 flex border-b border-white/10">
                     <button 
                        onClick={() => setMobileTab('schedule')} 
                        className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest ${mobileTab === 'schedule' ? 'bg-[#18181a] text-white' : 'text-white/40'}`}
                     >
                         Schedule
                     </button>
                     <button 
                        onClick={() => setMobileTab('queue')} 
                        className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest ${mobileTab === 'queue' ? 'bg-[#18181a] text-white' : 'text-white/40'}`}
                     >
                         Queue
                     </button>
                     <button 
                        onClick={() => setMobileTab('backlog')} 
                        className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest ${mobileTab === 'backlog' ? 'bg-[#18181a] text-white' : 'text-white/40'}`}
                     >
                         Backlog
                     </button>
                     <button onClick={onClose} className="px-4 text-white/40 hover:text-white">✕</button>
                </div>

                {/* Priority Queue (Left) - Hidden on Mobile unless tab selected */}
                <div 
                    className={`w-full md:w-4/12 bg-[#141416] border-r border-white/5 flex flex-col relative z-10 ${mobileTab !== 'schedule' ? 'flex' : 'hidden md:flex'}`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={onQueueDrop}
                >
                    <div className="h-14 md:h-16 px-4 md:px-6 border-b border-white/5 flex items-center justify-between bg-[#18181a] shrink-0">
                        <div className="flex gap-4">
                            <button onClick={() => setMobileTab('queue')} className={`uppercase tracking-widest text-xs font-bold ${mobileTab === 'queue' || mobileTab === 'schedule' ? 'text-white' : 'text-white/40'}`}>Queue</button>
                            <button onClick={() => setMobileTab('backlog')} className={`uppercase tracking-widest text-xs font-bold ${mobileTab === 'backlog' ? 'text-white' : 'text-white/40'}`}>Backlog ({futureTasks.length})</button>
                        </div>
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
                             
                             {/* Future Toggle Aesthetic */}
                             <div className="flex items-center justify-between pt-2 border-t border-white/5">
                                 <span className="text-white/40 text-[10px] uppercase font-bold">Add to Backlog</span>
                                 <button onClick={() => setIsFuture(!isFuture)} className={`w-12 h-6 rounded-full p-1 transition-colors relative ${isFuture ? 'bg-purple-500' : 'bg-white/10'}`}>
                                     <div className={`w-4 h-4 bg-white rounded-full transition-transform shadow-sm absolute top-1 ${isFuture ? 'left-7' : 'left-1'}`} />
                                 </button>
                             </div>

                             <button onClick={handleCreateTask} className="w-full py-3 bg-white text-black text-xs font-bold uppercase tracking-widest rounded-xl hover:bg-gray-200 active:scale-95 transition-all">
                                 {isFuture ? 'Add to Backlog' : 'Add to Queue'}
                             </button>
                         </div>
                    </div>
                    {/* Task List */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-4 relative">
                        {(mobileTab === 'backlog' ? futureTasks : activeTasks).map((task, index) => {
                            if (task.checked) {
                                return (
                                    <div key={task.id} className="relative rounded-xl border border-white/5 bg-black/20 p-3 opacity-40 group mb-2">
                                        <div className="flex justify-between items-center">
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-bold text-white line-through truncate">{task.name}</div>
                                                <div className="text-[10px] text-white/40 font-mono flex items-center gap-2 mt-0.5">
                                                    <span>Completed</span>
                                                </div>
                                            </div>
                                             <button onClick={() => deleteTask(task.id)} className="p-1.5 text-white/30 hover:text-red-400 rounded hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                                        </div>
                                    </div>
                                );
                            }

                            const isSplitting = splittingTaskId === task.id;
                            const isDragged = dragState?.id === task.id;
                            const isDropTarget = dropTarget?.id === task.id;
                            const isTop = dropTarget?.position === 'top';
                            
                            return (
                                <div 
                                    key={task.id} 
                                    className={`transition-all duration-300 ease-out pb-2`}
                                    style={{opacity: isDragged ? 0.3 : 1}}
                                    onDragOver={(e) => onDragOver(e, task.id, 'task')}
                                    onDrop={onDrop}
                                >
                                    <div 
                                        draggable 
                                        onDragStart={(e) => onDragStart(e, task.isFuture ? 'future-task' : 'task', task.id)} 
                                        className={`relative rounded-xl border transition-all duration-200 group overflow-hidden bg-[#1c1c1e] flex flex-col ${isDropTarget ? 'border-blue-500/50' : 'border-white/5 hover:border-white/20'}`}
                                    >
                                        {/* Drop Indicators */}
                                        {isDropTarget && isTop && <div className="absolute top-0 left-0 right-0 h-1 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)] z-50 pointer-events-none" />}
                                        {isDropTarget && !isTop && <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)] z-50 pointer-events-none" />}

                                        <div className="flex w-full">
                                            {/* Drag Handle Area */}
                                            <div className="w-8 cursor-move bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/20 hover:text-white/60 transition-colors border-r border-white/5" onMouseDown={e => e.stopPropagation()}>
                                                <GripIcon />
                                            </div>

                                            <div className="flex-1 min-w-0 relative">
                                                <div className="absolute left-0 top-0 bottom-0 w-1 transition-colors" style={{ backgroundColor: task.color || '#BA4949' }} />
                                                <div className="pl-4 pr-3 py-3">
                                                    <div className="flex justify-between items-center">
                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-sm font-bold text-white/90 truncate select-none">{task.name}</div>
                                                            <div className="text-[10px] text-white/40 font-mono flex items-center gap-2 mt-0.5">
                                                                <span>{task.estimated - task.completed} left</span>
                                                                {task.subtasks.length > 0 && <span className="text-white/20">• {task.subtasks.length} sub</span>}
                                                                {task.scheduledStart && <span className="ml-2 text-purple-300">{task.scheduledStart}</span>}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            {mobileTab === 'backlog' ? (
                                                                <button onClick={() => toggleTaskFuture(task.id)} className="p-1.5 text-white/30 hover:text-green-400 rounded hover:bg-white/10" title="Move to Queue">
                                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                                                                </button>
                                                            ) : (
                                                                <button onClick={() => toggleTaskFuture(task.id)} className="p-1.5 text-white/30 hover:text-purple-400 rounded hover:bg-white/10" title="Move to Backlog">
                                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12h-6m-6 0H5m14-6v12M5 6l14 6-14 6"/></svg>
                                                                </button>
                                                            )}
                                                            {(task.estimated - task.completed > 1) && (<button onClick={() => { setSplittingTaskId(isSplitting ? null : task.id); setSplitValue(Math.floor((task.estimated - task.completed) / 2)); }} className={`p-1.5 rounded hover:bg-white/10 text-white/30 hover:text-white`}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M9 21H4v-5"/></svg></button>)}
                                                            <button onClick={() => deleteTask(task.id)} className="p-1.5 text-white/30 hover:text-red-400 rounded hover:bg-white/10"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                                                        </div>
                                                    </div>
                                                    
                                                    {isSplitting && (<div className="mt-2 pt-2 border-t border-white/5 flex justify-between items-center animate-slide-up"><span className="text-[10px] text-white/50 uppercase font-bold">Split at</span><div className="flex items-center gap-2"><button onClick={() => setSplitValue(v => Math.max(1, v-1))} className="w-5 h-5 flex items-center justify-center bg-white/10 rounded text-white">-</button><span className="text-xs font-mono text-white">{splitValue}</span><button onClick={() => setSplitValue(v => Math.min(task.estimated - task.completed - 1, v+1))} className="w-5 h-5 flex items-center justify-center bg-white/10 rounded text-white">+</button></div><button onClick={() => { splitTask(task.id, splitValue); setSplittingTaskId(null); }} className="px-2 py-1 bg-white text-black text-[10px] font-bold rounded">OK</button></div>)}
                                                    
                                                    {task.subtasks.length > 0 && (
                                                        <div className="mt-2 space-y-1">
                                                            {task.subtasks.map((sub) => {
                                                                const isSubDrop = dropTarget?.id === sub.id && dropTarget?.type === 'subtask';
                                                                const isSubTop = dropTarget?.position === 'top';
                                                                
                                                                return (
                                                                    <div 
                                                                        key={sub.id} 
                                                                        className={`relative pl-2 py-1 rounded text-xs text-white/60 hover:bg-white/5 cursor-grab flex justify-between group/sub transition-all duration-200`} 
                                                                        draggable={!sub.checked}
                                                                        onDragStart={(e) => !sub.checked && onDragStart(e, 'subtask', sub.id, task.id)} 
                                                                        onDragOver={(e) => !sub.checked && onDragOver(e, sub.id, 'subtask', task.id)} 
                                                                        onDrop={onDrop}
                                                                    >
                                                                        {isSubDrop && isSubTop && <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500 z-10" />}
                                                                        {isSubDrop && !isSubTop && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 z-10" />}

                                                                        <span className={sub.checked ? "line-through opacity-50" : ""}>{sub.name} ({sub.estimated})</span>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Schedule (Right) - Hidden on Mobile unless tab selected */}
                <div 
                    className={`flex-1 flex-col bg-[#0F0F11] relative z-0 ${mobileTab === 'schedule' ? 'flex' : 'hidden md:flex'}`}
                    onDragOver={onTimelineDragOver}
                    onDrop={onTimelineDrop}
                >
                    <div className="h-auto md:h-16 py-2 px-4 md:px-8 border-b border-white/5 flex flex-wrap md:flex-nowrap items-center justify-between bg-[#141416] shadow-xl shrink-0 gap-2">
                        <div className="flex items-center gap-2 md:gap-4 flex-wrap">
                            <h2 className="text-lg font-bold text-white tracking-tight mr-2">Schedule</h2>
                            
                            {/* Start Time Input */}
                            <div className={`flex items-center gap-1 bg-black/30 border border-white/5 rounded px-2 py-1 ${sessionStartTime ? 'opacity-50 pointer-events-none' : ''}`}>
                                <span className="text-[10px] font-bold text-white/30 mr-1 uppercase">Start</span>
                                <input type="text" maxLength={2} value={stHourStr} onChange={e => setStHourStr(e.target.value.replace(/\D/g,''))} className="bg-transparent text-xs text-white outline-none w-5 text-center font-mono" />
                                <span className="text-white/30">:</span>
                                <input type="text" maxLength={2} value={stMinStr} onChange={e => setStMinStr(e.target.value.replace(/\D/g,''))} className="bg-transparent text-xs text-white outline-none w-5 text-center font-mono" />
                                <button onClick={() => setStAmPm(p => p === 'AM' ? 'PM' : 'AM')} className="ml-1 px-1 py-0.5 rounded bg-white/10 text-[9px] font-bold text-white hover:bg-white/20">{stAmPm}</button>
                            </div>
                            
                            {/* Zoom Slider - Hidden on small screens */}
                             <div className="hidden md:flex items-center gap-2 ml-4">
                                <span className="text-[9px] font-bold text-white/30 uppercase">Zoom</span>
                                <input type="range" min="1" max="12" step="0.5" value={pixelsPerMin} onChange={e => setPixelsPerMin(Number(e.target.value))} className="w-20 accent-white/50 h-1 bg-white/10 rounded-full appearance-none cursor-pointer" />
                             </div>
                        </div>
                        <div className="flex items-center gap-2 md:gap-4 ml-auto">
                            <button onClick={centerView} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-white/40 hover:text-white flex items-center justify-center transition-all" title="Recenter View">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/></svg>
                            </button>
                            <button onClick={() => setIsAddingBreak(!isAddingBreak)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border border-white/10 hover:bg-white/5 text-white/60 hover:text-white transition-colors ${isAddingBreak ? 'bg-white/10 text-white' : ''}`}>
                                <span className="md:hidden">+</span>
                                <span className="hidden md:inline">+ Add Break</span>
                            </button>
                            <button onClick={onClose} className="hidden md:flex w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-white/40 hover:text-white items-center justify-center transition-all">✕</button>
                        </div>
                    </div>
                    {isAddingBreak && (
                        <div className="absolute top-16 left-0 right-0 z-20 bg-[#1c1c1e] border-b border-white/10 p-4 flex flex-wrap items-center justify-center gap-4 animate-slide-up shadow-2xl">
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
                                return (
                                    <div key={i} className="absolute left-0 right-0 border-t border-white/5 flex items-start pointer-events-none" style={{ top: totalMins * pixelsPerMin }}>
                                        <div className="absolute left-2 -top-3 text-[10px] font-mono text-white/20 select-none">
                                            {formatTime12(timeDate.getHours(), timeDate.getMinutes())}
                                        </div>
                                    </div>
                                );
                            })}
                            
                            {/* Time Blocks */}
                            {timelineData.blocks.map(block => (
                                <div 
                                    key={block.id} 
                                    className={`
                                        absolute left-16 right-4 rounded-lg overflow-hidden border transition-all duration-300 shadow-lg
                                        ${block.type === 'break' ? 'border-teal-500/30 bg-teal-900/10' : ''}
                                        ${block.type === 'work' ? 'bg-[#1c1c1e] hover:brightness-110' : ''}
                                        ${block.type === 'log-work' ? 'border-white/10 bg-[#1c1c1e] opacity-80' : ''}
                                        ${block.type === 'log-break' ? 'border-teal-900/30 bg-teal-900/10 opacity-80' : ''}
                                        ${block.type === 'past-session' ? 'border-none bg-white/5 opacity-30 z-0' : 'z-10'}
                                        ${block.type === 'future-task' ? 'border-purple-500/30 bg-purple-900/10 border-dashed cursor-grab active:cursor-grabbing hover:bg-purple-900/20' : ''}
                                        ${block.type === 'scheduled-break' ? 'border-white/5 bg-[#1a1a1c]' : ''}
                                    `}
                                    style={{ 
                                        top: block.topPx, 
                                        height: block.heightPx, 
                                        borderColor: block.type === 'work' ? block.color || '#333' : undefined,
                                        borderLeftWidth: block.type === 'work' ? 4 : 1,
                                    }}
                                    draggable={block.type === 'future-task'}
                                    onDragStart={(e) => block.type === 'future-task' && block.taskId && onDragStart(e, 'future-task', block.taskId)}
                                >
                                    <div className="p-2 h-full flex flex-col justify-center relative">
                                        {block.type === 'scheduled-break' && (
                                            <button 
                                                onClick={() => deleteScheduleBreak(block.id)} 
                                                className="absolute top-1 right-1 opacity-0 hover:opacity-100 text-white/30 hover:text-red-400 transition-opacity"
                                            >
                                                ×
                                            </button>
                                        )}
                                        <div className="flex justify-between items-baseline">
                                            <span className={`text-xs font-bold truncate ${block.type === 'break' || block.type === 'log-break' ? 'text-teal-200' : 'text-white'}`}>
                                                {block.label}
                                            </span>
                                            <span className="text-[9px] font-mono text-white/30 ml-2 whitespace-nowrap">
                                                {Math.round(block.durationMinutes)}m
                                            </span>
                                        </div>
                                        {block.subLabel && (
                                            <div className="text-[10px] text-white/40 truncate mt-0.5">{block.subLabel}</div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
             </div>
        </div>
    );
};

export default TaskViewModal;