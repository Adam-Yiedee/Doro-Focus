import {
  attachPublicUserToData,
  buildPublicUserFromAccountData,
  buildDefaultAccountData,
  createSession,
  createUser,
  isDebugFocusFriendUsername,
  json,
  parseBody,
  persistUser,
  saveAccountData,
  validatePassword,
  validateUsername,
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
  if (isDebugFocusFriendUsername(username)) {
    return json(409, { error: 'Username is reserved for Focus Friends debugging.' });
  }

  const passwordError = validatePassword(password);
  if (passwordError) return json(400, { error: passwordError });

  const userRecord = await createUser(username, password);
  if (!userRecord) {
    return json(409, { error: 'Username already exists' });
  }

  const publicUser = {
    username: userRecord.username,
    joinedAt: userRecord.joinedAt,
    lifetimeStats: userRecord.lifetimeStats,
  };

  let accountData;
  try {
    accountData = body.seedData
      ? attachPublicUserToData(body.seedData, publicUser)
      : buildDefaultAccountData(publicUser);
  } catch (error) {
    return json(400, { error: error instanceof Error ? error.message : 'Invalid account payload' });
  }

  const authoritativeUser = buildPublicUserFromAccountData(publicUser, accountData);
  const persistedUserRecord = {
    ...userRecord,
    lifetimeStats: authoritativeUser.lifetimeStats,
  };

  await Promise.all([
    saveAccountData(userRecord.id, accountData),
    persistUser(persistedUserRecord),
  ]);
  const token = await createSession(persistedUserRecord);

  return json(201, { token, user: authoritativeUser, accountData });
};
