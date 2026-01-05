import React, { useState } from 'react';
import { ProcessingParams } from '../types';
import { BoltIcon, FolderArrowDownIcon } from '@heroicons/react/24/outline';

interface ControlPanelProps {
  onProcess: (files: { sample: File; water: File; dark: File }, params: ProcessingParams) => void;
  onSave: (name: string, type: 'standard' | 'multicomponent', concentration?: string, dyeCode?: string) => void;
  loading: boolean;
  hasData: boolean;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({ onProcess, onSave, loading, hasData }) => {
  const [files, setFiles] = useState<{ sample: File | null; water: File | null; dark: File | null }>({
    sample: null,
    water: null,
    dark: null,
  });

  const [params, setParams] = useState<ProcessingParams>({
    enableSmoothing: false,
    smoothWindow: 11,
    smoothOrder: 3,
  });

  // Save State
  const [saveName, setSaveName] = useState('');
  const [saveType, setSaveType] = useState<'standard' | 'multicomponent'>('standard');
  const [concentration, setConcentration] = useState('');
  const [dyeCode, setDyeCode] = useState('');

  const handleFileChange = (key: keyof typeof files) => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFiles((prev) => ({ ...prev, [key]: e.target.files![0] }));
    }
  };

  const handleProcessClick = () => {
    if (files.sample && files.water && files.dark) {
      onProcess({ sample: files.sample, water: files.water, dark: files.dark }, params);
    } else {
        alert("请选择所有三个 SPC 文件。");
    }
  };

  const isReady = files.sample && files.water && files.dark;

  return (
    <div className="bg-slate-900 rounded-lg shadow-sm border border-slate-800 p-5 space-y-6 text-slate-300">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 mb-4">输入文件 (.spc)</h2>
        <div className="space-y-3">
          {[
            { key: 'sample', label: '样本光谱 (Sample)' },
            { key: 'water', label: '水光谱 (Water)' },
            { key: 'dark', label: '暗光谱 (Dark)' }
          ].map((item) => (
            <div key={item.key}>
              <label className="block text-sm font-medium text-slate-400 mb-1">
                {item.label}
              </label>
              <div className="relative">
                <input
                  type="file"
                  accept=".spc"
                  onChange={handleFileChange(item.key as any)}
                  className="block w-full text-sm text-slate-400
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-md file:border-0
                    file:text-sm file:font-semibold
                    file:bg-slate-800 file:text-indigo-400
                    hover:file:bg-slate-700
                    cursor-pointer bg-slate-950/50 rounded-md border border-slate-700"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-slate-800 pt-4">
        <h2 className="text-lg font-semibold text-slate-100 mb-4">平滑选项</h2>
        <div className="space-y-3">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={params.enableSmoothing}
              onChange={(e) => setParams({ ...params, enableSmoothing: e.target.checked })}
              className="rounded bg-slate-800 border-slate-600 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900"
            />
            <span className="text-sm text-slate-300">启用多项式平滑 (Savitzky-Golay)</span>
          </label>

          {params.enableSmoothing && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">窗口大小 (Window)</label>
                <input
                  type="number"
                  value={params.smoothWindow}
                  onChange={(e) => setParams({ ...params, smoothWindow: parseInt(e.target.value) || 3 })}
                  className="w-full bg-slate-800 border-slate-700 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm text-slate-200"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">多项式阶数 (Order)</label>
                <input
                  type="number"
                  value={params.smoothOrder}
                  onChange={(e) => setParams({ ...params, smoothOrder: parseInt(e.target.value) || 1 })}
                  className="w-full bg-slate-800 border-slate-700 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm text-slate-200"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <button
        onClick={handleProcessClick}
        disabled={!isReady || loading}
        className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-md font-bold text-white transition-all border
          ${isReady && !loading 
            ? 'bg-indigo-600 hover:bg-indigo-500 border-indigo-500 shadow-lg shadow-indigo-900/30' 
            : 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'}
        `}
      >
        {loading ? (
            <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
        ) : (
             <BoltIcon className="w-5 h-5" />
        )}
        开始计算
      </button>

      {hasData && (
        <div className="border-t border-slate-800 pt-4 space-y-4 animate-fade-in">
           <h3 className="text-sm font-semibold text-slate-200">保存结果</h3>
           
           {/* Save Options */}
           <div className="space-y-2">
             <div className="flex items-center space-x-4">
                <label className="flex items-center space-x-2 cursor-pointer">
                    <input 
                        type="radio" 
                        name="saveType"
                        value="standard"
                        checked={saveType === 'standard'}
                        onChange={() => setSaveType('standard')}
                        className="bg-slate-800 border-slate-600 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900"
                    />
                    <span className="text-sm text-slate-300">基准单染料光谱</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer">
                    <input 
                        type="radio" 
                        name="saveType"
                        value="multicomponent"
                        checked={saveType === 'multicomponent'}
                        onChange={() => setSaveType('multicomponent')}
                        className="bg-slate-800 border-slate-600 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900"
                    />
                    <span className="text-sm text-slate-300">多组分光谱解析</span>
                </label>
             </div>

           {saveType === 'standard' && (
                 <div className="animate-fade-in space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">浓度 (Concentration)</label>
                      <input 
                          type="text"
                          placeholder="例如: 0.5 g/L"
                          value={concentration}
                          onChange={(e) => setConcentration(e.target.value)}
                          className="w-full bg-slate-800 border-slate-700 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">染料代码 (Dye Code)</label>
                      <input
                          type="text"
                          placeholder="例如: DYE-001"
                          value={dyeCode}
                          onChange={(e) => setDyeCode(e.target.value)}
                          className="w-full bg-slate-800 border-slate-700 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm text-slate-200"
                      />
                    </div>
                 </div>
             )}
           </div>

           <div className="flex gap-2">
             <input 
                type="text" 
                placeholder="名称 (例如: 染料A_01)" 
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                className="flex-1 bg-slate-800 border-slate-700 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500 text-slate-200"
             />
             <button
                onClick={() => onSave(saveName, saveType, concentration, dyeCode)}
                disabled={!saveName || (saveType === 'standard' && !concentration)}
                className="px-3 py-2 bg-emerald-700 text-white rounded-md hover:bg-emerald-600 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed flex items-center shadow-sm border border-emerald-600 disabled:border-slate-700"
             >
                <FolderArrowDownIcon className="w-5 h-5" />
             </button>
           </div>
        </div>
      )}
    </div>
  );
};
