import { describe, expect, it } from 'vitest';
import { getBreakSquareDisplayOptions, getFocusTimerSingleLabel } from './TimerDisplay';

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
