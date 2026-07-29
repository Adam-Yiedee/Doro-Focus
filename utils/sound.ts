
import { AlarmSound, FocusSound } from '../types';
import streakFireWhooshUrl from '../assets/streak-fire-whoosh.mp3';
import streakDayPopUrl from '../assets/streak-day-pop.mp3';
import streakSuccessFanfareUrl from '../assets/streak-success-fanfare.mp3';
import timerSwitchTapUrl from '../assets/timer-switch-tap.mp3';

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
let streakFireWhooshBuffer: AudioBuffer | null = null;
let streakFireWhooshBufferPromise: Promise<AudioBuffer | null> | null = null;
let streakDayPopArrayBuffer: ArrayBuffer | null = null;
let streakDayPopArrayBufferPromise: Promise<ArrayBuffer | null> | null = null;
let streakDayPopBuffer: AudioBuffer | null = null;
let streakDayPopBufferPromise: Promise<AudioBuffer | null> | null = null;
let streakSuccessFanfareArrayBuffer: ArrayBuffer | null = null;
let streakSuccessFanfareArrayBufferPromise: Promise<ArrayBuffer | null> | null = null;
let streakSuccessFanfareBuffer: AudioBuffer | null = null;
let streakSuccessFanfareBufferPromise: Promise<AudioBuffer | null> | null = null;
let timerSwitchTapArrayBuffer: ArrayBuffer | null = null;
let timerSwitchTapArrayBufferPromise: Promise<ArrayBuffer | null> | null = null;
let timerSwitchTapBuffer: AudioBuffer | null = null;
let timerSwitchTapBufferPromise: Promise<AudioBuffer | null> | null = null;

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

export const clampAlarmSoundVolume = (value: number) => {
  if (!Number.isFinite(value)) return 100;
  return Math.max(0, Math.min(100, value));
};

const getAlarmSoundVolumeScale = (volume: number) => clampAlarmSoundVolume(volume) / 100;

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

const playOscillator = (
  ctx: AudioContext,
  type: OscillatorType,
  freq: number,
  start: number,
  dur: number,
  gainVal: number,
  destination: AudioNode = ctx.destination,
) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(gainVal, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.connect(gain);
    gain.connect(destination);
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
  destination: AudioNode = ctx.destination,
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
  gain.connect(destination);
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
  destination: AudioNode = ctx.destination,
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
  gain.connect(destination);
  source.start(start);
  source.stop(start + dur + 0.02);
};

const getStreakFireWhooshBuffer = (ctx: AudioContext) => {
  if (streakFireWhooshBuffer) return Promise.resolve(streakFireWhooshBuffer);
  if (typeof fetch !== 'function') return Promise.resolve(null);

  if (!streakFireWhooshBufferPromise) {
    streakFireWhooshBufferPromise = fetch(streakFireWhooshUrl)
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .then((arrayBuffer) => (
        arrayBuffer ? ctx.decodeAudioData(arrayBuffer.slice(0)) : null
      ))
      .then((buffer) => {
        streakFireWhooshBuffer = buffer;
        return buffer;
      })
      .catch((error) => {
        console.error('Streak fire whoosh failed to load', error);
        streakFireWhooshBufferPromise = null;
        return null;
      });
  }

  return streakFireWhooshBufferPromise;
};

type FocusStreakMomentDaySound = {
  status?: string | null;
} | null | undefined;

type FocusStreakDayNote = {
  index: number;
  offsetSeconds: number;
  playbackRate: number;
};

type FocusStreakMomentSoundOptions = {
  streakIncreased?: boolean;
};
type TimerSwitchSoundVariant = 'default' | 'break-bank';

const FOCUS_STREAK_DAY_NOTE_BASE_SECONDS = 3.12;
const FOCUS_STREAK_DAY_NOTE_STEP_SECONDS = 0.048;
const FOCUS_STREAK_DAY_NOTE_SLOT_COUNT = 7;
const FOCUS_STREAK_DAY_POP_GAIN = 1.85;
const FOCUS_STREAK_SUCCESS_FANFARE_AFTER_FIRE_SECONDS = 1.82;

