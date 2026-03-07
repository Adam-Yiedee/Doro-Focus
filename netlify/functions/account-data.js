import {
  attachPublicUserToData,
  buildPublicUserFromAccountData,
  buildDefaultAccountData,
  getAccountData,
  getAccountRevision,
  json,
  parseBody,
  sanitizeAccountPayload,
  requireSession,
  saveAccountData,
  persistUser,
} from './_lib/account-store.js';

const isSameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

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
    const authoritativeUser = buildPublicUserFromAccountData(publicUser, accountData);

    const writes = [];
    if (!raw || !isSameJson(raw, accountData)) {
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

    return json(200, { user: authoritativeUser, accountData });
  }

  const body = await parseBody(request);
  if (!body || typeof body !== 'object' || !body.accountData) {
    return json(400, { error: 'Missing accountData payload' });
  }

  const currentRaw = await getAccountData(userRecord.id);
  const currentAccount = currentRaw
    ? attachPublicUserToData(currentRaw, publicUser)
    : buildDefaultAccountData(publicUser);
  const authoritativeCurrentUser = buildPublicUserFromAccountData(publicUser, currentAccount);
  const hasIncomingRevision = typeof body.accountData?.revision === 'number' && Number.isFinite(body.accountData.revision);
  const currentRevision = getAccountRevision(currentAccount);
  const incomingRevision = getAccountRevision(body.accountData);

  if ((hasIncomingRevision && incomingRevision !== currentRevision) || (!hasIncomingRevision && currentRevision > 0)) {
    return json(409, {
      error: 'Account data conflict. Refresh and try again.',
      user: authoritativeCurrentUser,
      accountData: currentAccount,
      savedAt: currentAccount.updatedAt,
      conflict: true,
    });
  }

  let sanitizedData;
  try {
    sanitizedData = sanitizeAccountPayload(body.accountData, publicUser, {
      revision: currentRevision + 1,
    });
  } catch (error) {
    return json(400, { error: error instanceof Error ? error.message : 'Invalid payload' });
  }

  const authoritativeUser = buildPublicUserFromAccountData(publicUser, sanitizedData);
  const updatedRecord = {
    ...userRecord,
    lifetimeStats: authoritativeUser.lifetimeStats,
  };

  await Promise.all([
    saveAccountData(userRecord.id, sanitizedData),
    persistUser(updatedRecord),
  ]);

  return json(200, {
    user: authoritativeUser,
    accountData: sanitizedData,
    savedAt: sanitizedData.updatedAt,
  });
};
