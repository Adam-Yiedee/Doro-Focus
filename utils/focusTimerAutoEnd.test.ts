import { describe, expect, it } from 'vitest';
import {
  FOCUS_TIMER_BREAK_AUTO_END_MS,
  getFocusTimerBreakAutoEndMs,
} from './focusTimerAutoEnd';

const baseInput = {
  timerPreset: 'focus' as const,
  activeMode: 'break' as const,
  timerStarted: true,
  isIdle: false,
  allPauseActive: false,
  graceOpen: false,
  activityStartMs: Date.parse('2026-07-26T10:00:00.000Z'),
};

describe('focus timer long break auto end', () => {
  it('returns the 90 minute cutoff once a focus timer break runs past the threshold', () => {
    const autoEndMs = getFocusTimerBreakAutoEndMs({
      ...baseInput,
      nowMs: baseInput.activityStartMs + FOCUS_TIMER_BREAK_AUTO_END_MS + 1,
    });

    expect(autoEndMs).toBe(baseInput.activityStartMs + FOCUS_TIMER_BREAK_AUTO_END_MS);
  });

  it('does not auto end before or exactly at the threshold', () => {
    expect(getFocusTimerBreakAutoEndMs({
      ...baseInput,
      nowMs: baseInput.activityStartMs + FOCUS_TIMER_BREAK_AUTO_END_MS - 1,
    })).toBeNull();

    expect(getFocusTimerBreakAutoEndMs({
      ...baseInput,
      nowMs: baseInput.activityStartMs + FOCUS_TIMER_BREAK_AUTO_END_MS,
    })).toBeNull();
  });

  it('only applies to Focus Timer break mode', () => {
    expect(getFocusTimerBreakAutoEndMs({
      ...baseInput,
      timerPreset: 'classic',
      nowMs: baseInput.activityStartMs + FOCUS_TIMER_BREAK_AUTO_END_MS + 1,
    })).toBeNull();

    expect(getFocusTimerBreakAutoEndMs({
      ...baseInput,
      activeMode: 'work',
      nowMs: baseInput.activityStartMs + FOCUS_TIMER_BREAK_AUTO_END_MS + 1,
    })).toBeNull();
  });

  it('does not auto end when the break is not actively running', () => {
    expect(getFocusTimerBreakAutoEndMs({
      ...baseInput,
      timerStarted: false,
      nowMs: baseInput.activityStartMs + FOCUS_TIMER_BREAK_AUTO_END_MS + 1,
    })).toBeNull();

    expect(getFocusTimerBreakAutoEndMs({
      ...baseInput,
      isIdle: true,
      nowMs: baseInput.activityStartMs + FOCUS_TIMER_BREAK_AUTO_END_MS + 1,
    })).toBeNull();

    expect(getFocusTimerBreakAutoEndMs({
      ...baseInput,
      allPauseActive: true,
      nowMs: baseInput.activityStartMs + FOCUS_TIMER_BREAK_AUTO_END_MS + 1,
    })).toBeNull();

    expect(getFocusTimerBreakAutoEndMs({
      ...baseInput,
      graceOpen: true,
      nowMs: baseInput.activityStartMs + FOCUS_TIMER_BREAK_AUTO_END_MS + 1,
    })).toBeNull();
  });

  it('does not fire twice for the same break activity start', () => {
    expect(getFocusTimerBreakAutoEndMs({
      ...baseInput,
      alreadyAutoEndedActivityStartMs: baseInput.activityStartMs,
      nowMs: baseInput.activityStartMs + FOCUS_TIMER_BREAK_AUTO_END_MS + 1,
    })).toBeNull();
  });
});
