import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { ProcessedData } from '../types';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';

interface Props {
  data: ProcessedData;
}

export const SpectralChart: React.FC<Props> = ({ data }) => {
  const [visibleLines, setVisibleLines] = useState({
    I_corr: true,
    T: true,
    A: true
  });

  // Transform data for Recharts (array of objects)
  const chartData = useMemo(() => {
    if (!data || !data.data.lambda) return [];
    return data.data.lambda.map((lambda, i) => ({
      lambda,
      I_corr: data.data.I_corr[i],
      T: data.data.T[i],
      A: data.data.A[i],
    }));
  }, [data]);

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
    <div className="h-full flex flex-col">
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
        <button 
            onClick={downloadCSV}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-slate-200 rounded-md text-sm hover:bg-slate-700 transition-colors border border-slate-700"
        >
            <ArrowDownTrayIcon className="w-4 h-4" />
            Export CSV
        </button>
      </div>

      <div className="flex-1 min-h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 20, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis 
                dataKey="lambda" 
                label={{ value: 'Wavelength / Wavenumber', position: 'insideBottom', offset: -10, fill: '#64748b' }} 
                tick={{ fontSize: 12, fill: '#94a3b8' }}
                stroke="#475569"
            />
            <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} stroke="#475569" />
            <Tooltip 
                contentStyle={{ backgroundColor: '#0f172a', borderRadius: '6px', border: '1px solid #334155', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)', color: '#f1f5f9' }}
                itemStyle={{ color: '#e2e8f0' }}
            />
            <Legend verticalAlign="top" height={36} wrapperStyle={{ color: '#cbd5e1' }}/>
            
            {visibleLines.I_corr && (
                <Line type="monotone" dataKey="I_corr" stroke="#3b82f6" dot={false} strokeWidth={2} name="I_corr (Sample - Dark)" />
            )}
            {visibleLines.T && (
                <Line type="monotone" dataKey="T" stroke="#10b981" dot={false} strokeWidth={2} name="Transmittance" />
            )}
            {visibleLines.A && (
                <Line type="monotone" dataKey="A" stroke="#ef4444" dot={false} strokeWidth={2} name="Absorbance (-log10 T)" />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};