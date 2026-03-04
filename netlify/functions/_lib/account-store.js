import { getStore } from '@netlify/blobs';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const USERS_STORE_NAME = 'doro_accounts_users_v1';
const DATA_STORE_NAME = 'doro_accounts_data_v1';
const SESSIONS_STORE_NAME = 'doro_accounts_sessions_v1';

const USER_KEY_PREFIX = 'user_name:';
const USER_ID_KEY_PREFIX = 'user_id:';
const ACCOUNT_KEY_PREFIX = 'account:';
const SESSION_KEY_PREFIX = 'session:';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const MAX_ACCOUNT_BYTES = 2_000_000;

const USERNAME_REGEX = /^[A-Za-z0-9_.-]{3,32}$/;
const PASSWORD_MIN_LENGTH = 8;

const DEFAULT_SETTINGS = {
  workDuration: 1500,
  shortBreakDuration: 300,
  longBreakDuration: 900,
  longBreakInterval: 4,
  disableBlur: true,
  alarmSound: 'bell',
  themeMode: 'dark',
};

const defaultLifetimeStats = () => ({
  totalFocusHours: 0,
  totalSessions: 0,
  totalPomos: 0,
  activeDays: 0,
  currentStreak: 0,
  bestStreak: 0,
  lastActiveDate: null,
  categoryBreakdown: {},
});

const clampNumber = (value, fallback = 0) => {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) return fallback;
  return value;
};

const cleanString = (value, fallback = '') => {
  return typeof value === 'string' ? value : fallback;
};

export const json = (status, body) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};

export const parseBody = async (request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

export const normalizeUsername = (value) => cleanString(value).trim().toLowerCase();

export const validateUsername = (value) => {
  if (!USERNAME_REGEX.test(value)) {
    return 'Username must be 3-32 characters and use letters, numbers, ".", "_" or "-".';
  }
  return null;
};

export const validatePassword = (value) => {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return null;
};

const getStores = () => ({
  usersStore: getStore(USERS_STORE_NAME),
  dataStore: getStore(DATA_STORE_NAME),
  sessionsStore: getStore(SESSIONS_STORE_NAME),
});

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

const hashPassword = (password, salt) => scryptSync(password, salt, 64).toString('hex');

const makeUserPublic = (record) => ({
  username: record.username,
  joinedAt: record.joinedAt,
  lifetimeStats: {
    ...defaultLifetimeStats(),
    ...(record.lifetimeStats || {}),
  },
});

const sanitizeLifetimeStats = (raw, fallback) => {
  const base = {
    ...defaultLifetimeStats(),
    ...(fallback || {}),
  };
  const next = raw && typeof raw === 'object' ? raw : {};
  return {
    totalFocusHours: clampNumber(next.totalFocusHours, base.totalFocusHours),
    totalSessions: Math.max(0, Math.floor(clampNumber(next.totalSessions, base.totalSessions))),
    totalPomos: Math.max(0, Math.floor(clampNumber(next.totalPomos, base.totalPomos))),
    activeDays: Math.max(0, Math.floor(clampNumber(next.activeDays, base.activeDays))),
    currentStreak: Math.max(0, Math.floor(clampNumber(next.currentStreak, base.currentStreak))),
    bestStreak: Math.max(0, Math.floor(clampNumber(next.bestStreak, base.bestStreak))),
    lastActiveDate: typeof next.lastActiveDate === 'string' || next.lastActiveDate === null ? next.lastActiveDate : base.lastActiveDate,
    categoryBreakdown: next.categoryBreakdown && typeof next.categoryBreakdown === 'object' ? next.categoryBreakdown : base.categoryBreakdown,
  };
};

export const sanitizeAccountPayload = (payload, publicUser) => {
  const source = payload && typeof payload === 'object' ? payload : {};
  const safeUser = {
    username: publicUser.username,
    joinedAt: publicUser.joinedAt,
    lifetimeStats: sanitizeLifetimeStats(source.user?.lifetimeStats, publicUser.lifetimeStats),
  };

  const sanitized = {
    schemaVersion: 2,
    runtime: source.runtime && typeof source.runtime === 'object' ? source.runtime : undefined,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(source.settings && typeof source.settings === 'object' ? source.settings : {}),
    },
    tasks: Array.isArray(source.tasks) ? source.tasks : [],
    pastSessions: Array.isArray(source.pastSessions) ? source.pastSessions : [],
    categories: Array.isArray(source.categories) ? source.categories : [],
    logs: Array.isArray(source.logs) ? source.logs : [],
    pomodoroCount: clampNumber(source.pomodoroCount, 0),
    workTime: clampNumber(source.workTime, DEFAULT_SETTINGS.workDuration),
    breakTime: clampNumber(source.breakTime, 0),
    activeMode: source.activeMode === 'break' ? 'break' : 'work',
    timerStarted: Boolean(source.timerStarted),
    isIdle: typeof source.isIdle === 'boolean' ? source.isIdle : true,
    allPauseActive: Boolean(source.allPauseActive),
    allPauseTime: clampNumber(source.allPauseTime, 0),
    allPauseReason: cleanString(source.allPauseReason, ''),
    allPauseStartTime: source.allPauseStartTime === null || typeof source.allPauseStartTime === 'number' ? source.allPauseStartTime : null,
    graceOpen: Boolean(source.graceOpen),
    graceContext: source.graceContext === 'afterWork' || source.graceContext === 'afterBreak' ? source.graceContext : null,
    graceTotal: clampNumber(source.graceTotal, 0),
    scheduleBreaks: Array.isArray(source.scheduleBreaks) ? source.scheduleBreaks : [],
    scheduleStartTime: cleanString(source.scheduleStartTime, '08:00'),
    sessionStartTime: typeof source.sessionStartTime === 'string' || source.sessionStartTime === null ? source.sessionStartTime : null,
    userName: safeUser.username,
    user: safeUser,
    updatedAt: new Date().toISOString(),
  };

  const serialized = JSON.stringify(sanitized);
  if (serialized.length > MAX_ACCOUNT_BYTES) {
    throw new Error(`Account payload is too large (${serialized.length} bytes).`);
  }

  return sanitized;
};

