
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

type FocusSoundPreviewState = FocusSoundState & {
  stopTimer: ReturnType<typeof globalThis.setTimeout> | null;
};

let focusSoundState: FocusSoundState | null = null;
let focusSoundPreviewState: FocusSoundPreviewState | null = null;
let sharedFocusAudioContext: AudioContext | null = null;
let focusSoundRequestToken = 0;
let focusSoundPreviewRequestToken = 0;

const getBrowserAudioContextConstructor = () => {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || (window as any).webkitAudioContext || null;
};

const nextFocusSoundRequestToken = () => {
  focusSoundRequestToken += 1;
  return focusSoundRequestToken;
};

const isFocusSoundRequestCurrent = (requestToken: number) => focusSoundRequestToken === requestToken;

const nextFocusSoundPreviewRequestToken = () => {
  focusSoundPreviewRequestToken += 1;
  return focusSoundPreviewRequestToken;
};

const isFocusSoundPreviewRequestCurrent = (requestToken: number) => focusSoundPreviewRequestToken === requestToken;

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

const FOCUS_SOUND_MAX_GAIN_MULTIPLIER = 2.35;

const getFocusSoundVolumeScale = (volume: number) => {
  const normalized = clampFocusSoundVolume(volume) / 100;
  if (normalized <= 0) return 0;
  return normalized * (1 + ((FOCUS_SOUND_MAX_GAIN_MULTIPLIER - 1) * normalized * normalized));
};

