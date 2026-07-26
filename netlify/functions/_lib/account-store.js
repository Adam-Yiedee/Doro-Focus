import { getStore } from '@netlify/blobs';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const USERS_STORE_NAME = 'doro_accounts_users_v1';
const DATA_STORE_NAME = 'doro_accounts_data_v1';
const SESSIONS_STORE_NAME = 'doro_accounts_sessions_v1';
const FOCUS_FRIENDS_STORE_NAME = 'doro_focus_friends_v1';

const USER_KEY_PREFIX = 'user_name:';
const USER_ID_KEY_PREFIX = 'user_id:';
const ACCOUNT_KEY_PREFIX = 'account:';
const SESSION_KEY_PREFIX = 'session:';
const FOCUS_FRIENDS_KEY_PREFIX = 'focus_friends:';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const MAX_ACCOUNT_BYTES = 2_000_000;
const DISPLAY_NAME_MAX_LENGTH = 48;

const USERNAME_REGEX = /^[A-Za-z0-9_.-]{3,32}$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 256;
const FRIEND_MESSAGE_MAX_LENGTH = 160;
const FOCUS_FRIENDS_LIMIT = 200;
const FOCUS_FRIEND_REQUEST_LIMIT = 100;
const FOCUS_FRIEND_INBOX_LIMIT = 50;
const FOCUS_FRIEND_OFFLINE_AFTER_MS = 1000 * 60 * 60 * 12;
const localDevStores = new Map();

const DEBUG_FOCUS_FRIEND_ACCOUNTS = [
  {
    username: 'master',
    password: 'master',
    displayName: 'Master',
    categoryName: 'Debug Build',
    categoryColor: '#60A5FA',
    categoryIcon: 'target',
    taskName: 'Review Focus Friends',
    workTime: 1420,
    pomodoroCount: 1,
    presence: 'focusing',
  },
  {
    username: 'master2',
    password: 'master2',
    displayName: 'Master 2',
    categoryName: 'Friend Testing',
    categoryColor: '#34D399',
    categoryIcon: 'heart',
    taskName: 'Test friend activity',
    workTime: 1180,
    pomodoroCount: 4,
    presence: 'focusing',
  },
  {
    username: 'master3',
    password: 'master3',
    displayName: 'Master 3',
    categoryName: 'Deep Work',
    categoryColor: '#FBBF24',
    categoryIcon: 'brain',
    taskName: 'Review request flow',
    workTime: 960,
    pomodoroCount: 2,
    presence: 'focusing',
  },
  {
    username: 'master4',
    password: 'master4',
    displayName: 'Master 4',
    categoryName: 'Pair Focus',
    categoryColor: '#A78BFA',
    categoryIcon: 'user',
    taskName: 'Check session invites',
    workTime: 720,
    pomodoroCount: 0,
    presence: 'idle',
  },
  {
    username: 'master5',
    password: 'master5',
    displayName: 'Master 5',
    categoryName: 'Encouragement',
    categoryColor: '#FB7185',
    categoryIcon: 'sparkles',
    taskName: 'Send friend nudges',
    workTime: 540,
    pomodoroCount: 0,
    presence: 'offline',
  },
];

const DEFAULT_SETTINGS = {
  timerPreset: 'classic',
  workDuration: 1500,
  shortBreakDuration: 300,
  longBreakDuration: 900,
  longBreakInterval: 4,
  twoInARowMode: false,
  disableBlur: true,
  alarmSound: 'bell',
  twoInARowStartSound: 'chime',
  focusSound: 'off',
  focusSoundVolume: 100,
  themeMode: 'dark',
};

const POMODORO_COMPLETE_REASON = 'pomodoro complete';
const MINI_POMODORO_COMPLETE_REASON = 'mini-pomodoro complete';
const ACCOUNT_STATS_POMODORO_SECONDS = 25 * 60;

