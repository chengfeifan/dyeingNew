import React, { useMemo, useState } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';
import { analyzeStandardLibraryPca, projectRealtimePcaPath } from '../services/api';
import { PcaLibraryResult } from '../types';

type CsvParsed = { wavelength: number[]; series: Array<{ label: string; absorbance: number[] }> };

const parseCsv = async (file: File): Promise<CsvParsed> => {
  const text = await file.text();
  const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (rows.length < 2) throw new Error('CSV 至少需要表头和一行数据');
  const headers = rows[0].split(',').map((h) => h.trim());
  if (headers.length < 2) throw new Error('CSV 至少包含 wavelength 和一条光谱列');
  const labels = headers.slice(1).map((v, i) => v || `t${i + 1}`);
  const wavelength: number[] = [];
  const seriesValues = labels.map(() => [] as number[]);
  rows.slice(1).forEach((line) => {
    const cols = line.split(',').map((c) => c.trim());
    const wl = Number(cols[0]);
    if (Number.isNaN(wl)) return;
    wavelength.push(wl);
    labels.forEach((_, idx) => {
      seriesValues[idx].push(Number(cols[idx + 1] || 0));
    });
  });
  return { wavelength, series: labels.map((label, idx) => ({ label, absorbance: seriesValues[idx] })) };
};

export const OnlineAnalysisPanel: React.FC = () => {
  const [pcaResult, setPcaResult] = useState<PcaLibraryResult | null>(null);
  const [pathData, setPathData] = useState<Array<{ label: string; pc1: number; pc2: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runLibraryPca = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await analyzeStandardLibraryPca([]);
      setPcaResult(result);
      setPathData([]);
    } catch (e: any) {
      setError(e?.message || '标准库 PCA 分析失败');
    } finally {
      setLoading(false);
    }
  };

  const handleUploadRealtime = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!pcaResult || !e.target.files?.[0]) return;
    setLoading(true);
    setError(null);
    try {
      const parsed = await parseCsv(e.target.files[0]);
      const path = await projectRealtimePcaPath(parsed.wavelength, parsed.series, pcaResult.model);
      setPathData(path);
    } catch (err: any) {
      setError(err?.message || '实时光谱解析失败');
    } finally {
      setLoading(false);
    }
  };

  const varianceText = useMemo(() => {
    if (!pcaResult?.explained_variance_ratio?.length) return '';
    return pcaResult.explained_variance_ratio
      .slice(0, 2)
      .map((v, i) => `PC${i + 1}: ${(v * 100).toFixed(2)}%`)
      .join(' / ');
  }, [pcaResult]);

  return (
    <div className="max-w-7xl mx-auto h-full flex flex-col gap-6 text-slate-300">
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
        <h2 className="text-lg font-semibold text-slate-100 mb-2">在线数据侧栏分析（PCA）</h2>
        <p className="text-sm text-slate-500 mb-4">先对标准库执行 PCA，再上传在线实时光谱 CSV，生成 PC1-PC2 路径图。</p>
        <div className="flex items-center gap-3">
          <button
            onClick={runLibraryPca}
            disabled={loading}
            className="px-4 py-2 bg-indigo-600 rounded-md text-white text-sm font-medium disabled:bg-slate-700"
          >
            1) 标准库 PCA 分析
          </button>
          <input type="file" accept=".csv" onChange={handleUploadRealtime} disabled={!pcaResult || loading} className="text-sm text-slate-400" />
        </div>
        {varianceText && <p className="text-xs text-indigo-400 mt-2">{varianceText}</p>}
        {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 h-[420px]">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">标准库 PCA 分布（PC1 vs PC2）</h3>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 20, right: 20, bottom: 30, left: 10 }}>
              <CartesianGrid stroke="#334155" />
              <XAxis dataKey="pc1" stroke="#94a3b8" name="PC1" />
              <YAxis dataKey="pc2" stroke="#94a3b8" name="PC2" />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} />
              <Scatter data={pcaResult?.points || []} fill="#6366f1" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 h-[420px]">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">实时光谱投影路径（PC1-PC2）</h3>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={pathData} margin={{ top: 20, right: 20, bottom: 30, left: 10 }}>
              <CartesianGrid stroke="#334155" />
              <XAxis dataKey="pc1" type="number" stroke="#94a3b8" />
              <YAxis dataKey="pc2" type="number" stroke="#94a3b8" />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="pc2" stroke="#22d3ee" dot={{ r: 3 }} name="Path on PC plane" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
