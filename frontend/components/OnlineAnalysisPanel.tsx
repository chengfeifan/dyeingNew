import React, { useEffect, useMemo, useState } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';
import { analyzeStandardLibraryPca, fetchHistoryList, projectRealtimePcaPath } from '../services/api';
import { HistoryItem, PcaLibraryResult } from '../types';

type CsvParsed = { wavelength: number[]; series: Array<{ label: string; absorbance: number[] }> };

const splitColumns = (line: string): string[] => {
  if (line.includes('\t')) return line.split('\t').map((item) => item.trim());
  if (line.includes(',')) return line.split(',').map((item) => item.trim());
  return line.split(/\s+/).map((item) => item.trim());
};

const normalizeHeader = (value: string): string => value.trim().toLowerCase();

const intensityToAbsorbance = (intensity: number[]): number[] => {
  const safeIntensity = intensity.map((value) => (Number.isFinite(value) ? Math.max(value, 1e-8) : 1e-8));
  const i0 = Math.max(...safeIntensity);
  const safeI0 = Math.max(i0, 1e-8);
  return safeIntensity.map((value) => -Math.log10(value / safeI0));
};

const applyRange = (
  wavelength: number[],
  absorbance: number[],
  rangeMin: number,
  rangeMax: number
): { wavelength: number[]; absorbance: number[] } => {
  const left = Math.min(rangeMin, rangeMax);
  const right = Math.max(rangeMin, rangeMax);
  const selected = wavelength
    .map((wl, idx) => ({ wl, ab: absorbance[idx] }))
    .filter((point) => point.wl >= left && point.wl <= right);
  if (!selected.length) {
    throw new Error(`所选波长范围 ${left}-${right}nm 内无可用数据`);
  }
  return {
    wavelength: selected.map((point) => point.wl),
    absorbance: selected.map((point) => point.ab),
  };
};

const parseCsv = async (file: File, rangeMin: number, rangeMax: number): Promise<CsvParsed> => {
  const text = await file.text();
  const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (rows.length < 2) throw new Error('CSV 至少需要表头和一行数据');
  const headers = splitColumns(rows[0]);
  if (headers.length < 2) throw new Error('CSV 至少包含 wavelength 和一条光谱列');
  const normalizedHeaders = headers.map(normalizeHeader);
  const wavelengthIndex = normalizedHeaders.findIndex((header) => ['wavelength', 'lambda', 'wl'].includes(header));
  if (wavelengthIndex < 0) throw new Error('CSV 必须包含 wavelength 列');
  const intensityIndex = normalizedHeaders.findIndex((header) => ['intensity', 'i_corr', 'i', 'signal'].includes(header));
  const absorbanceIndex = normalizedHeaders.findIndex((header) => ['absorbance', 'a'].includes(header));
  const hasSingleSeries = intensityIndex >= 0 || absorbanceIndex >= 0;
  const labels = hasSingleSeries
    ? [headers[intensityIndex >= 0 ? intensityIndex : absorbanceIndex] || 'realtime']
    : headers.filter((_, idx) => idx !== wavelengthIndex).map((v, i) => v || `t${i + 1}`);
  const wavelength: number[] = [];
  const seriesValues = labels.map(() => [] as number[]);
  rows.slice(1).forEach((line) => {
    const cols = splitColumns(line);
    const wl = Number(cols[wavelengthIndex]);
    if (Number.isNaN(wl)) return;
    wavelength.push(wl);
    if (hasSingleSeries) {
      const rawValue = Number(cols[intensityIndex >= 0 ? intensityIndex : absorbanceIndex] || 0);
      seriesValues[0].push(Number.isFinite(rawValue) ? rawValue : 0);
      return;
    }
    let seriesCursor = 0;
    headers.forEach((_, idx) => {
      if (idx === wavelengthIndex) return;
      const rawValue = Number(cols[idx] || 0);
      seriesValues[seriesCursor].push(Number.isFinite(rawValue) ? rawValue : 0);
      seriesCursor += 1;
    });
  });
  const parsedSeries = labels.map((label, idx) => {
    const values = seriesValues[idx] || [];
    const absorbance = hasSingleSeries && intensityIndex >= 0 ? intensityToAbsorbance(values) : values;
    const ranged = applyRange(wavelength, absorbance, rangeMin, rangeMax);
    return { label, absorbance: ranged.absorbance, wavelength: ranged.wavelength };
  });
  return {
    wavelength: parsedSeries[0]?.wavelength || [],
    series: parsedSeries.map((item) => ({ label: item.label, absorbance: item.absorbance })),
  };
};

const TARGET_OPTIONS: Array<{ value: 'I_corr' | 'T' | 'A'; label: string }> = [
  { value: 'I_corr', label: 'I_corr' },
  { value: 'T', label: 'transmittance' },
  { value: 'A', label: 'Absorbance' },
];