export const getFocusStreakDayNotePlaybackRate = (
  index: number,
  totalSlots = FOCUS_STREAK_DAY_NOTE_SLOT_COUNT,
) => {
  const safeTotalSlots = Number.isFinite(totalSlots) ? Math.max(1, Math.floor(totalSlots)) : FOCUS_STREAK_DAY_NOTE_SLOT_COUNT;
  const safeIndex = Number.isFinite(index)
    ? Math.max(0, Math.min(safeTotalSlots - 1, Math.floor(index)))
    : 0;
  const semitoneOffset = safeIndex - (safeTotalSlots - 1);
  return Math.pow(2, semitoneOffset / 12);
};

export const getFocusStreakMomentDayNotes = (
  days: FocusStreakMomentDaySound[] = [],
): FocusStreakDayNote[] => (
  days
    .map((day, index) => {
      if (!day?.status) return null;
      return {
        index,
        offsetSeconds: FOCUS_STREAK_DAY_NOTE_BASE_SECONDS + (index * FOCUS_STREAK_DAY_NOTE_STEP_SECONDS),
        playbackRate: getFocusStreakDayNotePlaybackRate(index, Math.max(FOCUS_STREAK_DAY_NOTE_SLOT_COUNT, days.length)),
      };
    })
    .filter((note): note is FocusStreakDayNote => Boolean(note))
);

const getStreakDayPopArrayBuffer = () => {
  if (streakDayPopArrayBuffer) return Promise.resolve(streakDayPopArrayBuffer);
  if (typeof fetch !== 'function') return Promise.resolve(null);

  if (!streakDayPopArrayBufferPromise) {
    streakDayPopArrayBufferPromise = fetch(streakDayPopUrl)
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .then((arrayBuffer) => {
        if (!arrayBuffer) {
          streakDayPopArrayBufferPromise = null;
          return null;
        }
        streakDayPopArrayBuffer = arrayBuffer;
        return arrayBuffer;
      })
      .catch((error) => {
        console.error('Streak day pop failed to preload', error);
        streakDayPopArrayBufferPromise = null;
        return null;
      });
  }

  return streakDayPopArrayBufferPromise;
};

const getStreakSuccessFanfareArrayBuffer = () => {
  if (streakSuccessFanfareArrayBuffer) return Promise.resolve(streakSuccessFanfareArrayBuffer);
  if (typeof fetch !== 'function') return Promise.resolve(null);

  if (!streakSuccessFanfareArrayBufferPromise) {
    streakSuccessFanfareArrayBufferPromise = fetch(streakSuccessFanfareUrl)
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .then((arrayBuffer) => {
        if (!arrayBuffer) {
          streakSuccessFanfareArrayBufferPromise = null;
          return null;
        }
        streakSuccessFanfareArrayBuffer = arrayBuffer;
        return arrayBuffer;
      })
      .catch((error) => {
        console.error('Streak success fanfare failed to preload', error);
        streakSuccessFanfareArrayBufferPromise = null;
        return null;
      });
  }

  return streakSuccessFanfareArrayBufferPromise;
};

const getTimerSwitchTapArrayBuffer = () => {
  if (timerSwitchTapArrayBuffer) return Promise.resolve(timerSwitchTapArrayBuffer);
  if (typeof fetch !== 'function') return Promise.resolve(null);

  if (!timerSwitchTapArrayBufferPromise) {
    timerSwitchTapArrayBufferPromise = fetch(timerSwitchTapUrl)
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .then((arrayBuffer) => {
        if (!arrayBuffer) {
          timerSwitchTapArrayBufferPromise = null;
          return null;
        }
        timerSwitchTapArrayBuffer = arrayBuffer;
        return arrayBuffer;
      })
      .catch((error) => {
        console.error('Timer switch tap failed to preload', error);
        timerSwitchTapArrayBufferPromise = null;
        return null;
      });
  }

  return timerSwitchTapArrayBufferPromise;
};

export const preloadNotificationSounds = async () => {
  await Promise.all([
    getStreakDayPopArrayBuffer(),
    getStreakSuccessFanfareArrayBuffer(),
    getTimerSwitchTapArrayBuffer(),
  ]);
};

export const preloadFocusStreakMomentSounds = preloadNotificationSounds;

