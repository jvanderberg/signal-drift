/**
 * Electron Preload Script
 * Exposes minimal APIs to the renderer process
 * NOTE: This must be CommonJS for Electron's sandbox
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose version info and IPC to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  isElectron: true,
  // Listen for server logs from main process
  onServerLog: (callback) => {
    ipcRenderer.on('server-log', (_event, message) => callback(message));
  },
});
