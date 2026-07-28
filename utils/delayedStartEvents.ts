export const DORO_DELAYED_START_SESSION_STARTED_EVENT = 'doro:delayed-start-session-started';

export const dispatchDelayedStartSessionStarted = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DORO_DELAYED_START_SESSION_STARTED_EVENT));
};
