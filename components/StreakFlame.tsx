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
}

const StreakFlame: React.FC<StreakFlameProps> = ({ className = '', delayMs = 0 }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const frames = useMemo(getAnimationFrames, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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
    animation.setSpeed(1);
    let timeoutId: number | null = null;

    if (prefersReducedMotion) {
      animation.goToAndStop(frames.finalFrame, true);
    } else {
      timeoutId = window.setTimeout(() => {
        animation.playSegments([frames.firstFrame, frames.finalFrame], true);
      }, Math.max(0, delayMs));
    }

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      animation.destroy();
    };
  }, [delayMs, frames, prefersReducedMotion]);

  return <div ref={containerRef} className={`doro-streak-flame ${className}`} aria-hidden="true" />;
};

export default StreakFlame;
