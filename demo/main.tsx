/**
 * Demo Entry Point
 * Initializes the React app with mock WebSocket for GitHub Pages demo
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../client/src/App';
import './index.css';

// The websocket module is aliased in vite.config.ts to use our mock version
// This happens automatically via the resolve.alias configuration

// Render the app
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
