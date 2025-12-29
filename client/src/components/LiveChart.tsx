import { useRef, useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import type { HistoryData, DeviceCapabilities, DeviceStatus } from '../types';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

// Hook to detect dark mode
function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    const theme = document.documentElement.getAttribute('data-theme');
    if (theme) return theme === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const observer = new MutationObserver(() => {
      const theme = document.documentElement.getAttribute('data-theme');
      if (theme) {
        setIsDark(theme === 'dark');
      } else {
        setIsDark(mediaQuery.matches);
      }
    });

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const handleChange = (e: MediaQueryListEvent) => {
      const theme = document.documentElement.getAttribute('data-theme');
      if (!theme) setIsDark(e.matches);
    };
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  return isDark;
}

interface LiveChartProps {
  history: HistoryData;
  capabilities: DeviceCapabilities;
  status: DeviceStatus;
  historyWindow: number;
  onHistoryWindowChange: (minutes: number) => void;
}

const SERIES_COLORS = {
  voltage: '#ff9f43',
  current: '#00d4ff',
  power: '#2ed573',
  resistance: '#a55eea',
};

export function LiveChart({
  history,
  capabilities,
  status,
  historyWindow,
  onHistoryWindowChange,
}: LiveChartProps) {
  const chartRef = useRef<ChartJS<'line'>>(null);
  const isDarkMode = useIsDarkMode();
  // Use array to preserve selection order
  const [visibleSeries, setVisibleSeries] = useState<string[]>(['voltage', 'current']);

  // Theme-aware colors
  const gridColor = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(128, 128, 128, 0.15)';
  const tickColor = isDarkMode ? '#9090a0' : '#666666';

  const toggleSeries = (name: string) => {
    setVisibleSeries(prev => {
      if (prev.includes(name)) {
        return prev.filter(n => n !== name);
      } else {
        return [...prev, name];
      }
    });
  };

  const isVisible = (name: string) => visibleSeries.includes(name);

  // Filter history to selected time window
  const filterToWindow = <T,>(arr: T[], timestamps: number[]): T[] => {
    const cutoff = Date.now() - historyWindow * 60 * 1000;
    const startIdx = timestamps.findIndex(t => t >= cutoff);
    if (startIdx === -1) return [];
    return arr.slice(startIdx);
  };

  const filteredTimestamps = filterToWindow(history.timestamps, history.timestamps);
  const filteredHistory = {
    timestamps: filteredTimestamps,
    voltage: filterToWindow(history.voltage, history.timestamps),
    current: filterToWindow(history.current, history.timestamps),
    power: filterToWindow(history.power, history.timestamps),
    resistance: history.resistance ? filterToWindow(history.resistance, history.timestamps) : undefined,
  };

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { minute: '2-digit', second: '2-digit' });
  };

  // Get axis ID based on selection order (first two get visible axes)
  const getAxisId = (name: string): string => {
    const idx = visibleSeries.indexOf(name);
    if (idx === 0) return 'y';
    if (idx === 1) return 'y1';
    return `y${idx}`; // y2, y3, etc. for additional series
  };

  // Build measurement datasets
  const measurementDatasets = capabilities.measurements
    .filter(m => isVisible(m.name))
    .map(measurement => {
      let values: number[] = [];
      switch (measurement.name) {
        case 'voltage':
          values = filteredHistory.voltage;
          break;
        case 'current':
          values = filteredHistory.current;
          break;
        case 'power':
          values = filteredHistory.power;
          break;
        case 'resistance':
          values = filteredHistory.resistance ?? [];
          break;
      }

      return {
        label: `${measurement.name} (${measurement.unit})`,
        data: values,
        borderColor: SERIES_COLORS[measurement.name as keyof typeof SERIES_COLORS] ?? '#888',
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.1,
        yAxisID: getAxisId(measurement.name),
      };
    });

  // Build setpoint reference lines (horizontal lines at setpoint value)
  // Only show setpoints that are relevant to the current mode
  const setpointDatasets = Object.entries(status.setpoints)
    .filter(([name]) => {
      if (!isVisible(name)) return false;

      // Check if this setpoint is associated with a specific mode
      const output = capabilities.outputs.find(o => o.name === name);
      if (output?.modes) {
        // Only show if current mode matches
        return output.modes.includes(status.mode);
      }
      // No mode restriction (e.g., PSU outputs) - always show
      return true;
    })
    .map(([name, value]) => {
      const setpointValues = filteredHistory.timestamps.map(() => value);

      return {
        label: `${name} setpoint`,
        data: setpointValues,
        borderColor: SERIES_COLORS[name as keyof typeof SERIES_COLORS] ?? '#888',
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderDash: [5, 5],
        pointRadius: 0,
        tension: 0,
        yAxisID: getAxisId(name),
      };
    });

  const data: ChartData<'line'> = {
    labels: filteredHistory.timestamps.map(formatTime),
    datasets: [...measurementDatasets, ...setpointDatasets],
  };

  // Build dynamic scales based on visible series
  const buildScales = (): ChartOptions<'line'>['scales'] => {
    const scales: ChartOptions<'line'>['scales'] = {
      x: {
        display: true,
        grid: {
          color: gridColor,
        },
        ticks: {
          color: tickColor,
          maxTicksLimit: 6,
        },
      },
    };

    // Find measurement info for each visible series
    const getMeasurement = (name: string) =>
      capabilities.measurements.find(m => m.name === name);

    visibleSeries.forEach((name, idx) => {
      const measurement = getMeasurement(name);
      const color = SERIES_COLORS[name as keyof typeof SERIES_COLORS] ?? '#888';
      const axisId = idx === 0 ? 'y' : idx === 1 ? 'y1' : `y${idx}`;
      const isVisible = idx < 2; // Only first two axes are visible

      scales[axisId] = {
        type: 'linear',
        display: isVisible,
        position: idx === 0 ? 'left' : 'right',
        grid: {
          drawOnChartArea: idx === 0,
          color: gridColor,
        },
        ticks: {
          color,
        },
        beginAtZero: true,
        title: {
          display: isVisible,
          text: measurement ? `${name} (${measurement.unit})` : name,
          color,
        },
      };
    });

    return scales;
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        enabled: true,
      },
    },
    scales: buildScales(),
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
    };
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Controls row with toggles and time window */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap shrink-0">
        {capabilities.measurements.map(m => {
          const color = SERIES_COLORS[m.name as keyof typeof SERIES_COLORS] ?? '#888';
          const active = isVisible(m.name);
          return (
            <button
              key={m.name}
              className="px-1.5 py-0.5 text-[10px] font-medium rounded transition-opacity"
              style={{
                backgroundColor: active ? color : 'var(--color-border-light)',
                color: active ? 'white' : 'var(--color-text-muted)',
                opacity: active ? 1 : 0.6,
              }}
              onClick={() => toggleSeries(m.name)}
            >
              {m.name}
            </button>
          );
        })}
        <select
          className="ml-auto px-1.5 py-0.5 text-xs rounded"
          value={historyWindow}
          onChange={e => onHistoryWindowChange(Number(e.target.value))}
        >
          <option value={2}>2m</option>
          <option value={5}>5m</option>
          <option value={10}>10m</option>
          <option value={20}>20m</option>
        </select>
      </div>

      <div className="flex-1 min-h-0">
        <Line ref={chartRef} data={data} options={options} />
      </div>
    </div>
  );
}
