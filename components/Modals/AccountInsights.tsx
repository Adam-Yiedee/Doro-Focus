import React, { useEffect, useMemo, useState } from 'react';
import { Category, LogEntry } from '../../types';
import {
  computeAccountInsights,
<<<<<<< HEAD
=======
  DAY_PART_LABELS,
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
  DayPartKey,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT_LABELS,
} from '../../utils/accountInsights';
import { PASTEL_SWATCHES as PRESET_COLORS } from '../../utils/palette';

interface AccountInsightsProps {
  logs: LogEntry[];
  categories: Category[];
  joinedAt: string;
  accentColor: string;
  isLightTheme: boolean;
}

type CategorySliceWithColor = { name: string; minutes: number; share: number; color: string };

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
const formatSignedMinutes = (minutes: number) => Math.abs(minutes) < 0.5 ? 'flat' : `${minutes > 0 ? '+' : '-'}${formatMinutesCompact(Math.abs(minutes))}`;
const formatSignedCount = (value: number) => value === 0 ? 'flat' : `${value > 0 ? '+' : ''}${value}`;

const formatHour = (hour: number) => {
  const normalized = ((hour % 24) + 24) % 24;
  const suffix = normalized >= 12 ? 'PM' : 'AM';
  const base = normalized % 12 || 12;
  return `${base} ${suffix}`;
};

const formatHourWindow = (hour: number | null) => (hour === null ? '--' : formatHour(hour));

