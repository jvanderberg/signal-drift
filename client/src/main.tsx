import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Electron API type declaration (provided by preload script when running in Electron)
declare global {
  interface Window {
    electronAPI?: {
      onServerLog?: (callback: (message: string) => void) => void;
    };
  }
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
