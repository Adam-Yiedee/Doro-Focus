import React from 'react';
import { TimerProvider } from './context/TimerContext';
import Layout from './components/Layout';
import SpectatorTimerPage from './components/SpectatorTimerPage';
import { TimerMode } from './types';

const getSpectatorRoute = () => {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const pathMatch = url.pathname.match(/^\/spectate\/([^/]+)$/i);
  const sessionId = url.searchParams.get('spectate') || pathMatch?.[1] || '';
  const normalizedSessionId = sessionId.trim().toUpperCase();
  if (!normalizedSessionId) return null;

  const rawEnd = Number(url.searchParams.get('end'));
  const rawRemaining = Number(url.searchParams.get('remaining'));
  const modeParam = url.searchParams.get('mode');

  return {
    sessionId: normalizedSessionId,
    previewEndMs: Number.isFinite(rawEnd) && rawEnd > 0 ? rawEnd : null,
    previewRemainingSeconds: Number.isFinite(rawRemaining) && rawRemaining >= 0 ? rawRemaining : null,
    previewEndLabel: url.searchParams.get('endLabel'),
    previewMode: (modeParam === 'break' ? 'break' : 'work') as TimerMode,
    previewEndKind: 'finish' as const,
  };
};

const App: React.FC = () => {
  const spectatorRoute = getSpectatorRoute();

  if (spectatorRoute) {
    return <SpectatorTimerPage {...spectatorRoute} />;
  }

  return (
    <TimerProvider>
      <Layout />
    </TimerProvider>
  );
};

export default App;