const formatClockMinutes = (minutes: number | null) => {
  if (minutes === null || !Number.isFinite(minutes)) return '--';
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const mins = normalized % 60;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${mins.toString().padStart(2, '0')} ${suffix}`;
};

const formatHourList = (hours: number[]) => {
<<<<<<< HEAD
  if (hours.length === 0) return 'No focus yet';
=======
  if (hours.length === 0) return 'No completed pomodoros yet';
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
  if (hours.length <= 3) return hours.map(formatHour).join(' / ');
  return `${hours.slice(0, 3).map(formatHour).join(' / ')} +${hours.length - 3}`;
};

const formatWeekdayList = (days: number[]) => {
<<<<<<< HEAD
  if (days.length === 0) return 'Not enough focus yet';
=======
  if (days.length === 0) return 'Not enough pomodoros yet';
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
  if (days.length <= 3) return days.map((day) => WEEKDAY_LABELS[day]).join(' / ');
  return `${days.slice(0, 3).map((day) => WEEKDAY_LABELS[day]).join(' / ')} +${days.length - 3}`;
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

const getDateFromKey = (dateKey: string) => new Date(`${dateKey}T12:00:00`);
const formatDateKeyShort = (dateKey: string) => getDateFromKey(dateKey).toLocaleDateString([], { weekday: 'short' });
const formatDateKeyStamp = (dateKey: string) => getDateFromKey(dateKey).toLocaleDateString([], { month: 'short', day: 'numeric' });
<<<<<<< HEAD
const formatDateKeyFullStamp = (dateKey: string) => getDateFromKey(dateKey).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const formatDateKeyAxisStamp = (dateKey: string) => getDateFromKey(dateKey).toLocaleDateString([], { month: 'numeric', day: 'numeric' });
=======
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20

const dayPartLabels: Record<DayPartKey, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  night: 'Night',
};

const Card: React.FC<{
  title: string;
  subtitle?: string;
  accent?: string;
  isLightTheme: boolean;
  children: React.ReactNode;
}> = ({ title, subtitle, accent, isLightTheme, children }) => (
  <div
    className="relative overflow-hidden rounded-[1.7rem] border p-5 md:p-6"
    style={{
      borderColor: isLightTheme ? 'rgba(148, 163, 184, 0.18)' : 'rgba(255, 255, 255, 0.08)',
      background: isLightTheme
        ? `linear-gradient(160deg, rgba(255,255,255,0.94) 0%, ${rgba(accent || '#ffffff', 0.1)} 100%)`
        : `linear-gradient(160deg, rgba(255,255,255,0.06) 0%, ${rgba(accent || '#ffffff', 0.08)} 100%)`,
      boxShadow: accent ? `0 28px 56px -42px ${rgba(accent, isLightTheme ? 0.28 : 0.68)}` : undefined,
    }}
  >
    <div
      className="pointer-events-none absolute inset-0 opacity-75"
      style={{
        background: `radial-gradient(circle at 14% -12%, ${rgba(accent || '#ffffff', isLightTheme ? 0.2 : 0.18)} 0%, transparent 34%), radial-gradient(circle at 88% 12%, ${rgba(accent || '#ffffff', isLightTheme ? 0.08 : 0.1)} 0%, transparent 22%)`,
      }}
    />
    <div className="pointer-events-none absolute inset-x-10 top-0 h-px opacity-80" style={{ background: `linear-gradient(90deg, transparent, ${rgba(accent || '#ffffff', 0.42)}, transparent)` }} />
    <div className="relative">
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">{title}</div>
      {subtitle && <div className="mt-2 max-w-2xl text-sm leading-relaxed text-white/60">{subtitle}</div>}
      <div className="mt-4">{children}</div>
    </div>
  </div>
);

const AccountInsights: React.FC<AccountInsightsProps> = ({ logs, categories, joinedAt, accentColor, isLightTheme }) => {
  const insights = useMemo(() => computeAccountInsights({ logs, categories, joinedAt }), [categories, joinedAt, logs]);
  const categoryColors = useMemo(() => new Map(categories.map((category) => [category.name, category.color])), [categories]);
  const categorySlices = useMemo<CategorySliceWithColor[]>(() => (
    insights.categorySlices.map((slice, index) => ({
      ...slice,
      color: slice.name === 'Uncategorized'
        ? accentColor
        : (categoryColors.get(slice.name) || PRESET_COLORS[index % PRESET_COLORS.length]),
    }))
  ), [accentColor, categoryColors, insights.categorySlices]);

  const [activeCategoryName, setActiveCategoryName] = useState<string | null>(categorySlices[0]?.name ?? null);
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
<<<<<<< HEAD
=======
  const [hoveredHeatCell, setHoveredHeatCell] = useState<{ weekday: number; hour: number } | null>(null);
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
  const [hoveredTrendDateKey, setHoveredTrendDateKey] = useState<string | null>(null);
  const [hoveredSessionLaneKey, setHoveredSessionLaneKey] = useState<string | null>(null);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);

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
      setHoveredTrendDateKey(insights.dailyFocusTrend.find((point) => point.focusMinutes > 0)?.dateKey ?? insights.dailyFocusTrend[insights.dailyFocusTrend.length - 1]?.dateKey ?? null);
    }
  }, [hoveredTrendDateKey, insights.dailyFocusTrend]);

  useEffect(() => {
    const laneExists = hoveredSessionLaneKey && insights.sessionLanes.some((lane) => lane.dateKey === hoveredSessionLaneKey);
    if (!laneExists) {
      setHoveredSessionLaneKey(insights.sessionLanes.find((lane) => lane.sessions.length > 0)?.dateKey ?? insights.sessionLanes[insights.sessionLanes.length - 1]?.dateKey ?? null);
    }
  }, [hoveredSessionLaneKey, insights.sessionLanes]);

  useEffect(() => {
    if (!hoveredSessionId) return;
    const sessionExists = insights.sessionLanes.some((lane) => lane.sessions.some((session) => session.id === hoveredSessionId));
    if (!sessionExists) setHoveredSessionId(null);
  }, [hoveredSessionId, insights.sessionLanes]);

  const activeCategory = categorySlices.find((slice) => slice.name === activeCategoryName) || categorySlices[0] || null;
  const dominantDayPartsLabel = insights.dominantDayParts.length > 0
    ? insights.dominantDayParts.map((part) => dayPartLabels[part]).join(' / ')
    : 'No focus rhythm yet';
<<<<<<< HEAD
=======
  const highlightedHour = hoveredHour ?? insights.today.peakHour ?? insights.hourlyFocusMinutes.findIndex((minutes) => minutes === Math.max(...insights.hourlyFocusMinutes));
  const activeHeatCell = hoveredHeatCell
    ? {
        label: `${WEEKDAY_LABELS[hoveredHeatCell.weekday]} ${formatHour(hoveredHeatCell.hour)}`,
        minutes: insights.weekdayHourHeatmap[hoveredHeatCell.weekday][hoveredHeatCell.hour],
      }
    : null;
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20

  const donutSegments = useMemo(() => {
    const radius = 46;
    const circumference = 2 * Math.PI * radius;
    let cumulative = 0;
    return categorySlices.map((slice) => {
      const segment = {
        ...slice,
        radius,
        circumference,
        dash: slice.share * circumference,
        offset: -cumulative * circumference,
      };
      cumulative += slice.share;
      return segment;
    });
  }, [categorySlices]);

  const comparisonRows = [
    ['Focus Time', insights.weekComparison.thisWeek.focusMinutes, insights.weekComparison.lastWeek.focusMinutes, formatMinutesCompact(insights.weekComparison.thisWeek.focusMinutes), formatMinutesCompact(insights.weekComparison.lastWeek.focusMinutes), formatSignedMinutes(insights.weekComparison.focusDeltaMinutes), insights.weekComparison.focusDeltaPct, accentColor],
    ['Pomodoros', insights.weekComparison.thisWeek.pomodoros, insights.weekComparison.lastWeek.pomodoros, `${insights.weekComparison.thisWeek.pomodoros}`, `${insights.weekComparison.lastWeek.pomodoros}`, formatSignedCount(insights.weekComparison.pomoDelta), insights.weekComparison.pomoDeltaPct, PRESET_COLORS[2]],
    ['Sessions', insights.weekComparison.thisWeek.sessions, insights.weekComparison.lastWeek.sessions, `${insights.weekComparison.thisWeek.sessions}`, `${insights.weekComparison.lastWeek.sessions}`, formatSignedCount(insights.weekComparison.sessionDelta), insights.weekComparison.sessionDeltaPct, PRESET_COLORS[5]],
  ] as const;

<<<<<<< HEAD
  const trendMaxFocus = Math.max(1, ...insights.dailyFocusTrend.map((point) => point.focusMinutes));
  const trendPoints = useMemo(() => (
    insights.dailyFocusTrend.map((point, index, array) => {
      const edgePadding = 4;
      const x = array.length <= 1
        ? 50
        : edgePadding + ((index / (array.length - 1)) * (100 - (edgePadding * 2)));
=======
  const maxRhythmMinutes = Math.max(0, ...insights.hourlyFocusMinutes);
  const trendMaxFocus = Math.max(1, ...insights.dailyFocusTrend.map((point) => point.focusMinutes));
  const trendPoints = useMemo(() => (
    insights.dailyFocusTrend.map((point, index, array) => {
      const x = array.length <= 1 ? 50 : (index / (array.length - 1)) * 100;
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
      const y = 86 - ((point.focusMinutes / trendMaxFocus) * 54);
      return { ...point, x, y };
    })
  ), [insights.dailyFocusTrend, trendMaxFocus]);
  const trendAreaPath = trendPoints.length > 0
    ? `M ${trendPoints[0].x} 86 ${trendPoints.map((point) => `L ${point.x} ${point.y}`).join(' ')} L ${trendPoints[trendPoints.length - 1].x} 86 Z`
    : '';
  const trendLinePath = trendPoints.length > 0
    ? `M ${trendPoints[0].x} ${trendPoints[0].y} ${trendPoints.slice(1).map((point) => `L ${point.x} ${point.y}`).join(' ')}`
    : '';
  const activeTrendPoint = insights.dailyFocusTrend.find((point) => point.dateKey === hoveredTrendDateKey)
    || insights.dailyFocusTrend.find((point) => point.focusMinutes > 0)
    || insights.dailyFocusTrend[insights.dailyFocusTrend.length - 1];
  const recentFocusTotal = insights.dailyFocusTrend.reduce((acc, point) => acc + point.focusMinutes, 0);
  const recentPomoTotal = insights.dailyFocusTrend.reduce((acc, point) => acc + point.pomodoros, 0);
  const trendMaxPomos = Math.max(1, ...insights.dailyFocusTrend.map((point) => point.pomodoros));
  const trendMaxSessions = Math.max(1, ...insights.dailyFocusTrend.map((point) => point.sessions));
  const activeTrendDayCount = insights.dailyFocusTrend.filter((point) => point.focusMinutes > 0).length;
<<<<<<< HEAD
  const bestHourRows = useMemo(() => (
    insights.hourlyFocusMinutes
      .map((minutes, hour) => ({ hour, minutes }))
      .filter((entry) => entry.minutes > 0)
      .sort((left, right) => right.minutes - left.minutes || left.hour - right.hour)
      .slice(0, 6)
  ), [insights.hourlyFocusMinutes]);
  const activeBestHour = bestHourRows.find((entry) => entry.hour === hoveredHour) || bestHourRows[0] || null;
  const bestHourMaxMinutes = Math.max(1, ...bestHourRows.map((entry) => entry.minutes));
  const focusPhaseRows = (Object.entries(dayPartLabels) as Array<[DayPartKey, string]>).map(([key, label]) => ({
    key,
    label,
    minutes: insights.dayPartTotals[key],
  }));
=======
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20

  const activeSessionLane = insights.sessionLanes.find((lane) => lane.dateKey === hoveredSessionLaneKey)
    || insights.sessionLanes.find((lane) => lane.sessions.length > 0)
    || insights.sessionLanes[insights.sessionLanes.length - 1];
  const activeSession = hoveredSessionId
    ? insights.sessionLanes.flatMap((lane) => lane.sessions.map((session) => ({ lane, session }))).find((entry) => entry.session.id === hoveredSessionId)
    : null;
  const selectedSessionEntry = activeSession
    || (activeSessionLane?.sessions.length
      ? {
          lane: activeSessionLane,
          session: [...activeSessionLane.sessions].sort((left, right) => right.durationMinutes - left.durationMinutes)[0],
        }
      : null);
  const bestWeekdayLabel = insights.mostProductiveWeekdays.weekdays.length > 0
    ? WEEKDAY_LABELS[insights.mostProductiveWeekdays.weekdays[0]]
    : 'Still forming';
  const profileHeadline = recentFocusTotal > 0
<<<<<<< HEAD
    ? `${formatMinutesCompact(recentFocusTotal)} of focus in the last 14 days.`
    : 'Saved focus will start building your account profile here.';
=======
    ? `${formatMinutesCompact(recentFocusTotal)} saved recently, with ${dominantDayPartsLabel.toLowerCase()} carrying the strongest rhythm.`
    : 'Your focus profile will sharpen here once saved work starts stacking up.';
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
  const focusProfileTiles = [
    {
      label: '14-Day Focus',
      value: formatMinutesCompact(recentFocusTotal),
      helper: `${activeTrendDayCount}/${insights.dailyFocusTrend.length} active days`,
      color: accentColor,
    },
<<<<<<< HEAD
    ...(insights.topCategory ? [{
      label: 'Top Category',
      value: insights.topCategory.name,
      helper: `${formatPct(insights.topCategory.share)} share`,
      color: categoryColors.get(insights.topCategory.name) || PRESET_COLORS[1],
    }] : []),
    {
      label: 'Best Weekday',
      value: bestWeekdayLabel,
      helper: insights.mostProductiveWeekdays.averageFocusMinutes > 0
        ? `${formatMinutesCompact(insights.mostProductiveWeekdays.averageFocusMinutes)} avg focus on ${bestWeekdayLabel}`
        : 'Needs more history',
=======
    {
      label: 'Top Category',
      value: insights.topCategory?.name || 'Open canvas',
      helper: insights.topCategory
        ? `${formatPct(insights.topCategory.share)} of categorized work`
        : 'Save categorized focus to light this up',
      color: insights.topCategory
        ? (categoryColors.get(insights.topCategory.name) || PRESET_COLORS[1])
        : PRESET_COLORS[1],
    },
    {
      label: 'Best Weekday',
      value: bestWeekdayLabel,
      helper: insights.mostProductiveWeekdays.averagePomos > 0
        ? `${insights.mostProductiveWeekdays.averagePomos.toFixed(1)} pomos on average`
        : 'Needs more completed pomodoros',
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
      color: PRESET_COLORS[4],
    },
    {
      label: 'Typical Stop',
      value: formatQuitBucketList(insights.mostCommonQuitTimes.bucketMinutes),
<<<<<<< HEAD
      helper: insights.mostCommonQuitTimes.sourceBucketCount > 2
        ? `Average of ${insights.mostCommonQuitTimes.sourceBucketCount} tied stop times`
        : insights.mostCommonQuitTimes.count > 0
        ? `${insights.mostCommonQuitTimes.count} closed session${insights.mostCommonQuitTimes.count === 1 ? '' : 's'}`
=======
      helper: insights.mostCommonQuitTimes.count > 0
        ? `${insights.mostCommonQuitTimes.count} closed session${insights.mostCommonQuitTimes.count === 1 ? '' : 's'} there`
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
        : 'No closed sessions yet',
      color: PRESET_COLORS[5],
    },
  ] as const;
  const todaySummaryCards = [
    {
      label: 'Focus Today',
      value: formatMinutesCompact(insights.today.focusMinutes),
<<<<<<< HEAD
      helper: insights.today.focusMinutes > 0 ? `${formatMinutesPrecise(insights.today.focusMinutes)} saved` : 'No saved focus yet',
=======
      helper: insights.today.focusMinutes > 0 ? `${formatMinutesPrecise(insights.today.focusMinutes)} saved` : 'No focus blocks saved yet',
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
      trail: insights.today.focusMinutes > 0 ? `${Math.round((insights.today.focusMinutes / trendMaxFocus) * 100)}% of best day` : 'Waiting on focus',
      fill: insights.today.focusMinutes > 0 ? Math.max(10, (insights.today.focusMinutes / trendMaxFocus) * 100) : 0,
      color: accentColor,
    },
    {
      label: 'Pomodoros',
      value: `${insights.today.pomodoros}`,
<<<<<<< HEAD
      helper: insights.today.pomodoros > 0 ? 'Completed today' : 'No pomodoros yet',
=======
      helper: insights.today.pomodoros > 0 ? 'Completed today' : 'No finished pomodoros yet',
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
      trail: insights.today.pomodoros > 0 ? `${Math.round((insights.today.pomodoros / trendMaxPomos) * 100)}% of top day` : 'No completions',
      fill: insights.today.pomodoros > 0 ? Math.max(10, (insights.today.pomodoros / trendMaxPomos) * 100) : 0,
      color: PRESET_COLORS[2],
    },
    {
      label: 'Sessions',
      value: `${insights.today.sessions}`,
<<<<<<< HEAD
      helper: insights.today.sessions > 0 ? 'Started today' : 'No starts today',
=======
      helper: insights.today.sessions > 0 ? 'Sessions started today' : 'No session starts today',
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
      trail: insights.today.sessions > 0 ? `${Math.round((insights.today.sessions / trendMaxSessions) * 100)}% of top day` : 'No starts logged',
      fill: insights.today.sessions > 0 ? Math.max(10, (insights.today.sessions / trendMaxSessions) * 100) : 0,
      color: PRESET_COLORS[5],
    },
    {
      label: 'Peak Window',
      value: formatHourWindow(insights.today.peakHour),
<<<<<<< HEAD
      helper: insights.today.firstStartMinutes !== null ? `First start ${formatClockMinutes(insights.today.firstStartMinutes)}` : 'No start logged',
=======
      helper: insights.today.firstStartMinutes !== null ? `First start ${formatClockMinutes(insights.today.firstStartMinutes)}` : 'No start time logged today',
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
      trail: insights.today.peakHour !== null ? 'Window found' : 'Waiting on data',
      fill: insights.today.peakHour !== null ? 100 : 0,
      color: PRESET_COLORS[3],
    },
  ] as const;

  return (
    <div className="space-y-4">
      <div
        className="relative overflow-hidden rounded-[1.9rem] border border-white/10 px-5 py-5 md:px-6 md:py-6"
        style={{
          background: isLightTheme
            ? `linear-gradient(155deg, rgba(255,255,255,0.96) 0%, ${rgba(accentColor, 0.14)} 52%, ${rgba(PRESET_COLORS[5], 0.12)} 100%)`
            : `linear-gradient(155deg, rgba(255,255,255,0.07) 0%, ${rgba(accentColor, 0.12)} 52%, ${rgba(PRESET_COLORS[5], 0.08)} 100%)`,
          boxShadow: `0 34px 72px -46px ${rgba(accentColor, isLightTheme ? 0.3 : 0.78)}`,
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{
            background: `radial-gradient(circle at 14% -8%, ${rgba(accentColor, 0.28)} 0%, transparent 34%), radial-gradient(circle at 88% 16%, ${rgba(PRESET_COLORS[5], 0.18)} 0%, transparent 24%), linear-gradient(135deg, rgba(255,255,255,0.08), transparent 45%)`,
          }}
        />
        <div className="pointer-events-none absolute -right-10 top-8 h-40 w-40 rounded-full blur-3xl" style={{ backgroundColor: rgba(PRESET_COLORS[2], 0.16) }} />
<<<<<<< HEAD
        <div className="relative">
          <div className="inline-flex rounded-full border border-white/14 bg-black/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white/60">
            Focus Profile
          </div>
          <div className="mt-4 max-w-2xl text-[1.65rem] font-bold tracking-tight text-white md:text-[2rem]">
            {profileHeadline}
          </div>
          <div className="mt-3 max-w-2xl text-sm leading-relaxed text-white/60">
            {recentFocusTotal > 0
              ? `Average start ${formatClockMinutes(insights.averageStartMinutes)}, best weekday ${bestWeekdayLabel}, ${recentPomoTotal} pomodoros in the last 14 days.`
              : 'Once you save more work, this becomes a quick read on your timing and pace.'}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              ['Prime Rhythm', dominantDayPartsLabel],
              ['Best Hour', formatHourList(insights.mostProductiveHours.hours)],
              ...(insights.topCategory ? [['Top Category', insights.topCategory.name] as const] : []),
            ].map(([label, value], index) => (
              <div
                key={label}
                className="rounded-full border border-white/12 bg-black/12 px-3 py-1.5 text-[11px] font-bold text-white/74"
                style={{ boxShadow: `0 14px 28px -24px ${rgba(PRESET_COLORS[index % PRESET_COLORS.length], 0.56)}` }}
              >
                {label}: <span className="text-white">{value}</span>
              </div>
            ))}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
=======
        <div className="relative grid gap-5 xl:grid-cols-[1.08fr_0.92fr] xl:items-start">
          <div>
            <div className="inline-flex rounded-full border border-white/14 bg-black/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white/60">
              Focus Profile
            </div>
            <div className="mt-4 max-w-2xl text-[1.65rem] font-bold tracking-tight text-white md:text-[2rem]">
              {profileHeadline}
            </div>
            <div className="mt-3 max-w-2xl text-sm leading-relaxed text-white/60">
              {recentFocusTotal > 0
                ? `Average start ${formatClockMinutes(insights.averageStartMinutes)}, strongest weekday ${bestWeekdayLabel}, and ${recentPomoTotal} completed pomodoros across the latest momentum window.`
                : 'Once your account has enough saved work, this turns into a compact read on your pace, timing, and category habits.'}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {[
                ['Prime Rhythm', dominantDayPartsLabel],
                ['Best Hour', formatHourList(insights.mostProductiveHours.hours)],
                ['Top Category', insights.topCategory?.name || 'Not enough category data'],
              ].map(([label, value], index) => (
                <div
                  key={label}
                  className="rounded-full border border-white/12 bg-black/12 px-3 py-1.5 text-[11px] font-bold text-white/74"
                  style={{ boxShadow: `0 14px 28px -24px ${rgba(PRESET_COLORS[index % PRESET_COLORS.length], 0.56)}` }}
                >
                  {label}: <span className="text-white">{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
            {focusProfileTiles.map((tile) => (
              <div
                key={tile.label}
                className="relative overflow-hidden rounded-[1.3rem] border border-white/10 bg-black/12 px-4 py-4"
                style={{ boxShadow: `0 20px 40px -32px ${rgba(tile.color, isLightTheme ? 0.22 : 0.6)}` }}
              >
                <div className="absolute inset-0 opacity-60" style={{ background: `radial-gradient(circle at 88% 10%, ${rgba(tile.color, 0.2)}, transparent 28%)` }} />
                <div className="relative">
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tile.color }} />
                    {tile.label}
                  </div>
                  <div className="mt-3 text-[1.45rem] font-bold tracking-tight text-white">{tile.value}</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-white/50">{tile.helper}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

<<<<<<< HEAD
      <Card title="Today's Stats" subtitle="Today so far." accent={accentColor} isLightTheme={isLightTheme}>
        <div className="grid gap-3 md:grid-cols-2">
=======
      <Card title="Today's Stats" subtitle="Saved focus so far today, plus the window where you have been sharpest." accent={accentColor} isLightTheme={isLightTheme}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
          {todaySummaryCards.map((card) => (
            <div
              key={card.label}
              className="relative overflow-hidden rounded-[1.3rem] border border-white/10 px-4 py-4"
              style={{
                background: isLightTheme
                  ? `linear-gradient(165deg, rgba(255,255,255,0.9) 0%, ${rgba(card.color, 0.12)} 100%)`
                  : `linear-gradient(165deg, rgba(255,255,255,0.05) 0%, ${rgba(card.color, 0.1)} 100%)`,
                boxShadow: `0 22px 40px -30px ${rgba(card.color, isLightTheme ? 0.2 : 0.54)}`,
              }}
            >
              <div className="absolute inset-0 opacity-55" style={{ background: `radial-gradient(circle at 18% 0%, ${rgba(card.color, 0.18)}, transparent 34%)` }} />
              <div className="absolute -right-6 top-4 h-20 w-20 rounded-full blur-2xl" style={{ backgroundColor: rgba(card.color, 0.12) }} />
              <div className="relative flex h-full flex-col">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: card.color }} />
                  {card.label}
                </div>
                <div className="mt-3 text-[1.75rem] font-mono font-bold tracking-tight text-white">{card.value}</div>
                <div className="mt-1 text-[11px] leading-relaxed text-white/48">{card.helper}</div>
                <div className="mt-4">
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{
                        width: `${card.fill}%`,
                        background: `linear-gradient(90deg, ${rgba(card.color, 0.98)}, ${rgba(card.color, 0.64)})`,
                      }}
                    />
                  </div>
                  <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">{card.trail}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

<<<<<<< HEAD
      <div className="space-y-4">
        <Card title="Recent Momentum" subtitle="Last 14 days." accent={accentColor} isLightTheme={isLightTheme}>
=======
      <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
        <Card title="Recent Momentum" subtitle="A 14-day line view of how much focus you actually saved, with pomodoros and session starts layered into each point." accent={accentColor} isLightTheme={isLightTheme}>
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
          <div
            className="relative overflow-hidden rounded-[1.45rem] border border-white/10 px-4 py-4 md:px-5"
            style={{
              background: isLightTheme
                ? `linear-gradient(180deg, rgba(255,255,255,0.86) 0%, ${rgba(accentColor, 0.12)} 100%)`
                : `linear-gradient(180deg, rgba(5,10,18,0.76) 0%, ${rgba(accentColor, 0.1)} 100%)`,
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
<<<<<<< HEAD
                <div className="text-lg font-bold tracking-tight text-white">{activeTrendPoint ? formatDateKeyFullStamp(activeTrendPoint.dateKey) : 'Recent activity'}</div>
                <div className="mt-1 text-sm text-white/58">
                  {activeTrendPoint
                    ? `${formatMinutesPrecise(activeTrendPoint.focusMinutes)} saved, ${activeTrendPoint.pomodoros} pomodoros, ${activeTrendPoint.sessions} start${activeTrendPoint.sessions === 1 ? '' : 's'}.`
                    : 'Hover a point to inspect one day.'}
=======
                <div className="text-lg font-bold tracking-tight text-white">{activeTrendPoint ? formatDateKeyStamp(activeTrendPoint.dateKey) : 'Recent activity'}</div>
                <div className="mt-1 text-sm text-white/58">
                  {activeTrendPoint
                    ? `${formatDateKeyShort(activeTrendPoint.dateKey)} captured ${formatMinutesPrecise(activeTrendPoint.focusMinutes)} across ${activeTrendPoint.pomodoros} completed pomo${activeTrendPoint.pomodoros === 1 ? '' : 's'}.`
                    : 'Hover a point to inspect one specific day.'}
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
<<<<<<< HEAD
                  ['Focus', formatMinutesCompact(recentFocusTotal), accentColor],
                  ['Pomodoros', `${recentPomoTotal}`, PRESET_COLORS[2]],
                  ['Starts', `${insights.dailyFocusTrend.reduce((acc, point) => acc + point.sessions, 0)}`, PRESET_COLORS[5]],
=======
                  ['14-Day Focus', formatMinutesCompact(recentFocusTotal), accentColor],
                  ['Pomodoros', `${recentPomoTotal}`, PRESET_COLORS[2]],
                  ['Session Starts', `${insights.dailyFocusTrend.reduce((acc, point) => acc + point.sessions, 0)}`, PRESET_COLORS[5]],
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
                ].map(([label, value, color]) => (
                  <div key={label} className="rounded-full border border-white/12 bg-black/12 px-3 py-1.5 text-[11px] font-bold text-white/76" style={{ boxShadow: `0 14px 28px -24px ${rgba(color as string, 0.62)}` }}>
                    {label}: <span className="text-white">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative mt-6 h-60">
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
                <defs>
                  <linearGradient id="doroTrendFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={rgba(accentColor, 0.32)} />
                    <stop offset="100%" stopColor={rgba(accentColor, 0.02)} />
                  </linearGradient>
                  <linearGradient id="doroTrendLine" x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0%" stopColor={rgba(accentColor, 0.54)} />
                    <stop offset="40%" stopColor={rgba(accentColor, 0.96)} />
                    <stop offset="100%" stopColor={rgba(PRESET_COLORS[2], 0.84)} />
                  </linearGradient>
                </defs>
                {[22, 40, 58, 76].map((y) => (
                  <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="rgba(255,255,255,0.08)" strokeDasharray="1.5 3" />
                ))}
                {trendAreaPath && <path d={trendAreaPath} fill="url(#doroTrendFill)" />}
                {trendLinePath && <path d={trendLinePath} fill="none" stroke="url(#doroTrendLine)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
              </svg>
              {trendPoints.map((point) => {
                const active = activeTrendPoint?.dateKey === point.dateKey;
                const size = 12 + (point.pomodoros * 2);
                return (
                  <button
                    key={point.dateKey}
                    type="button"
                    onMouseEnter={() => setHoveredTrendDateKey(point.dateKey)}
                    onMouseLeave={() => setHoveredTrendDateKey(null)}
                    onFocus={() => setHoveredTrendDateKey(point.dateKey)}
                    onBlur={() => setHoveredTrendDateKey(null)}
                    className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/30 transition-all duration-300 focus:outline-none"
                    style={{
                      left: `${point.x}%`,
                      top: `${point.y}%`,
                      width: `${size}px`,
                      height: `${size}px`,
                      background: active ? rgba(accentColor, 0.95) : rgba('#ffffff', point.focusMinutes > 0 ? 0.16 : 0.08),
                      boxShadow: active ? `0 0 0 6px ${rgba(accentColor, 0.16)}, 0 16px 28px -18px ${rgba(accentColor, 0.9)}` : 'none',
                    }}
                    aria-label={`${formatDateKeyStamp(point.dateKey)} ${formatMinutesPrecise(point.focusMinutes)}`}
                  />
                );
              })}
            </div>

<<<<<<< HEAD
            <div className="relative mt-4 h-12">
              {trendPoints.map((point) => {
                const active = activeTrendPoint?.dateKey === point.dateKey;
                return (
                  <button
                    key={point.dateKey}
                    type="button"
                    onMouseEnter={() => setHoveredTrendDateKey(point.dateKey)}
                    onMouseLeave={() => setHoveredTrendDateKey(null)}
                    onFocus={() => setHoveredTrendDateKey(point.dateKey)}
                    onBlur={() => setHoveredTrendDateKey(null)}
                    className={`absolute top-0 -translate-x-1/2 rounded-lg px-1 py-1 text-center text-[9px] font-bold tracking-[0.02em] transition-colors ${active ? 'bg-white/10 text-white/82' : 'text-white/42 hover:bg-white/6'}`}
                    style={{ left: `${point.x}%`, minWidth: '2.1rem' }}
                  >
                    {formatDateKeyAxisStamp(point.dateKey)}
                  </button>
                );
              })}
=======
            <div className="mt-4 grid gap-1.5 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-white/42" style={{ gridTemplateColumns: `repeat(${insights.dailyFocusTrend.length}, minmax(0, 1fr))` }}>
              {insights.dailyFocusTrend.map((point, index) => (
                <button
                  key={point.dateKey}
                  type="button"
                  onMouseEnter={() => setHoveredTrendDateKey(point.dateKey)}
                  onMouseLeave={() => setHoveredTrendDateKey(null)}
                  onFocus={() => setHoveredTrendDateKey(point.dateKey)}
                  onBlur={() => setHoveredTrendDateKey(null)}
                  className={`rounded-lg py-1 transition-colors ${activeTrendPoint?.dateKey === point.dateKey ? 'bg-white/10 text-white/82' : 'hover:bg-white/6'}`}
                >
                  {index % 2 === 0 || insights.dailyFocusTrend.length <= 8 ? formatDateKeyShort(point.dateKey) : ''}
                </button>
              ))}
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
            </div>
          </div>
        </Card>

<<<<<<< HEAD
        <Card title="Session Clock" subtitle="Last 7 days." accent={PRESET_COLORS[5]} isLightTheme={isLightTheme}>
=======
        <Card title="Session Clock" subtitle="A one-week runway showing where your sessions actually landed across the day. Hover any block to inspect it." accent={PRESET_COLORS[5]} isLightTheme={isLightTheme}>
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
          <div
            className="relative overflow-hidden rounded-[1.45rem] border border-white/10 px-4 py-4 md:px-5"
            style={{
              background: isLightTheme
                ? `linear-gradient(180deg, rgba(255,255,255,0.88) 0%, ${rgba(PRESET_COLORS[5], 0.12)} 100%)`
                : `linear-gradient(180deg, rgba(6,10,18,0.82) 0%, ${rgba(PRESET_COLORS[5], 0.08)} 100%)`,
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-lg font-bold tracking-tight text-white">
                  {selectedSessionEntry
<<<<<<< HEAD
                    ? `${formatDateKeyStamp(selectedSessionEntry.lane.dateKey)} - ${formatSessionRange(selectedSessionEntry.session.startMs, selectedSessionEntry.session.endMs)}`
=======
                    ? `${formatDateKeyStamp(selectedSessionEntry.lane.dateKey)} · ${formatSessionRange(selectedSessionEntry.session.startMs, selectedSessionEntry.session.endMs)}`
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
                    : 'No recent sessions'}
                </div>
                <div className="mt-1 text-sm text-white/58">
                  {selectedSessionEntry
<<<<<<< HEAD
                    ? `${formatMinutesPrecise(selectedSessionEntry.session.durationMinutes)} active time, ${selectedSessionEntry.session.closed ? 'closed' : 'still open'}, ${formatMinutesCompact(selectedSessionEntry.lane.totalFocusMinutes)} saved that day.`
                    : 'Session blocks show up here once there is enough history.'}
=======
                    ? `${formatMinutesPrecise(selectedSessionEntry.session.durationMinutes)} long, ${selectedSessionEntry.session.closed ? 'closed cleanly' : 'still open'}, with ${formatMinutesCompact(selectedSessionEntry.lane.totalFocusMinutes)} saved that day.`
                    : 'Session blocks appear here once the account has enough saved history.'}
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
                </div>
              </div>
              {activeSessionLane && (
                <div className="rounded-full border border-white/12 bg-black/12 px-3 py-1.5 text-[11px] font-bold text-white/76">
                  {formatDateKeyShort(activeSessionLane.dateKey)} focus: <span className="text-white">{formatMinutesCompact(activeSessionLane.totalFocusMinutes)}</span>
                </div>
              )}
            </div>

            <div className="mt-5 overflow-x-auto pb-1">
              <div className="min-w-[38rem]">
                <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/38">
                  <div />
                  <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
                    <div>12a</div>
                    <div className="text-center">6a</div>
                    <div className="text-center">12p</div>
                    <div className="text-right">6p</div>
                  </div>
                </div>

                <div className="mt-3 space-y-2.5">
                  {insights.sessionLanes.map((lane) => {
                    const activeLane = lane.dateKey === activeSessionLane?.dateKey;
                    return (
                      <div key={lane.dateKey} className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-3 items-center">
                        <button
                          type="button"
                          onMouseEnter={() => setHoveredSessionLaneKey(lane.dateKey)}
                          onMouseLeave={() => setHoveredSessionLaneKey(null)}
                          onFocus={() => setHoveredSessionLaneKey(lane.dateKey)}
                          onBlur={() => setHoveredSessionLaneKey(null)}
                          className={`rounded-xl px-2 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] transition-all ${activeLane ? 'bg-white/10 text-white' : 'text-white/48 hover:bg-white/6 hover:text-white/74'}`}
                        >
                          {WEEKDAY_SHORT_LABELS[lane.weekday]}
                        </button>
                        <div className={`relative h-11 overflow-hidden rounded-[1rem] border transition-colors ${activeLane ? 'border-white/16 bg-white/10' : 'border-white/10 bg-black/10'}`}>
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
                                  background: active
                                    ? `linear-gradient(90deg, ${rgba(PRESET_COLORS[(index + 1) % PRESET_COLORS.length], 0.92)}, ${rgba(accentColor, 0.9)})`
                                    : `linear-gradient(90deg, ${rgba(PRESET_COLORS[(index + 1) % PRESET_COLORS.length], 0.62)}, ${rgba(accentColor, 0.42)})`,
                                  borderColor: active ? rgba('#ffffff', 0.4) : rgba('#ffffff', 0.16),
                                  boxShadow: active ? `0 18px 28px -20px ${rgba(accentColor, 0.92)}` : 'none',
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
      </div>

<<<<<<< HEAD
      <div className="space-y-4">
        <Card title="Focus Patterns" subtitle="What stands out." accent={PRESET_COLORS[4]} isLightTheme={isLightTheme}>
          <div className="grid gap-3 md:grid-cols-2">
            {[
              ['Best Hour', formatHourList(insights.mostProductiveHours.hours), insights.mostProductiveHours.focusMinutes > 0 ? `${formatMinutesCompact(insights.mostProductiveHours.focusMinutes)} saved there` : 'No focus yet'],
              ['Best Weekday', formatWeekdayList(insights.mostProductiveWeekdays.weekdays), insights.mostProductiveWeekdays.averageFocusMinutes > 0 ? `${formatMinutesCompact(insights.mostProductiveWeekdays.averageFocusMinutes)} avg focus on that day` : 'Needs more history'],
              ['Average Start', formatClockMinutes(insights.averageStartMinutes), insights.sessions.length > 0 ? `${insights.sessions.length} session${insights.sessions.length === 1 ? '' : 's'}` : 'No session starts yet'],
              ['Typical Stop', formatQuitBucketList(insights.mostCommonQuitTimes.bucketMinutes), insights.mostCommonQuitTimes.count > 0 ? `${insights.mostCommonQuitTimes.count} closed session${insights.mostCommonQuitTimes.count === 1 ? '' : 's'}` : 'No closed sessions yet'],
=======
      <div className="grid gap-4 xl:grid-cols-[0.98fr_1.02fr]">
        <Card title="Focus Patterns" subtitle="When you tend to finish pomodoros, start sessions, and call it for the day." accent={PRESET_COLORS[4]} isLightTheme={isLightTheme}>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ['Most Productive Hour', formatHourList(insights.mostProductiveHours.hours), insights.mostProductiveHours.count > 0 ? `${insights.mostProductiveHours.count} completed pomo${insights.mostProductiveHours.count === 1 ? '' : 's'} in that window` : 'Needs completed pomodoros'],
              ['Best Weekday', formatWeekdayList(insights.mostProductiveWeekdays.weekdays), insights.mostProductiveWeekdays.averagePomos > 0 ? `${insights.mostProductiveWeekdays.averagePomos.toFixed(1)} pomos on average` : 'Waiting on enough weekly history'],
              ['Average Start Time', formatClockMinutes(insights.averageStartMinutes), insights.sessions.length > 0 ? `Across ${insights.sessions.length} session${insights.sessions.length === 1 ? '' : 's'}` : 'No session starts logged yet'],
              ['Most Common Quit Time', formatQuitBucketList(insights.mostCommonQuitTimes.bucketMinutes), insights.mostCommonQuitTimes.count > 0 ? `${insights.mostCommonQuitTimes.count} session${insights.mostCommonQuitTimes.count === 1 ? '' : 's'} ended around there` : 'No closed sessions yet'],
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
            ].map(([label, value, helper]) => (
              <div key={label} className="rounded-[1.25rem] border border-white/10 bg-black/12 p-4">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/42">{label}</div>
                <div className="mt-3 text-[1.2rem] font-bold tracking-tight text-white">{value}</div>
                <div className="mt-2 text-[11px] leading-relaxed text-white/48">{helper}</div>
              </div>
            ))}
          </div>

          {insights.hasCategorizedWork && insights.topCategory && (
            <div
              className="mt-4 rounded-[1.35rem] border border-white/10 px-4 py-4"
              style={{
                background: isLightTheme
                  ? `linear-gradient(150deg, ${rgba(accentColor, 0.12)} 0%, rgba(255,255,255,0.88) 100%)`
                  : `linear-gradient(150deg, ${rgba(accentColor, 0.18)} 0%, rgba(255,255,255,0.04) 100%)`,
              }}
            >
<<<<<<< HEAD
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/42">Top Category</div>
=======
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/42">Category With Most Total Minutes</div>
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
              <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-xl font-bold tracking-tight text-white">{insights.topCategory.name}</div>
                  <div className="mt-1 text-sm text-white/62">{formatMinutesPrecise(insights.topCategory.minutes)} total</div>
                </div>
                <div className="rounded-full border border-white/12 bg-black/10 px-3 py-1.5 text-[11px] font-bold text-white/75">
                  {formatPct(insights.topCategory.share)} of all categorized focus
                </div>
              </div>
            </div>
          )}
        </Card>

<<<<<<< HEAD
        <Card title="This Week Vs Last Week" subtitle="A quick comparison." accent={PRESET_COLORS[2]} isLightTheme={isLightTheme}>
=======
        <Card title="This Week Vs Last Week" subtitle="A fast read on whether your current week is climbing, holding, or slipping." accent={PRESET_COLORS[2]} isLightTheme={isLightTheme}>
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
          <div className="space-y-4">
            {comparisonRows.map(([label, current, previous, currentLabel, previousLabel, deltaLabel, pct, color]) => {
              const rowMax = Math.max(1, current as number, previous as number);
              return (
                <div key={label} className="rounded-[1.25rem] border border-white/10 bg-black/12 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/42">{label}</div>
                    <div className="text-[11px] font-bold text-white/72">
                      {deltaLabel}
                      {pct === null ? ' new' : pct === 0 ? '' : ` (${pct > 0 ? '+' : ''}${Math.round(pct)}%)`}
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {[
                      ['This week', current as number, currentLabel as string, color as string],
                      ['Last week', previous as number, previousLabel as string, rgba(color as string, 0.45)],
                    ].map(([barLabel, value, display, fill]) => (
                      <div key={barLabel}>
                        <div className="flex items-center justify-between gap-3 text-[11px] text-white/56">
                          <span>{barLabel}</span>
                          <span className="font-mono text-white/82">{display}</span>
                        </div>
                        <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-white/8">
                          <div
                            className="h-full rounded-full transition-[width] duration-500"
                            style={{
                              width: `${((value as number) / rowMax) * 100}%`,
                              background: typeof fill === 'string' && fill.startsWith('rgba')
                                ? fill
                                : `linear-gradient(90deg, ${rgba(fill as string, 0.95)}, ${rgba(fill as string, 0.62)})`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

<<<<<<< HEAD
      <div className="space-y-4">
        <Card title="Best Hours" subtitle="Where the most saved focus lives." accent={accentColor} isLightTheme={isLightTheme}>
          {bestHourRows.length > 0 ? (
            <div className="space-y-4">
              <div className="rounded-[1.35rem] border border-white/10 bg-black/12 px-4 py-4">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/42">Selected Hour</div>
                <div className="mt-2 text-xl font-bold tracking-tight text-white">
                  {activeBestHour ? formatHour(activeBestHour.hour) : '--'}
                </div>
                <div className="mt-1 text-sm text-white/58">
                  {activeBestHour
                    ? `${formatMinutesPrecise(activeBestHour.minutes)} saved in this hour.`
                    : 'Hover a row to inspect an hour.'}
                </div>
              </div>

              <div className="space-y-2.5">
                {bestHourRows.map((entry, index) => {
                  const active = activeBestHour?.hour === entry.hour;
                  return (
                    <button
                      key={entry.hour}
                      type="button"
                      onMouseEnter={() => setHoveredHour(entry.hour)}
                      onMouseLeave={() => setHoveredHour(null)}
                      onFocus={() => setHoveredHour(entry.hour)}
                      onBlur={() => setHoveredHour(null)}
                      className={`w-full rounded-[1.15rem] border px-4 py-3 text-left transition-all ${active ? 'border-white/20 bg-white/10' : 'border-white/10 bg-black/10 hover:bg-white/6'}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-black/16 text-[11px] font-bold text-white/78">
                            {index + 1}
                          </div>
                          <div>
                            <div className="text-sm font-bold text-white">{formatHour(entry.hour)}</div>
                            <div className="text-[11px] text-white/48">{formatMinutesPrecise(entry.minutes)}</div>
                          </div>
                        </div>
                        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/52">
                          {Math.round((entry.minutes / bestHourMaxMinutes) * 100)}%
                        </div>
                      </div>
                      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/8">
                        <div
                          className="h-full rounded-full transition-[width] duration-300"
                          style={{
                            width: `${(entry.minutes / bestHourMaxMinutes) * 100}%`,
                            background: active
                              ? `linear-gradient(90deg, ${rgba(accentColor, 0.98)}, ${rgba(accentColor, 0.62)})`
                              : `linear-gradient(90deg, ${rgba(accentColor, 0.72)}, ${rgba(accentColor, 0.38)})`,
                          }}
                        />
                      </div>
