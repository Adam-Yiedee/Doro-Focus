export const DEFAULT_TAB_TITLE = 'Doro';
export type TimerTabTitleNotification = 'workDone' | 'breakDone';

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
