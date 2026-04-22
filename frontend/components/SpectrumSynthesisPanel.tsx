import React, { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { fetchHistoryItem, fetchHistoryList } from '../services/api';
import { HistoryItem, ProcessedData } from '../types';

type SynthesisRow = { filename: string; concentration: string };
type SimilarityRow = { name: string; rmse: number; similarity: number };
type ParsedOnlineRecipe = { rows: SynthesisRow[]; sourceName: string };
type OnlineCurveOption = { id: string; filename: string; name: string; item: HistoryItem };
type CompareSeries = { name: string; wavelength: number[]; absorbance: number[]; recipeTooltip: string };
type SynthesisTab = 'manual' | 'online-db';
type OnlineDbComparison = {
  curveName: string;
  synthesis: { wavelength: number[]; absorbance: number[] };
  online: { wavelength: number[]; absorbance: number[] };
  recipeTooltip: string;
};

type ResolvedSynthesisRow = SynthesisRow & { concentrationNum: number };

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

const decodeEscapedControlChars = (value: string): string => (
  value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .trim()
);

const parseOnlineRecipeRows = (
  item: HistoryItem,
  standardItems: HistoryItem[]
): ResolvedSynthesisRow[] => {
  const standardTokens = (item.meta?.online_standard || '')
    .split('+')
    .map((token) => decodeEscapedControlChars(token))
    .filter(Boolean);
  const concentrationTokens = (item.meta?.online_concentration || '')
    .split('+')
    .map((token) => decodeEscapedControlChars(token));
  if (!standardTokens.length) return [];

  const standardLookup = new Map<string, string>();
  standardItems.forEach((standard) => {
    if (standard.filename) standardLookup.set(standard.filename, standard.filename);
    const standardName = (standard.name || '').trim();
    if (standardName) standardLookup.set(standardName, standard.filename);
  });

  const hasConcentrationTokens = concentrationTokens.some(Boolean);
  if (!hasConcentrationTokens && standardTokens.length === 1 && standardTokens[0].includes('\n')) {
    return standardTokens[0]
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.includes('染料名称') && !line.includes('浓度'))
      .map((line) => {
        const [namePart = '', concPart = ''] = line.split('\t').map((part) => part.trim());
        const concentrationNum = parseFirstNumber(concPart || line);
        const filename = standardLookup.get(namePart) || namePart;
        return {
          filename,
          concentration: concentrationNum === null ? concPart : String(concentrationNum),
          concentrationNum,
        };
      })
      .filter((row): row is ResolvedSynthesisRow => (
        Boolean(row.filename)
        && row.concentrationNum !== null
        && row.concentrationNum > 0
      ));
  }

  return standardTokens
    .map((standardRef, idx) => {
      const concentrationRaw = concentrationTokens[idx] || '';
      const concentrationNum = parseFirstNumber(concentrationRaw);
      return {
        filename: standardLookup.get(standardRef) || standardRef,
        concentration: concentrationNum === null ? concentrationRaw : String(concentrationNum),
        concentrationNum,
      };
    })
    .filter((row): row is ResolvedSynthesisRow => (
      Boolean(row.filename)
      && row.concentrationNum !== null
      && row.concentrationNum > 0
    ));
};

const buildRecipeTooltipText = (item: ProcessedData): string => {
  const standardTokens = (item.meta?.online_standard || '')
    .split('+')
    .map((token) => decodeEscapedControlChars(token))
    .filter(Boolean);
  const concentrationTokens = (item.meta?.online_concentration || '')
    .split('+')
    .map((token) => decodeEscapedControlChars(token));
  if (!standardTokens.length) return '无染料/浓度信息';
  return standardTokens
    .map((dyeName, idx) => `${dyeName}: ${concentrationTokens[idx] || '-'}`)
    .join('；');
};

