import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Category, LogEntry } from '../../types';
import {
  computeAccountInsights,
  DayPartKey,
  normalizeAccountLogWindow,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT_LABELS,
} from '../../utils/accountInsights';
import { getCategoryMapById, resolveLogEntryCategory } from '../../utils/categoryTracking';
import { isProductiveFocusLog } from '../../utils/logClassification';
import {
  formatPomodoroCount,
  getAccountStatsPomodoroEquivalent,
  getPomodoroEquivalentWeight,
  isMiniPomodoroCompleteReason,
} from '../../utils/pomodoroAccounting';
import { PASTEL_SWATCHES as PRESET_COLORS } from '../../utils/palette';
import { buildSessionClockCycleOverlayWindows } from '../../utils/sessionClock';

interface AccountInsightsProps {
  logs: LogEntry[];
  categories: Category[];
  joinedAt: string;
  accentColor: string;
  isLightTheme: boolean;
  showTodayStats?: boolean;
  placement?: 'all' | 'snapshot-charts' | 'remaining';
}

type CategorySliceWithColor = { name: string; minutes: number; share: number; color: string };
type AnalyticsRangeKey = 'week' | 'month' | 'year';
type FocusWindow = {
  startMs: number;
  endMs: number;
  categoryName: string;
  categoryColor: string;
  pomodoroEquivalent: number;
  reasonCompletionWeight: number;
  isMiniPomo: boolean;
};
type BreakWindow = {
  startMs: number;
  endMs: number;
};
type SessionClockCycle = {
  index: number;
  startMinutes: number;
  endMinutes: number;
};
type SessionClockSegment = {
  startMinutes: number;
  endMinutes: number;
  categoryName: string;
  categoryColor: string;
};
type SessionClockSession = {
  id: string;
  startMs: number;
  endMs: number | null;
  closed: boolean;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  segments: SessionClockSegment[];
  cycleOverlays: SessionClockCycle[];
  pomoDisplayValue: string;
  pomoDisplayUnit: string;
  primaryColor: string;
};
type DailyCategoryBucket = {
  dateKey: string;
  dateMs: number;
  totalMinutes: number;
  categories: CategorySliceWithColor[];
  topCategoryName: string | null;
  topCategoryColor: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ANALYTICS_RANGE_DAYS: Record<AnalyticsRangeKey, number> = {
  week: 7,
  month: 30,
  year: 365,
};
const ANALYTICS_RANGE_LABELS: Record<AnalyticsRangeKey, string> = {
  week: 'Week',
  month: 'Month',
  year: 'Year',
};
const ANALYTICS_RANGE_OPTIONS: Array<[AnalyticsRangeKey, string]> = [
  ['week', 'Week'],
  ['month', 'Month'],
  ['year', 'Year'],
];
const SESSION_CLOCK_AXIS_MARK_COUNT = 5;
const SESSION_CLOCK_AXIS_PADDING_MINUTES = 60;
const SESSION_CLOCK_MIN_AXIS_RANGE_MINUTES = 4 * 60;
const SESSION_CLOCK_NICE_AXIS_STEP_MINUTES = 4 * 60;
const HEATMAP_WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const HEATMAP_FULL_COLOR_MINUTES = 360;
const HEATMAP_SCALE_CAP_MINUTES = 720;
const OTHER_CATEGORY_COLOR = '#94A3B8';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const rgba = (color: string, alpha: number) => {
  const a = Math.max(0, Math.min(1, alpha));
  const value = color.trim();
  if (/^#([0-9a-f]{3})$/i.test(value)) {
    const hex = value.slice(1);
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  if (/^#([0-9a-f]{6})$/i.test(value)) {
    const hex = value.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return `rgba(255, 255, 255, ${a})`;
};

const formatMinutesCompact = (minutes: number) => {
  const safe = Math.max(0, minutes);
  if (safe >= 120) return `${Math.round(safe / 60)}h`;
  if (safe >= 60) return `${(safe / 60).toFixed(1)}h`;
  return `${Math.round(safe)}m`;
};

const formatMinutesPrecise = (minutes: number) => {
  const safe = Math.max(0, minutes);
  const roundedTotalMinutes = Math.round(safe);
  const hours = Math.floor(roundedTotalMinutes / 60);
  const mins = roundedTotalMinutes % 60;
  if (hours <= 0) return `${mins} min`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
};

const formatPct = (value: number) => `${Math.round(value * 100)}%`;
const formatHour = (hour: number) => {
  const normalized = ((hour % 24) + 24) % 24;
  const suffix = normalized >= 12 ? 'PM' : 'AM';
  const base = normalized % 12 || 12;
  return `${base} ${suffix}`;
};

const formatClockMinutes = (minutes: number | null) => {
  if (minutes === null || !Number.isFinite(minutes)) return '--';
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const mins = normalized % 60;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${mins.toString().padStart(2, '0')} ${suffix}`;
};

const formatSessionClockAxisLabel = (minutes: number) => {
  const rounded = Math.round(minutes);
  const normalized = ((rounded % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const mins = normalized % 60;
  const suffix = hour24 >= 12 ? 'P' : 'A';
  const hour12 = hour24 % 12 || 12;
  if (mins === 0) return `${hour12}${suffix}`;
  return `${hour12}:${mins.toString().padStart(2, '0')}${suffix}`;
};

const formatHourList = (hours: number[]) => {
  if (hours.length === 0) return 'No focus yet';
  if (hours.length <= 3) return hours.map(formatHour).join(' / ');
  return `${hours.slice(0, 3).map(formatHour).join(' / ')} +${hours.length - 3}`;
};

const formatQuitBucketList = (buckets: number[]) => {
  if (buckets.length === 0) return '--';
  if (buckets.length <= 3) return buckets.map((bucket) => formatClockMinutes(bucket)).join(' / ');
  return `${buckets.slice(0, 3).map((bucket) => formatClockMinutes(bucket)).join(' / ')} +${buckets.length - 3}`;
};

const formatSessionRange = (startMs: number, endMs: number | null) => {
  const start = new Date(startMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (endMs === null) return `${start} - Open`;
  const end = new Date(endMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${start} - ${end}`;
};

const startOfLocalDay = (ms: number) => {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const startOfLocalWeek = (ms: number) => {
  const date = new Date(startOfLocalDay(ms));
  date.setDate(date.getDate() - date.getDay());
  return date.getTime();
};

const startOfLocalYear = (ms: number) => {
  const date = new Date(ms);
  return new Date(date.getFullYear(), 0, 1).getTime();
};

const startOfNextLocalYear = (ms: number) => {
  const date = new Date(ms);
  return new Date(date.getFullYear() + 1, 0, 1).getTime();
};

const getMinutesOfDay = (ms: number) => {
  const date = new Date(ms);
  return date.getHours() * 60 + date.getMinutes() + (date.getSeconds() / 60);
};

const getLocalDateKey = (ms: number) => {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const normalizeProductiveFocusWindow = (entry: LogEntry) => {
  if (!isProductiveFocusLog(entry)) return null;

  return normalizeAccountLogWindow(entry);
};

const distributeMinutesByDay = (
  startMs: number,
  endMs: number,
  onSlice: (dateKey: string, minutes: number) => void,
) => {
  let cursor = startMs;
  while (cursor < endMs) {
    const dayStartMs = startOfLocalDay(cursor);
    const nextDayStartMs = dayStartMs + DAY_MS;
    const nextMs = Math.min(endMs, nextDayStartMs);
    onSlice(getLocalDateKey(cursor), (nextMs - cursor) / 60_000);
    cursor = nextMs;
  }
};

const buildDailyCategoryBucketsForRange = (
  startMs: number,
  endMs: number,
  focusWindows: FocusWindow[],
): DailyCategoryBucket[] => {
  const normalizedStartMs = startOfLocalDay(startMs);
  const normalizedEndMs = startOfLocalDay(endMs);
  if (normalizedEndMs <= normalizedStartMs) return [];

  const dayCount = Math.max(0, Math.round((normalizedEndMs - normalizedStartMs) / DAY_MS));
  const rawBuckets = Array.from({ length: dayCount }, (_, index) => {
    const dateMs = normalizedStartMs + (index * DAY_MS);
    return {
      dateKey: getLocalDateKey(dateMs),
      dateMs,
      totalMinutes: 0,
      categoryMap: new Map<string, { minutes: number; color: string }>(),
    };
  });
  const bucketMap = new Map(rawBuckets.map((bucket) => [bucket.dateKey, bucket]));

  focusWindows.forEach((window) => {
    if (window.endMs <= normalizedStartMs || window.startMs >= normalizedEndMs) return;
    distributeMinutesByDay(
      Math.max(window.startMs, normalizedStartMs),
      Math.min(window.endMs, normalizedEndMs),
      (dateKey, minutes) => {
        const bucket = bucketMap.get(dateKey);
        if (!bucket) return;
        bucket.totalMinutes += minutes;
        const existing = bucket.categoryMap.get(window.categoryName);
        bucket.categoryMap.set(window.categoryName, {
          minutes: (existing?.minutes || 0) + minutes,
          color: existing?.color || window.categoryColor,
        });
      },
    );
  });

  return rawBuckets.map((bucket) => {
    const categoriesForDay = Array.from(bucket.categoryMap.entries())
      .map(([name, value]) => ({
        name,
        minutes: value.minutes,
        share: bucket.totalMinutes > 0 ? value.minutes / bucket.totalMinutes : 0,
        color: value.color,
      }))
      .sort((left, right) => right.minutes - left.minutes);

    return {
      dateKey: bucket.dateKey,
      dateMs: bucket.dateMs,
      totalMinutes: bucket.totalMinutes,
      categories: categoriesForDay,
      topCategoryName: categoriesForDay[0]?.name ?? null,
      topCategoryColor: categoriesForDay[0]?.color ?? null,
    };
  });
};

const getDateFromKey = (dateKey: string) => new Date(`${dateKey}T12:00:00`);
const formatDateKeyStamp = (dateKey: string) => getDateFromKey(dateKey).toLocaleDateString([], { month: 'short', day: 'numeric' });
const formatDateKeyFullStamp = (dateKey: string) => getDateFromKey(dateKey).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const formatDateKeyAxisStamp = (dateKey: string) => getDateFromKey(dateKey).toLocaleDateString([], { month: 'numeric', day: 'numeric' });
const formatWeekRangeLabel = (weekStartMs: number) => {
  const start = new Date(weekStartMs);
  const end = new Date(weekStartMs + (6 * DAY_MS));
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startLabel = start.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const endLabel = end.toLocaleDateString([], sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
  return `${startLabel} - ${endLabel}`;
};

const findScrollableParent = (element: HTMLElement | null) => {
  let current = element?.parentElement || null;
  while (current) {
    const style = window.getComputedStyle(current);
    if (/(auto|scroll)/.test(style.overflowY)) return current;
    current = current.parentElement;
  }
  return null;
};

const dayPartLabels: Record<DayPartKey, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  night: 'Night',
};

const Card: React.FC<{
  title?: string;
  subtitle?: string;
  accent?: string;
  isLightTheme: boolean;
  children: React.ReactNode;
}> = ({ title, subtitle, accent, isLightTheme, children }) => {
  const hasHeader = Boolean(title || subtitle);

  return (
    <div
      className="relative overflow-hidden rounded-[1.7rem] border p-5 md:p-6"
      style={{
        borderColor: isLightTheme ? 'rgba(148, 163, 184, 0.18)' : 'rgba(255, 255, 255, 0.08)',
        backgroundColor: isLightTheme ? 'rgba(255, 255, 255, 0.92)' : 'rgba(16, 20, 27, 0.9)',
        boxShadow: isLightTheme
          ? '0 24px 52px -42px rgba(15, 23, 42, 0.16)'
          : '0 28px 58px -46px rgba(0, 0, 0, 0.7)',
      }}
    >
      <div className="relative">
        {hasHeader && (
          <div className="flex items-start gap-2.5">
            {accent && (
              <span
                className="mt-2 h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: accent }}
              />
            )}
            <div>
              {title && (
                <div className={isLightTheme ? 'text-lg font-bold tracking-tight text-slate-950' : 'text-lg font-bold tracking-tight text-white'}>
                  {title}
                </div>
              )}
              {subtitle && (
                <div className={isLightTheme ? 'mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-500' : 'mt-1.5 max-w-2xl text-sm leading-relaxed text-white/56'}>
                  {subtitle}
                </div>
              )}
            </div>
          </div>
        )}
        <div className={hasHeader ? 'mt-4' : ''}>{children}</div>
      </div>
    </div>
  );
};

const AccountInsights: React.FC<AccountInsightsProps> = ({
  logs,
  categories,
  joinedAt,
  accentColor,
  isLightTheme,
  showTodayStats = true,
  placement = 'all',
}) => {
  const insights = useMemo(() => computeAccountInsights({ logs, categories, joinedAt }), [categories, joinedAt, logs]);
  const categoryColors = useMemo(() => {
    const categoriesById = getCategoryMapById(categories);
    const map = new Map(categories.map((category) => [category.name, category.color]));
    logs.forEach((entry) => {
      const resolvedCategory = resolveLogEntryCategory(entry, categoriesById);
      if (resolvedCategory.name && resolvedCategory.color && !map.has(resolvedCategory.name)) {
        map.set(resolvedCategory.name, resolvedCategory.color);
      }
    });
    return map;
  }, [categories, logs]);
  const categorySlices = useMemo<CategorySliceWithColor[]>(() => (
    insights.categorySlices.map((slice, index) => ({
      ...slice,
      color: slice.name === 'Uncategorized'
        ? OTHER_CATEGORY_COLOR
        : (categoryColors.get(slice.name) || PRESET_COLORS[index % PRESET_COLORS.length]),
    }))
  ), [accentColor, categoryColors, insights.categorySlices]);

  const [activeCategoryName, setActiveCategoryName] = useState<string | null>(categorySlices[0]?.name ?? null);
  const [isCategoryShareChartHovered, setIsCategoryShareChartHovered] = useState(false);
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsRangeKey>('month');
  const [heatmapRange, setHeatmapRange] = useState<AnalyticsRangeKey>('month');
  const [hoveredTrendDateKey, setHoveredTrendDateKey] = useState<string | null>(null);
  const [hoveredCategoryTrendDateKey, setHoveredCategoryTrendDateKey] = useState<string | null>(null);
  const [hoveredCategoryFlowName, setHoveredCategoryFlowName] = useState<string | null>(null);
  const [hoveredSessionLaneKey, setHoveredSessionLaneKey] = useState<string | null>(null);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [hoveredHeatmapDateKey, setHoveredHeatmapDateKey] = useState<string | null>(null);
  const [selectedHeatmapDateKey, setSelectedHeatmapDateKey] = useState<string | null>(null);
  const [selectedSessionWeekStartMs, setSelectedSessionWeekStartMs] = useState<number | null>(null);
  const heatmapScrollRef = useRef<HTMLDivElement | null>(null);
  const sessionClockTouchStartRef = useRef<{ x: number; y: number } | null>(null);

  const focusWindows = useMemo<FocusWindow[]>(() => {
    const categoriesById = getCategoryMapById(categories);
    return logs
      .map((entry) => {
        const normalized = normalizeProductiveFocusWindow(entry);
        if (!normalized) return null;
        const resolvedCategory = resolveLogEntryCategory(entry, categoriesById);
        const categoryName = resolvedCategory.name || 'Uncategorized';
        return {
          ...normalized,
          categoryName,
          categoryColor: resolvedCategory.color || categoryColors.get(categoryName) || entry.color || accentColor,
          pomodoroEquivalent: getAccountStatsPomodoroEquivalent(entry),
          reasonCompletionWeight: getPomodoroEquivalentWeight(entry),
          isMiniPomo: isMiniPomodoroCompleteReason(entry.reason),
        };
      })
      .filter((window): window is FocusWindow => Boolean(window));
  }, [accentColor, categories, categoryColors, logs]);
  const breakWindows = useMemo<BreakWindow[]>(() => (
    logs
      .map((entry) => {
        if (entry.type !== 'break') return null;
        const normalized = normalizeAccountLogWindow(entry);
        return normalized ? { startMs: normalized.startMs, endMs: normalized.endMs } : null;
      })
      .filter((window): window is BreakWindow => Boolean(window))
  ), [logs]);

  const rollingDailyCategoryBuckets = useMemo<DailyCategoryBucket[]>(() => {
    const todayStartMs = startOfLocalDay(Date.now());
    const tomorrowStartMs = todayStartMs + DAY_MS;
    const startMs = todayStartMs - ((ANALYTICS_RANGE_DAYS.year - 1) * DAY_MS);
    return buildDailyCategoryBucketsForRange(startMs, tomorrowStartMs, focusWindows);
  }, [focusWindows]);

  const rangeDayCount = ANALYTICS_RANGE_DAYS[analyticsRange];
  const rangeDailyBuckets = useMemo(
    () => rollingDailyCategoryBuckets.slice(-rangeDayCount),
    [rollingDailyCategoryBuckets, rangeDayCount],
  );
  const calendarYearDailyBuckets = useMemo<DailyCategoryBucket[]>(() => {
    const nowMs = Date.now();
    return buildDailyCategoryBucketsForRange(
      startOfLocalYear(nowMs),
      startOfNextLocalYear(nowMs),
      focusWindows,
    );
  }, [focusWindows]);
  const heatmapDayCount = ANALYTICS_RANGE_DAYS[heatmapRange];
  const heatmapDailyBuckets = useMemo(
    () => heatmapRange === 'year'
      ? calendarYearDailyBuckets
      : rollingDailyCategoryBuckets.slice(-heatmapDayCount),
    [calendarYearDailyBuckets, heatmapDayCount, heatmapRange, rollingDailyCategoryBuckets],
  );
  const focusMinutesByDateKey = useMemo(() => {
    const totals = new Map<string, number>();
    focusWindows.forEach((window) => {
      distributeMinutesByDay(window.startMs, window.endMs, (dateKey, minutes) => {
        totals.set(dateKey, (totals.get(dateKey) || 0) + minutes);
      });
    });
    return totals;
  }, [focusWindows]);
  const sessionClockSessionsByDateKey = useMemo(() => {
    const sessionsByDay = new Map<string, SessionClockSession[]>();

    insights.sessions.forEach((session) => {
      const dateKey = getLocalDateKey(session.startMs);
      const sessionEndMs = session.endMs;
      const dayStartMs = startOfLocalDay(session.startMs);
      const dayEndMs = dayStartMs + DAY_MS;
      const visualEndMs = sessionEndMs ?? Math.min(dayEndMs, session.startMs + Math.max(1, session.totalDurationMinutes) * 60_000);
      const clippedStartMs = Math.max(session.startMs, dayStartMs);
      const clippedEndMs = Math.min(Math.max(visualEndMs, clippedStartMs + 60_000), dayEndMs);
      const startMinutes = getMinutesOfDay(clippedStartMs);
      const endMinutes = clippedEndMs >= dayEndMs ? 1440 : getMinutesOfDay(clippedEndMs);
      const sessionFocusWindows = focusWindows
        .map((window) => {
          const segmentStartMs = Math.max(window.startMs, clippedStartMs);
          const segmentEndMs = Math.min(window.endMs, clippedEndMs);
          if (segmentEndMs <= segmentStartMs) return null;
          return {
            ...window,
            segmentStartMs,
            segmentEndMs,
            startMinutes: getMinutesOfDay(segmentStartMs),
            endMinutes: segmentEndMs >= dayEndMs ? 1440 : getMinutesOfDay(segmentEndMs),
          };
        })
        .filter((window): window is FocusWindow & {
          segmentStartMs: number;
          segmentEndMs: number;
          startMinutes: number;
          endMinutes: number;
        } => Boolean(window))
        .sort((left, right) => left.startMinutes - right.startMinutes);
      const sessionBreakWindows = breakWindows
        .map((window) => {
          const segmentStartMs = Math.max(window.startMs, clippedStartMs);
          const segmentEndMs = Math.min(window.endMs, clippedEndMs);
          if (segmentEndMs <= segmentStartMs) return null;
          return {
            ...window,
            segmentStartMs,
            segmentEndMs,
          };
        })
        .filter((window): window is BreakWindow & {
          segmentStartMs: number;
          segmentEndMs: number;
        } => Boolean(window))
        .sort((left, right) => left.segmentStartMs - right.segmentStartMs);
      const segments = sessionFocusWindows.map((window) => ({
        startMinutes: window.startMinutes,
        endMinutes: window.endMinutes,
        categoryName: window.categoryName,
        categoryColor: window.categoryColor,
      }));
      const totalPomoEquivalent = sessionFocusWindows.reduce(
        (sum, window) => sum + Math.max(0, window.pomodoroEquivalent),
        0,
      );
      const miniPomoCount = sessionFocusWindows.reduce(
        (sum, window) => sum + (window.isMiniPomo && window.reasonCompletionWeight > 0 ? 1 : 0),
        0,
      );
      const hasOnlyMiniPomos = miniPomoCount > 0 && sessionFocusWindows.every((window) => (
        window.isMiniPomo || window.reasonCompletionWeight <= 0
      ));
      const pomoDisplayNumber = hasOnlyMiniPomos ? miniPomoCount : totalPomoEquivalent;
      const pomoDisplayValue = formatPomodoroCount(pomoDisplayNumber);
      const pomoDisplayUnit = hasOnlyMiniPomos
        ? (miniPomoCount === 1 ? 'mini-pomo' : 'mini-pomos')
        : (pomoDisplayNumber === 1 ? 'pomo' : 'pomos');
      const cycleOverlays: SessionClockCycle[] = buildSessionClockCycleOverlayWindows({
        focusWindows: sessionFocusWindows,
        breakWindows: sessionBreakWindows,
        sessionStartMs: clippedStartMs,
        sessionEndMs: clippedEndMs,
      }).map((cycle) => ({
        index: cycle.index,
        startMinutes: getMinutesOfDay(cycle.startMs),
        endMinutes: cycle.endMs >= dayEndMs ? 1440 : getMinutesOfDay(cycle.endMs),
      }));
      const primaryColor = segments.length > 0
        ? segments.reduce((best, segment) => (
          (segment.endMinutes - segment.startMinutes) > (best.endMinutes - best.startMinutes)
            ? segment
            : best
        ), segments[0]).categoryColor
        : accentColor;
      const existing = sessionsByDay.get(dateKey) || [];
      existing.push({
        id: `${session.startMs}:${session.endMs ?? 'open'}`,
        startMs: session.startMs,
        endMs: sessionEndMs,
        closed: session.closed,
        startMinutes,
        endMinutes: Math.max(startMinutes + 1, endMinutes),
        durationMinutes: Math.max(1, session.totalDurationMinutes),
        segments,
        cycleOverlays,
        pomoDisplayValue,
        pomoDisplayUnit,
        primaryColor,
      });
      sessionsByDay.set(dateKey, existing);
    });

    sessionsByDay.forEach((sessions) => sessions.sort((left, right) => left.startMs - right.startMs));
    return sessionsByDay;
  }, [accentColor, breakWindows, focusWindows, insights.sessions]);
  const sessionClockWeekStarts = useMemo(() => {
    const currentWeekStartMs = startOfLocalWeek(Date.now());
    const earliestSessionStartMs = insights.sessions.reduce((earliest, session) => (
      Math.min(earliest, session.startMs)
    ), currentWeekStartMs);
    const firstWeekStartMs = startOfLocalWeek(earliestSessionStartMs);
    const weeks: number[] = [];
    for (let cursor = firstWeekStartMs; cursor <= currentWeekStartMs; cursor += 7 * DAY_MS) {
      weeks.push(cursor);
    }
    return weeks.length > 0 ? weeks : [currentWeekStartMs];
  }, [insights.sessions]);
  const latestSessionClockWeekStartMs = sessionClockWeekStarts[sessionClockWeekStarts.length - 1] ?? startOfLocalWeek(Date.now());
  const activeSessionWeekStartMs = selectedSessionWeekStartMs !== null && sessionClockWeekStarts.includes(selectedSessionWeekStartMs)
    ? selectedSessionWeekStartMs
    : latestSessionClockWeekStartMs;
  const sessionClockWeekIndex = Math.max(0, sessionClockWeekStarts.indexOf(activeSessionWeekStartMs));
  const canGoToPreviousSessionWeek = sessionClockWeekIndex > 0;
  const canGoToNextSessionWeek = sessionClockWeekIndex < sessionClockWeekStarts.length - 1;
  const rollingSessionClockStartMs = startOfLocalDay(Date.now()) - (6 * DAY_MS);
  const displayedSessionLanes = useMemo(() => (
    Array.from({ length: 7 }, (_, index) => {
      const dateMs = rollingSessionClockStartMs + (index * DAY_MS);
      const dateKey = getLocalDateKey(dateMs);
      return {
        dateKey,
        dateMs,
        weekday: new Date(dateMs).getDay(),
        totalFocusMinutes: focusMinutesByDateKey.get(dateKey) || 0,
        sessions: sessionClockSessionsByDateKey.get(dateKey) || [],
      };
    })
  ), [focusMinutesByDateKey, rollingSessionClockStartMs, sessionClockSessionsByDateKey]);
  const sessionClockAxis = useMemo(() => {
    const displayedSessions = displayedSessionLanes.flatMap((lane) => lane.sessions);
    let minMinutes = 0;
    let maxMinutes = 1440;

    if (displayedSessions.length > 0) {
      const earliestSessionMinute = Math.min(...displayedSessions.map((session) => session.startMinutes));
      const latestSessionMinute = Math.max(...displayedSessions.map((session) => session.endMinutes));
      const desiredMin = Math.max(0, Math.floor((earliestSessionMinute - SESSION_CLOCK_AXIS_PADDING_MINUTES) / 60) * 60);
      const desiredMax = Math.min(1440, Math.ceil((latestSessionMinute + SESSION_CLOCK_AXIS_PADDING_MINUTES) / 60) * 60);
      const rawRange = Math.max(SESSION_CLOCK_MIN_AXIS_RANGE_MINUTES, desiredMax - desiredMin);
      const niceRange = Math.min(
        1440,
        Math.ceil(rawRange / SESSION_CLOCK_NICE_AXIS_STEP_MINUTES) * SESSION_CLOCK_NICE_AXIS_STEP_MINUTES,
      );
      minMinutes = Math.max(0, Math.min(desiredMin, 1440 - niceRange));
      if (minMinutes + niceRange < desiredMax) {
        minMinutes = Math.max(0, desiredMax - niceRange);
      }
      maxMinutes = Math.min(1440, minMinutes + niceRange);
    }

    const rangeMinutes = Math.max(1, maxMinutes - minMinutes);
    const marks = Array.from({ length: SESSION_CLOCK_AXIS_MARK_COUNT }, (_, index) => {
      const minutes = minMinutes + ((rangeMinutes * index) / (SESSION_CLOCK_AXIS_MARK_COUNT - 1));
      return {
        minutes,
        label: formatSessionClockAxisLabel(minutes),
        pct: clamp01((minutes - minMinutes) / rangeMinutes) * 100,
      };
    });

    return {
      minMinutes,
      maxMinutes,
      rangeMinutes,
      marks,
    };
  }, [displayedSessionLanes]);

  useEffect(() => {
    setActiveCategoryName((current) => (
      current && categorySlices.some((slice) => slice.name === current)
        ? current
        : (categorySlices[0]?.name ?? null)
    ));
  }, [categorySlices]);

  useEffect(() => {
    const activeTrendExists = hoveredTrendDateKey && insights.dailyFocusTrend.some((point) => point.dateKey === hoveredTrendDateKey);
    if (!activeTrendExists) {
      const latestActivePoint = [...insights.dailyFocusTrend].reverse().find((point) => point.focusMinutes > 0);
      setHoveredTrendDateKey(latestActivePoint?.dateKey ?? insights.dailyFocusTrend[insights.dailyFocusTrend.length - 1]?.dateKey ?? null);
    }
  }, [hoveredTrendDateKey, insights.dailyFocusTrend]);

  useEffect(() => {
    setSelectedSessionWeekStartMs((current) => (
      current !== null && sessionClockWeekStarts.includes(current)
        ? current
        : latestSessionClockWeekStartMs
    ));
  }, [latestSessionClockWeekStartMs, sessionClockWeekStarts]);

  useEffect(() => {
    const laneExists = hoveredSessionLaneKey && displayedSessionLanes.some((lane) => lane.dateKey === hoveredSessionLaneKey);
    if (!laneExists) {
      setHoveredSessionLaneKey([...displayedSessionLanes].reverse().find((lane) => lane.sessions.length > 0)?.dateKey ?? displayedSessionLanes[displayedSessionLanes.length - 1]?.dateKey ?? null);
    }
  }, [displayedSessionLanes, hoveredSessionLaneKey]);

  useEffect(() => {
    if (!hoveredSessionId) return;
    const sessionExists = displayedSessionLanes.some((lane) => lane.sessions.some((session) => session.id === hoveredSessionId));
    if (!sessionExists) setHoveredSessionId(null);
  }, [displayedSessionLanes, hoveredSessionId]);

  useEffect(() => {
    const activeDayExists = hoveredCategoryTrendDateKey && rangeDailyBuckets.some((day) => day.dateKey === hoveredCategoryTrendDateKey);
    if (!activeDayExists) {
      const fallbackDay = [...rangeDailyBuckets].reverse().find((day) => day.totalMinutes > 0) || rangeDailyBuckets[rangeDailyBuckets.length - 1];
      setHoveredCategoryTrendDateKey(fallbackDay?.dateKey ?? null);
    }
  }, [hoveredCategoryTrendDateKey, rangeDailyBuckets]);

  useEffect(() => {
    const fallbackDay = [...heatmapDailyBuckets].reverse().find((day) => day.totalMinutes > 0)
      || heatmapDailyBuckets[heatmapDailyBuckets.length - 1]
      || null;

    setSelectedHeatmapDateKey((current) => (
      current && heatmapDailyBuckets.some((day) => day.dateKey === current)
        ? current
        : fallbackDay?.dateKey ?? null
    ));
    setHoveredHeatmapDateKey((current) => (
      current && heatmapDailyBuckets.some((day) => day.dateKey === current)
        ? current
        : null
    ));
  }, [heatmapDailyBuckets, heatmapRange]);

  const activeCategory = categorySlices.find((slice) => slice.name === activeCategoryName) || categorySlices[0] || null;
  const dominantDayPartsLabel = insights.dominantDayParts.length > 0
    ? insights.dominantDayParts.map((part) => dayPartLabels[part]).join(' / ')
    : 'No focus rhythm yet';

  const donutSegments = useMemo(() => {
    const radius = 46;
    const circumference = 2 * Math.PI * radius;
    let cumulative = 0;
    return categorySlices.map((slice) => {
      const startShare = cumulative;
      const segment = {
        ...slice,
        radius,
        circumference,
        dash: slice.share * circumference,
        offset: -cumulative * circumference,
        midAngle: ((startShare + (slice.share / 2)) * Math.PI * 2) - (Math.PI / 2),
      };
      cumulative += slice.share;
      return segment;
    });
  }, [categorySlices]);

  const trendChartTop = 22;
  const trendChartBottom = 86;
  const trendGridStepPomos = 2;
  const trendLineStrokeWidth = 2.2;
  const trendMaxFocus = Math.max(1, ...insights.dailyFocusTrend.map((point) => point.focusMinutes));
  const trendMaxPomos = Math.max(1, ...insights.dailyFocusTrend.map((point) => point.pomodoros));
  const trendGridMaxPomos = Math.max(
    trendGridStepPomos,
    Math.ceil(trendMaxPomos / trendGridStepPomos) * trendGridStepPomos,
  );
  const trendPoints = useMemo(() => (
    insights.dailyFocusTrend.map((point, index, array) => {
      const edgePadding = 4;
      const x = array.length <= 1
        ? 50
        : edgePadding + ((index / (array.length - 1)) * (100 - (edgePadding * 2)));
      const y = trendChartBottom - ((point.pomodoros / trendGridMaxPomos) * (trendChartBottom - trendChartTop));
      return { ...point, x, y };
    })
  ), [insights.dailyFocusTrend, trendMaxPomos]);
  const trendGuideLineYs = Array.from(
    { length: trendGridMaxPomos / trendGridStepPomos },
    (_, index) => {
      const pomodoros = trendGridStepPomos * (index + 1);
      return trendChartBottom - ((pomodoros / trendGridMaxPomos) * (trendChartBottom - trendChartTop));
    },
  );
  const trendAreaPath = trendPoints.length > 0
    ? `M ${trendPoints[0].x} ${trendChartBottom} ${trendPoints.map((point) => `L ${point.x} ${point.y}`).join(' ')} L ${trendPoints[trendPoints.length - 1].x} ${trendChartBottom} Z`
    : '';
  const trendLinePath = trendPoints.length > 0
    ? `M ${trendPoints[0].x} ${trendPoints[0].y} ${trendPoints.slice(1).map((point) => `L ${point.x} ${point.y}`).join(' ')}`
    : '';
  const defaultTrendPoint = [...insights.dailyFocusTrend].reverse().find((point) => point.focusMinutes > 0)
    || insights.dailyFocusTrend[insights.dailyFocusTrend.length - 1]
    || null;
  const activeTrendPoint = insights.dailyFocusTrend.find((point) => point.dateKey === hoveredTrendDateKey)
    || defaultTrendPoint;
  const activeTrendVisualPoint = activeTrendPoint
    ? trendPoints.find((point) => point.dateKey === activeTrendPoint.dateKey) || null
    : null;
  const setHoveredTrendPoint = (dateKey: string) => {
    setHoveredTrendDateKey((current) => (current === dateKey ? current : dateKey));
  };
  const getClosestTrendPoint = (clientX: number, bounds: DOMRect) => {
    if (trendPoints.length === 0 || bounds.width <= 0) return null;
    const relativeX = ((clientX - bounds.left) / bounds.width) * 100;
    return trendPoints.reduce((closest, point) => (
      Math.abs(point.x - relativeX) < Math.abs(closest.x - relativeX) ? point : closest
    ), trendPoints[0]);
  };
  const updateHoveredTrendPoint = (clientX: number, bounds: DOMRect) => {
    const closestPoint = getClosestTrendPoint(clientX, bounds);
    if (!closestPoint) return;
    setHoveredTrendPoint(closestPoint.dateKey);
  };
  const trendHoverZones = useMemo(() => (
    trendPoints.map((point, index, points) => {
      const previousMid = index === 0 ? 0 : (points[index - 1].x + point.x) / 2;
      const nextMid = index === points.length - 1 ? 100 : (point.x + points[index + 1].x) / 2;
      return {
        dateKey: point.dateKey,
        left: previousMid,
        width: Math.max(0, nextMid - previousMid),
      };
    })
  ), [trendPoints]);
  const recentFocusTotal = insights.dailyFocusTrend.reduce((acc, point) => acc + point.focusMinutes, 0);
  const recentPomoTotal = insights.dailyFocusTrend.reduce((acc, point) => acc + point.pomodoros, 0);
  const trendMaxSessions = Math.max(1, ...insights.dailyFocusTrend.map((point) => point.sessions));
  const activeTrendDayCount = insights.dailyFocusTrend.filter((point) => point.focusMinutes > 0).length;
  const todayTopCategoryColor = insights.today.topCategoryName
    ? (categoryColors.get(insights.today.topCategoryName) || PRESET_COLORS[3])
    : PRESET_COLORS[3];
  const categoryTrendLegend = useMemo(() => {
    const totals = new Map<string, { minutes: number; color: string }>();
    rangeDailyBuckets.forEach((day) => {
      day.categories.forEach((category) => {
        const existing = totals.get(category.name);
        totals.set(category.name, {
          minutes: (existing?.minutes || 0) + category.minutes,
          color: existing?.color || category.color,
        });
      });
    });

    const ranked = Array.from(totals.entries())
      .map(([name, value]) => ({ name, minutes: value.minutes, color: value.color }))
      .sort((left, right) => right.minutes - left.minutes);
    const preferred = ranked.filter((category) => category.name !== 'Uncategorized');
    const visible = (preferred.length > 0 ? preferred : ranked).slice(0, 4);
    const visibleNames = new Set(visible.map((category) => category.name));
    const overflowMinutes = ranked.reduce((sum, category) => (
      visibleNames.has(category.name) ? sum : sum + category.minutes
    ), 0);

    return overflowMinutes > 0
      ? [...visible, { name: 'Other', minutes: overflowMinutes, color: OTHER_CATEGORY_COLOR }]
      : visible;
  }, [rangeDailyBuckets]);
  const categoryTrendMaxTotal = Math.max(1, ...rangeDailyBuckets.map((day) => day.totalMinutes));
  const activeCategoryTrendDay = rangeDailyBuckets.find((day) => day.dateKey === hoveredCategoryTrendDateKey)
    || [...rangeDailyBuckets].reverse().find((day) => day.totalMinutes > 0)
    || rangeDailyBuckets[rangeDailyBuckets.length - 1]
    || null;
  const categoryTrendLabelStep = analyticsRange === 'week' ? 1 : analyticsRange === 'month' ? 5 : 30;
  const categoryTrendBarWidth = analyticsRange === 'week' ? 42 : analyticsRange === 'month' ? 22 : 12;
  const categoryTrendChartMinWidth = Math.max(
    520,
    rangeDailyBuckets.length * (categoryTrendBarWidth + (analyticsRange === 'year' ? 5 : 8)),
  );
  const rangeFocusTotal = rangeDailyBuckets.reduce((sum, day) => sum + day.totalMinutes, 0);
  const heatmapScaleMaxMinutes = useMemo(() => {
    const positiveMinutes = heatmapDailyBuckets
      .map((day) => day.totalMinutes)
      .filter((minutes) => minutes > 0)
      .sort((left, right) => left - right);
    if (positiveMinutes.length === 0) return HEATMAP_FULL_COLOR_MINUTES;
    const percentileIndex = Math.max(0, Math.ceil(positiveMinutes.length * 0.9) - 1);
    const percentileMinutes = positiveMinutes[Math.min(positiveMinutes.length - 1, percentileIndex)] || 0;
    return Math.max(
      HEATMAP_FULL_COLOR_MINUTES,
      Math.min(HEATMAP_SCALE_CAP_MINUTES, percentileMinutes * 1.35),
    );
  }, [heatmapDailyBuckets]);
  const defaultHeatmapDay = [...heatmapDailyBuckets].reverse().find((day) => day.totalMinutes > 0)
    || heatmapDailyBuckets[heatmapDailyBuckets.length - 1]
    || null;
  const activeHeatmapDay = heatmapDailyBuckets.find((day) => day.dateKey === hoveredHeatmapDateKey)
    || heatmapDailyBuckets.find((day) => day.dateKey === selectedHeatmapDateKey)
    || defaultHeatmapDay;
  const activeHeatmapDetail = activeHeatmapDay
    ? activeHeatmapDay.totalMinutes > 0
      ? `${activeHeatmapDay.topCategoryName || 'Uncategorized'} - ${formatMinutesPrecise(activeHeatmapDay.totalMinutes)} focused`
      : 'No saved focus for this day'
    : 'Hover a day to inspect focus';
  const heatmapCellClass = heatmapRange === 'year'
    ? 'h-3.5 w-3.5 rounded-[4px]'
    : heatmapRange === 'month'
      ? 'h-5 w-5 rounded-md'
      : 'h-7 w-7 rounded-lg';
  const heatmapLabelClass = heatmapRange === 'year'
    ? 'h-3.5 w-8'
    : heatmapRange === 'month'
      ? 'h-5 w-8'
      : 'h-7 w-8';
  const heatmapGapStyle = { gap: heatmapRange === 'year' ? '0.375rem' : '0.5rem' };
  const heatmapWeeks = useMemo(() => {
    if (heatmapDailyBuckets.length === 0) return [] as Array<Array<DailyCategoryBucket | null>>;
    const leadingPadding = new Date(heatmapDailyBuckets[0].dateMs).getDay();
    const paddedDays: Array<DailyCategoryBucket | null> = [
      ...Array.from({ length: leadingPadding }, () => null),
      ...heatmapDailyBuckets,
    ];
    while (paddedDays.length % 7 !== 0) paddedDays.push(null);

    const weeks: Array<Array<DailyCategoryBucket | null>> = [];
    for (let index = 0; index < paddedDays.length; index += 7) {
      weeks.push(paddedDays.slice(index, index + 7));
    }
    return weeks;
  }, [heatmapDailyBuckets]);
  const heatmapMonthMarkers = useMemo(() => {
    let previousMonth: number | null = null;
    return heatmapWeeks.map((week, weekIndex) => {
      const firstDay = week.find((day): day is DailyCategoryBucket => day !== null);
      if (!firstDay) return { weekIndex, label: null as string | null };
      const month = new Date(firstDay.dateMs).getMonth();
      const shouldShowLabel = weekIndex === 0 || month !== previousMonth;
      previousMonth = month;
      return {
        weekIndex,
        label: shouldShowLabel ? new Date(firstDay.dateMs).toLocaleDateString([], { month: 'short' }) : null,
      };
    });
  }, [heatmapWeeks]);

  useEffect(() => {
    if (heatmapRange !== 'year') return;
    const element = heatmapScrollRef.current;
    if (!element) return;

    const frame = window.requestAnimationFrame(() => {
      element.scrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [heatmapRange, heatmapWeeks.length]);

  const handleHeatmapWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const element = heatmapScrollRef.current;
    if (heatmapRange !== 'year' || !element) return;
    if (element.scrollWidth <= element.clientWidth + 1) return;

    const dominantDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;
    if (Math.abs(dominantDelta) < 0.5) return;

    const maxScrollLeft = element.scrollWidth - element.clientWidth;
    const scrollingLeft = dominantDelta < 0;
    const atStart = element.scrollLeft <= 1;
    const atEnd = element.scrollLeft >= maxScrollLeft - 1;

    if ((scrollingLeft && atStart) || (!scrollingLeft && atEnd)) return;

    event.preventDefault();
    element.scrollLeft = Math.max(0, Math.min(maxScrollLeft, element.scrollLeft + dominantDelta));
  };

  const rangeSummaryLabel = `${ANALYTICS_RANGE_LABELS[analyticsRange]} view`;
  const categoryLegendTotal = Math.max(1, categoryTrendLegend.reduce((sum, category) => sum + category.minutes, 0));
  const sessionWeekFocusTotal = displayedSessionLanes.reduce((sum, lane) => sum + lane.totalFocusMinutes, 0);
  const sessionClockRangeLabel = formatWeekRangeLabel(rollingSessionClockStartMs);

  const activeSessionLane = displayedSessionLanes.find((lane) => lane.dateKey === hoveredSessionLaneKey)
    || [...displayedSessionLanes].reverse().find((lane) => lane.sessions.length > 0)
    || displayedSessionLanes[displayedSessionLanes.length - 1];
  const activeSession = hoveredSessionId
    ? displayedSessionLanes.flatMap((lane) => lane.sessions.map((session) => ({ lane, session }))).find((entry) => entry.session.id === hoveredSessionId)
    : null;
  const selectedSessionEntry = activeSession
    || (activeSessionLane?.sessions.length
      ? {
          lane: activeSessionLane,
          session: [...activeSessionLane.sessions].sort((left, right) => right.durationMinutes - left.durationMinutes)[0],
        }
      : null);
  const selectedSessionSummary = selectedSessionEntry
    ? {
        timeRange: formatSessionRange(selectedSessionEntry.session.startMs, selectedSessionEntry.session.endMs),
        totalTime: `${formatMinutesPrecise(selectedSessionEntry.session.durationMinutes)} total`,
        pomos: `${selectedSessionEntry.session.pomoDisplayValue} ${selectedSessionEntry.session.pomoDisplayUnit}`,
      }
    : null;
  const bestWeekdayLabel = insights.mostProductiveWeekdays.weekdays.length > 0
    ? WEEKDAY_LABELS[insights.mostProductiveWeekdays.weekdays[0]]
    : 'Still forming';
  const profileHeadline = recentFocusTotal > 0
    ? `${formatMinutesCompact(recentFocusTotal)} of focus in the last 14 days.`
    : 'Saved focus will start building your account profile here.';
  const activeDaysValue = `${activeTrendDayCount}/${insights.dailyFocusTrend.length}`;
  const focusProfileTiles = [
    {
      label: 'Active Days',
      value: activeDaysValue,
      helper: activeTrendDayCount > 0 ? 'Days with saved focus' : 'No active days yet',
      color: PRESET_COLORS[6],
    },
    {
      label: '14-Day Pomodoros',
      value: formatPomodoroCount(recentPomoTotal),
      helper: recentPomoTotal > 0 ? 'Completed in this window' : 'No pomodoros yet',
      color: PRESET_COLORS[2],
    },
    {
      label: 'Average Start',
      value: formatClockMinutes(insights.averageStartMinutes),
      helper: insights.sessions.length > 0
        ? `${insights.sessions.length} saved session${insights.sessions.length === 1 ? '' : 's'}`
        : 'No session starts yet',
      color: PRESET_COLORS[3],
    },
    {
      label: 'Typical Stop',
      value: formatQuitBucketList(insights.mostCommonQuitTimes.bucketMinutes),
      helper: insights.mostCommonQuitTimes.sourceBucketCount > 2
        ? `Average of ${insights.mostCommonQuitTimes.sourceBucketCount} tied stop times`
        : insights.mostCommonQuitTimes.count > 0
        ? `${insights.mostCommonQuitTimes.count} closed session${insights.mostCommonQuitTimes.count === 1 ? '' : 's'}`
        : 'No closed sessions yet',
      color: PRESET_COLORS[5],
    },
  ] as const;
  const todaySummaryCards: Array<{
    label: string;
    value: string;
    helper: string;
    trail: string;
    fill: number;
    color: string;
    valueClassName?: string;
  }> = [
    {
      label: 'Focus Today',
      value: formatMinutesCompact(insights.today.focusMinutes),
      helper: insights.today.focusMinutes > 0 ? `${formatMinutesPrecise(insights.today.focusMinutes)} saved` : 'No saved focus yet',
      trail: insights.today.focusMinutes > 0 ? `${Math.round((insights.today.focusMinutes / trendMaxFocus) * 100)}% of best day` : 'Waiting on focus',
      fill: insights.today.focusMinutes > 0 ? Math.max(10, (insights.today.focusMinutes / trendMaxFocus) * 100) : 0,
      color: accentColor,
    },
    {
      label: 'Pomodoros',
      value: formatPomodoroCount(insights.today.pomodoros),
      helper: insights.today.pomodoros > 0 ? 'Completed today' : 'No pomodoros yet',
      trail: insights.today.pomodoros > 0 ? `${Math.round((insights.today.pomodoros / trendMaxPomos) * 100)}% of top day` : 'No completions',
      fill: insights.today.pomodoros > 0 ? Math.max(10, (insights.today.pomodoros / trendMaxPomos) * 100) : 0,
      color: PRESET_COLORS[2],
    },
    {
      label: 'Sessions',
      value: `${insights.today.sessions}`,
      helper: insights.today.sessions > 0 ? 'Started today' : 'No starts today',
      trail: insights.today.sessions > 0 ? `${Math.round((insights.today.sessions / trendMaxSessions) * 100)}% of top day` : 'No starts logged',
      fill: insights.today.sessions > 0 ? Math.max(10, (insights.today.sessions / trendMaxSessions) * 100) : 0,
      color: PRESET_COLORS[5],
    },
    {
      label: "Today's Top Category",
      value: insights.today.topCategoryName || '--',
      helper: insights.today.topCategoryName ? 'Most focus today' : 'No categorized work yet',
      trail: insights.today.topCategoryName ? 'Leading category so far' : 'Add categories to tasks',
      fill: insights.today.topCategoryName ? 100 : 0,
      color: todayTopCategoryColor,
      valueClassName: 'text-xl font-bold tracking-tight leading-tight text-white break-words',
    },
  ];
  const getInsightInsetStyle = (color: string): React.CSSProperties => ({
    borderColor: isLightTheme ? 'rgba(148, 163, 184, 0.16)' : 'rgba(255, 255, 255, 0.08)',
    backgroundColor: isLightTheme ? rgba(color, 0.065) : 'rgba(255, 255, 255, 0.028)',
    boxShadow: isLightTheme
      ? '0 16px 30px -28px rgba(15, 23, 42, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.74)'
      : '0 18px 34px -30px rgba(0, 0, 0, 0.58), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
  });
  const insetLabelClassName = isLightTheme
    ? 'text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500'
    : 'text-[10px] font-semibold uppercase tracking-[0.14em] text-white/42';
  const insetValueClassName = isLightTheme
    ? 'text-[1.15rem] font-bold tracking-tight text-slate-950'
    : 'text-[1.15rem] font-bold tracking-tight text-white';
  const insetHelperClassName = isLightTheme
    ? 'text-[11px] leading-relaxed text-slate-500'
    : 'text-[11px] leading-relaxed text-white/48';
  const renderInsightInsetCard = (
    card: { label: string; value: string; helper?: string; color: string; valueClassName?: string },
    index = 0,
  ) => (
    <div
      key={card.label}
      className={`group relative overflow-hidden rounded-[1.2rem] border px-4 py-4 md:px-5 md:py-5 transition-[transform,border-color,background-color,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        isLightTheme ? 'hover:-translate-y-[2px] hover:border-slate-300/70 hover:scale-[1.01]' : 'hover:-translate-y-[2px] hover:border-white/14 hover:scale-[1.01]'
      }`}
      style={{
        ...getInsightInsetStyle(card.color),
        animationDelay: `${index * 70}ms`,
      }}
    >
      <div className="relative">
        <div className={`${insetLabelClassName} truncate`}>{card.label}</div>
        <div className={`mt-3 ${card.valueClassName || insetValueClassName}`}>{card.value}</div>
        {card.helper && <div className="mt-1"><div className={insetHelperClassName}>{card.helper}</div></div>}
      </div>
      <div className={`pointer-events-none absolute inset-x-4 bottom-0 h-px ${isLightTheme ? 'bg-slate-300/55' : 'bg-white/6'}`} />
      <div
        className="pointer-events-none absolute inset-x-4 bottom-0 h-[2px] origin-left rounded-full"
        style={{
          backgroundColor: rgba(card.color, isLightTheme ? 0.84 : 0.9),
        }}
      />
    </div>
  );
  const categoryShareCard = (
    <Card
      title="Category Share"
      isLightTheme={isLightTheme}
    >
      {categorySlices.length > 0 ? (
        <div className="grid gap-5 md:grid-cols-[0.9fr_1.1fr]">
          <div className="flex items-center justify-center overflow-visible">
            <div
              className="relative h-64 w-64 overflow-visible md:h-[17rem] md:w-[17rem]"
              onMouseEnter={() => setIsCategoryShareChartHovered(true)}
              onMouseLeave={() => setIsCategoryShareChartHovered(false)}
              style={{
                transform: isCategoryShareChartHovered ? 'translate3d(0, -4px, 0)' : 'translate3d(0, 0, 0)',
                filter: isCategoryShareChartHovered
                  ? 'drop-shadow(0 18px 24px rgba(0, 0, 0, 0.34))'
                  : 'drop-shadow(0 0 0 rgba(0, 0, 0, 0))',
                transition: 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1), filter 280ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              <svg viewBox="-14 -14 148 148" className="h-full w-full overflow-visible">
                <circle cx="60" cy="60" r="46" fill="none" stroke={isLightTheme ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.08)'} strokeWidth="16" />
                {donutSegments.map((segment, index) => {
                  const active = activeCategory?.name === segment.name;
                  const translateDistance = active ? (isCategoryShareChartHovered ? 5.5 : 4.25) : 0;
                  const translateX = Math.cos(segment.midAngle) * translateDistance;
                  const translateY = Math.sin(segment.midAngle) * translateDistance;
                  const dashGap = index === donutSegments.length - 1
                    ? 0
                    : Math.min(1.5, Math.max(0.45, segment.dash * 0.35));
                  return (
                    <g
                      key={segment.name}
                      transform={`translate(${translateX} ${translateY})`}
                      style={{
                        transition: 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)',
                      }}
                    >
                      <circle
                        cx="60"
                        cy="60"
                        r={segment.radius}
                        fill="none"
                        stroke={segment.color}
                        strokeWidth={active ? 18 : 16}
                        strokeLinecap="butt"
                        strokeDasharray={`${Math.max(0, segment.dash - dashGap)} ${segment.circumference}`}
                        strokeDashoffset={segment.offset}
                        transform="rotate(-90 60 60)"
                        className="cursor-pointer"
                        style={{
                          opacity: active ? 1 : (isCategoryShareChartHovered ? 0.52 : 0.78),
                          transition: 'opacity 220ms ease, stroke-width 320ms cubic-bezier(0.22, 1, 0.36, 1)',
                        }}
                        onMouseEnter={() => {
                          setIsCategoryShareChartHovered(true);
                          setActiveCategoryName(segment.name);
                        }}
                      />
                    </g>
                  );
                })}
              </svg>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/42">{activeCategory ? activeCategory.name : 'Focus Share'}</div>
                  <div className="mt-2 text-[1.7rem] font-bold tracking-tight text-white">{activeCategory ? formatPct(activeCategory.share) : '--'}</div>
                  <div className="mt-1 text-[11px] text-white/55">{activeCategory ? formatMinutesPrecise(activeCategory.minutes) : 'No category data yet'}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2.5 max-h-[22rem] overflow-auto pr-1">
            {categorySlices.map((slice) => {
              const active = activeCategory?.name === slice.name;
              return (
                <button
                  key={slice.name}
                  type="button"
                  onClick={() => setActiveCategoryName(slice.name)}
                  onMouseEnter={() => setActiveCategoryName(slice.name)}
                  className={`w-full rounded-[1.15rem] border px-4 py-3 text-left transition-all ${active ? 'border-white/22 bg-white/10' : 'border-white/10 bg-black/10 hover:bg-white/6'}`}
                  style={{
                    transform: active ? 'translate3d(4px, 0, 0)' : 'translate3d(0, 0, 0)',
                    transition: 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1), border-color 220ms ease, background-color 220ms ease',
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
                      <span className="truncate text-sm font-bold text-white">{slice.name}</span>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-mono font-bold text-white">{formatPct(slice.share)}</div>
                      <div className="text-[11px] text-white/52">{formatMinutesCompact(slice.minutes)}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-[1.2rem] border border-white/10 bg-black/10 px-4 py-5 text-sm leading-relaxed text-white/58">
          Categorized focus time has not been logged yet.
        </div>
      )}
    </Card>
  );
  const renderAnalyticsRangeToggle = (
    activeRange: AnalyticsRangeKey = analyticsRange,
    onRangeChange: React.Dispatch<React.SetStateAction<AnalyticsRangeKey>> = setAnalyticsRange,
  ) => {
    const activeIndex = ANALYTICS_RANGE_OPTIONS.findIndex(([range]) => range === activeRange);

    return (
      <div className="relative flex min-w-[11.75rem] rounded-[0.95rem] border border-white/10 bg-white/[0.03] p-1">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-1 left-1 top-1 rounded-[0.7rem] border border-white/10 bg-white/[0.1] shadow-[0_12px_26px_-22px_rgba(0,0,0,0.65)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{
            width: 'calc((100% - 0.5rem) / 3)',
            transform: `translateX(${Math.max(0, activeIndex) * 100}%)`,
          }}
        />
        {ANALYTICS_RANGE_OPTIONS.map(([range, label]) => {
          const active = activeRange === range;
          return (
            <button
              key={range}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                const target = event.currentTarget;
                const scrollParent = findScrollableParent(target);
                const previousTop = target.getBoundingClientRect().top;
                const scrollTop = scrollParent?.scrollTop ?? null;
                onRangeChange(range);
                if (scrollParent && scrollTop !== null) {
                  window.requestAnimationFrame(() => {
                    const nextTop = target.getBoundingClientRect().top;
                    scrollParent.scrollTop = Number.isFinite(nextTop)
                      ? scrollParent.scrollTop + (nextTop - previousTop)
                      : scrollTop;
                  });
                }
              }}
              className={`relative z-10 flex-1 rounded-[0.7rem] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-[color,transform] duration-300 ${
                active
                  ? 'text-white'
                  : 'text-white/46 hover:text-white/78'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    );
  };
  const moveSessionClockWeek = (direction: -1 | 1) => {
    const nextIndex = sessionClockWeekIndex + direction;
    if (nextIndex < 0 || nextIndex >= sessionClockWeekStarts.length) return;
    setSelectedSessionWeekStartMs(sessionClockWeekStarts[nextIndex]);
    setHoveredSessionId(null);
    setHoveredSessionLaneKey(null);
  };
  const handleSessionClockTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    sessionClockTouchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };
  const handleSessionClockTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = sessionClockTouchStartRef.current;
    sessionClockTouchStartRef.current = null;
    if (!start || event.changedTouches.length === 0) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 44 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    moveSessionClockWeek(deltaX < 0 ? -1 : 1);
  };
  const renderSessionClockBar = (
    lane: { dateKey: string },
    session: SessionClockSession,
    active: boolean,
    showCycleOverlay: boolean,
  ) => {
    const sessionStart = clamp01((session.startMinutes - sessionClockAxis.minMinutes) / sessionClockAxis.rangeMinutes);
    const sessionEnd = clamp01((session.endMinutes - sessionClockAxis.minMinutes) / sessionClockAxis.rangeMinutes);
    const sessionRangeMinutes = Math.max(1, session.endMinutes - session.startMinutes);
    const widthPct = Math.max((sessionEnd - sessionStart) * 100, 1.1);

    return (
      <button
        key={session.id}
        type="button"
        onMouseEnter={() => {
          setHoveredSessionLaneKey(lane.dateKey);
          setHoveredSessionId(session.id);
        }}
        onMouseLeave={() => setHoveredSessionId(null)}
        onFocus={() => {
          setHoveredSessionLaneKey(lane.dateKey);
          setHoveredSessionId(session.id);
        }}
        onBlur={() => setHoveredSessionId(null)}
        className="absolute top-1.5 bottom-1.5 overflow-hidden rounded-[0.85rem] border transition-[border-color,box-shadow,transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] focus:outline-none"
        style={{
          left: `${sessionStart * 100}%`,
          width: `${widthPct}%`,
          background: `linear-gradient(90deg, ${rgba(session.primaryColor, active ? 0.42 : 0.28)}, ${rgba(session.primaryColor, active ? 0.28 : 0.18)})`,
          borderColor: active ? rgba('#ffffff', 0.34) : rgba('#ffffff', 0.12),
          boxShadow: active ? `0 14px 26px -18px ${rgba(session.primaryColor, 0.58)}` : `0 10px 22px -20px ${rgba(session.primaryColor, 0.22)}`,
          transform: active ? 'translateY(-1px) scaleY(1.04)' : 'translateY(0) scaleY(1)',
          opacity: active ? 1 : 0.9,
        }}
        aria-label={`${formatDateKeyStamp(lane.dateKey)} ${formatSessionRange(session.startMs, session.endMs)} ${formatMinutesPrecise(session.durationMinutes)} total session time ${session.pomoDisplayValue} ${session.pomoDisplayUnit}`}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{
            background: `linear-gradient(180deg, rgba(255,255,255,${active ? 0.18 : 0.1}), transparent 62%)`,
          }}
        />
        {session.segments.map((segment, segmentIndex) => {
          const leftPct = clamp01((segment.startMinutes - session.startMinutes) / sessionRangeMinutes) * 100;
          const segmentWidthPct = Math.max(
            (clamp01((segment.endMinutes - session.startMinutes) / sessionRangeMinutes) * 100) - leftPct,
            1.4,
          );
          return (
            <span
              key={`${session.id}-${segment.categoryName}-${segment.startMinutes}-${segmentIndex}`}
              aria-hidden="true"
              className="pointer-events-none absolute top-0 bottom-0 rounded-[0.8rem]"
              style={{
                left: `${Math.max(0, leftPct - 0.7)}%`,
                width: `${Math.min(100, segmentWidthPct + 1.4)}%`,
                backgroundColor: rgba(segment.categoryColor, active ? 0.86 : 0.64),
                filter: 'blur(3px) saturate(1.08)',
                transform: 'translateZ(0)',
              }}
            />
          );
        })}
        {session.cycleOverlays.map((cycle) => {
          const leftPct = clamp01((cycle.startMinutes - session.startMinutes) / sessionRangeMinutes) * 100;
          const cycleWidthPct = Math.max(
            (clamp01((cycle.endMinutes - session.startMinutes) / sessionRangeMinutes) * 100) - leftPct,
            2.8,
          );
          return (
            <span
              key={`${session.id}-cycle-${cycle.index}`}
              aria-hidden="true"
              className="pointer-events-none absolute top-0 bottom-0 flex items-center justify-center rounded-[0.78rem] border border-white/18 bg-white/[0.16] text-[10px] font-black leading-none text-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_18px_-16px_rgba(0,0,0,0.86)] backdrop-blur-[1px] transition-[opacity,transform,background-color,border-color] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                left: `${leftPct}%`,
                width: `${Math.min(100 - leftPct, cycleWidthPct)}%`,
                opacity: showCycleOverlay ? 1 : 0,
                transform: showCycleOverlay ? 'translate3d(0, 0, 0)' : 'translate3d(0, 1px, 0)',
                transformOrigin: 'center',
                transitionDelay: showCycleOverlay ? `${Math.min(cycle.index - 1, 4) * 14}ms` : '0ms',
                willChange: 'opacity, transform',
                backfaceVisibility: 'hidden',
                zIndex: 3,
              }}
            >
              {cycle.index}
            </span>
          );
        })}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_1px_0_rgba(255,255,255,0.16),inset_0_-10px_22px_rgba(0,0,0,0.08)]"
        />
      </button>
    );
  };
  const sessionClockCard = (
    <Card title="Session Clock" isLightTheme={isLightTheme}>
      <div
        className="rounded-[1.25rem] border px-4 py-4 md:px-5 md:py-5"
        style={getInsightInsetStyle(PRESET_COLORS[5])}
      >
        <div className="border-b border-white/6 pb-3">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="shrink-0 text-[1.1rem] font-semibold tracking-tight text-white">{sessionClockRangeLabel}</div>
            {selectedSessionSummary ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-white/58 sm:justify-end">
                <span className="min-w-0 rounded-full border border-white/8 bg-white/[0.035] px-2.5 py-1 font-medium text-white/70">
                  {selectedSessionSummary.timeRange}
                </span>
                <span className="rounded-full border border-white/8 bg-white/[0.055] px-2.5 py-1 text-white/62">
                  {selectedSessionSummary.totalTime}
                </span>
                <span
                  className="rounded-full border px-2.5 py-1 font-semibold text-white/78 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                  style={{
                    borderColor: rgba(PRESET_COLORS[2], 0.24),
                    backgroundColor: rgba(PRESET_COLORS[2], 0.12),
                  }}
                >
                  {selectedSessionSummary.pomos}
                </span>
              </div>
            ) : (
              <div className="text-sm text-white/54 sm:text-right">
                {sessionWeekFocusTotal > 0
                  ? `${formatMinutesPrecise(sessionWeekFocusTotal)} focus in the last 7 days`
                  : 'No focus logged in the last 7 days'}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4">
          <div className="w-full">
            <div className="grid grid-cols-[3.2rem_minmax(0,1fr)] gap-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-white/32 sm:grid-cols-[4rem_minmax(0,1fr)] sm:gap-3 sm:text-[10px]">
              <div />
              <div className="relative h-5">
                {sessionClockAxis.marks.map((mark, index) => {
                  const transform = index === 0
                    ? 'translateX(0)'
                    : index === sessionClockAxis.marks.length - 1
                      ? 'translateX(-100%)'
                      : 'translateX(-50%)';
                  return (
                    <div
                      key={`session-axis-${index}-${Math.round(mark.minutes)}`}
                      className="absolute top-0"
                      style={{ left: `${mark.pct}%`, transform }}
                    >
                      {mark.label}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-2 space-y-2">
              {displayedSessionLanes.map((lane) => {
                const activeLane = lane.dateKey === activeSessionLane?.dateKey;
                return (
                  <div key={lane.dateKey} className="grid grid-cols-[3.2rem_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[4rem_minmax(0,1fr)] sm:gap-3">
                    <button
                      type="button"
                      onMouseEnter={() => setHoveredSessionLaneKey(lane.dateKey)}
                      onMouseLeave={() => setHoveredSessionLaneKey(null)}
                      onFocus={() => setHoveredSessionLaneKey(lane.dateKey)}
                      onBlur={() => setHoveredSessionLaneKey(null)}
                      className={`flex min-h-11 flex-col justify-center rounded-[0.95rem] border px-2 py-2 text-left text-[9px] font-semibold uppercase tracking-[0.08em] transition-[background-color,border-color,color] duration-200 sm:min-h-12 sm:flex-row sm:items-center sm:justify-between sm:px-2.5 sm:text-[10px] ${activeLane ? 'border-white/12 bg-white/[0.08] text-white' : 'border-white/8 bg-white/[0.02] text-white/48 hover:bg-white/[0.045] hover:text-white/72'}`}
                    >
                      <span>{WEEKDAY_SHORT_LABELS[lane.weekday]}</span>
                      <span className="text-white/38">{new Date(lane.dateMs).getDate()}</span>
                    </button>
                    <div className={`relative h-11 overflow-hidden rounded-[1rem] border transition-[border-color,background-color] duration-200 sm:h-12 ${activeLane ? 'border-white/14 bg-white/[0.06]' : 'border-white/8 bg-white/[0.024]'}`}>
                      {sessionClockAxis.marks.slice(1, -1).map((mark, index) => (
                        <div key={`${index}-${Math.round(mark.minutes)}`} className="absolute top-0 bottom-0 w-px bg-white/6" style={{ left: `${mark.pct}%` }} />
                      ))}
                      {lane.sessions.length === 0 && (
                        <div className="absolute inset-0 flex items-center px-3 text-[10px] font-medium text-white/22 sm:text-[11px]">
                          No focus
                        </div>
                      )}
                      {lane.sessions.map((session) => {
                        const active = hoveredSessionId === session.id || (!hoveredSessionId && selectedSessionEntry?.session.id === session.id);
                        return renderSessionClockBar(lane, session, active, hoveredSessionId === session.id);
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
  const focusProfileCard = (
    <Card isLightTheme={isLightTheme}>
      <div className="mb-4 md:mb-5">
        <div className="text-[1.45rem] font-bold leading-tight tracking-tight text-white md:text-[1.95rem]">
          {profileHeadline}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {[
          {
            label: 'Prime Rhythm',
            value: dominantDayPartsLabel,
            helper: recentFocusTotal > 0 ? `${activeTrendDayCount} active days tracked` : 'No rhythm yet',
            color: PRESET_COLORS[0],
          },
          {
            label: 'Best Hour',
            value: formatHourList(insights.mostProductiveHours.hours),
            helper: insights.mostProductiveHours.focusMinutes > 0
              ? `${formatMinutesCompact(insights.mostProductiveHours.focusMinutes)} saved there`
              : 'Needs more focus time',
            color: PRESET_COLORS[2],
          },
          {
            label: 'Best Weekday',
            value: bestWeekdayLabel,
            helper: insights.mostProductiveWeekdays.averageFocusMinutes > 0
              ? `${formatMinutesCompact(insights.mostProductiveWeekdays.averageFocusMinutes)} avg focus`
              : 'Still forming',
            color: PRESET_COLORS[4],
          },
          {
            label: 'Top Category',
            value: insights.topCategory?.name || '--',
            helper: insights.topCategory ? `${formatPct(insights.topCategory.share)} of tracked focus` : 'No category lead yet',
            color: insights.topCategory ? (categoryColors.get(insights.topCategory.name) || PRESET_COLORS[1]) : PRESET_COLORS[1],
          },
        ].map((card, index) => renderInsightInsetCard(card, index))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {focusProfileTiles.map((tile, index) => renderInsightInsetCard(tile, index + 4))}
      </div>
    </Card>
  );
  const showSnapshotCharts = placement !== 'remaining';
  const showSupportingInsights = placement !== 'snapshot-charts';

  return (
    <div className="space-y-4">
      {showTodayStats && (
        <Card title="Today's Stats" subtitle="Today so far." accent={accentColor} isLightTheme={isLightTheme}>
          <div className="grid gap-3 md:grid-cols-2">
            {todaySummaryCards.map((card) => (
              <div
                key={card.label}
                className="rounded-[1.15rem] border border-white/8 bg-black/10 px-4 py-4"
                style={{
                  backgroundColor: isLightTheme ? rgba(card.color, 0.05) : rgba(card.color, 0.04),
                }}
              >
                <div className="flex h-full flex-col">
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: card.color }} />
                    {card.label}
                  </div>
                  <div className={`mt-3 ${card.valueClassName || 'text-[1.65rem] font-mono font-bold tracking-tight text-white'}`}>
                    {card.value}
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-white/48">{card.helper}</div>
                  <div className="mt-4 space-y-2">
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                      <div
                        className="h-full rounded-full transition-[width] duration-500"
                        style={{
                          width: `${card.fill}%`,
                          backgroundColor: card.color,
                        }}
                      />
                    </div>
                    <div className="text-[10px] font-semibold tracking-[0.02em] text-white/38">{card.trail}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        {showSnapshotCharts && (
        <div className="order-1">
        <Card title="Focus Over Time" isLightTheme={isLightTheme}>
          <div className="rounded-[1.2rem] border border-white/8 bg-black/10 px-4 py-4 md:px-5">
            <div>
              <div>
                <div className="text-lg font-bold tracking-tight text-white">
                  {activeTrendPoint ? formatDateKeyFullStamp(activeTrendPoint.dateKey) : 'Recent activity'}
                </div>
                <div className="mt-1 text-sm text-white/56">
                  {activeTrendPoint
                    ? `${formatMinutesPrecise(activeTrendPoint.focusMinutes)} saved, ${formatPomodoroCount(activeTrendPoint.pomodoros)} pomodoros, ${activeTrendPoint.sessions} start${activeTrendPoint.sessions === 1 ? '' : 's'}.`
                    : 'Hover a point to inspect one day.'}
                </div>
              </div>
            </div>

            <div
              className="relative mt-6"
              onMouseMove={(event) => updateHoveredTrendPoint(event.clientX, event.currentTarget.getBoundingClientRect())}
              onTouchStart={(event) => {
                if (event.touches.length === 0) return;
                updateHoveredTrendPoint(event.touches[0].clientX, event.currentTarget.getBoundingClientRect());
              }}
              onTouchMove={(event) => {
                if (event.touches.length === 0) return;
                updateHoveredTrendPoint(event.touches[0].clientX, event.currentTarget.getBoundingClientRect());
              }}
              style={{ touchAction: 'pan-y' }}
            >
              <div className="relative h-60">
                <div className="absolute inset-0">
                  {trendHoverZones.map((zone) => {
                    const active = activeTrendPoint?.dateKey === zone.dateKey;
                    return (
                      <div
                        key={`trend-zone-${zone.dateKey}`}
                        onMouseEnter={() => setHoveredTrendPoint(zone.dateKey)}
                        className="absolute inset-y-0 cursor-pointer"
                        style={{
                          left: `${zone.left}%`,
                          width: `${zone.width}%`,
                        }}
                      >
                        <div
                          className="absolute rounded-[999px] transition-[background-color,transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                          style={{
                            left: '50%',
                            top: '2.4rem',
                            bottom: '2.9rem',
                            width: '2.8rem',
                            maxWidth: 'calc(100% - 0.5rem)',
                            backgroundColor: active ? rgba(accentColor, 0.042) : 'transparent',
                            opacity: active ? 1 : 0,
                            transform: `translateX(-50%) scaleX(${active ? 1 : 0.9})`,
                          }}
                        />
                      </div>
                    );
                  })}
                </div>

                {activeTrendVisualPoint && (
                  <div
                    className="pointer-events-none absolute inset-y-0 -translate-x-1/2 transition-[left,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                    style={{ left: `${activeTrendVisualPoint.x}%` }}
                  >
                    <div className="absolute inset-y-3 left-1/2 w-px -translate-x-1/2 bg-white/10" />
                    <div
                      className="absolute bottom-8 left-1/2 h-20 w-8 -translate-x-1/2 rounded-full blur-xl"
                      style={{ backgroundColor: rgba(accentColor, 0.1) }}
                    />
                  </div>
                )}

                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
                  {trendGuideLineYs.map((y) => (
                    <line
                      key={y}
                      x1="0"
                      x2="100"
                      y1={y}
                      y2={y}
                      stroke="rgba(255,255,255,0.08)"
                      strokeDasharray="1.5 3"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {trendAreaPath && <path d={trendAreaPath} fill={rgba(accentColor, 0.12)} />}
                  {trendLinePath && (
                    <path
                      d={trendLinePath}
                      fill="none"
                      stroke={accentColor}
                      strokeWidth={trendLineStrokeWidth}
                      strokeLinecap="butt"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </svg>
                {trendPoints.map((point) => {
                  const active = activeTrendPoint?.dateKey === point.dateKey;
                  const dotSize = 10 + (point.pomodoros * 2);
                  const hitSize = Math.max(26, dotSize + 14);
                  return (
                    <button
                      key={point.dateKey}
                      type="button"
                      onMouseEnter={() => setHoveredTrendPoint(point.dateKey)}
                      onFocus={() => setHoveredTrendPoint(point.dateKey)}
                      className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full focus:outline-none"
                      style={{
                        left: `${point.x}%`,
                        top: `${point.y}%`,
                        width: `${hitSize}px`,
                        height: `${hitSize}px`,
                      }}
                      aria-label={`${formatDateKeyStamp(point.dateKey)} ${formatMinutesPrecise(point.focusMinutes)}`}
                    >
                      <span
                        className="pointer-events-none absolute left-1/2 top-1/2 rounded-full transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                        style={{
                          width: `${Math.max(dotSize + 10, hitSize - 8)}px`,
                          height: `${Math.max(dotSize + 10, hitSize - 8)}px`,
                          transform: `translate(-50%, -50%) scale(${active ? 1 : 0.72})`,
                          opacity: active ? 1 : 0,
                          backgroundColor: rgba(accentColor, 0.14),
                        }}
                      />
                      <span
                        className="pointer-events-none absolute left-1/2 top-1/2 rounded-full border transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                        style={{
                          width: `${dotSize}px`,
                          height: `${dotSize}px`,
                          transform: `translate(-50%, -50%) scale(${active ? 1.12 : 1})`,
                          borderColor: rgba('#ffffff', active ? 0.52 : 0.26),
                          backgroundColor: active ? accentColor : rgba('#ffffff', point.focusMinutes > 0 ? 0.16 : 0.08),
                          boxShadow: active
                            ? `0 10px 22px -16px ${rgba(accentColor, 0.78)}`
                            : point.focusMinutes > 0
                              ? `0 8px 18px -18px ${rgba(accentColor, 0.3)}`
                              : 'none',
                        }}
                      />
                    </button>
                  );
                })}
              </div>

              <div className="relative mt-4 h-12">
                {trendPoints.map((point) => {
                  const active = activeTrendPoint?.dateKey === point.dateKey;
                  return (
                    <button
                      key={point.dateKey}
                      type="button"
                      onMouseEnter={() => setHoveredTrendPoint(point.dateKey)}
                      onFocus={() => setHoveredTrendPoint(point.dateKey)}
                      className={`absolute top-0 -translate-x-1/2 rounded-[0.8rem] px-1.5 py-1 text-center text-[9px] font-bold tracking-[0.02em] transition-[transform,color,background-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                        active
                          ? '-translate-y-[2px] bg-white/10 text-white/86 shadow-[0_14px_24px_-24px_rgba(0,0,0,0.95)]'
                          : 'text-white/42 hover:bg-white/[0.045] hover:text-white/72'
                      }`}
                      style={{ left: `${point.x}%`, minWidth: '2.25rem' }}
                    >
                      {formatDateKeyAxisStamp(point.dateKey)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>
        </div>
        )}

        {showSupportingInsights && (
        <div className="order-4">
          {sessionClockCard}
        </div>
        )}

        {showSupportingInsights && (
        <div className="order-5">
        <Card title={rangeSummaryLabel} isLightTheme={isLightTheme}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm text-white/56">{formatMinutesCompact(rangeFocusTotal)} total focus in this range.</div>
            </div>
            {renderAnalyticsRangeToggle()}
          </div>

          {categoryTrendLegend.length > 0 ? (
            <div className="mt-4 space-y-3">
              {categoryTrendLegend.map((category) => {
                const share = category.minutes / categoryLegendTotal;
                const isActive = hoveredCategoryFlowName === category.name;
                const insetStyle = getInsightInsetStyle(category.color);
                return (
                  <div
                    key={category.name}
                    onMouseEnter={() => setHoveredCategoryFlowName(category.name)}
                    onMouseLeave={() => setHoveredCategoryFlowName((current) => (current === category.name ? null : current))}
                    onFocus={() => setHoveredCategoryFlowName(category.name)}
                    onBlur={() => setHoveredCategoryFlowName((current) => (current === category.name ? null : current))}
                    tabIndex={0}
                    className={`group transform-gpu rounded-[1.2rem] border px-4 py-4 md:px-5 transition-[transform,border-color,box-shadow,background-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform focus:outline-none ${
                      isActive ? '-translate-y-[2px]' : ''
                    }`}
                    style={{
                      ...insetStyle,
                      borderColor: isActive
                        ? rgba(category.color, isLightTheme ? 0.28 : 0.22)
                        : insetStyle.borderColor,
                      boxShadow: isActive
                        ? `${isLightTheme
                          ? '0 18px 34px -28px rgba(15, 23, 42, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.76)'
                          : '0 22px 38px -30px rgba(0, 0, 0, 0.72), inset 0 1px 0 rgba(255, 255, 255, 0.05)'}, 0 10px 24px -20px ${rgba(category.color, isLightTheme ? 0.28 : 0.42)}`
                        : `${insetStyle.boxShadow}, 0 10px 24px -20px ${rgba(category.color, 0)}`,
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${isActive ? 'scale-125' : 'scale-100'}`}
                          style={{
                            backgroundColor: category.color,
                            boxShadow: `0 0 0 4px ${rgba(category.color, isActive ? 0.12 : 0)}`,
                          }}
                        />
                        <span className="truncate text-sm font-semibold text-white">{category.name}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-white">{formatMinutesCompact(category.minutes)}</div>
                        <div className="text-[11px] text-white/44">{formatPct(share)}</div>
                      </div>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/6">
                      <div
                        className="h-full origin-left transform-gpu rounded-full transition-[transform,box-shadow,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform"
                        style={{
                          width: `${share * 100}%`,
                          backgroundColor: category.color,
                          transform: isActive ? 'scaleY(1.14)' : 'scaleY(1)',
                          transformOrigin: 'left center',
                          opacity: isActive ? 1 : 0.94,
                          boxShadow: `0 8px 18px -12px ${rgba(category.color, isActive ? 0.46 : 0)}`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[1.2rem] border px-4 py-5 text-sm leading-relaxed text-white/58" style={getInsightInsetStyle(PRESET_COLORS[1])}>
              Categorized focus needs more saved time before it can chart here.
            </div>
          )}
        </Card>
        </div>
        )}

        {showSnapshotCharts && (
        <div className="order-2">
        <Card title="Focus Heatmap" isLightTheme={isLightTheme}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold tracking-tight text-white">
                {activeHeatmapDay ? formatDateKeyFullStamp(activeHeatmapDay.dateKey) : 'Daily focus'}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-white/52">
                {activeHeatmapDay?.topCategoryColor && activeHeatmapDay.totalMinutes > 0 && (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: activeHeatmapDay.topCategoryColor }}
                  />
                )}
                <span>{activeHeatmapDetail}</span>
              </div>
            </div>
            {renderAnalyticsRangeToggle(heatmapRange, setHeatmapRange)}
          </div>

          <div className="mt-5 rounded-[1.2rem] border px-4 py-4 md:px-5" style={getInsightInsetStyle(PRESET_COLORS[2])}>
            <div
              ref={heatmapScrollRef}
              onWheel={handleHeatmapWheel}
              className="-mx-1 overflow-x-auto overflow-y-hidden px-1 pb-2"
              style={{
                overscrollBehaviorX: heatmapRange === 'year' ? 'contain' : 'auto',
                touchAction: heatmapRange === 'year' ? 'pan-x pan-y' : 'auto',
              }}
            >
              <div className="inline-block min-w-full align-top">
                {heatmapRange === 'year' && heatmapWeeks.length > 0 && (
                  <div className="mb-2 inline-flex items-end gap-3">
                    <div className="grid grid-rows-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-transparent">
                      <div>Sun</div>
                    </div>
                    <div className="flex" style={heatmapGapStyle}>
                      {heatmapMonthMarkers.map((marker) => (
                        <div key={`heatmap-month-${marker.weekIndex}`} className="relative h-4 w-3.5">
                          {marker.label && (
                            <span className="absolute left-0 top-0 whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.08em] text-white/32">
                              {marker.label}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="inline-flex items-start gap-3">
                <div className="grid grid-rows-7 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/32" style={heatmapGapStyle}>
                  {HEATMAP_WEEKDAY_LABELS.map((label) => (
                    <div key={label} className={`${heatmapLabelClass} flex items-center justify-end`}>
                      {label}
                    </div>
                  ))}
                </div>

                <div className="flex" style={heatmapGapStyle}>
                  {heatmapWeeks.map((week, weekIndex) => (
                    <div key={`heatmap-week-${weekIndex}`} className="grid grid-rows-7" style={heatmapGapStyle}>
                      {week.map((day, dayIndex) => {
                        if (!day) {
                          return (
                            <div
                              key={`heatmap-empty-${weekIndex}-${dayIndex}`}
                              className={`${heatmapCellClass} border`}
                              style={{
                                backgroundColor: isLightTheme ? 'rgba(148, 163, 184, 0.035)' : 'rgba(255, 255, 255, 0.025)',
                                borderColor: isLightTheme ? 'rgba(148, 163, 184, 0.11)' : 'rgba(255, 255, 255, 0.045)',
                              }}
                            />
                          );
                        }

                        const active = day.dateKey === activeHeatmapDay?.dateKey;
                        const hasFocus = day.totalMinutes > 0;
                        const rawIntensity = hasFocus
                          ? clamp01(day.totalMinutes / heatmapScaleMaxMinutes)
                          : 0;
                        const intensity = hasFocus ? Math.pow(rawIntensity, 1.16) : 0;
                        const heatmapColor = day.topCategoryColor || accentColor;
                        const fillAlpha = hasFocus
                          ? (isLightTheme ? 0.12 + (intensity * 0.68) : 0.11 + (intensity * 0.7))
                          : 0;

                        return (
                          <button
                            key={day.dateKey}
                            type="button"
                            onMouseEnter={() => setHoveredHeatmapDateKey(day.dateKey)}
                            onFocus={() => setHoveredHeatmapDateKey(day.dateKey)}
                            onClick={() => setSelectedHeatmapDateKey(day.dateKey)}
                            className={`${heatmapCellClass} border transition-[background-color,border-color,box-shadow,transform] duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40`}
                            style={{
                              backgroundColor: hasFocus
                                ? rgba(heatmapColor, fillAlpha)
                                : (isLightTheme ? 'rgba(148, 163, 184, 0.06)' : 'rgba(255, 255, 255, 0.035)'),
                              borderColor: active
                                ? rgba(heatmapColor, isLightTheme ? 0.78 : 0.68)
                                : hasFocus
                                  ? rgba(heatmapColor, isLightTheme ? 0.28 + (intensity * 0.34) : 0.24 + (intensity * 0.32))
                                  : (isLightTheme ? 'rgba(148, 163, 184, 0.16)' : 'rgba(255, 255, 255, 0.07)'),
                              boxShadow: active
                                ? `0 0 0 2px ${rgba(heatmapColor, isLightTheme ? 0.12 : 0.14)}, 0 10px 18px -14px ${rgba(heatmapColor, isLightTheme ? 0.3 : 0.46)}`
                                : 'none',
                              transform: active ? 'scale(1.08)' : 'scale(1)',
                            }}
                            aria-pressed={day.dateKey === selectedHeatmapDateKey}
                            aria-label={`${formatDateKeyFullStamp(day.dateKey)} ${formatMinutesPrecise(day.totalMinutes)}${day.topCategoryName ? ` top category ${day.topCategoryName}` : ''}`}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
              </div>
            </div>
          </div>
        </Card>
        </div>
        )}

        {showSupportingInsights && (
        <div className="order-3">
          {categoryShareCard}
        </div>
        )}

        {false && (
        <Card title="Session Clock" subtitle="Swipe or step through each week." isLightTheme={isLightTheme}>
          <div
            className="rounded-[1.2rem] border px-4 py-4 md:px-5"
            style={getInsightInsetStyle(PRESET_COLORS[5])}
            onTouchStart={handleSessionClockTouchStart}
            onTouchEnd={handleSessionClockTouchEnd}
            onTouchCancel={() => {
              sessionClockTouchStartRef.current = null;
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold tracking-tight text-white">{formatWeekRangeLabel(activeSessionWeekStartMs)}</div>
                <div className="mt-1 text-sm text-white/56">
                  {selectedSessionEntry
                    ? `${formatSessionRange(selectedSessionEntry!.session.startMs, selectedSessionEntry!.session.endMs)} - ${formatMinutesPrecise(selectedSessionEntry!.session.durationMinutes)} total`
                    : 'No saved sessions in this week yet.'}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div
                  className="rounded-[0.95rem] border px-3 py-2 text-[11px] font-semibold"
                  style={{
                    borderColor: isLightTheme ? 'rgba(148, 163, 184, 0.18)' : 'rgba(255, 255, 255, 0.08)',
                    backgroundColor: isLightTheme ? 'rgba(255, 255, 255, 0.72)' : 'rgba(255, 255, 255, 0.03)',
                    color: isLightTheme ? 'rgba(51, 65, 85, 0.84)' : 'rgba(255, 255, 255, 0.72)',
                  }}
                >
                  Week focus: <span className={isLightTheme ? 'text-slate-900' : 'text-white'}>{formatMinutesCompact(sessionWeekFocusTotal)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveSessionClockWeek(-1)}
                    disabled={!canGoToPreviousSessionWeek}
                    className={`flex h-8 w-8 items-center justify-center rounded-[0.95rem] border transition-colors ${
                      canGoToPreviousSessionWeek
                        ? 'border-white/10 bg-white/[0.035] text-white/68 hover:bg-white/7 hover:text-white'
                        : 'border-white/8 bg-white/[0.02] text-white/24 cursor-not-allowed'
                    }`}
                    aria-label="Show previous week in Session Clock"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m15 18-6-6 6-6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedSessionWeekStartMs(latestSessionClockWeekStartMs)}
                    className="rounded-[0.95rem] border border-white/10 bg-white/[0.035] px-3 py-2 text-[11px] font-semibold text-white/72 transition-colors hover:bg-white/7 hover:text-white"
                    aria-label="Jump to current week in Session Clock"
                  >
                    This week
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSessionClockWeek(1)}
                    disabled={!canGoToNextSessionWeek}
                    className={`flex h-8 w-8 items-center justify-center rounded-[0.95rem] border transition-colors ${
                      canGoToNextSessionWeek
                        ? 'border-white/10 bg-white/[0.035] text-white/68 hover:bg-white/7 hover:text-white'
                        : 'border-white/8 bg-white/[0.02] text-white/24 cursor-not-allowed'
                    }`}
                    aria-label="Show next week in Session Clock"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-5 overflow-x-auto pb-1" style={{ touchAction: 'pan-y' }}>
              <div className="min-w-[34rem]">
                <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/32">
                  <div />
                  <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
                    <div>12a</div>
                    <div className="text-center">6a</div>
                    <div className="text-center">12p</div>
                    <div className="text-right">6p</div>
                  </div>
                </div>

                <div className="mt-3 space-y-2.5">
                  {displayedSessionLanes.map((lane) => {
                    const activeLane = lane.dateKey === activeSessionLane?.dateKey;
                    return (
                      <div key={lane.dateKey} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3 items-center">
                        <button
                          type="button"
                          onMouseEnter={() => setHoveredSessionLaneKey(lane.dateKey)}
                          onMouseLeave={() => setHoveredSessionLaneKey(null)}
                          onFocus={() => setHoveredSessionLaneKey(lane.dateKey)}
                          onBlur={() => setHoveredSessionLaneKey(null)}
                          className={`rounded-[0.95rem] px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors ${activeLane ? 'bg-white/[0.08] text-white' : 'text-white/48 hover:bg-white/[0.045] hover:text-white/72'}`}
                        >
                          {WEEKDAY_SHORT_LABELS[lane.weekday]}
                        </button>
                        <div className={`relative h-11 overflow-hidden rounded-[0.95rem] border transition-colors ${activeLane ? 'border-white/14 bg-white/[0.07]' : 'border-white/8 bg-white/[0.028]'}`}>
                          {[25, 50, 75].map((pct) => (
                            <div key={pct} className="absolute top-0 bottom-0 w-px bg-white/8" style={{ left: `${pct}%` }} />
                          ))}
                          {lane.sessions.length === 0 && (
                            <div className="absolute inset-0 flex items-center px-3 text-[11px] text-white/28">
                              No saved sessions
                            </div>
                          )}
                          {lane.sessions.map((session, index) => {
                            const widthPct = Math.max((((Math.min(1440, session.endMinutes) - session.startMinutes) / 1440) * 100), 1.1);
                            const active = hoveredSessionId === session.id || (!hoveredSessionId && selectedSessionEntry?.session.id === session.id);
                            return (
                              <button
                                key={session.id}
                                type="button"
                                onMouseEnter={() => {
                                  setHoveredSessionLaneKey(lane.dateKey);
                                  setHoveredSessionId(session.id);
                                }}
                                onMouseLeave={() => setHoveredSessionId(null)}
                                onFocus={() => {
                                  setHoveredSessionLaneKey(lane.dateKey);
                                  setHoveredSessionId(session.id);
                                }}
                                onBlur={() => setHoveredSessionId(null)}
                                className="absolute top-1.5 bottom-1.5 rounded-[0.8rem] border transition-all duration-300 focus:outline-none"
                                style={{
                                  left: `${(session.startMinutes / 1440) * 100}%`,
                                  width: `${widthPct}%`,
                                  backgroundColor: rgba(PRESET_COLORS[(index + 1) % PRESET_COLORS.length], active ? 0.86 : 0.56),
                                  borderColor: active ? rgba('#ffffff', 0.34) : rgba('#ffffff', 0.12),
                                }}
                                aria-label={`${formatDateKeyStamp(lane.dateKey)} ${formatSessionRange(session.startMs, session.endMs)}`}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </Card>
        )}
      </div>
    </div>
  );
};

export default AccountInsights;
