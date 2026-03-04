import { json, revokeSessionByTokenHash, tokenHashFromRequest } from './_lib/account-store.js';

export default async (request) => {
  if (request.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const tokenHash = tokenHashFromRequest(request);
  if (tokenHash) {
    await revokeSessionByTokenHash(tokenHash);
  }

  return json(200, { ok: true });
};

