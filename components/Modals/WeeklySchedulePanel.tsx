import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTimer } from '../../context/TimerContext';
import { Task } from '../../types';

const PRESET_COLORS = ['#BA4949', '#38858a', '#397097', '#8c5e32', '#7a5c87', '#547a59'];

const clampEstimate = (value: number) => {
  if (!Number.isFinite(value)) return 1;
  return Math.min(99, Math.max(1, Math.floor(value)));
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

const getPredictedPomos = (task: Task) => Math.max(1, task.estimated - task.completed);
const formatPomoLabel = (count: number) => `${count} POMO${count === 1 ? '' : 'S'}`;

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

const ScheduleTaskCard: React.FC<{
  task: Task;
  onDragStart: (taskId: number) => void;
  onDragEnd: () => void;
  onSave: (task: Task) => void;
  isDragging?: boolean;
  isDropAnimating?: boolean;
}> = ({ task, onDragStart, onDragEnd, onSave, isDragging = false, isDropAnimating = false }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isSettlingAfterEdit, setIsSettlingAfterEdit] = useState(false);
  const [name, setName] = useState(task.name);
  const [estimated, setEstimated] = useState(task.estimated);
  const [color, setColor] = useState(task.color || PRESET_COLORS[0]);
  const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isEditing) {
      setName(task.name);
      setEstimated(task.estimated);
      setColor(task.color || PRESET_COLORS[0]);
    }
  }, [task, isEditing]);

  useEffect(() => {
    return () => {
      if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
    };
  }, []);

  const predictedPomos = getPredictedPomos(task);
  const displayColor = task.color || PRESET_COLORS[0];
  const additionalHeight = Math.min(44, Math.max(0, predictedPomos - 1) * 8);
  const taskGlassStyle = useMemo(() => ({
    background: `linear-gradient(142deg, ${colorToRgba(displayColor, 0.38)} 0%, ${colorToRgba(displayColor, 0.24)} 46%, ${colorToRgba(displayColor, 0.15)} 100%)`,
    borderColor: colorToRgba(displayColor, 0.5),
    boxShadow: `inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 10px 24px -18px ${colorToRgba(displayColor, 0.88)}`,
    minHeight: `${58 + additionalHeight}px`,
  }), [displayColor, additionalHeight]);
  const exitEdit = () => {
    setIsEditing(false);
    setIsSettlingAfterEdit(true);
    if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
    settleTimeoutRef.current = setTimeout(() => setIsSettlingAfterEdit(false), 260);
  };

  if (isEditing) {
    return (
      <div className="doro-soft-expand rounded-xl border border-white/15 bg-black/30 p-2.5">
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full bg-transparent border-b border-white/20 pb-1 text-sm text-white outline-none focus:border-white/45"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center rounded-md border border-white/15 bg-black/20 overflow-hidden">
            <button
              type="button"
              onClick={() => setEstimated(prev => clampEstimate(prev - 1))}
              className="px-2 py-1 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Decrease predicted pomodoros"
            >
              -
            </button>
            <div className="w-8 text-center text-xs text-white font-mono font-bold">{estimated}</div>
            <button
              type="button"
              onClick={() => setEstimated(prev => clampEstimate(prev + 1))}
              className="px-2 py-1 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Increase predicted pomodoros"
            >
              +
            </button>
          </div>
          <div className="flex items-center gap-1">
            {PRESET_COLORS.map((nextColor) => (
              <button
                key={`schedule-edit-color-${task.id}-${nextColor}`}
                type="button"
                onClick={() => setColor(nextColor)}
                className={`w-4 h-4 rounded-full transition-all ${
                  color === nextColor ? 'ring-2 ring-white ring-offset-1 ring-offset-transparent scale-110' : 'opacity-75 hover:opacity-100 hover:scale-110'
                }`}
                style={{ backgroundColor: nextColor }}
                aria-label={`Set color ${nextColor}`}
              />
            ))}
          </div>
        </div>
        <div className="mt-2 flex justify-end gap-1.5">
          <button
            type="button"
            onClick={exitEdit}
            className="px-2.5 py-1 rounded-md border border-white/10 text-[10px] uppercase tracking-[0.14em] text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onSave({ ...task, name: name.trim() || task.name, estimated: clampEstimate(estimated), color });
              exitEdit();
            }}
            className="px-2.5 py-1 rounded-md border border-teal-100/35 bg-teal-300/20 text-[10px] uppercase tracking-[0.14em] font-bold text-teal-50 hover:bg-teal-300/30 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', String(task.id));
        event.dataTransfer.effectAllowed = 'move';
        onDragStart(task.id);
      }}
      onDragEnd={onDragEnd}
      className={`group relative rounded-xl border p-2.5 transition-all duration-200 cursor-grab active:cursor-grabbing hover:bg-white/[0.08] hover:border-white/20 ${isDragging ? 'doro-dragging-card' : ''} ${isDropAnimating ? 'doro-drop-pop' : ''} ${isSettlingAfterEdit ? 'doro-edit-close-settle' : ''}`}
      style={taskGlassStyle}
    >
      <div className="pointer-events-none absolute inset-0 rounded-xl bg-[linear-gradient(160deg,rgba(255,255,255,0.35),rgba(255,255,255,0.08)_34%,rgba(255,255,255,0)_64%)] opacity-60" />
      <div className="relative z-10 pr-8">
        <div className="text-[16px] leading-tight text-white font-bold truncate">{task.name}</div>
        <div className="mt-1 text-[9px] uppercase tracking-[0.1em] text-white/45 font-sans font-medium">
          {formatPomoLabel(predictedPomos)}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 w-6 h-6 rounded-md border border-white/10 bg-white/5 text-white/60 hover:text-white hover:bg-white/10 transition-all flex items-center justify-center z-10"
        aria-label="Edit task"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>
    </div>
  );
};

