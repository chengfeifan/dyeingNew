import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { ProcessedData } from '../types';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { WavelengthColorBand } from './WavelengthColorBand';

interface Props {
  data: ProcessedData;
}

export const SpectralChart: React.FC<Props> = ({ data }) => {
  const [visibleLines, setVisibleLines] = useState({
    I_corr: true,
    T: true,
    A: true
  });
  const [rangeMin, setRangeMin] = useState<string>('380');
  const [rangeMax, setRangeMax] = useState<string>('780');

  // Transform data for Recharts (array of objects)
  const rawChartData = useMemo(() => {
    if (!data || !data.data.lambda) return [];
    return data.data.lambda.map((lambda, i) => ({
      lambda,
      I_corr: Number.isFinite(data.data.I_corr[i]) ? data.data.I_corr[i] : null,
      T: Number.isFinite(data.data.T[i]) ? data.data.T[i] : null,
      A: Number.isFinite(data.data.A[i]) ? data.data.A[i] : null,
    })).sort((a, b) => a.lambda - b.lambda);
  }, [data]);

  const chartData = useMemo(() => {
    if (!rawChartData.length) return [];
    const min = Number(rangeMin);
    const max = Number(rangeMax);
    const hasMin = rangeMin.trim() !== '' && !Number.isNaN(min);
    const hasMax = rangeMax.trim() !== '' && !Number.isNaN(max);

    return rawChartData.filter((row) => {
      if (hasMin && row.lambda < min) return false;
      if (hasMax && row.lambda > max) return false;
      return true;
    });
  }, [rawChartData, rangeMin, rangeMax]);

  const yDomain = useMemo<[number, number]>(() => {
    if (!chartData.length) return [-0.1, 1.1];

    const activeKeys = (Object.keys(visibleLines) as Array<keyof typeof visibleLines>).filter(
      (key) => visibleLines[key]
    );

    if (!activeKeys.length) return [-0.1, 1.1];

    const values = chartData.flatMap((row) =>
      activeKeys
        .map((key) => row[key])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    );

    if (!values.length) return [-0.1, 1.1];

    const sorted = [...values].sort((a, b) => a - b);
    const quantile = (q: number) => {
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
      return sorted[idx];
    };

    let min = quantile(0.01);
    let max = quantile(0.99);

    if (!Number.isFinite(min) || !Number.isFinite(max)) return [-0.1, 1.1];
    if (min === max) {
      const pad = Math.max(Math.abs(min) * 0.1, 0.1);
      return [min - pad, max + pad];
    }

    const pad = Math.max((max - min) * 0.08, 0.05);
    min -= pad;
    max += pad;

    if (visibleLines.T && !visibleLines.A && !visibleLines.I_corr) {
      min = Math.max(min, -0.05);
      max = Math.min(max, 1.2);
    }

    return [min, max];
  }, [chartData, visibleLines]);

  const toggleLine = (key: keyof typeof visibleLines) => {
    setVisibleLines(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const downloadCSV = () => {
    const headers = ['lambda', 'I_corr', 'T', 'A'];
    const csvContent = "data:text/csv;charset=utf-8," 
        + headers.join(",") + "\n"
        + chartData.map(row => `${row.lambda},${row.I_corr},${row.T},${row.A}`).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${data.meta.name || 'spectrum'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="w-full flex flex-col">
      <div className="flex justify-between items-center mb-6 border-b border-slate-800 pb-4">
        <div>
            <h3 className="text-xl font-bold text-slate-100">{data.meta.name || "Analysis Result"}</h3>
          <div className="flex gap-4 mt-2">
                <label className="flex items-center space-x-1 text-xs text-slate-400 cursor-pointer hover:text-slate-200">
                    <input type="checkbox" checked={visibleLines.I_corr} onChange={() => toggleLine('I_corr')} className="rounded bg-slate-800 border-slate-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-900"/>
                    <span className={visibleLines.I_corr ? "text-blue-400" : ""}>I_corr</span>
                </label>
                <label className="flex items-center space-x-1 text-xs text-slate-400 cursor-pointer hover:text-slate-200">
                    <input type="checkbox" checked={visibleLines.T} onChange={() => toggleLine('T')} className="rounded bg-slate-800 border-slate-600 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-slate-900"/>
                    <span className={visibleLines.T ? "text-emerald-400" : ""}>Transmittance (T)</span>
                </label>
                <label className="flex items-center space-x-1 text-xs text-slate-400 cursor-pointer hover:text-slate-200">
                    <input type="checkbox" checked={visibleLines.A} onChange={() => toggleLine('A')} className="rounded bg-slate-800 border-slate-600 text-red-500 focus:ring-red-500 focus:ring-offset-slate-900"/>
                    <span className={visibleLines.A ? "text-red-400" : ""}>Absorbance (A)</span>
                </label>
            </div>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">波长最小值</label>
            <input
              value={rangeMin}
              onChange={(e) => setRangeMin(e.target.value)}
              placeholder="例如 380"
              className="w-24 bg-slate-800 border-slate-700 rounded-md text-xs text-slate-200"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">波长最大值</label>
            <input
              value={rangeMax}
              onChange={(e) => setRangeMax(e.target.value)}
              placeholder="例如 780"
              className="w-24 bg-slate-800 border-slate-700 rounded-md text-xs text-slate-200"
            />
          </div>
          <button
            onClick={() => {
              setRangeMin('380');
              setRangeMax('780');
            }}
            className="px-3 py-2 text-xs bg-slate-800 text-slate-300 rounded-md hover:bg-slate-700 border border-slate-700"
          >
            重置
          </button>
          <button 
              onClick={downloadCSV}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-slate-200 rounded-md text-sm hover:bg-slate-700 transition-colors border border-slate-700"
          >
              <ArrowDownTrayIcon className="w-4 h-4" />
              Export CSV
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="w-full h-[420px] min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 20, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis 
                dataKey="lambda" 
                type="number"
                domain={['dataMin', 'dataMax']}
                label={{ value: 'Wavelength / Wavenumber', position: 'insideBottom', offset: -10, fill: '#64748b' }} 
                tick={{ fontSize: 12, fill: '#94a3b8' }}
                stroke="#475569"
                tickFormatter={(value: number) => Number(value).toFixed(1)}
              />
              <YAxis domain={yDomain} tick={{ fontSize: 12, fill: '#94a3b8' }} stroke="#475569" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#0f172a', borderRadius: '6px', border: '1px solid #334155', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)', color: '#f1f5f9' }}
                itemStyle={{ color: '#e2e8f0' }}
                labelFormatter={(value: number) => `${Number(value).toFixed(1)} nm`}
              />
              <Legend verticalAlign="top" height={36} wrapperStyle={{ color: '#cbd5e1' }}/>
      
              {visibleLines.I_corr && (
                <Line type="linear" dataKey="I_corr" stroke="#3b82f6" dot={false} strokeWidth={2} name="I_corr (Sample - Dark)" isAnimationActive={false} />
              )}
              {visibleLines.T && (
                <Line type="linear" dataKey="T" stroke="#10b981" dot={false} strokeWidth={2} name="Transmittance" isAnimationActive={false} />
              )}
              {visibleLines.A && (
                <Line type="linear" dataKey="A" stroke="#ef4444" dot={false} strokeWidth={2} name="Absorbance (-log10 T)" isAnimationActive={false} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      
        <div className="mt-2 shrink-0">
          <WavelengthColorBand />
        </div>
      </div>
    </div>
  );
};