const getFocusSoundGain = (preset: FocusSoundPreset, volume: number) => (
  Math.max(0, preset.gain * getFocusSoundVolumeScale(volume))
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

const scheduleFocusSoundPreviewStop = (state: FocusSoundPreviewState, durationMs: number) => {
  if (state.stopTimer) {
    globalThis.clearTimeout(state.stopTimer);
    state.stopTimer = null;
  }

  const safeDurationMs = Number.isFinite(durationMs) ? Math.max(500, durationMs) : 2500;
  state.stopTimer = globalThis.setTimeout(() => {
    if (focusSoundPreviewState === state) {
      stopFocusSoundPreview();
    }
  }, safeDurationMs);
};

const disconnectFocusSoundPreviewState = (state: FocusSoundPreviewState) => {
  if (state.stopTimer) {
    globalThis.clearTimeout(state.stopTimer);
    state.stopTimer = null;
  }
  disconnectFocusSoundState(state);
};

export const stopFocusSoundPreview = () => {
  nextFocusSoundPreviewRequestToken();
  if (!focusSoundPreviewState) return;
  const activeState = focusSoundPreviewState;
  focusSoundPreviewState = null;
  disconnectFocusSoundPreviewState(activeState);
};

export const startFocusSoundPreview = async (soundType: FocusSound, volume = 100, durationMs = 2500) => {
  if (soundType === 'off') {
    stopFocusSoundPreview();
    return;
  }

  const requestToken = nextFocusSoundPreviewRequestToken();

  if (focusSoundPreviewState?.preset === soundType) {
    if (focusSoundPreviewState.ctx.state === 'suspended') {
      try {
        await focusSoundPreviewState.ctx.resume();
      } catch {}
    }
    if (!isFocusSoundPreviewRequestCurrent(requestToken) || !focusSoundPreviewState) return;
    updateFocusSoundVolume(focusSoundPreviewState, FOCUS_SOUND_PRESETS[soundType], volume);
    scheduleFocusSoundPreviewStop(focusSoundPreviewState, durationMs);
    return;
  }

  if (focusSoundPreviewState) {
    const activeState = focusSoundPreviewState;
    focusSoundPreviewState = null;
    disconnectFocusSoundPreviewState(activeState);
  }

  const ctx = await getAudioContext();
  if (!ctx || !isFocusSoundPreviewRequestCurrent(requestToken)) return;

  const preset = FOCUS_SOUND_PRESETS[soundType];
  const safeVolume = clampFocusSoundVolume(volume);
  const { source, masterGain, teardown } = createFocusNoiseSource(ctx, preset, safeVolume);
  const previewState: FocusSoundPreviewState = {
    ctx,
    preset: soundType,
    volume: safeVolume,
    source,
    masterGain,
    teardown,
    stopTimer: null,
  };

  if (!isFocusSoundPreviewRequestCurrent(requestToken)) {
    disconnectFocusSoundPreviewState(previewState);
    return;
  }

  source.start();

  if (!isFocusSoundPreviewRequestCurrent(requestToken)) {
    disconnectFocusSoundPreviewState(previewState);
    return;
  }

  focusSoundPreviewState = previewState;
  scheduleFocusSoundPreviewStop(previewState, durationMs);
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

const playSmoothTone = (
  ctx: AudioContext,
  type: OscillatorType,
  freq: number,
  start: number,
  dur: number,
  gainVal: number,
  endFreq?: number,
) => {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (endFreq && endFreq > 0) {
    osc.frequency.exponentialRampToValueAtTime(endFreq, start + (dur * 0.82));
  }
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(gainVal, start + Math.min(0.035, dur * 0.35));
  gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.04);
};

const playNoiseBurst = (
  ctx: AudioContext,
  color: NoiseColor,
  start: number,
  dur: number,
  gainVal: number,
  frequency: number,
  q = 2.4,
) => {
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = createNoiseBuffer(ctx, color, Math.max(0.2, dur));
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(frequency, start);
  filter.Q.value = q;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(gainVal, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(start);
  source.stop(start + dur + 0.02);
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
            case 'harp': {
                [392.00, 493.88, 587.33, 783.99, 987.77].forEach((freq, i) => {
                    playSmoothTone(ctx, 'triangle', freq, now + (i * 0.09), 1.15, 0.2 - (i * 0.018));
                });
                break;
            }
            case 'pulse': {
                [0, 0.18, 0.36, 0.54].forEach((offset, i) => {
                    playSmoothTone(ctx, 'square', i % 2 === 0 ? 220 : 330, now + offset, 0.13, 0.11);
                    playNoiseBurst(ctx, 'pink', now + offset, 0.11, 0.018, 520, 1.4);
                });
                break;
            }
            case 'beacon': {
                [880, 660, 880].forEach((freq, i) => {
                    playSmoothTone(ctx, 'sine', freq, now + (i * 0.28), 0.42, 0.18, freq * 1.035);
                });
                break;
            }
            case 'bubbles': {
                [620, 740, 880, 1046.5, 1318.5, 1568].forEach((freq, i) => {
                    playSmoothTone(ctx, 'sine', freq, now + (i * 0.055), 0.22, 0.13 - (i * 0.01), freq * 1.08);
                });
                break;
            }
            case 'pluck': {
                [246.94, 369.99, 493.88].forEach((freq, i) => {
                    playSmoothTone(ctx, 'triangle', freq, now + (i * 0.07), 0.5, 0.2 - (i * 0.035));
                    playNoiseBurst(ctx, 'brown', now + (i * 0.07), 0.08, 0.018, 1200 + (i * 260), 3);
                });
                break;
            }
            case 'flare': {
                const fOsc = ctx.createOscillator();
                const fGain = ctx.createGain();
                const fFilter = ctx.createBiquadFilter();
                fOsc.type = 'sawtooth';
                fOsc.frequency.setValueAtTime(180, now);
                fOsc.frequency.exponentialRampToValueAtTime(1480, now + 0.58);
                fFilter.type = 'lowpass';
                fFilter.frequency.setValueAtTime(420, now);
                fFilter.frequency.exponentialRampToValueAtTime(3200, now + 0.42);
                fFilter.Q.value = 1.2;
                fGain.gain.setValueAtTime(0.0001, now);
                fGain.gain.linearRampToValueAtTime(0.18, now + 0.04);
                fGain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
                fOsc.connect(fFilter);
                fFilter.connect(fGain);
                fGain.connect(ctx.destination);
                fOsc.start(now);
                fOsc.stop(now + 0.9);
                break;
            }
            case 'drift': {
                [987.77, 739.99, 554.37, 415.3].forEach((freq, i) => {
                    playSmoothTone(ctx, 'sine', freq, now + (i * 0.16), 0.95, 0.16 - (i * 0.02), freq * 0.985);
                });
                break;
            }
            case 'orbit': {
                const oDelay = ctx.createDelay();
                const oFeedback = ctx.createGain();
                oDelay.delayTime.setValueAtTime(0.18, now);
                oFeedback.gain.setValueAtTime(0.26, now);
                oDelay.connect(oFeedback);
                oFeedback.connect(oDelay);
                oDelay.connect(ctx.destination);
                [329.63, 493.88, 659.25, 987.77].forEach((freq, i) => {
                    const oOsc = ctx.createOscillator();
                    const oGain = ctx.createGain();
                    oOsc.type = i % 2 === 0 ? 'sine' : 'triangle';
                    oOsc.frequency.setValueAtTime(freq, now + (i * 0.12));
                    oOsc.detune.setValueAtTime(i % 2 === 0 ? -5 : 6, now + (i * 0.12));
                    oGain.gain.setValueAtTime(0.0001, now + (i * 0.12));
                    oGain.gain.linearRampToValueAtTime(0.12, now + (i * 0.12) + 0.03);
                    oGain.gain.exponentialRampToValueAtTime(0.001, now + (i * 0.12) + 0.7);
                    oOsc.connect(oGain);
                    oGain.connect(ctx.destination);
                    oGain.connect(oDelay);
                    oOsc.start(now + (i * 0.12));
                    oOsc.stop(now + (i * 0.12) + 0.74);
                });
                break;
            }
            case 'twinkle': {
                [1174.66, 1567.98, 1318.51, 1760.0, 2093.0].forEach((freq, i) => {
                    playSmoothTone(ctx, 'sine', freq, now + (i * 0.075), 0.42, 0.12 - (i * 0.012), freq * 1.012);
                });
                playNoiseBurst(ctx, 'white', now + 0.03, 0.34, 0.012, 4200, 3.4);
                break;
            }
            case 'echo': {
                const eDelay = ctx.createDelay();
                const eFeedback = ctx.createGain();
                eDelay.delayTime.setValueAtTime(0.22, now);
                eFeedback.gain.setValueAtTime(0.32, now);
                eDelay.connect(eFeedback);
                eFeedback.connect(eDelay);
                eDelay.connect(ctx.destination);
                [587.33, 739.99, 880].forEach((freq, i) => {
                    const eOsc = ctx.createOscillator();
                    const eGain = ctx.createGain();
                    const start = now + (i * 0.13);
                    eOsc.type = 'sine';
                    eOsc.frequency.setValueAtTime(freq, start);
                    eGain.gain.setValueAtTime(0.0001, start);
                    eGain.gain.linearRampToValueAtTime(0.13 - (i * 0.02), start + 0.025);
                    eGain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
                    eOsc.connect(eGain);
                    eGain.connect(ctx.destination);
                    eGain.connect(eDelay);
                    eOsc.start(start);
                    eOsc.stop(start + 0.5);
                });
                break;
            }
            case 'sprout': {
                [329.63, 392, 493.88, 659.25].forEach((freq, i) => {
                    playSmoothTone(ctx, 'triangle', freq, now + (i * 0.1), 0.75, 0.14 + (i * 0.012), freq * 1.045);
                });
                playNoiseBurst(ctx, 'pink', now + 0.05, 0.42, 0.012, 1800, 0.9);
                break;
            }
            case 'comet': {
                const cometOsc = ctx.createOscillator();
                const cometGain = ctx.createGain();
                const cometFilter = ctx.createBiquadFilter();
                cometOsc.type = 'sine';
                cometOsc.frequency.setValueAtTime(1568, now);
                cometOsc.frequency.exponentialRampToValueAtTime(220, now + 0.62);
                cometFilter.type = 'bandpass';
                cometFilter.frequency.setValueAtTime(1800, now);
                cometFilter.frequency.exponentialRampToValueAtTime(420, now + 0.55);
                cometFilter.Q.value = 2.2;
                cometGain.gain.setValueAtTime(0.0001, now);
                cometGain.gain.linearRampToValueAtTime(0.18, now + 0.035);
                cometGain.gain.exponentialRampToValueAtTime(0.001, now + 0.76);
                cometOsc.connect(cometFilter);
                cometFilter.connect(cometGain);
                cometGain.connect(ctx.destination);
                cometOsc.start(now);
                cometOsc.stop(now + 0.82);
                break;
            }
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
      { freq: 392.0, start: 0.00, dur: 0.22, gain: 0.054 },
      { freq: 523.25, start: 0.1, dur: 0.22, gain: 0.056 },
      { freq: 659.25, start: 0.2, dur: 0.26, gain: 0.064 },
      { freq: 783.99, start: 0.34, dur: 0.56, gain: 0.078 },
      { freq: 987.77, start: 0.42, dur: 0.62, gain: 0.056 },
    ].forEach((note) => {
      playTrumpetVoice(ctx, note.freq, now + note.start, note.dur, note.gain);
    });
  } catch (e) {
    console.error('Celebration trumpet failed', e);
  }
};

