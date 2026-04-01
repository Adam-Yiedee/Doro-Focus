
import { AlarmSound, FocusSound } from '../types';

type NoiseColor = 'white' | 'pink' | 'brown';
type FocusSoundPreset = {
  color: NoiseColor;
  gain: number;
  lowpassHz?: number;
  highpassHz?: number;
};

const FOCUS_SOUND_PRESETS: Record<Exclude<FocusSound, 'off'>, FocusSoundPreset> = {
  'white-soft': { color: 'white', gain: 0.055, lowpassHz: 2200 },
  'white-bright': { color: 'white', gain: 0.045, highpassHz: 420, lowpassHz: 5200 },
  'pink-soft': { color: 'pink', gain: 0.06, lowpassHz: 1800 },
  'pink-air': { color: 'pink', gain: 0.05, highpassHz: 180, lowpassHz: 3600 },
  'brown-deep': { color: 'brown', gain: 0.08, lowpassHz: 850 },
  'brown-warm': { color: 'brown', gain: 0.07, highpassHz: 70, lowpassHz: 1500 },
  'green-calm': { color: 'white', gain: 0.055, highpassHz: 140, lowpassHz: 980 },
};

type FocusSoundState = {
  ctx: AudioContext;
  preset: Exclude<FocusSound, 'off'>;
  volume: number;
  source: AudioBufferSourceNode;
  masterGain: GainNode;
  teardown: Array<AudioNode>;
};

let focusSoundState: FocusSoundState | null = null;
let sharedFocusAudioContext: AudioContext | null = null;
let focusSoundRequestToken = 0;

const getBrowserAudioContextConstructor = () => {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || (window as any).webkitAudioContext || null;
};

const nextFocusSoundRequestToken = () => {
  focusSoundRequestToken += 1;
  return focusSoundRequestToken;
};

const isFocusSoundRequestCurrent = (requestToken: number) => focusSoundRequestToken === requestToken;

export const resumeAudioContext = async () => {
  try {
    const AudioCtx = getBrowserAudioContextConstructor();
    if (!AudioCtx) return;

    if (!sharedFocusAudioContext || sharedFocusAudioContext.state === 'closed') {
      sharedFocusAudioContext = new AudioCtx();
    }

    if (sharedFocusAudioContext.state === 'suspended') {
      await sharedFocusAudioContext.resume();
    }
    return sharedFocusAudioContext;
  } catch (e) {
    console.error('AudioContext resume failed', e);
  }
};

const getAudioContext = async () => resumeAudioContext() || null;

const clampFocusSoundVolume = (value: number) => {
  if (!Number.isFinite(value)) return 100;
  return Math.max(0, Math.min(100, value));
};

const getFocusSoundGain = (preset: FocusSoundPreset, volume: number) => (
  Math.max(0, preset.gain * (clampFocusSoundVolume(volume) / 100))
);

const createNoiseBuffer = (ctx: AudioContext, color: NoiseColor, durationSeconds = 2) => {
  const frameCount = Math.max(1, Math.floor(ctx.sampleRate * durationSeconds));
  const buffer = ctx.createBuffer(2, frameCount, ctx.sampleRate);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);

    if (color === 'white') {
      for (let index = 0; index < frameCount; index += 1) {
        data[index] = (Math.random() * 2) - 1;
      }
      continue;
    }

    if (color === 'pink') {
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let b3 = 0;
      let b4 = 0;
      let b5 = 0;
      let b6 = 0;
      for (let index = 0; index < frameCount; index += 1) {
        const white = (Math.random() * 2) - 1;
        b0 = 0.99886 * b0 + (white * 0.0555179);
        b1 = 0.99332 * b1 + (white * 0.0750759);
        b2 = 0.969 * b2 + (white * 0.153852);
        b3 = 0.8665 * b3 + (white * 0.3104856);
        b4 = 0.55 * b4 + (white * 0.5329522);
        b5 = -0.7616 * b5 - (white * 0.016898);
        const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + (white * 0.5362);
        b6 = white * 0.115926;
        data[index] = pink * 0.11;
      }
      continue;
    }

    let lastOut = 0;
    for (let index = 0; index < frameCount; index += 1) {
      const white = (Math.random() * 2) - 1;
      lastOut = (lastOut + (0.02 * white)) / 1.02;
      data[index] = lastOut * 3.5;
    }
  }

  return buffer;
};

const createFocusNoiseSource = (ctx: AudioContext, preset: FocusSoundPreset, volume: number) => {
  const source = ctx.createBufferSource();
  source.buffer = createNoiseBuffer(ctx, preset.color);
  source.loop = true;

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0, ctx.currentTime);
  masterGain.gain.linearRampToValueAtTime(getFocusSoundGain(preset, volume), ctx.currentTime + 0.18);

  let tailNode: AudioNode = source;
  const teardown: AudioNode[] = [source, masterGain];

  if (preset.highpassHz) {
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(preset.highpassHz, ctx.currentTime);
    highpass.Q.value = 0.7;
    tailNode.connect(highpass);
    tailNode = highpass;
    teardown.push(highpass);
  }

  if (preset.lowpassHz) {
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(preset.lowpassHz, ctx.currentTime);
    lowpass.Q.value = 0.7;
    tailNode.connect(lowpass);
    tailNode = lowpass;
    teardown.push(lowpass);
  }

  tailNode.connect(masterGain);
  masterGain.connect(ctx.destination);

  return { source, masterGain, teardown };
};