const getStreakDayPopBuffer = (ctx: AudioContext) => {
  if (streakDayPopBuffer) return Promise.resolve(streakDayPopBuffer);

  if (!streakDayPopBufferPromise) {
    streakDayPopBufferPromise = getStreakDayPopArrayBuffer()
      .then((arrayBuffer) => (
        arrayBuffer ? ctx.decodeAudioData(arrayBuffer.slice(0)) : null
      ))
      .then((buffer) => {
        if (!buffer) {
          streakDayPopBufferPromise = null;
          return null;
        }
        streakDayPopBuffer = buffer;
        return buffer;
      })
      .catch((error) => {
        console.error('Streak day pop failed to load', error);
        streakDayPopBufferPromise = null;
        return null;
      });
  }

  return streakDayPopBufferPromise;
};

const getStreakSuccessFanfareBuffer = (ctx: AudioContext) => {
  if (streakSuccessFanfareBuffer) return Promise.resolve(streakSuccessFanfareBuffer);

  if (!streakSuccessFanfareBufferPromise) {
    streakSuccessFanfareBufferPromise = getStreakSuccessFanfareArrayBuffer()
      .then((arrayBuffer) => (
        arrayBuffer ? ctx.decodeAudioData(arrayBuffer.slice(0)) : null
      ))
      .then((buffer) => {
        if (!buffer) {
          streakSuccessFanfareBufferPromise = null;
          return null;
        }
        streakSuccessFanfareBuffer = buffer;
        return buffer;
      })
      .catch((error) => {
        console.error('Streak success fanfare failed to load', error);
        streakSuccessFanfareBufferPromise = null;
        return null;
      });
  }

  return streakSuccessFanfareBufferPromise;
};

const getTimerSwitchTapBuffer = (ctx: AudioContext) => {
  if (timerSwitchTapBuffer) return Promise.resolve(timerSwitchTapBuffer);

  if (!timerSwitchTapBufferPromise) {
    timerSwitchTapBufferPromise = getTimerSwitchTapArrayBuffer()
      .then((arrayBuffer) => (
        arrayBuffer ? ctx.decodeAudioData(arrayBuffer.slice(0)) : null
      ))
      .then((buffer) => {
        if (!buffer) {
          timerSwitchTapBufferPromise = null;
          return null;
        }
        timerSwitchTapBuffer = buffer;
        return buffer;
      })
      .catch((error) => {
        console.error('Timer switch tap failed to load', error);
        timerSwitchTapBufferPromise = null;
        return null;
      });
  }

  return timerSwitchTapBufferPromise;
};

type SoftPopSampleOptions = {
  playbackRate?: number;
  gain?: number;
  maxDuration?: number;
  maxLateSeconds?: number;
};

const scheduleSoftPopSample = (
  ctx: AudioContext,
  start: number,
  buffer: AudioBuffer | null,
  {
    playbackRate = 1,
    gain = 0.72,
    maxDuration = 0.58,
    maxLateSeconds = 0.22,
  }: SoftPopSampleOptions = {},
) => {
  try {
    if (!buffer) return false;

    const latestStart = start + maxLateSeconds;
    if (ctx.currentTime > latestStart) return false;

    const safeStart = Math.max(start, ctx.currentTime + 0.025);
    if (safeStart > latestStart) return false;

    const safePlaybackRate = Number.isFinite(playbackRate) && playbackRate > 0
      ? playbackRate
      : 1;
    const duration = Math.min(buffer.duration / safePlaybackRate, maxDuration);
    const source = ctx.createBufferSource();
    const gainNode = ctx.createGain();

    source.buffer = buffer;
    source.playbackRate.setValueAtTime(safePlaybackRate, safeStart);

    gainNode.gain.setValueAtTime(0.0001, safeStart);
    gainNode.gain.linearRampToValueAtTime(gain, safeStart + 0.012);
    gainNode.gain.exponentialRampToValueAtTime(0.001, safeStart + Math.max(0.08, duration));

    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start(safeStart);
    source.stop(safeStart + duration + 0.02);
    return true;
  } catch (error) {
    console.error('Soft pop sample failed to schedule', error);
    return false;
  }
};