const buildOnlineCurveHoverText = (item: HistoryItem): string => {
  const standardTokens = (item.meta?.online_standard || '')
    .split('+')
    .map((token) => decodeEscapedControlChars(token))
    .filter(Boolean);
  const concentrationTokens = (item.meta?.online_concentration || '')
    .split('+')
    .map((token) => decodeEscapedControlChars(token));
  if (!standardTokens.length) return '无染料/浓度信息';
  if (!concentrationTokens.some(Boolean) && standardTokens.length === 1 && standardTokens[0].includes('\n')) {
    return standardTokens[0];
  }
  return standardTokens
    .map((dyeName, idx) => `${dyeName}\t${concentrationTokens[idx] || '-'}`)
    .join('\n');
};

const formatTick = (value: number | string): string => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num.toFixed(2) : `${value}`;
};

export const SpectrumSynthesisPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SynthesisTab>('manual');
  const [standardItems, setStandardItems] = useState<HistoryItem[]>([]);
  const [onlineItems, setOnlineItems] = useState<HistoryItem[]>([]);
  const [synthesisRows, setSynthesisRows] = useState<SynthesisRow[]>([{ filename: '', concentration: '' }]);
  const [selectedOnlineCurveIds, setSelectedOnlineCurveIds] = useState<string[]>([]);
  const [rangeMinNm, setRangeMinNm] = useState<number>(400);
  const [rangeMaxNm, setRangeMaxNm] = useState<number>(700);
  const [synthesisResult, setSynthesisResult] = useState<{
    wavelength: number[];
    absorbance: number[];
    components: Array<{ name: string; inputConcentration: number; weight: number }>;
  } | null>(null);
  const [compareSeries, setCompareSeries] = useState<CompareSeries[]>([]);
  const [onlineDbComparisons, setOnlineDbComparisons] = useState<OnlineDbComparison[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoFilledSourceName, setAutoFilledSourceName] = useState<string | null>(null);

  const onlineCurveOptions = useMemo<OnlineCurveOption[]>(() => (
    onlineItems
      .filter((item) => Boolean(item.filename))
      .map((item, index) => ({
        id: `${item.filename}__${index}`,
        filename: item.filename,
        name: item.name || item.filename,
        item,
      }))
  ), [onlineItems]);

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

  const synthesizeByRows = async (rows: SynthesisRow[]) => {
    const validRows = rows
      .map((row) => ({ ...row, concentrationNum: parseFirstNumber(row.concentration) }))
      .filter((row): row is ResolvedSynthesisRow => row.filename && row.concentrationNum !== null && row.concentrationNum > 0);
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
    return {
      wavelength: baseWavelength,
      absorbance: synthesizedAbsorbance,
      components: normalized.map((item) => ({
        name: item.name,
        inputConcentration: item.inputConcentration,
        weight: item.weight / totalWeight,
      })),
    };
  };

  const runNllsSynthesis = async () => {
    setLoading(true);
    setError(null);
    try {
      let rowsForSynthesis = synthesisRows;
      let parsedOnlineRecipe: ParsedOnlineRecipe | null = null;
      if (selectedOnlineCurveIds.length) {
        const selectedCurveOption = selectedOnlineCurveIds
          .map((id) => onlineCurveOptions.find((item) => item.id === id))
          .find((item): item is OnlineCurveOption => Boolean(item));
        const selectedCurve = selectedCurveOption?.item;
        if (selectedCurve) {
          const recipeRows = parseOnlineRecipeRows(selectedCurve, standardItems);
          if (recipeRows.length) {
            rowsForSynthesis = recipeRows;
            parsedOnlineRecipe = {
              rows: recipeRows.map(({ filename, concentration }) => ({ filename, concentration })),
              sourceName: selectedCurve.name || selectedCurve.filename,
            };
            setSynthesisRows(recipeRows.map(({ filename, concentration }) => ({ filename, concentration })));
            setAutoFilledSourceName(selectedCurve.name || selectedCurve.filename);
          }
        }
      }

      const synthesized = await synthesizeByRows(rowsForSynthesis);
      setSynthesisResult(synthesized);
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
      if (activeTab !== 'manual' || !selectedOnlineCurveIds.length || !synthesisResult) {
        setCompareSeries([]);
        return;
      }
      try {
        const selectedCurveOptions = selectedOnlineCurveIds
          .map((id) => onlineCurveOptions.find((item) => item.id === id))
          .filter((item): item is OnlineCurveOption => Boolean(item));
        const details = await Promise.all(selectedCurveOptions.map((item) => fetchHistoryItem(item.filename)));
        const series = details.map((detail, idx) => {
          const onlineName = selectedCurveOptions[idx]?.name
            || detail.meta?.name
            || selectedCurveOptions[idx]?.filename
            || `在线曲线${idx + 1}`;
          const ranged = applyRange(detail.data.lambda || [], detail.data.A || [], rangeMinNm, rangeMaxNm);
          return {
            name: onlineName,
            wavelength: synthesisResult.wavelength,
            absorbance: interpolateLinear(ranged.wavelength, ranged.absorbance, synthesisResult.wavelength),
            recipeTooltip: buildRecipeTooltipText(detail),
          };
        });
        setCompareSeries(series);
      } catch (e: any) {
        setError(e?.message || '在线曲线加载失败');
      }
    };
    loadCompareSeries();
  }, [activeTab, selectedOnlineCurveIds, synthesisResult, rangeMinNm, rangeMaxNm, onlineCurveOptions]);

  useEffect(() => {
    const runOnlineDbSynthesis = async () => {
      if (activeTab !== 'online-db' || !selectedOnlineCurveIds.length) {
        setOnlineDbComparisons([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const selectedCurveOptions = selectedOnlineCurveIds
          .map((id) => onlineCurveOptions.find((item) => item.id === id))
          .filter((item): item is OnlineCurveOption => Boolean(item));
        const comparisons = await Promise.all(selectedCurveOptions.map(async (option) => {
          const recipeRows = parseOnlineRecipeRows(option.item, standardItems);
          if (!recipeRows.length) {
            throw new Error(`在线曲线「${option.name}」缺少可解析的染料/浓度信息`);
          }
          const synthesized = await synthesizeByRows(recipeRows.map(({ filename, concentration }) => ({ filename, concentration })));
          const onlineDetail = await fetchHistoryItem(option.filename);
          const ranged = applyRange(onlineDetail.data.lambda || [], onlineDetail.data.A || [], rangeMinNm, rangeMaxNm);
          return {
            curveName: option.name,
            synthesis: {
              wavelength: synthesized.wavelength,
              absorbance: synthesized.absorbance,
            },
            online: {
              wavelength: synthesized.wavelength,
              absorbance: interpolateLinear(ranged.wavelength, ranged.absorbance, synthesized.wavelength),
            },
            recipeTooltip: buildRecipeTooltipText(onlineDetail),
          };
        }));
        setOnlineDbComparisons(comparisons);
      } catch (e: any) {
        setError(e?.message || '在线数据库曲线分析失败');
      } finally {
        setLoading(false);
      }
    };
    runOnlineDbSynthesis();
  }, [activeTab, selectedOnlineCurveIds, onlineCurveOptions, standardItems, rangeMinNm, rangeMaxNm]);

  const synthesisChartData = useMemo(() => {
    if (activeTab === 'online-db') {
      if (!onlineDbComparisons.length) return [];
      return onlineDbComparisons[0].synthesis.wavelength.map((wl, idx) => {
        const row: Record<string, number> = { wavelength: wl };
        onlineDbComparisons.forEach((item) => {
          row[`合成-${item.curveName}`] = item.synthesis.absorbance[idx];
          row[`在线-${item.curveName}`] = item.online.absorbance[idx];
        });
        return row;
      });
    }
    if (!synthesisResult) return [];
    return synthesisResult.wavelength.map((wl, idx) => {
      const row: Record<string, number> = { wavelength: wl, synthesis: synthesisResult.absorbance[idx] };
      compareSeries.forEach((series) => {
        row[series.name] = series.absorbance[idx];
      });
      return row;
    });
  }, [activeTab, synthesisResult, compareSeries, onlineDbComparisons]);

  const similarityResults = useMemo<SimilarityRow[]>(() => {
    if (activeTab === 'online-db') {
      return onlineDbComparisons.map((item) => {
        const pairedLength = Math.min(item.synthesis.absorbance.length, item.online.absorbance.length);
        if (!pairedLength) return { name: item.curveName, rmse: Number.POSITIVE_INFINITY, similarity: 0 };
        let squaredError = 0;
        for (let i = 0; i < pairedLength; i += 1) {
          const delta = item.synthesis.absorbance[i] - item.online.absorbance[i];
          squaredError += delta * delta;
        }
        const rmse = Math.sqrt(squaredError / pairedLength);
        return { name: item.curveName, rmse, similarity: 1 / (1 + rmse) };
      }).sort((a, b) => b.similarity - a.similarity);
    }
    if (!synthesisResult || !compareSeries.length) return [];
    return compareSeries.map((series) => {
      const pairedLength = Math.min(synthesisResult.absorbance.length, series.absorbance.length);
      if (!pairedLength) return { name: series.name, rmse: Number.POSITIVE_INFINITY, similarity: 0 };
      let squaredError = 0;
      for (let i = 0; i < pairedLength; i += 1) {
        const delta = synthesisResult.absorbance[i] - series.absorbance[i];
        squaredError += delta * delta;
      }
      const rmse = Math.sqrt(squaredError / pairedLength);
      return {
        name: series.name,
        rmse,
        similarity: 1 / (1 + rmse),
      };
    }).sort((a, b) => b.similarity - a.similarity);
  }, [activeTab, synthesisResult, compareSeries, onlineDbComparisons]);

  const toggleOnlineCurve = (id: string) => {
    setSelectedOnlineCurveIds((prev) => (
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    ));
  };

  const legendRecipeMap = useMemo(() => {
    const next = new Map<string, string>();
    if (activeTab === 'online-db') {
      onlineDbComparisons.forEach((item) => {
        next.set(`合成-${item.curveName}`, `合成：${item.curveName}\n${item.recipeTooltip}`);
        next.set(`在线-${item.curveName}`, `在线：${item.curveName}\n${item.recipeTooltip}`);
      });
    } else {
      compareSeries.forEach((series) => {
        next.set(series.name, `曲线：${series.name}\n${series.recipeTooltip}`);
      });
    }
    return next;
  }, [activeTab, compareSeries, onlineDbComparisons]);

  const selectedOnlineCurveRecipeText = useMemo(() => {
    if (!selectedOnlineCurveIds.length) return '';
    const selectedCurveOptions = selectedOnlineCurveIds
      .map((id) => onlineCurveOptions.find((item) => item.id === id))
      .filter((item): item is OnlineCurveOption => Boolean(item));
    const standardNameLookup = new Map<string, string>();
    standardItems.forEach((item) => {
      if (!item.filename) return;
      standardNameLookup.set(item.filename, item.name || item.filename);
    });
    return selectedCurveOptions
      .flatMap((option) => parseOnlineRecipeRows(option.item, standardItems)
        .map((row) => {
          const dyeName = standardNameLookup.get(row.filename) || row.filename;
          return `${dyeName}\t${row.concentration}`;
        }))
      .join('\n');
  }, [selectedOnlineCurveIds, onlineCurveOptions, standardItems]);

  return (
    <div className="max-w-7xl mx-auto h-full grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[420px] text-slate-300">
      <aside className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4">
        <h2 className="text-lg font-semibold text-slate-100">光谱合成分析</h2>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setActiveTab('manual')}
            className={`text-xs rounded-md px-2 py-1.5 border ${
              activeTab === 'manual'
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-slate-800 border-slate-700 text-slate-300'
            }`}
          >
            手动配方合成
          </button>
          <button
            onClick={() => setActiveTab('online-db')}
            className={`text-xs rounded-md px-2 py-1.5 border ${
              activeTab === 'online-db'
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-slate-800 border-slate-700 text-slate-300'
            }`}
          >
            在线数据库曲线分析
          </button>
        </div>
        <p className="text-xs text-slate-500">
          {activeTab === 'manual'
            ? '从标准染料库选择染料并输入浓度（g/L），在输入窗口内执行光谱合成，并对比在线数据相似度。'
            : '勾选在线数据库曲线后，系统按其染料与浓度自动合成对应光谱，并与在线曲线进行对比。'}
        </p>

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

        {activeTab === 'manual' ? (
          <>
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
          </>
        ) : null}

        <div className="border-t border-slate-800 pt-3">
          <p className="text-sm text-slate-300 mb-2">在线数据库曲线对比</p>
          <div className="max-h-40 overflow-auto space-y-1">
            {onlineCurveOptions.map((item) => (
              <label
                key={`online-curve-${item.id}`}
                className="flex items-center gap-2 text-sm text-slate-400"
                title={buildOnlineCurveHoverText(item.item)}
              >
                <input
                  type="checkbox"
                  checked={selectedOnlineCurveIds.includes(item.id)}
                  onChange={() => toggleOnlineCurve(item.id)}
                  className="rounded bg-slate-800 border-slate-600 text-cyan-500"
                />
                <span className="truncate">{item.name}</span>
              </label>
            ))}
            {!onlineCurveOptions.length && <p className="text-xs text-slate-600">暂无在线数据库染料曲线</p>}
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            {activeTab === 'manual'
              ? '勾选在线曲线后，点击“执行合成”将自动带入对应在线记录中的染料配方与浓度。'
              : '勾选在线曲线后会自动按该曲线对应配方合成并在右侧比较。'}
          </p>
          <div className="mt-2">
            <label className="text-[11px] text-slate-500 block mb-1">已勾选曲线的染料及浓度</label>
            <textarea
              value={selectedOnlineCurveRecipeText}
              readOnly
              rows={5}
              placeholder="勾选在线曲线后，这里将显示对应染料与浓度。"
              className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 resize-y min-h-[90px]"
            />
          </div>
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
        <h3 className="text-sm font-semibold text-slate-300 mb-2">
          {activeTab === 'manual' ? '合成光谱 vs 在线数据库曲线' : '在线数据库：自动配方合成 vs 原始在线曲线'}
        </h3>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={synthesisChartData} margin={{ top: 20, right: 20, bottom: 30, left: 10 }}>
            <CartesianGrid stroke="#334155" />
            <XAxis dataKey="wavelength" stroke="#94a3b8" name="wavelength" tickFormatter={(v) => Number(v).toFixed(0)} />
            <YAxis stroke="#94a3b8" tickFormatter={formatTick} />
            <Tooltip />
            <Legend
              formatter={(value: string) => (
                <span title={legendRecipeMap.get(value) || `曲线：${value}`}>
                  {value}
                </span>
              )}
            />
            {activeTab === 'manual' ? (
              <>
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
              </>
            ) : (
              <>
                {onlineDbComparisons.flatMap((item, index) => ([
                  <Line
                    key={`synth-${item.curveName}`}
                    type="monotone"
                    dataKey={`合成-${item.curveName}`}
                    stroke={['#f43f5e', '#ef4444', '#ec4899', '#fb7185'][index % 4]}
                    dot={false}
                    name={`合成-${item.curveName}`}
                  />,
                  <Line
                    key={`online-${item.curveName}`}
                    type="monotone"
                    dataKey={`在线-${item.curveName}`}
                    stroke={['#22d3ee', '#84cc16', '#f59e0b', '#a78bfa'][index % 4]}
                    dot={false}
                    name={`在线-${item.curveName}`}
                  />,
                ]))}
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
