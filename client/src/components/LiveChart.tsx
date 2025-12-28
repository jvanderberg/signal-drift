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
  // Use array to preserve selection order
  const [visibleSeries, setVisibleSeries] = useState<string[]>(['voltage', 'current']);

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
          values = history.voltage;
          break;
        case 'current':
          values = history.current;
          break;
        case 'power':
          values = history.power;
          break;
        case 'resistance':
          values = history.resistance ?? [];
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
  const setpointDatasets = Object.entries(status.setpoints)
    .filter(([name]) => isVisible(name))
    .map(([name, value]) => {
      const setpointValues = history.timestamps.map(() => value);

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
    labels: history.timestamps.map(formatTime),
    datasets: [...measurementDatasets, ...setpointDatasets],
  };

  // Build dynamic scales based on visible series
  const buildScales = (): ChartOptions<'line'>['scales'] => {
    const scales: ChartOptions<'line'>['scales'] = {
      x: {
        display: true,
        grid: {
          color: 'var(--border-dark)',
        },
        ticks: {
          color: 'var(--text-muted)',
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
          drawOnChartArea: idx === 0, // Only first axis draws grid
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
    <div className="panel">
      <div className="panel-header">
        <h3 className="panel-title">Live Chart</h3>
        <div className="controls-row">
          <select
            value={historyWindow}
            onChange={e => onHistoryWindowChange(Number(e.target.value))}
            style={{ fontSize: 12 }}
          >
            <option value={2}>2 min</option>
            <option value={5}>5 min</option>
            <option value={10}>10 min</option>
            <option value={20}>20 min</option>
          </select>
        </div>
      </div>

      {/* Legend with toggle */}
      <div className="controls-row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        {capabilities.measurements.map(m => (
          <button
            key={m.name}
            className="btn"
            style={{
              padding: '4px 8px',
              fontSize: 12,
              backgroundColor: isVisible(m.name)
                ? SERIES_COLORS[m.name as keyof typeof SERIES_COLORS] ?? '#888'
                : 'var(--border-light)',
              color: isVisible(m.name) ? 'white' : 'var(--text-muted)',
              opacity: isVisible(m.name) ? 1 : 0.6,
            }}
            onClick={() => toggleSeries(m.name)}
          >
            {m.name} ({m.unit})
          </button>
        ))}
      </div>

      <div style={{ height: 250 }}>
        <Line ref={chartRef} data={data} options={options} />
      </div>
    </div>
  );
}
