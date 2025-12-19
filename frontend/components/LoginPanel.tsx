import React, { useState } from 'react';
import { loginUser } from '../services/api';
import { User } from '../types';
import { ChartBarIcon, LockClosedIcon, UserIcon } from '@heroicons/react/24/outline';

interface LoginPanelProps {
    onLoginSuccess: (user: User) => void;
}

export const LoginPanel: React.FC<LoginPanelProps> = ({ onLoginSuccess }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const user = await loginUser(username, password);
            onLoginSuccess(user);
        } catch (err: any) {
            setError(err.message || 'Login failed');
        } finally {
            setLoading(false);
        }
    };

    const currentYear = new Date().getFullYear();

    return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
            <div className="bg-slate-900 rounded-lg shadow-2xl w-full max-w-md overflow-hidden border border-slate-800">
                <div className="bg-slate-900 p-8 text-center border-b border-slate-800">
                    <div className="w-16 h-16 bg-indigo-600 rounded-lg flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-500/20 ring-1 ring-white/10">
                        <ChartBarIcon className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-100 tracking-wide">智能光谱分析系统</h1>
                    <p className="text-indigo-400 text-sm mt-2 font-medium tracking-wider">INDUSTRIAL SPECTRAL ANALYSIS</p>
                </div>

                <div className="p-8">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {error && (
                            <div className="p-3 bg-red-900/20 text-red-400 text-sm rounded-md border border-red-900/50">
                                {error}
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">用户名</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <UserIcon className="h-5 w-5 text-slate-500" />
                                </div>
                                <input
                                    type="text"
                                    required
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="pl-10 block w-full rounded-md border-slate-700 bg-slate-800 text-slate-200 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm h-10 placeholder-slate-600"
                                    placeholder="Enter username"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">密码</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <LockClosedIcon className="h-5 w-5 text-slate-500" />
                                </div>
                                <input
                                    type="password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="pl-10 block w-full rounded-md border-slate-700 bg-slate-800 text-slate-200 shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm h-10 placeholder-slate-600"
                                    placeholder="Enter password"
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 transition-all"
                        >
                            {loading ? '正在登录...' : '登 录'}
                        </button>
                    </form>
                </div>
            </div>
            
            <div className="mt-8 text-slate-500 text-sm font-medium">
                @方舟智造 {currentYear}
            </div>
        </div>
    );
};