export const playEncouragementDing = async () => {
  try {
    const ctx = await resumeAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    playSmoothTone(ctx, 'triangle', 523.25, now, 0.2, 0.032, 698.46);
    playSmoothTone(ctx, 'sine', 783.99, now + 0.045, 0.28, 0.024, 1046.5);
    playSmoothTone(ctx, 'sine', 1318.51, now + 0.12, 0.34, 0.014, 1174.66);
    playNoiseBurst(ctx, 'pink', now + 0.012, 0.11, 0.0048, 2200, 2.6);
  } catch (e) {
    console.error('Encouragement ding failed', e);
  }
};

export const playSummaryStatPop = async (delayMs = 0, pitchIndex = 0) => {
  try {
    const ctx = await resumeAudioContext();
    if (!ctx) return;
    const start = ctx.currentTime + (Math.max(0, delayMs) / 1000);
    const baseFrequency = 430 + ((pitchIndex % 5) * 46);

    playSmoothTone(ctx, 'triangle', baseFrequency, start, 0.16, 0.024, baseFrequency * 1.32);
    playSmoothTone(ctx, 'sine', baseFrequency * 1.68, start + 0.032, 0.2, 0.011, baseFrequency * 1.82);
    playNoiseBurst(ctx, 'pink', start + 0.008, 0.075, 0.0045, 1450 + ((pitchIndex % 4) * 190), 2.2);
  } catch (e) {
    console.error('Summary stat pop failed', e);
  }
};