export const OnlineAnalysisPanel: React.FC = () => {
  const [pcaResult, setPcaResult] = useState<PcaLibraryResult | null>(null);
  const [pathData, setPathData] = useState<Array<{ label: string; pc1: number; pc2: number }>>([]);
  const [standardItems, setStandardItems] = useState<HistoryItem[]>([]);
  const [selectedStandards, setSelectedStandards] = useState<string[]>([]);
  const [analysisTarget, setAnalysisTarget] = useState<'I_corr' | 'T' | 'A'>('A');
  const [rangeMinNm, setRangeMinNm] = useState<number>(188);
  const [rangeMaxNm, setRangeMaxNm] = useState<number>(800);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadStandards = async () => {
      try {
        const all = await fetchHistoryList();
        const standards = all.filter((item) => item.meta?.save_type === 'standard');
        setStandardItems(standards);
        setSelectedStandards(standards.map((item) => item.filename));
      } catch (e: any) {
        setError(e?.message || '标准库读取失败');
      }
    };
    loadStandards();
  }, []);

  const runLibraryPca = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await analyzeStandardLibraryPca(selectedStandards, analysisTarget);
      setPcaResult(result);
      setPathData([]);
    } catch (e: any) {
      setError(e?.message || '标准库 PCA 分析失败');
    } finally {
      setLoading(false);
    }
  };

  const handleUploadRealtime = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!pcaResult || !e.target.files?.length) return;
    setLoading(true);
    setError(null);
    try {
      const csvFiles = Array.from(e.target.files).filter((file) => file.name.toLowerCase().endsWith('.csv'));
      if (!csvFiles.length) throw new Error('未检测到 CSV 文件');
      const parsedSeries = await Promise.all(csvFiles.map((file) => parseCsv(file, rangeMinNm, rangeMaxNm)));
      const baseWavelength = parsedSeries[0].wavelength;
      if (!baseWavelength?.length) throw new Error('CSV 缺少有效波长数据');
      const mergedSeries = parsedSeries.map((parsed, index) => {
        const first = parsed.series[0];
        if (!first) throw new Error(`CSV ${csvFiles[index].name} 缺少 I_corr 列`);
        return {
          label: csvFiles[index].name.replace(/\.csv$/i, '') || first.label,
          absorbance: first.absorbance,
        };
      });
      const path = await projectRealtimePcaPath(baseWavelength, mergedSeries, pcaResult.model);
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

  const selectedTargetLabel = useMemo(
    () => TARGET_OPTIONS.find((option) => option.value === analysisTarget)?.label || analysisTarget,
    [analysisTarget]
  );

  const toggleStandard = (filename: string) => {
    setSelectedStandards((prev) => (prev.includes(filename) ? prev.filter((item) => item !== filename) : [...prev, filename]));
  };

  const selectAllStandards = () => setSelectedStandards(standardItems.map((item) => item.filename));
  const clearAllStandards = () => setSelectedStandards([]);

  return (
    <div className="max-w-7xl mx-auto h-full flex flex-col gap-6 text-slate-300">
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
        <h2 className="text-lg font-semibold text-slate-100 mb-2">在线数据侧栏分析（PCA）</h2>
        <p className="text-sm text-slate-500 mb-4">先选择标准库和分析对象执行 PCA，再导入在线 I_corr CSV（支持文件夹）生成 PC1-PC2 路径图。</p>

        <div className="space-y-3 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-slate-400">PCA 分析内容</label>
            <select
              value={analysisTarget}
              onChange={(e) => setAnalysisTarget(e.target.value as 'I_corr' | 'T' | 'A')}
              className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-sm text-slate-200"
            >
              {TARGET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-slate-400">在线数据光谱范围 (nm)</label>
            <input
              type="number"
              value={rangeMinNm}
              onChange={(e) => setRangeMinNm(Number(e.target.value || 0))}
              className="w-28 bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-sm text-slate-200"
            />
            <span className="text-slate-500">~</span>
            <input
              type="number"
              value={rangeMaxNm}
              onChange={(e) => setRangeMaxNm(Number(e.target.value || 0))}
              className="w-28 bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-sm text-slate-200"
            />
          </div>

          <div className="bg-slate-950/40 border border-slate-800 rounded-md p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-slate-300">标准库选择（{selectedStandards.length}/{standardItems.length}）</p>
              <div className="flex gap-2">
                <button onClick={selectAllStandards} className="text-xs px-2 py-1 bg-slate-800 rounded">全选</button>
                <button onClick={clearAllStandards} className="text-xs px-2 py-1 bg-slate-800 rounded">清空</button>
              </div>
            </div>
            <div className="max-h-36 overflow-auto grid grid-cols-1 md:grid-cols-2 gap-1">
              {standardItems.map((item) => (
                <label key={item.filename} className="flex items-center gap-2 text-sm text-slate-400">
                  <input
                    type="checkbox"
                    checked={selectedStandards.includes(item.filename)}
                    onChange={() => toggleStandard(item.filename)}
                    className="rounded bg-slate-800 border-slate-600 text-indigo-500"
                  />
                  <span className="truncate">{item.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={runLibraryPca}
            disabled={loading || selectedStandards.length < 2}
            className="px-4 py-2 bg-indigo-600 rounded-md text-white text-sm font-medium disabled:bg-slate-700"
          >
            1) 标准库 PCA 分析
          </button>
          <input
            type="file"
            accept=".csv"
            multiple
            // @ts-ignore: 浏览器目录导入属性
            webkitdirectory="true"
            onChange={handleUploadRealtime}
            disabled={!pcaResult || loading}
            className="text-sm text-slate-400"
          />
        </div>
        <p className="text-xs text-slate-500 mt-2">2) 在线数据导入：支持单个 CSV、多选 CSV 或整文件夹导入。若列为 wavelength/intensity，将按所选范围转换为吸光度后再投影。</p>
        {varianceText && <p className="text-xs text-indigo-400 mt-2">{varianceText}</p>}
        {pcaResult && <p className="text-xs text-cyan-400 mt-1">当前 PCA 分析对象：{selectedTargetLabel}</p>}
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
