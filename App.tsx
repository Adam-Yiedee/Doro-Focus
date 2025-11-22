import React, { useEffect } from 'react';
import { TimerProvider } from './context/TimerContext';
import Layout from './components/Layout';

const App: React.FC = () => {
  useEffect(() => {
    // Request notification permissions on mount
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  return (
    <TimerProvider>
      <Layout />
    </TimerProvider>
  );
};

export default App;