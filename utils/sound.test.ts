import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const installFakeAudioContext = (options?: { resumeAsync?: boolean }) => {
  const startedSources: FakeBufferSourceNode[] = [];
  const stoppedSources: FakeBufferSourceNode[] = [];
  const gainRampValues: number[] = [];
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
    private readonly channels: Float32Array[];

    constructor(channels: number, frames: number) {
      this.numberOfChannels = channels;
      this.channels = Array.from({ length: channels }, () => new Float32Array(frames));
    }

    getChannelData(index: number) {
      return this.channels[index];
    }
  }

  class FakeBufferSourceNode extends FakeAudioNode {
    buffer: FakeAudioBuffer | null = null;
    loop = false;

    start() {
      startedSources.push(this);
    }

    stop() {
      stoppedSources.push(this);
    }
  }

  class FakeGainNode extends FakeAudioNode {
    gain = new FakeAudioParam();
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

    createBuffer(channels: number, frameCount: number) {
      return new FakeAudioBuffer(channels, frameCount);
    }

    createBufferSource() {
      return new FakeBufferSourceNode();
    }

    createGain() {
      return new FakeGainNode();
    }

    createBiquadFilter() {
      return new FakeBiquadFilterNode();
    }
  }

  (globalThis as any).window = {
    AudioContext: FakeAudioContext,
    setTimeout,
  };

  return {
    contexts,
    startedSources,
    stoppedSources,
    gainRampValues,
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
    sound.stopFocusSound();
    try {
      vi.runOnlyPendingTimers();
    } catch {}
    try {
      vi.useRealTimers();
    } catch {}
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

    expect(fakeAudio.gainRampValues[fakeAudio.gainRampValues.length - 1]).toBeCloseTo(0.055, 5);
  });

  it('treats zero volume as a true mute target', async () => {
    const fakeAudio = installFakeAudioContext();
    const sound = await import('./sound');

    await sound.startFocusSound('brown-deep', 0);

    expect(fakeAudio.gainRampValues[fakeAudio.gainRampValues.length - 1]).toBe(0);
  });
});
