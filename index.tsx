import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Failed to find the root element');

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

const MAX_BOOT_VEIL_MS = 900;

const markAppReady = () => {
  document.body.classList.add('doro-app-ready');
  const bootScreen = document.getElementById('doro-boot-screen');
  if (!bootScreen) return;
  const removeBootScreen = () => bootScreen.remove();
  bootScreen.addEventListener('transitionend', removeBootScreen, { once: true });
  window.setTimeout(removeBootScreen, 500);
};

const waitForFonts = 'fonts' in document
  ? Promise.race([
      document.fonts.ready.catch(() => undefined),
      new Promise((resolve) => window.setTimeout(resolve, MAX_BOOT_VEIL_MS)),
    ])
  : Promise.resolve();

void waitForFonts.finally(() => {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(markAppReady);
  });
});
