import { describe, expect, it } from 'vitest';
import { getBreakSquareDisplayOptions } from './TimerDisplay';

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
