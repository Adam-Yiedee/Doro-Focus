import { describe, expect, it } from 'vitest';
import {
  isGraceCreditedWorkLog,
  isPauseCreditedWorkLog,
  isProductiveFocusLog,
} from './logClassification';

describe('log classification', () => {
  it('treats ordinary work and grace-marked working as productive focus', () => {
    expect(isProductiveFocusLog({ type: 'work', reason: 'Pomodoro Complete' })).toBe(true);
    expect(isProductiveFocusLog({ type: 'work', reason: 'Session End' })).toBe(true);
    expect(isProductiveFocusLog({ type: 'grace', reason: 'Grace Period (Working)' })).toBe(true);
    expect(isProductiveFocusLog({ type: 'grace', reason: '  grace period (WORKING)  ' })).toBe(true);
  });

  it('keeps pause credit, neutral grace, resting grace, and breaks out of productive focus', () => {
    expect(isPauseCreditedWorkLog({ type: 'work', reason: 'Paused session (Pause Credit: Working)' })).toBe(true);
    expect(isProductiveFocusLog({ type: 'work', reason: 'Paused session (Pause Credit: Working)' })).toBe(false);
    expect(isProductiveFocusLog({ type: 'grace', reason: 'Grace Period' })).toBe(false);
    expect(isProductiveFocusLog({ type: 'grace', reason: 'Grace Period (Resting)' })).toBe(false);
    expect(isProductiveFocusLog({ type: 'work', reason: 'Grace Period' })).toBe(false);
    expect(isProductiveFocusLog({ type: 'work', reason: 'Grace Period (Resting)' })).toBe(false);
    expect(isProductiveFocusLog({ type: 'break', reason: 'Break Complete' })).toBe(false);
  });

  it('only upgrades grace logs when the saved grace reason explicitly says working', () => {
    expect(isGraceCreditedWorkLog({ type: 'grace', reason: 'Was working' })).toBe(false);
    expect(isGraceCreditedWorkLog({ type: 'work', reason: 'Grace Period (Working)' })).toBe(false);
  });
});
