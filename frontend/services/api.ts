import { ProcessedData, ProcessingParams, HistoryItem, ConcentrationResult, User } from '../types';

// --- 常量 & 本地存储键 ---
const STORAGE_KEY_USERS = 'spectral_app_users';
const STORAGE_KEY_SESSION = 'spectral_app_session';
const STORAGE_KEY_DATA = 'spectral_app_data';
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds

// --- 模拟数据生成工具 ---

// 生成模拟光谱数据 (基于高斯峰模拟)
// peaks: [{ pos: 520, height: 0.8, width: 30 }]
const generateSpectrum = (peaks: { pos: number, height: number, width: number }[]) => {
    const lambda: number[] = [];
    const A: number[] = [];
    const T: number[] = [];
    const I_corr: number[] = [];

    for (let l = 400; l <= 700; l += 5) {
        lambda.push(l);
        
        let abs = 0;
        // 添加基线噪音
        abs += Math.random() * 0.005;

        // 叠加所有吸收峰
        peaks.forEach(p => {
            const val = p.height * Math.exp(-Math.pow(l - p.pos, 2) / (2 * Math.pow(p.width, 2)));
            abs += val;
        });

        // 确保非负
        abs = Math.max(0, abs);

        A.push(abs);
        T.push(Math.pow(10, -abs));
        // 模拟仪器读数 (I_corr)
        I_corr.push(Math.pow(10, -abs) * 1000 + Math.random() * 5); 
    }

    return { lambda, A, T, I_corr };
};

// 初始化模拟数据 (如果本地存储为空)
const initMockData = () => {
    // 1. 初始化光谱数据
    if (!localStorage.getItem(STORAGE_KEY_DATA)) {
        const timestamp = new Date().toLocaleString('zh-CN');
        const db: Record<string, ProcessedData> = {};

        // 1. 标准品 - 活性红 (吸收绿光，峰值约520nm)
        db['std_red.spc'] = {
            meta: { 
                name: '标准品_活性红_B-3BF', 
                timestamp, 
                smooth_enabled: true, 
                save_type: 'standard',
                concentration: '1.0 g/L',
                files: { sample: 'raw_red.spc', water: 'water_ref.spc', dark: 'dark_ref.spc' }
            },
            data: generateSpectrum([{ pos: 530, height: 0.85, width: 35 }]) 
        };

        // 2. 标准品 - 活性蓝 (吸收红橙光，峰值约620nm)
        db['std_blue.spc'] = {
            meta: { 
                name: '标准品_活性蓝_KN-R', 
                timestamp, 
                smooth_enabled: true, 
                save_type: 'standard',
                concentration: '1.0 g/L',
                files: { sample: 'raw_blue.spc', water: 'water_ref.spc', dark: 'dark_ref.spc' }
            },
            data: generateSpectrum([{ pos: 620, height: 0.78, width: 45 }]) 
        };

        // 3. 标准品 - 活性黄 (吸收蓝紫光，峰值约420nm)
        db['std_yellow.spc'] = {
            meta: { 
                name: '标准品_活性黄_3RS', 
                timestamp, 
                smooth_enabled: true, 
                save_type: 'standard',
                concentration: '1.0 g/L',
                files: { sample: 'raw_yellow.spc', water: 'water_ref.spc', dark: 'dark_ref.spc' }
            },
            data: generateSpectrum([{ pos: 410, height: 0.92, width: 25 }]) 
        };

        // 4. 混合样 (模拟生产数据：红+蓝)
        db['prod_mix_purple.spc'] = {
            meta: { 
                name: '生产样_紫色配方_P20231001', 
                timestamp, 
                smooth_enabled: true, 
                save_type: 'multicomponent',
                files: { sample: 'mix_01.spc', water: 'water_ref.spc', dark: 'dark_ref.spc' }
            },
            data: generateSpectrum([
                { pos: 530, height: 0.45, width: 35 }, // 约0.5份红
                { pos: 620, height: 0.35, width: 45 }  // 约0.4份蓝
            ])
        };

        // 5. 混合样 (模拟生产数据：绿+黄)
        db['prod_mix_green.spc'] = {
            meta: { 
                name: '生产样_嫩绿配方_G20231005', 
                timestamp, 
                smooth_enabled: true, 
                save_type: 'multicomponent',
                files: { sample: 'mix_02.spc', water: 'water_ref.spc', dark: 'dark_ref.spc' }
            },
            data: generateSpectrum([
                { pos: 620, height: 0.2, width: 45 }, // 少许蓝
                { pos: 410, height: 0.6, width: 25 }  // 较多黄
            ])
        };

        localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(db));
    }
    
    // 2. 初始化/更新 用户数据 (确保 admin 密码为 spectral123)
    const usersStr = localStorage.getItem(STORAGE_KEY_USERS);
    let users: User[] = usersStr ? JSON.parse(usersStr) : [];
    
    const adminIndex = users.findIndex(u => u.username === 'admin');
    
    if (adminIndex === -1) {
        // 创建默认管理员
        users.push({
            username: 'admin',
            role: 'admin',
            lastLogin: '',
            password: 'spectral123' 
        });
    } else {
        // 强制更新已有管理员的密码，防止旧数据造成登录失败
        users[adminIndex].password = 'spectral123';
    }
    
    localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(users));
};

