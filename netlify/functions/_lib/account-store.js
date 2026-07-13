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
const DISPLAY_NAME_MAX_LENGTH = 48;

const USERNAME_REGEX = /^[A-Za-z0-9_.-]{3,32}$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 256;

const DEFAULT_SETTINGS = {
  timerPreset: 'classic',
  workDuration: 1500,
  shortBreakDuration: 300,
  longBreakDuration: 900,
  longBreakInterval: 4,
  twoInARowMode: false,
  disableBlur: true,
  alarmSound: 'bell',
  focusSound: 'off',
  focusSoundVolume: 100,
  themeMode: 'dark',
};

const POMODORO_COMPLETE_REASON = 'pomodoro complete';
const MINI_POMODORO_COMPLETE_REASON = 'mini-pomodoro complete';

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

const cleanDisplayName = (value, fallback) => {
  const trimmed = cleanString(value, fallback).trim();
  const next = trimmed || cleanString(fallback).trim();
  return next.slice(0, DISPLAY_NAME_MAX_LENGTH);
};

const toNonNegativeInt = (value, fallback = 0) => {
  return Math.max(0, Math.floor(clampNumber(value, fallback)));
};

const normalizeRevision = (value, fallback = 0) => {
  return toNonNegativeInt(value, fallback);
};

