export const DORO_DEVELOPER_PREVIEW_EVENT = 'doro:developer-preview';

export type DeveloperPreviewAction =
  | 'focus-streak-notification'
  | 'daily-welcome-notification'
  | 'group-notification'
  | 'friend-notification'
  | 'encouragement-notification'
  | 'grace-after-work'
  | 'grace-after-break'
  | 'long-grace'
  | 'clear-previews';

export interface DeveloperPreviewEventDetail {
  action: DeveloperPreviewAction;
}

export const dispatchDeveloperPreview = (action: DeveloperPreviewAction) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<DeveloperPreviewEventDetail>(DORO_DEVELOPER_PREVIEW_EVENT, {
    detail: { action },
  }));
};