// 立即运行初始化
initMockData();

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- API 模拟实现 ---

export const processSpectra = async (
  files: { sample: File; water: File; dark: File },
  params: ProcessingParams
): Promise<ProcessedData> => {
    await delay(1200); // 模拟计算延迟
    
    // 模拟处理结果：根据文件名简单生成不同特征的光谱
    let peaks = [{ pos: 500, height: 0.5, width: 40 }]; // 默认
    
    if (files.sample.name.includes('红') || files.sample.name.includes('Red')) {
        peaks = [{ pos: 530, height: 0.8, width: 35 }];
    } else if (files.sample.name.includes('蓝') || files.sample.name.includes('Blue')) {
        peaks = [{ pos: 620, height: 0.7, width: 40 }];
    } else if (files.sample.name.includes('黄') || files.sample.name.includes('Yellow')) {
        peaks = [{ pos: 410, height: 0.9, width: 25 }];
    } else {
        // 随机复杂光谱
        peaks = [
             { pos: 400 + Math.random() * 100, height: Math.random(), width: 30 },
             { pos: 550 + Math.random() * 100, height: Math.random(), width: 40 }
        ];
    }

    return {
        meta: {
            name: files.sample.name.replace(/\.spc$/i, ''),
            timestamp: new Date().toLocaleString('zh-CN'),
            smooth_enabled: params.enableSmoothing,
            smooth_window: params.smoothWindow,
            smooth_order: params.smoothOrder,
            files: {
                sample: files.sample.name,
                water: files.water.name,
                dark: files.dark.name
            }
        },
        data: generateSpectrum(peaks)
    };
};

export const saveHistory = async (
    name: string, 
    data: ProcessedData, 
    saveType: 'standard' | 'multicomponent',
    concentration?: string
): Promise<void> => {
    await delay(400);
    const db = JSON.parse(localStorage.getItem(STORAGE_KEY_DATA) || '{}');
    // 生成唯一文件名
    const key = `${name}_${Date.now()}.spc`;
    
    db[key] = {
        ...data,
        meta: {
            ...data.meta,
            name: name,
            save_type: saveType,
            concentration: concentration
        }
    };
    localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(db));
};

export const fetchHistoryList = async (): Promise<HistoryItem[]> => {
    await delay(300);
    const db = JSON.parse(localStorage.getItem(STORAGE_KEY_DATA) || '{}');
    return Object.keys(db).map(key => ({
        filename: key,
        name: db[key].meta.name || key,
        timestamp: db[key].meta.timestamp,
        meta: db[key].meta
    })).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
};

export const fetchHistoryItem = async (filename: string): Promise<ProcessedData> => {
    await delay(300);
    const db = JSON.parse(localStorage.getItem(STORAGE_KEY_DATA) || '{}');
    if (!db[filename]) throw new Error("文件不存在或已损坏");
    return db[filename];
};

export const renameHistoryItem = async (filename: string, newName: string): Promise<void> => {
    await delay(200);
    const db = JSON.parse(localStorage.getItem(STORAGE_KEY_DATA) || '{}');
    if (db[filename]) {
        db[filename].meta.name = newName;
        localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(db));
    }
};

export const updateHistoryItem = async (
    filename: string, 
    update: { name?: string; concentration?: string; save_type?: string }
): Promise<void> => {
    await delay(200);
    const db = JSON.parse(localStorage.getItem(STORAGE_KEY_DATA) || '{}');
    if (db[filename]) {
        if (update.name) db[filename].meta.name = update.name;
        if (update.concentration !== undefined) db[filename].meta.concentration = update.concentration;
        if (update.save_type) db[filename].meta.save_type = update.save_type as any;
        localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(db));
    }
};

