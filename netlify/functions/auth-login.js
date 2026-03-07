import {
  attachPublicUserToData,
  buildPublicUserFromAccountData,
  buildDefaultAccountData,
  createSession,
  getAccountData,
  getUserByUsername,
  json,
  normalizeUsername,
  parseBody,
  persistUser,
  saveAccountData,
  validatePassword,
  validateUsername,
  verifyPassword,
} from './_lib/account-store.js';

const isSameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

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
  const authoritativeUser = buildPublicUserFromAccountData(publicUser, accountData);

  const writes = [];
  if (!rawAccount || !isSameJson(rawAccount, accountData)) {
    writes.push(saveAccountData(userRecord.id, accountData));
  }
  if (!isSameJson(userRecord.lifetimeStats || {}, authoritativeUser.lifetimeStats || {})) {
    writes.push(persistUser({
      ...userRecord,
      lifetimeStats: authoritativeUser.lifetimeStats,
    }));
  }
  if (writes.length > 0) {
    await Promise.all(writes);
  }

  const token = await createSession(userRecord);
  return json(200, { token, user: authoritativeUser, accountData });
};
