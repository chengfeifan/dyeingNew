import React, { useEffect, useMemo, useState } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';
import { analyzeStandardLibraryPca, fetchHistoryList, parseSpcReference, projectRealtimePcaPath } from '../services/api';
import { HistoryItem, PcaLibraryResult } from '../types';

type CsvParsed = { wavelength: number[]; series: Array<{ label: string; values: number[]; isIntensity: boolean }> };
type SpectrumSeries = { label: string; absorbance: number[]; timestampText: string; timestampValue: number };

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
    return {
      label,
      values: ranged.absorbance,
      isIntensity: hasSingleSeries && intensityIndex >= 0,
      wavelength: ranged.wavelength,
    };
  });
  return {
    wavelength: parsedSeries[0]?.wavelength || [],
    series: parsedSeries.map((item) => ({ label: item.label, values: item.values, isIntensity: item.isIntensity })),
  };
};

const interpolateLinear = (xSource: number[], ySource: number[], xTarget: number[]): number[] => {
  if (!xSource.length || xSource.length !== ySource.length) return xTarget.map(() => 0);
  return xTarget.map((x) => {
    if (x <= xSource[0]) return ySource[0];
    if (x >= xSource[xSource.length - 1]) return ySource[ySource.length - 1];
    let right = 1;
    while (right < xSource.length && xSource[right] < x) right += 1;
    const left = Math.max(0, right - 1);
    const x0 = xSource[left];
    const x1 = xSource[right];
    const y0 = ySource[left];
    const y1 = ySource[right];
    if (x1 === x0) return y0;
    const ratio = (x - x0) / (x1 - x0);
    return y0 + ratio * (y1 - y0);
  });
};

const extractTimestamp = (filename: string): { timestampText: string; timestampValue: number } => {
  const matched = filename.match(/(\d{4})-(\d{2})-(\d{2})-[^-]*-(\d{2})(\d{2})(\d{2})/);
  if (matched) {
    const [, year, month, day, hh, mm, ss] = matched;
    const date = new Date(`${year}-${month}-${day}T${hh}:${mm}:${ss}`);
    if (!Number.isNaN(date.getTime())) {
      return {
        timestampText: `${year}/${month}/${day} ${hh}:${mm}:${ss}`,
        timestampValue: date.getTime(),
      };
    }
  }
  return { timestampText: filename, timestampValue: Number.MAX_SAFE_INTEGER };
};

const TARGET_OPTIONS: Array<{ value: 'I_corr' | 'T' | 'A'; label: string }> = [
  { value: 'I_corr', label: 'I_corr' },
  { value: 'T', label: 'transmittance' },
  { value: 'A', label: 'Absorbance' },
];

const formatPcaTick = (value: number | string): string => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num.toFixed(1) : `${value}`;
};

