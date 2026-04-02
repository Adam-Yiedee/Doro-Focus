

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTimer } from '../context/TimerContext';
import { Task } from '../types';
import { getIcon } from '../utils/icons';
import { PASTEL_SWATCHES as PRESET_COLORS } from '../utils/palette';
import { getPomodoroCycleProgress } from '../utils/timerRuntime';

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

const hasSelectedTaskInSubtree = (task: Task): boolean => {
  if (task.selected) return true;
  return task.subtasks.some(hasSelectedTaskInSubtree);
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
const DRAG_DEAD_ZONE_MIN_PX = 14;
const DRAG_DEAD_ZONE_RATIO = 0.34;
const REORDER_MIN_INTERVAL_MS = 96;
const FLIP_ANIMATION_DURATION_MS = 165;
const FLIP_MAX_ITEMS = 120;
const TASK_EDIT_CLOSE_DURATION_MS = 240;
const TASK_EDIT_SETTLE_DURATION_MS = 280;
const CATEGORY_RAIL_DRAG_THRESHOLD_PX = 6;

interface TasksProps {
  onPreviewSurfaceColorChange?: (color?: string) => void;
}

interface TaskItemProps {
  task: Task;
  depth?: number;
  isSectionActive: boolean;
  showCompletedTasks: boolean;
  keepSelectedCompletedVisible: boolean;
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
  showCompletedTasks,
  keepSelectedCompletedVisible,
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
  const [editCloseState, setEditCloseState] = useState<'save' | 'cancel' | null>(null);
  const [isSettlingAfterEdit, setIsSettlingAfterEdit] = useState(false);
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
  const editTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editSettleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (removeTimeoutRef.current) clearTimeout(removeTimeoutRef.current);
      if (checkAnimTimeoutRef.current) clearTimeout(checkAnimTimeoutRef.current);
      if (editTransitionTimeoutRef.current) clearTimeout(editTransitionTimeoutRef.current);
      if (editSettleTimeoutRef.current) clearTimeout(editSettleTimeoutRef.current);
    };
  }, []);

  const handleCheck = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextChecked = !task.checked;
    if (nextChecked) {
      setIsCheckAnimating(true);
      if (checkAnimTimeoutRef.current) clearTimeout(checkAnimTimeoutRef.current);
      checkAnimTimeoutRef.current = setTimeout(() => setIsCheckAnimating(false), 390);
    }
    updateTask({ ...task, checked: nextChecked });
  };

  const settleTaskAfterEdit = () => {
    if (editTransitionTimeoutRef.current) clearTimeout(editTransitionTimeoutRef.current);
    editTransitionTimeoutRef.current = setTimeout(() => {
      setIsEditing(false);
      setEditCloseState(null);
      setIsSettlingAfterEdit(true);
      if (editSettleTimeoutRef.current) clearTimeout(editSettleTimeoutRef.current);
      editSettleTimeoutRef.current = setTimeout(() => {
        setIsSettlingAfterEdit(false);
      }, TASK_EDIT_SETTLE_DURATION_MS);
    }, TASK_EDIT_CLOSE_DURATION_MS);
  };

  const handleSave = () => {
    const safeEst = clampPomoEstimate(editEst);
    updateTask({ ...task, name: editName.trim() || task.name, estimated: safeEst, color: editColor });
    setEditCloseState('save');
    settleTaskAfterEdit();
  };

  const handleCancelEdit = () => {
    setEditCloseState('cancel');
    settleTaskAfterEdit();
  };

  const startEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (editTransitionTimeoutRef.current) clearTimeout(editTransitionTimeoutRef.current);
    if (editSettleTimeoutRef.current) clearTimeout(editSettleTimeoutRef.current);
    setEditName(task.name);
    setEditEst(task.estimated);
    setEditColor(task.color || PRESET_COLORS[0]);
    setEditCloseState(null);
    setIsSettlingAfterEdit(false);
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

  const category = task.categoryId ? categories.find(c => c.id === task.categoryId) : null;
  const isTopLevel = depth === 0;
  const isVisibleInList = showCompletedTasks || !task.checked || (keepSelectedCompletedVisible && hasSelectedTaskInSubtree(task));
  const isDraggedTask = isTopLevel && draggingTaskId === task.id;

  if (isEditing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
        className={`doro-task-edit-shell p-3 bg-white/10 rounded-xl flex flex-col gap-3 backdrop-blur-md border border-white/20 ${
          editCloseState === 'save'
            ? 'doro-task-edit-close-save'
            : editCloseState === 'cancel'
              ? 'doro-task-edit-close-cancel'
              : 'doro-task-edit-open'
        }`}
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
            onClick={handleCancelEdit}
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
      draggable={isTopLevel && !isRemoving && isVisibleInList}
      onDragStart={(event) => {
        if (!isTopLevel || !onDragStartTask || !isVisibleInList) return;
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
        const midpoint = rect.top + rect.height / 2;
        const deadZone = Math.max(DRAG_DEAD_ZONE_MIN_PX, rect.height * DRAG_DEAD_ZONE_RATIO);
        if (Math.abs(event.clientY - midpoint) <= deadZone) return;
        const position: DragInsertPosition = event.clientY < midpoint ? 'before' : 'after';
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
        relative flex flex-col overflow-hidden origin-top
        ${depth === 0 && isVisibleInList ? 'cursor-grab active:cursor-grabbing' : ''}
        transition-[max-height,opacity,transform,margin] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
        ${isVisibleInList ? 'max-h-[2000px] opacity-100 translate-y-0' : 'max-h-0 opacity-0 -translate-y-2 pointer-events-none'}
        ${isEntering ? 'doro-task-enter' : ''}
        ${isSettlingAfterEdit ? 'doro-task-edit-return-settle' : ''}
        ${isRemoving ? 'opacity-0 scale-[0.96] -translate-x-2 pointer-events-none' : ''}
      `}
      style={isVisibleInList ? undefined : { marginTop: 0 }}
      aria-hidden={!isVisibleInList}
    >
      <div 
        onClick={() => selectTask(task.id)}
        className={`
          group relative rounded-lg cursor-pointer transition-[background-color,border-color,box-shadow,transform,opacity] duration-300 ease-out
          flex items-center gap-3 border
          ${depth === 0 ? 'p-3' : 'p-2.5'}
          ${task.selected
            ? 'bg-white/18 border-white/30 shadow-[0_18px_30px_-18px_rgba(15,23,42,0.58)] z-20 blur-0 opacity-100'
            : 'bg-white/5 border-transparent z-10'
          }
          ${!isSectionActive 
            ? (task.selected ? '' : 'opacity-70 hover:opacity-100')
            : (task.selected ? '' : 'hover:bg-white/10 hover:border-white/10 hover:shadow-md opacity-80 hover:opacity-100')
          }
          ${task.checked ? 'opacity-40' : ''}
          ${isDraggedTask ? 'opacity-45 scale-[0.985]' : ''}
          ${isCheckAnimating ? 'doro-check-burst scale-[1.015]' : ''}
        `}
      >
        {isCheckAnimating && (
          <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
            <span className="doro-check-pass absolute -left-[42%] top-[-10%] h-[120%] w-[58%] rounded-full bg-[linear-gradient(90deg,rgba(16,185,129,0),rgba(167,243,208,0.18)_26%,rgba(110,231,183,0.45)_48%,rgba(167,243,208,0.2)_70%,rgba(16,185,129,0))] blur-md" />
          </span>
        )}
        {dropHint && !isDraggedTask && (
          <div className={`pointer-events-none absolute left-2 right-2 ${dropHint === 'before' ? 'top-0.5' : 'bottom-0.5'} h-[2px] rounded-full bg-white/75 shadow-[0_0_12px_rgba(255,255,255,0.5)]`} />
        )}
        {task.selected && <div className="absolute left-0 inset-y-2 w-1 bg-white rounded-r-full shadow-[0_0_10px_rgba(255,255,255,0.5)]" />}
        
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
          {task.checked && (
            <svg className={`w-3 h-3 text-black ${isCheckAnimating ? 'doro-check-pop' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        
        <div className="flex-1 min-w-0 flex flex-col justify-center">
            <div className="flex items-center gap-2">
                <div className={`text-glass-text truncate transition-colors ${task.checked ? 'line-through' : (task.selected ? 'text-white' : 'group-hover:text-white')} ${depth === 0 ? 'font-medium text-sm' : 'text-xs'}`}>
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
             <div className={`w-full max-w-[60px] h-[2px] mt-1.5 rounded-full transition-opacity ${task.selected ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'}`} style={{ backgroundColor: task.color }} />
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
          <div className="doro-soft-expand relative border-l border-white/10 pl-4 mt-1 space-y-1.5">
            {task.subtasks.map(sub => (
                <TaskItem
                  key={sub.id}
                  task={sub}
                  depth={depth + 1}
                  isSectionActive={isSectionActive}
                  showCompletedTasks={showCompletedTasks}
                  keepSelectedCompletedVisible={keepSelectedCompletedVisible}
                />
              ))}
            </div>
        )}
      </div>
    </div>
  );
};

