import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { getAllUsers, addUser, deleteUser } from '../services/api';
import { UserPlusIcon, TrashIcon, UserCircleIcon } from '@heroicons/react/24/outline';

export const UserManagementPanel: React.FC = () => {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);
    
    // Add User Form
    const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user' as 'admin'|'user' });
    const [error, setError] = useState('');

    useEffect(() => {
        loadUsers();
    }, []);

    const loadUsers = async () => {
        setLoading(true);
        try {
            const list = await getAllUsers();
            setUsers(list);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleAddUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!newUser.username || !newUser.password) {
            setError('Please fill in all fields');
            return;
        }

        try {
            await addUser({ 
                username: newUser.username, 
                password: newUser.password, 
                role: newUser.role,
                lastLogin: '' 
            });
            setNewUser({ username: '', password: '', role: 'user' });
            loadUsers();
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleDelete = async (username: string) => {
        if (!confirm(`Are you sure you want to delete user ${username}?`)) return;
        try {
            await deleteUser(username);
            loadUsers();
        } catch (err: any) {
            alert(err.message);
        }
    };

    return (
        <div className="max-w-6xl mx-auto h-full flex flex-col gap-6 text-slate-300">
            <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-indigo-900/30 border border-indigo-500/30 rounded-lg text-indigo-400">
                    <UserCircleIcon className="w-6 h-6" />
                </div>
                <div>
                    <h2 className="text-xl font-bold text-slate-100">用户管理</h2>
                    <p className="text-sm text-slate-500">管理系统访问权限与账号</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-full">
                
                {/* Left: User List */}
                <div className="lg:col-span-8 bg-slate-900 rounded-lg shadow-sm border border-slate-800 overflow-hidden flex flex-col">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-800">
                            <thead className="bg-slate-950">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">用户</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">角色</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">最近登录</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">操作</th>
                                </tr>
                            </thead>
                            <tbody className="bg-slate-900 divide-y divide-slate-800">
                                {loading ? (
                                    <tr><td colSpan={4} className="text-center py-4 text-slate-500">Loading...</td></tr>
                                ) : (
                                    users.map((user) => (
                                        <tr key={user.username} className="hover:bg-slate-800 transition-colors">
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-200">
                                                {user.username}
                                                {user.username === 'admin' && <span className="ml-2 text-xs text-indigo-300 bg-indigo-900/50 px-2 py-0.5 rounded-full border border-indigo-500/30">System</span>}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400">
                                                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full border ${
                                                    user.role === 'admin' 
                                                    ? 'bg-purple-900/30 text-purple-300 border-purple-800' 
                                                    : 'bg-emerald-900/30 text-emerald-300 border-emerald-800'
                                                }`}>
                                                    {user.role}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 font-mono">
                                                {user.lastLogin || 'Never'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                {user.username !== 'admin' && (
                                                    <button 
                                                        onClick={() => handleDelete(user.username)}
                                                        className="text-red-500 hover:text-red-400 flex items-center justify-end gap-1 ml-auto"
                                                    >
                                                        <TrashIcon className="w-4 h-4" /> 删除
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Right: Add User */}
                <div className="lg:col-span-4 bg-slate-900 rounded-lg shadow-sm border border-slate-800 p-6 h-fit">
                    <h3 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
                        <UserPlusIcon className="w-5 h-5 text-indigo-500" />
                        添加新用户
                    </h3>
                    
                    <form onSubmit={handleAddUser} className="space-y-4">
                        {error && <div className="text-red-400 text-xs">{error}</div>}
                        
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">用户名</label>
                            <input
                                type="text"
                                value={newUser.username}
                                onChange={(e) => setNewUser({...newUser, username: e.target.value})}
                                className="w-full bg-slate-800 border-slate-700 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500 text-slate-200"
                                placeholder="Username"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">密码</label>
                            <input
                                type="password"
                                value={newUser.password}
                                onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                                className="w-full bg-slate-800 border-slate-700 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500 text-slate-200"
                                placeholder="Password"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">角色</label>
                            <select
                                value={newUser.role}
                                onChange={(e) => setNewUser({...newUser, role: e.target.value as any})}
                                className="w-full bg-slate-800 border-slate-700 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500 text-slate-200"
                            >
                                <option value="user">User (普通用户)</option>
                                <option value="admin">Admin (管理员)</option>
                            </select>
                        </div>

                        <button 
                            type="submit"
                            className="w-full bg-indigo-600 text-white py-2 px-4 rounded-md text-sm font-bold hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-900/20"
                        >
                            创建用户
                        </button>
                    </form>
                </div>

            </div>
        </div>
    );
};