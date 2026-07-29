import { describe, expect, it } from 'vitest';
import { buildSessionClockCycleOverlayWindows } from './sessionClock';

const baseMs = Date.parse('2026-07-29T09:00:00');
const atMinute = (minute: number) => baseMs + (minute * 60_000);

const focus = (
  startMinute: number,
  endMinute: number,
  completed = false,
  isMiniPomo = false,
) => ({
  segmentStartMs: atMinute(startMinute),
  segmentEndMs: atMinute(endMinute),
  reasonCompletionWeight: completed ? (isMiniPomo ? 0.5 : 1) : 0,
  isMiniPomo,
});

const rest = (startMinute: number, endMinute: number) => ({
  segmentStartMs: atMinute(startMinute),
  segmentEndMs: atMinute(endMinute),
});

const buildCycles = (
  focusWindows: ReturnType<typeof focus>[],
  breakWindows: ReturnType<typeof rest>[],
  endMinute = 120,
) => buildSessionClockCycleOverlayWindows({
  focusWindows,
  breakWindows,
  sessionStartMs: atMinute(0),
  sessionEndMs: atMinute(endMinute),
}).map((cycle) => ({
  index: cycle.index,
  startMinute: (cycle.startMs - baseMs) / 60_000,
  endMinute: (cycle.endMs - baseMs) / 60_000,
}));

describe('buildSessionClockCycleOverlayWindows', () => {
  it('starts a completed pomo at the first split work segment', () => {
    expect(buildCycles([
      focus(0, 8),
      focus(8, 25, true),
    ], [])).toEqual([
      { index: 1, startMinute: 0, endMinute: 25 },
    ]);
  });

  it('includes breaks that happen before an in-progress pomo completes', () => {
    expect(buildCycles([
      focus(0, 10),
      focus(15, 25, true),
    ], [
      rest(10, 15),
    ])).toEqual([
      { index: 1, startMinute: 0, endMinute: 25 },
    ]);
  });

  it('attaches a completed break immediately after a completed pomo', () => {
    expect(buildCycles([
      focus(0, 25, true),
      focus(45, 70, true),
    ], [
      rest(25, 35),
    ])).toEqual([
      { index: 1, startMinute: 0, endMinute: 35 },
      { index: 2, startMinute: 45, endMinute: 70 },
    ]);
  });

  it('keeps the final unattached break on the just-completed pomo', () => {
    expect(buildCycles([
      focus(0, 25, true),
    ], [
      rest(25, 32),
    ])).toEqual([
      { index: 1, startMinute: 0, endMinute: 32 },
    ]);
  });
});
