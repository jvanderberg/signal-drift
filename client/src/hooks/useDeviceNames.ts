import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'device-custom-names';

interface DeviceCustomName {
  title: string;
  subtitle: string;
}

type DeviceNamesMap = Record<string, DeviceCustomName>;

// Generate storage key from manufacturer + model
export function getDeviceKey(manufacturer: string, model: string): string {
  return `${manufacturer.toLowerCase()}-${model.toLowerCase()}`;
}

function loadFromStorage(): DeviceNamesMap {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveToStorage(names: DeviceNamesMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
  } catch {
    // Storage full or unavailable - fail silently
  }
}

export function useDeviceNames() {
  const [names, setNames] = useState<DeviceNamesMap>(loadFromStorage);

  // Sync with storage on mount (in case another tab changed it)
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setNames(loadFromStorage());
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const getCustomName = useCallback(
    (manufacturer: string, model: string): DeviceCustomName | null => {
      const key = getDeviceKey(manufacturer, model);
      return names[key] || null;
    },
    [names]
  );

  const setCustomName = useCallback(
    (manufacturer: string, model: string, title: string, subtitle: string) => {
      const key = getDeviceKey(manufacturer, model);
      setNames(prev => {
        const updated = { ...prev, [key]: { title, subtitle } };
        saveToStorage(updated);
        return updated;
      });
    },
    []
  );

  const resetCustomName = useCallback(
    (manufacturer: string, model: string) => {
      const key = getDeviceKey(manufacturer, model);
      setNames(prev => {
        const updated = { ...prev };
        delete updated[key];
        saveToStorage(updated);
        return updated;
      });
    },
    []
  );

  const hasCustomName = useCallback(
    (manufacturer: string, model: string): boolean => {
      const key = getDeviceKey(manufacturer, model);
      return key in names;
    },
    [names]
  );

  return {
    getCustomName,
    setCustomName,
    resetCustomName,
    hasCustomName,
  };
}
