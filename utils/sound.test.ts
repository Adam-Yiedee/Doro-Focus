import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const installFakeAudioContext = (options?: { resumeAsync?: boolean }) => {
  const startedSources: FakeBufferSourceNode[] = [];
  const stoppedSources: FakeBufferSourceNode[] = [];
  const startedOscillators: FakeOscillatorNode[] = [];
  const gainRampValues: number[] = [];
  const gainNodes: FakeGainNode[] = [];
  const contexts: FakeAudioContext[] = [];
  let pendingResume: (() => void) | null = null;
  let resumeCalls = 0;

  class FakeAudioParam {
    value = 0;

    setValueAtTime(value: number) {
      this.value = value;
    }

    linearRampToValueAtTime(value: number) {
      this.value = value;
      gainRampValues.push(value);
    }

    exponentialRampToValueAtTime(value: number) {
      this.value = value;
      gainRampValues.push(value);
    }

    cancelScheduledValues() {}

    setTargetAtTime(value: number) {
      this.value = value;
      gainRampValues.push(value);
    }
  }

  class FakeAudioNode {
    connect(_node: unknown) {
      return _node;
    }

    disconnect() {}
  }

  class FakeAudioBuffer {
    numberOfChannels: number;
    sampleRate: number;
    duration = 1;
    private readonly channels: Float32Array[];

    constructor(channels: number, frames: number, sampleRate = 44_100) {
      this.numberOfChannels = channels;
      this.sampleRate = sampleRate;
      this.duration = frames / sampleRate;
      this.channels = Array.from({ length: channels }, () => new Float32Array(frames));
    }

    getChannelData(index: number) {
      return this.channels[index];
    }
  }

  class FakeBufferSourceNode extends FakeAudioNode {
    buffer: FakeAudioBuffer | null = null;
    loop = false;
    loopStart = 0;
    loopEnd = 0;
    playbackRate = new FakeAudioParam();
    startedAt: number | null = null;
    stoppedAt: number | null = null;

    start(when?: number) {
      this.startedAt = typeof when === 'number' ? when : null;
      startedSources.push(this);
    }

    stop(when?: number) {
      this.stoppedAt = typeof when === 'number' ? when : null;
      stoppedSources.push(this);
    }
  }

  class FakeOscillatorNode extends FakeAudioNode {
    type: OscillatorType = 'sine';
    frequency = new FakeAudioParam();
    detune = new FakeAudioParam();

    start() {
      startedOscillators.push(this);
    }

    stop() {}
  }

  class FakeGainNode extends FakeAudioNode {
    gain = new FakeAudioParam();

    constructor() {
      super();
      gainNodes.push(this);
    }
  }

  class FakeBiquadFilterNode extends FakeAudioNode {
    type: BiquadFilterType = 'lowpass';
    frequency = new FakeAudioParam();
    Q = { value: 0 };
  }

  class FakeAudioContext {
    state: AudioContextState = options?.resumeAsync ? 'suspended' : 'running';
    currentTime = 0;
    sampleRate = 44_100;
    destination = new FakeAudioNode();

    constructor() {
      contexts.push(this);
    }

    resume() {
      resumeCalls += 1;
      if (!options?.resumeAsync) {
        this.state = 'running';
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        pendingResume = () => {
          this.state = 'running';
          resolve();
        };
      });
    }

    createBuffer(channels: number, frameCount: number, sampleRate = this.sampleRate) {
      return new FakeAudioBuffer(channels, frameCount, sampleRate);
    }

    createBufferSource() {
      return new FakeBufferSourceNode();
    }

    createOscillator() {
      return new FakeOscillatorNode();
    }

    createGain() {
      return new FakeGainNode();
    }

    createBiquadFilter() {
      return new FakeBiquadFilterNode();
    }

    decodeAudioData(_buffer: ArrayBuffer) {
      return Promise.resolve(new FakeAudioBuffer(1, 44_100, this.sampleRate));
    }
  }

  (globalThis as any).window = {
    AudioContext: FakeAudioContext,
    setTimeout,
  };

  return {
    contexts,
    startedSources,
    startedOscillators,
    stoppedSources,
    gainRampValues,
    gainNodes,
    getResumeCalls: () => resumeCalls,
    resolveResume: () => pendingResume?.(),
  };
};

