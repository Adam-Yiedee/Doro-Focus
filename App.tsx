import React from 'react';
import { TimerProvider } from './context/TimerContext';
import Layout from './components/Layout';

const App: React.FC = () => {
  return (
    <TimerProvider>
      <Layout />
    </TimerProvider>
  );
};

export default App;
