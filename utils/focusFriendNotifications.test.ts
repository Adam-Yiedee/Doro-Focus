import { describe, expect, it } from 'vitest';
import { FocusFriendAction, FocusFriendRequest } from '../types';
import {
  getFocusFriendNoticeSourceId,
  markFocusFriendNoticeSeen,
  selectFocusFriendNotice,
} from './focusFriendNotifications';

const makeAction = (
  overrides: Partial<FocusFriendAction> & Pick<FocusFriendAction, 'id' | 'type' | 'createdAt'>,
): FocusFriendAction => ({
  fromDisplayName: 'Alice',
  fromUsername: 'alice',
  message: 'Keep going.',
  readAt: null,
  sessionId: null,
  toUsername: 'bob',
  ...overrides,
});

const makeRequest = (
  overrides: Partial<FocusFriendRequest> & Pick<FocusFriendRequest, 'id' | 'createdAt'>,
): FocusFriendRequest => ({
  fromDisplayName: 'Alice',
  fromUsername: 'alice',
  toDisplayName: 'Bob',
  toUsername: 'bob',
  ...overrides,
});

describe('focus friend notification selection', () => {
  it('selects unread encouragements once using the server action id', () => {
    const seenActionIds = new Set<string>();
    const seenRequestIds = new Set<string>();
    const encouragement = makeAction({
      id: 'encourage_1',
      type: 'encouragement',
      createdAt: '2026-07-26T12:00:00.000Z',
    });

    const notice = selectFocusFriendNotice({
      snapshot: { inbox: [encouragement], incomingRequests: [] },
      seenActionIds,
      seenRequestIds,
    });

    expect(notice).toMatchObject({ id: 'encourage_1', type: 'action' });
    expect(notice ? getFocusFriendNoticeSourceId(notice) : null).toBe('encourage_1');

    markFocusFriendNoticeSeen(notice!, seenActionIds, seenRequestIds);
    expect(selectFocusFriendNotice({
      snapshot: { inbox: [encouragement], incomingRequests: [] },
      seenActionIds,
      seenRequestIds,
    })).toBeNull();
  });

  it('does not notify for actions that are already read', () => {
    const notice = selectFocusFriendNotice({
      snapshot: {
        inbox: [
          makeAction({
            id: 'encourage_read',
            type: 'encouragement',
            createdAt: '2026-07-26T12:00:00.000Z',
            readAt: '2026-07-26T12:01:00.000Z',
          }),
        ],
        incomingRequests: [],
      },
      seenActionIds: new Set(),
      seenRequestIds: new Set(),
    });

    expect(notice).toBeNull();
  });

  it('prioritizes actionable join activity over encouragements and friend requests', () => {
    const notice = selectFocusFriendNotice({
      snapshot: {
        inbox: [
          makeAction({
            id: 'encourage_newer',
            type: 'encouragement',
            createdAt: '2026-07-26T12:05:00.000Z',
          }),
          makeAction({
            id: 'join_request_older',
            type: 'join-request',
            createdAt: '2026-07-26T12:01:00.000Z',
          }),
        ],
        incomingRequests: [
          makeRequest({
            id: 'friend_request_newest',
            createdAt: '2026-07-26T12:10:00.000Z',
          }),
        ],
      },
      seenActionIds: new Set(),
      seenRequestIds: new Set(),
    });

    expect(notice).toMatchObject({
      id: 'join_request_older',
      type: 'action',
      action: { type: 'join-request' },
    });
  });

  it('selects the newest friend request when it is newer than passive activity', () => {
    const notice = selectFocusFriendNotice({
      snapshot: {
        inbox: [
          makeAction({
            id: 'encourage_older',
            type: 'encouragement',
            createdAt: '2026-07-26T12:00:00.000Z',
          }),
        ],
        incomingRequests: [
          makeRequest({
            id: 'friend_request_newer',
            createdAt: '2026-07-26T12:10:00.000Z',
          }),
        ],
      },
      seenActionIds: new Set(),
      seenRequestIds: new Set(),
    });

    expect(notice).toMatchObject({ id: 'friend_request_newer', type: 'request' });
  });

  it('continues to expose older unread encouragements after the newest one is seen', () => {
    const seenActionIds = new Set<string>(['encourage_newer']);
    const notice = selectFocusFriendNotice({
      snapshot: {
        inbox: [
          makeAction({
            id: 'encourage_older',
            type: 'encouragement',
            createdAt: '2026-07-26T12:00:00.000Z',
          }),
          makeAction({
            id: 'encourage_newer',
            type: 'encouragement',
            createdAt: '2026-07-26T12:05:00.000Z',
          }),
        ],
        incomingRequests: [],
      },
      seenActionIds,
      seenRequestIds: new Set(),
    });

    expect(notice).toMatchObject({ id: 'encourage_older', type: 'action' });
  });
});
