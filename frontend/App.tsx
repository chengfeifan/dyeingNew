import React, { useState, useEffect } from 'react';
import { ControlPanel } from './components/ControlPanel';
import { SpectralChart } from './components/SpectralChart';
import { HistoryPanel } from './components/HistoryPanel';
import { ConcentrationPanel } from './components/ConcentrationPanel';
import { PredictionPanel } from './components/PredictionPanel';
import { LoginPanel } from './components/LoginPanel';
import { UserManagementPanel } from './components/UserManagementPanel';
import { ProcessedData, ProcessingParams, HistoryItem, User } from './types';
import { 
  processSpectra, 
  saveHistory, 
  fetchHistoryList, 
  fetchHistoryItem, 
  downloadHistoryZip, 
  renameHistoryItem, 
  getSessionUser, 
  logoutUser,
  updateSessionActivity 
} from './services/api';
import { 
  ChartBarIcon, 
  BeakerIcon, 
  PresentationChartLineIcon, 
  CalculatorIcon,
  ClockIcon,
  UserCircleIcon,
  ArrowRightOnRectangleIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon
} from '@heroicons/react/24/outline';

type Module = 'preprocessing' | 'concentration' | 'prediction' | 'users';

const App: React.FC = () => {
  // Auth State
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // App State
  const [activeModule, setActiveModule] = useState<Module>('preprocessing');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  
  // Preprocessing Module State
  const [subTab, setSubTab] = useState<'process' | 'history'>('process');
  const [data, setData] = useState<ProcessedData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [historyList, setHistoryList] = useState<HistoryItem[]>([]);

  useEffect(() => {
    // Check for existing session
    const session = getSessionUser();
    if (session) {
        setCurrentUser(session);
    }
  }, []);

  // Session Timeout Monitor
  useEffect(() => {
    if (!currentUser) return;

    // 1. Activity Handler to reset timeout
    const handleActivity = () => {
      updateSessionActivity();
    };

    // Throttle: Only update localStorage at most once per minute during continuous activity
    let throttleTimeout: ReturnType<typeof setTimeout> | null = null;
    const throttledHandler = () => {
      if (!throttleTimeout) {
        handleActivity();
        throttleTimeout = setTimeout(() => {
          throttleTimeout = null;
        }, 60 * 1000); 
      }
    };

    // Attach listeners
    window.addEventListener('mousemove', throttledHandler);
    window.addEventListener('keydown', throttledHandler);
    window.addEventListener('click', throttledHandler);
    window.addEventListener('scroll', throttledHandler);

    // 2. Check for expiry periodically
    const checkInterval = setInterval(() => {
       const session = getSessionUser();
       // getSessionUser returns null if expired
       if (!session) {
         setCurrentUser(null);
         setActiveModule('preprocessing');
         alert("由于长时间未操作，您的会话已超时，请重新登录。");
       }
    }, 60 * 1000); // Check every minute

    return () => {
      window.removeEventListener('mousemove', throttledHandler);
      window.removeEventListener('keydown', throttledHandler);
      window.removeEventListener('click', throttledHandler);
      window.removeEventListener('scroll', throttledHandler);
      clearInterval(checkInterval);
      if (throttleTimeout) clearTimeout(throttleTimeout);
    };
  }, [currentUser]);

  // Calculate Function
  const handleProcess = async (files: { sample: File; water: File; dark: File }, params: ProcessingParams) => {
    setLoading(true);
    setError(null);
    try {
      const result = await processSpectra(files, params);
      setData(result);
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.detail || "处理失败，请检查后端服务是否运行。");
    } finally {
      setLoading(false);
    }
  };

  // Save to History
  const handleSave = async (name: string, type: 'standard' | 'multicomponent', concentration?: string) => {
    if (!data) return;
    try {
      await saveHistory(name, data, type, concentration);
      alert("保存成功！");
      loadHistory();
    } catch (err) {
      alert("保存历史记录失败。");
    }
  };

  // Load History List
  const loadHistory = async () => {
    try {
      const list = await fetchHistoryList();
      setHistoryList(list);
    } catch (err) {
      console.error("加载历史列表失败");
    }
  };

  // Load specific history item
  const handleLoadHistoryItem = async (filename: string) => {
    setLoading(true);
    try {
      const result = await fetchHistoryItem(filename);
      setData(result);
      setSubTab('process');
    } catch (err) {
      setError("加载历史记录失败。");
    } finally {
      setLoading(false);
    }
  };

  // Rename History Item
  const handleRenameHistory = async (filename: string, newName: string) => {
    try {
        await renameHistoryItem(filename, newName);
        loadHistory(); // Refresh list
    } catch (err) {
        alert("重命名失败。");
    }
  };

  // Batch Export
  const handleBatchExport = async () => {
    try {
        const blob = await downloadHistoryZip();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "spectra_history_export.zip";
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
    } catch (err) {
        alert("批量导出下载失败。");
    }
  };

  const handleLogout = async () => {
      await logoutUser();
      setCurrentUser(null);
      setActiveModule('preprocessing');
  };

  useEffect(() => {
    if (currentUser && activeModule === 'preprocessing' && subTab === 'history') {
      loadHistory();
    }
  }, [activeModule, subTab, currentUser]);

  // If not logged in, show Login Panel
  if (!currentUser) {
      return <LoginPanel onLoginSuccess={setCurrentUser} />;
  }

  // Sidebar Menu Items
  const menuItems = [
    { id: 'preprocessing', label: '光谱数据预处理', icon: ChartBarIcon },
    { id: 'concentration', label: '多组分光谱浓度解析', icon: BeakerIcon },
    { id: 'prediction', label: '实时上染预测', icon: PresentationChartLineIcon },
  ];

  if (currentUser.role === 'admin') {
      menuItems.push({ id: 'users', label: '用户管理', icon: UserCircleIcon });
  }

  return (
    <div className="flex h-screen bg-slate-950 overflow-hidden font-sans text-slate-300">
      
      {/* Sidebar */}
      <aside className={`${isSidebarCollapsed ? 'w-20' : 'w-64'} bg-slate-900 border-r border-slate-800 flex-shrink-0 flex flex-col transition-all duration-300 z-20`}>
        {/* Sidebar Header */}
        <div className={`h-16 flex items-center border-b border-slate-800 bg-slate-900 transition-all duration-300 ${isSidebarCollapsed ? 'justify-center px-0' : 'px-6'}`}>
          <div className="w-8 h-8 bg-indigo-600 rounded-md flex items-center justify-center shadow-lg shadow-indigo-500/20 ring-1 ring-white/10 flex-shrink-0">
             <ChartBarIcon className="w-5 h-5 text-white" />
          </div>
          <span className={`font-bold text-lg tracking-wide text-slate-100 ml-3 whitespace-nowrap overflow-hidden transition-all duration-300 ${isSidebarCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
            智能光谱
          </span>
        </div>

        {/* Sidebar Nav */}
        <nav className="flex-1 py-6 px-3 space-y-2 overflow-y-auto overflow-x-hidden">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeModule === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveModule(item.id as Module)}
                title={isSidebarCollapsed ? item.label : ''}
                className={`w-full flex items-center rounded-md text-sm font-medium transition-all ${
                  isActive 
                    ? 'bg-indigo-600 text-white shadow-md shadow-black/20' 
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                } ${isSidebarCollapsed ? 'justify-center py-3 px-0' : 'px-4 py-3 gap-3'}`}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                <span className={`whitespace-nowrap overflow-hidden transition-all duration-300 ${isSidebarCollapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Collapse Toggle */}
        <div className="px-3 pb-2">
            <button
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                className="w-full flex items-center justify-center py-2 text-slate-500 hover:text-indigo-400 hover:bg-slate-800 rounded-md transition-colors"
            >
                {isSidebarCollapsed ? (
                    <ChevronDoubleRightIcon className="w-5 h-5" />
                ) : (
                    <div className="flex items-center gap-2 text-xs font-medium">
                        <ChevronDoubleLeftIcon className="w-4 h-4" />
                        <span>收起侧栏</span>
                    </div>
                )}
            </button>
        </div>

        {/* User Info Section */}
        <div className={`border-t border-slate-800 bg-slate-900 transition-all duration-300 ${isSidebarCollapsed ? 'p-2' : 'p-4'}`}>
          <div className={`flex items-center gap-3 mb-3 ${isSidebarCollapsed ? 'justify-center mb-0' : ''}`}>
             <div className="w-10 h-10 rounded-md bg-slate-800 flex items-center justify-center border border-slate-700 flex-shrink-0" title={currentUser.username}>
                <UserCircleIcon className="w-6 h-6 text-slate-400" />
             </div>
             
             <div className={`flex-1 overflow-hidden transition-all duration-300 ${isSidebarCollapsed ? 'w-0 opacity-0 hidden' : 'w-auto opacity-100 block'}`}>
                <div className="text-sm font-semibold text-slate-200 truncate">{currentUser.username}</div>
                <div className="text-[10px] text-indigo-400 uppercase tracking-wider font-bold">{currentUser.role}</div>
             </div>
          </div>
          
          <div className={`flex flex-col gap-2 mb-2 transition-all duration-300 ${isSidebarCollapsed ? 'hidden' : 'block'}`}>
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <ClockIcon className="w-3 h-3" />
                <span>Last login:</span>
            </div>
            <div className="text-[10px] text-slate-400 pl-4.5 -mt-1 truncate font-mono">
                 {currentUser.lastLogin}
            </div>
          </div>

          <button 
             onClick={handleLogout}
             title="退出登录"
             className={`w-full flex items-center justify-center gap-2 py-2 rounded-md bg-slate-800 hover:bg-red-900/40 hover:text-red-300 text-slate-400 text-xs transition-colors border border-slate-700 hover:border-red-900/50 ${isSidebarCollapsed ? 'mt-2' : ''}`}
          >
             <ArrowRightOnRectangleIcon className="w-4 h-4" />
             <span className={`${isSidebarCollapsed ? 'hidden' : 'block'}`}>退出登录</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        
        {/* Header */}
        <header className="bg-slate-900 border-b border-slate-800 h-16 flex items-center justify-between px-8 shadow-sm z-10">
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
             {menuItems.find(m => m.id === activeModule)?.icon && React.createElement(menuItems.find(m => m.id === activeModule)!.icon, { className: "w-6 h-6 text-indigo-500" })}
             {menuItems.find(m => m.id === activeModule)?.label}
          </h2>
          
          {activeModule === 'preprocessing' && (
            <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700">
              <button
                onClick={() => setSubTab('process')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                  subTab === 'process' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <CalculatorIcon className="w-4 h-4" />
                处理
              </button>
              <button
                onClick={() => setSubTab('history')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                  subTab === 'history' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ClockIcon className="w-4 h-4" />
                历史
              </button>
            </div>
          )}
        </header>

        {/* Scrollable Content */}
        <main className="flex-1 overflow-auto p-8 bg-slate-950">
          
          {/* Module: Preprocessing */}
          {activeModule === 'preprocessing' && (
            <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
              
              {/* Left Panel */}
              <div className={`lg:col-span-4 ${subTab === 'process' ? 'block' : 'hidden lg:block'}`}>
                {subTab === 'process' ? (
                  <ControlPanel 
                    onProcess={handleProcess} 
                    onSave={handleSave}
                    loading={loading}
                    hasData={!!data}
                  />
                ) : (
                  <HistoryPanel 
                    historyList={historyList} 
                    onLoadItem={handleLoadHistoryItem}
                    onBatchExport={handleBatchExport}
                    onRenameItem={handleRenameHistory}
                  />
                )}
              </div>

              {/* Right Panel (Chart) */}
              <div className="lg:col-span-8 flex flex-col gap-6">
                {error && (
                  <div className="bg-red-900/20 border-l-4 border-red-500 text-red-200 p-4 rounded shadow-sm">
                    <p className="font-bold">错误</p>
                    <p>{error}</p>
                  </div>
                )}

                <div className="bg-slate-900 rounded-lg border border-slate-800 p-6 min-h-[600px] flex flex-col shadow-xl">
                  {data ? (
                    <SpectralChart data={data} />
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
                      <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mb-4 border border-slate-700">
                        <ChartBarIcon className="w-12 h-12 opacity-30 text-indigo-400" />
                      </div>
                      <p className="text-lg font-medium text-slate-400">暂无数据</p>
                      <p className="text-sm mt-2 text-slate-600">请上传 .spc 文件或从历史记录中选择以查看光谱图</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Module: Concentration Analysis */}
          {activeModule === 'concentration' && (
            <div className="h-full">
               <ConcentrationPanel />
            </div>
          )}

          {/* Module: Prediction */}
          {activeModule === 'prediction' && (
            <div className="h-full">
              <PredictionPanel />
            </div>
          )}

          {/* Module: User Management (Protected) */}
          {activeModule === 'users' && currentUser.role === 'admin' && (
            <div className="h-full">
              <UserManagementPanel />
            </div>
          )}

        </main>
      </div>
    </div>
  );
};

export default App;