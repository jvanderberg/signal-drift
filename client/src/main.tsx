import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { useLayoutStore } from './stores';

// Electron API type declaration (provided by preload script when running in Electron)
declare global {
  interface Window {
    electronAPI?: {
      onServerLog?: (callback: (message: string) => void) => void;
    };
    // Expose stores for e2e testing
    __LAYOUT_STORE__?: typeof useLayoutStore;
  }
}

// Expose layout store for e2e testing
if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
  window.__LAYOUT_STORE__ = useLayoutStore;
}

// Listen for server logs in Electron (forwarded from main process)
if (window.electronAPI?.onServerLog) {
  window.electronAPI.onServerLog((message: string) => {
    console.log(message);
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
