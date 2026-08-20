import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TAB_TITLE,
  getTimerBaseTabTitle,
  getTimerTabTitleNotification,
  shouldShowTimerTabTitleNotification,
} from './tabTitleNotifications';

describe('tab title timer notifications', () => {
  it('uses the stable app title as the reset title', () => {
    expect(DEFAULT_TAB_TITLE).toBe('Doro');
  });

  it('uses work and break labels as the base title in unstructured focus', () => {
    expect(getTimerBaseTabTitle({
      timerPreset: 'focus',
      activeMode: 'work',
    })).toBe('Working');

    expect(getTimerBaseTabTitle({
      timerPreset: 'focus',
      activeMode: 'break',
    })).toBe('Break');
  });

  it('keeps the app title for structured timer presets', () => {
    expect(getTimerBaseTabTitle({
      timerPreset: 'classic',
      activeMode: 'work',
    })).toBe('Doro');

    expect(getTimerBaseTabTitle({
      timerPreset: 'compact',
      activeMode: 'break',
    })).toBe('Doro');

    expect(getTimerBaseTabTitle({
      timerPreset: 'custom',
      activeMode: 'work',
    })).toBe('Doro');
  });

  it('formats work and break completion titles', () => {
    expect(getTimerTabTitleNotification('workDone')).toBe('Work Done!');
    expect(getTimerTabTitleNotification('breakDone')).toBe('Break Done!');
  });

  it('only shows completion titles when the tab is not actively open', () => {
    expect(shouldShowTimerTabTitleNotification({
      visibilityState: 'visible',
      hasFocus: true,
    })).toBe(false);

    expect(shouldShowTimerTabTitleNotification({
      visibilityState: 'hidden',
      hasFocus: false,
    })).toBe(true);

    expect(shouldShowTimerTabTitleNotification({
      visibilityState: 'visible',
      hasFocus: false,
    })).toBe(true);
  });
});
