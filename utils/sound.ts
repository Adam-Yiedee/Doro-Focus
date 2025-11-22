
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

export const playBell = async () => {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    
    const ctx = new AudioCtx();
    // Attempt to resume if suspended (common after sleep)
    if (ctx.state === 'suspended') {
        try { await ctx.resume(); } catch {}
    }

    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc1.frequency.setValueAtTime(784, now); // G5
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
  } catch (error) {
    console.error('Error playing bell:', error);
  }
};

export const playSwitch = async () => {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
        try { await ctx.resume(); } catch {}
    }

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
