import type { LogEntry } from '../types';

export const normalizeLogReason = (reason: unknown) => (
  typeof reason === 'string' ? reason.trim().toLowerCase() : ''
);

export const isPauseCreditedWorkLog = (
  entry: Pick<LogEntry, 'type' | 'reason'>,
): boolean => {
  if (entry.type !== 'work') return false;
  const reason = normalizeLogReason(entry.reason);
  return reason.startsWith('paused') || reason.includes('pause credit');
};

export const isGraceCreditedWorkLog = (
  entry: Pick<LogEntry, 'type' | 'reason'>,
): boolean => {
  if (entry.type !== 'grace') return false;
  const reason = normalizeLogReason(entry.reason);
  return reason.startsWith('grace period') && /\bworking\b/.test(reason);
};

export const isProductiveFocusLog = (
  entry: Pick<LogEntry, 'type' | 'reason'>,
): boolean => {
  const reason = normalizeLogReason(entry.reason);

  if (entry.type === 'work') {
    if (reason.startsWith('paused') || reason.includes('pause credit')) return false;
    if (reason.startsWith('grace period')) return /\bworking\b/.test(reason);
    return true;
  }

  return isGraceCreditedWorkLog(entry);
};
