import React, { useState } from 'react';
import { HistoryItem } from '../types';
import { ArrowDownTrayIcon, EyeIcon, PencilSquareIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface HistoryPanelProps {
  historyList: HistoryItem[];
  onLoadItem: (filename: string) => void;
  onBatchExport: () => void;
  onRenameItem: (filename: string, newName: string) => void;
}

export const HistoryPanel: React.FC<HistoryPanelProps> = ({ historyList, onLoadItem, onBatchExport, onRenameItem }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>('');

  const startEdit = (item: HistoryItem) => {
    setEditingId(item.filename);
    setEditName(item.name || item.filename);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const saveEdit = (filename: string) => {
    if (editName.trim()) {
        onRenameItem(filename, editName.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="bg-slate-900 rounded-lg shadow-sm border border-slate-800 p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-100">历史记录</h2>
        <button 
            onClick={onBatchExport}
            className="text-xs flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
        >
            <ArrowDownTrayIcon className="w-4 h-4" />
            批量导出 CSV
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto pr-2 space-y-2 max-h-[600px] custom-scrollbar">
        {historyList.length === 0 ? (
            <p className="text-sm text-slate-600 italic">暂无历史记录。</p>
        ) : (
            historyList.map((item) => (
                <div 
                    key={item.filename}
                    className="p-3 rounded-md border border-slate-800 bg-slate-950/30 hover:border-indigo-500/50 hover:bg-slate-800 transition-colors group relative"
                >
                    <div className="flex justify-between items-start">
                        {editingId === item.filename ? (
                            <div className="flex items-center gap-2 w-full">
                                <input 
                                    type="text" 
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    className="flex-1 text-sm bg-slate-900 border-slate-600 rounded-md focus:ring-indigo-500 focus:border-indigo-500 py-1 text-slate-200"
                                    autoFocus
                                />
                                <button onClick={() => saveEdit(item.filename)} className="text-emerald-500 hover:text-emerald-400">
                                    <CheckIcon className="w-4 h-4" />
                                </button>
                                <button onClick={cancelEdit} className="text-red-500 hover:text-red-400">
                                    <XMarkIcon className="w-4 h-4" />
                                </button>
                            </div>
                        ) : (
                            <>
                                <div className="flex-1 min-w-0 pr-2">
                                    <h3 className="text-sm font-bold text-slate-300 truncate group-hover:text-indigo-300 transition-colors" title={item.name || item.filename}>
                                        {item.name || item.filename}
                                    </h3>
                                    <p className="text-xs text-slate-500 mt-1 font-mono">{item.timestamp}</p>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button 
                                        onClick={() => startEdit(item)}
                                        className="p-1.5 text-slate-400 hover:text-indigo-400 bg-slate-800 rounded-md border border-slate-700 hover:border-indigo-500/50"
                                        title="重命名"
                                    >
                                        <PencilSquareIcon className="w-4 h-4" />
                                    </button>
                                    <button 
                                        onClick={() => onLoadItem(item.filename)}
                                        className="p-1.5 text-slate-400 hover:text-indigo-400 bg-slate-800 rounded-md border border-slate-700 hover:border-indigo-500/50"
                                        title="查看"
                                    >
                                        <EyeIcon className="w-4 h-4" />
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            ))
        )}
      </div>
    </div>
  );
};