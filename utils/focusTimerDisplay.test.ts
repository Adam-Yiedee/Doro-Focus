import { describe, expect, it } from 'vitest';
import { LogEntry } from '../types';
import {
  getCurrentTimerActivityStartMs,
  getFocusTimerDisplaySeconds,
  getSessionTimerFocusSeconds,
} from './focusTimerDisplay';

const makeLog = (overrides: Partial<LogEntry>): LogEntry => ({
  type: 'work',
  start: '2026-07-18T09:00:00.000Z',
  end: '2026-07-18T09:25:00.000Z',
  duration: 25 * 60,
  reason: 'Pomodoro Complete',
  source: 'timer',
  task: null,
  categoryId: null,
  ...overrides,
});

describe('focus timer display accounting', () => {
  it('counts up from the session start when no activity has been logged yet', () => {
    expect(getFocusTimerDisplaySeconds({
      logs: [],
      sessionStartTime: '2026-07-18T09:00:00.000Z',
      nowMs: Date.parse('2026-07-18T09:12:00.000Z'),
      timerStarted: true,
      isIdle: false,
      activeMode: 'work',
    })).toBe(12 * 60);
  });

  it('adds a completed pomodoro log to the current auto-started focus segment', () => {
    const logs = [
      makeLog({
        start: '2026-07-18T09:00:00.000Z',
        end: '2026-07-18T09:25:00.000Z',
        duration: 25 * 60,
        reason: 'Pomodoro Complete',
      }),
    ];

    expect(getFocusTimerDisplaySeconds({
      logs,
      sessionStartTime: '2026-07-18T09:00:00.000Z',
      nowMs: Date.parse('2026-07-18T09:40:00.000Z'),
      timerStarted: true,
      isIdle: false,
      activeMode: 'work',
    })).toBe(40 * 60);
  });

  it('stops counting up while break is active', () => {
    const logs = [
      makeLog({
        start: '2026-07-18T09:00:00.000Z',
        end: '2026-07-18T09:25:00.000Z',
        duration: 25 * 60,
      }),
    ];

    expect(getFocusTimerDisplaySeconds({
      logs,
      sessionStartTime: '2026-07-18T09:00:00.000Z',
      nowMs: Date.parse('2026-07-18T09:35:00.000Z'),
      timerStarted: true,
      isIdle: false,
      activeMode: 'break',
    })).toBe(25 * 60);
  });

  it('resumes count-up from the end of the latest break log', () => {
    const logs = [
      makeLog({
        start: '2026-07-18T09:00:00.000Z',
        end: '2026-07-18T09:25:00.000Z',
        duration: 25 * 60,
      }),
      makeLog({
        type: 'break',
        start: '2026-07-18T09:25:00.000Z',
        end: '2026-07-18T09:30:00.000Z',
        duration: 5 * 60,
        reason: 'Break Complete',
      }),
    ];

    expect(getFocusTimerDisplaySeconds({
      logs,
      sessionStartTime: '2026-07-18T09:00:00.000Z',
      nowMs: Date.parse('2026-07-18T09:42:00.000Z'),
      timerStarted: true,
      isIdle: false,
      activeMode: 'work',
    })).toBe(37 * 60);
  });

  it('uses the live work start instead of stale logs after a quick break-to-focus switch', () => {
    const logs = [
      makeLog({
        start: '2026-07-18T09:00:00.000Z',
        end: '2026-07-18T09:10:00.000Z',
        duration: 10 * 60,
        reason: 'Switch',
      }),
    ];

    expect(getFocusTimerDisplaySeconds({
      logs,
      sessionStartTime: '2026-07-18T09:00:00.000Z',
      nowMs: Date.parse('2026-07-18T09:15:01.000Z'),
      timerStarted: true,
      isIdle: false,
      activeMode: 'work',
      currentActivityStartTime: '2026-07-18T09:15:00.000Z',
    })).toBe((10 * 60) + 1);
  });

  it('does not count a live work start without a valid session anchor', () => {
    expect(getFocusTimerDisplaySeconds({
      logs: [],
      sessionStartTime: null,
      nowMs: Date.parse('2026-07-18T09:15:01.000Z'),
      timerStarted: true,
      isIdle: false,
      activeMode: 'work',
      currentActivityStartTime: '2026-07-18T09:15:00.000Z',
    })).toBe(0);
  });

  it('clamps a live work start to the session window', () => {
    expect(getFocusTimerDisplaySeconds({
      logs: [],
      sessionStartTime: '2026-07-18T09:00:00.000Z',
      nowMs: Date.parse('2026-07-18T09:01:00.000Z'),
      timerStarted: true,
      isIdle: false,
      activeMode: 'work',
      currentActivityStartTime: '2026-07-18T08:55:00.000Z',
    })).toBe(60);
  });

  it('does not double-count logged work around a pause and resume', () => {
    const logs = [
      makeLog({
        start: '2026-07-18T09:00:00.000Z',
        end: '2026-07-18T09:10:00.000Z',
        duration: 10 * 60,
        reason: 'Timer Paused',
      }),
      makeLog({
        type: 'allpause',
        start: '2026-07-18T09:10:00.000Z',
        end: '2026-07-18T09:20:00.000Z',
        duration: 10 * 60,
        reason: 'Paused',
      }),
    ];

    expect(getFocusTimerDisplaySeconds({
      logs,
      sessionStartTime: '2026-07-18T09:00:00.000Z',
      nowMs: Date.parse('2026-07-18T09:32:00.000Z'),
      timerStarted: true,
      isIdle: false,
      activeMode: 'work',
    })).toBe(22 * 60);
  });

  it('ignores manual work, pause-credit work, and work outside the session window', () => {
    const logs = [
      makeLog({
        start: '2026-07-18T08:55:00.000Z',
        end: '2026-07-18T09:05:00.000Z',
        duration: 10 * 60,
      }),
      makeLog({
        start: '2026-07-18T09:05:00.000Z',
        end: '2026-07-18T09:10:00.000Z',
        duration: 5 * 60,
        source: 'manual',
        reason: 'Manual Focus',
      }),
      makeLog({
        start: '2026-07-18T09:10:00.000Z',
        end: '2026-07-18T09:15:00.000Z',
        duration: 5 * 60,
        reason: 'Paused session (Pause Credit: Working)',
      }),
      makeLog({
        start: '2026-07-18T10:00:00.000Z',
        end: '2026-07-18T10:25:00.000Z',
        duration: 25 * 60,
      }),
    ];

    expect(getSessionTimerFocusSeconds(
      logs,
      '2026-07-18T09:00:00.000Z',
      Date.parse('2026-07-18T09:30:00.000Z'),
    )).toBe(5 * 60);
  });

  it('ignores future timer logs when finding the current active segment start', () => {
    const logs = [
      makeLog({
        start: '2026-07-18T09:00:00.000Z',
        end: '2026-07-18T09:05:00.000Z',
        duration: 5 * 60,
      }),
      makeLog({
        type: 'break',
        start: '2026-07-18T09:05:00.000Z',
        end: '2026-07-18T09:10:00.000Z',
        duration: 5 * 60,
      }),
      makeLog({
        type: 'break',
        start: '2026-07-18T09:25:00.000Z',
        end: '2026-07-18T09:35:00.000Z',
        duration: 10 * 60,
      }),
    ];
    const nowMs = Date.parse('2026-07-18T09:20:00.000Z');

    expect(getCurrentTimerActivityStartMs(
      logs,
      '2026-07-18T09:00:00.000Z',
      nowMs,
    )).toBe(Date.parse('2026-07-18T09:10:00.000Z'));
    expect(getFocusTimerDisplaySeconds({
      logs,
      sessionStartTime: '2026-07-18T09:00:00.000Z',
      nowMs,
      timerStarted: true,
      isIdle: false,
      activeMode: 'work',
    })).toBe(15 * 60);
  });

  it('returns only logged work when the timer is stopped or there is no session', () => {
    const logs = [
      makeLog({
        start: '2026-07-18T09:00:00.000Z',
        end: '2026-07-18T09:25:00.000Z',
        duration: 25 * 60,
      }),
    ];

    expect(getFocusTimerDisplaySeconds({
      logs,
      sessionStartTime: '2026-07-18T09:00:00.000Z',
      nowMs: Date.parse('2026-07-18T09:40:00.000Z'),
      timerStarted: false,
      isIdle: false,
      activeMode: 'work',
    })).toBe(25 * 60);

    expect(getFocusTimerDisplaySeconds({
      logs,
      sessionStartTime: null,
      nowMs: Date.parse('2026-07-18T09:40:00.000Z'),
      timerStarted: true,
      isIdle: false,
      activeMode: 'work',
    })).toBe(0);
  });

  it('keeps an unlogged partial segment visible when the work timer is manually stopped', () => {
    expect(getFocusTimerDisplaySeconds({
      logs: [],
      sessionStartTime: '2026-07-18T09:00:00.000Z',
      nowMs: Date.parse('2026-07-18T09:15:00.000Z'),
      timerStarted: false,
      isIdle: false,
      activeMode: 'work',
      workTime: 10 * 60,
      workDuration: 25 * 60,
    })).toBe(15 * 60);
  });

  it('does not double-count stopped work during all-pause or grace states', () => {
    const logs = [
      makeLog({
        start: '2026-07-18T09:00:00.000Z',
        end: '2026-07-18T09:10:00.000Z',
        duration: 10 * 60,
        reason: 'Timer Paused',
      }),
    ];

    const baseInput = {
      logs,
      sessionStartTime: '2026-07-18T09:00:00.000Z',
      nowMs: Date.parse('2026-07-18T09:15:00.000Z'),
      timerStarted: false,
      isIdle: false,
      activeMode: 'work' as const,
      workTime: 15 * 60,
      workDuration: 25 * 60,
    };

    expect(getFocusTimerDisplaySeconds({
      ...baseInput,
      allPauseActive: true,
    })).toBe(10 * 60);

    expect(getFocusTimerDisplaySeconds({
      ...baseInput,
      graceOpen: true,
    })).toBe(10 * 60);
  });
});
