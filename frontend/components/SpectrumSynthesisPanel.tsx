import React, { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fetchHistoryItem, fetchHistoryList } from '../services/api';
import { HistoryItem } from '../types';

type SynthesisRow = { filename: string; concentration: string };
type SimilarityRow = { name: string; rmse: number; similarity: number };
type ParsedOnlineRecipe = { rows: SynthesisRow[]; sourceName: string };

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

const parseFirstNumber = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const matched = raw.match(/-?\d+(\.\d+)?/);
  if (!matched) return null;
  const num = Number(matched[0]);
  return Number.isFinite(num) ? num : null;
};

const parseOnlineRecipeRows = (item: HistoryItem): SynthesisRow[] => {
  const standardTokens = (item.meta?.online_standard || '')
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);
  const concentrationTokens = (item.meta?.online_concentration || '')
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);
  if (!standardTokens.length || !concentrationTokens.length) return [];
  return standardTokens
    .map((filename, idx) => ({ filename, concentration: concentrationTokens[idx] || '' }))
    .filter((row) => row.filename && Number.isFinite(Number(row.concentration)) && Number(row.concentration) > 0);
};

const formatTick = (value: number | string): string => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num.toFixed(2) : `${value}`;
};

export const SpectrumSynthesisPanel: React.FC = () => {
  const [standardItems, setStandardItems] = useState<HistoryItem[]>([]);
  const [onlineItems, setOnlineItems] = useState<HistoryItem[]>([]);
  const [synthesisRows, setSynthesisRows] = useState<SynthesisRow[]>([{ filename: '', concentration: '' }]);
  const [selectedOnlineCurves, setSelectedOnlineCurves] = useState<string[]>([]);
  const [rangeMinNm, setRangeMinNm] = useState<number>(188);
  const [rangeMaxNm, setRangeMaxNm] = useState<number>(800);
  const [synthesisResult, setSynthesisResult] = useState<{
    wavelength: number[];
    absorbance: number[];
    components: Array<{ name: string; inputConcentration: number; weight: number }>;
  } | null>(null);
  const [compareSeries, setCompareSeries] = useState<Array<{ name: string; wavelength: number[]; absorbance: number[] }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoFilledSourceName, setAutoFilledSourceName] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const all = await fetchHistoryList();
        setStandardItems(all.filter((item) => item.meta?.save_type === 'standard'));
        setOnlineItems(all.filter((item) => item.meta?.save_type === 'online'));
      } catch (e: any) {
        setError(e?.message || '历史数据读取失败');
      }
    };
    loadData();
  }, []);

  const updateSynthesisRow = (index: number, key: keyof SynthesisRow, value: string) => {
    setSynthesisRows((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  };

  const addSynthesisRow = () => setSynthesisRows((prev) => [...prev, { filename: '', concentration: '' }]);

  const removeSynthesisRow = (index: number) => {
    setSynthesisRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const runNllsSynthesis = async () => {
    setLoading(true);
    setError(null);
    try {
      let rowsForSynthesis = synthesisRows;
      let parsedOnlineRecipe: ParsedOnlineRecipe | null = null;
      if (selectedOnlineCurves.length) {
        const selectedCurve = selectedOnlineCurves
          .map((filename) => onlineItems.find((item) => item.filename === filename))
          .find((item): item is HistoryItem => Boolean(item));
        if (selectedCurve) {
          const recipeRows = parseOnlineRecipeRows(selectedCurve);
          if (recipeRows.length) {
            rowsForSynthesis = recipeRows;
            parsedOnlineRecipe = {
              rows: recipeRows,
              sourceName: selectedCurve.name || selectedCurve.filename,
            };
            setSynthesisRows(recipeRows);
            setAutoFilledSourceName(selectedCurve.name || selectedCurve.filename);
          }
        }
      }

      const validRows = rowsForSynthesis
        .map((row) => ({ ...row, concentrationNum: Number(row.concentration) }))
        .filter((row) => row.filename && Number.isFinite(row.concentrationNum) && row.concentrationNum > 0);
      if (!validRows.length) throw new Error('请至少选择一个标准染料并输入有效浓度');

      const historyMap = new Map(standardItems.map((item) => [item.filename, item]));
      const loaded = await Promise.all(validRows.map(async (row) => {
        const detail = await fetchHistoryItem(row.filename);
        const ranged = applyRange(detail.data.lambda || [], detail.data.A || [], rangeMinNm, rangeMaxNm);
        const refText = historyMap.get(row.filename)?.meta?.concentration || detail.meta?.concentration;
        const refConc = parseFirstNumber(refText) || 1;
        return {
          filename: row.filename,
          name: historyMap.get(row.filename)?.name || detail.meta?.name || row.filename,
          wavelength: ranged.wavelength,
          absorbance: ranged.absorbance,
          inputConcentration: row.concentrationNum,
          refConc,
        };
      }));

      const baseWavelength = loaded[0].wavelength;
      const normalized = loaded.map((item) => {
        const interpAbs = item.wavelength.length === baseWavelength.length
          ? item.absorbance
          : interpolateLinear(item.wavelength, item.absorbance, baseWavelength);
        const weight = Math.max(item.inputConcentration / Math.max(item.refConc, 1e-8), 0);
        return { ...item, absorbance: interpAbs, weight };
      });

      const totalWeight = normalized.reduce((sum, item) => sum + item.weight, 0);
      if (totalWeight <= 0) throw new Error('浓度权重计算失败，请检查标准品浓度设置');

      const synthesizedAbsorbance = baseWavelength.map((_, idx) => (
        normalized.reduce((sum, item) => sum + item.weight * item.absorbance[idx], 0)
      ));

      setSynthesisResult({
        wavelength: baseWavelength,
        absorbance: synthesizedAbsorbance,
        components: normalized.map((item) => ({
          name: item.name,
          inputConcentration: item.inputConcentration,
          weight: item.weight / totalWeight,
        })),
      });
      if (!parsedOnlineRecipe) {
        setAutoFilledSourceName(null);
      }
    } catch (e: any) {
      setError(e?.message || '光谱合成失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadCompareSeries = async () => {
      if (!selectedOnlineCurves.length || !synthesisResult) {
        setCompareSeries([]);
        return;
      }
      try {
        const details = await Promise.all(selectedOnlineCurves.map((name) => fetchHistoryItem(name)));
        const series = details.map((detail, idx) => {
          const onlineName = onlineItems.find((item) => item.filename === selectedOnlineCurves[idx])?.name
            || detail.meta?.name
            || selectedOnlineCurves[idx];
          const ranged = applyRange(detail.data.lambda || [], detail.data.A || [], rangeMinNm, rangeMaxNm);
          return {
            name: onlineName,
            wavelength: synthesisResult.wavelength,
            absorbance: interpolateLinear(ranged.wavelength, ranged.absorbance, synthesisResult.wavelength),
          };
        });
        setCompareSeries(series);
      } catch (e: any) {
        setError(e?.message || '在线曲线加载失败');
      }
    };
    loadCompareSeries();
  }, [selectedOnlineCurves, synthesisResult, rangeMinNm, rangeMaxNm, onlineItems]);

  const synthesisChartData = useMemo(() => {
    if (!synthesisResult) return [];
    return synthesisResult.wavelength.map((wl, idx) => {
      const row: Record<string, number> = { wavelength: wl, synthesis: synthesisResult.absorbance[idx] };
      compareSeries.forEach((series) => {
        row[series.name] = series.absorbance[idx];
      });
      return row;
    });
  }, [synthesisResult, compareSeries]);

  const similarityResults = useMemo<SimilarityRow[]>(() => {
    if (!synthesisResult || !compareSeries.length) return [];
    const synthesisAbsorbance = synthesisResult.absorbance;
    return compareSeries.map((series) => {
      const pairedLength = Math.min(synthesisAbsorbance.length, series.absorbance.length);
      if (!pairedLength) return { name: series.name, rmse: Number.POSITIVE_INFINITY, similarity: 0 };
      let squaredError = 0;
      for (let i = 0; i < pairedLength; i += 1) {
        const delta = synthesisAbsorbance[i] - series.absorbance[i];
        squaredError += delta * delta;
      }
      const rmse = Math.sqrt(squaredError / pairedLength);
      return {
        name: series.name,
        rmse,
        similarity: 1 / (1 + rmse),
      };
    }).sort((a, b) => b.similarity - a.similarity);
  }, [synthesisResult, compareSeries]);

  const toggleOnlineCurve = (filename: string) => {
    setSelectedOnlineCurves((prev) => (
      prev.includes(filename) ? prev.filter((item) => item !== filename) : [...prev, filename]
    ));
  };

  return (
    <div className="max-w-7xl mx-auto h-full grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[420px] text-slate-300">
      <aside className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4">
        <h2 className="text-lg font-semibold text-slate-100">光谱合成分析</h2>
        <p className="text-xs text-slate-500">从标准染料库选择染料并输入浓度（g/L），在输入窗口内执行光谱合成，并对比在线数据相似度。</p>

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-slate-400">输入窗口 (nm)</label>
          <input
            type="number"
            value={rangeMinNm}
            onChange={(e) => setRangeMinNm(Number(e.target.value || 0))}
            className="w-24 bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-sm text-slate-200"
          />
          <span className="text-slate-500">~</span>
          <input
            type="number"
            value={rangeMaxNm}
            onChange={(e) => setRangeMaxNm(Number(e.target.value || 0))}
            className="w-24 bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-sm text-slate-200"
          />
        </div>

        <div className="space-y-2 max-h-56 overflow-auto pr-1">
          {synthesisRows.map((row, idx) => (
            <div key={`synthesis-row-${idx}`} className="grid grid-cols-12 gap-2 items-center">
              <select
                value={row.filename}
                onChange={(e) => updateSynthesisRow(idx, 'filename', e.target.value)}
                className="col-span-7 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200"
              >
                <option value="">选择标准染料</option>
                {standardItems.map((item) => (
                  <option key={item.filename} value={item.filename}>
                    {item.name}
                  </option>
                ))}
              </select>
              <input
                value={row.concentration}
                onChange={(e) => updateSynthesisRow(idx, 'concentration', e.target.value)}
                placeholder="g/L"
                className="col-span-3 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200"
              />
              <button
                onClick={() => removeSynthesisRow(idx)}
                className="col-span-2 text-xs px-2 py-1 bg-slate-800 rounded border border-slate-700 hover:bg-slate-700"
              >
                删除
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <button onClick={addSynthesisRow} className="px-3 py-1.5 text-xs bg-slate-800 rounded border border-slate-700">+ 添加染料</button>
          <button onClick={runNllsSynthesis} disabled={loading} className="px-3 py-1.5 text-xs bg-indigo-600 rounded disabled:bg-slate-700">执行合成</button>
        </div>

        <div className="border-t border-slate-800 pt-3">
          <p className="text-sm text-slate-300 mb-2">在线数据库曲线对比</p>
          <div className="max-h-40 overflow-auto space-y-1">
            {onlineItems.map((item) => (
              <label key={`online-curve-${item.filename}`} className="flex items-center gap-2 text-sm text-slate-400">
                <input
                  type="checkbox"
                  checked={selectedOnlineCurves.includes(item.filename)}
                  onChange={() => toggleOnlineCurve(item.filename)}
                  disabled={!synthesisResult}
                  className="rounded bg-slate-800 border-slate-600 text-cyan-500"
                />
                <span className="truncate">{item.name}</span>
              </label>
            ))}
            {!onlineItems.length && <p className="text-xs text-slate-600">暂无在线数据库染料曲线</p>}
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            勾选在线曲线后，点击“执行合成”将自动带入对应在线记录中的染料配方与浓度。
          </p>
        </div>

        {autoFilledSourceName ? (
          <p className="text-xs text-cyan-300">
            已按在线曲线「{autoFilledSourceName}」自动填入染料及浓度。
          </p>
        ) : null}

        {similarityResults.length ? (
          <div className="border-t border-slate-800 pt-3 space-y-2">
            <p className="text-xs text-emerald-300">相似染料推荐（输入窗口内）</p>
            {similarityResults.slice(0, 5).map((item, idx) => (
              <div key={item.name} className="text-xs text-slate-400 flex justify-between gap-2">
                <span className="truncate">
                  {idx === 0 ? '⭐ ' : ''}{item.name}
                </span>
                <span>相似度 {(item.similarity * 100).toFixed(2)}%</span>
              </div>
            ))}
          </div>
        ) : null}

        {synthesisResult?.components?.length ? (
          <div className="border-t border-slate-800 pt-3 space-y-1">
            <p className="text-xs text-cyan-300">合成权重（归一化）</p>
            {synthesisResult.components.map((item) => (
              <div key={item.name} className="text-xs text-slate-400 flex justify-between gap-2">
                <span className="truncate">{item.name}</span>
                <span>{(item.weight * 100).toFixed(2)}%</span>
              </div>
            ))}
          </div>
        ) : null}

        {error && <p className="text-sm text-red-400">{error}</p>}
      </aside>

      <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-lg p-4 h-[420px]">
        <h3 className="text-sm font-semibold text-slate-300 mb-2">合成光谱 vs 在线数据库曲线</h3>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={synthesisChartData} margin={{ top: 20, right: 20, bottom: 30, left: 10 }}>
            <CartesianGrid stroke="#334155" />
            <XAxis dataKey="wavelength" stroke="#94a3b8" name="wavelength" tickFormatter={(v) => Number(v).toFixed(0)} />
            <YAxis stroke="#94a3b8" tickFormatter={formatTick} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="synthesis" stroke="#f43f5e" strokeWidth={2} dot={false} name="合成光谱" />
            {compareSeries.map((series, index) => (
              <Line
                key={`compare-${series.name}`}
                type="monotone"
                dataKey={series.name}
                stroke={['#22d3ee', '#84cc16', '#f59e0b', '#a78bfa'][index % 4]}
                dot={false}
                name={series.name}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
