

import { AlarmSound } from '../types';

export const resumeAudioContext = async () => {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    return ctx;
  } catch (e) {
    console.error('AudioContext resume failed', e);
  }
};

const playOscillator = (ctx: AudioContext, type: OscillatorType, freq: number, start: number, dur: number, gainVal: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(gainVal, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur);
};

export const playAlarm = async (soundType: AlarmSound) => {
    try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') try { await ctx.resume(); } catch {}
        const now = ctx.currentTime;

        switch (soundType) {
            case 'bell': // Original
                const osc1 = ctx.createOscillator();
                const osc2 = ctx.createOscillator();
                const gain = ctx.createGain();
                const filter = ctx.createBiquadFilter();
                osc1.frequency.setValueAtTime(784, now);
                osc2.frequency.setValueAtTime(784 * 1.5, now);
                osc1.type = 'sine';
                osc2.type = 'sine';
                filter.type = 'bandpass';
                filter.frequency.value = 1500;
                filter.Q.value = 8;
                gain.gain.setValueAtTime(0.0001, now);
                gain.gain.exponentialRampToValueAtTime(0.6, now + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
                osc1.connect(filter);
                osc2.connect(filter);
                filter.connect(gain);
                gain.connect(ctx.destination);
                osc1.start(now);
                osc2.start(now);
                osc1.stop(now + 1.7);
                osc2.stop(now + 1.7);
                break;
            case 'digital':
                playOscillator(ctx, 'square', 880, now, 0.1, 0.1);
                playOscillator(ctx, 'square', 1760, now + 0.1, 0.1, 0.1);
                playOscillator(ctx, 'square', 880, now + 0.2, 0.1, 0.1);
                break;
            case 'chime':
                playOscillator(ctx, 'sine', 523.25, now, 1.5, 0.3);
                playOscillator(ctx, 'sine', 659.25, now + 0.1, 1.5, 0.3);
                playOscillator(ctx, 'sine', 783.99, now + 0.2, 1.5, 0.3);
                break;
            case 'gong':
                 const gOsc = ctx.createOscillator();
                 const gGain = ctx.createGain();
                 gOsc.frequency.setValueAtTime(100, now);
                 gOsc.frequency.exponentialRampToValueAtTime(80, now + 2);
                 gOsc.type = 'triangle';
                 gGain.gain.setValueAtTime(0.5, now);
                 gGain.gain.exponentialRampToValueAtTime(0.001, now + 3);
                 gOsc.connect(gGain);
                 gGain.connect(ctx.destination);
                 gOsc.start(now);
                 gOsc.stop(now + 3);
                 break;
            case 'pop':
                playOscillator(ctx, 'sine', 800, now, 0.1, 0.3);
                break;
            case 'wood':
                playOscillator(ctx, 'sine', 800, now, 0.05, 0.4);
                playOscillator(ctx, 'sine', 1200, now + 0.1, 0.05, 0.2);
                break;
            case 'marimba':
                [440, 554, 659, 880].forEach((freq, i) => {
                    playOscillator(ctx, 'triangle', freq, now + i * 0.08, 0.4, 0.3);
                });
                break;
            case 'crystal':
                [523.25, 783.99, 1046.50].forEach((freq, i) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(freq, now);
                    gain.gain.setValueAtTime(0.1, now);
                    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.1);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 2.5);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(now + i*0.2);
                    osc.stop(now + 3);
                });
                break;
            case 'blade':
                const bOsc = ctx.createOscillator();
                const bGain = ctx.createGain();
                bOsc.type = 'sawtooth';
                bOsc.frequency.setValueAtTime(110, now);
                bOsc.frequency.linearRampToValueAtTime(440, now + 0.5);
                bGain.gain.setValueAtTime(0.1, now);
                bGain.gain.exponentialRampToValueAtTime(0.001, now + 1);
                const bFilter = ctx.createBiquadFilter();
                bFilter.type = 'lowpass';
                bFilter.frequency.setValueAtTime(200, now);
                bFilter.frequency.linearRampToValueAtTime(2000, now + 0.2);
                bOsc.connect(bFilter);
                bFilter.connect(bGain);
                bGain.connect(ctx.destination);
                bOsc.start(now);
                bOsc.stop(now + 1);
                break;
            case 'cosmic':
                const cOsc = ctx.createOscillator();
                const cGain = ctx.createGain();
                cOsc.type = 'sine';
                cOsc.frequency.setValueAtTime(300, now);
                cOsc.frequency.exponentialRampToValueAtTime(1000, now + 0.5);
                cOsc.frequency.exponentialRampToValueAtTime(200, now + 1.5);
                cGain.gain.setValueAtTime(0.2, now);
                cGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
                const delay = ctx.createDelay();
                delay.delayTime.value = 0.2;
                const feedback = ctx.createGain();
                feedback.gain.value = 0.4;
                cOsc.connect(cGain);
                cGain.connect(ctx.destination);
                cGain.connect(delay);
                delay.connect(feedback);
                feedback.connect(delay);
                delay.connect(ctx.destination);
                cOsc.start(now);
                cOsc.stop(now + 1.5);
                break;
            case 'ripple':
                for(let i=0; i<5; i++) {
                     playOscillator(ctx, 'sine', 600 + (i * 50), now + (i * 0.1), 0.5, 0.2 - (i*0.03));
                }
                break;
            case 'news':
                 [500, 750, 1000, 500, 750, 1000].forEach((freq, i) => {
                     playOscillator(ctx, 'square', freq, now + i * 0.08, 0.05, 0.05);
                 });
                 playOscillator(ctx, 'square', 1500, now + 0.5, 0.3, 0.05);
                 break;
        }
    } catch(e) { console.error(e); }
};

export const playBell = () => playAlarm('bell'); // Fallback/Default

export const playSwitch = async () => {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') try { await ctx.resume(); } catch {}
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.05);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.type = 'sine';
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  } catch (_) {}
};