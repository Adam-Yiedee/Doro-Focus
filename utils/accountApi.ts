import { User } from '../types';

const ACCOUNT_API_BASE = import.meta.env.VITE_ACCOUNT_API_BASE || '/.netlify/functions';

export interface AccountAuthResponse {
  token: string;
  user: User;
  accountData: any;
}

class AccountApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AccountApiError';
    this.status = status;
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
    throw new AccountApiError(message, res.status);
  }
  return payload;
};

const callAccountApi = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`${ACCOUNT_API_BASE}/${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  return parseApiResponse(res);
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

export const saveAccountData = async (token: string, accountData: any): Promise<{ accountData: any; savedAt: string }> => {
  const payload = await callAccountApi('account-data', {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ accountData }),
  });
  return payload as { accountData: any; savedAt: string };
};

export const isUnauthorizedError = (error: unknown): boolean => {
  return error instanceof AccountApiError && error.status === 401;
};

