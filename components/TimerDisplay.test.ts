import { describe, expect, it } from 'vitest';
import { getBreakSquareDisplayOptions, getFocusTimerFlipAction, getFocusTimerSingleLabel } from './TimerDisplay';

describe('TimerDisplay break square display options', () => {
  it('shows the delayed-start countdown in focus timer mode', () => {
    expect(getBreakSquareDisplayOptions({
      isFocusTimerPreset: true,
      isDelayedStartCountdown: true,
    })).toEqual({
      displayValue: undefined,
      displayVariant: 'time',
      hideLabel: false,
      hideLiquid: false,
    });
  });

  it('hides the break bank display in focus timer mode outside delayed start', () => {
    expect(getBreakSquareDisplayOptions({
      isFocusTimerPreset: true,
      isDelayedStartCountdown: false,
    })).toEqual({
      displayValue: 'Break',
      displayVariant: 'word',
      hideLabel: true,
      hideLiquid: true,
    });
  });

  it('keeps normal break timer rendering for classic and compact modes', () => {
    expect(getBreakSquareDisplayOptions({
      isFocusTimerPreset: false,
      isDelayedStartCountdown: false,
    })).toEqual({
      displayValue: undefined,
      displayVariant: 'time',
      hideLabel: false,
      hideLiquid: false,
    });
  });
});

describe('focus timer single display label', () => {
  it('uses click-to-start copy before the first focus timer start', () => {
    expect(getFocusTimerSingleLabel({
      isReadyToStart: true,
      activeTaskName: 'Biology',
    })).toBe('Click to Start');
  });

  it('uses the active task name once the focus timer is not in the pre-start state', () => {
    expect(getFocusTimerSingleLabel({
      isReadyToStart: false,
      activeTaskName: ' Biology ',
    })).toBe('Biology');
  });

  it('falls back to the focus timer label without an active task', () => {
    expect(getFocusTimerSingleLabel({
      isReadyToStart: false,
      activeTaskName: '',
    })).toBe('Focus Timer');
  });
});

describe('focus timer flip behavior', () => {
  it('pauses a running focus timer when the break face is requested', () => {
    expect(getFocusTimerFlipAction({
      nextFace: 'break',
      timerStarted: true,
      focusFlipPauseActive: false,
    })).toBe('pause');
  });

  it('resumes only a timer that was paused by the flip interaction', () => {
    expect(getFocusTimerFlipAction({
      nextFace: 'work',
      timerStarted: false,
      focusFlipPauseActive: true,
    })).toBe('resume');
    expect(getFocusTimerFlipAction({
      nextFace: 'work',
      timerStarted: false,
      focusFlipPauseActive: false,
    })).toBeNull();
  });

  it('does not convert an already-stopped timer into a flip pause', () => {
    expect(getFocusTimerFlipAction({
      nextFace: 'break',
      timerStarted: false,
      focusFlipPauseActive: false,
    })).toBeNull();
  });
});
