import { FocusFriendAction, FocusFriendActionType, FocusFriendNotice, FocusFriendRequest, FocusFriendsState } from '../types';

type FocusFriendNotificationSnapshot = Pick<FocusFriendsState, 'inbox' | 'incomingRequests'>;

export interface FocusFriendNoticeSelectionInput {
  snapshot: Partial<FocusFriendNotificationSnapshot> | null | undefined;
  seenActionIds: ReadonlySet<string>;
  seenRequestIds: ReadonlySet<string>;
}

const getCreatedAtMs = (item: { createdAt?: string } | null | undefined) => {
  const parsed = Date.parse(item?.createdAt || '');
  return Number.isFinite(parsed) ? parsed : 0;
};

const compareNotificationItems = <T extends { id: string; createdAt: string }>(a: T, b: T) => (
  getCreatedAtMs(a) - getCreatedAtMs(b) || a.id.localeCompare(b.id)
);

const getNewestItem = <T extends { id: string; createdAt: string }>(items: T[]) => {
  const sorted = [...items].sort(compareNotificationItems);
  return sorted[sorted.length - 1];
};

const getNewestActionOfType = (actions: FocusFriendAction[], type: FocusFriendActionType) => (
  getNewestItem(actions.filter(action => action.type === type))
);

export const getFocusFriendNoticeSourceId = (notice: FocusFriendNotice) => (
  notice.type === 'action' ? notice.action.id : notice.request.id
);

export const selectFocusFriendNotice = ({
  snapshot,
  seenActionIds,
  seenRequestIds,
}: FocusFriendNoticeSelectionInput): FocusFriendNotice | null => {
  const unreadActions = (Array.isArray(snapshot?.inbox) ? snapshot.inbox : [])
    .filter(action => !action.readAt && !seenActionIds.has(action.id))
    .sort(compareNotificationItems);
  const incomingRequests = (Array.isArray(snapshot?.incomingRequests) ? snapshot.incomingRequests : [])
    .filter(request => !seenRequestIds.has(request.id))
    .sort(compareNotificationItems);

  const newestJoinInvite = getNewestActionOfType(unreadActions, 'join-invite');
  const newestJoinRequest = getNewestActionOfType(unreadActions, 'join-request');
  const newestUnreadAction = unreadActions[unreadActions.length - 1];
  const newestIncomingRequest = incomingRequests[incomingRequests.length - 1];
  const newestUnreadActionAt = newestUnreadAction ? getCreatedAtMs(newestUnreadAction) : -1;
  const newestIncomingRequestAt = newestIncomingRequest ? getCreatedAtMs(newestIncomingRequest) : -1;
  const prioritizedAction = newestJoinInvite || newestJoinRequest || newestUnreadAction;

  if (prioritizedAction?.type === 'join-invite' || prioritizedAction?.type === 'join-request') {
    return {
      id: prioritizedAction.id,
      type: 'action',
      action: prioritizedAction,
    };
  }

  if (newestIncomingRequest && newestIncomingRequestAt > newestUnreadActionAt) {
    return {
      id: newestIncomingRequest.id,
      type: 'request',
      request: newestIncomingRequest,
    };
  }

  if (prioritizedAction) {
    return {
      id: prioritizedAction.id,
      type: 'action',
      action: prioritizedAction,
    };
  }

  return null;
};

export const markFocusFriendNoticeSeen = (
  notice: FocusFriendNotice,
  seenActionIds: Set<string>,
  seenRequestIds: Set<string>,
) => {
  if (notice.type === 'action') {
    seenActionIds.add(notice.action.id);
    return;
  }

  seenRequestIds.add(notice.request.id);
};
