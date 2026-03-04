import {
  attachPublicUserToData,
  buildDefaultAccountData,
  getAccountData,
  json,
  parseBody,
  requireSession,
  saveAccountData,
  persistUser,
} from './_lib/account-store.js';

export default async (request) => {
  if (request.method !== 'GET' && request.method !== 'PUT') {
    return json(405, { error: 'Method not allowed' });
  }

  const session = await requireSession(request);
  if (!session) {
    return json(401, { error: 'Unauthorized' });
  }

  const publicUser = session.publicUser;
  const userRecord = session.userRecord;

  if (request.method === 'GET') {
    const raw = await getAccountData(userRecord.id);
    const accountData = raw
      ? attachPublicUserToData(raw, publicUser)
      : buildDefaultAccountData(publicUser);
    if (!raw) {
      await saveAccountData(userRecord.id, accountData);
    }
    return json(200, { user: publicUser, accountData });
  }

  const body = await parseBody(request);
  if (!body || typeof body !== 'object' || !body.accountData) {
    return json(400, { error: 'Missing accountData payload' });
  }

  let sanitizedData;
  try {
    sanitizedData = attachPublicUserToData(body.accountData, publicUser);
  } catch (error) {
    return json(400, { error: error instanceof Error ? error.message : 'Invalid payload' });
  }

  const lifetimeStats = sanitizedData?.user?.lifetimeStats || publicUser.lifetimeStats;
  const updatedRecord = {
    ...userRecord,
    lifetimeStats,
  };

  await Promise.all([
    saveAccountData(userRecord.id, sanitizedData),
    persistUser(updatedRecord),
  ]);

  return json(200, {
    user: {
      username: updatedRecord.username,
      joinedAt: updatedRecord.joinedAt,
      lifetimeStats: updatedRecord.lifetimeStats,
    },
    accountData: sanitizedData,
    savedAt: new Date().toISOString(),
  });
};

