// API wrapper for device endpoints

import type { Device, DeviceStatus, ListStep } from './types';

const API_BASE = '/api';

interface ApiError {
  error: string;
  message: string;
}

class FetchError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'FetchError';
  }
}

async function fetchWithRetry<T>(
  url: string,
  options: RequestInit = {},
  retries = 3,
  delay = 500
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, options);
      const data = await response.json();

      if (!response.ok) {
        const apiError = data as ApiError;
        throw new FetchError(apiError.error, apiError.message);
      }

      return data as T;
    } catch (err) {
      lastError = err as Error;
      if (attempt < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Request failed');
}

export const api = {
  // List all connected devices
  async getDevices(): Promise<{ devices: Device[] }> {
    return fetchWithRetry(`${API_BASE}/devices`);
  },

  // Rescan for devices
  async scanDevices(): Promise<{ found: number; devices: Device[] }> {
    return fetchWithRetry(`${API_BASE}/devices/scan`, { method: 'POST' });
  },

  // Get device info
  async getDevice(id: string): Promise<Device> {
    return fetchWithRetry(`${API_BASE}/devices/${id}`);
  },

  // Get device status (for polling)
  async getStatus(id: string): Promise<DeviceStatus> {
    return fetchWithRetry(`${API_BASE}/devices/${id}/status`, {}, 1, 0);
  },

  // Set operating mode
  async setMode(id: string, mode: string): Promise<{ success: boolean }> {
    return fetchWithRetry(`${API_BASE}/devices/${id}/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
  },

  // Enable/disable output
  async setOutput(id: string, enabled: boolean): Promise<{ success: boolean }> {
    return fetchWithRetry(`${API_BASE}/devices/${id}/output`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
  },

  // Set one or more values
  async setValues(id: string, values: Record<string, number>): Promise<{ success: boolean }> {
    return fetchWithRetry(`${API_BASE}/devices/${id}/values`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
  },

  // Upload list (for devices with listMode capability)
  async uploadList(
    id: string,
    mode: string,
    steps: ListStep[],
    repeat?: number
  ): Promise<{ success: boolean }> {
    return fetchWithRetry(`${API_BASE}/devices/${id}/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, steps, repeat }),
    });
  },

  // Start list execution
  async startList(id: string): Promise<{ success: boolean }> {
    return fetchWithRetry(`${API_BASE}/devices/${id}/list/start`, { method: 'POST' });
  },

  // Stop list execution
  async stopList(id: string): Promise<{ success: boolean }> {
    return fetchWithRetry(`${API_BASE}/devices/${id}/list/stop`, { method: 'POST' });
  },
};

export { FetchError };