describe('focus sound engine', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    const sound = await import('./sound');
    sound.stopFocusSoundPreview();
    sound.stopFocusSound();
    try {
      vi.runOnlyPendingTimers();
    } catch {}
    try {
      vi.useRealTimers();
    } catch {}
    vi.unstubAllGlobals();
    delete (globalThis as any).window;
  });

  it('cancels a pending async start if focus sound is stopped first', async () => {
    const fakeAudio = installFakeAudioContext({ resumeAsync: true });
    const sound = await import('./sound');

    const pendingStart = sound.startFocusSound('pink-soft', 60);
    sound.stopFocusSound();
    fakeAudio.resolveResume();
    await pendingStart;

    expect(fakeAudio.startedSources).toHaveLength(0);
  });

  it('reuses the existing source when only the same preset volume changes', async () => {
    const fakeAudio = installFakeAudioContext();
    const sound = await import('./sound');

    await sound.startFocusSound('white-soft', 100);
    await sound.startFocusSound('white-soft', 35);

    expect(fakeAudio.startedSources).toHaveLength(1);
  });

  it('switches presets by stopping the prior source and starting a new one', async () => {
    vi.useFakeTimers();
    const fakeAudio = installFakeAudioContext();
    const sound = await import('./sound');

    await sound.startFocusSound('white-soft', 100);
    await sound.startFocusSound('pink-soft', 100);

    expect(fakeAudio.startedSources).toHaveLength(2);
    expect(fakeAudio.stoppedSources).toHaveLength(0);

    vi.advanceTimersByTime(200);

    expect(fakeAudio.stoppedSources).toHaveLength(1);
  });

  it('stops the current source when switching focus sound off', async () => {
    vi.useFakeTimers();
    const fakeAudio = installFakeAudioContext();
    const sound = await import('./sound');

    await sound.startFocusSound('brown-warm', 75);
    await sound.startFocusSound('off', 75);

    vi.advanceTimersByTime(200);

    expect(fakeAudio.startedSources).toHaveLength(1);
    expect(fakeAudio.stoppedSources).toHaveLength(1);
  });

  it('reuses the shared audio context across multiple starts', async () => {
    const fakeAudio = installFakeAudioContext();
    const sound = await import('./sound');

    const firstContext = await sound.resumeAudioContext();
    await sound.startFocusSound('white-bright', 80);
    sound.stopFocusSound();
    const secondContext = await sound.resumeAudioContext();

    expect(fakeAudio.contexts).toHaveLength(1);
    expect(secondContext).toBe(firstContext);
  });

  it('resumes a suspended shared context instead of recreating the same preset source', async () => {
    const fakeAudio = installFakeAudioContext();
    const sound = await import('./sound');

    await sound.startFocusSound('pink-air', 50);
    fakeAudio.contexts[0].state = 'suspended';
    await sound.startFocusSound('pink-air', 65);

    expect(fakeAudio.startedSources).toHaveLength(1);
    expect(fakeAudio.getResumeCalls()).toBeGreaterThan(0);
  });

  it('falls back to full volume when the saved value is invalid', async () => {
    const fakeAudio = installFakeAudioContext();
    const sound = await import('./sound');

    await sound.startFocusSound('white-soft', Number.NaN);

    expect(fakeAudio.gainRampValues[fakeAudio.gainRampValues.length - 1]).toBeCloseTo(0.055 * 2.35, 5);
  });

  it('boosts the focus sound noticeably at full slider volume', async () => {
    const fakeAudio = installFakeAudioContext();
    const sound = await import('./sound');

    await sound.startFocusSound('white-soft', 100);

    expect(fakeAudio.gainRampValues[fakeAudio.gainRampValues.length - 1]).toBeCloseTo(0.055 * 2.35, 5);
  });

  it('keeps full, continuous ambience energy through every focus sound loop seam', async () => {
    const fakeAudio = installFakeAudioContext();
    const sound = await import('./sound');

    for (const preset of ['white-soft', 'pink-soft', 'brown-deep'] as const) {
      await sound.startFocusSound(preset, 100);

      const source = fakeAudio.startedSources[fakeAudio.startedSources.length - 1];
      const buffer = source.buffer;
      expect(buffer?.duration).toBeGreaterThan(12);
      expect(source.loop).toBe(true);
      expect(source.loopStart).toBe(0);
      expect(source.loopEnd).toBe(buffer?.duration);

      const channel = buffer!.getChannelData(0);
      const edgeFrames = Math.floor(buffer!.sampleRate * 0.25);
      const rms = (start: number, end: number) => {
        let sum = 0;
        for (let index = start; index < end; index += 1) {
          sum += channel[index] * channel[index];
        }
        return Math.sqrt(sum / Math.max(1, end - start));
      };
      const fullRms = rms(0, channel.length);
      const leadingRms = rms(0, edgeFrames);
      const trailingRms = rms(channel.length - edgeFrames, channel.length);

      expect(leadingRms).toBeGreaterThan(fullRms * 0.2);
      expect(trailingRms).toBeGreaterThan(fullRms * 0.2);

      let largestInternalStep = 0;
      for (let index = 1; index < channel.length; index += 1) {
        largestInternalStep = Math.max(largestInternalStep, Math.abs(channel[index] - channel[index - 1]));
      }
      const loopSeamStep = Math.abs(channel[0] - channel[channel.length - 1]);
      expect(loopSeamStep).toBeLessThanOrEqual(largestInternalStep);
    }
  });

  it('reuses generated focus noise buffers when switching presets with the same noise color', async () => {
    const fakeAudio = installFakeAudioContext();
    const sound = await import('./sound');

    await sound.startFocusSound('white-soft', 100);
    await sound.startFocusSound('white-bright', 80);

    expect(fakeAudio.startedSources).toHaveLength(2);
    expect(fakeAudio.startedSources[1].buffer).toBe(fakeAudio.startedSources[0].buffer);
  });

  it('treats zero volume as a true mute target', async () => {
    const fakeAudio = installFakeAudioContext();
    const sound = await import('./sound');

    await sound.startFocusSound('brown-deep', 0);

    expect(fakeAudio.gainRampValues[fakeAudio.gainRampValues.length - 1]).toBe(0);
  });

  it('applies alarm volume through a master output gain', async () => {
    const fakeAudio = installFakeAudioContext();
    const sound = await import('./sound');

    await sound.playAlarm('pop', { volume: 25 });

    expect(fakeAudio.gainNodes[0].gain.value).toBeCloseTo(0.25, 5);
  });

  it('previews a focus sound without replacing the active focus loop', async () => {
    vi.useFakeTimers();
    const fakeAudio = installFakeAudioContext();
    const sound = await import('./sound');

    await sound.startFocusSound('white-soft', 100);
    await sound.startFocusSoundPreview('pink-soft', 60, 1000);

    expect(fakeAudio.startedSources).toHaveLength(2);

    vi.advanceTimersByTime(1180);

    expect(fakeAudio.stoppedSources).toHaveLength(1);

    await sound.startFocusSound('white-soft', 70);

    expect(fakeAudio.startedSources).toHaveLength(2);
  });

  it('starts the streak moment sound without waiting for the fire whoosh asset', async () => {
    const fakeAudio = installFakeAudioContext();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const sound = await import('./sound');

    const result = await Promise.race([
      sound.playFocusStreakMomentSound().then(() => 'done'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 25)),
    ]);

    expect(result).toBe('done');
    expect(fakeAudio.startedSources.length).toBeGreaterThan(0);
    expect(fakeAudio.startedOscillators.length).toBeGreaterThan(0);
  });

  it('does not play a stale streak fire whoosh after the visual moment has passed', async () => {
    const fakeAudio = installFakeAudioContext();
    type FakeFetchResponse = { ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> };
    let resolveFetch!: (response: FakeFetchResponse) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<FakeFetchResponse>((resolve) => {
      resolveFetch = resolve;
    })));
    const sound = await import('./sound');

    await sound.playFocusStreakMomentSound();
    const scheduledBeforeWhooshLoaded = fakeAudio.startedSources.length;
    fakeAudio.contexts[0].currentTime = 4;
    resolveFetch({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
    });
    for (let i = 0; i < 6; i += 1) {
      await Promise.resolve();
    }

    expect(fakeAudio.startedSources).toHaveLength(scheduledBeforeWhooshLoaded);
  });

  it('does not schedule a streak sound later when the audio context stays locked', async () => {
    vi.useFakeTimers();
    const fakeAudio = installFakeAudioContext({ resumeAsync: true });
    const sound = await import('./sound');

    const pendingPlay = sound.playFocusStreakMomentSound();
    await vi.advanceTimersByTimeAsync(181);

    await expect(pendingPlay).resolves.toBe(false);
    expect(fakeAudio.startedSources).toHaveLength(0);
    expect(fakeAudio.startedOscillators).toHaveLength(0);
  });

  it('uses on-time fallback cues while streak samples are still preloading', async () => {
    const fakeAudio = installFakeAudioContext();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const sound = await import('./sound');

    void sound.preloadFocusStreakMomentSounds();
    await sound.playFocusStreakMomentSound([{ status: 'active' }], { streakIncreased: true });

    const startedAt = fakeAudio.startedSources.map(source => source.startedAt);
    expect(startedAt.some(time => time !== null && Math.abs(time - 0.025) < 0.00001)).toBe(true);
    expect(startedAt.some(time => time !== null && Math.abs(time - 0.645) < 0.00001)).toBe(true);
    expect(startedAt.some(time => time !== null && Math.abs(time - 3.145) < 0.00001)).toBe(true);
    expect(fakeAudio.startedOscillators.length).toBeGreaterThan(0);
  });

  it('maps streak day slots from low pitch up to the original sample pitch', async () => {
    const sound = await import('./sound');

    expect(sound.getFocusStreakDayNotePlaybackRate(0)).toBeCloseTo(Math.pow(2, -6 / 12), 5);
    expect(sound.getFocusStreakDayNotePlaybackRate(6)).toBe(1);
  });

  it('builds streak day sample notes only for streak slots', async () => {
    const sound = await import('./sound');
    const notes = sound.getFocusStreakMomentDayNotes([
      { status: 'active' },
      { status: null },
      { status: 'active' },
    ]);

    expect(notes.map(note => note.index)).toEqual([0, 2]);
    expect(notes[0].playbackRate).toBeCloseTo(sound.getFocusStreakDayNotePlaybackRate(0), 5);
    expect(notes[1].playbackRate).toBeCloseTo(sound.getFocusStreakDayNotePlaybackRate(2), 5);
  });

  it('preloads the streak moment samples before the visual moment needs them', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const sound = await import('./sound');

    await sound.preloadFocusStreakMomentSounds();
    await sound.preloadFocusStreakMomentSounds();

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('plays the timer switch tap sample at normal pitch by default', async () => {
    const fakeAudio = installFakeAudioContext();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
    })));
    const sound = await import('./sound');

    await sound.playSwitch();
    for (let index = 0; index < 40; index += 1) {
      await Promise.resolve();
    }

    expect(fakeAudio.startedSources).toHaveLength(1);
    expect(fakeAudio.startedSources[0].playbackRate.value).toBe(1);
    expect(fakeAudio.startedOscillators).toHaveLength(0);
  });

  it('plays the timer switch tap sample much lower for break bank switches', async () => {
    const fakeAudio = installFakeAudioContext();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
    })));
    const sound = await import('./sound');

    await sound.playSwitch('break-bank');
    for (let index = 0; index < 40; index += 1) {
      await Promise.resolve();
    }

    expect(fakeAudio.startedSources).toHaveLength(1);
    expect(fakeAudio.startedSources[0].playbackRate.value).toBeCloseTo(0.52, 5);
    expect(fakeAudio.startedOscillators).toHaveLength(0);
  });

  it('plays the default notification pop sample from the preload cache', async () => {
    const fakeAudio = installFakeAudioContext();
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const sound = await import('./sound');

    await sound.preloadNotificationSounds();
    fetchMock.mockClear();

    await sound.playDefaultNotificationSound();
    for (let index = 0; index < 40; index += 1) {
      await Promise.resolve();
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fakeAudio.startedSources).toHaveLength(1);
    expect(fakeAudio.startedSources[0].playbackRate.value).toBe(1);
  });

  it('plays the default notification pop sample right when the streak moment appears', async () => {
    const fakeAudio = installFakeAudioContext();
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const sound = await import('./sound');

    await sound.preloadFocusStreakMomentSounds();
    fetchMock.mockClear();

    await sound.playFocusStreakMomentSound();
    for (let index = 0; index < 40; index += 1) {
      await Promise.resolve();
    }

    const appearanceSource = fakeAudio.startedSources.find(source => (
      Math.abs(source.playbackRate.value - 1) < 0.00001
    ));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(appearanceSource?.startedAt).toBeCloseTo(0.025, 5);
    expect(fakeAudio.startedOscillators).toHaveLength(0);
  });

  it('uses the preloaded streak day pop sample when the moment starts', async () => {
    const fakeAudio = installFakeAudioContext();
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const sound = await import('./sound');

    await sound.preloadFocusStreakMomentSounds();
    fetchMock.mockClear();

    await sound.playFocusStreakMomentSound([{ status: 'active' }]);
    for (let index = 0; index < 40; index += 1) {
      await Promise.resolve();
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fakeAudio.startedSources.some(source => (
      Math.abs(source.playbackRate.value - sound.getFocusStreakDayNotePlaybackRate(0)) < 0.00001
    ))).toBe(true);
  });

  it('plays the success fanfare only when the streak increased', async () => {
    const fakeAudio = installFakeAudioContext();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
    })));
    const sound = await import('./sound');
    const hasFanfareSource = () => fakeAudio.startedSources.some(source => (
      Math.abs(source.playbackRate.value - 1) < 0.00001
      && source.startedAt !== null
      && Math.abs(source.startedAt - 2.465) < 0.00001
    ));

    await sound.preloadFocusStreakMomentSounds();
    await sound.playFocusStreakMomentSound([], { streakIncreased: false });
    for (let index = 0; index < 40; index += 1) {
      await Promise.resolve();
    }

    expect(hasFanfareSource()).toBe(false);
    fakeAudio.startedSources.length = 0;

    await sound.playFocusStreakMomentSound([], { streakIncreased: true });
    for (let index = 0; index < 40; index += 1) {
      await Promise.resolve();
    }

    expect(hasFanfareSource()).toBe(true);
  });

  it('starts the streak success fanfare one second earlier after the flame', async () => {
    const fakeAudio = installFakeAudioContext();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
    })));
    const sound = await import('./sound');

    await sound.preloadFocusStreakMomentSounds();
    await sound.playFocusStreakMomentSound([], { streakIncreased: true });
    for (let index = 0; index < 40; index += 1) {
      await Promise.resolve();
    }

    const fanfareSource = fakeAudio.startedSources.find(source => (
      Math.abs(source.playbackRate.value - 1) < 0.00001
    ));

    expect(fanfareSource?.startedAt).toBeCloseTo(2.465, 5);
  });

  it('uses a louder streak flame sample gain', async () => {
    const fakeAudio = installFakeAudioContext();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
    })));
    const sound = await import('./sound');

    await sound.preloadFocusStreakMomentSounds();
    await sound.playFocusStreakMomentSound();
    for (let index = 0; index < 40; index += 1) {
      await Promise.resolve();
    }

    expect(fakeAudio.gainRampValues).toContain(3.75);
    expect(fakeAudio.gainRampValues).toContain(2.8);
  });

  it('uses a much louder streak day blip gain so it cuts through the fanfare', async () => {
    const fakeAudio = installFakeAudioContext();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
    })));
    const sound = await import('./sound');

    await sound.preloadFocusStreakMomentSounds();
    await sound.playFocusStreakMomentSound([{ status: 'active' }], { streakIncreased: true });
    for (let index = 0; index < 40; index += 1) {
      await Promise.resolve();
    }

    expect(fakeAudio.gainRampValues).toContain(1.85);
  });

  it('keeps the streak moment soundscape to the intended sound families', async () => {
    const fakeAudio = installFakeAudioContext();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
    })));
    const sound = await import('./sound');

    await sound.preloadFocusStreakMomentSounds();
    await sound.playFocusStreakMomentSound([
      { status: 'active' },
      { status: 'active' },
    ], { streakIncreased: true });
    for (let index = 0; index < 40; index += 1) {
      await Promise.resolve();
    }

    expect(fakeAudio.startedSources).toHaveLength(5);
    expect(fakeAudio.startedOscillators).toHaveLength(0);
  });

  it('plays the streak day pop sample for each streak slot and skips empty days', async () => {
    const fakeAudio = installFakeAudioContext();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
    })));
    const sound = await import('./sound');

    await sound.preloadFocusStreakMomentSounds();
    await sound.playFocusStreakMomentSound([
      { status: 'active' },
      { status: null },
      { status: 'active' },
    ]);
    for (let index = 0; index < 40; index += 1) {
      await Promise.resolve();
    }

    const startedPlaybackRates = fakeAudio.startedSources.map(source => source.playbackRate.value);
    const streakNoteRates = startedPlaybackRates.filter(rate => rate > 0.6 && rate < 1);
    const hasCloseRate = (expected: number) => (
      streakNoteRates.some(rate => Math.abs(rate - expected) < 0.00001)
    );

    expect(streakNoteRates).toHaveLength(2);
    expect(hasCloseRate(sound.getFocusStreakDayNotePlaybackRate(0))).toBe(true);
    expect(hasCloseRate(sound.getFocusStreakDayNotePlaybackRate(2))).toBe(true);
  });
});