const scheduleDefaultNotificationPopSample = (
  ctx: AudioContext,
  start: number,
  buffer: AudioBuffer | null,
  maxLateSeconds = 0.18,
) => scheduleSoftPopSample(ctx, start, buffer, {
  gain: 0.58,
  maxDuration: 0.42,
  maxLateSeconds,
});

const scheduleStreakFireWhoosh = (
  ctx: AudioContext,
  start: number,
  buffer: AudioBuffer | null,
  maxLateSeconds = 0.18,
) => {
  try {
    if (!buffer) return false;

    const latestStart = start + maxLateSeconds;
    if (ctx.currentTime > latestStart) return false;

    const safeStart = Math.max(start, ctx.currentTime + 0.025);
    if (safeStart > latestStart) return false;

    const duration = Math.min(buffer.duration, 2.75);
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();

    source.buffer = buffer;
    source.playbackRate.setValueAtTime(1.02, safeStart);

    gain.gain.setValueAtTime(0.0001, safeStart);
    gain.gain.linearRampToValueAtTime(3.75, safeStart + 0.035);
    gain.gain.exponentialRampToValueAtTime(2.8, safeStart + Math.min(0.42, duration * 0.36));
    gain.gain.exponentialRampToValueAtTime(0.001, safeStart + duration);

    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(safeStart);
    source.stop(safeStart + duration + 0.04);
    return true;
  } catch (error) {
    console.error('Streak fire whoosh failed to schedule', error);
    return false;
  }
};

const scheduleStreakSuccessFanfare = (
  ctx: AudioContext,
  start: number,
  buffer: AudioBuffer | null,
  maxLateSeconds = 0.45,
) => {
  try {
    if (!buffer) return false;

    const latestStart = start + maxLateSeconds;
    if (ctx.currentTime > latestStart) return false;

    const safeStart = Math.max(start, ctx.currentTime + 0.025);
    if (safeStart > latestStart) return false;

    const duration = Math.min(buffer.duration, 3.8);
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();

    source.buffer = buffer;
    source.playbackRate.setValueAtTime(1, safeStart);

    gain.gain.setValueAtTime(0.0001, safeStart);
    gain.gain.linearRampToValueAtTime(0.92, safeStart + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.74, safeStart + Math.min(0.38, duration * 0.32));
    gain.gain.exponentialRampToValueAtTime(0.001, safeStart + duration);

    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(safeStart);
    source.stop(safeStart + duration + 0.04);
    return true;
  } catch (error) {
    console.error('Streak success fanfare failed to schedule', error);
    return false;
  }
};

const scheduleFocusStreakDayPopNote = (
  ctx: AudioContext,
  start: number,
  buffer: AudioBuffer | null,
  playbackRate: number,
  maxLateSeconds = 0.22,
) => scheduleSoftPopSample(ctx, start, buffer, {
  playbackRate,
  gain: FOCUS_STREAK_DAY_POP_GAIN,
  maxDuration: 0.58,
  maxLateSeconds,
});

const scheduleFocusStreakDayPopNotes = (
  ctx: AudioContext,
  baseStart: number,
  buffer: AudioBuffer | null,
  notes: FocusStreakDayNote[],
) => {
  notes.forEach((note) => {
    scheduleFocusStreakDayPopNote(
      ctx,
      baseStart + note.offsetSeconds,
      buffer,
      note.playbackRate,
    );
  });
};

const playFocusStreakIntroPop = (ctx: AudioContext, start: number) => {
  playNoiseBurst(ctx, 'pink', start, 0.14, 0.0046, 1850, 2.1);
  playSmoothTone(ctx, 'sine', 196.0, start + 0.006, 0.22, 0.018, 246.94);
  playSmoothTone(ctx, 'triangle', 493.88, start + 0.038, 0.2, 0.012, 659.25);
};