const defaultLifetimeStats = () => ({
  totalFocusHours: 0,
  totalSessionHours: 0,
  manualFocusHours: 0,
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

const isManualFocusLog = (entry) => {
  return entry?.type === 'work' && entry.source === 'manual';
};

const isTimerSessionDurationLog = (entry) => {
  if (!entry || entry.source === 'manual') return false;
  if (entry.type === 'break') return true;
  return entry.type === 'work' && !isPauseCreditedWorkLog(entry);
};

const getPomodoroEquivalentWeight = (entry) => {
  if (!entry || entry.type !== 'work') return 0;

  const durationSeconds = clampNumber(entry.duration, 0);
  if (durationSeconds > 0) return durationSeconds / ACCOUNT_STATS_POMODORO_SECONDS;

  const reason = cleanString(entry.reason).trim().toLowerCase();
  if (reason === POMODORO_COMPLETE_REASON) return 1;
  if (reason === MINI_POMODORO_COMPLETE_REASON) return 0.5;
  return 0;
};

const getStartOfLocalDayMs = (ms) => {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const getLogEndMs = (entry) => {
  const startMs = Date.parse(entry?.start);
  let endMs = Date.parse(entry?.end);
  if (Number.isFinite(endMs)) return endMs;
  if (!Number.isFinite(startMs) || !Number.isFinite(entry?.duration) || entry.duration <= 0) return null;
  endMs = startMs + (entry.duration * 1000);
  return Number.isFinite(endMs) ? endMs : null;
};

const getTodayPomodoroCountFromLogs = (logs, nowMs = Date.now()) => {
  if (!Array.isArray(logs) || logs.length === 0) return 0;
  const todayStartMs = getStartOfLocalDayMs(nowMs);
  const tomorrowStartMs = todayStartMs + (24 * 60 * 60 * 1000);

  return logs.reduce((total, entry) => {
    if (!entry || entry.type !== 'work' || isPauseCreditedWorkLog(entry)) return total;
    const endMs = getLogEndMs(entry);
    if (endMs === null || endMs < todayStartMs || endMs >= tomorrowStartMs) return total;
    return total + getPomodoroEquivalentWeight(entry);
  }, 0);
};

const getSessionWorkMinutes = (session) => {
  const mins = Number(session?.stats?.totalWorkMinutes || 0);
  return Number.isFinite(mins) && mins > 0 ? mins : 0;
};

const getSessionTotalMinutes = (session) => {
  const workMinutes = Number(session?.stats?.totalWorkMinutes || 0);
  const breakMinutes = Number(session?.stats?.totalBreakMinutes || 0);
  const totalMinutes = Math.max(0, Number.isFinite(workMinutes) ? workMinutes : 0)
    + Math.max(0, Number.isFinite(breakMinutes) ? breakMinutes : 0);
  return totalMinutes > 0 ? totalMinutes : 0;
};

const getSessionPomodoros = (session) => {
  const miniPomos = Number(session?.stats?.miniPomosCompleted || 0);
  if (Number.isFinite(miniPomos) && miniPomos > 0) {
    const workMinutes = getSessionWorkMinutes(session);
    if (workMinutes > 0) return workMinutes / (ACCOUNT_STATS_POMODORO_SECONDS / 60);
  }
  const pomos = Number(session?.stats?.pomosCompleted || 0);
  if (Number.isFinite(pomos) && pomos >= 0) return pomos;
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
  const manualWorkSecondsFromLogs = productiveLogs.reduce((acc, entry) => (
    acc + (isManualFocusLog(entry) ? Math.max(0, entry.duration) : 0)
  ), 0);
  const timerSessionDurationLogs = safeLogs.filter((entry) => {
    if (!entry || !Number.isFinite(entry.duration) || entry.duration <= 0) return false;
    return isTimerSessionDurationLog(entry);
  });
  const sessionSecondsFromLogs = timerSessionDurationLogs.reduce((acc, entry) => acc + Math.max(0, entry.duration), 0);
  const productiveLogDateKeys = new Set();
  productiveLogs.forEach((entry) => {
    if (isManualFocusLog(entry)) return;
    const key = getLocalDateKeyFromIso(entry.start);
    if (key) productiveLogDateKeys.add(key);
  });
  const timerSessionLogDateKeys = new Set();
  timerSessionDurationLogs.forEach((entry) => {
    const key = getLocalDateKeyFromIso(entry.start);
    if (key) timerSessionLogDateKeys.add(key);
  });
  const fallbackSessions = safeSessions.filter((session) => {
    const sessionDateKey = getLocalDateKeyFromIso(session?.startTime);
    return !sessionDateKey || !productiveLogDateKeys.has(sessionDateKey);
  });
  const totalTimeFallbackSessions = safeSessions.filter((session) => {
    const sessionDateKey = getLocalDateKeyFromIso(session?.startTime);
    return !sessionDateKey || !timerSessionLogDateKeys.has(sessionDateKey);
  });
  const workMinutesFromFallbackSessions = fallbackSessions.reduce((acc, session) => acc + getSessionWorkMinutes(session), 0);
  const totalSessionMinutesFromFallbackSessions = totalTimeFallbackSessions.reduce(
    (acc, session) => acc + getSessionTotalMinutes(session),
    0,
  );

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
    totalSessionHours: (sessionSecondsFromLogs / 3600) + (totalSessionMinutesFromFallbackSessions / 60),
    manualFocusHours: manualWorkSecondsFromLogs / 3600,
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

const createLocalDevStore = (name) => {
  if (!localDevStores.has(name)) {
    localDevStores.set(name, new Map());
  }
  const state = localDevStores.get(name);
  return {
    async get(key, options = {}) {
      if (!state.has(key)) return null;
      const value = structuredClone(state.get(key));
      if (options?.type === 'json') return value;
      return JSON.stringify(value);
    },
    async getJSON(key) {
      return state.has(key) ? structuredClone(state.get(key)) : null;
    },
    async set(key, value) {
      try {
        state.set(key, JSON.parse(value));
      } catch {
        state.set(key, value);
      }
    },
    async setJSON(key, value) {
      state.set(key, structuredClone(value));
    },
    async delete(key) {
      state.delete(key);
    },
  };
};

const getConfiguredStore = (name) => {
  try {
    return getStore(name);
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      return createLocalDevStore(name);
    }
    throw error;
  }
};

const getStores = () => ({
  usersStore: getConfiguredStore(USERS_STORE_NAME),
  dataStore: getConfiguredStore(DATA_STORE_NAME),
  sessionsStore: getConfiguredStore(SESSIONS_STORE_NAME),
  focusFriendsStore: getConfiguredStore(FOCUS_FRIENDS_STORE_NAME),
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

const makeFocusFriendId = (prefix) => `${prefix}_${randomBytes(12).toString('hex')}`;

const defaultFocusFriendsData = (userId) => ({
  version: 1,
  userId,
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  inbox: [],
  presence: null,
  updatedAt: new Date().toISOString(),
});

const normalizeFriendRelation = (value) => {
  if (!value || typeof value !== 'object') return null;
  if (!value.userId || !value.username) return null;
  return {
    userId: cleanString(value.userId),
    username: normalizeUsername(value.username),
    friendsSince: cleanString(value.friendsSince, new Date().toISOString()),
  };
};

const normalizeFocusFriendRequestRecord = (value) => {
  if (!value || typeof value !== 'object') return null;
  if (!value.id || !value.fromUserId || !value.toUserId || !value.fromUsername || !value.toUsername) return null;
  return {
    id: cleanString(value.id),
    fromUserId: cleanString(value.fromUserId),
    fromUsername: normalizeUsername(value.fromUsername),
    fromDisplayName: cleanDisplayName(value.fromDisplayName, value.fromUsername),
    toUserId: cleanString(value.toUserId),
    toUsername: normalizeUsername(value.toUsername),
    toDisplayName: cleanDisplayName(value.toDisplayName, value.toUsername),
    createdAt: cleanString(value.createdAt, new Date().toISOString()),
  };
};

const normalizeFocusFriendActionRecord = (value) => {
  if (!value || typeof value !== 'object') return null;
  if (!value.id || !value.fromUserId || !value.toUserId || !value.fromUsername || !value.toUsername) return null;
  const type = value.type === 'join-request'
    ? 'join-request'
    : value.type === 'join-invite'
      ? 'join-invite'
      : value.type === 'encouragement'
        ? 'encouragement'
        : null;
  if (!type) return null;
  const readAt = typeof value.readAt === 'string' && value.readAt ? value.readAt : null;
  return {
    id: cleanString(value.id),
    type,
    fromUserId: cleanString(value.fromUserId),
    fromUsername: normalizeUsername(value.fromUsername),
    fromDisplayName: cleanDisplayName(value.fromDisplayName, value.fromUsername),
    toUserId: cleanString(value.toUserId),
    toUsername: normalizeUsername(value.toUsername),
    message: cleanString(value.message).trim().slice(0, FRIEND_MESSAGE_MAX_LENGTH),
    sessionId: typeof value.sessionId === 'string' && value.sessionId.trim()
      ? value.sessionId.trim().toUpperCase().slice(0, 64)
      : null,
    createdAt: cleanString(value.createdAt, new Date().toISOString()),
    readAt,
  };
};

const normalizeRuntimeSnapshot = (value) => {
  if (!isRuntimeSnapshot(value)) return null;
  const phase = value.phase === 'running-work'
    || value.phase === 'running-break'
    || value.phase === 'all-pause'
    || value.phase === 'grace'
    || value.phase === 'idle'
    ? value.phase
    : 'idle';
  return {
    version: 2,
    updatedAtMs: Number.isFinite(Number(value.updatedAtMs)) ? Math.max(0, Number(value.updatedAtMs)) : Date.now(),
    sourceTabId: cleanString(value.sourceTabId, 'focus-friends').slice(0, 80),
    phase,
    phaseStartedAtMs: value.phaseStartedAtMs === null || Number.isFinite(Number(value.phaseStartedAtMs))
      ? (value.phaseStartedAtMs === null ? null : Math.max(0, Number(value.phaseStartedAtMs)))
      : null,
    phaseStartWorkTime: clampNumber(value.phaseStartWorkTime, DEFAULT_SETTINGS.workDuration),
    phaseStartBreakTime: clampNumber(value.phaseStartBreakTime, 0),
    phaseStartAllPauseTime: clampNumber(value.phaseStartAllPauseTime, 0),
    phaseStartGraceTotal: clampNumber(value.phaseStartGraceTotal, 0),
    activityStartIso: typeof value.activityStartIso === 'string' || value.activityStartIso === null
      ? value.activityStartIso
      : null,
  };
};

const normalizeTimerSpectatorState = (value, fallbackHostName) => {
  if (!value || typeof value !== 'object') return null;
  const runtime = normalizeRuntimeSnapshot(value.runtime);
  const updatedAtMs = Number.isFinite(Number(value.updatedAtMs))
    ? Math.max(0, Number(value.updatedAtMs))
    : runtime?.updatedAtMs || Date.now();
  return {
    version: 1,
    hostName: cleanDisplayName(value.hostName, fallbackHostName),
    activeMode: value.activeMode === 'break' ? 'break' : 'work',
    timerStarted: Boolean(value.timerStarted),
    isIdle: typeof value.isIdle === 'boolean' ? value.isIdle : true,
    workTime: clampNumber(value.workTime, DEFAULT_SETTINGS.workDuration),
    breakTime: clampNumber(value.breakTime, 0),
    pomodoroCount: clampNumber(value.pomodoroCount, 0),
    sessionStartTime: typeof value.sessionStartTime === 'string' || value.sessionStartTime === null
      ? value.sessionStartTime
      : null,
    todayPomodoroCount: Number.isFinite(Number(value.todayPomodoroCount))
      ? Math.max(0, Number(value.todayPomodoroCount))
      : undefined,
    allPauseActive: Boolean(value.allPauseActive),
    allPauseTime: clampNumber(value.allPauseTime, 0),
    graceOpen: Boolean(value.graceOpen),
    graceContext: value.graceContext === 'afterWork' || value.graceContext === 'afterBreak' ? value.graceContext : null,
    activeTaskName: typeof value.activeTaskName === 'string' && value.activeTaskName.trim()
      ? value.activeTaskName.trim().slice(0, 80)
      : null,
    activeCategoryName: typeof value.activeCategoryName === 'string' && value.activeCategoryName.trim()
      ? value.activeCategoryName.trim().slice(0, 60)
      : undefined,
    activeCategoryColor: typeof value.activeCategoryColor === 'string' && value.activeCategoryColor.trim()
      ? value.activeCategoryColor.trim().slice(0, 40)
      : undefined,
    activeCategoryIcon: typeof value.activeCategoryIcon === 'string' && value.activeCategoryIcon.trim()
      ? value.activeCategoryIcon.trim().slice(0, 40)
      : undefined,
    activeColor: typeof value.activeColor === 'string' && value.activeColor.trim()
      ? value.activeColor.trim().slice(0, 40)
      : undefined,
    projectedFinishEndMs: value.projectedFinishEndMs === null || Number.isFinite(Number(value.projectedFinishEndMs))
      ? (value.projectedFinishEndMs === null ? null : Math.max(0, Number(value.projectedFinishEndMs)))
      : null,
    settings: pickTimerSpectatorSettings(value.settings),
    runtime,
    updatedAtMs,
  };
};

const normalizeFocusFriendPresenceRecord = (value, fallbackHostName) => {
  if (!value || typeof value !== 'object') return null;
  const timer = normalizeTimerSpectatorState(value.timer, fallbackHostName);
  if (!timer) return null;
  return {
    updatedAt: cleanString(value.updatedAt, new Date(timer.updatedAtMs || Date.now()).toISOString()),
    timer,
  };
};

const normalizeFocusFriendsData = (raw, userId) => {
  const source = raw && typeof raw === 'object' ? raw : defaultFocusFriendsData(userId);
  const dedupeById = (items) => {
    const seen = new Set();
    return items.filter((item) => {
      if (!item?.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  };
  const friendMap = new Map();
  (Array.isArray(source.friends) ? source.friends : [])
    .map(normalizeFriendRelation)
    .filter(Boolean)
    .forEach((friend) => {
      if (friend.userId !== userId) friendMap.set(friend.userId, friend);
    });

  return {
    version: 1,
    userId,
    friends: Array.from(friendMap.values()).slice(0, FOCUS_FRIENDS_LIMIT),
    incomingRequests: dedupeById((Array.isArray(source.incomingRequests) ? source.incomingRequests : [])
      .map(normalizeFocusFriendRequestRecord)
      .filter(Boolean))
      .slice(0, FOCUS_FRIEND_REQUEST_LIMIT),
    outgoingRequests: dedupeById((Array.isArray(source.outgoingRequests) ? source.outgoingRequests : [])
      .map(normalizeFocusFriendRequestRecord)
      .filter(Boolean))
      .slice(0, FOCUS_FRIEND_REQUEST_LIMIT),
    inbox: dedupeById((Array.isArray(source.inbox) ? source.inbox : [])
      .map(normalizeFocusFriendActionRecord)
      .filter(Boolean))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, FOCUS_FRIEND_INBOX_LIMIT),
    presence: normalizeFocusFriendPresenceRecord(source.presence, 'Focus Friend'),
    updatedAt: cleanString(source.updatedAt, new Date().toISOString()),
  };
};

export const getFocusFriendsData = async (userId) => {
  const { focusFriendsStore } = getStores();
  const raw = await getBlobJSON(focusFriendsStore, `${FOCUS_FRIENDS_KEY_PREFIX}${userId}`);
  return normalizeFocusFriendsData(raw, userId);
};

export const saveFocusFriendsData = async (userId, data) => {
  const { focusFriendsStore } = getStores();
  const normalized = normalizeFocusFriendsData(data, userId);
  normalized.updatedAt = new Date().toISOString();
  await setBlobJSON(focusFriendsStore, `${FOCUS_FRIENDS_KEY_PREFIX}${userId}`, normalized);
  return normalized;
};

const getCurrentAccountDisplayName = async (userRecord) => {
  const accountData = await getAccountData(userRecord.id);
  return cleanDisplayName(accountData?.userName, userRecord.username);
};

const toPublicFocusFriendRequest = (request) => ({
  id: request.id,
  fromUsername: request.fromUsername,
  fromDisplayName: request.fromDisplayName,
  toUsername: request.toUsername,
  toDisplayName: request.toDisplayName,
  createdAt: request.createdAt,
});

const toPublicFocusFriendAction = (action) => ({
  id: action.id,
  type: action.type,
  fromUsername: action.fromUsername,
  fromDisplayName: action.fromDisplayName,
  toUsername: action.toUsername,
  message: action.message,
  sessionId: action.sessionId || null,
  createdAt: action.createdAt,
  readAt: action.readAt || null,
});

const findActiveTaskContext = (tasks, parentColor, parentCategoryId = null) => {
  if (!Array.isArray(tasks)) return { task: null, color: parentColor, categoryId: parentCategoryId };
  for (const task of tasks) {
    if (!task || typeof task !== 'object') continue;
    const currentColor = typeof task.color === 'string' && task.color.trim() ? task.color.trim() : parentColor;
    const currentCategoryId = typeof task.categoryId === 'number' && Number.isFinite(task.categoryId)
      ? task.categoryId
      : parentCategoryId;
    if (task.selected) {
      return { task, color: currentColor, categoryId: currentCategoryId };
    }
    const nested = findActiveTaskContext(task.subtasks, currentColor, currentCategoryId);
    if (nested.task) return nested;
  }
  return { task: null, color: parentColor, categoryId: parentCategoryId };
};

const isRuntimeSnapshot = (value) => (
  !!value
  && typeof value === 'object'
  && value.version === 2
  && typeof value.updatedAtMs === 'number'
  && typeof value.phase === 'string'
);

const pickTimerSpectatorSettings = (settings) => ({
  workDuration: Number.isFinite(Number(settings?.workDuration)) ? Number(settings.workDuration) : 25 * 60,
  shortBreakDuration: Number.isFinite(Number(settings?.shortBreakDuration)) ? Number(settings.shortBreakDuration) : 5 * 60,
  longBreakDuration: Number.isFinite(Number(settings?.longBreakDuration)) ? Number(settings.longBreakDuration) : 15 * 60,
  longBreakInterval: Number.isFinite(Number(settings?.longBreakInterval)) ? Number(settings.longBreakInterval) : 4,
  timerPreset: settings?.timerPreset === 'compact' || settings?.timerPreset === 'focus' || settings?.timerPreset === 'custom' ? settings.timerPreset : 'classic',
  twoInARowMode: Boolean(settings?.twoInARowMode),
});

const getAccountUpdatedAtMs = (accountData) => {
  const runtimeUpdatedAt = isRuntimeSnapshot(accountData?.runtime) ? accountData.runtime.updatedAtMs : 0;
  const payloadUpdatedAt = typeof accountData?.updatedAt === 'string' ? Date.parse(accountData.updatedAt) : 0;
  return Math.max(
    Number.isFinite(runtimeUpdatedAt) ? runtimeUpdatedAt : 0,
    Number.isFinite(payloadUpdatedAt) ? payloadUpdatedAt : 0,
  );
};

const getPresenceStatus = (accountData, updatedAtMs) => {
  if (!updatedAtMs || Date.now() - updatedAtMs > FOCUS_FRIEND_OFFLINE_AFTER_MS) return 'offline';
  const runtime = isRuntimeSnapshot(accountData?.runtime) ? accountData.runtime : null;
  if (runtime?.phase === 'running-work') return 'focusing';
  if (runtime?.phase === 'running-break') return 'break';
  if (runtime?.phase === 'all-pause') return 'paused';
  if (runtime?.phase === 'grace') return 'grace';
  if (accountData?.allPauseActive) return 'paused';
  if (accountData?.graceOpen) return 'grace';
  if (accountData?.timerStarted && !accountData?.isIdle) {
    return accountData?.activeMode === 'break' ? 'break' : 'focusing';
  }
  return 'idle';
};

const getPresenceStatusFromTimer = (timer) => {
  const updatedAtMs = Number.isFinite(Number(timer?.updatedAtMs)) ? Number(timer.updatedAtMs) : 0;
  if (!updatedAtMs || Date.now() - updatedAtMs > FOCUS_FRIEND_OFFLINE_AFTER_MS) return 'offline';
  const runtime = isRuntimeSnapshot(timer?.runtime) ? timer.runtime : null;
  if (runtime?.phase === 'running-work') return 'focusing';
  if (runtime?.phase === 'running-break') return 'break';
  if (runtime?.phase === 'all-pause') return 'paused';
  if (runtime?.phase === 'grace') return 'grace';
  if (timer?.allPauseActive) return 'paused';
  if (timer?.graceOpen) return 'grace';
  if (timer?.timerStarted && !timer?.isIdle) {
    return timer?.activeMode === 'break' ? 'break' : 'focusing';
  }
  return 'idle';
};

const buildFocusFriendPresenceFromTimer = (timer) => {
  const updatedAtMs = Number.isFinite(Number(timer?.updatedAtMs)) ? Number(timer.updatedAtMs) : 0;
  const status = getPresenceStatusFromTimer(timer);
  if (!timer || status === 'offline') {
    return { status, updatedAtMs: updatedAtMs || null, timer: null };
  }
  return {
    status,
    updatedAtMs: updatedAtMs || null,
    timer,
  };
};

const buildFocusFriendPresence = (userRecord, accountData) => {
  const updatedAtMs = getAccountUpdatedAtMs(accountData);
  const status = getPresenceStatus(accountData, updatedAtMs);
  if (!accountData || status === 'offline') {
    return { status, updatedAtMs: updatedAtMs || null, timer: null };
  }

  const activeContext = findActiveTaskContext(accountData.tasks);
  const activeCategory = typeof activeContext.categoryId === 'number' && Array.isArray(accountData.categories)
    ? accountData.categories.find((category) => category?.id === activeContext.categoryId)
    : null;
  const activeCategoryName = typeof activeCategory?.name === 'string' && activeCategory.name.trim()
    ? activeCategory.name.trim().slice(0, 60)
    : undefined;
  const activeCategoryColor = activeCategoryName && typeof activeCategory?.color === 'string' && activeCategory.color.trim()
    ? activeCategory.color.trim()
    : undefined;
  const activeCategoryIcon = activeCategoryName && typeof activeCategory?.icon === 'string' && activeCategory.icon.trim()
    ? activeCategory.icon.trim()
    : undefined;

  return {
    status,
    updatedAtMs: updatedAtMs || null,
    timer: {
      version: 1,
      hostName: cleanDisplayName(accountData.userName, userRecord.username),
      activeMode: accountData.activeMode === 'break' ? 'break' : 'work',
      timerStarted: Boolean(accountData.timerStarted),
      isIdle: typeof accountData.isIdle === 'boolean' ? accountData.isIdle : true,
      workTime: Number.isFinite(Number(accountData.workTime)) ? Number(accountData.workTime) : DEFAULT_SETTINGS.workDuration,
      breakTime: Number.isFinite(Number(accountData.breakTime)) ? Number(accountData.breakTime) : 0,
      pomodoroCount: Number.isFinite(Number(accountData.pomodoroCount)) ? Number(accountData.pomodoroCount) : 0,
      sessionStartTime: typeof accountData.sessionStartTime === 'string' || accountData.sessionStartTime === null
        ? accountData.sessionStartTime
        : null,
      todayPomodoroCount: getTodayPomodoroCountFromLogs(accountData.logs, Date.now()),
      allPauseActive: Boolean(accountData.allPauseActive),
      allPauseTime: Number.isFinite(Number(accountData.allPauseTime)) ? Number(accountData.allPauseTime) : 0,
      graceOpen: Boolean(accountData.graceOpen),
      graceContext: accountData.graceContext === 'afterWork' || accountData.graceContext === 'afterBreak' ? accountData.graceContext : null,
      activeTaskName: typeof activeContext.task?.name === 'string' && activeContext.task.name.trim()
        ? activeContext.task.name.trim().slice(0, 80)
        : null,
      activeCategoryName,
      activeCategoryColor,
      activeCategoryIcon,
      activeColor: typeof activeContext.color === 'string' && activeContext.color.trim() ? activeContext.color.trim() : undefined,
      projectedFinishEndMs: null,
      settings: pickTimerSpectatorSettings(accountData.settings),
      runtime: isRuntimeSnapshot(accountData.runtime) ? accountData.runtime : null,
      updatedAtMs: updatedAtMs || Date.now(),
    },
  };
};

const resolveFocusFriendPresence = (userRecord, accountData, focusFriendsData) => {
  const accountPresence = buildFocusFriendPresence(userRecord, accountData);
  const publishedPresence = buildFocusFriendPresenceFromTimer(focusFriendsData?.presence?.timer);
  const publishedUpdatedAtMs = publishedPresence.updatedAtMs || 0;
  const accountUpdatedAtMs = accountPresence.updatedAtMs || 0;
  return publishedUpdatedAtMs >= accountUpdatedAtMs - 1000 ? publishedPresence : accountPresence;
};

const addFriendRelation = (data, userRecord, friendRecord, friendsSince) => {
  const existing = data.friends.some((friend) => friend.userId === friendRecord.id);
  if (existing) return data;
  return {
    ...data,
    friends: [
      ...data.friends,
      {
        userId: friendRecord.id,
        username: friendRecord.username,
        friendsSince,
      },
    ],
  };
};

const removeFriendRelation = (data, friendUserId) => ({
  ...data,
  friends: data.friends.filter((friend) => friend.userId !== friendUserId),
});

const areFocusFriends = (data, friendUserId) => data.friends.some((friend) => friend.userId === friendUserId);

export const isDebugFocusFriendCredentials = (username, password) => {
  const normalized = normalizeUsername(username);
  return DEBUG_FOCUS_FRIEND_ACCOUNTS.some((account) => (
    account.username === normalized && account.password === password
  ));
};

export const isDebugFocusFriendUsername = (username) => {
  const normalized = normalizeUsername(username);
  return DEBUG_FOCUS_FRIEND_ACCOUNTS.some((account) => account.username === normalized);
};

const upsertDebugFocusFriendUser = async (debugAccount) => {
  const { usersStore } = getStores();
  const existing = await getUserByUsername(debugAccount.username);
  if (!existing) {
    return await createUser(debugAccount.username, debugAccount.password)
      || await getUserByUsername(debugAccount.username);
  }

  if (verifyPassword(existing, debugAccount.password)) {
    return existing;
  }

  const salt = randomBytes(16).toString('hex');
  const patched = {
    ...existing,
    username: debugAccount.username,
    normalizedUsername: debugAccount.username,
    passwordSalt: salt,
    passwordHash: hashPassword(debugAccount.password, salt),
    updatedAt: new Date().toISOString(),
  };
  await Promise.all([
    setBlobJSON(usersStore, `${USER_KEY_PREFIX}${debugAccount.username}`, patched),
    setBlobJSON(usersStore, `${USER_ID_KEY_PREFIX}${patched.id}`, patched),
  ]);
  return patched;
};

const buildDebugAccountData = (userRecord, debugAccount) => {
  const nowMs = Date.now();
  const isOffline = debugAccount.presence === 'offline';
  const isActive = debugAccount.presence === 'focusing';
  const updatedAtMs = isOffline ? nowMs - FOCUS_FRIEND_OFFLINE_AFTER_MS - 60_000 : nowMs;
  const nowIso = new Date(updatedAtMs).toISOString();
  const publicUser = makeUserPublic(userRecord);
  const completedPomos = Number.isFinite(Number(debugAccount.pomodoroCount))
    ? Math.max(0, Number(debugAccount.pomodoroCount))
    : 0;
  const debugLogs = completedPomos > 0
    ? [{
        type: 'work',
        start: new Date(updatedAtMs - (completedPomos * ACCOUNT_STATS_POMODORO_SECONDS * 1000)).toISOString(),
        end: nowIso,
        duration: completedPomos * ACCOUNT_STATS_POMODORO_SECONDS,
        reason: 'Pomodoro Complete',
        task: { id: 9301, name: debugAccount.taskName },
        categoryId: 9201,
        categoryName: debugAccount.categoryName,
        categoryColor: debugAccount.categoryColor,
        categoryIcon: debugAccount.categoryIcon || 'target',
      }]
    : [];
  return sanitizeAccountPayload({
    ...buildDefaultAccountData(publicUser),
    userName: debugAccount.displayName,
    categories: [
      {
        id: 9201,
        name: debugAccount.categoryName,
        color: debugAccount.categoryColor,
        icon: debugAccount.categoryIcon || 'target',
      },
    ],
    tasks: [
      {
        id: 9301,
        name: debugAccount.taskName,
        estimated: 2,
        completed: 0,
        checked: false,
        selected: true,
        categoryId: 9201,
        subtasks: [],
      },
    ],
    logs: debugLogs,
    activeMode: 'work',
    timerStarted: isActive,
    isIdle: !isActive,
    workTime: debugAccount.workTime,
    breakTime: 0,
    pomodoroCount: Number.isFinite(Number(debugAccount.pomodoroCount)) ? Math.max(0, Math.floor(Number(debugAccount.pomodoroCount))) : 0,
    runtime: {
      version: 2,
      updatedAtMs,
      sourceTabId: `debug-${debugAccount.username}`,
      phase: isActive ? 'running-work' : 'idle',
      phaseStartedAtMs: updatedAtMs,
      phaseStartWorkTime: debugAccount.workTime,
      phaseStartBreakTime: 0,
      phaseStartAllPauseTime: 0,
      phaseStartGraceTotal: 0,
      activityStartIso: nowIso,
    },
    updatedAt: nowIso,
  }, publicUser, { revision: 1, updatedAt: nowIso });
};

const isUntouchedDebugAccountData = (accountData, debugAccount) => (
  accountData
  && accountData.revision === 1
  && accountData.userName === debugAccount.displayName
  && Array.isArray(accountData.tasks)
  && accountData.tasks.length === 1
  && accountData.tasks[0]?.id === 9301
  && accountData.tasks[0]?.name === debugAccount.taskName
  && Array.isArray(accountData.categories)
  && accountData.categories.length === 1
  && accountData.categories[0]?.id === 9201
  && accountData.categories[0]?.name === debugAccount.categoryName
);

const ensureDebugAccountData = async (userRecord, debugAccount) => {
  const existing = await getAccountData(userRecord.id);
  if (existing && !isUntouchedDebugAccountData(existing, debugAccount)) return existing;

  const accountData = buildDebugAccountData(userRecord, debugAccount);
  await Promise.all([
    saveAccountData(userRecord.id, accountData),
    persistUser({
      ...userRecord,
      lifetimeStats: accountData.user.lifetimeStats,
    }),
  ]);
  return accountData;
};

const removePendingFocusFriendRequestsBetween = (data, otherUserId) => ({
  ...data,
  incomingRequests: data.incomingRequests.filter((request) => request.fromUserId !== otherUserId && request.toUserId !== otherUserId),
  outgoingRequests: data.outgoingRequests.filter((request) => request.fromUserId !== otherUserId && request.toUserId !== otherUserId),
});

const ensureDebugFocusFriendRelation = async (leftRecord, rightRecord) => {
  const [leftDataRaw, rightDataRaw] = await Promise.all([
    getFocusFriendsData(leftRecord.id),
    getFocusFriendsData(rightRecord.id),
  ]);
  const friendsSince = new Date().toISOString();
  const leftData = addFriendRelation(
    removePendingFocusFriendRequestsBetween(leftDataRaw, rightRecord.id),
    leftRecord,
    rightRecord,
    friendsSince,
  );
  const rightData = addFriendRelation(
    removePendingFocusFriendRequestsBetween(rightDataRaw, leftRecord.id),
    rightRecord,
    leftRecord,
    friendsSince,
  );

  await Promise.all([
    saveFocusFriendsData(leftRecord.id, leftData),
    saveFocusFriendsData(rightRecord.id, rightData),
  ]);
};

const ensureDebugFocusFriendNetwork = async (records) => {
  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
      await ensureDebugFocusFriendRelation(records[leftIndex], records[rightIndex]);
    }
  }
};

export const ensureDebugFocusFriendAccounts = async () => {
  const records = await Promise.all(DEBUG_FOCUS_FRIEND_ACCOUNTS.map(upsertDebugFocusFriendUser));
  if (records.some((record) => !record)) {
    const error = new Error('Could not prepare Focus Friends debug accounts.');
    error.status = 500;
    throw error;
  }
  await Promise.all(records.map((record, index) => ensureDebugAccountData(record, DEBUG_FOCUS_FRIEND_ACCOUNTS[index])));
  await ensureDebugFocusFriendNetwork(records);
  return records;
};

export const listFocusFriendsForUser = async (userRecord) => {
  const data = await getFocusFriendsData(userRecord.id);
  const friends = await Promise.all(data.friends.map(async (relation) => {
    const friendRecord = await getUserById(relation.userId);
    if (!friendRecord) return null;
    const publicUser = makeUserPublic(friendRecord);
    const [accountData, friendFocusFriendsData] = await Promise.all([
      getAccountData(friendRecord.id),
      getFocusFriendsData(friendRecord.id),
    ]);
    const displayName = cleanDisplayName(accountData?.userName, friendRecord.username);
    return {
      username: friendRecord.username,
      displayName,
      joinedAt: friendRecord.joinedAt,
      friendsSince: relation.friendsSince,
      lifetimeStats: accountData?.user?.lifetimeStats || publicUser.lifetimeStats || defaultLifetimeStats(),
      presence: resolveFocusFriendPresence(friendRecord, accountData, friendFocusFriendsData),
    };
  }));

  const statusRank = {
    focusing: 0,
    break: 1,
    grace: 2,
    paused: 3,
    idle: 4,
    offline: 5,
  };

  return {
    friends: friends
      .filter(Boolean)
      .sort((left, right) => {
        const leftRank = statusRank[left.presence.status] ?? 9;
        const rightRank = statusRank[right.presence.status] ?? 9;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return left.displayName.localeCompare(right.displayName);
      }),
    incomingRequests: data.incomingRequests
      .map(toPublicFocusFriendRequest)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
    outgoingRequests: data.outgoingRequests
      .map(toPublicFocusFriendRequest)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
    inbox: data.inbox
      .map(toPublicFocusFriendAction)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
  };
};

export const updateFocusFriendPresence = async (currentUserRecord, timer) => {
  let data = await getFocusFriendsData(currentUserRecord.id);
  const normalizedTimer = normalizeTimerSpectatorState(timer, currentUserRecord.username);
  if (!normalizedTimer) {
    const error = new Error('Invalid Focus Friend presence.');
    error.status = 400;
    throw error;
  }

  data = {
    ...data,
    presence: {
      updatedAt: new Date(normalizedTimer.updatedAtMs || Date.now()).toISOString(),
      timer: normalizedTimer,
    },
  };
  await saveFocusFriendsData(currentUserRecord.id, data);
};

export const createFocusFriendRequest = async (fromUserRecord, targetUsername) => {
  const normalizedTarget = normalizeUsername(targetUsername);
  const targetUserRecord = await getUserByUsername(normalizedTarget);
  if (!targetUserRecord) {
    const error = new Error('No account found with that username.');
    error.status = 404;
    throw error;
  }
  if (targetUserRecord.id === fromUserRecord.id) {
    const error = new Error('You cannot add yourself as a Focus Friend.');
    error.status = 400;
    throw error;
  }

  let fromData = await getFocusFriendsData(fromUserRecord.id);
  let targetData = await getFocusFriendsData(targetUserRecord.id);
  if (areFocusFriends(fromData, targetUserRecord.id)) {
    const error = new Error('You are already Focus Friends.');
    error.status = 409;
    throw error;
  }
  if (fromData.friends.length >= FOCUS_FRIENDS_LIMIT || targetData.friends.length >= FOCUS_FRIENDS_LIMIT) {
    const error = new Error('Focus Friend limit reached.');
    error.status = 409;
    throw error;
  }

  const reverseRequest = fromData.incomingRequests.find((request) => request.fromUserId === targetUserRecord.id);
  if (reverseRequest) {
    return acceptFocusFriendRequest(fromUserRecord, reverseRequest.id);
  }

  const duplicate = fromData.outgoingRequests.some((request) => request.toUserId === targetUserRecord.id)
    || targetData.incomingRequests.some((request) => request.fromUserId === fromUserRecord.id);
  if (duplicate) {
    const error = new Error('Focus Friend request already sent.');
    error.status = 409;
    throw error;
  }
  if (fromData.outgoingRequests.length >= FOCUS_FRIEND_REQUEST_LIMIT || targetData.incomingRequests.length >= FOCUS_FRIEND_REQUEST_LIMIT) {
    const error = new Error('Too many pending Focus Friend requests.');
    error.status = 409;
    throw error;
  }

  const now = new Date().toISOString();
  const [fromDisplayName, toDisplayName] = await Promise.all([
    getCurrentAccountDisplayName(fromUserRecord),
    getCurrentAccountDisplayName(targetUserRecord),
  ]);
  const request = {
    id: makeFocusFriendId('friend_req'),
    fromUserId: fromUserRecord.id,
    fromUsername: fromUserRecord.username,
    fromDisplayName,
    toUserId: targetUserRecord.id,
    toUsername: targetUserRecord.username,
    toDisplayName,
    createdAt: now,
  };

  fromData = {
    ...fromData,
    outgoingRequests: [...fromData.outgoingRequests, request],
  };
  targetData = {
    ...targetData,
    incomingRequests: [...targetData.incomingRequests, request],
  };
  await Promise.all([
    saveFocusFriendsData(fromUserRecord.id, fromData),
    saveFocusFriendsData(targetUserRecord.id, targetData),
  ]);
};

export const acceptFocusFriendRequest = async (currentUserRecord, requestId) => {
  let currentData = await getFocusFriendsData(currentUserRecord.id);
  const request = currentData.incomingRequests.find((item) => item.id === requestId);
  if (!request) {
    const error = new Error('Focus Friend request not found.');
    error.status = 404;
    throw error;
  }

  const requesterRecord = await getUserById(request.fromUserId);
  if (!requesterRecord) {
    currentData = {
      ...currentData,
      incomingRequests: currentData.incomingRequests.filter((item) => item.id !== requestId),
    };
    await saveFocusFriendsData(currentUserRecord.id, currentData);
    const error = new Error('Requesting account no longer exists.');
    error.status = 404;
    throw error;
  }

  let requesterData = await getFocusFriendsData(requesterRecord.id);
  if (
    !areFocusFriends(currentData, requesterRecord.id)
    && (currentData.friends.length >= FOCUS_FRIENDS_LIMIT || requesterData.friends.length >= FOCUS_FRIENDS_LIMIT)
  ) {
    const error = new Error('Focus Friend limit reached.');
    error.status = 409;
    throw error;
  }
  const now = new Date().toISOString();
  currentData = addFriendRelation({
    ...currentData,
    incomingRequests: currentData.incomingRequests.filter((item) => item.id !== requestId),
    outgoingRequests: currentData.outgoingRequests.filter((item) => item.toUserId !== requesterRecord.id),
  }, currentUserRecord, requesterRecord, now);
  requesterData = addFriendRelation({
    ...requesterData,
    outgoingRequests: requesterData.outgoingRequests.filter((item) => item.id !== requestId),
    incomingRequests: requesterData.incomingRequests.filter((item) => item.fromUserId !== currentUserRecord.id),
  }, requesterRecord, currentUserRecord, now);

  await Promise.all([
    saveFocusFriendsData(currentUserRecord.id, currentData),
    saveFocusFriendsData(requesterRecord.id, requesterData),
  ]);
};

export const acceptFocusFriendInvite = async (currentUserRecord, inviterUsername) => {
  const normalizedInviter = normalizeUsername(inviterUsername);
  const inviterRecord = await getUserByUsername(normalizedInviter);
  if (!inviterRecord) {
    const error = new Error('Focus Friend invite account not found.');
    error.status = 404;
    throw error;
  }
  if (inviterRecord.id === currentUserRecord.id) {
    const error = new Error('You cannot use your own Focus Friend invite.');
    error.status = 400;
    throw error;
  }

  let currentData = await getFocusFriendsData(currentUserRecord.id);
  let inviterData = await getFocusFriendsData(inviterRecord.id);
  const currentAlreadyFriends = areFocusFriends(currentData, inviterRecord.id);
  const inviterAlreadyFriends = areFocusFriends(inviterData, currentUserRecord.id);

  if (
    (!currentAlreadyFriends && currentData.friends.length >= FOCUS_FRIENDS_LIMIT)
    || (!inviterAlreadyFriends && inviterData.friends.length >= FOCUS_FRIENDS_LIMIT)
  ) {
    const error = new Error('Focus Friend limit reached.');
    error.status = 409;
    throw error;
  }

  const now = new Date().toISOString();
  currentData = addFriendRelation(
    removePendingFocusFriendRequestsBetween(currentData, inviterRecord.id),
    currentUserRecord,
    inviterRecord,
    now,
  );
  inviterData = addFriendRelation(
    removePendingFocusFriendRequestsBetween(inviterData, currentUserRecord.id),
    inviterRecord,
    currentUserRecord,
    now,
  );

  await Promise.all([
    saveFocusFriendsData(currentUserRecord.id, currentData),
    saveFocusFriendsData(inviterRecord.id, inviterData),
  ]);
};

export const declineFocusFriendRequest = async (currentUserRecord, requestId) => {
  let currentData = await getFocusFriendsData(currentUserRecord.id);
  const request = currentData.incomingRequests.find((item) => item.id === requestId);
  if (!request) {
    const error = new Error('Focus Friend request not found.');
    error.status = 404;
    throw error;
  }
  const requesterRecord = await getUserById(request.fromUserId);
  const requesterData = requesterRecord ? await getFocusFriendsData(requesterRecord.id) : null;
  currentData = {
    ...currentData,
    incomingRequests: currentData.incomingRequests.filter((item) => item.id !== requestId),
  };

  const writes = [saveFocusFriendsData(currentUserRecord.id, currentData)];
  if (requesterRecord && requesterData) {
    writes.push(saveFocusFriendsData(requesterRecord.id, {
      ...requesterData,
      outgoingRequests: requesterData.outgoingRequests.filter((item) => item.id !== requestId),
    }));
  }
  await Promise.all(writes);
};

export const removeFocusFriend = async (currentUserRecord, targetUsername) => {
  const targetUserRecord = await getUserByUsername(normalizeUsername(targetUsername));
  if (!targetUserRecord) {
    const error = new Error('Focus Friend not found.');
    error.status = 404;
    throw error;
  }
  const [currentData, targetData] = await Promise.all([
    getFocusFriendsData(currentUserRecord.id),
    getFocusFriendsData(targetUserRecord.id),
  ]);
  await Promise.all([
    saveFocusFriendsData(currentUserRecord.id, removeFriendRelation(currentData, targetUserRecord.id)),
    saveFocusFriendsData(targetUserRecord.id, removeFriendRelation(targetData, currentUserRecord.id)),
  ]);
};

export const createFocusFriendAction = async (fromUserRecord, targetUsername, type, rawMessage, sessionId = null) => {
  const targetUserRecord = await getUserByUsername(normalizeUsername(targetUsername));
  if (!targetUserRecord) {
    const error = new Error('Focus Friend not found.');
    error.status = 404;
    throw error;
  }
  if (targetUserRecord.id === fromUserRecord.id) {
    const error = new Error('Pick a Focus Friend first.');
    error.status = 400;
    throw error;
  }
  const [fromData, targetData, fromDisplayName] = await Promise.all([
    getFocusFriendsData(fromUserRecord.id),
    getFocusFriendsData(targetUserRecord.id),
    getCurrentAccountDisplayName(fromUserRecord),
  ]);
  if (!areFocusFriends(fromData, targetUserRecord.id)) {
    const error = new Error('You can only message Focus Friends.');
    error.status = 403;
    throw error;
  }

  const actionType = type === 'join-request'
    ? 'join-request'
    : type === 'join-invite'
      ? 'join-invite'
      : 'encouragement';
  const normalizedSessionId = typeof sessionId === 'string' && sessionId.trim()
    ? sessionId.trim().toUpperCase().slice(0, 64)
    : null;
  if (actionType === 'join-invite' && !normalizedSessionId) {
    const error = new Error('Missing session invite.');
    error.status = 400;
    throw error;
  }
  const fallbackMessage = actionType === 'join-request'
    ? 'wants to join your focus session.'
    : actionType === 'join-invite'
      ? 'sent you a focus session invite.'
      : 'sent you encouragement.';
  const message = cleanString(rawMessage, fallbackMessage).trim().slice(0, FRIEND_MESSAGE_MAX_LENGTH) || fallbackMessage;
  const action = {
    id: makeFocusFriendId(actionType === 'join-request'
      ? 'join_req'
      : actionType === 'join-invite'
        ? 'join_invite'
        : 'encourage'),
    type: actionType,
    fromUserId: fromUserRecord.id,
    fromUsername: fromUserRecord.username,
    fromDisplayName,
    toUserId: targetUserRecord.id,
    toUsername: targetUserRecord.username,
    message,
    sessionId: normalizedSessionId,
    createdAt: new Date().toISOString(),
    readAt: null,
  };

  await saveFocusFriendsData(targetUserRecord.id, {
    ...targetData,
    inbox: [action, ...targetData.inbox].slice(0, FOCUS_FRIEND_INBOX_LIMIT),
  });
};

const getFocusFriendJoinRequestForUser = (data, actionId) => {
  const action = data.inbox.find((item) => item.id === actionId);
  if (!action || action.type !== 'join-request') {
    const error = new Error('Focus Friend join request not found.');
    error.status = 404;
    throw error;
  }
  return action;
};

export const approveFocusFriendJoinRequest = async (currentUserRecord, actionId, sessionId) => {
  const normalizedSessionId = typeof sessionId === 'string' && sessionId.trim()
    ? sessionId.trim().toUpperCase().slice(0, 64)
    : null;
  if (!normalizedSessionId) {
    const error = new Error('Start a focus session before allowing a friend to join.');
    error.status = 400;
    throw error;
  }

  const currentData = await getFocusFriendsData(currentUserRecord.id);
  const joinRequest = getFocusFriendJoinRequestForUser(currentData, actionId);
  if (joinRequest.readAt) {
    const error = new Error('Focus Friend join request was already handled.');
    error.status = 409;
    throw error;
  }
  const requesterRecord = await getUserById(joinRequest.fromUserId);
  if (!requesterRecord) {
    const error = new Error('Focus Friend not found.');
    error.status = 404;
    throw error;
  }

  const [requesterData, currentDisplayName] = await Promise.all([
    getFocusFriendsData(requesterRecord.id),
    getCurrentAccountDisplayName(currentUserRecord),
  ]);
  if (!areFocusFriends(currentData, requesterRecord.id) || !areFocusFriends(requesterData, currentUserRecord.id)) {
    const error = new Error('You can only approve requests from Focus Friends.');
    error.status = 403;
    throw error;
  }

  const now = new Date().toISOString();
  const invite = {
    id: makeFocusFriendId('join_invite'),
    type: 'join-invite',
    fromUserId: currentUserRecord.id,
    fromUsername: currentUserRecord.username,
    fromDisplayName: currentDisplayName,
    toUserId: requesterRecord.id,
    toUsername: requesterRecord.username,
    message: 'approved your join request.',
    sessionId: normalizedSessionId,
    createdAt: now,
    readAt: null,
  };
  const nextCurrentInbox = currentData.inbox.map((action) => (
    action.id === actionId ? { ...action, readAt: action.readAt || now } : action
  ));

  await Promise.all([
    saveFocusFriendsData(currentUserRecord.id, {
      ...currentData,
      inbox: nextCurrentInbox,
    }),
    saveFocusFriendsData(requesterRecord.id, {
      ...requesterData,
      inbox: [invite, ...requesterData.inbox].slice(0, FOCUS_FRIEND_INBOX_LIMIT),
    }),
  ]);
};

export const declineFocusFriendJoinRequest = async (currentUserRecord, actionId) => {
  const currentData = await getFocusFriendsData(currentUserRecord.id);
  const joinRequest = getFocusFriendJoinRequestForUser(currentData, actionId);
  if (joinRequest.readAt) {
    const error = new Error('Focus Friend join request was already handled.');
    error.status = 409;
    throw error;
  }
  const now = new Date().toISOString();
  const nextInbox = currentData.inbox.map((action) => (
    action.id === actionId ? { ...action, readAt: action.readAt || now } : action
  ));
  await saveFocusFriendsData(currentUserRecord.id, {
    ...currentData,
    inbox: nextInbox,
  });
};

export const markFocusFriendActionRead = async (currentUserRecord, actionId) => {
  const currentData = await getFocusFriendsData(currentUserRecord.id);
  if (!currentData.inbox.some((action) => action.id === actionId)) {
    const error = new Error('Friend activity not found.');
    error.status = 404;
    throw error;
  }
  const now = new Date().toISOString();
  const nextInbox = currentData.inbox.map((action) => (
    action.id === actionId ? { ...action, readAt: action.readAt || now } : action
  ));
  await saveFocusFriendsData(currentUserRecord.id, {
    ...currentData,
    inbox: nextInbox,
  });
};

export const attachPublicUserToData = (accountData, publicUser) => {
  const patched = sanitizeAccountPayload(accountData, publicUser, {
    updatedAt: typeof accountData?.updatedAt === 'string' ? accountData.updatedAt : undefined,
  });
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
