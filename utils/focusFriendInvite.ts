const DEFAULT_PUBLIC_SITE_URL = (import.meta.env.VITE_PUBLIC_SITE_URL || 'https://dorofocus.netlify.app').replace(/\/+$/, '');
const FOCUS_FRIEND_USERNAME_REGEX = /^[a-z0-9_.-]{3,32}$/;

export const FOCUS_FRIEND_INVITE_PARAM = 'focusFriend';
export const FOCUS_FRIEND_INVITE_LEGACY_PARAM = 'friend';

export const normalizeFocusFriendInviteUsername = (value: string | null | undefined): string | null => {
  const normalized = (value || '').trim().toLowerCase();
  return FOCUS_FRIEND_USERNAME_REGEX.test(normalized) ? normalized : null;
};

export const getFocusFriendInviteUsernameFromSearch = (search: string): string | null => {
  try {
    const params = new URLSearchParams(search);
    return normalizeFocusFriendInviteUsername(params.get(FOCUS_FRIEND_INVITE_PARAM))
      || normalizeFocusFriendInviteUsername(params.get(FOCUS_FRIEND_INVITE_LEGACY_PARAM));
  } catch {
    return null;
  }
};

export const getFocusFriendInviteUsernameFromCurrentUrl = (): string | null => {
  if (typeof window === 'undefined') return null;
  return getFocusFriendInviteUsernameFromSearch(window.location.search);
};

export const buildFocusFriendInviteUrl = (username: string): string => {
  const normalized = normalizeFocusFriendInviteUsername(username) || username.trim().toLowerCase();
  const currentBase = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}`
    : `${DEFAULT_PUBLIC_SITE_URL}/`;
  const url = new URL(currentBase, `${DEFAULT_PUBLIC_SITE_URL}/`);
  url.searchParams.set(FOCUS_FRIEND_INVITE_PARAM, normalized);
  return url.toString();
};

export const removeFocusFriendInviteParamsFromCurrentUrl = () => {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete(FOCUS_FRIEND_INVITE_PARAM);
  url.searchParams.delete(FOCUS_FRIEND_INVITE_LEGACY_PARAM);
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, '', nextUrl || '/');
};