export const deleteHistoryItem = async (filename: string): Promise<void> => {
    await delay(200);
    const db = JSON.parse(localStorage.getItem(STORAGE_KEY_DATA) || '{}');
    delete db[filename];
    localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(db));
};

export const downloadHistoryZip = async (): Promise<Blob> => {
    await delay(800);
    return new Blob(["模拟的ZIP文件内容"], { type: 'application/zip' });
};

export const analyzeConcentration = async (sampleFilename: string, standardFilenames: string[]): Promise<ConcentrationResult> => {
    await delay(1500); // 模拟较长的计算时间
    const db = JSON.parse(localStorage.getItem(STORAGE_KEY_DATA) || '{}');
    const sample = db[sampleFilename];
    if (!sample) throw new Error("样品数据丢失");

    // 模拟 NNLS (非负最小二乘法) 逻辑
    const components = standardFilenames.map(fname => {
        const std = db[fname];
        // 随机生成一个合理的浓度值 (0.1 - 0.8 之间)
        const conc = 0.1 + Math.random() * 0.7;
        return {
            name: std?.meta.name || fname,
            concentration: conc,
            contribution: 0
        };
    });

    const totalConc = components.reduce((acc, c) => acc + c.concentration, 0);
    components.forEach(c => c.contribution = totalConc > 0 ? (c.concentration / totalConc) * 100 : 0);

    // 构造拟合曲线
    // 为了让图表看起来真实，我们在原始曲线上加一点微小的随机扰动作为“拟合曲线”
    const original = sample.data.A;
    const fitted = original.map((v: number) => v * (0.96 + Math.random() * 0.08)); 
    const residual = original.map((v: number, i: number) => v - fitted[i]);

    return {
        components,
        metrics: {
            rmse: 0.0012 + Math.random() * 0.0008,
            residual_norm: 0.015 + Math.random() * 0.005
        },
        chart_data: {
            lambda: sample.data.lambda,
            original,
            fitted,
            residual
        }
    };
};

// --- 用户认证服务 (本地模拟) ---

export const loginUser = async (username: string, password: string): Promise<User> => {
    await delay(600);
    const usersStr = localStorage.getItem(STORAGE_KEY_USERS);
    const users: User[] = usersStr ? JSON.parse(usersStr) : [];
    
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
         const timestamp = new Date().toLocaleString('zh-CN');
         const updated = { ...user, lastLogin: timestamp };
         
         // 更新用户登录时间
         const newUsers = users.map(u => u.username === username ? updated : u);
         localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(newUsers));
         
         // 设置会话，并记录活动时间戳
         const session = { ...updated, _lastActivity: Date.now() };
         delete session.password;
         localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
         return session;
    }
    throw new Error("用户名或密码错误");
};

export const logoutUser = async (): Promise<void> => {
    localStorage.removeItem(STORAGE_KEY_SESSION);
};

export const getSessionUser = (): User | null => {
    const s = localStorage.getItem(STORAGE_KEY_SESSION);
    if (!s) return null;
    
    const session = JSON.parse(s);
    
    // Check if session is expired
    if (session._lastActivity) {
        const now = Date.now();
        if (now - session._lastActivity > SESSION_TIMEOUT) {
            logoutUser();
            return null;
        }
    }
    
    return session as User;
};

// 更新会话活动时间 (防止超时)
export const updateSessionActivity = (): void => {
    const s = localStorage.getItem(STORAGE_KEY_SESSION);
    if (s) {
        const session = JSON.parse(s);
        session._lastActivity = Date.now();
        localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
    }
};

export const getAllUsers = async (): Promise<User[]> => {
    await delay(300);
    const usersStr = localStorage.getItem(STORAGE_KEY_USERS);
    return usersStr ? JSON.parse(usersStr) : [];
};

export const addUser = async (user: User): Promise<void> => {
    await delay(300);
    const users = JSON.parse(localStorage.getItem(STORAGE_KEY_USERS) || '[]');
    if (users.find((u: User) => u.username === user.username)) throw new Error("用户已存在");
    users.push({ ...user, lastLogin: '从未登录' });
    localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(users));
};

export const deleteUser = async (username: string): Promise<void> => {
    await delay(300);
    if(username === 'admin') throw new Error("无法删除超级管理员");
    let users = JSON.parse(localStorage.getItem(STORAGE_KEY_USERS) || '[]');
    users = users.filter((u: User) => u.username !== username);
    localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(users));
};