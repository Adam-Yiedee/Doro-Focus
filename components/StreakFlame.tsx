import React, { useEffect, useMemo, useRef, useState } from 'react';
import lottie from 'lottie-web';
import flameStreakAnimation from '../assets/flamefire.json';

const usePrefersReducedMotion = () => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncPreference = () => setPrefersReducedMotion(media.matches);
    syncPreference();
    media.addEventListener('change', syncPreference);
    return () => media.removeEventListener('change', syncPreference);
  }, []);

  return prefersReducedMotion;
};

const getAnimationFrames = () => {
  const data = flameStreakAnimation as { ip?: number; op?: number };
  const firstFrame = Number.isFinite(data.ip) ? Number(data.ip) : 0;
  const finalFrame = Number.isFinite(data.op) ? Math.max(firstFrame + 1, Number(data.op) - 1) : 73;
  return { firstFrame, finalFrame };
};

interface StreakFlameProps {
  className?: string;
  delayMs?: number;
  paused?: boolean;
}

const StreakFlame: React.FC<StreakFlameProps> = ({ className = '', delayMs = 0, paused = false }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<ReturnType<typeof lottie.loadAnimation> | null>(null);
  const startTimeoutRef = useRef<number | null>(null);
  const startDelayRemainingMsRef = useRef(0);
  const startDelayStartedAtMsRef = useRef<number | null>(null);
  const hasStartedRef = useRef(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const frames = useMemo(getAnimationFrames, []);

  const clearStartTimeout = () => {
    if (startTimeoutRef.current === null) return;
    window.clearTimeout(startTimeoutRef.current);
    startTimeoutRef.current = null;
    startDelayStartedAtMsRef.current = null;
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    clearStartTimeout();
    container.innerHTML = '';
    const animation = lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop: false,
      autoplay: false,
      animationData: flameStreakAnimation,
      rendererSettings: {
        preserveAspectRatio: 'xMidYMid slice',
        progressiveLoad: true,
      },
    });
    animationRef.current = animation;
    animation.setSpeed(1);
    hasStartedRef.current = false;
    startDelayRemainingMsRef.current = Math.max(0, delayMs);
    startDelayStartedAtMsRef.current = null;

    if (prefersReducedMotion) {
      animation.goToAndStop(frames.finalFrame, true);
    }

    return () => {
      clearStartTimeout();
      animation.destroy();
      animationRef.current = null;
    };
  }, [delayMs, frames, prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion) return;
    const animation = animationRef.current;
    if (!animation) return;

    const getNowMs = () => (
      typeof window.performance?.now === 'function'
        ? window.performance.now()
        : Date.now()
    );

    const startAnimation = () => {
      clearStartTimeout();
      hasStartedRef.current = true;
      startDelayRemainingMsRef.current = 0;
      animation.playSegments([frames.firstFrame, frames.finalFrame], true);
    };

    const scheduleStart = () => {
      clearStartTimeout();
      const remainingMs = Math.max(0, startDelayRemainingMsRef.current);
      if (remainingMs <= 0) {
        startAnimation();
        return;
      }

      startDelayStartedAtMsRef.current = getNowMs();
      startTimeoutRef.current = window.setTimeout(startAnimation, remainingMs);
    };

    if (paused) {
      if (!hasStartedRef.current && startTimeoutRef.current !== null && startDelayStartedAtMsRef.current !== null) {
        startDelayRemainingMsRef.current = Math.max(
          0,
          startDelayRemainingMsRef.current - (getNowMs() - startDelayStartedAtMsRef.current),
        );
      }
      clearStartTimeout();
      if (hasStartedRef.current) animation.pause();
      return;
    }

    if (hasStartedRef.current) {
      animation.play();
      return;
    }

    scheduleStart();
  }, [delayMs, frames, paused, prefersReducedMotion]);

  return <div ref={containerRef} className={`doro-streak-flame ${className}`} aria-hidden="true" />;
};

export default StreakFlame;
