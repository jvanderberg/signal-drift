import { memo, useEffect, useState } from 'react';
import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartDataset,
  type ChartOptions,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import type { BatteryTestSample } from '../types';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

type SeriesName = 'voltage' | 'current' | 'power' | 'chargeMah' | 'energyWh';

const SERIES: Array<{ name: SeriesName; label: string; unit: string; color: string }> = [
  { name: 'voltage', label: 'Voltage', unit: 'V', color: '#ff9f43' },
  { name: 'current', label: 'Current', unit: 'A', color: '#00d4ff' },
  { name: 'power', label: 'Power', unit: 'W', color: '#2ed573' },
  { name: 'chargeMah', label: 'Capacity', unit: 'mAh', color: '#a55eea' },
  { name: 'energyWh', label: 'Energy', unit: 'Wh', color: '#ff6b81' },
];

function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.getAttribute('data-theme') === 'dark' ||
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const theme = document.documentElement.getAttribute('data-theme');
      setIsDark(theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

export const BatteryTestChart = memo(function BatteryTestChart({ samples }: { samples: BatteryTestSample[] }) {
  const [visibleSeries, setVisibleSeries] = useState<SeriesName[]>(['voltage', 'current', 'power']);
  const [timeWindow, setTimeWindow] = useState(0);
  const isDark = useIsDarkMode();
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(128, 128, 128, 0.15)';
  const tickColor = isDark ? '#9090a0' : '#666666';
  const cutoff = timeWindow === 0 ? 0 : Date.now() - timeWindow * 60_000;
  const filtered = timeWindow === 0 ? samples : samples.filter(sample => sample.timestamp >= cutoff);

  const datasets: Array<ChartDataset<'line', number[]>> = visibleSeries.map((name, index) => {
    const descriptor = SERIES.find(series => series.name === name);
    return {
      label: `${descriptor?.label ?? name} (${descriptor?.unit ?? ''})`,
      data: filtered.map(sample => sample[name]),
      borderColor: descriptor?.color ?? '#888',
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.1,
      yAxisID: index === 0 ? 'y' : `y${index}`,
    };
  });

  const data: ChartData<'line', number[], string> = {
    labels: filtered.map(sample => new Date(sample.timestamp).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })),
    datasets,
  };

  const scales: ChartOptions<'line'>['scales'] = {
    x: {
      grid: { color: gridColor },
      ticks: { color: tickColor, maxTicksLimit: 7 },
    },
  };
  visibleSeries.forEach((name, index) => {
    const descriptor = SERIES.find(series => series.name === name);
    const axisId = index === 0 ? 'y' : `y${index}`;
    scales[axisId] = {
      type: 'linear',
      display: index < 2,
      position: index === 0 ? 'left' : 'right',
      beginAtZero: name !== 'voltage',
      grid: { drawOnChartArea: index === 0, color: gridColor },
      ticks: { color: descriptor?.color ?? tickColor },
      title: {
        display: index < 2,
        text: `${descriptor?.label ?? name} (${descriptor?.unit ?? ''})`,
        color: descriptor?.color ?? tickColor,
      },
    };
  });

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false }, tooltip: { enabled: true } },
    scales,
  };

  const toggleSeries = (name: SeriesName) => {
    setVisibleSeries(previous => previous.includes(name)
      ? previous.filter(series => series !== name)
      : [...previous, name]);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1.5 mb-2 flex-wrap shrink-0">
        {SERIES.map(series => {
          const active = visibleSeries.includes(series.name);
          return <button key={series.name} onClick={() => toggleSeries(series.name)} className="px-1.5 py-0.5 text-[10px] font-medium rounded" style={{ backgroundColor: active ? series.color : 'var(--color-border-light)', color: active ? 'white' : 'var(--color-text-muted)', opacity: active ? 1 : 0.6 }}>{series.label}</button>;
        })}
        <select className="ml-auto px-1.5 py-0.5 text-xs rounded" value={timeWindow} onChange={event => setTimeWindow(Number(event.target.value))} aria-label="Chart time range">
          <option value={0}>All</option>
          <option value={2}>2m</option>
          <option value={5}>5m</option>
          <option value={10}>10m</option>
          <option value={20}>20m</option>
        </select>
      </div>
      <div className="flex-1 min-h-0">
        {filtered.length > 0 ? <Line data={data} options={options} /> : <div className="h-full flex items-center justify-center text-xs text-[var(--color-text-muted)]">Waiting for measurements…</div>}
      </div>
    </div>
  );
});
