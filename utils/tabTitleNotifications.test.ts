import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TAB_TITLE,
  getTimerTabTitleNotification,
  shouldShowTimerTabTitleNotification,
} from './tabTitleNotifications';

describe('tab title timer notifications', () => {
  it('uses the stable app title as the reset title', () => {
    expect(DEFAULT_TAB_TITLE).toBe('Doro');
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