interface WeeklySchedulePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const WeeklySchedulePanel: React.FC<WeeklySchedulePanelProps> = ({ isOpen, onClose }) => {
  const { tasks, updateTask, addDetailedTask, activeColor, settings } = useTimer();
  const isLightTheme = settings.themeMode !== 'dark';
  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);
  const [dropAnimatedTaskId, setDropAnimatedTaskId] = useState<number | null>(null);
  const [dropAnimatedDayKey, setDropAnimatedDayKey] = useState<string | null>(null);
  const [hoveredLane, setHoveredLane] = useState<string | null>(null);
  const [addingDate, setAddingDate] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [extendSchedule, setExtendSchedule] = useState(false);
  const [showUnscheduled, setShowUnscheduled] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskEst, setNewTaskEst] = useState(1);
  const [newTaskColor, setNewTaskColor] = useState(activeColor || PRESET_COLORS[0]);
  const todayAnchorRef = useRef<HTMLDivElement | null>(null);
  const dropAnimTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const todayKey = useMemo(() => getDateKey(new Date()), []);
  const todayDate = useMemo(() => parseDateKey(todayKey), [todayKey]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    return () => {
      if (dropAnimTimeoutRef.current) clearTimeout(dropAnimTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setHoveredLane(null);
      setDraggingTaskId(null);
      setDropAnimatedTaskId(null);
      setDropAnimatedDayKey(null);
      setAddingDate(null);
      setShowHistory(false);
      setExtendSchedule(false);
      setShowUnscheduled(false);
      return;
    }
    setNewTaskName('');
    setNewTaskEst(1);
    setNewTaskColor(activeColor || PRESET_COLORS[0]);
    setShowHistory(false);
    setExtendSchedule(false);
    setShowUnscheduled(false);
  }, [isOpen, activeColor]);

  useEffect(() => {
    if (!isOpen) return;
    const unscheduledActive = tasks.filter(task => !task.checked && !task.isFuture && !task.scheduledDate);
    if (unscheduledActive.length === 0) return;
    unscheduledActive.forEach(task => updateTask({ ...task, scheduledDate: todayKey }));
  }, [isOpen, tasks, todayKey, updateTask]);

  const rootOpenTasks = useMemo(() => tasks.filter((task) => !task.checked), [tasks]);

  const dayRange = useMemo(() => {
    const mondayOffset = (todayDate.getDay() + 6) % 7;
    const weekStart = new Date(todayDate);
    weekStart.setDate(todayDate.getDate() - mondayOffset);
    const weekEnd = addDays(weekStart, 6);

    let start = showHistory ? addDays(todayDate, -21) : new Date(todayDate);
    let end = extendSchedule ? addDays(weekEnd, 21) : weekEnd;

    const scheduledKeys = rootOpenTasks
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
  }, [rootOpenTasks, todayKey, todayDate, showHistory, extendSchedule]);

  useEffect(() => {
    if (!isOpen) return;
    const timeout = setTimeout(() => {
      todayAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => clearTimeout(timeout);
  }, [isOpen, dayRange.length]);

  const tasksByDate = useMemo(() => {
    const map: Record<string, Task[]> = {};
    dayRange.forEach((day) => {
      map[day.key] = [];
    });

    rootOpenTasks.forEach((task) => {
      if (!task.scheduledDate) return;
      if (map[task.scheduledDate]) map[task.scheduledDate].push(task);
    });
    return map;
  }, [rootOpenTasks, dayRange]);

  const unscheduledTasks = useMemo(() => {
    return rootOpenTasks.filter((task) => !task.scheduledDate);
  }, [rootOpenTasks]);

  const scheduleTask = (taskId: number, date: string | undefined) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    const normalizedDate = !date && !task.isFuture ? todayKey : date;
    if ((task.scheduledDate || undefined) === normalizedDate) return;
    updateTask({ ...task, scheduledDate: normalizedDate });
    setDropAnimatedTaskId(taskId);
    setDropAnimatedDayKey(normalizedDate || 'unscheduled');
    if (dropAnimTimeoutRef.current) clearTimeout(dropAnimTimeoutRef.current);
    dropAnimTimeoutRef.current = setTimeout(() => {
      setDropAnimatedTaskId(null);
      setDropAnimatedDayKey(null);
    }, 520);
  };

  const dropToLane = (event: React.DragEvent<HTMLDivElement>, laneKey: string | undefined) => {
    event.preventDefault();
    const fromTransfer = Number(event.dataTransfer.getData('text/plain'));
    const targetId = Number.isFinite(fromTransfer) && fromTransfer > 0 ? fromTransfer : draggingTaskId;
    if (!targetId) return;
    scheduleTask(targetId, laneKey);
    setDraggingTaskId(null);
    setHoveredLane(null);
  };

  const submitDayTask = (dateKey: string) => {
    if (!newTaskName.trim()) return;
    addDetailedTask({
      name: newTaskName.trim(),
      estimated: clampEstimate(newTaskEst),
      color: newTaskColor,
      scheduledDate: dateKey,
      isFuture: false,
    });
    setNewTaskName('');
    setNewTaskEst(1);
    setAddingDate(null);
  };

  const toggleAddForDay = (dateKey: string) => {
    setAddingDate((prev) => (prev === dateKey ? null : dateKey));
    setNewTaskName('');
    setNewTaskEst(1);
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
          background: linear-gradient(165deg, #f7f9fc 0%, #eef3f9 54%, #ebf1f8 100%) !important;
          border-color: #d5dee9 !important;
          box-shadow: 0 30px 70px -24px rgba(15, 23, 42, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.88) !important;
        }
        .doro-weekly-shell.theme-light [class*="bg-white/"] {
          background-color: rgba(255, 255, 255, 0.72) !important;
        }
        .doro-weekly-shell.theme-light [class*="bg-black/"] {
          background-color: rgba(226, 234, 245, 0.72) !important;
        }
        .doro-weekly-shell.theme-light [class*="border-white/"] {
          border-color: rgba(15, 23, 42, 0.12) !important;
        }
        .doro-weekly-shell.theme-light [class*="text-white"] {
          color: #0d1a2c !important;
        }
        .doro-weekly-shell.theme-light [class*="text-white/"] {
          color: #607086 !important;
        }
        .doro-weekly-shell.theme-light > div:first-child {
          opacity: 0.32;
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
        @keyframes doro-drop-pop {
          0% {
            transform: translateY(4px) scale(0.97);
            opacity: 0.72;
            filter: saturate(0.92);
          }
          55% {
            transform: translateY(-1px) scale(1.02);
            opacity: 1;
            filter: saturate(1.05);
          }
          100% {
            transform: translateY(0) scale(1);
            opacity: 1;
            filter: saturate(1);
          }
        }
        .doro-drop-pop {
          animation: doro-drop-pop 420ms cubic-bezier(0.2, 0.9, 0.3, 1.08);
        }
        @keyframes doro-edit-close-settle {
          0% {
            transform: translateY(2px) scale(0.985);
            filter: saturate(0.9);
          }
          55% {
            transform: translateY(-1px) scale(1.01);
            filter: saturate(1.03);
          }
          100% {
            transform: translateY(0) scale(1);
            filter: saturate(1);
          }
        }
        .doro-edit-close-settle {
          animation: doro-edit-close-settle 280ms cubic-bezier(0.22, 1, 0.36, 1);
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
          filter: saturate(0.82);
        }
        .schedule-reveal-controls {
          opacity: 0;
          transform: translateY(6px);
          transition: opacity 220ms ease, transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .schedule-header-group:hover .schedule-reveal-controls,
        .schedule-header-group:focus-within .schedule-reveal-controls {
          opacity: 1;
          transform: translateY(0);
        }
        @media (hover: none) {
          .schedule-reveal-controls {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
      <div
        className={`fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px] transition-opacity duration-500 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      <aside
        className={`doro-weekly-shell ${isLightTheme ? 'theme-light' : 'theme-dark'} fixed right-0 top-0 bottom-0 z-50 w-full md:w-[min(92vw,1000px)] bg-[#0e1116]/95 border-l border-white/10 shadow-[0_20px_80px_rgba(0,0,0,0.45)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${isOpen ? 'translate-x-0' : 'translate-x-full'} overflow-hidden`}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_46%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.05),transparent_42%)] pointer-events-none" />

        <div className="relative h-full flex flex-col">
          <div className="schedule-header-group px-4 md:px-6 py-4 border-b border-white/10 bg-black/20 backdrop-blur-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-white/45 font-bold">Schedule View</div>
                <h2 className="mt-1 text-2xl font-bold text-white tracking-tight">Weekly Planner</h2>
                <p className="mt-1 text-xs text-white/55 font-mono">{visibleRangeLabel}</p>
                <div className="schedule-reveal-controls mt-3 flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setShowHistory(prev => !prev)}
                    className={`px-2.5 py-1 rounded-lg border text-[10px] uppercase tracking-[0.14em] font-bold transition-colors ${
                      showHistory
                        ? 'border-white/25 bg-white/14 text-white'
                        : 'border-white/10 bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.1]'
                    }`}
                  >
                    {showHistory ? 'Hide History' : 'See History'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setExtendSchedule(prev => !prev)}
                    className={`px-2.5 py-1 rounded-lg border text-[10px] uppercase tracking-[0.14em] font-bold transition-colors ${
                      extendSchedule
                        ? 'border-white/25 bg-white/14 text-white'
                        : 'border-white/10 bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.1]'
                    }`}
                  >
                    {extendSchedule ? 'Default Range' : 'Extend Schedule'}
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-9 h-9 rounded-xl border border-white/10 bg-white/[0.06] text-white/70 hover:text-white hover:bg-white/[0.12] transition-colors"
                aria-label="Close weekly schedule panel"
              >
                X
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-6 py-4">
            {unscheduledTasks.length > 0 && (
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setHoveredLane('unscheduled');
                }}
                onDragLeave={() => setHoveredLane((value) => (value === 'unscheduled' ? null : value))}
                onDrop={(event) => dropToLane(event, undefined)}
                className={`rounded-xl border p-2.5 mb-3 transition-colors duration-200 ${dropAnimatedDayKey === 'unscheduled' ? 'doro-lane-hit' : ''} ${
                  hoveredLane === 'unscheduled' ? 'border-white/40 bg-white/[0.12]' : 'border-white/10 bg-white/[0.05]'
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-white/45 font-bold">Unscheduled</div>
                  <div className="flex items-center gap-2">
                    <div className="text-[11px] text-white/70 font-sans font-medium tracking-[0.06em]">{formatPomoLabel(unscheduledPomos)}</div>
                    <button
                      type="button"
                      onClick={() => setShowUnscheduled(prev => !prev)}
                      className="w-5 h-5 rounded-md border border-white/10 bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.1] transition-all flex items-center justify-center"
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
                        onSave={updateTask}
                        isDragging={draggingTaskId === task.id}
                        isDropAnimating={dropAnimatedTaskId === task.id}
                        onDragStart={(taskId) => setDraggingTaskId(taskId)}
                        onDragEnd={() => {
                          setDraggingTaskId(null);
                          setHoveredLane(null);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2.5 pb-5">
              {dayRange.map((day) => {
                const dayTasks = tasksByDate[day.key] || [];
                const dayPredictedPomos = dayTasks.reduce((sum, task) => sum + getPredictedPomos(task), 0);
                const isAddingHere = addingDate === day.key;
                const isHovered = hoveredLane === day.key;

                return (
                  <div
                    key={day.key}
                    ref={day.isToday ? todayAnchorRef : undefined}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setHoveredLane(day.key);
                    }}
                    onDragLeave={() => setHoveredLane((value) => (value === day.key ? null : value))}
                    onDrop={(event) => dropToLane(event, day.key)}
                    className={`rounded-xl border p-2.5 transition-colors duration-200 ${dropAnimatedDayKey === day.key ? 'doro-lane-hit' : ''} ${
                      isHovered ? 'border-white/40 bg-white/[0.12]' : 'border-white/10 bg-white/[0.05]'
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-10 h-10 rounded-xl border flex flex-col items-center justify-center ${day.isToday ? 'bg-white text-black border-white' : 'bg-black/25 border-white/15 text-white/80'}`}>
                          <div className="text-[9px] font-bold tracking-widest">{day.label}</div>
                          <div className="text-[14px] font-bold leading-none mt-0.5">{day.dayNumber}</div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[10px] uppercase tracking-[0.16em] text-white/45 font-bold truncate">{day.monthLabel}</div>
                          <div className="text-xs text-white/75 font-sans font-medium tracking-[0.06em] truncate">{formatPomoLabel(dayPredictedPomos)}</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleAddForDay(day.key)}
                        className="w-7 h-7 rounded-lg border border-white/10 bg-white/[0.06] text-white/70 hover:text-white hover:bg-white/[0.12] transition-all shrink-0"
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
                          onSave={updateTask}
                          isDragging={draggingTaskId === task.id}
                          isDropAnimating={dropAnimatedTaskId === task.id}
                          onDragStart={(taskId) => setDraggingTaskId(taskId)}
                          onDragEnd={() => {
                            setDraggingTaskId(null);
                            setHoveredLane(null);
                          }}
                        />
                      ))}

                      {dayTasks.length === 0 && !isAddingHere && (
                        <button
                          type="button"
                          onClick={() => toggleAddForDay(day.key)}
                          className="w-full rounded-lg border border-dashed border-white/10 py-2.5 text-center text-[10px] uppercase tracking-[0.12em] text-white/30 hover:text-white/70 hover:border-white/20 hover:bg-white/[0.05] transition-colors"
                          aria-label={`Add task for ${day.label}`}
                        >
                          No Tasks
                        </button>
                      )}
                    </div>

                    {isAddingHere && (
                      <div className="doro-soft-expand mt-2.5 rounded-xl border border-white/15 bg-black/25 p-2.5">
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
                          placeholder="Task name..."
                          className="w-full bg-transparent border-b border-white/20 pb-1.5 text-sm text-white placeholder-white/35 outline-none focus:border-white/45"
                        />
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setNewTaskEst((value) => clampEstimate(value - 1))}
                              className="w-6 h-6 rounded-md border border-white/15 text-white/70 hover:text-white hover:bg-white/[0.12] transition-colors"
                            >
                              -
                            </button>
                            <div className="min-w-[24px] text-center text-xs text-white/80 font-mono">{newTaskEst}</div>
                            <button
                              type="button"
                              onClick={() => setNewTaskEst((value) => clampEstimate(value + 1))}
                              className="w-6 h-6 rounded-md border border-white/15 text-white/70 hover:text-white hover:bg-white/[0.12] transition-colors"
                            >
                              +
                            </button>
                          </div>

                          <div className="flex items-center gap-1">
                            {PRESET_COLORS.map((color) => (
                              <button
                                key={`week-color-${day.key}-${color}`}
                                type="button"
                                onClick={() => setNewTaskColor(color)}
                                className={`w-4 h-4 rounded-full transition-all duration-300 ease-out ${
                                  newTaskColor === color
                                    ? 'ring-2 ring-white ring-offset-1 ring-offset-transparent scale-110'
                                    : 'opacity-80 hover:opacity-100 hover:scale-110 hover:-translate-y-[1px]'
                                }`}
                                style={{ backgroundColor: color }}
                                aria-label={`Pick color ${color}`}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setAddingDate(null)}
                            className="px-2.5 py-1 rounded-md border border-white/10 text-[10px] uppercase tracking-[0.14em] font-bold text-white/55 hover:text-white hover:bg-white/[0.08] transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => submitDayTask(day.key)}
                            className="px-2.5 py-1 rounded-md border border-white/20 bg-white text-[10px] uppercase tracking-[0.14em] font-bold text-black hover:bg-white/90 transition-colors"
                          >
                            Add
                          </button>
                        </div>
                      </div>
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

