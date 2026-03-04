

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTimer } from '../context/TimerContext';
import { Task } from '../types';
import { getIcon } from '../utils/icons';

const PRESET_COLORS = [
  '#BA4949', // Red
  '#38858a', // Teal
  '#397097', // Blue
  '#8c5e32', // Sienna 
  '#7a5c87', // Purple
  '#547a59', // Green
];

const clampPomoEstimate = (value: number) => {
  if (!Number.isFinite(value)) return 1;
  return Math.min(99, Math.max(1, Math.floor(value)));
};

const clampSubEstimate = (value: number) => {
  if (!Number.isFinite(value)) return 1;
  return Math.min(10, Math.max(0, Math.floor(value)));
};

const getRemainingPomosForTask = (task: Task): number => {
  if (task.checked) return 0;
  if (task.subtasks.length > 0) {
    return task.subtasks.reduce((acc, sub) => acc + getRemainingPomosForTask(sub), 0);
  }
  return Math.max(0, task.estimated - task.completed);
};

const formatFinishTime = (date: Date) => {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const getDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getColorSwatchClass = (selected: boolean, size: 'sm' | 'md' = 'md') => {
  const baseSize = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  return `${baseSize} rounded-full transform-gpu transition-all duration-300 ease-out ${
    selected
      ? 'ring-2 ring-white ring-offset-1 ring-offset-transparent shadow-[0_0_12px_rgba(255,255,255,0.25)] scale-105'
      : 'opacity-75 hover:opacity-100 hover:-translate-y-[1px] hover:scale-110 hover:shadow-[0_0_10px_rgba(255,255,255,0.18)] active:scale-95'
  }`;
};

type DragInsertPosition = 'before' | 'after';

interface TaskItemProps {
  task: Task;
  depth?: number;
  isSectionActive: boolean;
  isEntering?: boolean;
  draggingTaskId?: number | null;
  dropHint?: DragInsertPosition | null;
  onDragStartTask?: (taskId: number) => void;
  onDragHoverTask?: (taskId: number, position: DragInsertPosition) => void;
  onDragEndTask?: () => void;
  registerTaskRef?: (taskId: number, el: HTMLDivElement | null) => void;
}

const TaskItem: React.FC<TaskItemProps> = ({
  task,
  depth = 0,
  isSectionActive,
  isEntering = false,
  draggingTaskId = null,
  dropHint = null,
  onDragStartTask,
  onDragHoverTask,
  onDragEndTask,
  registerTaskRef,
}) => {
  const { updateTask, deleteTask, selectTask, toggleTaskExpansion, addTask, categories } = useTimer();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(task.name);
  const [editEst, setEditEst] = useState(task.estimated);
  const [editColor, setEditColor] = useState(task.color || PRESET_COLORS[0]);
  const [isAddingSub, setIsAddingSub] = useState(false);
  const [subName, setSubName] = useState('');
  const [subEst, setSubEst] = useState(1);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isCheckAnimating, setIsCheckAnimating] = useState(false);
  const removeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkAnimTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (removeTimeoutRef.current) clearTimeout(removeTimeoutRef.current);
      if (checkAnimTimeoutRef.current) clearTimeout(checkAnimTimeoutRef.current);
    };
  }, []);

  const handleCheck = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextChecked = !task.checked;
    if (nextChecked) {
      setIsCheckAnimating(true);
      if (checkAnimTimeoutRef.current) clearTimeout(checkAnimTimeoutRef.current);
      checkAnimTimeoutRef.current = setTimeout(() => setIsCheckAnimating(false), 460);
    }
    updateTask({ ...task, checked: nextChecked });
  };

  const handleSave = () => {
    const safeEst = clampPomoEstimate(editEst);
    updateTask({ ...task, name: editName.trim() || task.name, estimated: safeEst, color: editColor });
    setIsEditing(false);
  };

  const startEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditName(task.name);
    setEditEst(task.estimated);
    setEditColor(task.color || PRESET_COLORS[0]);
    setIsEditing(true);
  };

  const handleAddSubtask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subName.trim()) return;
    addTask(subName, subEst, task.categoryId, task.id);
    setSubName('');
    setSubEst(1);
    setIsAddingSub(false);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRemoving) return;
    setIsRemoving(true);
    removeTimeoutRef.current = setTimeout(() => {
      deleteTask(task.id);
    }, 280);
  };

  const containerMargin = depth === 0 ? 'mb-3' : 'mb-2';
  const category = task.categoryId ? categories.find(c => c.id === task.categoryId) : null;
  const isTopLevel = depth === 0;
  const isDraggedTask = isTopLevel && draggingTaskId === task.id;
  const hoverPushClass = !isDraggedTask && dropHint
    ? (dropHint === 'before' ? 'translate-y-2' : '-translate-y-2')
    : '';

  if (isEditing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
        className={`doro-soft-expand p-3 bg-white/10 rounded-xl ${containerMargin} flex flex-col gap-3 backdrop-blur-md border border-white/20`}
        style={{ marginLeft: depth * 16 }}
      >
        <input
          autoFocus
          value={editName}
          onChange={e => setEditName(e.target.value)}
          className="w-full bg-transparent border-b border-white/30 px-2 py-1 text-glass-text outline-none focus:border-white text-sm"
        />

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/50 font-bold">
            <span>Est</span>
            <div className="flex items-center rounded-lg border border-white/20 bg-black/20 overflow-hidden">
              <button
                type="button"
                onClick={() => setEditEst(prev => clampPomoEstimate(prev - 1))}
                className="px-2.5 py-1 text-white/70 hover:text-white hover:bg-white/10 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_4px_10px_rgba(255,255,255,0.12)] active:translate-y-0 active:scale-95"
                aria-label="Decrease estimate"
              >
                -
              </button>
              <input
                type="text"
                inputMode="numeric"
                value={editEst}
                onChange={e => {
                  const next = Number(e.target.value.replace(/[^\d]/g, ''));
                  if (!Number.isNaN(next)) setEditEst(clampPomoEstimate(next));
                }}
                className="w-10 bg-transparent text-center text-white font-mono font-bold text-xs outline-none"
              />
              <button
                type="button"
                onClick={() => setEditEst(prev => clampPomoEstimate(prev + 1))}
                className="px-2.5 py-1 text-white/70 hover:text-white hover:bg-white/10 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_4px_10px_rgba(255,255,255,0.12)] active:translate-y-0 active:scale-95"
                aria-label="Increase estimate"
              >
                +
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {PRESET_COLORS.map(c => (
              <button
                key={`edit-${task.id}-${c}`}
                type="button"
                onClick={() => setEditColor(c)}
                className={getColorSwatchClass(editColor === c, 'sm')}
                style={{ backgroundColor: c }}
                aria-label={`Set color ${c}`}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className="px-3.5 py-1.5 rounded-lg bg-black/25 hover:bg-black/35 border border-white/20 text-[10px] uppercase tracking-widest font-bold text-white/75 hover:text-white transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_16px_rgba(0,0,0,0.22)] active:translate-y-0 active:scale-95"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-3.5 py-1.5 rounded-lg bg-teal-400/20 hover:bg-teal-300/30 border border-teal-100/35 hover:border-teal-100/60 text-[10px] uppercase tracking-widest font-bold text-teal-50 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_10px_20px_rgba(45,212,191,0.22)] active:translate-y-0 active:scale-95"
          >
            Save
          </button>
        </div>
      </form>
    );
  }

  return (
    <div
      ref={isTopLevel && registerTaskRef ? (node) => registerTaskRef(task.id, node) : undefined}
      draggable={isTopLevel && !isRemoving}
      onDragStart={(event) => {
        if (!isTopLevel || !onDragStartTask) return;
        const dragTarget = event.target as HTMLElement;
        if (dragTarget.closest('button, input, textarea, select, a, form')) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(task.id));
        onDragStartTask(task.id);
      }}
      onDragOver={(event) => {
        if (!isTopLevel || !onDragHoverTask || !draggingTaskId || draggingTaskId === task.id) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const rect = event.currentTarget.getBoundingClientRect();
        const position: DragInsertPosition = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        onDragHoverTask(task.id, position);
      }}
      onDrop={(event) => {
        if (!isTopLevel) return;
        event.preventDefault();
        onDragEndTask?.();
      }}
      onDragEnd={() => {
        if (!isTopLevel) return;
        onDragEndTask?.();
      }}
      className={`
        flex flex-col ${containerMargin} ${depth === 0 ? 'mt-2 cursor-grab active:cursor-grabbing' : ''} relative
        transition-[transform,opacity,filter] duration-300 ease-out
        ${isEntering ? 'doro-task-enter' : ''}
        ${isRemoving ? 'opacity-0 scale-[0.96] -translate-x-2 blur-[2px] pointer-events-none' : 'opacity-100 scale-100 translate-x-0 blur-0'}
      `}
    >
      <div 
        onClick={() => selectTask(task.id)}
        className={`
          group relative rounded-lg cursor-pointer transition-all duration-500 ease-out
          flex items-center gap-3 border
          ${depth === 0 ? 'p-3' : 'p-2.5'}
          ${task.selected && isSectionActive
            ? 'bg-white/20 border-white/30 shadow-lg scale-[1.01] z-20 blur-0 opacity-100' 
            : 'bg-white/5 border-transparent z-10' // Base state
          }
          ${!isSectionActive 
            ? 'opacity-70 hover:opacity-100' 
            : (task.selected ? '' : 'hover:bg-white/10 hover:border-white/10 hover:shadow-md opacity-80 hover:opacity-100')
          }
          ${task.checked ? 'opacity-40' : ''}
          ${isDraggedTask ? 'opacity-45 scale-[0.985] saturate-75' : ''}
          ${hoverPushClass}
          ${isCheckAnimating ? 'scale-[1.015] border-emerald-200/40 bg-emerald-300/10 shadow-[0_12px_30px_-14px_rgba(110,231,183,0.85)]' : ''}
        `}
      >
        {dropHint && !isDraggedTask && (
          <div className={`pointer-events-none absolute left-2 right-2 ${dropHint === 'before' ? 'top-0.5' : 'bottom-0.5'} h-[2px] rounded-full bg-white/75 shadow-[0_0_12px_rgba(255,255,255,0.5)]`} />
        )}
        {task.selected && isSectionActive && <div className="absolute left-0 inset-y-2 w-1 bg-white rounded-r-full shadow-[0_0_10px_rgba(255,255,255,0.5)]" />}
        
        {task.subtasks.length > 0 ? (
          <button 
            onClick={(e) => { e.stopPropagation(); toggleTaskExpansion(task.id); }}
            className="p-1 text-white/40 hover:text-white transition-colors z-20 rounded hover:bg-white/10"
          >
            <svg 
              className={`w-3 h-3 transition-transform duration-300 ${task.isExpanded ? 'rotate-90' : ''}`} 
              fill="currentColor" viewBox="0 0 24 24"
            >
              <path d="M8 5v14l11-7z"/>
            </svg>
          </button>
        ) : (
          <div className="w-3 h-3 px-1" />
        )}

        <div 
          onClick={handleCheck}
          className={`
            rounded-full border relative flex items-center justify-center transition-all duration-300 shrink-0 z-20
            ${depth === 0 ? 'w-5 h-5 border-[1.5px]' : 'w-4 h-4 border'}
            ${task.checked 
              ? 'bg-white border-white' 
              : 'border-white/30 hover:border-white group-hover:bg-white/10'
            }
          `}
        >
          {isCheckAnimating && (
            <span className="absolute inset-[-2px] rounded-full border border-emerald-200/80 animate-ping" />
          )}
          {task.checked && <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="4"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
        </div>
        
        <div className="flex-1 min-w-0 flex flex-col justify-center">
            <div className="flex items-center gap-2">
                <div className={`text-glass-text truncate transition-colors ${task.checked ? 'line-through' : 'group-hover:text-white'} ${depth === 0 ? 'font-medium text-sm' : 'text-xs'}`}>
                    {task.name}
                </div>
                {category && depth === 0 && (
                     <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/10 border border-white/5">
                         <div className="w-3 h-3 text-white" style={{color: category.color}}>
                             {getIcon(category.icon)}
                         </div>
                         <span className="text-[9px] text-white/50 font-bold uppercase">{category.name}</span>
                     </div>
                )}
            </div>
          {task.color && depth === 0 && !task.checked && (
             <div className="w-full max-w-[60px] h-[2px] mt-1.5 rounded-full opacity-60 group-hover:opacity-100 transition-opacity" style={{ backgroundColor: task.color }} />
          )}
        </div>

        <div className="text-glass-textMuted font-mono text-[10px] bg-black/20 px-2 py-0.5 rounded-md backdrop-blur-sm group-hover:bg-black/30 transition-colors border border-white/5">
          <span className={task.completed >= task.estimated ? 'text-green-400 font-bold' : ''}>{task.completed}</span>
          <span className="opacity-40 mx-0.5">/</span>
          <span>{task.estimated}</span>
        </div>

        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-all duration-300">
           <button 
             onClick={(e) => { e.stopPropagation(); setIsAddingSub(true); updateTask({ ...task, isExpanded: true }); }} 
             className="p-1.5 text-glass-text hover:text-white hover:bg-white/10 rounded transition-colors" title="Add Subtask"
           >
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
           </button>
          <button onClick={startEditing} className="p-1.5 text-glass-text hover:text-white hover:bg-white/10 rounded transition-colors" title="Edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button onClick={handleDelete} className="p-1.5 text-glass-text hover:text-red-300 hover:bg-red-500/20 rounded transition-colors" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <div className="pl-6 md:pl-8">
        {isAddingSub && (
          <form onSubmit={handleAddSubtask} className="doro-soft-expand flex gap-2 p-2 mb-2 bg-white/5 rounded-lg border border-white/10 backdrop-blur-sm">
            <input 
              autoFocus
              type="text" 
              placeholder="Subtask..." 
              className="flex-1 bg-transparent px-2 py-0.5 text-xs text-glass-text placeholder-white/30 outline-none"
              value={subName}
              onChange={e => setSubName(e.target.value)}
            />
            <div className="flex items-center rounded-lg border border-white/15 bg-black/20 overflow-hidden">
              <button
                type="button"
                onClick={() => setSubEst(prev => clampSubEstimate(prev - 1))}
                className="px-1.5 py-1 text-white/65 hover:text-white hover:bg-white/12 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_4px_10px_rgba(255,255,255,0.12)] active:translate-y-0 active:scale-95"
                aria-label="Decrease subtask estimate"
              >
                -
              </button>
              <input
                type="text"
                inputMode="numeric"
                value={subEst}
                onChange={e => {
                  const next = Number(e.target.value.replace(/[^\d]/g, ''));
                  if (!Number.isNaN(next)) setSubEst(clampSubEstimate(next));
                }}
                className="w-8 bg-transparent text-center text-xs text-glass-text font-mono font-bold outline-none"
              />
              <button
                type="button"
                onClick={() => setSubEst(prev => clampSubEstimate(prev + 1))}
                className="px-1.5 py-1 text-white/65 hover:text-white hover:bg-white/12 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_4px_10px_rgba(255,255,255,0.12)] active:translate-y-0 active:scale-95"
                aria-label="Increase subtask estimate"
              >
                +
              </button>
            </div>
            <button type="submit" className="text-green-400 px-1 hover:scale-110 transition-transform" aria-label="Save subtask">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </form>
        )}

        {task.isExpanded && task.subtasks.length > 0 && (
          <div className="doro-soft-expand relative border-l border-white/10 pl-4 mt-1 space-y-1">
            {task.subtasks.map(sub => (
              <TaskItem key={sub.id} task={sub} depth={depth + 1} isSectionActive={isSectionActive} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const Tasks: React.FC = () => {
  const { tasks, addTask, moveTask, selectedCategoryId, pomodoroCount, settings, setWeeklyScheduleOpen, categories } = useTimer();
  const [newName, setNewName] = useState('');
  const [newEst, setNewEst] = useState(1);
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [newCatId, setNewCatId] = useState<number | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);
  const [hoverTarget, setHoverTarget] = useState<{ taskId: number; position: DragInsertPosition } | null>(null);
  const [enteringTaskIds, setEnteringTaskIds] = useState<number[]>([]);
  const didInitTaskIdsRef = useRef(false);
  const prevTaskIdsRef = useRef<number[]>([]);
  const taskCardRefsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const previousTaskRectsRef = useRef<Map<number, DOMRect>>(new Map());
  const lastHoverMoveKeyRef = useRef<string | null>(null);

  const todayKey = getDateKey(new Date());

  // Filter Tasks: Hide scheduled/future tasks from main list
  const filteredTasks = tasks.filter(t => 
    !t.isFuture
    && (!t.scheduledDate || t.scheduledDate <= todayKey)
    && (selectedCategoryId ? t.categoryId === selectedCategoryId : true)
  );
  const filteredTaskIds = useMemo(() => filteredTasks.map(task => task.id), [filteredTasks]);
  const filteredTaskOrderKey = useMemo(() => filteredTaskIds.join('|'), [filteredTaskIds]);

  useEffect(() => {
    const currentIds = filteredTasks.map(task => task.id);
    if (!didInitTaskIdsRef.current) {
      didInitTaskIdsRef.current = true;
      prevTaskIdsRef.current = currentIds;
      return;
    }

    const previous = new Set(prevTaskIdsRef.current);
    const addedIds = currentIds.filter(id => !previous.has(id));
    prevTaskIdsRef.current = currentIds;
    if (addedIds.length === 0) return;

    setEnteringTaskIds(prev => Array.from(new Set([...prev, ...addedIds])));
    const timeoutId = setTimeout(() => {
      setEnteringTaskIds(prev => prev.filter(id => !addedIds.includes(id)));
    }, 650);
    return () => clearTimeout(timeoutId);
  }, [filteredTasks]);

  useEffect(() => {
    if (draggingTaskId && !filteredTaskIds.includes(draggingTaskId)) {
      setDraggingTaskId(null);
      setHoverTarget(null);
      lastHoverMoveKeyRef.current = null;
    }
  }, [draggingTaskId, filteredTaskIds]);

  const registerTaskRef = useCallback((taskId: number, node: HTMLDivElement | null) => {
    if (node) taskCardRefsRef.current.set(taskId, node);
    else taskCardRefsRef.current.delete(taskId);
  }, []);

  useLayoutEffect(() => {
    const nextRects = new Map<number, DOMRect>();
    filteredTaskIds.forEach((taskId) => {
      const node = taskCardRefsRef.current.get(taskId);
      if (node) nextRects.set(taskId, node.getBoundingClientRect());
    });

    if (previousTaskRectsRef.current.size === 0) {
      previousTaskRectsRef.current = nextRects;
      return;
    }

    nextRects.forEach((nextRect, taskId) => {
      const prevRect = previousTaskRectsRef.current.get(taskId);
      const node = taskCardRefsRef.current.get(taskId);
      if (!prevRect || !node) return;

      const deltaY = prevRect.top - nextRect.top;
      if (Math.abs(deltaY) < 0.75) return;

      node.style.transition = 'transform 0s';
      node.style.transform = `translateY(${deltaY}px)`;
      requestAnimationFrame(() => {
        node.style.transition = 'transform 300ms cubic-bezier(0.22, 1, 0.36, 1)';
        node.style.transform = 'translateY(0)';
      });
    });

    previousTaskRectsRef.current = nextRects;
  }, [filteredTaskOrderKey, filteredTaskIds]);

  const handleTaskDragStart = useCallback((taskId: number) => {
    setDraggingTaskId(taskId);
    setHoverTarget(null);
    lastHoverMoveKeyRef.current = null;
  }, []);

  const clearDragState = useCallback(() => {
    setDraggingTaskId(null);
    setHoverTarget(null);
    lastHoverMoveKeyRef.current = null;
  }, []);

  const handleTaskDragHover = useCallback((targetTaskId: number, position: DragInsertPosition) => {
    if (!draggingTaskId || draggingTaskId === targetTaskId) return;

    setHoverTarget(prev => (
      prev && prev.taskId === targetTaskId && prev.position === position
        ? prev
        : { taskId: targetTaskId, position }
    ));

    const taskIdsWithoutDragged = filteredTaskIds.filter(id => id !== draggingTaskId);
    const targetIndex = taskIdsWithoutDragged.indexOf(targetTaskId);
    if (targetIndex === -1) return;

    const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
    const toId = insertIndex >= taskIdsWithoutDragged.length ? -1 : taskIdsWithoutDragged[insertIndex];
    const moveKey = `${draggingTaskId}:${toId}`;
    if (lastHoverMoveKeyRef.current === moveKey) return;

    lastHoverMoveKeyRef.current = moveKey;
    moveTask(draggingTaskId, toId);
  }, [draggingTaskId, filteredTaskIds, moveTask]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    addTask(newName, clampPomoEstimate(newEst), newCatId || selectedCategoryId, undefined, newColor);
    setNewName('');
    setNewEst(1);
  };

  const isSectionActive = isHovered || isInputFocused;
  const shouldBlur = !isSectionActive && !settings.disableBlur;
  const blurClass = shouldBlur ? 'blur-[2px] opacity-50' : 'blur-0 opacity-100';
  
  // Pomo Counter Logic
  const pomosPerSet = settings.longBreakInterval || 4;
  const currentInSet = pomodoroCount % pomosPerSet;
  const untilLongBreak = pomosPerSet - currentInSet;
  const remainingTaskPomos = useMemo(
    () => filteredTasks.reduce((acc, task) => acc + getRemainingPomosForTask(task), 0),
    [filteredTasks]
  );
  const predictedFinishTime = useMemo(() => {
    if (remainingTaskPomos <= 0) return '--';

    let totalSeconds = remainingTaskPomos * settings.workDuration;
    for (let i = 1; i < remainingTaskPomos; i++) {
      const completionCount = pomodoroCount + i;
      const breakSeconds = completionCount % pomosPerSet === 0 ? settings.longBreakDuration : settings.shortBreakDuration;
      totalSeconds += breakSeconds;
    }
    return formatFinishTime(new Date(Date.now() + totalSeconds * 1000));
  }, [remainingTaskPomos, settings.workDuration, settings.shortBreakDuration, settings.longBreakDuration, pomodoroCount, pomosPerSet]);

  return (
    <>
      <style>{`
        @keyframes doro-soft-expand {
          0% {
            opacity: 0;
            transform: translateY(6px) scale(0.975);
          }
          62% {
            opacity: 1;
            transform: translateY(-1px) scale(1.015);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .doro-soft-expand {
          animation: doro-soft-expand 380ms cubic-bezier(0.18, 0.9, 0.32, 1.08);
          transform-origin: top center;
        }
        @keyframes doro-task-enter {
          0% {
            opacity: 0;
            transform: translateY(12px) scale(0.96);
            filter: blur(2px);
          }
          62% {
            opacity: 1;
            transform: translateY(-2px) scale(1.012);
            filter: blur(0);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0);
          }
        }
        .doro-task-enter {
          animation: doro-task-enter 540ms cubic-bezier(0.16, 0.88, 0.3, 1.12);
          transform-origin: top center;
        }
        .doro-task-list-drag-active {
          transition: background-color 220ms ease;
        }
      `}</style>
      <div 
        className="w-full max-w-lg mx-auto transition-all duration-700"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
      <div className="relative flex flex-col">
        {/* Header */}
        <div className={`flex justify-between items-center mb-4 px-2 transition-all duration-500 ${blurClass}`}>
          <h2 className="text-[10px] font-bold text-white/50 tracking-[0.2em] uppercase">Task List</h2>
        </div>

        {/* Input Area */}
        <form 
          onSubmit={handleSubmit} 
          className={`
            mb-8 relative group z-30 transition-all duration-500
            ${isInputFocused 
              ? 'scale-100 shadow-xl' 
              : 'scale-[0.98] shadow-none'
            }
            ${blurClass}
          `}
          onFocus={() => setIsInputFocused(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) {
              setIsInputFocused(false);
            }
          }}
        >
          <div className={`
            bg-white/5 rounded-xl border 
            ${!settings.disableBlur ? 'backdrop-blur-xl' : ''}
            ${isInputFocused ? 'border-white/30 bg-white/15' : 'border-white/10 hover:border-white/20 hover:bg-white/10'}
            overflow-hidden transition-all duration-300
          `}>
            <div className="flex items-center p-1.5">
                <input 
                  type="text" 
                  placeholder={isInputFocused ? "Describe task..." : "+ New Task"} 
                  className="flex-1 bg-transparent px-4 py-2 text-glass-text placeholder-white/30 outline-none font-medium text-sm"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                />
                
                 {!isInputFocused && (
                    <button 
                        type="button" 
                        onPointerDown={(e) => {
                            e.preventDefault();
                            setWeeklyScheduleOpen(true);
                        }}
                        onClick={() => setWeeklyScheduleOpen(true)}
                        className="mr-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white rounded-lg text-[10px] uppercase tracking-wider font-bold transition-all border border-transparent hover:border-white/10"
                    >
                        Schedule
                    </button>
                 )}
            </div>
            
            <div className={`
              overflow-hidden transition-all duration-300 ease-in-out border-t border-white/5
              ${isInputFocused ? 'doro-soft-expand max-h-40 opacity-100 py-2 px-4' : 'max-h-0 opacity-0 border-none'}
            `}>
              <div className="flex flex-col gap-3">
                  {/* Category & Color Selection */}
                  <div className="flex items-center gap-2 overflow-x-auto px-1 py-1 scrollbar-hide">
                      <div className="flex gap-1.5">
                          {PRESET_COLORS.map(c => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => { setNewColor(c); setNewCatId(null); }}
                              className={getColorSwatchClass(newColor === c && !newCatId)}
                              style={{ backgroundColor: c }}
                            />
                          ))}
                      </div>
                      
                      {categories.length > 0 && <div className="w-px h-4 bg-white/10 mx-1" />}
                      
                      <div className="flex gap-1">
                          {categories.map(cat => (
                              <button
                                key={cat.id}
                                type="button"
                                onClick={() => { setNewCatId(cat.id); setNewColor(cat.color); }}
                                className={`flex items-center gap-1 px-2 py-0.5 rounded-full border transition-all ${newCatId === cat.id ? 'bg-white/20 border-white/40' : 'bg-white/5 border-white/10 opacity-60 hover:opacity-100'}`}
                              >
                                  <div className="w-3 h-3 text-white" style={{color: cat.color}}>{getIcon(cat.icon)}</div>
                                  <span className="text-[9px] text-white font-bold">{cat.name}</span>
                              </button>
                          ))}
                      </div>
                  </div>

                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2 text-[10px] text-white/60 font-mono tracking-wide">
                      <span className="font-bold">EST</span>
                      <div className="flex items-center rounded-lg border border-white/20 bg-black/20 overflow-hidden">
                          <button
                              type="button"
                              onClick={() => setNewEst(prev => clampPomoEstimate(prev - 1))}
                              className="px-2 py-1 text-white/65 hover:text-white hover:bg-white/12 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_4px_10px_rgba(255,255,255,0.12)] active:translate-y-0 active:scale-95"
                              aria-label="Decrease new task estimate"
                          >
                              -
                          </button>
                          <input
                              type="text"
                              inputMode="numeric"
                              value={newEst}
                              onChange={e => {
                                  const next = Number(e.target.value.replace(/[^\d]/g, ''));
                                  if (!Number.isNaN(next)) setNewEst(clampPomoEstimate(next));
                              }}
                              className="w-8 bg-transparent text-center text-white font-mono font-bold text-xs outline-none"
                          />
                          <button
                              type="button"
                              onClick={() => setNewEst(prev => clampPomoEstimate(prev + 1))}
                              className="px-2 py-1 text-white/65 hover:text-white hover:bg-white/12 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_4px_10px_rgba(255,255,255,0.12)] active:translate-y-0 active:scale-95"
                              aria-label="Increase new task estimate"
                          >
                              +
                          </button>
                      </div>
                    </div>
                    
                    <div className="flex gap-2">
                        <button 
                            type="button" 
                            onClick={() => setWeeklyScheduleOpen(true)}
                            className="px-3 py-1 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded-lg text-[10px] uppercase tracking-wider font-bold transition-all border border-white/5"
                        >
                            Schedule
                        </button>
                        <button 
                            type="submit"
                            className="px-4 py-1 bg-white text-black text-[10px] rounded-lg font-bold hover:bg-gray-200 transition-all shadow-lg active:scale-95 uppercase tracking-wider"
                        >
                            Add
                        </button>
                    </div>
                  </div>
              </div>
            </div>
          </div>
        </form>

        {/* Task List */}
        <div
          onDragOver={(event) => {
            if (!draggingTaskId) return;
            event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            clearDragState();
          }}
          className={`space-y-1 pb-8 min-h-[100px] transition-all duration-500 ${blurClass} ${draggingTaskId ? 'doro-task-list-drag-active' : ''}`}
        >
          {filteredTasks.map(task => (
            <TaskItem
              key={task.id}
              task={task}
              isSectionActive={isSectionActive}
              isEntering={enteringTaskIds.includes(task.id)}
              draggingTaskId={draggingTaskId}
              dropHint={draggingTaskId && hoverTarget?.taskId === task.id && draggingTaskId !== task.id ? hoverTarget.position : null}
              onDragStartTask={handleTaskDragStart}
              onDragHoverTask={handleTaskDragHover}
              onDragEndTask={clearDragState}
              registerTaskRef={registerTaskRef}
            />
          ))}
          {filteredTasks.length === 0 && (
            <div className="flex items-center justify-center h-24 opacity-0" />
          )}
        </div>
        
        {/* Permanent Pomo Counter Footer */}
        <div className={`
            mt-auto pt-3 pb-1 border-t border-white/5 grid grid-cols-3 items-center gap-1
            text-center whitespace-nowrap [font-size:clamp(7px,1.8vw,10px)] uppercase tracking-[0.13em] font-bold text-white/45
            transition-all duration-500 ${blurClass}
        `}>
            <div className="flex min-w-0 items-center justify-center gap-1">
                 <span className={`leading-none font-mono font-bold ${untilLongBreak === 1 ? 'text-yellow-200' : 'text-white/80'}`}>{untilLongBreak}</span>
                 <span>until long break</span>
            </div>
            <div className="flex min-w-0 items-center justify-center gap-1">
                <span>time finished</span>
                <span className="leading-none font-mono font-bold text-white/80">{predictedFinishTime}</span>
            </div>
            <div className="flex min-w-0 items-center justify-center gap-1">
                <span>total pomos</span>
                <span className="leading-none font-mono font-bold text-white/80">{pomodoroCount}</span>
            </div>
        </div>

      </div>
      </div>
    </>
  );
};

export default Tasks;