const getDateKey = (date) => {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getLocalDateKeyFromIso = (iso) => {
  if (typeof iso !== 'string') return null;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return getDateKey(dt);
};

const parseDateKey = (value) => {
  if (typeof value !== 'string') return null;
  const parts = value.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
};

const getDayDiff = (fromKey, toKey) => {
  const from = parseDateKey(fromKey);
  const to = parseDateKey(toKey);
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
};

const isPauseCreditedWorkLog = (entry) => {
  if (!entry || entry.type !== 'work') return false;
  const reason = cleanString(entry.reason).trim().toLowerCase();
  return reason.startsWith('paused') || reason.includes('pause credit');
};

const getPomodoroEquivalentWeight = (entry) => {
  if (!entry || entry.type !== 'work') return 0;
  const reason = cleanString(entry.reason).trim().toLowerCase();
  if (reason === POMODORO_COMPLETE_REASON) return 1;
  if (reason === MINI_POMODORO_COMPLETE_REASON) return 0.5;
  return 0;
};

const getSessionWorkMinutes = (session) => {
  const mins = Number(session?.stats?.totalWorkMinutes || 0);
  return Number.isFinite(mins) && mins > 0 ? mins : 0;
};

const getSessionPomodoros = (session) => {
  const pomos = Number(session?.stats?.pomosCompleted || 0);
  if (Number.isFinite(pomos) && pomos >= 0) return pomos;
  const miniPomos = Number(session?.stats?.miniPomosCompleted || 0);
  return Number.isFinite(miniPomos) && miniPomos > 0 ? miniPomos * 0.5 : 0;
};

const getResolvedCategoryName = (entry, categoryMap) => {
  if (typeof entry?.categoryId === 'number' && Number.isFinite(entry.categoryId)) {
    const liveName = categoryMap.get(entry.categoryId);
    if (liveName) return liveName;
  }
  const snapshotName = cleanString(entry?.categoryName);
  return snapshotName || 'Uncategorized';
};

export const calculateLifetimeStatsFromAccountData = (sessions, logs, categories) => {
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const safeLogs = Array.isArray(logs) ? logs : [];
  const safeCategories = Array.isArray(categories) ? categories : [];

  const productiveLogs = safeLogs.filter((entry) => {
    if (!entry || entry.type !== 'work') return false;
    if (!Number.isFinite(entry.duration) || entry.duration <= 0) return false;
    return !isPauseCreditedWorkLog(entry);
  });
  const completedPomodoroWeightFromLogs = productiveLogs.reduce(
    (acc, entry) => acc + getPomodoroEquivalentWeight(entry),
    0,
  );

  const workSecondsFromLogs = productiveLogs.reduce((acc, entry) => acc + Math.max(0, entry.duration), 0);
  const productiveLogDateKeys = new Set();
  productiveLogs.forEach((entry) => {
    const key = getLocalDateKeyFromIso(entry.start);
    if (key) productiveLogDateKeys.add(key);
  });
  const fallbackSessions = safeSessions.filter((session) => {
    const sessionDateKey = getLocalDateKeyFromIso(session?.startTime);
    return !sessionDateKey || !productiveLogDateKeys.has(sessionDateKey);
  });
  const workMinutesFromFallbackSessions = fallbackSessions.reduce((acc, session) => acc + getSessionWorkMinutes(session), 0);

  const categoryMap = new Map();
  safeCategories.forEach((category) => {
    if (typeof category?.id === 'number' && Number.isFinite(category.id) && category.name) {
      categoryMap.set(category.id, category.name);
    }
  });

  const categoryBreakdown = {};
  productiveLogs.forEach((entry) => {
    const minutes = Math.max(0, entry.duration / 60);
    if (minutes <= 0) return;
    const key = getResolvedCategoryName(entry, categoryMap);
    categoryBreakdown[key] = (categoryBreakdown[key] || 0) + minutes;
  });
  fallbackSessions.forEach((session) => {
    const categoryDetails = Array.isArray(session?.stats?.categoryDetails) ? session.stats.categoryDetails : [];
    if (categoryDetails.length > 0) {
      categoryDetails.forEach((detail) => {
        const safeMinutes = Number(detail?.minutes);
        if (!Number.isFinite(safeMinutes) || safeMinutes <= 0) return;
        const key = getResolvedCategoryName(detail, categoryMap);
        categoryBreakdown[key] = (categoryBreakdown[key] || 0) + safeMinutes;
      });
      return;
    }
    const categoryStats = session?.stats?.categoryStats;
    if (!categoryStats || typeof categoryStats !== 'object') return;
    Object.entries(categoryStats).forEach(([name, minutes]) => {
      const safeMinutes = Number(minutes);
      if (!name || !Number.isFinite(safeMinutes) || safeMinutes <= 0) return;
      categoryBreakdown[name] = (categoryBreakdown[name] || 0) + safeMinutes;
    });
  });

  const productiveDates = new Set();
  productiveLogs.forEach((entry) => {
    const key = getLocalDateKeyFromIso(entry.start);
    if (key) productiveDates.add(key);
  });
  fallbackSessions.forEach((session) => {
    const mins = getSessionWorkMinutes(session);
    if (mins <= 0) return;
    const key = getLocalDateKeyFromIso(session?.startTime);
    if (key) productiveDates.add(key);
  });

  const sortedDates = Array.from(productiveDates).sort();

  let bestStreak = 0;
  let runningStreak = 0;
  for (let i = 0; i < sortedDates.length; i += 1) {
    if (i === 0) {
      runningStreak = 1;
    } else {
      const diff = getDayDiff(sortedDates[i - 1], sortedDates[i]);
      runningStreak = diff === 1 ? runningStreak + 1 : 1;
    }
    if (runningStreak > bestStreak) bestStreak = runningStreak;
  }

  let currentStreak = 0;
  if (sortedDates.length > 0) {
    const todayKey = getDateKey(new Date());
    const lastKey = sortedDates[sortedDates.length - 1];
    const diffToToday = getDayDiff(lastKey, todayKey);
    if (diffToToday !== null && diffToToday <= 1) {
      currentStreak = 1;
      for (let i = sortedDates.length - 1; i > 0; i -= 1) {
        const diff = getDayDiff(sortedDates[i - 1], sortedDates[i]);
        if (diff === 1) currentStreak += 1;
        else break;
      }
    }
  }

  return {
    ...defaultLifetimeStats(),
    totalFocusHours: (workSecondsFromLogs / 3600) + (workMinutesFromFallbackSessions / 60),
    totalSessions: safeSessions.length,
    totalPomos: completedPomodoroWeightFromLogs + fallbackSessions.reduce((acc, session) => acc + getSessionPomodoros(session), 0),
    activeDays: sortedDates.length,
    currentStreak,
    bestStreak,
    lastActiveDate: sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : null,
    categoryBreakdown,
  };
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
  if (value.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
};

const getStores = () => ({
  usersStore: getStore(USERS_STORE_NAME),
  dataStore: getStore(DATA_STORE_NAME),
  sessionsStore: getStore(SESSIONS_STORE_NAME),
});

const getBlobJSON = async (store, key) => {
  if (typeof store?.getJSON === 'function') {
    return store.getJSON(key);
  }
  if (typeof store?.get === 'function') {
    return store.get(key, { type: 'json' });
  }
  throw new TypeError('Blob store does not support JSON reads.');
};

const setBlobJSON = async (store, key, value) => {
  if (typeof store?.setJSON === 'function') {
    return store.setJSON(key, value);
  }
  if (typeof store?.set === 'function') {
    return store.set(key, JSON.stringify(value), {
      contentType: 'application/json; charset=utf-8',
    });
  }
  throw new TypeError('Blob store does not support JSON writes.');
};

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

export const sanitizeAccountPayload = (payload, publicUser, options = {}) => {
  const source = payload && typeof payload === 'object' ? payload : {};
  const safeTasks = Array.isArray(source.tasks) ? source.tasks : [];
  const safeSessions = Array.isArray(source.pastSessions) ? source.pastSessions : [];
  const safeCategories = Array.isArray(source.categories) ? source.categories : [];
  const safeLogs = Array.isArray(source.logs) ? source.logs : [];
  const safeRevision = normalizeRevision(options.revision ?? source.revision, 0);
  const safeUpdatedAt = typeof options.updatedAt === 'string' ? options.updatedAt : new Date().toISOString();
  const lifetimeStats = calculateLifetimeStatsFromAccountData(safeSessions, safeLogs, safeCategories);
  const safeUser = {
    username: publicUser.username,
    joinedAt: publicUser.joinedAt,
    lifetimeStats,
  };

  const sanitized = {
    revision: safeRevision,
    schemaVersion: 2,
    runtime: source.runtime && typeof source.runtime === 'object' ? source.runtime : undefined,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(source.settings && typeof source.settings === 'object' ? source.settings : {}),
    },
    tasks: safeTasks,
    pastSessions: safeSessions,
    categories: safeCategories,
    logs: safeLogs,
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
    userName: cleanDisplayName(source.userName, safeUser.username),
    user: safeUser,
    updatedAt: safeUpdatedAt,
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
}, publicUser, { revision: 1 });

export const getUserByUsername = async (normalizedUsername) => {
  const { usersStore } = getStores();
  return getBlobJSON(usersStore, `${USER_KEY_PREFIX}${normalizedUsername}`);
};

export const getUserById = async (userId) => {
  const { usersStore } = getStores();
  return getBlobJSON(usersStore, `${USER_ID_KEY_PREFIX}${userId}`);
};

export const createUser = async (username, password) => {
  const { usersStore } = getStores();
  const normalized = normalizeUsername(username);
  const existing = await getBlobJSON(usersStore, `${USER_KEY_PREFIX}${normalized}`);
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
    setBlobJSON(usersStore, `${USER_KEY_PREFIX}${normalized}`, record),
    setBlobJSON(usersStore, `${USER_ID_KEY_PREFIX}${record.id}`, record),
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
    setBlobJSON(usersStore, `${USER_KEY_PREFIX}${withUpdated.normalizedUsername}`, withUpdated),
    setBlobJSON(usersStore, `${USER_ID_KEY_PREFIX}${withUpdated.id}`, withUpdated),
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
  await setBlobJSON(sessionsStore, `${SESSION_KEY_PREFIX}${hashToken(token)}`, session);
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
  const session = await getBlobJSON(sessionsStore, `${SESSION_KEY_PREFIX}${tokenHash}`);
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
    await setBlobJSON(sessionsStore, `${SESSION_KEY_PREFIX}${tokenHash}`, {
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
  return getBlobJSON(dataStore, `${ACCOUNT_KEY_PREFIX}${userId}`);
};

export const saveAccountData = async (userId, data) => {
  const { dataStore } = getStores();
  await setBlobJSON(dataStore, `${ACCOUNT_KEY_PREFIX}${userId}`, data);
};

export const attachPublicUserToData = (accountData, publicUser) => {
  const patched = sanitizeAccountPayload(accountData, publicUser);
  return patched;
};

export const buildPublicUserFromAccountData = (publicUser, accountData) => ({
  ...publicUser,
  lifetimeStats: accountData?.user?.lifetimeStats || publicUser.lifetimeStats || defaultLifetimeStats(),
});

export const getAccountRevision = (accountData) => normalizeRevision(accountData?.revision, 0);

export const tokenHashFromRequest = (request) => {
  const token = parseBearer(request.headers.get('authorization'));
  if (!token) return null;
  return hashToken(token);
};
