type PayloadLike = {
  updatedAt?: string;
};

const normalizeUsername = (value: string | null | undefined) => (
  typeof value === 'string' ? value.trim().toLowerCase() : ''
);

export const selectLocalPayloadForAccountSync = <T extends PayloadLike>(
  options: {
    activeUsername?: string | null;
    targetUsername?: string | null;
    livePayload?: T | null;
    cachedPayload?: T | null;
  },
): T | null => {
  const activeUsername = normalizeUsername(options.activeUsername);
  const targetUsername = normalizeUsername(options.targetUsername);

  if (options.livePayload && activeUsername && activeUsername === targetUsername) {
    return options.livePayload;
  }

  if (options.cachedPayload) {
    return options.cachedPayload;
  }

  return options.livePayload ?? null;
};

export const getStableLocalUpdatedAtForAccountRefresh = (
  cachedPayload?: PayloadLike | null,
  remotePayload?: PayloadLike | null,
): string | undefined => {
  if (typeof cachedPayload?.updatedAt === 'string') return cachedPayload.updatedAt;
  if (typeof remotePayload?.updatedAt === 'string') return remotePayload.updatedAt;
  return undefined;
};

export const shouldApplyAccountSyncSnapshot = (
  syncVersionAtStart: number,
  currentSyncVersion: number,
): boolean => currentSyncVersion === syncVersionAtStart;