=======
      <div className="grid gap-4 xl:grid-cols-[1.04fr_0.96fr]">
        <Card title="Productivity Rhythm" subtitle="A 24-hour view of where your focus minutes naturally pile up." accent={accentColor} isLightTheme={isLightTheme}>
          <div
            className="relative overflow-hidden rounded-[1.35rem] border border-white/10 px-4 py-4"
            style={{
              background: isLightTheme
                ? 'linear-gradient(90deg, rgba(15,23,42,0.08) 0%, rgba(125,211,252,0.14) 24%, rgba(255,255,255,0.64) 48%, rgba(251,191,36,0.18) 72%, rgba(15,23,42,0.1) 100%)'
                : 'linear-gradient(90deg, rgba(2,6,23,0.92) 0%, rgba(59,130,246,0.18) 24%, rgba(255,255,255,0.08) 48%, rgba(251,191,36,0.16) 72%, rgba(2,6,23,0.92) 100%)',
            }}
          >
            <div className="absolute inset-x-0 top-0 h-full">
              {[5, 12, 18].map((hour) => (
                <div key={hour} className="absolute top-0 bottom-0 w-px bg-white/10" style={{ left: `${(hour / 24) * 100}%` }} />
              ))}
            </div>
            <div className="relative">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-bold text-white">{dominantDayPartsLabel}</div>
                  <div className="mt-1 text-sm text-white/58">
                    {hoveredHour !== null
                      ? `${formatHour(hoveredHour)} holds ${formatMinutesPrecise(insights.hourlyFocusMinutes[hoveredHour])}`
                      : 'Hover the bars to inspect a specific hour.'}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {DAY_PART_LABELS.map((part) => (
                    <div key={part} className="rounded-full border border-white/12 bg-black/12 px-3 py-1.5 text-[11px] font-bold text-white/72">
                      {dayPartLabels[part]} {formatMinutesCompact(insights.dayPartTotals[part])}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 grid h-52 grid-cols-24 items-end gap-1.5">
                {insights.hourlyFocusMinutes.map((minutes, hour) => {
                  const height = maxRhythmMinutes > 0 ? Math.max(8, (minutes / maxRhythmMinutes) * 100) : 6;
                  const active = highlightedHour === hour;
                  return (
                    <button
                      key={hour}
                      type="button"
                      onMouseEnter={() => setHoveredHour(hour)}
                      onMouseLeave={() => setHoveredHour(null)}
                      onFocus={() => setHoveredHour(hour)}
                      onBlur={() => setHoveredHour(null)}
                      className="flex h-full items-end focus:outline-none"
                      aria-label={`${formatHour(hour)} ${formatMinutesPrecise(minutes)}`}
                    >
                      <div
                        className={`w-full rounded-[0.85rem] transition-all duration-300 ${active ? 'translate-y-[-2px]' : ''}`}
                        style={{
                          height: `${height}%`,
                          background: active
                            ? `linear-gradient(180deg, ${rgba(accentColor, 0.98)} 0%, ${rgba(accentColor, 0.72)} 100%)`
                            : `linear-gradient(180deg, ${rgba(accentColor, 0.58)} 0%, ${rgba(accentColor, 0.28)} 100%)`,
                          boxShadow: active ? `0 18px 36px -24px ${rgba(accentColor, 0.78)}` : 'none',
                        }}
                      />
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
                    </button>
                  );
                })}
              </div>

<<<<<<< HEAD
              <div className="grid gap-3 sm:grid-cols-3">
                {focusPhaseRows.map((phase) => (
                  <div key={phase.key} className="rounded-[1.2rem] border border-white/10 bg-black/10 px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/42">{phase.label}</div>
                    <div className="mt-2 text-lg font-bold text-white">{formatMinutesCompact(phase.minutes)}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-[1.2rem] border border-white/10 bg-black/10 px-4 py-5 text-sm leading-relaxed text-white/58">
              Best hours will appear once enough saved focus exists to compare them.
            </div>
          )}
=======
              <div className="mt-3 grid grid-cols-4 text-[10px] font-bold uppercase tracking-[0.14em] text-white/38">
                <div>12a</div>
                <div className="text-center">6a</div>
                <div className="text-center">12p</div>
                <div className="text-right">6p</div>
              </div>
            </div>
          </div>
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
        </Card>

        <Card
          title="Category Share"
<<<<<<< HEAD
          subtitle={insights.hasCategorizedWork ? 'Saved focus by category.' : 'This will populate once work is saved into categories.'}
=======
          subtitle={insights.hasCategorizedWork ? 'Hover or tap a slice to see how your focus time is divided.' : 'Once you save work blocks into categories, this turns into an interactive breakdown.'}
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
          accent={PRESET_COLORS[1]}
          isLightTheme={isLightTheme}
        >
          {categorySlices.length > 0 ? (
<<<<<<< HEAD
            <div className="grid gap-5 md:grid-cols-[0.9fr_1.1fr]">
=======
            <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
              <div className="flex items-center justify-center">
                <div className="relative h-60 w-60">
                  <svg viewBox="0 0 120 120" className="h-full w-full">
                    <defs>
                      <filter id="doroPieGlow" x="-40%" y="-40%" width="180%" height="180%">
                        <feGaussianBlur stdDeviation="3.6" result="blur" />
                        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                      </filter>
                    </defs>
                    <circle cx="60" cy="60" r="46" fill="none" stroke={isLightTheme ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.08)'} strokeWidth="16" />
                    {donutSegments.map((segment) => {
                      const active = activeCategory?.name === segment.name;
                      return (
                        <circle
                          key={segment.name}
                          cx="60"
                          cy="60"
                          r={segment.radius}
                          fill="none"
                          stroke={segment.color}
                          strokeWidth={active ? 20 : 16}
                          strokeLinecap="round"
                          strokeDasharray={`${Math.max(0, segment.dash - 2)} ${segment.circumference}`}
                          strokeDashoffset={segment.offset}
                          filter={active ? 'url(#doroPieGlow)' : undefined}
                          transform="rotate(-90 60 60)"
                          className="cursor-pointer transition-all duration-300"
                          onMouseEnter={() => setActiveCategoryName(segment.name)}
                        />
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
              Categorized focus time has not been logged yet, so there is nothing accurate to chart here.
            </div>
          )}
        </Card>
      </div>
<<<<<<< HEAD
=======

      <Card
        title="Productivity Heatmap"
        subtitle="Work minutes by weekday and hour, so you can see the exact pockets where focus tends to stack up."
        accent={PRESET_COLORS[6]}
        isLightTheme={isLightTheme}
      >
        {insights.heatmapMaxMinutes > 0 ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="text-sm text-white/62">
                {activeHeatCell
                  ? `${activeHeatCell.label} - ${formatMinutesPrecise(activeHeatCell.minutes)}`
                  : 'Hover any cell to inspect the exact weekday-hour pocket.'}
              </div>
              <div className="rounded-full border border-white/12 bg-black/10 px-3 py-1.5 text-[11px] font-bold text-white/72">
                Strongest pockets glow brighter
              </div>
            </div>

            <div className="overflow-x-auto pb-1">
              <div className="min-w-[42rem]">
                <div className="grid grid-cols-[4rem_repeat(24,minmax(0,1fr))] gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/38">
                  <div />
                  {Array.from({ length: 24 }, (_, hour) => (
                    <div key={`heat-label-${hour}`} className="text-center">
                      {hour % 6 === 0 ? `${hour === 0 ? '12a' : hour === 12 ? '12p' : hour < 12 ? `${hour}a` : `${hour - 12}p`}` : ''}
                    </div>
                  ))}
                </div>

                <div className="mt-2 space-y-1.5">
                  {insights.weekdayHourHeatmap.map((row, weekday) => (
                    <div key={WEEKDAY_SHORT_LABELS[weekday]} className="grid grid-cols-[4rem_repeat(24,minmax(0,1fr))] gap-1.5 items-center">
                      <div className="pr-2 text-[11px] font-bold text-white/48">{WEEKDAY_SHORT_LABELS[weekday]}</div>
                      {row.map((minutes, hour) => {
                        const intensity = insights.heatmapMaxMinutes > 0 ? minutes / insights.heatmapMaxMinutes : 0;
                        const active = hoveredHeatCell?.weekday === weekday && hoveredHeatCell?.hour === hour;
                        return (
                          <div
                            key={`${weekday}-${hour}`}
                            onMouseEnter={() => setHoveredHeatCell({ weekday, hour })}
                            onMouseLeave={() => setHoveredHeatCell(null)}
                            className={`h-5 rounded-[0.45rem] border transition-all ${active ? 'scale-[1.08]' : ''}`}
                            style={{
                              borderColor: active ? rgba(accentColor, 0.42) : rgba(accentColor, 0.12),
                              background: minutes > 0
                                ? `linear-gradient(180deg, ${rgba(accentColor, 0.22 + intensity * 0.58)} 0%, ${rgba(accentColor, 0.12 + intensity * 0.38)} 100%)`
                                : (isLightTheme ? 'rgba(148, 163, 184, 0.08)' : 'rgba(255, 255, 255, 0.04)'),
                              boxShadow: active ? `0 10px 22px -16px ${rgba(accentColor, 0.72)}` : 'none',
                            }}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-[1.2rem] border border-white/10 bg-black/10 px-4 py-5 text-sm leading-relaxed text-white/58">
            Detailed hour-by-hour heat shows up once enough focus history exists to plot real patterns.
          </div>
        )}
      </Card>
>>>>>>> d0572b4f2fc42c25884fe47c1e18769356bd9b20
    </div>
  );
};

export default AccountInsights;