const easeSummarySoundTime = (progress: number) => (
  0.5 - (Math.cos(Math.PI * Math.max(0, Math.min(1, progress))) / 2)
);

export const playSummaryCountSound = async (
  value: number | string,
  durationMs: number,
  delayMs = 0,
) => {
  try {
    const numericValue = Math.abs(Number(value));
    if (!Number.isFinite(numericValue) || numericValue <= 0) return;

    const ctx = await resumeAudioContext();
    if (!ctx) return;

    const start = ctx.currentTime + (Math.max(0, delayMs) / 1000);
    const durationSeconds = Math.max(0.38, Math.min(1.7, durationMs / 1000));
    const isSmallValue = numericValue <= 12;
    const tickCount = isSmallValue
      ? Math.max(1, Math.min(6, Math.round(numericValue)))
      : Math.max(6, Math.min(11, Math.round(Math.log10(numericValue + 1) * 4.4)));

    if (isSmallValue) {
      Array.from({ length: tickCount }).forEach((_, index) => {
        const progress = tickCount <= 1 ? 0.5 : index / (tickCount - 1);
        const offset = 0.045 + (easeSummarySoundTime(progress) * Math.max(0.12, durationSeconds - 0.16));
        const frequency = 540 + (index * 34) + Math.min(110, numericValue * 6);
        playSmoothTone(ctx, 'sine', frequency, start + offset, 0.095, 0.011, frequency * 1.055);
      });
      return;
    }

    playSmoothTone(ctx, 'triangle', 280 + Math.min(180, numericValue * 0.2), start + 0.04, durationSeconds * 0.96, 0.0075, 720 + Math.min(420, numericValue * 0.48));
    Array.from({ length: tickCount }).forEach((_, index) => {
      const progress = tickCount <= 1 ? 0.5 : index / (tickCount - 1);
      const offset = 0.06 + (easeSummarySoundTime(progress) * Math.max(0.18, durationSeconds - 0.2));
      const frequency = 420 + (progress * 540) + Math.min(150, Math.log10(numericValue + 1) * 36);
      playSmoothTone(ctx, index % 2 === 0 ? 'triangle' : 'sine', frequency, start + offset, 0.07, 0.0075, frequency * 1.012);
    });
  } catch (e) {
    console.error('Summary count sound failed', e);
  }
};

type SummaryDistributionSoundSegment = {
  share?: number;
};

export const playSummaryDistributionSound = async (
  segments: SummaryDistributionSoundSegment[],
  baseDelayMs: number,
  segmentGapMs: number,
  drawDurationMs = 720,
) => {
  try {
    if (segments.length === 0) return;

    const ctx = await resumeAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const scale = [293.66, 329.63, 392.0, 493.88, 587.33, 659.25, 783.99];
    const drawDurationSeconds = Math.max(0.42, Math.min(0.9, drawDurationMs / 1000));

    segments.forEach((segment, index) => {
      const share = Number.isFinite(segment.share) ? Math.max(0.04, Math.min(1, Number(segment.share))) : 0.18;
      const start = now + (Math.max(0, baseDelayMs + (index * segmentGapMs)) / 1000);
      const baseFrequency = scale[index % scale.length];
      const liftFrequency = baseFrequency * (1.08 + (share * 0.1));
      const softGain = 0.006 + (Math.min(0.42, share) * 0.012);

      playNoiseBurst(ctx, 'pink', start + 0.018, drawDurationSeconds * 0.42, 0.0026 + (share * 0.003), 1200 + (index * 170), 1.5);
      playSmoothTone(ctx, 'triangle', baseFrequency, start + 0.035, drawDurationSeconds * 0.86, softGain, liftFrequency);
      playSmoothTone(ctx, 'sine', baseFrequency * 1.5, start + (drawDurationSeconds * 0.48), 0.24, softGain * 0.52, baseFrequency * 1.52);
    });

    const settleStart = now + (
      Math.max(0, baseDelayMs + ((segments.length - 1) * segmentGapMs) + drawDurationMs + 120) / 1000
    );
    playSmoothTone(ctx, 'sine', 523.25, settleStart, 0.32, 0.014, 523.25 * 0.995);
    playSmoothTone(ctx, 'triangle', 783.99, settleStart + 0.045, 0.36, 0.0085, 783.99 * 1.006);
  } catch (e) {
    console.error('Summary distribution sound failed', e);
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
