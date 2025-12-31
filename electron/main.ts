/**
 * Electron Main Process
 * Starts the server and creates the browser window for the UI
 */

import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let stopServerFn: (() => Promise<void>) | null = null;

// Forward console output to renderer DevTools
function setupConsoleForwarding() {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  const forward = (level: string, ...args: unknown[]) => {
    const message = args.map(a =>
      typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
    ).join(' ');

    if (mainWindow?.webContents) {
      mainWindow.webContents.send('server-log', `[${level}] ${message}`);
    }
  };

  console.log = (...args: unknown[]) => {
    originalLog.apply(console, args);
    forward('server', ...args);
  };

  console.error = (...args: unknown[]) => {
    originalError.apply(console, args);
    forward('error', ...args);
  };

  console.warn = (...args: unknown[]) => {
    originalWarn.apply(console, args);
    forward('warn', ...args);
  };
}

async function createWindow() {
  // Preload is in electron/ (source), main.js is in dist/electron/ (compiled)
  const preloadPath = isDev
    ? path.join(__dirname, '../../electron/preload.js')
    : path.join(__dirname, '../../electron/preload.js');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Lab Controller',
    backgroundColor: '#1a1a1a',
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Load the UI
  if (isDev) {
    // Development: load from Vite dev server
    await mainWindow.loadURL('http://localhost:5173');
    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  } else {
    // Production: load from built files
    // __dirname is dist/electron/, so go up two levels to reach project root
    await mainWindow.loadFile(path.join(__dirname, '../../client/dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function startServer() {
  console.log('Starting Lab Controller server...');

  if (isDev) {
    // In development, server is started separately via npm run dev
    console.log('Development mode: expecting server at http://localhost:3001');
  } else {
    // In production, import and start the server
    // __dirname is dist/electron/, server is at dist/server/
    // Use string concatenation to prevent TypeScript from resolving at compile time
    const serverPath = path.join(__dirname, '..', 'server', 'index.js');
    const { startServer: start, stopServer: stop } = await import(serverPath);
    stopServerFn = stop;
    await start();
  }
}

// App lifecycle
app.whenReady().then(async () => {
  // Set up console forwarding BEFORE starting server so we capture all logs
  setupConsoleForwarding();

  await startServer();
  await createWindow();

  app.on('activate', async () => {
    // macOS: re-create window when dock icon clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

// Graceful shutdown - close USB/serial devices before quitting
app.on('window-all-closed', async () => {
  if (stopServerFn) {
    console.log('Stopping server before quit...');
    try {
      await stopServerFn();
    } catch (err) {
      console.error('Error stopping server:', err);
    }
    stopServerFn = null;
  }
  // Quit on all platforms (no system tray)
  app.quit();
});

// Handle certificate errors for localhost in development
if (isDev) {
  app.on('certificate-error', (event, _webContents, _url, _error, _certificate, callback) => {
    event.preventDefault();
    callback(true);
  });
}