const Tasks: React.FC<TasksProps> = ({ onPreviewSurfaceColorChange }) => {
  const {
    tasks,
    addTask,
    moveTask,
    pomodoroCount,
    settings,
    setWeeklyScheduleOpen,
    categories,
    requestNewCategoryFlow,
    showCompletedTasks,
  } = useTimer();
  const [newName, setNewName] = useState('');
  const [newEst, setNewEst] = useState(1);
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [newCatId, setNewCatId] = useState<number | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isPreviewingNewTaskColor, setIsPreviewingNewTaskColor] = useState(false);
  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);
  const [hoverTarget, setHoverTarget] = useState<{ taskId: number; position: DragInsertPosition } | null>(null);
  const [enteringTaskIds, setEnteringTaskIds] = useState<number[]>([]);
  const [isCategoryRailDragging, setIsCategoryRailDragging] = useState(false);
  const didInitTaskIdsRef = useRef(false);
  const mountAtRef = useRef(typeof performance !== 'undefined' ? performance.now() : Date.now());
  const prevTaskIdsRef = useRef<number[]>([]);
  const taskCardRefsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const previousTaskTopsRef = useRef<Map<number, number>>(new Map());
  const flipAnimationsRef = useRef<Map<number, Animation>>(new Map());
  const lastHoverMoveKeyRef = useRef<string | null>(null);
  const lastReorderAtRef = useRef<number>(0);
  const categoryRailReleaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const categoryRailDragRef = useRef({
    pointerId: null as number | null,
    startX: 0,
    startScrollLeft: 0,
    moved: false,
    suppressClick: false,
    captured: false,
  });

  const todayKey = getDateKey(new Date());

  // Filter Tasks: Hide scheduled/future tasks from main list
  const filteredTasks = tasks.filter(t => 
    !t.isFuture
    && (!t.scheduledDate || t.scheduledDate <= todayKey)
  );
  const keepSelectedCompletedVisible = useMemo(
    () => filteredTasks.some(task => !task.checked),
    [filteredTasks]
  );
  const visibleTaskIds = useMemo(
    () => filteredTasks
      .filter(task => showCompletedTasks || !task.checked || (keepSelectedCompletedVisible && hasSelectedTaskInSubtree(task)))
      .map(task => task.id),
    [filteredTasks, keepSelectedCompletedVisible, showCompletedTasks]
  );
  const filteredTaskIds = useMemo(() => visibleTaskIds, [visibleTaskIds]);
  const filteredTaskOrderKey = useMemo(() => filteredTaskIds.join('|'), [filteredTaskIds]);

  useEffect(() => {
    const currentIds = filteredTasks.map(task => task.id);
    if (!didInitTaskIdsRef.current) {
      didInitTaskIdsRef.current = true;
      prevTaskIdsRef.current = currentIds;
      return;
    }

    // Hydration path can populate many tasks right after mount; skip enter animations there to avoid first-load jank.
    if (
      prevTaskIdsRef.current.length === 0 &&
      currentIds.length > 0 &&
      ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - mountAtRef.current) < 2000
    ) {
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

  useEffect(() => {
    return () => {
      if (categoryRailReleaseTimeoutRef.current) clearTimeout(categoryRailReleaseTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    onPreviewSurfaceColorChange?.(isInputFocused && isPreviewingNewTaskColor ? newColor : undefined);
  }, [isInputFocused, isPreviewingNewTaskColor, newColor, onPreviewSurfaceColorChange]);

  useEffect(() => {
    return () => {
      onPreviewSurfaceColorChange?.(undefined);
    };
  }, [onPreviewSurfaceColorChange]);

  const registerTaskRef = useCallback((taskId: number, node: HTMLDivElement | null) => {
    if (node) taskCardRefsRef.current.set(taskId, node);
    else taskCardRefsRef.current.delete(taskId);
  }, []);

  const cancelFlipAnimations = useCallback(() => {
    flipAnimationsRef.current.forEach((animation) => {
      try {
        animation.cancel();
      } catch {
        // no-op
      }
    });
    flipAnimationsRef.current.clear();
    taskCardRefsRef.current.forEach((node) => {
      node.style.transform = '';
      node.style.transition = '';
      node.style.willChange = '';
    });
  }, []);

  const snapshotTaskRects = useCallback(() => {
    const tops = new Map<number, number>();
    const windowScrollY = typeof window !== 'undefined' ? window.scrollY : 0;
    filteredTaskIds.forEach((taskId) => {
      const node = taskCardRefsRef.current.get(taskId);
      if (!node) return;
      const rect = node.getBoundingClientRect();
      tops.set(taskId, rect.top + windowScrollY);
    });
    previousTaskTopsRef.current = tops;
  }, [filteredTaskIds]);

  useEffect(() => {
    return () => {
      cancelFlipAnimations();
    };
  }, [cancelFlipAnimations]);

  useLayoutEffect(() => {
    const nextTops = new Map<number, number>();
    const windowScrollY = typeof window !== 'undefined' ? window.scrollY : 0;
    filteredTaskIds.forEach((taskId) => {
      const node = taskCardRefsRef.current.get(taskId);
      if (!node) return;
      const rect = node.getBoundingClientRect();
      nextTops.set(taskId, rect.top + windowScrollY);
    });

    // Keep rect history fresh, but only animate while actively dragging.
    if (draggingTaskId === null) {
      previousTaskTopsRef.current = nextTops;
      return;
    }

    if (filteredTaskIds.length > FLIP_MAX_ITEMS) {
      previousTaskTopsRef.current = nextTops;
      return;
    }

    if (previousTaskTopsRef.current.size === 0) {
      previousTaskTopsRef.current = nextTops;
      return;
    }

    nextTops.forEach((nextTop, taskId) => {
      if (taskId === draggingTaskId) return;
      const prevTop = previousTaskTopsRef.current.get(taskId);
      const node = taskCardRefsRef.current.get(taskId);
      if (typeof prevTop !== 'number' || !node) return;

      const deltaY = prevTop - nextTop;
      if (Math.abs(deltaY) < 0.75) return;
      if (Math.abs(deltaY) > 420) return;

      const existing = flipAnimationsRef.current.get(taskId);
      if (existing) {
        try {
          existing.cancel();
        } catch {
          // no-op
        }
      }

      node.style.willChange = 'transform';
      if (typeof node.animate === 'function') {
        const animation = node.animate(
          [
            { transform: `translateY(${deltaY}px)` },
            { transform: 'translateY(0)' },
          ],
          {
            duration: FLIP_ANIMATION_DURATION_MS,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'both',
          },
        );
        flipAnimationsRef.current.set(taskId, animation);
        animation.onfinish = () => {
          if (flipAnimationsRef.current.get(taskId) === animation) flipAnimationsRef.current.delete(taskId);
          node.style.willChange = '';
          node.style.transform = '';
        };
        animation.oncancel = () => {
          if (flipAnimationsRef.current.get(taskId) === animation) flipAnimationsRef.current.delete(taskId);
          node.style.willChange = '';
          node.style.transform = '';
        };
      } else {
        node.style.transition = 'transform 0s';
        node.style.transform = `translateY(${deltaY}px)`;
        requestAnimationFrame(() => {
          node.style.transition = `transform ${FLIP_ANIMATION_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
          node.style.transform = 'translateY(0)';
        });
      }
    });

    previousTaskTopsRef.current = nextTops;
  }, [filteredTaskOrderKey, filteredTaskIds, draggingTaskId]);

  const handleTaskDragStart = useCallback((taskId: number) => {
    cancelFlipAnimations();
    snapshotTaskRects();
    setDraggingTaskId(taskId);
    setHoverTarget(null);
    lastHoverMoveKeyRef.current = null;
    lastReorderAtRef.current = 0;
  }, [cancelFlipAnimations, snapshotTaskRects]);

  const clearDragState = useCallback(() => {
    cancelFlipAnimations();
    setDraggingTaskId(null);
    setHoverTarget(null);
    lastHoverMoveKeyRef.current = null;
    lastReorderAtRef.current = 0;
  }, [cancelFlipAnimations]);

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
    const now = performance.now();
    if (now - lastReorderAtRef.current < REORDER_MIN_INTERVAL_MS) return;

    lastHoverMoveKeyRef.current = moveKey;
    lastReorderAtRef.current = now;
    moveTask(draggingTaskId, toId);
  }, [draggingTaskId, filteredTaskIds, moveTask]);

  const releaseCategoryRailDrag = useCallback((pointerId?: number) => {
    const drag = categoryRailDragRef.current;
    if (pointerId !== undefined && drag.pointerId !== pointerId) return;
    const shouldSuppressClick = drag.moved;
    drag.pointerId = null;
    drag.startX = 0;
    drag.startScrollLeft = 0;
    drag.moved = false;
    drag.captured = false;
    setIsCategoryRailDragging(false);

    if (!shouldSuppressClick) return;
    drag.suppressClick = true;
    if (categoryRailReleaseTimeoutRef.current) clearTimeout(categoryRailReleaseTimeoutRef.current);
    categoryRailReleaseTimeoutRef.current = setTimeout(() => {
      categoryRailDragRef.current.suppressClick = false;
      categoryRailReleaseTimeoutRef.current = null;
    }, 0);
  }, []);

  const handleCategoryRailPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const rail = event.currentTarget;
    if (rail.scrollWidth <= rail.clientWidth + 1) return;
    if (categoryRailReleaseTimeoutRef.current) {
      clearTimeout(categoryRailReleaseTimeoutRef.current);
      categoryRailReleaseTimeoutRef.current = null;
    }

    const drag = categoryRailDragRef.current;
    drag.pointerId = event.pointerId;
    drag.startX = event.clientX;
    drag.startScrollLeft = rail.scrollLeft;
    drag.moved = false;
    drag.suppressClick = false;
    setIsCategoryRailDragging(false);

  }, []);

  const handleCategoryRailPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = categoryRailDragRef.current;
    if (drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(deltaX) >= CATEGORY_RAIL_DRAG_THRESHOLD_PX) {
      drag.moved = true;
      if (!drag.captured && typeof event.currentTarget.setPointerCapture === 'function') {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.captured = true;
        } catch {
          drag.captured = false;
        }
      }
      setIsCategoryRailDragging(true);
    }
    if (!drag.moved) return;

    event.preventDefault();
    event.currentTarget.scrollLeft = drag.startScrollLeft - deltaX;
  }, []);

  const handleCategoryRailPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    releaseCategoryRailDrag(event.pointerId);
  }, [releaseCategoryRailDrag]);

  const handleCategoryRailPointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    releaseCategoryRailDrag(event.pointerId);
  }, [releaseCategoryRailDrag]);

  const handleCategoryRailClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!categoryRailDragRef.current.suppressClick) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleCategorySelect = useCallback((categoryId: number, color: string) => {
    if (categoryRailDragRef.current.suppressClick) return;
    setNewCatId(categoryId);
    setNewColor(color);
    setIsPreviewingNewTaskColor(true);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    addTask(newName, clampPomoEstimate(newEst), newCatId, undefined, newColor);
    setNewName('');
    setNewEst(1);
    setIsPreviewingNewTaskColor(false);
  };

  const isSectionActive = isHovered || isInputFocused;
  const shouldBlur = !isSectionActive && !settings.disableBlur;
  const blurClass = shouldBlur ? 'opacity-60' : 'opacity-100';
  
  // Pomo Counter Logic
  const pomosPerSet = settings.longBreakInterval || 4;
  const cycleProgress = useMemo(
    () => getPomodoroCycleProgress(pomodoroCount, pomosPerSet),
    [pomodoroCount, pomosPerSet]
  );
  const untilLongBreak = cycleProgress.untilLongBreak;
  const remainingTaskPomos = useMemo(
    () => filteredTasks.reduce((acc, task) => acc + getRemainingPomosForTask(task), 0),
    [filteredTasks]
  );
  const predictedFinishTime = useMemo(() => {
    if (remainingTaskPomos <= 0) return '--';

    let totalSeconds = remainingTaskPomos * settings.workDuration;
    for (let i = 1; i < remainingTaskPomos; i++) {
      const breakProgress = getPomodoroCycleProgress(pomodoroCount + i - 1, pomosPerSet);
      const breakSeconds = breakProgress.nextPomoTriggersLongBreak ? settings.longBreakDuration : settings.shortBreakDuration;
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
        @keyframes doro-task-edit-open {
          0% {
            opacity: 0;
            transform: translateY(10px) scale(0.972);
            filter: saturate(0.9);
          }
          58% {
            opacity: 1;
            transform: translateY(-1px) scale(1.01);
            filter: saturate(1.05);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: saturate(1);
          }
        }
        .doro-task-edit-open {
          animation: doro-task-edit-open 420ms cubic-bezier(0.16, 0.88, 0.3, 1.08);
          transform-origin: top center;
          will-change: transform, opacity, filter;
        }
        @keyframes doro-task-edit-close-save {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: brightness(1) saturate(1);
          }
          100% {
            opacity: 0;
            transform: translateY(-6px) scale(0.985);
            filter: brightness(1.08) saturate(1.08);
          }
        }
        .doro-task-edit-close-save {
          animation: doro-task-edit-close-save ${TASK_EDIT_CLOSE_DURATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
          pointer-events: none;
        }
        @keyframes doro-task-edit-close-cancel {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: brightness(1) saturate(1);
          }
          100% {
            opacity: 0;
            transform: translateY(8px) scale(0.978);
            filter: brightness(0.96) saturate(0.92);
          }
        }
        .doro-task-edit-close-cancel {
          animation: doro-task-edit-close-cancel ${TASK_EDIT_CLOSE_DURATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
          pointer-events: none;
        }
        @keyframes doro-task-edit-return-settle {
          0% {
            transform: translateY(3px) scale(0.986);
          }
          56% {
            transform: translateY(-1px) scale(1.01);
          }
          100% {
            transform: translateY(0) scale(1);
          }
        }
        .doro-task-edit-return-settle {
          animation: doro-task-edit-return-settle ${TASK_EDIT_SETTLE_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
          transform-origin: top center;
        }
        @keyframes doro-task-enter {
          0% {
            opacity: 0;
            transform: translateY(12px) scale(0.96);
          }
          62% {
            opacity: 1;
            transform: translateY(-2px) scale(1.012);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .doro-task-enter {
          animation: doro-task-enter 540ms cubic-bezier(0.16, 0.88, 0.3, 1.12);
          transform-origin: top center;
        }
        @keyframes doro-check-burst {
          0% {
            transform: scale(1);
          }
          58% {
            transform: scale(1.02);
          }
          100% {
            transform: scale(1);
          }
        }
        .doro-check-burst {
          animation: doro-check-burst 420ms cubic-bezier(0.2, 0.9, 0.3, 1.08);
        }
        @keyframes doro-check-pop {
          0% {
            transform: scale(0.45);
            opacity: 0.2;
          }
          62% {
            transform: scale(1.2);
            opacity: 1;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        .doro-check-pop {
          animation: doro-check-pop 320ms cubic-bezier(0.17, 1, 0.3, 1);
          transform-origin: center;
        }
        @keyframes doro-check-pass {
          0% {
            opacity: 0;
            transform: translateX(0) skewX(-16deg);
          }
          22% {
            opacity: 0.96;
          }
          100% {
            opacity: 0;
            transform: translateX(270%) skewX(-16deg);
          }
        }
        .doro-check-pass {
          animation: doro-check-pass 360ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        .doro-task-list-drag-active {
          transition: background-color 220ms ease;
        }
      `}</style>
      <div 
        className="w-full max-w-lg mx-auto min-h-[24rem] md:min-h-[25rem] transition-opacity duration-250"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
      <div className="relative flex min-h-[24rem] md:min-h-[25rem] flex-col">
        {/* Header */}
        <div className={`flex justify-between items-center mb-4 px-2 transition-opacity duration-250 ${blurClass}`}>
          <h2 className="text-[10px] font-bold text-white/50 tracking-[0.2em] uppercase">Task List</h2>
        </div>

        {/* Input Area */}
        <form 
          onSubmit={handleSubmit} 
          className={`
            mb-8 relative group z-30 transition-[transform,opacity,box-shadow] duration-300
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
              setIsPreviewingNewTaskColor(false);
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
              overflow-hidden border-t transition-[max-height,opacity,padding,border-color] duration-300 ease-in-out
              ${isInputFocused ? 'doro-soft-expand max-h-40 border-white/5 opacity-100 py-2 px-4' : 'max-h-0 border-white/0 opacity-0 py-0 px-4'}
            `}>
              <div className="flex flex-col gap-3">
                  {/* Category & Color Selection */}
                  <div className="flex items-center gap-2 overflow-hidden px-1 py-1">
                      <div className="flex shrink-0 gap-1.5">
                          {PRESET_COLORS.map(c => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => {
                                setNewColor(c);
                                setNewCatId(null);
                                setIsPreviewingNewTaskColor(true);
                              }}
                              className={getColorSwatchClass(newColor === c && !newCatId)}
                              style={{ backgroundColor: c }}
                            />
                          ))}
                      </div>

                      {categories.length > 0 ? (
                        <div
                          className={`min-w-0 flex-1 overflow-x-auto rounded-xl border border-white/10 bg-black/10 p-1.5 scrollbar-hide ${isCategoryRailDragging ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
                          style={{ touchAction: 'pan-y' }}
                          onPointerDown={handleCategoryRailPointerDown}
                          onPointerMove={handleCategoryRailPointerMove}
                          onPointerUp={handleCategoryRailPointerUp}
                          onPointerCancel={handleCategoryRailPointerCancel}
                          onLostPointerCapture={handleCategoryRailPointerCancel}
                          onClick={handleCategoryRailClick}
                        >
                          <div className="flex w-max gap-1 pr-1">
                              {categories.map(cat => (
                                  <button
                                    key={cat.id}
                                    type="button"
                                    onClick={() => handleCategorySelect(cat.id, cat.color)}
                                    className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full border transition-all ${newCatId === cat.id ? 'bg-white/20 border-white/40' : 'bg-white/5 border-white/10 opacity-60 hover:opacity-100'}`}
                                  >
                                      <div className="w-3 h-3 text-white" style={{color: cat.color}}>{getIcon(cat.icon)}</div>
                                      <span className="text-[9px] text-white font-bold">{cat.name}</span>
                                  </button>
                              ))}
                          </div>
                        </div>
                      ) : (
                        <div className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/10 p-1.5">
                          <button
                            type="button"
                            onClick={requestNewCategoryFlow}
                            className="flex w-fit items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 transition-all opacity-60 hover:opacity-100"
                          >
                              <div className="w-3 h-3 flex items-center justify-center text-white/80">
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                      <path d="M12 5v14" />
                                      <path d="M5 12h14" />
                                  </svg>
                              </div>
                              <span className="text-[9px] text-white font-bold">Add Category</span>
                          </button>
                        </div>
                      )}
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
          className={`flex-1 min-h-0 space-y-3 overflow-y-auto pb-8 pr-1 scrollbar-hide transition-opacity duration-250 ${blurClass} ${draggingTaskId ? 'doro-task-list-drag-active' : ''}`}
        >
          {filteredTasks.map(task => (
            <TaskItem
              key={task.id}
              task={task}
              isSectionActive={isSectionActive}
              showCompletedTasks={showCompletedTasks}
              keepSelectedCompletedVisible={keepSelectedCompletedVisible}
              isEntering={enteringTaskIds.includes(task.id)}
              draggingTaskId={draggingTaskId}
              dropHint={draggingTaskId && hoverTarget?.taskId === task.id && draggingTaskId !== task.id ? hoverTarget.position : null}
              onDragStartTask={handleTaskDragStart}
              onDragHoverTask={handleTaskDragHover}
              onDragEndTask={clearDragState}
              registerTaskRef={registerTaskRef}
            />
          ))}
          {visibleTaskIds.length === 0 && (
            <div className="flex items-center justify-center h-24 opacity-0" />
          )}
        </div>
        
        {/* Permanent Pomo Counter Footer */}
        <div className={`
            pt-3 pb-1 border-t border-white/5 grid grid-cols-3 items-center gap-1
            text-center whitespace-nowrap [font-size:clamp(7px,1.8vw,10px)] uppercase tracking-[0.13em] font-bold text-white/45
            transition-opacity duration-250 ${blurClass}
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