export const OnlineAnalysisPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'library' | 'online'>('library');
  const [pcaResult, setPcaResult] = useState<PcaLibraryResult | null>(null);
  const [pathData, setPathData] = useState<Array<{ label: string; pc1: number; pc2: number; timestampText: string; timestampValue: number }>>([]);
  const [standardItems, setStandardItems] = useState<HistoryItem[]>([]);
  const [selectedStandards, setSelectedStandards] = useState<string[]>([]);
  const [analysisTarget, setAnalysisTarget] = useState<'I_corr' | 'T' | 'A'>('A');
  const [rangeMinNm, setRangeMinNm] = useState<number>(188);
  const [rangeMaxNm, setRangeMaxNm] = useState<number>(800);
  const [darkSpc, setDarkSpc] = useState<File | null>(null);
  const [waterSpc, setWaterSpc] = useState<File | null>(null);
  const [savedSnapshots, setSavedSnapshots] = useState<Array<Record<string, any>>>([]);
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
      let darkInterp: number[] | null = null;
      let waterInterp: number[] | null = null;
      if (darkSpc && waterSpc) {
        const parsedDark = await parseSpcReference(darkSpc);
        const parsedWater = await parseSpcReference(waterSpc);
        darkInterp = interpolateLinear(parsedDark.wavelength_nm, parsedDark.intensity, baseWavelength);
        waterInterp = interpolateLinear(parsedWater.wavelength_nm, parsedWater.intensity, baseWavelength);
      }
      const mergedSeries: SpectrumSeries[] = parsedSeries.map((parsed, index) => {
        const first = parsed.series[0];
        if (!first) throw new Error(`CSV ${csvFiles[index].name} 缺少 I_corr 列`);
        let absorbance = first.isIntensity ? intensityToAbsorbance(first.values) : first.values;
        if (darkInterp && waterInterp) {
          if (!first.isIntensity) {
            throw new Error(`CSV ${csvFiles[index].name} 不是强度数据，无法结合暗光谱/清水光谱重新计算吸光度`);
          }
          absorbance = first.values.map((sampleIntensity, i) => {
            const denominator = Math.max(waterInterp![i] - darkInterp![i], 1e-8);
            const transmittance = Math.max((sampleIntensity - darkInterp![i]) / denominator, 1e-8);
            return -Math.log10(transmittance);
          });
        }
        const timeInfo = extractTimestamp(csvFiles[index].name);
        return {
          label: csvFiles[index].name.replace(/\.csv$/i, '') || first.label,
          absorbance,
          ...timeInfo,
        };
      });
      const path = await projectRealtimePcaPath(baseWavelength, mergedSeries, pcaResult.model);
      const mergedPath = path
        .map((point, idx) => ({ ...point, ...mergedSeries[idx] }))
        .sort((a, b) => a.timestampValue - b.timestampValue);
      setPathData(mergedPath);
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

  const saveSnapshotAsJson = () => {
    if (!pathData.length || !pcaResult?.model?.wavelength_nm?.length) {
      setError('暂无可保存的在线吸光度结果');
      return;
    }
    const snapshot = {
      saved_at: new Date().toISOString(),
      pca_target: analysisTarget,
      wavelength_nm: pcaResult.model.wavelength_nm,
      records: pathData.map((item) => ({
        label: item.label,
        timestamp: item.timestampText,
        pc1: item.pc1,
        pc2: item.pc2,
      })),
    };
    const next = [...savedSnapshots, snapshot];
    setSavedSnapshots(next);
    const blob = new Blob([JSON.stringify(next, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `online_pca_absorbance_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-7xl mx-auto h-full flex flex-col gap-6 text-slate-300">
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
        <h2 className="text-lg font-semibold text-slate-100 mb-2">在线数据侧栏分析（PCA）</h2>
        <p className="text-sm text-slate-500 mb-4">先进行标准库 PCA，再切换到在线数据上传。支持暗光谱/清水光谱（SPC）参与吸光度计算，并按时间轴查看 PC1、PC2 轨迹。</p>
        <div className="flex gap-2 mb-4">
          <button onClick={() => setActiveTab('library')} className={`px-3 py-1 rounded text-sm ${activeTab === 'library' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'}`}>标准库 PCA</button>
          <button onClick={() => setActiveTab('online')} className={`px-3 py-1 rounded text-sm ${activeTab === 'online' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'}`}>在线数据上传</button>
        </div>

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

        {activeTab === 'library' && (
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={runLibraryPca}
              disabled={loading || selectedStandards.length < 2}
              className="px-4 py-2 bg-indigo-600 rounded-md text-white text-sm font-medium disabled:bg-slate-700"
            >
              标准库 PCA 分析
            </button>
          </div>
        )}
        {activeTab === 'online' && (
          <div className="space-y-3">
            <div className="flex gap-3 items-center flex-wrap">
              <label className="text-sm text-slate-400">暗光谱(SPC)</label>
              <input type="file" accept=".spc,.txt,.csv" onChange={(e) => setDarkSpc(e.target.files?.[0] || null)} className="text-sm text-slate-400" />
              <label className="text-sm text-slate-400">清水光谱(SPC)</label>
              <input type="file" accept=".spc,.txt,.csv" onChange={(e) => setWaterSpc(e.target.files?.[0] || null)} className="text-sm text-slate-400" />
            </div>
            <div className="flex gap-3 items-center flex-wrap">
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
              <button onClick={saveSnapshotAsJson} disabled={!pathData.length} className="px-3 py-1 bg-cyan-700 rounded text-sm disabled:bg-slate-700">保存在线结果(JSON)</button>
            </div>
          </div>
        )}
        <p className="text-xs text-slate-500 mt-2">在线导入支持从文件名提取时间（如 2026-04-09-SPEC-023002.csv → 2026/04/09 02:30:02），并按时间排序绘制 PC1、PC2。</p>
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
              <XAxis type="number" dataKey="pc1" stroke="#94a3b8" name="PC1" label={{ value: 'PC1', position: 'insideBottom', offset: -10 }} tickFormatter={formatPcaTick} />
              <YAxis dataKey="pc2" stroke="#94a3b8" name="PC2" tickFormatter={formatPcaTick} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} />
              <Scatter data={pcaResult?.points || []} fill="#6366f1" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 h-[420px]">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">实时光谱投影（PC1/PC2 vs 时间）</h3>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={pathData} margin={{ top: 20, right: 20, bottom: 30, left: 10 }}>
              <CartesianGrid stroke="#334155" />
              <XAxis dataKey="timestampText" stroke="#94a3b8" angle={-20} textAnchor="end" height={60} />
              <YAxis stroke="#94a3b8" tickFormatter={formatPcaTick} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="pc1" stroke="#f59e0b" dot={{ r: 3 }} name="PC1" />
              <Line type="monotone" dataKey="pc2" stroke="#22d3ee" dot={{ r: 3 }} name="PC2" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
