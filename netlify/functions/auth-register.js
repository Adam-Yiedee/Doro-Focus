import {
  attachPublicUserToData,
  buildDefaultAccountData,
  createSession,
  createUser,
  json,
  parseBody,
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

  await saveAccountData(userRecord.id, accountData);
  const token = await createSession(userRecord);

  return json(201, { token, user: publicUser, accountData });
};

