import React, { useState, useEffect, useMemo } from 'react';
import { HistoryItem, ConcentrationResult, FabricParams, ColorResult } from '../types';
import { fetchHistoryList, fetchHistoryItem } from '../services/api';
import { reflectanceToColor, RtoKS, KStoR } from '../utils/color';
import { SwatchIcon, AdjustmentsHorizontalIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

export const PredictionPanel: React.FC = () => {
    const [historyList, setHistoryList] = useState<HistoryItem[]>([]);
    const [selectedHistory, setSelectedHistory] = useState<string>('');
    const [baseData, setBaseData] = useState<ConcentrationResult | null>(null);
    const [loading, setLoading] = useState(false);

    // Fabric & Process Parameters
    const [params, setParams] = useState<FabricParams>({
        fabricType: 'Cotton',
        weight: 100, // g
        liquorRatio: 10, // 1:10
        exhaustionRate: 70, // %
    });

    useEffect(() => {
        loadHistory();
    }, []);

    const loadHistory = async () => {
        try {
            const list = await fetchHistoryList();
            setHistoryList(list.filter(item => item.meta?.save_type === 'multicomponent'));
        } catch (e) {
            console.error(e);
        }
    };

    const handleSelectHistory = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const filename = e.target.value;
        setSelectedHistory(filename);
        if(!filename) {
            setBaseData(null);
            return;
        }

        setLoading(true);
        try {
            const data = await fetchHistoryItem(filename);
            const simulatedResult: ConcentrationResult = {
                components: [],
                metrics: { rmse: 0, residual_norm: 0 },
                chart_data: {
                    lambda: data.data.lambda,
                    original: data.data.T,
                    fitted: data.data.T,
                    residual: []
                }
            };
            setBaseData(simulatedResult);

        } catch (e) {
            console.error("Failed to load item", e);
        } finally {
            setLoading(false);
        }
    };

    // --- Real-time Calculation ---
    const prediction = useMemo(() => {
        if (!baseData) return null;

        const { lambda, fitted } = baseData.chart_data;
        const baselineExhaustion = 70;
        const baselineRatio = 10;
        const ratio = params.liquorRatio || 1;
        const depthFactor = (params.exhaustionRate / baselineExhaustion) * (baselineRatio / ratio);

        const newR: number[] = [];
        const ksCurve: number[] = [];

        for (let i = 0; i < lambda.length; i++) {
            let R = fitted[i];
            if(R <= 0.001) R = 0.001;
            if(R >= 0.999) R = 0.999;

            const ks = RtoKS(R);
            const newKs = ks * depthFactor;
            
            ksCurve.push(newKs);
            newR.push(KStoR(newKs));
        }

        const color = reflectanceToColor(lambda, newR);

        return {
            rCurve: newR,
            ksCurve,
            color,
            depthFactor
        };

    }, [baseData, params]);

    // Chart data prep
    const chartData = useMemo(() => {
        if (!baseData || !prediction) return [];
        return baseData.chart_data.lambda.map((l, i) => ({
            lambda: l,
            original: baseData.chart_data.fitted[i],
            predicted: prediction.rCurve[i],
            ks: prediction.ksCurve[i]
        }));
    }, [baseData, prediction]);

    return (
        <div className="max-w-7xl mx-auto h-full flex flex-col gap-6 text-slate-300">
            <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-indigo-900/30 border border-indigo-500/30 rounded-lg text-indigo-400">
                    <SwatchIcon className="w-6 h-6" />
                </div>
                <div>
                    <h2 className="text-xl font-bold text-slate-100">实时上染颜色预测</h2>
                    <p className="text-sm text-slate-500">基于 Kubelka-Munk 理论与工艺参数预测最终上染颜色</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-full">
                {/* Controls */}
                <div className="lg:col-span-4 flex flex-col gap-6">
                    
                    {/* 1. Source Selection */}
                    <div className="bg-slate-900 p-5 rounded-lg shadow-sm border border-slate-800">
                        <h3 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
                            <ArrowPathIcon className="w-5 h-5 text-indigo-500" />
                            1. 选择基础配方 (历史光谱)
                        </h3>
                        <select 
                            className="w-full bg-slate-800 border-slate-700 rounded-md text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 mb-2 text-slate-200"
                            value={selectedHistory}
                            onChange={handleSelectHistory}
                        >
                            <option value="">-- 选择多组分记录 --</option>
                            {historyList.map(h => (
                                <option key={h.filename} value={h.filename}>
                                    {h.name || h.filename}
                                </option>
                            ))}
                        </select>
                        <p className="text-xs text-slate-500">
                            选择一个已解析或保存的多组分光谱作为预测基准。
                        </p>
                    </div>

                    {/* 2. Process Parameters */}
                    <div className="bg-slate-900 p-5 rounded-lg shadow-sm border border-slate-800 flex-1">
                        <h3 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
                            <AdjustmentsHorizontalIcon className="w-5 h-5 text-indigo-500" />
                            2. 调整工艺参数
                        </h3>
                        
                        <div className="space-y-6">
                            <div>
                                <label className="flex justify-between text-sm font-medium text-slate-400 mb-1">
                                    <span>上染率 / Exhaustion</span>
                                    <span className="text-indigo-400 font-mono">{params.exhaustionRate}%</span>
                                </label>
                                <input 
                                    type="range" 
                                    min="10" 
                                    max="100" 
                                    step="1"
                                    value={params.exhaustionRate}
                                    onChange={(e) => setParams({...params, exhaustionRate: Number(e.target.value)})}
                                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                />
                                <div className="flex justify-between text-xs text-slate-600 mt-1">
                                    <span>Low (10%)</span>
                                    <span>High (100%)</span>
                                </div>
                            </div>

                            <div>
                                <label className="flex justify-between text-sm font-medium text-slate-400 mb-1">
                                    <span>浴比 / Liquor Ratio</span>
                                    <span className="text-indigo-400 font-mono">1:{params.liquorRatio}</span>
                                </label>
                                <input 
                                    type="range" 
                                    min="3" 
                                    max="50" 
                                    step="1"
                                    value={params.liquorRatio}
                                    onChange={(e) => setParams({...params, liquorRatio: Number(e.target.value)})}
                                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                />
                                <div className="flex justify-between text-xs text-slate-600 mt-1">
                                    <span>Concentrated (1:3)</span>
                                    <span>Diluted (1:50)</span>
                                </div>
                            </div>

                             <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">布料类型</label>
                                <select 
                                    className="w-full bg-slate-800 border-slate-700 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500 text-slate-200"
                                    value={params.fabricType}
                                    onChange={(e) => setParams({...params, fabricType: e.target.value})}
                                >
                                    <option value="Cotton">Cotton (棉)</option>
                                    <option value="Polyester">Polyester (涤纶)</option>
                                    <option value="Wool">Wool (羊毛)</option>
                                    <option value="Nylon">Nylon (尼龙)</option>
                                </select>
                             </div>

                             <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">克重 (g)</label>
                                <input 
                                    type="number"
                                    value={params.weight}
                                    onChange={(e) => setParams({...params, weight: Number(e.target.value)})}
                                    className="w-full bg-slate-800 border-slate-700 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500 text-slate-200"
                                />
                             </div>
                        </div>

                        {prediction && (
                            <div className="mt-6 p-3 bg-indigo-900/20 rounded-md text-sm text-indigo-300 border border-indigo-500/20 font-mono">
                                <strong>K/S Adjust Factor:</strong> {prediction.depthFactor.toFixed(3)}x
                            </div>
                        )}
                    </div>
                </div>

                {/* Visualization */}
                <div className="lg:col-span-8 flex flex-col gap-6">
                    {prediction ? (
                        <>
                            {/* Color Preview */}
                            <div className="bg-slate-900 rounded-lg shadow-sm border border-slate-800 p-6 flex flex-col md:flex-row gap-8 items-center justify-center">
                                <div className="flex flex-col items-center gap-2">
                                    <div 
                                        className="w-32 h-32 rounded-full shadow-lg border-4 border-slate-800 ring-1 ring-slate-600 transition-all duration-300"
                                        style={{ backgroundColor: prediction.color.rgb }}
                                    ></div>
                                    <span className="font-mono font-bold text-slate-200 text-lg tracking-wider">{prediction.color.rgb}</span>
                                    <span className="text-xs text-slate-500">Predicted RGB</span>
                                </div>

                                <div className="grid grid-cols-2 gap-4 text-sm w-full max-w-sm">
                                    <div className="p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                                        <div className="text-slate-500 text-xs uppercase tracking-wider mb-1">CIE Lab</div>
                                        <div className="font-mono text-slate-300">
                                            L: {prediction.color.lab.l.toFixed(2)}<br/>
                                            a: {prediction.color.lab.a.toFixed(2)}<br/>
                                            b: {prediction.color.lab.b.toFixed(2)}
                                        </div>
                                    </div>
                                    <div className="p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                                        <div className="text-slate-500 text-xs uppercase tracking-wider mb-1">CIE XYZ</div>
                                        <div className="font-mono text-slate-300">
                                            X: {prediction.color.xyz.x.toFixed(2)}<br/>
                                            Y: {prediction.color.xyz.y.toFixed(2)}<br/>
                                            Z: {prediction.color.xyz.z.toFixed(2)}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Chart */}
                            <div className="bg-slate-900 rounded-lg shadow-sm border border-slate-800 p-6 h-[400px]">
                                <h4 className="text-sm font-bold text-slate-300 mb-4">反射率预测曲线 (R)</h4>
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="colorPred" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor={prediction.color.rgb} stopOpacity={0.8}/>
                                                <stop offset="95%" stopColor={prediction.color.rgb} stopOpacity={0}/>
                                            </linearGradient>
                                        </defs>
                                        <XAxis dataKey="lambda" tick={{fontSize: 11, fill: '#94a3b8'}} stroke="#475569" />
                                        <YAxis tick={{fontSize: 11, fill: '#94a3b8'}} domain={[0, 1]} label={{ value: 'Reflectance', angle: -90, position: 'insideLeft', fill: '#64748b' }} stroke="#475569"/>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                        <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderRadius: '6px', border: '1px solid #334155', color: '#f1f5f9' }} />
                                        <Area 
                                            type="monotone" 
                                            dataKey="predicted" 
                                            stroke={prediction.color.rgb} 
                                            fillOpacity={1} 
                                            fill="url(#colorPred)" 
                                            name="Predicted R"
                                            strokeWidth={3}
                                        />
                                        <Area 
                                            type="monotone" 
                                            dataKey="original" 
                                            stroke="#64748b" 
                                            fill="none" 
                                            strokeDasharray="5 5"
                                            name="Original R (Ref)"
                                            strokeWidth={2}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-500 border-2 border-dashed border-slate-800 rounded-lg bg-slate-900/50 min-h-[500px]">
                            <SwatchIcon className="w-16 h-16 mb-4 opacity-20" />
                            <p>请在左侧选择基础配方以开始预测</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