const playFocusStreakAppearancePop = (ctx: AudioContext, start: number) => {
  if (scheduleDefaultNotificationPopSample(ctx, start, streakDayPopBuffer, 0.08)) return;
  if (streakDayPopArrayBuffer || streakDayPopArrayBufferPromise) {
    void getStreakDayPopBuffer(ctx).then((buffer) => {
      scheduleDefaultNotificationPopSample(ctx, start, buffer, 0.18);
    });
    return;
  }
  playFocusStreakIntroPop(ctx, start);
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

type AlarmPlaybackOptions = {
    onContext?: (ctx: AudioContext) => void;
    volume?: number;
};

export const playAlarm = async (soundType: AlarmSound, options?: AlarmPlaybackOptions) => {
    try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        options?.onContext?.(ctx);
        if (ctx.state === 'suspended') try { await ctx.resume(); } catch {}
        const now = ctx.currentTime;
        const output = ctx.createGain();
        output.gain.setValueAtTime(getAlarmSoundVolumeScale(options?.volume ?? 100), now);
        output.connect(ctx.destination);

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
                gain.connect(output);
                osc1.start(now);
                osc2.start(now);
                osc1.stop(now + 1.7);
                osc2.stop(now + 1.7);
                break;
            case 'digital':
                playOscillator(ctx, 'square', 880, now, 0.1, 0.1, output);
                playOscillator(ctx, 'square', 1760, now + 0.1, 0.1, 0.1, output);
                playOscillator(ctx, 'square', 880, now + 0.2, 0.1, 0.1, output);
                break;
            case 'chime':
                playOscillator(ctx, 'sine', 523.25, now, 1.5, 0.3, output);
                playOscillator(ctx, 'sine', 659.25, now + 0.1, 1.5, 0.3, output);
                playOscillator(ctx, 'sine', 783.99, now + 0.2, 1.5, 0.3, output);
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
                 gGain.connect(output);
                 gOsc.start(now);
                 gOsc.stop(now + 3);
                 break;
            case 'pop':
                playOscillator(ctx, 'sine', 800, now, 0.1, 0.3, output);
                break;
            case 'wood':
                playOscillator(ctx, 'sine', 800, now, 0.05, 0.4, output);
                playOscillator(ctx, 'sine', 1200, now + 0.1, 0.05, 0.2, output);
                break;
            case 'marimba':
                [440, 554, 659, 880].forEach((freq, i) => {
                    playOscillator(ctx, 'triangle', freq, now + i * 0.08, 0.4, 0.3, output);
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
                    gain.connect(output);
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
                bGain.connect(output);
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
                cGain.connect(output);
                cGain.connect(delay);
                delay.connect(feedback);
                feedback.connect(delay);
                delay.connect(output);
                cOsc.start(now);
                cOsc.stop(now + 1.5);
                break;
            case 'ripple':
                for(let i=0; i<5; i++) {
                     playOscillator(ctx, 'sine', 600 + (i * 50), now + (i * 0.1), 0.5, 0.2 - (i*0.03), output);
                }
                break;
            case 'news':
                 [500, 750, 1000, 500, 750, 1000].forEach((freq, i) => {
                     playOscillator(ctx, 'square', freq, now + i * 0.08, 0.05, 0.05, output);
                 });
                 playOscillator(ctx, 'square', 1500, now + 0.5, 0.3, 0.05, output);
                 break;
            case 'harp': {
                [392.00, 493.88, 587.33, 783.99, 987.77].forEach((freq, i) => {
                    playSmoothTone(ctx, 'triangle', freq, now + (i * 0.09), 1.15, 0.2 - (i * 0.018), undefined, output);
                });
                break;
            }
            case 'pulse': {
                [0, 0.18, 0.36, 0.54].forEach((offset, i) => {
                    playSmoothTone(ctx, 'square', i % 2 === 0 ? 220 : 330, now + offset, 0.13, 0.11, undefined, output);
                    playNoiseBurst(ctx, 'pink', now + offset, 0.11, 0.018, 520, 1.4, output);
                });
                break;
            }
            case 'beacon': {
                [880, 660, 880].forEach((freq, i) => {
                    playSmoothTone(ctx, 'sine', freq, now + (i * 0.28), 0.42, 0.18, freq * 1.035, output);
                });
                break;
            }
            case 'bubbles': {
                [620, 740, 880, 1046.5, 1318.5, 1568].forEach((freq, i) => {
                    playSmoothTone(ctx, 'sine', freq, now + (i * 0.055), 0.22, 0.13 - (i * 0.01), freq * 1.08, output);
                });
                break;
            }
            case 'pluck': {
                [246.94, 369.99, 493.88].forEach((freq, i) => {
                    playSmoothTone(ctx, 'triangle', freq, now + (i * 0.07), 0.5, 0.2 - (i * 0.035), undefined, output);
                    playNoiseBurst(ctx, 'brown', now + (i * 0.07), 0.08, 0.018, 1200 + (i * 260), 3, output);
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
                fGain.connect(output);
                fOsc.start(now);
                fOsc.stop(now + 0.9);
                break;
            }
            case 'drift': {
                [987.77, 739.99, 554.37, 415.3].forEach((freq, i) => {
                    playSmoothTone(ctx, 'sine', freq, now + (i * 0.16), 0.95, 0.16 - (i * 0.02), freq * 0.985, output);
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
                oDelay.connect(output);
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
                    oGain.connect(output);
                    oGain.connect(oDelay);
                    oOsc.start(now + (i * 0.12));
                    oOsc.stop(now + (i * 0.12) + 0.74);
                });
                break;
            }
            case 'twinkle': {
                [1174.66, 1567.98, 1318.51, 1760.0, 2093.0].forEach((freq, i) => {
                    playSmoothTone(ctx, 'sine', freq, now + (i * 0.075), 0.42, 0.12 - (i * 0.012), freq * 1.012, output);
                });
                playNoiseBurst(ctx, 'white', now + 0.03, 0.34, 0.012, 4200, 3.4, output);
                break;
            }
            case 'echo': {
                const eDelay = ctx.createDelay();
                const eFeedback = ctx.createGain();
                eDelay.delayTime.setValueAtTime(0.22, now);
                eFeedback.gain.setValueAtTime(0.32, now);
                eDelay.connect(eFeedback);
                eFeedback.connect(eDelay);
                eDelay.connect(output);
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
                    eGain.connect(output);
                    eGain.connect(eDelay);
                    eOsc.start(start);
                    eOsc.stop(start + 0.5);
                });
                break;
            }
            case 'sprout': {
                [329.63, 392, 493.88, 659.25].forEach((freq, i) => {
                    playSmoothTone(ctx, 'triangle', freq, now + (i * 0.1), 0.75, 0.14 + (i * 0.012), freq * 1.045, output);
                });
                playNoiseBurst(ctx, 'pink', now + 0.05, 0.42, 0.012, 1800, 0.9, output);
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
                cometGain.connect(output);
                cometOsc.start(now);
                cometOsc.stop(now + 0.82);
                break;
            }
        }
    } catch(e) { console.error(e); }
};

export const startPersistentAlarm = (soundType: AlarmSound, repeatMs = 3200, volume = 100) => {
    if (typeof window === 'undefined') return () => {};

    let stopped = false;
    const activeContexts = new Set<AudioContext>();
    const closeContext = (ctx: AudioContext) => {
        activeContexts.delete(ctx);
        if (ctx.state === 'closed') return;
        if (typeof ctx.close !== 'function') return;
        void ctx.close().catch(() => {});
    };
    const registerContext = (ctx: AudioContext) => {
        if (stopped) {
            closeContext(ctx);
            return;
        }

        activeContexts.add(ctx);
        window.setTimeout(() => closeContext(ctx), Math.max(4200, repeatMs + 1800));
    };
    const play = () => {
        if (stopped) return;
        void playAlarm(soundType, { onContext: registerContext, volume });
    };

    play();
    const intervalId = window.setInterval(play, Math.max(900, repeatMs));

    return () => {
        stopped = true;
        window.clearInterval(intervalId);
        activeContexts.forEach(closeContext);
        activeContexts.clear();
    };
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

export const playDefaultNotificationSound = async () => {
  try {
    const ctx = await resumeAudioContext();
    if (!ctx || ctx.state === 'suspended') return;

    const start = ctx.currentTime + 0.025;
    if (streakDayPopBuffer) {
      scheduleDefaultNotificationPopSample(ctx, start, streakDayPopBuffer);
      return;
    }

    void getStreakDayPopBuffer(ctx).then((buffer) => {
      scheduleDefaultNotificationPopSample(ctx, start, buffer);
    });
  } catch (e) {
    console.error('Default notification sound failed', e);
  }
};

export const playFocusStreakMomentSound = async (
  days: FocusStreakMomentDaySound[] = [],
  options: FocusStreakMomentSoundOptions = {},
) => {
  try {
    const ctx = await resumeAudioContext();
    if (!ctx || ctx.state === 'suspended') return;

    const now = ctx.currentTime + 0.025;
    const whooshStart = now + 0.62;
    const fanfareStart = whooshStart + FOCUS_STREAK_SUCCESS_FANFARE_AFTER_FIRE_SECONDS;
    const dayNotes = getFocusStreakMomentDayNotes(days);
    const didScheduleCachedFireWhoosh = scheduleStreakFireWhoosh(ctx, whooshStart, streakFireWhooshBuffer);
    if (!didScheduleCachedFireWhoosh) {
      void getStreakFireWhooshBuffer(ctx).then((buffer) => {
        scheduleStreakFireWhoosh(ctx, whooshStart, buffer);
      });
    }
    if (options.streakIncreased) {
      const didScheduleCachedFanfare = streakSuccessFanfareBuffer
        ? scheduleStreakSuccessFanfare(ctx, fanfareStart, streakSuccessFanfareBuffer)
        : false;
      if (!didScheduleCachedFanfare) {
        void getStreakSuccessFanfareBuffer(ctx).then((buffer) => {
          scheduleStreakSuccessFanfare(ctx, fanfareStart, buffer);
        });
      }
    }
    const didScheduleCachedDayPops = streakDayPopBuffer
      ? (scheduleFocusStreakDayPopNotes(ctx, now, streakDayPopBuffer, dayNotes), true)
      : false;
    if (!didScheduleCachedDayPops && dayNotes.length > 0) {
      void getStreakDayPopBuffer(ctx).then((buffer) => {
        scheduleFocusStreakDayPopNotes(ctx, now, buffer, dayNotes);
      });
    }

    playFocusStreakAppearancePop(ctx, now);
  } catch (e) {
    console.error('Focus streak moment sound failed', e);
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

const playSyntheticSwitchFallback = (ctx: AudioContext, variant: TimerSwitchSoundVariant) => {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const isBreakBank = variant === 'break-bank';
  osc.frequency.setValueAtTime(isBreakBank ? 360 : 800, now);
  osc.frequency.exponentialRampToValueAtTime(isBreakBank ? 92 : 200, now + (isBreakBank ? 0.08 : 0.05));
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(isBreakBank ? 0.28 : 0.25, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, now + (isBreakBank ? 0.16 : 0.1));
  osc.type = 'sine';
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + (isBreakBank ? 0.16 : 0.1));
};

const scheduleTimerSwitchTap = (
  ctx: AudioContext,
  buffer: AudioBuffer | null,
  variant: TimerSwitchSoundVariant,
) => {
  try {
    if (!buffer) return false;
    const now = ctx.currentTime;
    const start = now + 0.01;
    const isBreakBank = variant === 'break-bank';
    const playbackRate = isBreakBank ? 0.52 : 1;
    const maxDuration = isBreakBank ? 0.42 : 0.26;
    const duration = Math.min(buffer.duration / playbackRate, maxDuration);
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();

    source.buffer = buffer;
    source.playbackRate.setValueAtTime(playbackRate, start);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(isBreakBank ? 0.86 : 0.7, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, start + Math.max(0.08, duration));

    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(start);
    source.stop(start + duration + 0.02);
    return true;
  } catch (error) {
    console.error('Timer switch tap failed to schedule', error);
    return false;
  }
};

export const playSwitch = async (variant: TimerSwitchSoundVariant = 'default') => {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') try { await ctx.resume(); } catch {}
    if (timerSwitchTapBuffer && scheduleTimerSwitchTap(ctx, timerSwitchTapBuffer, variant)) return;
    void getTimerSwitchTapBuffer(ctx).then((buffer) => {
      if (!scheduleTimerSwitchTap(ctx, buffer, variant)) {
        playSyntheticSwitchFallback(ctx, variant);
      }
    });
  } catch (_) {}
};
