import { FocusFriendsState, TimerSpectatorState, User } from '../types';

const ACCOUNT_API_BASE = import.meta.env.VITE_ACCOUNT_API_BASE || '/.netlify/functions';
const ACCOUNT_API_TIMEOUT_MS = 12_000;

export interface AccountAuthResponse {
  token: string;
  user: User;
  accountData: any;
}

class AccountApiError extends Error {
  status: number;
  payload: any;

  constructor(message: string, status: number, payload: any = null) {
    super(message);
    this.name = 'AccountApiError';
    this.status = status;
    this.payload = payload;
  }
}

const parseApiResponse = async (res: Response) => {
  const contentType = res.headers.get('content-type') || '';
  let payload: any = null;
  if (contentType.includes('application/json')) {
    payload = await res.json();
  } else {
    const text = await res.text();
    payload = text ? { error: text } : {};
  }

  if (!res.ok) {
    const message = payload?.error || `Request failed (${res.status})`;
    throw new AccountApiError(message, res.status, payload);
  }
  return payload;
};

const callAccountApi = async (path: string, init: RequestInit = {}) => {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), ACCOUNT_API_TIMEOUT_MS);
  try {
    const res = await fetch(`${ACCOUNT_API_BASE}/${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(init.headers || {}),
      },
    });
    return parseApiResponse(res);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Account request timed out.');
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
};

export const registerAccount = async (username: string, password: string, seedData: any): Promise<AccountAuthResponse> => {
  const payload = await callAccountApi('auth-register', {
    method: 'POST',
    body: JSON.stringify({ username, password, seedData }),
  });
  return payload as AccountAuthResponse;
};

export const loginAccount = async (username: string, password: string): Promise<AccountAuthResponse> => {
  const payload = await callAccountApi('auth-login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  return payload as AccountAuthResponse;
};

export const logoutAccount = async (token: string): Promise<void> => {
  await callAccountApi('auth-logout', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
};

export const fetchAccountData = async (token: string): Promise<{ accountData: any; user: User }> => {
  const payload = await callAccountApi('account-data', {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  });
  return payload as { accountData: any; user: User };
};

export const saveAccountData = async (token: string, accountData: any): Promise<{ accountData: any; user: User; savedAt: string }> => {
  const payload = await callAccountApi('account-data', {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ accountData }),
  });
  return payload as { accountData: any; user: User; savedAt: string };
};

export const fetchFocusFriends = async (token: string): Promise<FocusFriendsState> => {
  const payload = await callAccountApi('focus-friends', {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  });
  return payload as FocusFriendsState;
};

export const sendFocusFriendRequest = async (token: string, username: string): Promise<FocusFriendsState> => {
  const payload = await callAccountApi('focus-friends', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'send-request', username }),
  });
  return payload as FocusFriendsState;
};

export const updateFocusFriendPresence = async (token: string, timer: TimerSpectatorState): Promise<FocusFriendsState> => {
  const payload = await callAccountApi('focus-friends', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'update-presence', timer }),
  });
  return payload as FocusFriendsState;
};

export const acceptFocusFriendRequest = async (token: string, requestId: string): Promise<FocusFriendsState> => {
  const payload = await callAccountApi('focus-friends', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'accept-request', requestId }),
  });
  return payload as FocusFriendsState;
};

export const acceptFocusFriendInvite = async (token: string, username: string): Promise<FocusFriendsState> => {
  const payload = await callAccountApi('focus-friends', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'accept-invite', username }),
  });
  return payload as FocusFriendsState;
};

export const declineFocusFriendRequest = async (token: string, requestId: string): Promise<FocusFriendsState> => {
  const payload = await callAccountApi('focus-friends', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'decline-request', requestId }),
  });
  return payload as FocusFriendsState;
};

export const removeFocusFriend = async (token: string, username: string): Promise<FocusFriendsState> => {
  const payload = await callAccountApi('focus-friends', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'remove-friend', username }),
  });
  return payload as FocusFriendsState;
};

export const sendFocusFriendEncouragement = async (token: string, username: string, message: string): Promise<FocusFriendsState> => {
  const payload = await callAccountApi('focus-friends', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'send-encouragement', username, message }),
  });
  return payload as FocusFriendsState;
};

export const requestFocusFriendJoin = async (token: string, username: string, message?: string, sessionId?: string | null): Promise<FocusFriendsState> => {
  const payload = await callAccountApi('focus-friends', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'request-join', username, message, sessionId }),
  });
  return payload as FocusFriendsState;
};

export const sendFocusFriendJoinInvite = async (token: string, username: string, sessionId: string, message?: string): Promise<FocusFriendsState> => {
  const payload = await callAccountApi('focus-friends', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'send-join-invite', username, sessionId, message }),
  });
  return payload as FocusFriendsState;
};

export const markFocusFriendActionRead = async (token: string, actionId: string): Promise<FocusFriendsState> => {
  const payload = await callAccountApi('focus-friends', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'mark-action-read', actionId }),
  });
  return payload as FocusFriendsState;
};

export const isUnauthorizedError = (error: unknown): boolean => {
  return error instanceof AccountApiError && error.status === 401;
};

export const isConflictError = (error: unknown): error is AccountApiError => {
  return error instanceof AccountApiError && error.status === 409;
};
