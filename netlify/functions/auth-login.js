import {
  attachPublicUserToData,
  buildDefaultAccountData,
  createSession,
  getAccountData,
  getUserByUsername,
  json,
  normalizeUsername,
  parseBody,
  validatePassword,
  validateUsername,
  verifyPassword,
} from './_lib/account-store.js';

export default async (request) => {
  if (request.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const body = await parseBody(request);
  if (!body || typeof body !== 'object') {
    return json(400, { error: 'Invalid request body' });
  }

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  const usernameError = validateUsername(username);
  if (usernameError) return json(400, { error: usernameError });

  const passwordError = validatePassword(password);
  if (passwordError) return json(400, { error: passwordError });

  const userRecord = await getUserByUsername(normalizeUsername(username));
  if (!userRecord || !verifyPassword(userRecord, password)) {
    return json(401, { error: 'Invalid username or password' });
  }

  const publicUser = {
    username: userRecord.username,
    joinedAt: userRecord.joinedAt,
    lifetimeStats: userRecord.lifetimeStats,
  };

  const rawAccount = await getAccountData(userRecord.id);
  const accountData = rawAccount
    ? attachPublicUserToData(rawAccount, publicUser)
    : buildDefaultAccountData(publicUser);

  const token = await createSession(userRecord);
  return json(200, { token, user: publicUser, accountData });
};

