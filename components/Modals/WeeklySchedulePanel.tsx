import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, CalendarPlus, Eye, X } from 'lucide-react';
import { useTimer } from '../../context/TimerContext';
import { Category, Task } from '../../types';
import { PASTEL_SWATCHES as PRESET_COLORS } from '../../utils/palette';
import { getIcon } from '../../utils/icons';
import { getTimerPomoUnitLabel } from '../../utils/pomodoroAccounting';
import TaskCategoryPicker from '../TaskCategoryPicker';

const clampEstimate = (value: number, step = 1) => {
  const safeStep = step === 0.5 ? 0.5 : 1;
  if (!Number.isFinite(value)) return safeStep;
  const rounded = Math.round(value / safeStep) * safeStep;
  return Math.min(99, Math.max(safeStep, rounded));
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const getDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const parseDateKey = (value: string) => {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

const formatRangeLabel = (start: Date, end: Date) => {
  const startLabel = start.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const endLabel = end.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${startLabel} - ${endLabel}`;
};

const buildDayRange = (start: Date, end: Date, todayKey: string) => {
  const days: Array<{
    key: string;
    label: string;
    dayNumber: number;
    monthLabel: string;
    fullLabel: string;
    isToday: boolean;
  }> = [];

  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const endKey = getDateKey(end);

  while (getDateKey(cursor) <= endKey) {
    const key = getDateKey(cursor);
    days.push({
      key,
      label: cursor.toLocaleDateString([], { weekday: 'short' }).toUpperCase(),
      dayNumber: cursor.getDate(),
      monthLabel: cursor.toLocaleDateString([], { month: 'short' }).toUpperCase(),
      fullLabel: cursor.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }),
      isToday: key === todayKey,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
};

const getPredictedPomos = (task: Task) => {
  if (task.checked) return 0;
  return Math.max(1, task.estimated - task.completed);
};
const formatPomoLabel = (count: number, unitLabel: string) => `${count} ${unitLabel.toUpperCase()}`;
type DragInsertPosition = 'before' | 'after';
const DRAG_DEAD_ZONE_MIN_PX = 14;
const DRAG_DEAD_ZONE_RATIO = 0.34;
const REORDER_MIN_INTERVAL_MS = 96;
const FLIP_ANIMATION_DURATION_MS = 165;
const FLIP_MAX_ITEMS = 120;
const ADD_TASK_FORM_CLOSE_DURATION_MS = 420;
const SCHEDULE_TASK_EDIT_CLOSE_DURATION_MS = 420;
const SCHEDULE_TASK_EDIT_SETTLE_DURATION_MS = 220;
const DEFAULT_SCHEDULE_LOOKAHEAD_DAYS = 3;
const EXTENDED_SCHEDULE_LOOKAHEAD_DAYS = 21;
const HISTORY_LOOKBACK_DAYS = 21;

const colorToRgba = (color: string, alpha: number) => {
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  const normalized = color.trim();

  if (/^#([0-9a-f]{3})$/i.test(normalized)) {
    const hex = normalized.slice(1);
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
  }

  if (/^#([0-9a-f]{6})$/i.test(normalized)) {
    const hex = normalized.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
  }

  const rgbMatch = normalized.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/i);
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${safeAlpha})`;
  }

  const rgbaMatch = normalized.match(/^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/i);
  if (rgbaMatch) {
    return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${safeAlpha})`;
  }

  return `rgba(125, 83, 162, ${safeAlpha})`;
};

const ScheduleCategoryBadge: React.FC<{
  category: Category;
  muted?: boolean;
}> = ({ category, muted = false }) => (
  <div className={`inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 ${
    muted ? 'border-white/8 bg-white/[0.04] text-white/38' : 'border-white/10 bg-white/[0.06] text-white/60'
  }`}>
    <div className="w-3 h-3" style={{ color: category.color }}>
      {getIcon(category.icon, { size: 12 })}
    </div>
    <span className="truncate text-[9px] font-bold uppercase tracking-[0.12em]">{category.name}</span>
  </div>
);

const ScheduleTaskCard: React.FC<{
  task: Task;
  categories: Category[];
  onRequestNewCategory: () => void;
  onDragStart: (taskId: number) => void;
  onDragHover: (taskId: number, position: DragInsertPosition) => void;
  onDragEnd: () => void;
  onSave: (task: Task) => void;
  isLightTheme?: boolean;
  isDragging?: boolean;
  dropHint?: DragInsertPosition | null;
  isDropAnimating?: boolean;
  isEntering?: boolean;
  registerCardRef?: (taskId: number, node: HTMLDivElement | null) => void;
  pomoUnitLabel: string;
  pluralPomoUnitLabel: string;
}> = ({
  task,
  categories,
  onRequestNewCategory,
  onDragStart,
  onDragHover,
  onDragEnd,
  onSave,
  isLightTheme = false,
  isDragging = false,
  dropHint = null,
  isDropAnimating = false,
  isEntering = false,
  registerCardRef,
  pomoUnitLabel,
  pluralPomoUnitLabel,
}) => {
  const estimateStep = pomoUnitLabel === 'Mini-Pomo' ? 1 : 0.5;
  const [isEditing, setIsEditing] = useState(false);
  const [editCloseState, setEditCloseState] = useState<'save' | 'cancel' | null>(null);
  const [isSettlingAfterEdit, setIsSettlingAfterEdit] = useState(false);
  const [name, setName] = useState(task.name);
  const [estimated, setEstimated] = useState(task.estimated);
  const [color, setColor] = useState(task.color || PRESET_COLORS[0]);
  const [categoryId, setCategoryId] = useState<number | null>(task.categoryId ?? null);
  const editCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCompleted = Boolean(task.checked);

  useEffect(() => {
    if (!isEditing) {
      setName(task.name);
      setEstimated(task.estimated);
      setColor(task.color || PRESET_COLORS[0]);
      setCategoryId(task.categoryId ?? null);
    }
  }, [task, isEditing]);

  useEffect(() => {
    return () => {
      if (editCloseTimeoutRef.current) clearTimeout(editCloseTimeoutRef.current);
      if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
    };
  }, []);

  const predictedPomos = getPredictedPomos(task);
  const displayColor = task.color || PRESET_COLORS[0];
  const taskCategory = useMemo(
    () => categories.find((category) => category.id === task.categoryId) || null,
    [categories, task.categoryId]
  );
  const additionalHeight = isCompleted ? 0 : Math.min(44, Math.max(0, predictedPomos - 1) * 8);
  const taskGlassStyle = useMemo(() => ({
    background: isCompleted
      ? isLightTheme
        ? `linear-gradient(145deg, ${colorToRgba(displayColor, 0.38)} 0%, ${colorToRgba(displayColor, 0.2)} 42%, rgba(255, 255, 255, 0.72) 100%)`
        : `linear-gradient(142deg, ${colorToRgba(displayColor, 0.14)} 0%, ${colorToRgba(displayColor, 0.1)} 46%, ${colorToRgba(displayColor, 0.06)} 100%)`
      : isLightTheme
        ? `linear-gradient(145deg, ${colorToRgba(displayColor, 0.58)} 0%, ${colorToRgba(displayColor, 0.34)} 40%, rgba(255, 255, 255, 0.66) 100%)`
        : `linear-gradient(142deg, ${colorToRgba(displayColor, 0.38)} 0%, ${colorToRgba(displayColor, 0.24)} 46%, ${colorToRgba(displayColor, 0.15)} 100%)`,
    borderColor: isCompleted
      ? colorToRgba(displayColor, isLightTheme ? 0.42 : 0.24)
      : colorToRgba(displayColor, isLightTheme ? 0.62 : 0.5),
    boxShadow: isCompleted
      ? isLightTheme
        ? `inset 0 1px 0 rgba(255, 255, 255, 0.74), inset 0 -1px 0 ${colorToRgba(displayColor, 0.16)}, 0 16px 26px -22px ${colorToRgba(displayColor, 0.34)}`
        : `inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 8px 20px -20px ${colorToRgba(displayColor, 0.32)}`
      : isLightTheme
        ? `inset 0 1px 0 rgba(255, 255, 255, 0.86), inset 0 -1px 0 ${colorToRgba(displayColor, 0.18)}, 0 20px 32px -20px ${colorToRgba(displayColor, 0.5)}`
        : `inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 10px 24px -18px ${colorToRgba(displayColor, 0.88)}`,
    backdropFilter: isLightTheme ? 'blur(24px) saturate(182%)' : undefined,
    WebkitBackdropFilter: isLightTheme ? 'blur(24px) saturate(182%)' : undefined,
    minHeight: `${58 + additionalHeight}px`,
  }), [displayColor, additionalHeight, isCompleted, isLightTheme]);
  const taskTintStyle = useMemo(() => ({
    background: isCompleted
      ? isLightTheme
        ? `radial-gradient(circle at 14% 10%, ${colorToRgba(displayColor, 0.26)} 0%, transparent 44%), radial-gradient(circle at 100% 0%, rgba(255, 255, 255, 0.76) 0%, transparent 34%), linear-gradient(135deg, ${colorToRgba(displayColor, 0.14)} 0%, transparent 56%, ${colorToRgba(displayColor, 0.1)} 100%)`
        : `radial-gradient(circle at 14% 10%, ${colorToRgba(displayColor, 0.18)} 0%, transparent 44%), linear-gradient(135deg, ${colorToRgba(displayColor, 0.12)} 0%, transparent 56%, ${colorToRgba(displayColor, 0.08)} 100%)`
      : isLightTheme
        ? `radial-gradient(circle at 16% 8%, ${colorToRgba(displayColor, 0.34)} 0%, transparent 46%), radial-gradient(circle at 100% 0%, rgba(255, 255, 255, 0.82) 0%, transparent 34%), linear-gradient(135deg, ${colorToRgba(displayColor, 0.22)} 0%, transparent 48%, ${colorToRgba(displayColor, 0.16)} 100%)`
        : `radial-gradient(circle at 16% 8%, ${colorToRgba(displayColor, 0.24)} 0%, transparent 46%), linear-gradient(135deg, ${colorToRgba(displayColor, 0.18)} 0%, transparent 48%, ${colorToRgba(displayColor, 0.14)} 100%)`,
  }), [displayColor, isCompleted, isLightTheme]);
  const taskAccentStyle = useMemo(() => ({
    background: `linear-gradient(90deg, ${colorToRgba(displayColor, isCompleted ? (isLightTheme ? 0.68 : 0.52) : (isLightTheme ? 0.92 : 0.82))} 0%, ${colorToRgba(displayColor, isLightTheme ? 0.36 : 0.2)} 100%)`,
    boxShadow: `0 0 16px ${colorToRgba(displayColor, isLightTheme ? 0.28 : 0.22)}`,
  }), [displayColor, isCompleted, isLightTheme]);
  const entryGlowStyle = useMemo(() => ({
    background: isLightTheme
      ? `radial-gradient(circle at 16% 8%, ${colorToRgba(displayColor, 0.28)} 0%, transparent 42%), linear-gradient(180deg, rgba(255,255,255,0.32), transparent 38%)`
      : `radial-gradient(circle at 16% 8%, ${colorToRgba(displayColor, 0.24)} 0%, transparent 42%), linear-gradient(180deg, rgba(255,255,255,0.14), transparent 38%)`,
  }), [displayColor, isLightTheme]);
  const entrySheenStyle = useMemo(() => ({
    background: `linear-gradient(112deg, transparent 0%, ${colorToRgba(displayColor, isLightTheme ? 0.16 : 0.2)} 28%, rgba(255,255,255,${isLightTheme ? '0.68' : '0.26'}) 48%, transparent 72%)`,
  }), [displayColor, isLightTheme]);
  const startEditClose = (state: 'save' | 'cancel') => {
    if (editCloseState) return;
    setEditCloseState(state);
    if (editCloseTimeoutRef.current) clearTimeout(editCloseTimeoutRef.current);
    editCloseTimeoutRef.current = setTimeout(() => {
      setIsEditing(false);
      setEditCloseState(null);
      setIsSettlingAfterEdit(true);
      if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
      settleTimeoutRef.current = setTimeout(() => setIsSettlingAfterEdit(false), SCHEDULE_TASK_EDIT_SETTLE_DURATION_MS);
    }, SCHEDULE_TASK_EDIT_CLOSE_DURATION_MS);
  };

  const startEdit = () => {
    if (editCloseTimeoutRef.current) clearTimeout(editCloseTimeoutRef.current);
    if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
    setName(task.name);
    setEstimated(task.estimated);
    setColor(task.color || PRESET_COLORS[0]);
    setCategoryId(task.categoryId ?? null);
    setEditCloseState(null);
    setIsSettlingAfterEdit(false);
    setIsEditing(true);
  };

  if (isEditing) {
    return (
      <div className={`doro-weekly-task-editor doro-task-composer-shell rounded-xl border border-white/15 bg-black/30 p-2.5 ${
        editCloseState ? 'doro-weekly-task-editor-close' : 'doro-weekly-task-editor-open'
      }`}>
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full bg-transparent border-b border-white/20 pb-1 text-sm text-white outline-none focus:border-white/45"
        />
        <div className="mt-2 flex items-center gap-2">
          <div className="flex items-center rounded-md border border-white/15 bg-black/20 overflow-hidden">
            <button
              type="button"
              onClick={() => setEstimated(prev => clampEstimate(prev - estimateStep, estimateStep))}
              className="schedule-glass-button schedule-glass-button--icon px-2 py-1 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Decrease predicted pomodoros"
            >
              -
            </button>
            <div className="w-8 text-center text-xs text-white font-mono font-bold">{estimated}</div>
            <button
              type="button"
              onClick={() => setEstimated(prev => clampEstimate(prev + estimateStep, estimateStep))}
              className="schedule-glass-button schedule-glass-button--icon px-2 py-1 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Increase predicted pomodoros"
            >
              +
            </button>
          </div>
        </div>
        <div className="mt-2">
          <TaskCategoryPicker
            categories={categories}
            selectedCategoryId={categoryId}
            selectedColor={color}
            onColorSelect={(nextColor) => {
              setColor(nextColor);
              setCategoryId(null);
            }}
            onCategorySelect={(category) => {
              setCategoryId(category.id);
              setColor(category.color);
            }}
            onRequestNewCategory={onRequestNewCategory}
            swatchSize="sm"
            stretchCategoryTray={false}
          />
        </div>
        <div className="mt-2 flex justify-end gap-1.5">
          <button
            type="button"
            onClick={() => startEditClose('cancel')}
            className="schedule-glass-button schedule-glass-button--ghost px-2.5 py-1 rounded-md border border-white/10 text-[10px] uppercase tracking-[0.14em] text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onSave({
                ...task,
                name: name.trim() || task.name,
                estimated: clampEstimate(estimated, estimateStep),
                color,
                categoryId,
              });
              startEditClose('save');
            }}
            className="schedule-glass-button schedule-glass-button--primary px-2.5 py-1 rounded-md border border-teal-100/35 bg-teal-300/20 text-[10px] uppercase tracking-[0.14em] font-bold text-teal-50 hover:bg-teal-300/30 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={registerCardRef ? (node) => registerCardRef(task.id, node) : undefined}
      draggable={!isCompleted}
      onDragStart={(event) => {
        if (isCompleted) {
          event.preventDefault();
          return;
        }
        const dragTarget = event.target as HTMLElement;
        if (dragTarget.closest('button, input, textarea, select, a, form')) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData('text/plain', String(task.id));
        event.dataTransfer.effectAllowed = 'move';
        onDragStart(task.id);
      }}
      onDragOver={(event) => {
        if (isCompleted) return;
        if (isDragging) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const rect = event.currentTarget.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const deadZone = Math.max(DRAG_DEAD_ZONE_MIN_PX, rect.height * DRAG_DEAD_ZONE_RATIO);
        if (Math.abs(event.clientY - midpoint) <= deadZone) return;
        const position: DragInsertPosition = event.clientY < midpoint ? 'before' : 'after';
        onDragHover(task.id, position);
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDragEnd();
      }}
      onDragEnd={onDragEnd}
      className={`schedule-task-card group relative rounded-xl border p-2.5 transition-[transform,opacity,background-color,border-color] duration-200 ${
        isCompleted
          ? 'schedule-task-card-completed cursor-default opacity-55'
          : 'cursor-grab active:cursor-grabbing hover:bg-white/[0.08] hover:border-white/20'
      } ${isDragging ? 'doro-dragging-card' : ''} ${isDropAnimating ? 'doro-drop-pop' : ''} ${isEntering ? 'doro-schedule-create' : ''} ${isSettlingAfterEdit ? 'doro-edit-close-settle' : ''}`}
      style={taskGlassStyle}
    >
      {dropHint && !isDragging && (
        <div className={`pointer-events-none absolute left-2 right-2 ${dropHint === 'before' ? 'top-0.5' : 'bottom-0.5'} h-[2px] rounded-full bg-white/75 shadow-[0_0_12px_rgba(255,255,255,0.55)]`} />
      )}
      {isEntering && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
          <div className="absolute inset-0 rounded-xl doro-schedule-create-glow" style={entryGlowStyle} />
          <div className="absolute -bottom-8 -left-1/2 top-[-18%] w-[72%] doro-schedule-create-sheen" style={entrySheenStyle} />
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 rounded-xl" style={taskTintStyle} />
      <div className="pointer-events-none absolute left-3 right-10 top-[1px] h-[2px] rounded-full opacity-95" style={taskAccentStyle} />
      <div className="pointer-events-none absolute inset-0 rounded-xl bg-[linear-gradient(160deg,rgba(255,255,255,0.35),rgba(255,255,255,0.08)_34%,rgba(255,255,255,0)_64%)] opacity-60" />
      <div className="relative z-10 pr-24 sm:pr-28">
        {taskCategory && (
          <div className="absolute right-0 top-0 max-w-[calc(100%-5rem)]">
            <ScheduleCategoryBadge category={taskCategory} muted={isCompleted} />
          </div>
        )}
        <div className={`schedule-task-title text-[16px] leading-tight font-bold truncate ${isCompleted ? 'text-white/45 line-through decoration-white/45 decoration-2' : 'text-white'}`}>{task.name}</div>
        <div className={`schedule-task-meta mt-1 text-[9px] uppercase tracking-[0.1em] font-sans font-medium ${isCompleted ? 'text-white/30' : 'text-white/45'}`}>
          {isCompleted ? 'Completed' : formatPomoLabel(predictedPomos, predictedPomos === 1 ? pomoUnitLabel : pluralPomoUnitLabel)}
        </div>
      </div>
      {!isCompleted && (
        <button
          type="button"
          onClick={startEdit}
          className="schedule-glass-button schedule-glass-button--icon schedule-task-edit-button absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 w-6 h-6 rounded-md border border-white/10 bg-white/5 text-white/60 hover:text-white hover:bg-white/10 transition-all flex items-center justify-center z-10"
          aria-label="Edit task"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      )}
    </div>
  );
};

interface WeeklySchedulePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const WeeklySchedulePanel: React.FC<WeeklySchedulePanelProps> = ({ isOpen, onClose }) => {
  const {
    tasks,
    updateTask,
    moveTask,
    addDetailedTask,
    activeColor,
    settings,
    categories,
    requestNewCategoryFlow,
    showCompletedTasks,
    setShowCompletedTasks,
  } = useTimer();
  const isLightTheme = settings.themeMode !== 'dark';
  const pomoUnitLabel = getTimerPomoUnitLabel(settings, false);
  const pluralPomoUnitLabel = getTimerPomoUnitLabel(settings);
  const taskEstimateStep = settings.timerPreset === 'compact' ? 1 : 0.5;
  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);
  const [hoveredTaskTarget, setHoveredTaskTarget] = useState<{ taskId: number; position: DragInsertPosition } | null>(null);
  const [dropAnimatedTaskId, setDropAnimatedTaskId] = useState<number | null>(null);
  const [dropAnimatedDayKey, setDropAnimatedDayKey] = useState<string | null>(null);
  const [enteringTaskIds, setEnteringTaskIds] = useState<number[]>([]);
  const [hoveredLane, setHoveredLane] = useState<string | null>(null);
  const [addingDate, setAddingDate] = useState<string | null>(null);
  const [closingAddDate, setClosingAddDate] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [extendSchedule, setExtendSchedule] = useState(false);
  const [showUnscheduled, setShowUnscheduled] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskEst, setNewTaskEst] = useState(1);
  const [newTaskColor, setNewTaskColor] = useState(activeColor || PRESET_COLORS[0]);
  const [newTaskCategoryId, setNewTaskCategoryId] = useState<number | null>(null);
  const [todayKey, setTodayKey] = useState(() => getDateKey(new Date()));
  const openAtRef = useRef<number>(0);
  const todayAnchorRef = useRef<HTMLDivElement | null>(null);
  const dropAnimTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addFormCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entryAnimTimeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const lastHoverMoveKeyRef = useRef<string | null>(null);
  const lastReorderAtRef = useRef<number>(0);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const cardRefsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const previousCardTopsRef = useRef<Map<number, number>>(new Map());
  const flipAnimationsRef = useRef<Map<number, Animation>>(new Map());
  const todayDate = useMemo(() => parseDateKey(todayKey), [todayKey]);

  useEffect(() => {
    if (!isOpen) return undefined;
    setTodayKey(getDateKey(new Date()));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    return () => {
      if (dropAnimTimeoutRef.current) clearTimeout(dropAnimTimeoutRef.current);
      if (addFormCloseTimeoutRef.current) clearTimeout(addFormCloseTimeoutRef.current);
      entryAnimTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
      entryAnimTimeoutsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setHoveredLane(null);
      setDraggingTaskId(null);
      setHoveredTaskTarget(null);
      setDropAnimatedTaskId(null);
      setDropAnimatedDayKey(null);
      setEnteringTaskIds([]);
      setAddingDate(null);
      setClosingAddDate(null);
      if (addFormCloseTimeoutRef.current) clearTimeout(addFormCloseTimeoutRef.current);
      setShowHistory(false);
      setExtendSchedule(false);
      setShowUnscheduled(false);
      lastHoverMoveKeyRef.current = null;
      entryAnimTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
      entryAnimTimeoutsRef.current.clear();
      previousCardTopsRef.current = new Map();
      openAtRef.current = 0;
      return;
    }
    openAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
    setNewTaskName('');
    setNewTaskEst(1);
    setNewTaskColor(activeColor || PRESET_COLORS[0]);
    setNewTaskCategoryId(null);
    setShowHistory(false);
    setExtendSchedule(false);
    setShowUnscheduled(false);
  }, [isOpen, activeColor]);

  useEffect(() => {
    if (!isOpen) return;
    const currentTodayKey = getDateKey(new Date());
    const unscheduledActive = tasks.filter(task => !task.checked && !task.isFuture && !task.scheduledDate);
    if (unscheduledActive.length === 0) return;
    unscheduledActive.forEach(task => updateTask({ ...task, scheduledDate: currentTodayKey }));
  }, [isOpen, tasks, todayKey, updateTask]);

  useEffect(() => {
    if (!isOpen) return;
    const currentTodayKey = getDateKey(new Date());
    const overdueOpenTasks = tasks.filter((task) => (
      !task.checked
      && typeof task.scheduledDate === 'string'
      && task.scheduledDate < currentTodayKey
    ));
    if (overdueOpenTasks.length === 0) return;
    overdueOpenTasks.forEach((task) => {
      updateTask({
        ...task,
        scheduledDate: currentTodayKey,
        isFuture: false,
      });
    });
  }, [isOpen, tasks, todayKey, updateTask]);

  const rootOpenTasks = useMemo(() => tasks.filter((task) => !task.checked), [tasks]);
  const rootScheduledTasks = useMemo(() => tasks.filter((task) => Boolean(task.scheduledDate)), [tasks]);
  const visibleScheduledTasks = useMemo(() => {
    if (showCompletedTasks) return rootScheduledTasks;
    return rootScheduledTasks.filter((task) => !task.checked);
  }, [rootScheduledTasks, showCompletedTasks]);
  const rootOpenTaskIds = useMemo(() => rootOpenTasks.map((task) => task.id), [rootOpenTasks]);
  const rootOpenTaskLayoutKey = useMemo(
    () => rootOpenTasks.map((task) => `${task.id}:${task.scheduledDate || 'unscheduled'}`).join('|'),
    [rootOpenTasks]
  );

  const dayRange = useMemo(() => {
    const mondayOffset = (todayDate.getDay() + 6) % 7;
    const weekStart = new Date(todayDate);
    weekStart.setDate(todayDate.getDate() - mondayOffset);
    const weekEnd = addDays(weekStart, 6);

    let start = showHistory ? addDays(todayDate, -HISTORY_LOOKBACK_DAYS) : new Date(todayDate);
    let end = extendSchedule
      ? addDays(weekEnd, EXTENDED_SCHEDULE_LOOKAHEAD_DAYS)
      : addDays(weekEnd, DEFAULT_SCHEDULE_LOOKAHEAD_DAYS);

    const scheduledKeys = visibleScheduledTasks
      .map(task => task.scheduledDate)
      .filter((value): value is string => !!value)
      .sort();

    if (showHistory && scheduledKeys.length > 0) {
      const firstDate = parseDateKey(scheduledKeys[0]);
      if (getDateKey(firstDate) < getDateKey(start)) start = addDays(firstDate, -3);
    }
    if (extendSchedule && scheduledKeys.length > 0) {
      const lastDate = parseDateKey(scheduledKeys[scheduledKeys.length - 1]);
      if (getDateKey(lastDate) > getDateKey(end)) end = addDays(lastDate, 3);
    }

    return buildDayRange(start, end, todayKey);
  }, [visibleScheduledTasks, todayKey, todayDate, showHistory, extendSchedule]);
  const dayRangeKey = useMemo(() => dayRange.map((day) => day.key).join('|'), [dayRange]);

  useEffect(() => {
    if (!isOpen) return;
    const timeout = setTimeout(() => {
      todayAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => clearTimeout(timeout);
  }, [isOpen, dayRange.length]);

  const registerCardRef = useCallback((taskId: number, node: HTMLDivElement | null) => {
    if (node) cardRefsRef.current.set(taskId, node);
    else cardRefsRef.current.delete(taskId);
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
    cardRefsRef.current.forEach((node) => {
      node.style.transform = '';
      node.style.transition = '';
      node.style.willChange = '';
    });
  }, []);

  const snapshotCardRects = useCallback(() => {
    const tops = new Map<number, number>();
    const container = scrollContainerRef.current;
    const containerRect = container?.getBoundingClientRect();
    const containerScrollTop = container?.scrollTop || 0;
    const windowScrollY = typeof window !== 'undefined' ? window.scrollY : 0;
    rootOpenTaskIds.forEach((taskId) => {
      const node = cardRefsRef.current.get(taskId);
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const stableTop = container && containerRect
        ? rect.top - containerRect.top + containerScrollTop
        : rect.top + windowScrollY;
      tops.set(taskId, stableTop);
    });
    previousCardTopsRef.current = tops;
  }, [rootOpenTaskIds]);

  useEffect(() => {
    return () => {
      cancelFlipAnimations();
    };
  }, [cancelFlipAnimations]);

  useLayoutEffect(() => {
    if (!isOpen) return;

    const nextTops = new Map<number, number>();
    const container = scrollContainerRef.current;
    const containerRect = container?.getBoundingClientRect();
    const containerScrollTop = container?.scrollTop || 0;
    const windowScrollY = typeof window !== 'undefined' ? window.scrollY : 0;
    rootOpenTaskIds.forEach((taskId) => {
      const node = cardRefsRef.current.get(taskId);
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const stableTop = container && containerRect
        ? rect.top - containerRect.top + containerScrollTop
        : rect.top + windowScrollY;
      nextTops.set(taskId, stableTop);
    });

    // Keep rects in sync, but only animate while dragging to avoid first-open jitter.
    if (draggingTaskId === null) {
      previousCardTopsRef.current = nextTops;
      return;
    }

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (openAtRef.current > 0 && now - openAtRef.current < 220) {
      previousCardTopsRef.current = nextTops;
      return;
    }

    if (rootOpenTaskIds.length > FLIP_MAX_ITEMS) {
      previousCardTopsRef.current = nextTops;
      return;
    }

    if (previousCardTopsRef.current.size === 0) {
      previousCardTopsRef.current = nextTops;
      return;
    }

    nextTops.forEach((nextTop, taskId) => {
      if (taskId === draggingTaskId) return;
      const prevTop = previousCardTopsRef.current.get(taskId);
      const node = cardRefsRef.current.get(taskId);
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

    previousCardTopsRef.current = nextTops;
  }, [isOpen, rootOpenTaskIds, rootOpenTaskLayoutKey, dayRangeKey, showUnscheduled, draggingTaskId]);

  const tasksByDate = useMemo(() => {
    const map: Record<string, Task[]> = {};
    dayRange.forEach((day) => {
      map[day.key] = [];
    });

    visibleScheduledTasks.forEach((task) => {
      if (!task.scheduledDate) return;
      if (map[task.scheduledDate]) map[task.scheduledDate].push(task);
    });
    Object.values(map).forEach((list) => {
      list.sort((a, b) => {
        if (a.checked === b.checked) return 0;
        return a.checked ? 1 : -1;
      });
    });
    return map;
  }, [visibleScheduledTasks, dayRange]);

  const unscheduledTasks = useMemo(() => {
    return rootOpenTasks.filter((task) => !task.scheduledDate);
  }, [rootOpenTasks]);

  const triggerLaneFeedback = useCallback((laneKey: string, taskId?: number | null) => {
    setDropAnimatedDayKey(laneKey);
    setDropAnimatedTaskId(taskId ?? null);
    if (dropAnimTimeoutRef.current) clearTimeout(dropAnimTimeoutRef.current);
    dropAnimTimeoutRef.current = setTimeout(() => {
      setDropAnimatedTaskId(null);
      setDropAnimatedDayKey(null);
    }, 520);
  }, []);

  const markTaskAsEntering = useCallback((taskId: number) => {
    setEnteringTaskIds((prev) => (prev.includes(taskId) ? prev : [...prev, taskId]));
    const existingTimeout = entryAnimTimeoutsRef.current.get(taskId);
    if (existingTimeout) clearTimeout(existingTimeout);
    const timeoutId = setTimeout(() => {
      entryAnimTimeoutsRef.current.delete(taskId);
      setEnteringTaskIds((prev) => prev.filter((id) => id !== taskId));
    }, 760);
    entryAnimTimeoutsRef.current.set(taskId, timeoutId);
  }, []);

  const scheduleTask = (taskId: number, date: string | undefined) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    const normalizedDate = !date && !task.isFuture ? todayKey : date;
    if ((task.scheduledDate || undefined) === normalizedDate) return;
    updateTask({ ...task, scheduledDate: normalizedDate });
    triggerLaneFeedback(normalizedDate || 'unscheduled', taskId);
  };

  const clearDragState = useCallback(() => {
    cancelFlipAnimations();
    setDraggingTaskId(null);
    setHoveredLane(null);
    setHoveredTaskTarget(null);
    lastHoverMoveKeyRef.current = null;
    lastReorderAtRef.current = 0;
  }, [cancelFlipAnimations]);

  const handleCardDragStart = useCallback((taskId: number) => {
    cancelFlipAnimations();
    snapshotCardRects();
    setDraggingTaskId(taskId);
    setHoveredTaskTarget(null);
    lastHoverMoveKeyRef.current = null;
    lastReorderAtRef.current = 0;
  }, [cancelFlipAnimations, snapshotCardRects]);

  const handleCardDragHover = useCallback((targetTaskId: number, position: DragInsertPosition) => {
    if (!draggingTaskId || draggingTaskId === targetTaskId) return;
    setHoveredTaskTarget((prev) => (
      prev && prev.taskId === targetTaskId && prev.position === position
        ? prev
        : { taskId: targetTaskId, position }
    ));

    const globalWithoutDragged = rootOpenTaskIds.filter((id) => id !== draggingTaskId);
    const targetIndex = globalWithoutDragged.indexOf(targetTaskId);
    if (targetIndex === -1) return;

    const insertionIndex = position === 'before' ? targetIndex : targetIndex + 1;
    const toId = insertionIndex >= globalWithoutDragged.length ? -1 : globalWithoutDragged[insertionIndex];
    const moveKey = `${draggingTaskId}:${toId}`;
    if (lastHoverMoveKeyRef.current === moveKey) return;
    const now = performance.now();
    if (now - lastReorderAtRef.current < REORDER_MIN_INTERVAL_MS) return;

    const draggedTask = tasks.find((item) => item.id === draggingTaskId);
    const targetTask = tasks.find((item) => item.id === targetTaskId);
    if (!draggedTask || !targetTask) return;

    const targetDate = targetTask.scheduledDate;
    const normalizedTargetDate = !targetDate && !draggedTask.isFuture ? todayKey : targetDate;
    if ((draggedTask.scheduledDate || undefined) !== normalizedTargetDate) {
      updateTask({ ...draggedTask, scheduledDate: normalizedTargetDate });
    }

    lastHoverMoveKeyRef.current = moveKey;
    lastReorderAtRef.current = now;
    moveTask(draggingTaskId, toId);
    setHoveredLane(targetDate || 'unscheduled');
  }, [draggingTaskId, moveTask, rootOpenTaskIds, tasks, todayKey, updateTask]);

  const dropToLane = (event: React.DragEvent<HTMLDivElement>, laneKey: string | undefined) => {
    event.preventDefault();
    const fromTransfer = Number(event.dataTransfer.getData('text/plain'));
    const targetId = Number.isFinite(fromTransfer) && fromTransfer > 0 ? fromTransfer : draggingTaskId;
    if (!targetId) {
      clearDragState();
      return;
    }
    scheduleTask(targetId, laneKey);
    clearDragState();
  };

  const resetNewTaskDraft = useCallback(() => {
    setNewTaskName('');
    setNewTaskEst(1);
    setNewTaskColor(activeColor || PRESET_COLORS[0]);
    setNewTaskCategoryId(null);
  }, [activeColor]);

  const closeAddFormForDay = useCallback((dateKey: string) => {
    if (addFormCloseTimeoutRef.current) clearTimeout(addFormCloseTimeoutRef.current);
    setClosingAddDate(dateKey);
    addFormCloseTimeoutRef.current = setTimeout(() => {
      setAddingDate((current) => (current === dateKey ? null : current));
      setClosingAddDate((current) => (current === dateKey ? null : current));
      resetNewTaskDraft();
      addFormCloseTimeoutRef.current = null;
    }, ADD_TASK_FORM_CLOSE_DURATION_MS);
  }, [resetNewTaskDraft]);

  const submitDayTask = (dateKey: string) => {
    const trimmedName = newTaskName.trim();
    if (!trimmedName || closingAddDate === dateKey) return;
    const createdTaskId = addDetailedTask({
      name: trimmedName,
      estimated: clampEstimate(newTaskEst, taskEstimateStep),
      color: newTaskColor,
      categoryId: newTaskCategoryId,
      scheduledDate: dateKey,
      isFuture: false,
    });
    triggerLaneFeedback(dateKey);
    markTaskAsEntering(createdTaskId);
    closeAddFormForDay(dateKey);
  };

  const toggleAddForDay = (dateKey: string) => {
    if (addingDate === dateKey && closingAddDate !== dateKey) {
      closeAddFormForDay(dateKey);
      return;
    }

    if (addFormCloseTimeoutRef.current) clearTimeout(addFormCloseTimeoutRef.current);
    setClosingAddDate(null);
    setAddingDate(dateKey);
    resetNewTaskDraft();
  };

  const unscheduledPomos = unscheduledTasks.reduce((sum, task) => sum + getPredictedPomos(task), 0);
  const visibleRangeLabel = useMemo(() => {
    if (dayRange.length === 0) return '';
    const start = parseDateKey(dayRange[0].key);
    const end = parseDateKey(dayRange[dayRange.length - 1].key);
    return formatRangeLabel(start, end);
  }, [dayRange]);

  return (
    <>
      <style>{`
        .doro-weekly-shell.theme-light {
          isolation: isolate;
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.05)),
            linear-gradient(160deg, rgba(255, 255, 255, 0.84) 0%, rgba(246, 250, 255, 0.56) 36%, rgba(231, 239, 249, 0.38) 100%) !important;
          border-color: rgba(255, 255, 255, 0.56) !important;
          backdrop-filter: blur(34px) saturate(185%) !important;
          -webkit-backdrop-filter: blur(34px) saturate(185%) !important;
          box-shadow:
            0 42px 118px -56px rgba(67, 85, 116, 0.56),
            inset 0 1px 0 rgba(255, 255, 255, 0.84),
            inset 0 -1px 0 rgba(255, 255, 255, 0.2),
            0 0 0 1px rgba(255, 255, 255, 0.2) !important;
        }
        .doro-weekly-shell.theme-light::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            radial-gradient(circle at 12% -8%, rgba(255, 255, 255, 0.96), transparent 30%),
            radial-gradient(circle at 92% 6%, rgba(123, 188, 255, 0.32), transparent 26%),
            radial-gradient(circle at 50% 120%, rgba(172, 202, 255, 0.16), transparent 44%),
            linear-gradient(180deg, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0) 28%, rgba(255, 255, 255, 0.08) 100%);
          pointer-events: none;
          opacity: 0.96;
        }
        .doro-weekly-shell.theme-light::after {
          content: '';
          position: absolute;
          inset: 1px;
          border-radius: inherit;
          border: 1px solid rgba(255, 255, 255, 0.28);
          pointer-events: none;
        }
        .doro-weekly-shell.theme-light > * {
          position: relative;
          z-index: 1;
        }
        .doro-weekly-shell.theme-light .weekly-body {
          position: relative;
          background:
            radial-gradient(circle at 14% -10%, rgba(255, 255, 255, 0.88), transparent 28%),
            radial-gradient(circle at 100% 0%, rgba(95, 179, 255, 0.16), transparent 24%),
            linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(243, 247, 255, 0.04));
        }
        .doro-weekly-shell.theme-light .weekly-body::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            linear-gradient(150deg, rgba(255, 255, 255, 0.18), transparent 24%, rgba(255, 255, 255, 0) 62%),
            radial-gradient(circle at 82% 14%, rgba(149, 200, 255, 0.16), transparent 22%);
          pointer-events: none;
        }
        .doro-weekly-shell.theme-light .weekly-body > * {
          position: relative;
          z-index: 1;
        }
        .doro-weekly-shell.theme-light .schedule-header-group {
          border-color: rgba(255, 255, 255, 0.26) !important;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.34), rgba(245, 249, 255, 0.14)) !important;
          backdrop-filter: blur(22px) saturate(180%);
          -webkit-backdrop-filter: blur(22px) saturate(180%);
          box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.28);
        }
        .doro-weekly-shell.theme-light [class*="bg-white/"],
        .doro-weekly-shell.theme-light [class*="bg-black/"] {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.44), rgba(245, 248, 255, 0.16)) !important;
          border-color: rgba(255, 255, 255, 0.32) !important;
          backdrop-filter: blur(20px) saturate(165%);
          -webkit-backdrop-filter: blur(20px) saturate(165%);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72), 0 20px 30px -28px rgba(82, 101, 136, 0.36);
        }
        .doro-weekly-shell.theme-light input,
        .doro-weekly-shell.theme-light textarea,
        .doro-weekly-shell.theme-light select {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.58), rgba(244, 248, 255, 0.24)) !important;
          border-color: rgba(255, 255, 255, 0.42) !important;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.76), 0 18px 28px -26px rgba(82, 101, 136, 0.34);
          backdrop-filter: blur(18px) saturate(160%);
          -webkit-backdrop-filter: blur(18px) saturate(160%);
          color: #0f2033 !important;
        }
        .doro-weekly-shell.theme-light input::placeholder,
        .doro-weekly-shell.theme-light textarea::placeholder {
          color: rgba(88, 107, 133, 0.56) !important;
        }
        .doro-weekly-shell.theme-light button[class*="border"],
        .doro-weekly-shell.theme-light button[class*="bg-white"],
        .doro-weekly-shell.theme-light button[class*="bg-black/"] {
          backdrop-filter: blur(18px) saturate(160%);
          -webkit-backdrop-filter: blur(18px) saturate(160%);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7), 0 18px 30px -26px rgba(87, 104, 137, 0.34);
        }
        .doro-weekly-shell.theme-light .schedule-header-group button:hover {
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.84), 0 20px 30px -24px rgba(76, 96, 130, 0.38);
        }
        .doro-weekly-shell.theme-light .schedule-glass-button {
          border-color: rgba(152, 176, 206, 0.44) !important;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.78), rgba(232, 239, 249, 0.38)) !important;
          color: #17324c !important;
          text-shadow: 0 1px 0 rgba(255, 255, 255, 0.55);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.9),
            inset 0 -1px 0 rgba(171, 190, 214, 0.2),
            0 18px 30px -24px rgba(78, 102, 138, 0.34) !important;
        }
        .doro-weekly-shell.theme-light .schedule-glass-button:hover {
          border-color: rgba(132, 164, 204, 0.58) !important;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(235, 243, 251, 0.48)) !important;
          color: #102a44 !important;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.94),
            inset 0 -1px 0 rgba(164, 185, 212, 0.22),
            0 20px 32px -24px rgba(68, 94, 134, 0.4) !important;
        }
        .doro-weekly-shell.theme-light .schedule-glass-button--persistent {
          border-color: rgba(128, 161, 204, 0.5) !important;
          background: linear-gradient(180deg, rgba(251, 253, 255, 0.86), rgba(224, 234, 248, 0.5)) !important;
          color: #173a58 !important;
        }
        .doro-weekly-shell.theme-light .schedule-glass-button--secondary.is-active {
          border-color: rgba(117, 158, 214, 0.5) !important;
          background: linear-gradient(180deg, rgba(245, 250, 255, 0.84), rgba(214, 230, 249, 0.48)) !important;
          color: #1c4d79 !important;
        }
        .doro-weekly-shell.theme-light .schedule-glass-button--accent {
          border-color: rgba(103, 179, 150, 0.54) !important;
          background: linear-gradient(180deg, rgba(242, 255, 248, 0.86), rgba(208, 244, 226, 0.52)) !important;
          color: #0f5e46 !important;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.92),
            inset 0 -1px 0 rgba(109, 184, 156, 0.18),
            0 20px 32px -24px rgba(57, 133, 106, 0.34) !important;
        }
        .doro-weekly-shell.theme-light .schedule-glass-button--primary {
          border-color: rgba(103, 160, 219, 0.56) !important;
          background: linear-gradient(180deg, rgba(241, 250, 255, 0.92), rgba(201, 229, 251, 0.58)) !important;
          color: #0e4e79 !important;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.96),
            inset 0 -1px 0 rgba(103, 160, 219, 0.18),
            0 20px 34px -24px rgba(63, 118, 178, 0.36) !important;
        }
        .doro-weekly-shell.theme-light .schedule-glass-button--ghost {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.66), rgba(232, 239, 249, 0.24)) !important;
          color: rgba(23, 50, 76, 0.82) !important;
        }
        .doro-weekly-shell.theme-light .schedule-glass-button--icon {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(232, 239, 249, 0.3)) !important;
          color: #1c3f61 !important;
        }
        .doro-weekly-shell.theme-light .schedule-task-card .schedule-task-title {
          color: #17324c !important;
          text-shadow: 0 1px 0 rgba(255, 255, 255, 0.46);
        }
        .doro-weekly-shell.theme-light .schedule-task-card .schedule-task-meta {
          color: rgba(27, 57, 84, 0.66) !important;
        }
        .doro-weekly-shell.theme-light .schedule-task-card-completed .schedule-task-title {
          color: rgba(43, 71, 97, 0.48) !important;
          text-decoration-color: rgba(43, 71, 97, 0.38);
        }
        .doro-weekly-shell.theme-light .schedule-task-card-completed .schedule-task-meta {
          color: rgba(43, 71, 97, 0.42) !important;
        }
        .doro-weekly-shell.theme-light [class*="border-white/"] {
          border-color: rgba(15, 23, 42, 0.12) !important;
        }
        .doro-weekly-shell.theme-light [class*="text-white"] {
          color: #102133 !important;
        }
        .doro-weekly-shell.theme-light [class*="text-white/"] {
          color: #667990 !important;
        }
        .doro-weekly-shell.theme-light .schedule-glass-button {
          border-color: rgba(152, 176, 206, 0.44) !important;
          color: #17324c !important;
        }
        .doro-weekly-shell.theme-light .schedule-glass-button--persistent {
          border-color: rgba(128, 161, 204, 0.5) !important;
          color: #173a58 !important;
        }
        .doro-weekly-shell.theme-light .schedule-glass-button--secondary.is-active {
          border-color: rgba(117, 158, 214, 0.5) !important;
          color: #1c4d79 !important;
        }
        .doro-weekly-shell.theme-light .schedule-glass-button--accent {
          border-color: rgba(103, 179, 150, 0.54) !important;
          color: #0f5e46 !important;
        }
        .doro-weekly-shell.theme-light .schedule-glass-button--primary {
          border-color: rgba(103, 160, 219, 0.56) !important;
          color: #0e4e79 !important;
        }
        .doro-weekly-shell.theme-light .schedule-glass-button--ghost {
          color: rgba(23, 50, 76, 0.82) !important;
        }
        .doro-weekly-shell.theme-light .schedule-glass-button--icon {
          color: #1c3f61 !important;
        }
        .doro-weekly-shell.theme-light .schedule-task-card .schedule-task-title {
          color: #17324c !important;
          text-shadow: 0 1px 0 rgba(255, 255, 255, 0.46);
        }
        .doro-weekly-shell.theme-light .schedule-task-card .schedule-task-meta {
          color: rgba(27, 57, 84, 0.66) !important;
        }
        .doro-weekly-shell.theme-light .schedule-task-card-completed .schedule-task-title {
          color: rgba(43, 71, 97, 0.48) !important;
          text-decoration-color: rgba(43, 71, 97, 0.38);
        }
        .doro-weekly-shell.theme-light .schedule-task-card-completed .schedule-task-meta {
          color: rgba(43, 71, 97, 0.42) !important;
        }
        .doro-weekly-shell.theme-light > div:first-child {
          opacity: 0.18;
        }
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
        @keyframes doro-task-composer-bloom {
          0% {
            opacity: 0;
            transform: translate3d(-8%, -18%, 0) scale(0.84);
            filter: blur(10px);
          }
          58% {
            opacity: 0.72;
            transform: translate3d(0, 0, 0) scale(1.05);
            filter: blur(2px);
          }
          100% {
            opacity: 0.42;
            transform: translate3d(0, 0, 0) scale(1);
            filter: blur(0);
          }
        }
        @keyframes doro-task-composer-item-in {
          0% {
            opacity: 0;
            transform: translate3d(0, 12px, 0) scale(0.965);
            filter: blur(1.4px) saturate(0.9);
          }
          64% {
            opacity: 1;
            transform: translate3d(0, -1px, 0) scale(1.008);
            filter: blur(0) saturate(1.04);
          }
          100% {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
            filter: blur(0) saturate(1);
          }
        }
        @keyframes doro-task-composer-item-out {
          0% {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
            filter: blur(0) saturate(1);
          }
          100% {
            opacity: 0;
            transform: translate3d(0, 9px, 0) scale(0.972);
            filter: blur(1.2px) saturate(0.92);
          }
        }
        .doro-task-composer-shell {
          position: relative;
          isolation: isolate;
          transform-origin: top center;
          will-change: max-height, transform, opacity, filter, background-color, border-color, box-shadow;
          transition:
            background-color 520ms cubic-bezier(0.22, 1, 0.36, 1),
            border-color 520ms cubic-bezier(0.22, 1, 0.36, 1),
            box-shadow 560ms cubic-bezier(0.22, 1, 0.36, 1),
            transform 560ms cubic-bezier(0.22, 1, 0.36, 1),
            filter 520ms ease;
        }
        .doro-task-composer-shell::before {
          content: '';
          position: absolute;
          inset: -42% -18% auto -18%;
          z-index: 0;
          height: 78%;
          border-radius: 999px;
          background:
            radial-gradient(circle at 20% 28%, rgba(255, 255, 255, 0.2), transparent 45%),
            linear-gradient(90deg, rgba(255, 255, 255, 0.11), rgba(255, 255, 255, 0));
          opacity: 0;
          pointer-events: none;
          transform: translate3d(-8%, -18%, 0) scale(0.84);
          transition:
            opacity 460ms ease,
            transform 620ms cubic-bezier(0.22, 1, 0.36, 1),
            filter 520ms ease;
        }
        .doro-task-composer-shell > * {
          position: relative;
          z-index: 1;
        }
        .doro-weekly-task-create-open::before,
        .doro-weekly-task-editor-open::before {
          animation: doro-task-composer-bloom 680ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .doro-task-composer-shell .doro-task-picker-row,
        .doro-task-composer-shell .doro-task-color-swatch,
        .doro-task-composer-shell .doro-task-category-chip,
        .doro-task-composer-shell .doro-task-add-category-chip,
        .doro-task-composer-shell .doro-task-create-estimate,
        .doro-task-composer-shell .doro-task-create-actions > button,
        .doro-task-composer-shell .doro-task-estimate-stepper,
        .doro-task-composer-shell .schedule-glass-button {
          backface-visibility: hidden;
          transform-origin: center;
          will-change: opacity, transform, filter;
        }
        .doro-task-picker-row {
          --doro-task-composer-open-delay: 70ms;
          --doro-task-composer-close-delay: 80ms;
        }
        .doro-task-picker-row .doro-task-color-swatch:nth-child(1) {
          --doro-task-composer-open-delay: 105ms;
          --doro-task-composer-close-delay: 115ms;
        }
        .doro-task-picker-row .doro-task-color-swatch:nth-child(2) {
          --doro-task-composer-open-delay: 130ms;
          --doro-task-composer-close-delay: 95ms;
        }
        .doro-task-picker-row .doro-task-color-swatch:nth-child(3) {
          --doro-task-composer-open-delay: 155ms;
          --doro-task-composer-close-delay: 75ms;
        }
        .doro-task-picker-row .doro-task-color-swatch:nth-child(4) {
          --doro-task-composer-open-delay: 180ms;
          --doro-task-composer-close-delay: 55ms;
        }
        .doro-task-picker-row .doro-task-color-swatch:nth-child(n+5) {
          --doro-task-composer-open-delay: 205ms;
          --doro-task-composer-close-delay: 35ms;
        }
        .doro-task-category-chip,
        .doro-task-add-category-chip {
          --doro-task-composer-open-delay: 190ms;
          --doro-task-composer-close-delay: 55ms;
        }
        .doro-task-create-estimate {
          --doro-task-composer-open-delay: 230ms;
          --doro-task-composer-close-delay: 35ms;
        }
        .doro-task-create-actions > button:nth-child(1),
        .doro-weekly-task-editor .schedule-glass-button:nth-child(1) {
          --doro-task-composer-open-delay: 275ms;
          --doro-task-composer-close-delay: 20ms;
        }
        .doro-task-create-actions > button:nth-child(2),
        .doro-weekly-task-editor .schedule-glass-button:nth-child(2) {
          --doro-task-composer-open-delay: 315ms;
          --doro-task-composer-close-delay: 0ms;
        }
        @keyframes doro-weekly-task-create-in {
          0% {
            max-height: 0;
            margin-top: 0;
            opacity: 0;
            transform: translateY(10px) scale(0.982);
            border-color: rgba(255, 255, 255, 0);
            filter: blur(1px) saturate(0.92);
          }
          72% {
            max-height: 18rem;
            margin-top: 0.625rem;
            opacity: 1;
            transform: translateY(-1px) scale(1.006);
            border-color: rgba(255, 255, 255, 0.22);
            filter: blur(0) saturate(1.04);
          }
          100% {
            max-height: 18rem;
            margin-top: 0.625rem;
            opacity: 1;
            transform: translateY(0) scale(1);
            border-color: rgba(255, 255, 255, 0.12);
            filter: blur(0) saturate(1);
          }
        }
        @keyframes doro-weekly-task-create-out {
          0% {
            max-height: 18rem;
            margin-top: 0.625rem;
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0) saturate(1);
          }
          100% {
            max-height: 0;
            margin-top: 0;
            opacity: 0;
            transform: translateY(8px) scale(0.974);
            filter: blur(1.2px) saturate(0.92);
          }
        }
        .doro-weekly-task-create {
          transform-origin: top center;
          will-change: max-height, opacity, transform, margin, filter;
        }
        .doro-weekly-task-create-open {
          animation: doro-weekly-task-create-in 540ms cubic-bezier(0.18, 0.9, 0.32, 1.08) both;
        }
        .doro-weekly-task-create-close {
          animation: doro-weekly-task-create-out ${ADD_TASK_FORM_CLOSE_DURATION_MS}ms cubic-bezier(0.45, 0, 0.2, 1) forwards;
          pointer-events: none;
        }
        .doro-weekly-task-create-open .doro-task-picker-row,
        .doro-weekly-task-create-open .doro-task-color-swatch,
        .doro-weekly-task-create-open .doro-task-category-chip,
        .doro-weekly-task-create-open .doro-task-add-category-chip,
        .doro-weekly-task-create-open .doro-task-create-estimate,
        .doro-weekly-task-create-open .doro-task-estimate-stepper,
        .doro-weekly-task-create-open .doro-task-create-actions > button,
        .doro-weekly-task-editor-open .doro-task-picker-row,
        .doro-weekly-task-editor-open .doro-task-color-swatch,
        .doro-weekly-task-editor-open .doro-task-category-chip,
        .doro-weekly-task-editor-open .doro-task-add-category-chip,
        .doro-weekly-task-editor-open .doro-task-estimate-stepper,
        .doro-weekly-task-editor-open .schedule-glass-button {
          animation: doro-task-composer-item-in 500ms cubic-bezier(0.22, 1, 0.36, 1) both;
          animation-delay: var(--doro-task-composer-open-delay, 120ms);
        }
        .doro-weekly-task-create-close .doro-task-picker-row,
        .doro-weekly-task-create-close .doro-task-color-swatch,
        .doro-weekly-task-create-close .doro-task-category-chip,
        .doro-weekly-task-create-close .doro-task-add-category-chip,
        .doro-weekly-task-create-close .doro-task-create-estimate,
        .doro-weekly-task-create-close .doro-task-estimate-stepper,
        .doro-weekly-task-create-close .doro-task-create-actions > button,
        .doro-weekly-task-editor-close .doro-task-picker-row,
        .doro-weekly-task-editor-close .doro-task-color-swatch,
        .doro-weekly-task-editor-close .doro-task-category-chip,
        .doro-weekly-task-editor-close .doro-task-add-category-chip,
        .doro-weekly-task-editor-close .doro-task-estimate-stepper,
        .doro-weekly-task-editor-close .schedule-glass-button {
          animation: doro-task-composer-item-out 280ms cubic-bezier(0.4, 0, 0.2, 1) both;
          animation-delay: var(--doro-task-composer-close-delay, 0ms);
        }
        @keyframes doro-weekly-task-editor-in {
          0% {
            opacity: 0;
            transform: translateY(12px) scale(0.965);
            filter: blur(1.4px) saturate(0.9);
          }
          66% {
            opacity: 1;
            transform: translateY(-1px) scale(1.006);
            filter: blur(0) saturate(1.04);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0) saturate(1);
          }
        }
        @keyframes doro-weekly-task-editor-out {
          0% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0) saturate(1);
          }
          100% {
            opacity: 0;
            transform: translateY(9px) scale(0.974);
            filter: blur(1.2px) saturate(0.92);
          }
        }
        .doro-weekly-task-editor {
          transform-origin: top center;
          will-change: opacity, transform, filter, background-color, border-color, box-shadow;
        }
        .doro-weekly-task-editor-open {
          animation: doro-weekly-task-editor-in 540ms cubic-bezier(0.18, 0.9, 0.32, 1.08) both;
        }
        .doro-weekly-task-editor-close {
          animation: doro-weekly-task-editor-out ${SCHEDULE_TASK_EDIT_CLOSE_DURATION_MS}ms cubic-bezier(0.45, 0, 0.2, 1) forwards;
          pointer-events: none;
        }
        .schedule-close-btn {
          border-radius: 999px;
          backdrop-filter: blur(18px) saturate(165%);
          -webkit-backdrop-filter: blur(18px) saturate(165%);
          transition:
            transform 180ms cubic-bezier(0.22, 1, 0.36, 1),
            background-color 180ms ease,
            border-color 180ms ease,
            box-shadow 220ms ease,
            color 180ms ease,
            opacity 180ms ease;
        }
        .schedule-close-btn:hover {
          border-color: rgba(255, 255, 255, 0.2);
          background: rgba(255, 255, 255, 0.1);
          color: rgba(255, 255, 255, 0.94);
          box-shadow: 0 14px 26px -20px rgba(0, 0, 0, 0.72);
        }
        .schedule-close-btn:active {
          transform: scale(0.97);
        }
        .doro-weekly-shell.theme-light .schedule-close-btn {
          border-color: rgba(255, 255, 255, 0.42) !important;
          background: rgba(255, 255, 255, 0.52) !important;
          color: #203147 !important;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7), 0 16px 26px -22px rgba(82, 101, 136, 0.48) !important;
        }
        .doro-weekly-shell.theme-light .schedule-close-btn:hover {
          border-color: rgba(255, 255, 255, 0.66) !important;
          background: rgba(255, 255, 255, 0.72) !important;
          color: #0f2033 !important;
        }
        @keyframes doro-drop-pop {
          0% {
            transform: translateY(4px) scale(0.97);
            opacity: 0.72;
          }
          55% {
            transform: translateY(-1px) scale(1.02);
            opacity: 1;
          }
          100% {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
        }
        .doro-drop-pop {
          animation: doro-drop-pop 420ms cubic-bezier(0.2, 0.9, 0.3, 1.08);
        }
        @keyframes doro-schedule-create {
          0% {
            opacity: 0;
            transform: translateY(16px) scale(0.94);
            filter: saturate(0.84) blur(1px);
          }
          54% {
            opacity: 1;
            transform: translateY(-3px) scale(1.018);
            filter: saturate(1.08) blur(0);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: saturate(1) blur(0);
          }
        }
        .doro-schedule-create {
          animation: doro-schedule-create 560ms cubic-bezier(0.16, 0.88, 0.3, 1.12);
          transform-origin: top center;
        }
        @keyframes doro-schedule-create-glow {
          0% {
            opacity: 0;
          }
          38% {
            opacity: 1;
          }
          100% {
            opacity: 0;
          }
        }
        .doro-schedule-create-glow {
          animation: doro-schedule-create-glow 620ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @keyframes doro-schedule-create-sheen {
          0% {
            opacity: 0;
            transform: translateX(-124%) skewX(-18deg);
          }
          28% {
            opacity: 0.88;
          }
          100% {
            opacity: 0;
            transform: translateX(228%) skewX(-18deg);
          }
        }
        .doro-schedule-create-sheen {
          animation: doro-schedule-create-sheen 760ms cubic-bezier(0.19, 1, 0.22, 1);
        }
        @keyframes doro-edit-close-settle {
          0% {
            transform: translateY(2px) scale(0.985);
          }
          55% {
            transform: translateY(-1px) scale(1.01);
          }
          100% {
            transform: translateY(0) scale(1);
          }
        }
        .doro-edit-close-settle {
          animation: doro-edit-close-settle 280ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .schedule-task-card {
          will-change: transform, opacity, background-color, border-color, box-shadow;
        }
        .schedule-task-edit-button {
          opacity: 0;
          transform: translate3d(7px, -50%, 0) scale(0.88);
          filter: blur(0.8px);
          transition:
            opacity 190ms ease,
            transform 360ms cubic-bezier(0.22, 1, 0.36, 1),
            filter 240ms ease,
            background-color 180ms ease,
            border-color 180ms ease,
            color 180ms ease,
            box-shadow 220ms ease;
          will-change: opacity, transform, filter;
        }
        .schedule-task-card:hover .schedule-task-edit-button,
        .schedule-task-card:focus-within .schedule-task-edit-button {
          opacity: 1;
          transform: translate3d(0, -50%, 0) scale(1);
          filter: blur(0);
        }
        .schedule-task-edit-button:hover,
        .schedule-task-edit-button:focus-visible {
          box-shadow: 0 12px 22px -18px rgba(0, 0, 0, 0.72);
        }
        @keyframes doro-lane-hit {
          0% {
            box-shadow: inset 0 0 0 0 rgba(255, 255, 255, 0);
            transform: scale(1);
          }
          45% {
            box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28);
            transform: scale(1.004);
          }
          100% {
            box-shadow: inset 0 0 0 0 rgba(255, 255, 255, 0);
            transform: scale(1);
          }
        }
        .doro-lane-hit {
          animation: doro-lane-hit 360ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .doro-dragging-card {
          opacity: 0.36;
          transform: scale(0.985);
        }
        .schedule-header-action-row {
          display: flex;
          align-items: center;
          gap: 0.52rem;
          flex-wrap: nowrap;
          min-width: 0;
        }
        .schedule-header-date-divider {
          display: block;
          width: 1px;
          height: 1.3rem;
          flex: 0 0 1px;
          border-radius: 999px;
          background: linear-gradient(
            180deg,
            transparent,
            rgba(255, 255, 255, 0.18),
            transparent
          );
        }
        .schedule-header-date-label {
          min-width: max-content;
        }
        .schedule-header-icon-controls {
          display: flex;
          align-items: center;
          gap: 0.34rem;
          min-height: 2rem;
          overflow: visible;
        }
        .schedule-header-icon-button {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 2rem;
          height: 2rem;
          min-width: 2rem;
          padding: 0;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 0.62rem;
          background: rgba(255, 255, 255, 0.045);
          color: rgba(255, 255, 255, 0.64);
          box-shadow: 0 10px 18px -18px rgba(0, 0, 0, 0.7);
          transition:
            transform 180ms cubic-bezier(0.22, 1, 0.36, 1),
            background-color 180ms ease,
            border-color 180ms ease,
            color 180ms ease,
            box-shadow 180ms ease;
        }
        .schedule-header-icon-button:hover,
        .schedule-header-icon-button:focus-visible {
          transform: translateY(-1px);
          border-color: rgba(255, 255, 255, 0.2);
          background: rgba(255, 255, 255, 0.105);
          color: rgba(255, 255, 255, 0.96);
          box-shadow: 0 16px 24px -18px rgba(0, 0, 0, 0.82);
        }
        .schedule-header-icon-button:active {
          transform: translateY(0);
        }
        .schedule-header-icon-button.is-active {
          border-color: rgba(255, 255, 255, 0.26);
          background: rgba(255, 255, 255, 0.14);
          color: rgba(255, 255, 255, 0.98);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.12),
            0 16px 24px -18px rgba(0, 0, 0, 0.82);
        }
        .schedule-header-icon-button::after {
          content: attr(data-tooltip);
          position: absolute;
          top: calc(100% + 0.48rem);
          left: 50%;
          z-index: 60;
          max-width: 11rem;
          transform: translate3d(-50%, -3px, 0) scale(0.96);
          border-radius: 0.58rem;
          padding: 0.42rem 0.56rem;
          opacity: 0;
          pointer-events: none;
          white-space: nowrap;
          background: rgba(246, 248, 252, 0.96);
          color: rgba(15, 23, 42, 0.95);
          box-shadow: 0 14px 24px -18px rgba(0, 0, 0, 0.78);
          font-size: 0.68rem;
          font-weight: 800;
          letter-spacing: 0;
          line-height: 1;
          text-transform: none;
          transition: opacity 140ms ease, transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .schedule-header-icon-button::before {
          content: '';
          position: absolute;
          top: calc(100% + 0.25rem);
          left: 50%;
          z-index: 59;
          height: 0.42rem;
          width: 0.42rem;
          opacity: 0;
          pointer-events: none;
          background: rgba(246, 248, 252, 0.96);
          transform: translate3d(-50%, -3px, 0) rotate(45deg);
          transition: opacity 140ms ease, transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .schedule-header-icon-button:first-child::after {
          left: 0;
          transform: translate3d(0, -3px, 0) scale(0.96);
          transform-origin: top left;
        }
        .schedule-header-icon-button:first-child::before {
          left: 0.85rem;
        }
        .schedule-header-icon-button:hover::after,
        .schedule-header-icon-button:focus-visible::after,
        .schedule-header-icon-button:hover::before,
        .schedule-header-icon-button:focus-visible::before {
          opacity: 1;
          transform: translate3d(-50%, 0, 0) scale(1);
        }
        .schedule-header-icon-button:first-child:hover::after,
        .schedule-header-icon-button:first-child:focus-visible::after {
          transform: translate3d(0, 0, 0) scale(1);
        }
        .schedule-header-icon-button:hover::before,
        .schedule-header-icon-button:focus-visible::before {
          transform: translate3d(-50%, 0, 0) rotate(45deg);
        }
        .doro-weekly-shell.theme-light .schedule-header-icon-button {
          border-color: rgba(152, 176, 206, 0.44);
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(232, 239, 249, 0.3));
          color: #1c3f61;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.88),
            0 18px 30px -24px rgba(78, 102, 138, 0.34);
        }
        .doro-weekly-shell.theme-light .schedule-header-icon-button:hover,
        .doro-weekly-shell.theme-light .schedule-header-icon-button:focus-visible {
          border-color: rgba(132, 164, 204, 0.58);
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(235, 243, 251, 0.48));
          color: #102a44;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.94),
            0 20px 32px -24px rgba(68, 94, 134, 0.4);
        }
        .doro-weekly-shell.theme-light .schedule-header-icon-button.is-active {
          border-color: rgba(117, 158, 214, 0.5);
          background: linear-gradient(180deg, rgba(245, 250, 255, 0.84), rgba(214, 230, 249, 0.48));
          color: #1c4d79;
        }
        .doro-weekly-shell.theme-light .schedule-header-icon-button::after,
        .doro-weekly-shell.theme-light .schedule-header-icon-button::before {
          background: rgba(15, 23, 42, 0.94);
          color: white;
          box-shadow: 0 12px 20px -18px rgba(15, 23, 42, 0.5);
        }
        .doro-weekly-shell.theme-light .schedule-header-date-divider {
          background: linear-gradient(
            180deg,
            transparent,
            rgba(15, 23, 42, 0.18),
            transparent
          );
        }
        @media (hover: none) {
          .schedule-header-icon-button::after,
          .schedule-header-icon-button::before {
            display: none;
          }
        }
        @media (max-width: 767px) {
          .doro-weekly-shell {
            border-left-width: 0;
          }
          .doro-weekly-shell button,
          .doro-weekly-shell input,
          .doro-weekly-shell textarea {
            touch-action: manipulation;
          }
          .doro-weekly-shell input,
          .doro-weekly-shell textarea,
          .doro-weekly-shell select {
            font-size: 16px;
          }
          .schedule-header-group {
            padding: 0.75rem 0.875rem !important;
          }
          .schedule-header-group h2 {
            font-size: 1.18rem;
          }
          .schedule-header-title-row {
            align-items: flex-start !important;
            flex-direction: column;
            gap: 0.42rem !important;
          }
          .schedule-header-action-row {
            gap: 0.5rem;
            flex-wrap: wrap;
          }
          .schedule-header-icon-controls {
            gap: 0.28rem;
          }
          .schedule-header-date-divider {
            height: 1.2rem;
          }
          .schedule-header-icon-button {
            width: 1.95rem;
            height: 1.95rem;
            min-width: 1.95rem;
          }
          .schedule-glass-button--icon {
            min-width: 2.75rem;
            min-height: 2.75rem;
          }
          .weekly-body {
            padding: 0.75rem !important;
            overscroll-behavior: contain;
          }
        }
      `}</style>
      <div
        className={`fixed inset-0 z-40 transition-opacity duration-500 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        } ${
          isLightTheme
            ? 'bg-[rgba(16,24,38,0.18)] backdrop-blur-[14px]'
            : 'bg-black/45 backdrop-blur-[2px]'
        }`}
        onClick={onClose}
      />

      <aside
        className={`doro-weekly-shell ${isLightTheme ? 'theme-light' : 'theme-dark'} fixed right-0 top-0 bottom-0 z-50 w-full md:w-[min(92vw,1000px)] bg-[#0e1116]/95 border-l border-white/10 shadow-[0_20px_80px_rgba(0,0,0,0.45)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${isOpen ? 'translate-x-0' : 'translate-x-full'} overflow-hidden`}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_46%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.05),transparent_42%)] pointer-events-none" />
        <div className="relative h-full flex flex-col">
          <div className="schedule-header-group px-4 md:px-5 py-2.5 md:py-2 border-b border-white/10 bg-black/20 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3">
              <div className="schedule-header-title-row min-w-0 flex flex-1 flex-wrap items-center gap-x-4 gap-y-1.5">
                <h2 className="shrink-0 text-[1.35rem] md:text-[1.45rem] font-bold text-white tracking-tight leading-none">Weekly Planner</h2>
                <div className="schedule-header-action-row">
                  <div className="schedule-header-icon-controls">
                    <button
                      type="button"
                      onClick={() => setShowCompletedTasks(!showCompletedTasks)}
                      className={`schedule-header-icon-button ${showCompletedTasks ? 'is-active' : ''}`}
                      aria-label={showCompletedTasks ? 'Hide completed tasks' : 'Show completed tasks'}
                      aria-pressed={showCompletedTasks}
                      data-tooltip="Completed"
                    >
                      <Eye size={15} strokeWidth={2.15} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowHistory(prev => !prev)}
                      className={`schedule-header-icon-button ${showHistory ? 'is-active' : ''}`}
                      aria-label={showHistory ? 'Hide history' : 'Show history'}
                      aria-pressed={showHistory}
                      data-tooltip="History"
                    >
                      <BookOpen size={15} strokeWidth={2.15} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setExtendSchedule(prev => !prev)}
                      className={`schedule-header-icon-button ${extendSchedule ? 'is-active' : ''}`}
                      aria-label={extendSchedule ? 'Return to default schedule range' : 'Extend schedule'}
                      aria-pressed={extendSchedule}
                      data-tooltip="Extend"
                    >
                      <CalendarPlus size={15} strokeWidth={2.15} aria-hidden="true" />
                    </button>
                  </div>
                  <span className="schedule-header-date-divider" aria-hidden="true" />
                  <p className="schedule-header-date-label text-xs text-white/55 font-mono">{visibleRangeLabel}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="schedule-close-btn flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/70"
                aria-label="Close weekly schedule panel"
              >
                <X size={16} strokeWidth={2.1} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div ref={scrollContainerRef} className="weekly-body flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-6 py-3">
            {unscheduledTasks.length > 0 && (
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setHoveredLane('unscheduled');
                  if (event.target === event.currentTarget) setHoveredTaskTarget(null);
                }}
                onDragLeave={() => setHoveredLane((value) => (value === 'unscheduled' ? null : value))}
                onDrop={(event) => dropToLane(event, undefined)}
                className={`rounded-xl border p-2.5 mb-3 transition-colors duration-200 ${dropAnimatedDayKey === 'unscheduled' ? 'doro-lane-hit' : ''} ${hoveredLane === 'unscheduled' ? 'border-white/40 bg-white/[0.12]' : 'border-white/10 bg-white/[0.05]'}`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-white/45 font-bold">Unscheduled</div>
                  <div className="flex items-center gap-2">
                    <div className="text-[11px] text-white/70 font-sans font-medium tracking-[0.06em]">{formatPomoLabel(unscheduledPomos, unscheduledPomos === 1 ? pomoUnitLabel : pluralPomoUnitLabel)}</div>
                    <button
                      type="button"
                      onClick={() => setShowUnscheduled(prev => !prev)}
                      className="schedule-glass-button schedule-glass-button--icon w-5 h-5 rounded-md border border-white/10 bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.1] transition-all flex items-center justify-center"
                      aria-label={showUnscheduled ? 'Hide unscheduled tasks' : 'Show unscheduled tasks'}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        className={`transition-transform duration-200 ${showUnscheduled ? 'rotate-180' : ''}`}
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                  </div>
                </div>
                {showUnscheduled && (
                  <div className="doro-soft-expand space-y-1.5">
                    {unscheduledTasks.map((task) => (
                      <ScheduleTaskCard
                        key={task.id}
                        task={task}
                        categories={categories}
                        onRequestNewCategory={requestNewCategoryFlow}
                        onSave={updateTask}
                        isLightTheme={isLightTheme}
                        isDragging={draggingTaskId === task.id}
                        dropHint={draggingTaskId && hoveredTaskTarget?.taskId === task.id && draggingTaskId !== task.id ? hoveredTaskTarget.position : null}
                        isDropAnimating={dropAnimatedTaskId === task.id}
                        isEntering={enteringTaskIds.includes(task.id)}
                        registerCardRef={registerCardRef}
                        pomoUnitLabel={pomoUnitLabel}
                        pluralPomoUnitLabel={pluralPomoUnitLabel}
                        onDragStart={handleCardDragStart}
                        onDragHover={handleCardDragHover}
                        onDragEnd={clearDragState}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="space-y-2.5 pb-5">
              {dayRange.map((day) => {
                const dayTasks = tasksByDate[day.key] || [];
                const dayPredictedPomos = dayTasks.reduce((sum, task) => sum + (task.checked ? 0 : getPredictedPomos(task)), 0);
                const isAddingHere = addingDate === day.key || closingAddDate === day.key;
                const isClosingAddForm = closingAddDate === day.key;
                const canSubmitNewTask = newTaskName.trim().length > 0 && !isClosingAddForm;
                const isHovered = hoveredLane === day.key;
                return (
                  <div
                    key={day.key}
                    ref={day.isToday ? todayAnchorRef : undefined}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setHoveredLane(day.key);
                      if (event.target === event.currentTarget) setHoveredTaskTarget(null);
                    }}
                    onDragLeave={() => setHoveredLane((value) => (value === day.key ? null : value))}
                    onDrop={(event) => dropToLane(event, day.key)}
                    className={`rounded-xl border p-2.5 transition-colors duration-200 ${dropAnimatedDayKey === day.key ? 'doro-lane-hit' : ''} ${isHovered ? 'border-white/40 bg-white/[0.12]' : 'border-white/10 bg-white/[0.05]'}`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-10 h-10 rounded-xl border flex flex-col items-center justify-center ${day.isToday ? 'bg-white text-black border-white' : 'bg-black/25 border-white/15 text-white/80'}`}>
                          <div className="text-[9px] font-bold tracking-widest">{day.label}</div>
                          <div className="text-[14px] font-bold leading-none mt-0.5">{day.dayNumber}</div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[10px] uppercase tracking-[0.16em] text-white/45 font-bold truncate">{day.monthLabel}</div>
                          <div className="text-xs text-white/75 font-sans font-medium tracking-[0.06em] truncate">{formatPomoLabel(dayPredictedPomos, dayPredictedPomos === 1 ? pomoUnitLabel : pluralPomoUnitLabel)}</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleAddForDay(day.key)}
                        className="schedule-glass-button schedule-glass-button--icon w-7 h-7 rounded-lg border border-white/10 bg-white/[0.06] text-white/70 hover:text-white hover:bg-white/[0.12] transition-all shrink-0"
                        aria-label={`Add task for ${day.label}`}
                      >
                        +
                      </button>
                    </div>
                    <div className="space-y-1.5 min-h-[58px]">
                      {dayTasks.map((task) => (
                        <ScheduleTaskCard
                          key={task.id}
                          task={task}
                          categories={categories}
                          onRequestNewCategory={requestNewCategoryFlow}
                          onSave={updateTask}
                          isLightTheme={isLightTheme}
                          isDragging={draggingTaskId === task.id}
                          dropHint={draggingTaskId && hoveredTaskTarget?.taskId === task.id && draggingTaskId !== task.id ? hoveredTaskTarget.position : null}
                          isDropAnimating={dropAnimatedTaskId === task.id}
                          isEntering={enteringTaskIds.includes(task.id)}
                          registerCardRef={registerCardRef}
                          pomoUnitLabel={pomoUnitLabel}
                          pluralPomoUnitLabel={pluralPomoUnitLabel}
                          onDragStart={handleCardDragStart}
                          onDragHover={handleCardDragHover}
                          onDragEnd={clearDragState}
                        />
                      ))}
                      {dayTasks.length === 0 && !isAddingHere && (
                        <button
                          type="button"
                          onClick={() => toggleAddForDay(day.key)}
                          className="schedule-glass-button schedule-glass-button--ghost w-full rounded-lg border border-dashed border-white/10 py-2.5 text-center text-[10px] uppercase tracking-[0.12em] text-white/30 hover:text-white/70 hover:border-white/20 hover:bg-white/[0.05] transition-colors"
                          aria-label={`Add task for ${day.label}`}
                        >
                          No Tasks
                        </button>
                      )}
                    </div>
                    {isAddingHere && (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          submitDayTask(day.key);
                        }}
                        className={`doro-weekly-task-create doro-task-composer-shell relative z-20 overflow-hidden rounded-xl border bg-white/[0.055] shadow-[0_18px_42px_-28px_rgba(0,0,0,0.35)] backdrop-blur-xl ${
                          isClosingAddForm ? 'doro-weekly-task-create-close' : 'doro-weekly-task-create-open'
                        }`}
                      >
                        <div className="flex items-center p-1.5">
                        <input
                          autoFocus
                          value={newTaskName}
                          onChange={(event) => setNewTaskName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              submitDayTask(day.key);
                            }
                          }}
                            placeholder="Describe task..."
                            className="doro-task-create-input min-w-0 flex-1 bg-transparent px-4 py-2 text-sm font-medium text-glass-text placeholder-white/30 outline-none"
                        />
                        </div>
                        <div className="border-t border-white/5 px-4 py-2">
                          <TaskCategoryPicker
                            categories={categories}
                            selectedCategoryId={newTaskCategoryId}
                            selectedColor={newTaskColor}
                            onColorSelect={(color) => {
                              setNewTaskColor(color);
                              setNewTaskCategoryId(null);
                            }}
                            onCategorySelect={(category) => {
                              setNewTaskCategoryId(category.id);
                              setNewTaskColor(category.color);
                            }}
                            onRequestNewCategory={requestNewCategoryFlow}
                            swatchSize="sm"
                            className="doro-task-picker-row overflow-hidden py-1"
                            stretchCategoryTray
                          />
                          <div className="doro-task-create-footer mt-3 flex items-center justify-between gap-3">
                          <div className="doro-task-create-estimate flex items-center gap-2 text-[10px] font-mono tracking-wide text-white/60">
                            <span className="font-bold">EST</span>
                            <div className="doro-task-estimate-stepper flex items-center overflow-hidden rounded-lg border border-white/20 bg-black/20">
                              <button
                                type="button"
                                onClick={() => setNewTaskEst((value) => clampEstimate(value - taskEstimateStep, taskEstimateStep))}
                                className="px-2 py-1 text-white/65 transition-all duration-200 hover:-translate-y-[1px] hover:bg-white/[0.12] hover:text-white hover:shadow-[0_4px_10px_rgba(255,255,255,0.12)] active:translate-y-0 active:scale-95"
                                aria-label="Decrease new task estimate"
                              >
                                -
                              </button>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={newTaskEst}
                                onChange={(event) => {
                                  const next = Number(event.target.value.replace(/[^\d]/g, ''));
                                  if (!Number.isNaN(next)) setNewTaskEst(clampEstimate(next, taskEstimateStep));
                                }}
                                className="w-8 bg-transparent text-center text-xs font-mono font-bold text-white outline-none"
                                aria-label="New task estimate"
                              />
                              <button
                                type="button"
                                onClick={() => setNewTaskEst((value) => clampEstimate(value + taskEstimateStep, taskEstimateStep))}
                                className="px-2 py-1 text-white/65 transition-all duration-200 hover:-translate-y-[1px] hover:bg-white/[0.12] hover:text-white hover:shadow-[0_4px_10px_rgba(255,255,255,0.12)] active:translate-y-0 active:scale-95"
                                aria-label="Increase new task estimate"
                              >
                                +
                              </button>
                            </div>
                          </div>

                          <div className="doro-task-create-actions ml-auto flex gap-2">
                            <button
                              type="button"
                              onClick={() => closeAddFormForDay(day.key)}
                              className="rounded-lg border border-white/5 bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white/60 transition-all hover:bg-white/10 hover:text-white active:scale-95"
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              disabled={!canSubmitNewTask}
                              className={`rounded-lg px-4 py-1 text-[10px] font-bold uppercase tracking-wider shadow-lg transition-all active:scale-95 ${
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
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};

export default WeeklySchedulePanel;