export const buildDefaultAccountData = (publicUser) => sanitizeAccountPayload({
  settings: DEFAULT_SETTINGS,
  tasks: [],
  pastSessions: [],
  categories: [],
  logs: [],
  pomodoroCount: 0,
  workTime: DEFAULT_SETTINGS.workDuration,
  breakTime: 0,
  activeMode: 'work',
  timerStarted: false,
  isIdle: true,
  allPauseActive: false,
  allPauseTime: 0,
  allPauseReason: '',
  allPauseStartTime: null,
  graceOpen: false,
  graceContext: null,
  graceTotal: 0,
  scheduleBreaks: [],
  scheduleStartTime: '08:00',
  sessionStartTime: null,
  userName: publicUser.username,
  user: publicUser,
}, publicUser);

export const getUserByUsername = async (normalizedUsername) => {
  const { usersStore } = getStores();
  return usersStore.getJSON(`${USER_KEY_PREFIX}${normalizedUsername}`);
};

export const getUserById = async (userId) => {
  const { usersStore } = getStores();
  return usersStore.getJSON(`${USER_ID_KEY_PREFIX}${userId}`);
};

export const createUser = async (username, password) => {
  const { usersStore } = getStores();
  const normalized = normalizeUsername(username);
  const existing = await usersStore.getJSON(`${USER_KEY_PREFIX}${normalized}`);
  if (existing) return null;

  const salt = randomBytes(16).toString('hex');
  const joinedAt = new Date().toISOString();
  const record = {
    id: randomBytes(18).toString('hex'),
    username: normalized,
    normalizedUsername: normalized,
    passwordSalt: salt,
    passwordHash: hashPassword(password, salt),
    joinedAt,
    lifetimeStats: defaultLifetimeStats(),
    createdAt: joinedAt,
    updatedAt: joinedAt,
  };

  await Promise.all([
    usersStore.setJSON(`${USER_KEY_PREFIX}${normalized}`, record),
    usersStore.setJSON(`${USER_ID_KEY_PREFIX}${record.id}`, record),
  ]);
  return record;
};

export const verifyPassword = (record, password) => {
  if (!record?.passwordSalt || !record?.passwordHash || typeof password !== 'string') return false;
  const computed = scryptSync(password, record.passwordSalt, 64);
  const stored = Buffer.from(record.passwordHash, 'hex');
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
};

export const persistUser = async (record) => {
  const { usersStore } = getStores();
  const withUpdated = { ...record, updatedAt: new Date().toISOString() };
  await Promise.all([
    usersStore.setJSON(`${USER_KEY_PREFIX}${withUpdated.normalizedUsername}`, withUpdated),
    usersStore.setJSON(`${USER_ID_KEY_PREFIX}${withUpdated.id}`, withUpdated),
  ]);
};

export const createSession = async (userRecord) => {
  const { sessionsStore } = getStores();
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const session = {
    userId: userRecord.id,
    username: userRecord.username,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  await sessionsStore.setJSON(`${SESSION_KEY_PREFIX}${hashToken(token)}`, session);
  return token;
};

const parseBearer = (authorizationHeader) => {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') return null;
  return token.trim();
};

export const requireSession = async (request) => {
  const token = parseBearer(request.headers.get('authorization'));
  if (!token) return null;

  const tokenHash = hashToken(token);
  const { sessionsStore } = getStores();
  const session = await sessionsStore.getJSON(`${SESSION_KEY_PREFIX}${tokenHash}`);
  if (!session) return null;

  if (typeof session.expiresAt !== 'number' || session.expiresAt < Date.now()) {
    await sessionsStore.delete(`${SESSION_KEY_PREFIX}${tokenHash}`);
    return null;
  }

  const user = await getUserById(session.userId);
  if (!user) {
    await sessionsStore.delete(`${SESSION_KEY_PREFIX}${tokenHash}`);
    return null;
  }

  if (session.expiresAt - Date.now() < SESSION_TTL_MS / 2) {
    await sessionsStore.setJSON(`${SESSION_KEY_PREFIX}${tokenHash}`, {
      ...session,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
  }

  return {
    tokenHash,
    session,
    userRecord: user,
    publicUser: makeUserPublic(user),
  };
};

export const revokeSessionByTokenHash = async (tokenHash) => {
  const { sessionsStore } = getStores();
  await sessionsStore.delete(`${SESSION_KEY_PREFIX}${tokenHash}`);
};

export const getAccountData = async (userId) => {
  const { dataStore } = getStores();
  return dataStore.getJSON(`${ACCOUNT_KEY_PREFIX}${userId}`);
};

export const saveAccountData = async (userId, data) => {
  const { dataStore } = getStores();
  await dataStore.setJSON(`${ACCOUNT_KEY_PREFIX}${userId}`, data);
};

export const attachPublicUserToData = (accountData, publicUser) => {
  const patched = sanitizeAccountPayload(accountData, publicUser);
  return patched;
};

export const tokenHashFromRequest = (request) => {
  const token = parseBearer(request.headers.get('authorization'));
  if (!token) return null;
  return hashToken(token);
};
