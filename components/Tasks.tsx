

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTimer } from '../context/TimerContext';
import { Task } from '../types';
import { getIcon } from '../utils/icons';
import { getActiveCategories } from '../utils/categoryVisibility';
import { PASTEL_SWATCHES as PRESET_COLORS } from '../utils/palette';
import { getTimerPomoUnitLabel } from '../utils/pomodoroAccounting';
import { getPomodoroCycleProgress, getProjectedTaskFinishSeconds } from '../utils/timerRuntime';

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
  return `doro-task-color-swatch ${baseSize} rounded-full transform-gpu transition-all duration-300 ease-out ${
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
const TASK_EDIT_OPEN_DURATION_MS = 380;
const TASK_EDIT_CLOSE_DURATION_MS = 300;
const TASK_EDIT_SETTLE_DURATION_MS = 160;
const CATEGORY_RAIL_DRAG_THRESHOLD_PX = 6;

const getCategoryTrayClass = (hasSelection: boolean, extraClassName = '') => (
  `min-w-0 flex-1 overflow-x-auto rounded-xl border p-1.5 scrollbar-hide transition-[background-color,border-color,box-shadow] duration-300 ease-out ${
    hasSelection
      ? 'border-white/[0.10] bg-black/[0.10] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]'
      : 'border-white/[0.08] bg-black/[0.08]'
  } ${extraClassName}`.trim()
);

const getCategoryChipClass = (selected: boolean) => (
  `doro-task-category-chip shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full border transition-all ${
    selected
      ? 'bg-white/[0.11] border-white/[0.18] opacity-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
      : 'bg-white/[0.04] border-white/[0.08] opacity-60 hover:opacity-100 hover:bg-white/[0.07]'
  }`
);

const ADD_CATEGORY_CHIP_CLASS = 'doro-task-add-category-chip shrink-0 flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 transition-all opacity-75 hover:opacity-100 hover:bg-white/[0.07]';

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
  const { updateTask, deleteTask, selectTask, toggleTaskExpansion, addTask, categories, requestNewCategoryFlow } = useTimer();
  const [isEditing, setIsEditing] = useState(false);
  const [editCloseState, setEditCloseState] = useState<'save' | 'cancel' | null>(null);
  const [isSettlingAfterEdit, setIsSettlingAfterEdit] = useState(false);
  const [editName, setEditName] = useState(task.name);
  const [editEst, setEditEst] = useState(task.estimated);
  const [editColor, setEditColor] = useState(task.color || PRESET_COLORS[0]);
  const [editCategoryId, setEditCategoryId] = useState<number | null>(task.categoryId ?? null);
  const [isAddingSub, setIsAddingSub] = useState(false);
  const [subName, setSubName] = useState('');
  const [subEst, setSubEst] = useState(1);
  const [isRemoving, setIsRemoving] = useState(false);
  const isRemovingRef = useRef(false);
  const [isCheckAnimating, setIsCheckAnimating] = useState(false);
  const removeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkAnimTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editSettleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editFormRef = useRef<HTMLFormElement | null>(null);

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
    updateTask({ ...task, name: editName.trim() || task.name, estimated: safeEst, color: editColor, categoryId: editCategoryId });
    setEditCloseState('save');
    settleTaskAfterEdit();
  };

  const handleCancelEdit = () => {
    if (editCloseState) return;
    setEditCloseState('cancel');
    settleTaskAfterEdit();
  };

  useEffect(() => {
    if (!isEditing || editCloseState) return;

    const handlePointerDownOutside = (event: PointerEvent) => {
      const node = editFormRef.current;
      if (!node || !(event.target instanceof Node) || node.contains(event.target)) return;
      setEditCloseState('cancel');
      settleTaskAfterEdit();
    };

    document.addEventListener('pointerdown', handlePointerDownOutside, true);
    return () => document.removeEventListener('pointerdown', handlePointerDownOutside, true);
  }, [editCloseState, isEditing]);

  const startEditing = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (editTransitionTimeoutRef.current) clearTimeout(editTransitionTimeoutRef.current);
    if (editSettleTimeoutRef.current) clearTimeout(editSettleTimeoutRef.current);
    const currentCategory = typeof task.categoryId === 'number'
      ? categories.find(item => item.id === task.categoryId)
      : null;
    setEditName(task.name);
    setEditEst(task.estimated);
    setEditColor(task.color || currentCategory?.color || PRESET_COLORS[0]);
    setEditCategoryId(task.categoryId ?? null);
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

  const handleDelete = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if (isRemovingRef.current) return;
    isRemovingRef.current = true;
    setIsRemoving(true);
    removeTimeoutRef.current = setTimeout(() => {
      deleteTask(task.id);
    }, 280);
  };

  const handleStartAddingSubtask = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsAddingSub(true);
    updateTask({ ...task, isExpanded: true });
  };

  const handleSelectPress = (e: React.SyntheticEvent<HTMLDivElement>) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (target?.closest('button, input, textarea, select, a, form, .doro-task-check-target, .doro-task-action-rail')) return;
    selectTask(task.id);
  };

  const category = task.categoryId ? categories.find(c => c.id === task.categoryId) : null;
  const activeCategories = useMemo(() => getActiveCategories(categories), [categories]);
  const isTopLevel = depth === 0;
  const isNestedTask = !isTopLevel;
  const isVisibleInList = showCompletedTasks || !task.checked || (keepSelectedCompletedVisible && hasSelectedTaskInSubtree(task));
  const isDraggedTask = isTopLevel && draggingTaskId === task.id;
  const editPickerRowClass = isNestedTask
    ? 'doro-task-picker-row flex flex-col gap-2 overflow-hidden py-1 sm:flex-row sm:items-center sm:pl-1'
    : 'doro-task-picker-row flex items-center gap-2 overflow-hidden pl-1 py-1';
  const editFooterClass = isNestedTask
    ? 'doro-task-edit-footer flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'
    : 'doro-task-edit-footer flex items-center justify-between gap-3';

  if (isEditing) {
    return (
      <form
        ref={editFormRef}
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
        className={`doro-task-edit-shell rounded-lg border border-white/[0.10] bg-white/[0.055] backdrop-blur-md overflow-hidden shadow-[0_18px_42px_-28px_rgba(0,0,0,0.35)] ${
          editCloseState === 'save'
            ? 'doro-task-edit-close-save'
            : editCloseState === 'cancel'
              ? 'doro-task-edit-close-cancel'
              : 'doro-task-edit-open'
        }`}
      >
        <div className="doro-task-edit-row flex items-center gap-3 p-3">
          {task.subtasks.length > 0 ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleTaskExpansion(task.id);
              }}
              className="doro-task-expand-btn p-1 text-white/40 hover:text-white transition-colors rounded hover:bg-white/10"
            >
              <svg
                className={`w-3 h-3 transition-transform duration-300 ${task.isExpanded ? 'rotate-90' : ''}`}
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          ) : (
            <div className="w-3 h-3 px-1" />
          )}

          <button
            type="button"
            onClick={handleCheck}
            className={`doro-task-check-target
              rounded-full border relative flex h-5 w-5 shrink-0 items-center justify-center border-[1.5px] transition-all duration-300
              ${task.checked
                ? 'bg-white border-white'
                : 'border-white/35 hover:border-white hover:bg-white/10'
              }
            `}
            aria-label={task.checked ? 'Mark task incomplete' : 'Mark task complete'}
          >
            {task.checked && (
              <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>

          <div className="min-w-0 flex-1">
            <input
              autoFocus
              value={editName}
              onChange={e => setEditName(e.target.value)}
              placeholder="Describe task..."
              className="w-full bg-transparent py-0.5 text-sm font-medium text-glass-text placeholder-white/30 outline-none transition-colors focus:text-white"
            />
            {editColor && !task.checked && (
              <div className="mt-1.5 h-[2px] w-full max-w-[60px] rounded-full opacity-90 transition-opacity" style={{ backgroundColor: editColor }} />
            )}
          </div>

          <div className="text-glass-textMuted font-mono text-[10px] bg-black/20 px-2 py-0.5 rounded-md backdrop-blur-sm transition-colors border border-white/5">
            <span className={task.completed >= editEst ? 'text-green-400 font-bold' : ''}>{task.completed}</span>
            <span className="opacity-40 mx-0.5">/</span>
            <span>{editEst}</span>
          </div>

          <div className="doro-task-action-rail pointer-events-none shrink-0 opacity-0" aria-hidden="true" />
        </div>

        <div className="doro-task-edit-controls flex flex-col gap-3 border-t border-white/[0.07] px-4 py-3">
          <div className={editPickerRowClass}>
            <div className="flex shrink-0 items-center gap-1.5">
              {PRESET_COLORS.map(c => (
                <button
                  key={`edit-${task.id}-${c}`}
                  type="button"
                  onClick={() => {
                    setEditColor(c);
                    setEditCategoryId(null);
                  }}
                  className={getColorSwatchClass(editColor === c && !editCategoryId)}
                  style={{ backgroundColor: c }}
                  aria-label={`Set color ${c}`}
                />
              ))}
            </div>

            <div className={getCategoryTrayClass(Boolean(editCategoryId))}>
              <div className="flex w-max items-center gap-1 pr-1">
                {activeCategories.map(cat => (
                  <button
                    key={`edit-category-${task.id}-${cat.id}`}
                    type="button"
                    onClick={() => {
                      setEditCategoryId(cat.id);
                      setEditColor(cat.color);
                    }}
                    className={getCategoryChipClass(editCategoryId === cat.id)}
                  >
                    <div className="w-3 h-3 text-white" style={{ color: cat.color }}>{getIcon(cat.icon)}</div>
                    <span className="text-[9px] text-white font-bold">{cat.name}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={requestNewCategoryFlow}
                  className={ADD_CATEGORY_CHIP_CLASS}
                >
                  <div className="w-3 h-3 flex items-center justify-center text-white/75">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 5v14" />
                      <path d="M5 12h14" />
                    </svg>
                  </div>
                  <span className="text-[9px] text-white font-bold">Add Category</span>
                </button>
              </div>
            </div>
          </div>

          <div className={editFooterClass}>
            <div className="flex items-center gap-2 text-[10px] text-white/60 font-mono tracking-wide">
              <span className="font-bold uppercase">Est</span>
              <div className="doro-task-estimate-stepper flex items-center rounded-lg border border-white/15 bg-black/18 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setEditEst(prev => clampPomoEstimate(prev - 1))}
                  className="px-2 py-1 text-white/65 hover:text-white hover:bg-white/12 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_4px_10px_rgba(255,255,255,0.12)] active:translate-y-0 active:scale-95"
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
                  className="w-8 bg-transparent text-center text-white font-mono font-bold text-xs outline-none"
                />
                <button
                  type="button"
                  onClick={() => setEditEst(prev => clampPomoEstimate(prev + 1))}
                  className="px-2 py-1 text-white/65 hover:text-white hover:bg-white/12 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_4px_10px_rgba(255,255,255,0.12)] active:translate-y-0 active:scale-95"
                  aria-label="Increase estimate"
                >
                  +
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCancelEdit}
                className="px-3 py-1 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded-lg text-[10px] uppercase tracking-wider font-bold transition-all border border-white/5 active:scale-95"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1 bg-white text-black text-[10px] rounded-lg font-bold hover:bg-gray-200 transition-all shadow-lg active:scale-95 uppercase tracking-wider"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </form>
    );
  }

  return (
    <div
      ref={isTopLevel && registerTaskRef ? (node) => registerTaskRef(task.id, node) : undefined}
      data-task-id={task.id}
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
        relative flex flex-col origin-top
        ${isVisibleInList ? 'overflow-visible' : 'overflow-hidden'}
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
        data-task-row-id={task.id}
        onClick={handleSelectPress}
        className={`
          group relative rounded-lg cursor-pointer transform-gpu transition-[background-color,border-color,box-shadow,transform,opacity] duration-300 ease-out
          doro-task-card-row
          flex items-center gap-3 border
          p-3
          ${task.selected
            ? 'z-20 -translate-y-1 scale-[1.006] bg-white/[0.075] border-white/[0.10] shadow-[0_24px_46px_-18px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.06)] blur-0 opacity-100'
            : 'z-10 bg-white/[0.025] border-white/[0.08] shadow-none opacity-60'
          }
          ${!isSectionActive 
            ? (task.selected ? '' : 'hover:opacity-90')
            : (task.selected ? '' : 'hover:-translate-y-0.5 hover:bg-white/10 hover:border-white/16 hover:shadow-[0_16px_34px_-20px_rgba(0,0,0,0.28)] hover:opacity-90')
          }
          ${task.checked ? 'opacity-40' : ''}
          ${isDraggedTask ? 'opacity-45 scale-[0.985]' : ''}
          ${isCheckAnimating ? 'doro-check-burst scale-[1.015]' : ''}
        `}
      >
        {task.selected && (
          <>
            <div className="pointer-events-none absolute inset-0 rounded-lg bg-gradient-to-tr from-white/[0.055] via-white/0 to-transparent" />
            <div className="pointer-events-none absolute inset-0 rounded-lg shadow-[inset_0_0_28px_rgba(255,255,255,0.045)]" />
          </>
        )}
        {isCheckAnimating && (
          <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
            <span className="doro-check-pass absolute -left-[42%] top-[-10%] h-[120%] w-[58%] rounded-full bg-[linear-gradient(90deg,rgba(16,185,129,0),rgba(167,243,208,0.18)_26%,rgba(110,231,183,0.45)_48%,rgba(167,243,208,0.2)_70%,rgba(16,185,129,0))] blur-md" />
          </span>
        )}
        {dropHint && !isDraggedTask && (
          <div className={`pointer-events-none absolute left-2 right-2 ${dropHint === 'before' ? 'top-0.5' : 'bottom-0.5'} h-[2px] rounded-full bg-white/75 shadow-[0_0_12px_rgba(255,255,255,0.5)]`} />
        )}
        {task.subtasks.length > 0 ? (
          <button 
            onClick={(e) => { e.stopPropagation(); toggleTaskExpansion(task.id); }}
            className="doro-task-expand-btn p-1 text-white/40 hover:text-white transition-colors z-20 rounded hover:bg-white/10"
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
          className={`doro-task-check-target
            rounded-full border relative flex items-center justify-center transition-all duration-300 shrink-0 z-20
            w-5 h-5 border-[1.5px]
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
        
        <div className="doro-task-name-block flex-1 min-w-0 flex flex-col justify-center">
            <div className="doro-task-name-line flex items-center gap-2">
                <div className={`doro-task-title-text text-glass-text truncate transition-colors ${task.checked ? 'line-through' : (task.selected ? 'text-white' : 'group-hover:text-white')} font-medium text-sm`}>
                    {task.name}
                </div>
                {category && depth === 0 && (
                     <div className="doro-task-category-badge flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/10 border border-white/5">
                         <div className="w-3 h-3 text-white" style={{color: category.color}}>
                             {getIcon(category.icon)}
                         </div>
                         <span className="text-[9px] text-white/50 font-bold uppercase">{category.name}</span>
                     </div>
                )}
            </div>
          {task.color && !task.checked && (
             <div className={`w-full max-w-[60px] h-[2px] mt-1.5 rounded-full transition-opacity ${task.selected ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'}`} style={{ backgroundColor: task.color }} />
          )}
        </div>

        <div className="doro-task-pomo-pill text-glass-textMuted font-mono text-[10px] bg-black/20 px-2 py-0.5 rounded-md backdrop-blur-sm group-hover:bg-black/30 transition-colors border border-white/5">
          <span className={task.completed >= task.estimated ? 'text-green-400 font-bold' : ''}>{task.completed}</span>
          <span className="opacity-40 mx-0.5">/</span>
          <span>{task.estimated}</span>
        </div>

        <div className="doro-task-action-rail pointer-events-auto flex gap-0.5 opacity-0 group-hover:opacity-100 transition-all duration-300">
           <button 
             type="button"
             onClick={handleStartAddingSubtask}
             className="pointer-events-auto p-1.5 text-glass-text hover:text-white hover:bg-white/10 rounded transition-colors" title="Add Subtask"
           >
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
           </button>
          <button type="button" onClick={startEditing} className="pointer-events-auto p-1.5 text-glass-text hover:text-white hover:bg-white/10 rounded transition-colors" title="Edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button type="button" onClick={handleDelete} className="pointer-events-auto p-1.5 text-glass-text hover:text-red-300 hover:bg-red-500/20 rounded transition-colors" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <div className={isTopLevel ? 'pl-6 md:pl-8' : 'pl-5 md:pl-6'}>
        {isAddingSub && (
          <form onSubmit={handleAddSubtask} className="doro-subtask-form doro-soft-expand mb-2.5 flex flex-col gap-2 rounded-lg border border-white/10 bg-white/5 p-2.5 backdrop-blur-sm sm:flex-row sm:items-center">
            <input 
              autoFocus
              type="text" 
              placeholder="Subtask..." 
              className="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm font-medium text-glass-text placeholder-white/30 outline-none"
              value={subName}
              onChange={e => setSubName(e.target.value)}
            />
            <div className="doro-task-estimate-stepper flex items-center rounded-lg border border-white/15 bg-black/20 overflow-hidden">
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
            <button type="submit" className="doro-subtask-save-btn text-green-400 px-1 hover:scale-110 transition-transform" aria-label="Save subtask">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </form>
        )}

        {task.isExpanded && task.subtasks.length > 0 && (
          <div className="doro-soft-expand relative mt-1.5 space-y-2 border-l border-white/10 pl-4">
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
    workTime,
    breakTime,
    activeMode,
    isIdle,
    graceOpen,
    graceContext,
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
  const newTaskInputRef = useRef<HTMLInputElement | null>(null);
  const lastTaskSubmitRef = useRef<{ key: string; at: number } | null>(null);
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
  const activeCategories = useMemo(() => getActiveCategories(categories), [categories]);

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
  const visibleTasks = useMemo(
    () => filteredTasks
      .filter(task => showCompletedTasks || !task.checked || (keepSelectedCompletedVisible && hasSelectedTaskInSubtree(task))),
    [filteredTasks, keepSelectedCompletedVisible, showCompletedTasks]
  );
  const visibleTaskIds = useMemo(
    () => visibleTasks.map(task => task.id),
    [visibleTasks]
  );
  const filteredTaskIds = useMemo(() => visibleTaskIds, [visibleTaskIds]);
  const filteredTaskOrderKey = useMemo(() => filteredTaskIds.join('|'), [filteredTaskIds]);

  useEffect(() => {
    const currentIds = visibleTaskIds;
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

    requestAnimationFrame(() => {
      const lastAddedId = addedIds[addedIds.length - 1];
      const node = taskCardRefsRef.current.get(lastAddedId);
      node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });

    setEnteringTaskIds(prev => Array.from(new Set([...prev, ...addedIds])));
    const timeoutId = setTimeout(() => {
      setEnteringTaskIds(prev => prev.filter(id => !addedIds.includes(id)));
    }, 650);
    return () => clearTimeout(timeoutId);
  }, [visibleTaskIds]);

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
    if (newCatId === null) return;
    if (activeCategories.some((category) => category.id === newCatId)) return;
    setNewCatId(null);
  }, [activeCategories, newCatId]);

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
    if ((event.target as HTMLElement).closest('button')) return;
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

  const handleRequestNewCategory = useCallback(() => {
    if (categoryRailDragRef.current.suppressClick) return;
    requestNewCategoryFlow();
  }, [requestNewCategoryFlow]);

  const canSubmitNewTask = newName.trim().length > 0 || newCatId !== null;

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    const submittedName = (newTaskInputRef.current?.value ?? newName).trim();
    if (!submittedName && newCatId === null) return;

    const now = Date.now();
    const submitKey = `${submittedName}|${newCatId ?? 'none'}|${clampPomoEstimate(newEst)}|${newColor}`;
    const lastSubmit = lastTaskSubmitRef.current;
    if (lastSubmit?.key === submitKey && now - lastSubmit.at < 500) return;
    lastTaskSubmitRef.current = { key: submitKey, at: now };

    addTask(submittedName, clampPomoEstimate(newEst), newCatId, undefined, newColor);
    setNewName('');
    setNewEst(1);
    setIsPreviewingNewTaskColor(false);
  };

  const handleNewTaskKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    handleSubmit(e);
  };

  const isSectionActive = isHovered || isInputFocused;
  const shouldBlur = !isSectionActive && !settings.disableBlur;
  const blurClass = shouldBlur ? 'opacity-60' : 'opacity-100';
  const isCompactTimer = settings.timerPreset === 'compact';
  
  // Pomo Counter Logic
  const pomosPerSet = settings.longBreakInterval || 4;
  const pomoUnitLabel = getTimerPomoUnitLabel(settings).toLowerCase();
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

    const totalSeconds = getProjectedTaskFinishSeconds({
      remainingPomodoros: remainingTaskPomos,
      pomodoroCount,
      workTime,
      breakTime,
      activeMode,
      isIdle,
      graceOpen,
      graceContext,
      settings,
    });

    return formatFinishTime(new Date(Date.now() + totalSeconds * 1000));
  }, [activeMode, breakTime, graceContext, graceOpen, isIdle, pomodoroCount, remainingTaskPomos, settings, workTime]);

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
            max-height: var(--doro-task-edit-collapsed-height);
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: saturate(0.98);
          }
          62% {
            max-height: var(--doro-task-edit-expanded-height);
            opacity: 1;
            transform: translateY(-1px) scale(1.006);
            filter: saturate(1.03);
          }
          100% {
            max-height: var(--doro-task-edit-expanded-height);
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: saturate(1);
          }
        }
        .doro-task-edit-shell {
          max-height: var(--doro-task-edit-expanded-height);
          min-height: var(--doro-task-edit-collapsed-height);
          --doro-task-edit-collapsed-height: 2.875rem;
          --doro-task-edit-expanded-height: 24rem;
          --doro-task-edit-controls-height: 18rem;
          transform-origin: top center;
          will-change: max-height, transform, opacity, filter;
        }
        .doro-task-action-rail {
          width: 5.125rem;
          min-width: 5.125rem;
          justify-content: flex-end;
        }
        .doro-task-edit-open {
          animation: doro-task-edit-open ${TASK_EDIT_OPEN_DURATION_MS}ms cubic-bezier(0.18, 0.9, 0.32, 1.08);
        }
        @keyframes doro-task-edit-row-in {
          0% {
            opacity: 0.96;
            transform: translateY(0) scale(0.998);
          }
          62% {
            opacity: 1;
            transform: translateY(-0.5px) scale(1.002);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .doro-task-edit-open .doro-task-edit-row {
          animation: doro-task-edit-row-in ${TASK_EDIT_OPEN_DURATION_MS}ms cubic-bezier(0.18, 0.9, 0.32, 1.08);
          transform-origin: center;
        }
        .doro-task-edit-controls {
          max-height: var(--doro-task-edit-controls-height);
          overflow: hidden;
          transform-origin: top center;
          will-change: max-height, opacity, transform, padding, border-color;
        }
        @keyframes doro-task-edit-controls-in {
          0% {
            max-height: 0;
            opacity: 0;
            padding-top: 0;
            padding-bottom: 0;
            transform: translateY(6px) scale(0.985);
            border-color: rgba(255, 255, 255, 0);
          }
          62% {
            max-height: var(--doro-task-edit-controls-height);
            opacity: 1;
            padding-top: 0.75rem;
            padding-bottom: 0.75rem;
            transform: translateY(-1px) scale(1.008);
            border-color: rgba(255, 255, 255, 0.07);
          }
          100% {
            max-height: var(--doro-task-edit-controls-height);
            opacity: 1;
            padding-top: 0.75rem;
            padding-bottom: 0.75rem;
            transform: translateY(0) scale(1);
            border-color: rgba(255, 255, 255, 0.07);
          }
        }
        .doro-task-edit-open .doro-task-edit-controls {
          animation: doro-task-edit-controls-in ${TASK_EDIT_OPEN_DURATION_MS}ms cubic-bezier(0.18, 0.9, 0.32, 1.08);
        }
        @keyframes doro-task-edit-controls-out {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateY(6px) scale(0.975);
          }
        }
        @keyframes doro-task-edit-close-save {
          0% {
            max-height: var(--doro-task-edit-expanded-height);
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: brightness(1) saturate(1);
          }
          100% {
            max-height: var(--doro-task-edit-collapsed-height);
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: brightness(1) saturate(1);
          }
        }
        .doro-task-edit-close-save {
          animation: doro-task-edit-close-save ${TASK_EDIT_CLOSE_DURATION_MS}ms ease-in-out forwards;
          pointer-events: none;
        }
        .doro-task-edit-close-save .doro-task-edit-controls {
          animation: doro-task-edit-controls-out ${TASK_EDIT_CLOSE_DURATION_MS}ms ease-in-out forwards;
        }
        @keyframes doro-task-edit-close-cancel {
          0% {
            max-height: var(--doro-task-edit-expanded-height);
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: brightness(1) saturate(1);
          }
          100% {
            max-height: var(--doro-task-edit-collapsed-height);
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: brightness(1) saturate(1);
          }
        }
        .doro-task-edit-close-cancel {
          animation: doro-task-edit-close-cancel ${TASK_EDIT_CLOSE_DURATION_MS}ms ease-in-out forwards;
          pointer-events: none;
        }
        .doro-task-edit-close-cancel .doro-task-edit-controls {
          animation: doro-task-edit-controls-out ${TASK_EDIT_CLOSE_DURATION_MS}ms ease-in-out forwards;
        }
        @keyframes doro-task-edit-return-settle {
          0% {
            transform: translateY(1px) scale(0.998);
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
        @media (max-width: 767px) {
          .doro-task-edit-shell {
            --doro-task-edit-collapsed-height: 3.05rem;
            --doro-task-edit-expanded-height: 29rem;
            --doro-task-edit-controls-height: 22rem;
          }
          .doro-task-edit-row,
          .doro-task-card-row {
            gap: 0.55rem !important;
            padding: 0.75rem 0.65rem !important;
          }
          .doro-task-card-row {
            display: grid !important;
            grid-template-columns: 2rem 1.65rem minmax(0, 1fr) max-content max-content;
            align-items: center !important;
            column-gap: 0.5rem !important;
            min-height: 3.85rem;
            padding: 0.6rem 0.65rem !important;
          }
          .doro-task-card-row > .doro-task-expand-btn {
            grid-column: 1 / 2;
            justify-self: center;
            width: 2rem;
            height: 2rem;
            min-width: 2rem;
            min-height: 2rem;
            padding: 0 !important;
          }
          .doro-task-card-row > .doro-task-check-target {
            grid-column: 2 / 3;
            justify-self: center;
          }
          .doro-task-name-block {
            grid-column: 3 / 4;
            min-width: 0;
            width: 100%;
          }
          .doro-task-name-line {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.2rem !important;
            min-width: 0;
          }
          .doro-task-title-text {
            display: -webkit-box !important;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            width: 100%;
            white-space: normal !important;
            overflow: hidden !important;
            text-overflow: clip !important;
            line-height: 1.25;
            word-break: break-word;
            max-width: 100%;
          }
          .doro-task-category-badge {
            max-width: 100%;
          }
          .doro-task-category-badge span {
            max-width: 9.5rem;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .doro-task-pomo-pill {
            position: static;
            grid-column: 4 / 5;
            justify-self: end;
            align-self: center;
            min-width: 2.75rem;
            text-align: center;
            white-space: nowrap;
          }
          .doro-task-edit-row input,
          .doro-subtask-form input,
          .doro-task-create-input {
            font-size: 16px;
          }
          .doro-new-task-details.doro-new-task-details-open {
            max-height: 18.5rem !important;
          }
          .doro-task-expand-btn {
            min-width: 2rem;
            min-height: 2rem;
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
          .doro-task-check-target {
            width: 1.6rem !important;
            height: 1.6rem !important;
          }
          .doro-task-color-swatch {
            width: 1.38rem !important;
            height: 1.38rem !important;
          }
          .doro-task-category-chip,
          .doro-task-add-category-chip {
            min-height: 1.65rem;
            padding: 0.26rem 0.5rem !important;
            border-radius: 0.65rem !important;
          }
          .doro-task-edit-row .doro-task-action-rail {
            display: none;
          }
          .doro-task-card-row .doro-task-action-rail {
            position: static;
            grid-column: 5 / 6;
            justify-self: end;
            align-self: center;
            width: auto;
            min-width: max-content;
            gap: 0.16rem;
            opacity: 1;
          }
          .doro-task-action-rail button {
            min-width: 1.6rem;
            min-height: 1.6rem;
            flex: 0 0 1.6rem;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 0.55rem;
          }
          .doro-task-edit-controls {
            padding-left: 0.75rem !important;
            padding-right: 0.75rem !important;
          }
          .doro-task-picker-row {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 0.42rem !important;
            overflow: visible !important;
            padding-left: 0 !important;
          }
          .doro-task-picker-row > .flex.shrink-0 {
            flex-wrap: wrap;
            gap: 0.4rem !important;
            row-gap: 0.4rem !important;
          }
          .doro-task-edit-footer {
            align-items: center !important;
            gap: 0.5rem !important;
          }
          .doro-task-create-footer,
          .doro-task-edit-footer {
            flex-direction: row !important;
            align-items: center !important;
            justify-content: space-between !important;
            gap: 0.5rem !important;
            flex-wrap: nowrap;
          }
          .doro-task-edit-footer > div:first-child {
            flex: 0 1 auto;
            min-width: 0;
            gap: 0.45rem !important;
          }
          .doro-task-create-estimate {
            flex: 0 1 auto;
            min-width: 0;
            gap: 0.45rem !important;
          }
          .doro-task-create-actions,
          .doro-task-edit-footer > div:last-child {
            flex: 0 0 auto;
            gap: 0.4rem !important;
            align-items: center;
            white-space: nowrap;
          }
          .doro-task-create-footer button,
          .doro-task-edit-footer button,
          .doro-task-estimate-stepper button {
            min-height: 2rem;
          }
          .doro-task-estimate-stepper {
            align-self: flex-start;
          }
          .doro-task-create-footer .doro-task-estimate-stepper,
          .doro-task-edit-footer .doro-task-estimate-stepper {
            align-self: center;
            height: 2rem;
          }
          .doro-task-create-footer .doro-task-estimate-stepper button,
          .doro-task-edit-footer .doro-task-estimate-stepper button {
            padding-left: 0.44rem !important;
            padding-right: 0.44rem !important;
          }
          .doro-task-estimate-stepper button {
            min-width: 2rem;
          }
          .doro-task-estimate-stepper input {
            min-width: 2rem;
            height: 2rem;
            font-size: 16px;
          }
          .doro-task-create-footer .doro-task-estimate-stepper button,
          .doro-task-edit-footer .doro-task-estimate-stepper button {
            min-width: 2rem;
            width: 2rem;
          }
          .doro-task-create-footer .doro-task-estimate-stepper input,
          .doro-task-edit-footer .doro-task-estimate-stepper input {
            min-width: 2rem;
            width: 2rem;
            height: 2rem;
          }
          .doro-task-schedule-btn {
            min-height: 2rem;
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
          .doro-task-create-footer .doro-task-schedule-btn,
          .doro-task-create-actions button {
            min-height: 2rem;
            height: 2rem;
            padding-top: 0 !important;
            padding-bottom: 0 !important;
          }
          .doro-task-create-footer .doro-task-schedule-btn {
            padding-left: 0.62rem !important;
            padding-right: 0.62rem !important;
          }
          .doro-task-create-actions button[type="submit"] {
            padding-left: 0.82rem !important;
            padding-right: 0.82rem !important;
          }
          .doro-task-edit-footer > div:last-child button {
            min-height: 2rem;
            height: 2rem;
            padding-top: 0 !important;
            padding-bottom: 0 !important;
          }
          .doro-task-edit-footer > div:last-child button:first-child {
            padding-left: 0.68rem !important;
            padding-right: 0.68rem !important;
          }
          .doro-task-edit-footer > div:last-child button:last-child {
            padding-left: 0.86rem !important;
            padding-right: 0.86rem !important;
          }
          .doro-subtask-form {
            padding: 0.65rem !important;
            gap: 0.55rem !important;
          }
          .doro-subtask-form .doro-task-estimate-stepper {
            align-self: stretch;
            justify-content: center;
          }
          .doro-subtask-save-btn {
            min-width: 2.15rem;
            min-height: 2.15rem;
            align-self: flex-end;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 0.65rem;
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.08);
          }
        }
      `}</style>
      <div 
        className="w-full max-w-lg mx-auto min-h-[20rem] md:min-h-[25rem] transition-opacity duration-250"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
      <div className="relative flex min-h-[20rem] md:min-h-[25rem] flex-col">
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
                  ref={newTaskInputRef}
                  data-testid="task-create-input"
                  type="text" 
                  placeholder={isInputFocused ? "Describe task..." : "+ New Task"} 
                  className="doro-task-create-input min-w-0 flex-1 bg-transparent px-4 py-2 text-glass-text placeholder-white/30 outline-none font-medium text-sm"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={handleNewTaskKeyDown}
                />
                
                 {!isInputFocused && (
                    <button 
                        type="button" 
                        onPointerDown={(e) => {
                            e.preventDefault();
                            setWeeklyScheduleOpen(true);
                        }}
                        onClick={() => setWeeklyScheduleOpen(true)}
                        className="doro-task-schedule-btn mr-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white rounded-lg text-[10px] uppercase tracking-wider font-bold transition-all border border-transparent hover:border-white/10"
                    >
                        Schedule
                    </button>
                 )}
            </div>
            
            <div className={`doro-new-task-details ${isInputFocused ? 'doro-new-task-details-open' : ''}
              overflow-hidden border-t transition-[max-height,opacity,padding,border-color] duration-300 ease-in-out
              ${isInputFocused ? 'doro-soft-expand max-h-40 border-white/5 opacity-100 py-2 px-4' : 'max-h-0 border-white/0 opacity-0 py-0 px-4'}
            `}>
              <div className="flex flex-col gap-3">
                  {/* Category & Color Selection */}
                  <div className="doro-task-picker-row flex items-center gap-2 overflow-hidden pl-1 py-1">
                      <div className="flex shrink-0 items-center gap-1.5">
                          {PRESET_COLORS.map(c => (
                            <button
                              key={c}
                              type="button"
                              onPointerDown={(event) => event.preventDefault()}
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

                      <div
                        className={getCategoryTrayClass(Boolean(newCatId), isCategoryRailDragging ? 'cursor-grabbing select-none' : 'cursor-grab')}
                        style={{ touchAction: 'pan-y' }}
                        onPointerDown={handleCategoryRailPointerDown}
                        onPointerMove={handleCategoryRailPointerMove}
                        onPointerUp={handleCategoryRailPointerUp}
                        onPointerCancel={handleCategoryRailPointerCancel}
                        onLostPointerCapture={handleCategoryRailPointerCancel}
                        onClick={handleCategoryRailClick}
                      >
                        <div className="flex w-max items-center gap-1 pr-1">
                            {activeCategories.map(cat => (
                                <button
                                  key={cat.id}
                                  type="button"
                                  onPointerDown={(event) => event.preventDefault()}
                                  onClick={() => handleCategorySelect(cat.id, cat.color)}
                                  className={getCategoryChipClass(newCatId === cat.id)}
                                >
                                    <div className="w-3 h-3 text-white" style={{color: cat.color}}>{getIcon(cat.icon)}</div>
                                    <span className="text-[9px] text-white font-bold">{cat.name}</span>
                                </button>
                            ))}
                          <button
                            type="button"
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              handleRequestNewCategory();
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleRequestNewCategory();
                            }}
                            className={ADD_CATEGORY_CHIP_CLASS}
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
                      </div>
                  </div>

                  <div className="doro-task-create-footer flex justify-between items-center">
                    <div className="doro-task-create-estimate flex items-center gap-2 text-[10px] text-white/60 font-mono tracking-wide">
                      <span className="font-bold">EST</span>
                      <div className="doro-task-estimate-stepper flex items-center rounded-lg border border-white/20 bg-black/20 overflow-hidden">
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
                    
                    <div className="doro-task-create-actions flex gap-2">
                        <button 
                            type="button" 
                            onPointerDown={(event) => event.preventDefault()}
                            onClick={() => setWeeklyScheduleOpen(true)}
                            className="doro-task-schedule-btn px-3 py-1 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded-lg text-[10px] uppercase tracking-wider font-bold transition-all border border-white/5"
                        >
                            Schedule
                        </button>
                        <button 
                            type="submit"
                            data-testid="task-create-add"
                            disabled={!canSubmitNewTask}
                            onPointerDown={(event) => event.preventDefault()}
                            className={`px-4 py-1 text-[10px] rounded-lg font-bold transition-all shadow-lg active:scale-95 uppercase tracking-wider ${
                              canSubmitNewTask
                                ? 'bg-white text-black hover:bg-gray-200'
                                : 'cursor-not-allowed bg-white/20 text-white/35 shadow-none'
                            }`}
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
          className={`flex-1 min-h-0 -mx-2 space-y-3 overflow-y-auto px-2 pt-2 pb-10 scrollbar-hide transition-opacity duration-250 ${blurClass} ${draggingTaskId ? 'doro-task-list-drag-active' : ''}`}
        >
          {visibleTasks.map(task => (
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
            pt-3 pb-1 border-t border-white/5 grid grid-cols-3 items-center
            text-center uppercase font-bold text-white/45
            transition-opacity duration-250 ${blurClass}
            ${isCompactTimer
              ? 'gap-2 [font-size:clamp(7px,1.35vw,9px)] tracking-[0.1em]'
              : 'gap-1 whitespace-nowrap [font-size:clamp(7px,1.8vw,10px)] tracking-[0.13em]'
            }
        `}>
            <div className={`min-w-0 items-center justify-center ${isCompactTimer ? 'flex flex-col gap-0.5 leading-tight' : 'flex gap-1'}`}>
                {isCompactTimer ? (
                    <>
                        <span className="truncate">long break in</span>
                        <span className={`leading-none font-mono font-bold ${untilLongBreak === 1 ? 'text-yellow-200' : 'text-white/80'}`}>{untilLongBreak}</span>
                    </>
                ) : (
                    <>
                        <span className={`leading-none font-mono font-bold ${untilLongBreak === 1 ? 'text-yellow-200' : 'text-white/80'}`}>{untilLongBreak}</span>
                        <span className="truncate">until long break</span>
                    </>
                )}
            </div>
            <div className={`min-w-0 items-center justify-center ${isCompactTimer ? 'flex flex-col gap-0.5 leading-tight' : 'flex gap-1'}`}>
                <span className="truncate">time finished</span>
                <span className="leading-none font-mono font-bold text-white/80">{predictedFinishTime}</span>
            </div>
            <div className={`min-w-0 items-center justify-center ${isCompactTimer ? 'flex flex-col gap-0.5 leading-tight' : 'flex gap-1'}`}>
                <span className="truncate">total {pomoUnitLabel}</span>
                <span className="leading-none font-mono font-bold text-white/80">{pomodoroCount}</span>
            </div>
        </div>

      </div>
      </div>
    </>
  );
};

export default Tasks;
