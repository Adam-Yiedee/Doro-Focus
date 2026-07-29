import {
  acceptFocusFriendInvite,
  acceptFocusFriendRequest,
  approveFocusFriendJoinRequest,
  createFocusFriendAction,
  createFocusFriendRequest,
  declineFocusFriendJoinRequest,
  declineFocusFriendRequest,
  json,
  listFocusFriendsForUser,
  markFocusFriendActionRead,
  parseBody,
  removeFocusFriend,
  requireSession,
  updateFocusFriendPresence,
} from './_lib/account-store.js';

const getErrorStatus = (error) => {
  if (typeof error?.status === 'number' && Number.isFinite(error.status)) {
    return Math.max(400, Math.min(599, Math.floor(error.status)));
  }
  return 400;
};

export default async (request) => {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const session = await requireSession(request);
  if (!session) {
    return json(401, { error: 'Unauthorized' });
  }

  if (request.method === 'GET') {
    return json(200, await listFocusFriendsForUser(session.userRecord));
  }

  const body = await parseBody(request);
  if (!body || typeof body !== 'object' || typeof body.action !== 'string') {
    return json(400, { error: 'Missing Focus Friends action.' });
  }

  try {
    switch (body.action) {
      case 'send-request':
        await createFocusFriendRequest(session.userRecord, body.username);
        break;
      case 'update-presence':
        await updateFocusFriendPresence(session.userRecord, body.timer);
        break;
      case 'accept-request':
        await acceptFocusFriendRequest(session.userRecord, body.requestId);
        break;
      case 'accept-invite':
        await acceptFocusFriendInvite(session.userRecord, body.username);
        break;
      case 'decline-request':
        await declineFocusFriendRequest(session.userRecord, body.requestId);
        break;
      case 'remove-friend':
        await removeFocusFriend(session.userRecord, body.username);
        break;
      case 'send-encouragement':
        await createFocusFriendAction(session.userRecord, body.username, 'encouragement', body.message);
        break;
      case 'request-join':
        await createFocusFriendAction(session.userRecord, body.username, 'join-request', body.message, body.sessionId);
        break;
      case 'send-join-invite':
        await createFocusFriendAction(session.userRecord, body.username, 'join-invite', body.message, body.sessionId, body.groupStudy);
        break;
      case 'approve-join-request':
        await approveFocusFriendJoinRequest(session.userRecord, body.actionId, body.sessionId, body.groupStudy);
        break;
      case 'decline-join-request':
        await declineFocusFriendJoinRequest(session.userRecord, body.actionId);
        break;
      case 'mark-action-read':
        await markFocusFriendActionRead(session.userRecord, body.actionId);
        break;
      default:
        return json(400, { error: 'Unknown Focus Friends action.' });
    }
  } catch (error) {
    return json(getErrorStatus(error), {
      error: error instanceof Error ? error.message : 'Focus Friends action failed.',
    });
  }

  return json(200, await listFocusFriendsForUser(session.userRecord));
};
