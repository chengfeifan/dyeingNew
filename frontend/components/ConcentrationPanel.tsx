import React, { useState, useEffect, useMemo } from 'react';
import { HistoryItem, ConcentrationResult } from '../types';
import { fetchHistoryList, analyzeConcentration, updateHistoryItem, deleteHistoryItem } from '../services/api';
import { BeakerIcon, PlayIcon, BookOpenIcon, TrashIcon, CheckIcon, XMarkIcon, PencilSquareIcon, ArrowDownTrayIcon, DocumentTextIcon, TableCellsIcon } from '@heroicons/react/24/outline';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

type Tab = 'analysis' | 'library';

export const ConcentrationPanel: React.FC = () => {
    const [activeTab, setActiveTab] = useState<Tab>('analysis');
    const [history, setHistory] = useState<HistoryItem[]>([]);
    
    // Analysis State
    const [selectedSample, setSelectedSample] = useState<string>('');
    const [selectedStandards, setSelectedStandards] = useState<string[]>([]);
    const [result, setResult] = useState<ConcentrationResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Library State
    const [editingItem, setEditingItem] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<{name: string, concentration: string, type: string}>({
        name: '', concentration: '', type: 'standard'
    });

    useEffect(() => {
        loadHistory();
    }, [activeTab]); // Reload when tab changes

    const loadHistory = async () => {
        try {
            const list = await fetchHistoryList();
            setHistory(list);
        } catch (e) {
            console.error("Failed to load history");
        }
    };

    const standards = useMemo(() => history.filter(h => h.meta?.save_type === 'standard'), [history]);
    const samples = useMemo(() => history, [history]);

    // --- Analysis Actions ---

    const toggleStandard = (filename: string) => {
        setSelectedStandards(prev => 
            prev.includes(filename) 
                ? prev.filter(f => f !== filename) 
                : [...prev, filename]
        );
    };

    const handleAnalyze = async () => {
        if (!selectedSample || selectedStandards.length === 0) return;
        setLoading(true);
        setError(null);
        setResult(null);
        try {
            const res = await analyzeConcentration(selectedSample, selectedStandards);
            setResult(res);
        } catch (err: any) {
            setError(err?.message || "分析失败");
        } finally {
            setLoading(false);
        }
    };

    const chartData = useMemo(() => {
        if (!result) return [];
        return result.chart_data.lambda.map((l, i) => ({
            lambda: l,
            original: result.chart_data.original[i],
            fitted: result.chart_data.fitted[i],
            residual: result.chart_data.residual[i]
        }));
    }, [result]);

    const handleExportJSON = () => {
        if (!result) return;
        const jsonString = JSON.stringify(result, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `concentration_analysis_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleExportCSV = () => {
        if (!result) return;
        
        // 1. Metrics Section
        let csvContent = "--- Metrics ---\n";
        csvContent += `RMSE,${result.metrics.rmse}\n`;
        csvContent += `Residual Norm,${result.metrics.residual_norm}\n\n`;
        
        // 2. Components Section
        csvContent += "--- Components ---\n";
        csvContent += "Name,Concentration,Contribution(%)\n";
        result.components.forEach(c => {
            csvContent += `${c.name},${c.concentration},${c.contribution}\n`;
        });
        csvContent += "\n";

        // 3. Spectral Data Section
        csvContent += "--- Spectral Data ---\n";
        csvContent += "Wavelength,Original,Fitted,Residual\n";
        const { lambda, original, fitted, residual } = result.chart_data;
        for(let i=0; i < lambda.length; i++) {
            csvContent += `${lambda[i]},${original[i]},${fitted[i]},${residual[i]}\n`;
        }

        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `concentration_analysis_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // --- Library Actions ---

    const startEdit = (item: HistoryItem) => {
        setEditingItem(item.filename);
        setEditForm({
            name: item.name || item.filename,
            concentration: item.meta?.concentration || '',
            type: item.meta?.save_type || 'multicomponent'
        });
    };

    const cancelEdit = () => {
        setEditingItem(null);
    };

    const saveEdit = async (filename: string) => {
        try {
            await updateHistoryItem(filename, {
                name: editForm.name,
                concentration: editForm.concentration,
                save_type: editForm.type
            });
            setEditingItem(null);
            loadHistory();
        } catch (e) {
            alert("更新失败");
        }
    };

    const handleDelete = async (filename: string) => {
        if (confirm("确定要删除这条记录吗？此操作无法撤销。")) {
            try {
                await deleteHistoryItem(filename);
                loadHistory();
                // Clear selection if deleted
                if (selectedSample === filename) setSelectedSample('');
                if (selectedStandards.includes(filename)) toggleStandard(filename);
            } catch (e) {
                alert("删除失败");
            }
        }
    };

    return (
        <div className="max-w-7xl mx-auto flex flex-col h-full gap-4 text-slate-300">
            
            {/* Top Navigation Tab */}
            <div className="flex space-x-1 bg-slate-900 p-1 rounded-md border border-slate-800 w-fit shadow-md">
                <button
                    onClick={() => setActiveTab('analysis')}
                    className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${
                        activeTab === 'analysis' 
                        ? 'bg-slate-800 text-indigo-400 shadow-sm border border-slate-700' 
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                >
                    <BeakerIcon className="w-4 h-4" />
                    浓度解析
                </button>
                <button
                    onClick={() => setActiveTab('library')}
                    className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-colors ${
                        activeTab === 'library' 
                        ? 'bg-slate-800 text-indigo-400 shadow-sm border border-slate-700' 
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                >
                    <BookOpenIcon className="w-4 h-4" />
                    标准库管理
                </button>
            </div>

            {/* Content Area */}
            {activeTab === 'analysis' ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-full">
                    {/* Left Control Panel */}
                    <div className="lg:col-span-4 flex flex-col gap-6">
                        {/* 1. Select Sample */}
                        <div className="bg-slate-900 p-5 rounded-lg shadow-sm border border-slate-800">
                            <h3 className="font-semibold text-slate-200 mb-3 flex items-center gap-2">
                                <span className="bg-indigo-900/50 text-indigo-400 w-6 h-6 rounded-full flex items-center justify-center text-xs border border-indigo-500/30">1</span>
                                选择待测样品
                            </h3>
                            <select 
                                className="w-full bg-slate-800 border-slate-700 rounded-md text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-slate-200"
                                value={selectedSample}
                                onChange={(e) => setSelectedSample(e.target.value)}
                            >
                                <option value="">-- 请选择历史记录 --</option>
                                {samples.map(s => (
                                    <option key={s.filename} value={s.filename}>
                                        {s.name || s.filename} ({s.meta?.save_type === 'standard' ? '标样' : '未知'})
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* 2. Select Standards */}
                        <div className="bg-slate-900 p-5 rounded-lg shadow-sm border border-slate-800 flex-1 flex flex-col min-h-[300px]">
                            <h3 className="font-semibold text-slate-200 mb-3 flex items-center gap-2">
                                <span className="bg-indigo-900/50 text-indigo-400 w-6 h-6 rounded-full flex items-center justify-center text-xs border border-indigo-500/30">2</span>
                                选择标准品库 (基向量)
                            </h3>
                            
                            <div className="flex-1 overflow-y-auto border border-slate-700 rounded-md p-2 space-y-1 bg-slate-950/30 custom-scrollbar">
                                {standards.length === 0 && (
                                    <div className="text-center text-slate-600 py-4 text-sm">
                                        暂无标准品。<br/>请切换到“标准库管理”将光谱标记为标准品。
                                    </div>
                                )}
                                {standards.map(std => (
                                    <label key={std.filename} className="flex items-start gap-2 p-2 hover:bg-slate-800 rounded cursor-pointer border border-transparent hover:border-slate-700">
                                        <input 
                                            type="checkbox"
                                            checked={selectedStandards.includes(std.filename)}
                                            onChange={() => toggleStandard(std.filename)}
                                            className="mt-1 rounded bg-slate-900 border-slate-600 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900"
                                        />
                                        <div>
                                            <div className="text-sm font-medium text-slate-300">{std.name}</div>
                                            <div className="text-xs text-slate-500">Ref Conc: {std.meta?.concentration || 'N/A'}</div>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <button 
                            onClick={handleAnalyze}
                            disabled={!selectedSample || selectedStandards.length === 0 || loading}
                            className="w-full py-3 bg-indigo-600 text-white rounded-md font-semibold hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 transition-colors shadow-lg shadow-indigo-900/20 flex justify-center items-center gap-2 border border-transparent disabled:border-slate-700"
                        >
                            {loading ? (
                                <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></span>
                            ) : (
                                <PlayIcon className="w-5 h-5" />
                            )}
                            开始解析 (NNLS)
                        </button>
                    </div>

                    {/* Right Results Panel */}
                    <div className="lg:col-span-8 flex flex-col gap-6">
                        {error && (
                            <div className="bg-red-900/20 border-l-4 border-red-500 text-red-200 p-4 rounded shadow-sm">
                                {error}
                            </div>
                        )}

                        {result && (
                            <div className="bg-slate-900 rounded-lg shadow-sm border border-slate-800 p-6">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2">
                                        <BeakerIcon className="w-5 h-5 text-indigo-500" />
                                        解析结果
                                    </h3>
                                    <div className="flex gap-2">
                                        <button 
                                            onClick={handleExportJSON}
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-400 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors border border-slate-700"
                                            title="Export raw JSON data"
                                        >
                                            <DocumentTextIcon className="w-4 h-4" />
                                            JSON
                                        </button>
                                        <button 
                                            onClick={handleExportCSV}
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-700 hover:bg-slate-600 rounded-md transition-colors border border-slate-600"
                                            title="Export CSV (Excel compatible)"
                                        >
                                            <TableCellsIcon className="w-4 h-4" />
                                            CSV
                                        </button>
                                    </div>
                                </div>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                                     <div>
                                        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">组分浓度</h4>
                                        <table className="min-w-full divide-y divide-slate-800 border border-slate-800 rounded-md overflow-hidden">
                                            <thead className="bg-slate-950">
                                                <tr>
                                                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-400 uppercase">组分</th>
                                                    <th className="px-3 py-2 text-right text-xs font-medium text-slate-400 uppercase">浓度 (Conc)</th>
                                                    <th className="px-3 py-2 text-right text-xs font-medium text-slate-400 uppercase">占比 (%)</th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-slate-900 divide-y divide-slate-800">
                                                {result.components.map((c, idx) => (
                                                    <tr key={idx}>
                                                        <td className="px-3 py-2 text-sm font-medium text-slate-300">{c.name}</td>
                                                        <td className="px-3 py-2 text-sm text-right text-slate-400 font-mono">{c.concentration.toFixed(4)}</td>
                                                        <td className="px-3 py-2 text-sm text-right text-indigo-400 font-mono">{c.contribution.toFixed(1)}%</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                     </div>
                                     
                                     <div className="bg-slate-950/50 p-4 rounded-lg border border-slate-800">
                                        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">拟合质量 metrics</h4>
                                        <div className="space-y-2">
                                            <div className="flex justify-between">
                                                <span className="text-sm text-slate-500">RMSE:</span>
                                                <span className="text-sm font-mono font-bold text-slate-300">{result.metrics.rmse.toExponential(3)}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-sm text-slate-500">Residual Norm:</span>
                                                <span className="text-sm font-mono font-bold text-slate-300">{result.metrics.residual_norm.toFixed(4)}</span>
                                            </div>
                                        </div>
                                     </div>
                                </div>

                                <div className="h-[400px] w-full mt-6">
                                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">光谱拟合图</h4>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 20, left: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                            <XAxis dataKey="lambda" tick={{ fontSize: 11, fill: '#94a3b8' }} label={{ value: 'Wavelength', position: 'insideBottom', offset: -5, fill: '#64748b' }} stroke="#475569" />
                                            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} stroke="#475569" />
                                            <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderRadius: '6px', border: '1px solid #334155', color: '#f1f5f9' }} />
                                            <Legend verticalAlign="top" height={36} wrapperStyle={{ color: '#cbd5e1' }} />
                                            <Line type="monotone" dataKey="original" stroke="#94a3b8" strokeWidth={2} dot={false} name="Experimental" />
                                            <Line type="monotone" dataKey="fitted" stroke="#6366f1" strokeWidth={2} dot={false} name="Fitted (NNLS)" />
                                            <Line type="monotone" dataKey="residual" stroke="#ef4444" strokeWidth={1} dot={false} name="Residual" />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>

                            </div>
                        )}

                        {!result && !loading && (
                            <div className="h-full flex flex-col items-center justify-center text-slate-500 border-2 border-dashed border-slate-800 rounded-xl bg-slate-900/50">
                                <BeakerIcon className="w-16 h-16 mb-4 opacity-20" />
                                <p>请在左侧选择样品和标准品并点击开始解析</p>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                /* Library Management View */
                <div className="bg-slate-900 rounded-lg shadow-sm border border-slate-800 p-6 overflow-hidden flex flex-col h-[calc(100vh-180px)]">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2">
                            <BookOpenIcon className="w-5 h-5 text-indigo-500" />
                            光谱标准库管理
                        </h3>
                        <p className="text-sm text-slate-500">
                            在此处管理历史光谱的属性。将其类型设为“Standard”即可在浓度解析中作为标准品使用。
                        </p>
                    </div>

                    <div className="overflow-auto flex-1 custom-scrollbar">
                        <table className="min-w-full divide-y divide-slate-800">
                            <thead className="bg-slate-950 sticky top-0 z-10">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">名称</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">类型</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">标定浓度</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">时间</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">操作</th>
                                </tr>
                            </thead>
                            <tbody className="bg-slate-900 divide-y divide-slate-800">
                                {history.map((item) => (
                                    <tr key={item.filename} className="hover:bg-slate-800 transition-colors">
                                        {editingItem === item.filename ? (
                                            <>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <input 
                                                        type="text" 
                                                        className="bg-slate-800 border-slate-600 rounded text-sm w-full focus:ring-indigo-500 focus:border-indigo-500 text-slate-200"
                                                        value={editForm.name}
                                                        onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                                                    />
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <select 
                                                        className="bg-slate-800 border-slate-600 rounded text-sm w-full focus:ring-indigo-500 focus:border-indigo-500 text-slate-200"
                                                        value={editForm.type}
                                                        onChange={(e) => setEditForm({...editForm, type: e.target.value})}
                                                    >
                                                        <option value="standard">Standard (标准品)</option>
                                                        <option value="multicomponent">Sample (样品)</option>
                                                    </select>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    {editForm.type === 'standard' ? (
                                                        <input 
                                                            type="text" 
                                                            className="bg-slate-800 border-slate-600 rounded text-sm w-full focus:ring-indigo-500 focus:border-indigo-500 text-slate-200"
                                                            value={editForm.concentration}
                                                            placeholder="e.g. 1.0 g/L"
                                                            onChange={(e) => setEditForm({...editForm, concentration: e.target.value})}
                                                        />
                                                    ) : (
                                                        <span className="text-slate-600 text-sm">--</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                                                    {item.timestamp}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                    <div className="flex justify-end gap-2">
                                                        <button onClick={() => saveEdit(item.filename)} className="text-emerald-500 hover:text-emerald-400 p-1">
                                                            <CheckIcon className="w-5 h-5" />
                                                        </button>
                                                        <button onClick={cancelEdit} className="text-slate-500 hover:text-slate-400 p-1">
                                                            <XMarkIcon className="w-5 h-5" />
                                                        </button>
                                                    </div>
                                                </td>
                                            </>
                                        ) : (
                                            <>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-300">
                                                    {item.name || item.filename}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full border ${
                                                        item.meta?.save_type === 'standard' 
                                                        ? 'bg-emerald-900/30 text-emerald-400 border-emerald-900' 
                                                        : 'bg-slate-800 text-slate-400 border-slate-700'
                                                    }`}>
                                                        {item.meta?.save_type === 'standard' ? 'Standard' : 'Sample'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400 font-mono">
                                                    {item.meta?.concentration || '--'}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 font-mono">
                                                    {item.timestamp}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                    <div className="flex justify-end gap-3">
                                                        <button 
                                                            onClick={() => startEdit(item)}
                                                            className="text-indigo-400 hover:text-indigo-300"
                                                            title="Edit"
                                                        >
                                                            <PencilSquareIcon className="w-5 h-5" />
                                                        </button>
                                                        <button 
                                                            onClick={() => handleDelete(item.filename)}
                                                            className="text-red-500 hover:text-red-400"
                                                            title="Delete"
                                                        >
                                                            <TrashIcon className="w-5 h-5" />
                                                        </button>
                                                    </div>
                                                </td>
                                            </>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};
