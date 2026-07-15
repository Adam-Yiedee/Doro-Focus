import { describe, expect, it } from 'vitest';
import { selectLocalPayloadForAccountSync, shouldApplyAccountSyncSnapshot } from './accountSync';

describe('selectLocalPayloadForAccountSync', () => {
  it('prefers live payload for the active signed-in user over stale cache', () => {
    const cachedPayload = {
      updatedAt: '2026-03-15T10:00:00.000Z',
      categories: [{ id: 1, name: 'Math' }],
      tasks: [{ id: 11, name: 'Cached task' }],
    };
    const livePayload = {
      updatedAt: '2026-03-15T10:00:05.000Z',
      categories: [
        { id: 1, name: 'Math' },
        { id: 2, name: 'Physics' },
      ],
      tasks: [
        { id: 11, name: 'Cached task' },
        { id: 12, name: 'Live task' },
      ],
    };

    expect(selectLocalPayloadForAccountSync({
      activeUsername: 'alice',
      targetUsername: 'Alice',
      livePayload,
      cachedPayload,
    })).toBe(livePayload);
  });

  it('falls back to cached payload for a different account', () => {
    const cachedPayload = { updatedAt: '2026-03-15T10:00:00.000Z', categories: [{ id: 1, name: 'Remote' }] };
    const livePayload = { updatedAt: '2026-03-15T10:00:05.000Z', categories: [{ id: 2, name: 'Local' }] };

    expect(selectLocalPayloadForAccountSync({
      activeUsername: 'alice',
      targetUsername: 'bob',
      livePayload,
      cachedPayload,
    })).toBe(cachedPayload);
  });

  it('falls back to live payload when no cache exists', () => {
    const livePayload = { updatedAt: '2026-03-15T10:00:05.000Z', categories: [{ id: 2, name: 'Local' }] };

    expect(selectLocalPayloadForAccountSync({
      activeUsername: 'alice',
      targetUsername: 'alice',
      livePayload,
      cachedPayload: null,
    })).toBe(livePayload);
  });
});

describe('shouldApplyAccountSyncSnapshot', () => {
  it('applies a cloud save response when local sync-worthy data has not changed', () => {
    expect(shouldApplyAccountSyncSnapshot(4, 4)).toBe(true);
  });

  it('rejects a cloud save response that started before newer local changes', () => {
    expect(shouldApplyAccountSyncSnapshot(4, 5)).toBe(false);
  });
});
