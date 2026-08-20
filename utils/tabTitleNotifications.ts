import type { TimerMode, TimerPreset } from '../types';

export const DEFAULT_TAB_TITLE = 'Doro';
export type TimerTabTitleNotification = 'workDone' | 'breakDone';

export const getTimerBaseTabTitle = ({
  timerPreset,
  activeMode,
}: {
  timerPreset: TimerPreset;
  activeMode: TimerMode;
}) => {
  if (timerPreset !== 'focus') return DEFAULT_TAB_TITLE;
  return activeMode === 'break' ? 'Break' : 'Working';
};

export const getTimerTabTitleNotification = (notification: TimerTabTitleNotification) => (
  notification === 'workDone' ? 'Work Done!' : 'Break Done!'
);

export const shouldShowTimerTabTitleNotification = ({
  visibilityState,
  hasFocus,
}: {
  visibilityState?: DocumentVisibilityState;
  hasFocus?: boolean;
}) => visibilityState !== 'visible' || hasFocus === false;