const updateFocusSoundVolume = (state: FocusSoundState, preset: FocusSoundPreset, volume: number) => {
  state.volume = clampFocusSoundVolume(volume);
  const nextGain = getFocusSoundGain(preset, state.volume);
  try {
    state.masterGain.gain.cancelScheduledValues(state.ctx.currentTime);
    state.masterGain.gain.setValueAtTime(state.masterGain.gain.value, state.ctx.currentTime);
    state.masterGain.gain.linearRampToValueAtTime(nextGain, state.ctx.currentTime + 0.12);
  } catch {}
};

const disconnectFocusSoundState = (state: FocusSoundState) => {
  try {
    state.masterGain.gain.cancelScheduledValues(state.ctx.currentTime);
    state.masterGain.gain.setValueAtTime(state.masterGain.gain.value, state.ctx.currentTime);
    state.masterGain.gain.linearRampToValueAtTime(0, state.ctx.currentTime + 0.12);
  } catch {}

  globalThis.setTimeout(() => {
    try {
      state.source.stop();
    } catch {}
    state.teardown.forEach((node) => {
      try {
        node.disconnect();
      } catch {}
    });
  }, 180);
};

export const stopFocusSound = () => {
  nextFocusSoundRequestToken();
  if (!focusSoundState) return;
  const activeState = focusSoundState;
  focusSoundState = null;
  disconnectFocusSoundState(activeState);
};

export const startFocusSound = async (soundType: FocusSound, volume = 100) => {
  if (soundType === 'off') {
    stopFocusSound();
    return;
  }

  const requestToken = nextFocusSoundRequestToken();

  if (focusSoundState?.preset === soundType) {
    if (focusSoundState.ctx.state === 'suspended') {
      try {
        await focusSoundState.ctx.resume();
      } catch {}
    }
    if (!isFocusSoundRequestCurrent(requestToken)) return;
    updateFocusSoundVolume(focusSoundState, FOCUS_SOUND_PRESETS[soundType], volume);
    return;
  }

  if (focusSoundState) {
    const activeState = focusSoundState;
    focusSoundState = null;
    disconnectFocusSoundState(activeState);
  }
  const ctx = await getAudioContext();
  if (!ctx || !isFocusSoundRequestCurrent(requestToken)) return;
  const preset = FOCUS_SOUND_PRESETS[soundType];
  const safeVolume = clampFocusSoundVolume(volume);
  const { source, masterGain, teardown } = createFocusNoiseSource(ctx, preset, safeVolume);
  if (!isFocusSoundRequestCurrent(requestToken)) {
    disconnectFocusSoundState({ ctx, preset: soundType, volume: safeVolume, source, masterGain, teardown });
    return;
  }
  source.start();
  if (!isFocusSoundRequestCurrent(requestToken)) {
    disconnectFocusSoundState({ ctx, preset: soundType, volume: safeVolume, source, masterGain, teardown });
    return;
  }
  focusSoundState = { ctx, preset: soundType, volume: safeVolume, source, masterGain, teardown };
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

const playTrumpetVoice = (ctx: AudioContext, freq: number, start: number, dur: number, gainVal: number) => {
  const masterGain = ctx.createGain();
  const lowpass = ctx.createBiquadFilter();
  const highpass = ctx.createBiquadFilter();
  const vibrato = ctx.createOscillator();
  const vibratoGain = ctx.createGain();

  lowpass.type = 'lowpass';
  lowpass.frequency.setValueAtTime(2200, start);
  lowpass.frequency.linearRampToValueAtTime(2600, start + 0.08);
  lowpass.Q.value = 0.85;

  highpass.type = 'highpass';
  highpass.frequency.setValueAtTime(180, start);
  highpass.Q.value = 0.7;

  masterGain.gain.setValueAtTime(0.0001, start);
  masterGain.gain.linearRampToValueAtTime(gainVal, start + 0.03);
  masterGain.gain.exponentialRampToValueAtTime(Math.max(0.001, gainVal * 0.5), start + 0.18);
  masterGain.gain.exponentialRampToValueAtTime(0.001, start + dur);

  vibrato.type = 'sine';
  vibrato.frequency.setValueAtTime(5.8, start);
  vibratoGain.gain.setValueAtTime(9, start);
  vibrato.connect(vibratoGain);

  [
    { type: 'sawtooth' as OscillatorType, ratio: 1, gain: 1 },
    { type: 'square' as OscillatorType, ratio: 2, gain: 0.18 },
    { type: 'triangle' as OscillatorType, ratio: 3, gain: 0.14 },
  ].forEach((voice, index) => {
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = voice.type;
    osc.frequency.setValueAtTime(freq * voice.ratio, start);
    osc.detune.setValueAtTime(index === 0 ? -4 : index === 1 ? 3 : 0, start);
    vibratoGain.connect(osc.frequency);
    oscGain.gain.setValueAtTime(voice.gain, start);
    osc.connect(oscGain);
    oscGain.connect(masterGain);
    osc.start(start);
    osc.stop(start + dur + 0.04);
  });

  masterGain.connect(lowpass);
  lowpass.connect(highpass);
  highpass.connect(ctx.destination);

  vibrato.start(start);
  vibrato.stop(start + dur + 0.04);
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

export const playCelebrationTrumpet = async () => {
  try {
    const ctx = await resumeAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    [
      { freq: 392.0, start: 0.00, dur: 0.24, gain: 0.08 },
      { freq: 523.25, start: 0.09, dur: 0.24, gain: 0.08 },
      { freq: 659.25, start: 0.18, dur: 0.28, gain: 0.09 },
      { freq: 783.99, start: 0.30, dur: 0.62, gain: 0.11 },
      { freq: 987.77, start: 0.36, dur: 0.72, gain: 0.085 },
    ].forEach((note) => {
      playTrumpetVoice(ctx, note.freq, now + note.start, note.dur, note.gain);
    });
  } catch (e) {
    console.error('Celebration trumpet failed', e);
  }
};

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
