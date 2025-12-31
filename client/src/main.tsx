import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Listen for server logs in Electron (forwarded from main process)
if (window.electronAPI?.onServerLog) {
  window.electronAPI.onServerLog((message) => {
    console.log(message);
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
