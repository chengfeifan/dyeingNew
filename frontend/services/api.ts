import axios, { AxiosError } from 'axios';
import { ProcessedData, ProcessingParams, HistoryItem, ConcentrationResult, ConcentrationMethodResult, User } from '../types';

const SESSION_KEY = 'spectral_app_session';
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const API_BASE = import.meta.env.VITE_API_BASE || '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 20000,
});

const toProcessedData = (payload: any): ProcessedData => {
  const meta = {
    ...payload?.meta,
    name: payload?.meta?.name || payload?.meta?.files?.sample || '',
  };
  const data = payload?.data || {};
  return {
    meta,
    data: {
      lambda: data.lambda || [],
      I_corr: data.I_corr || [],
      T: data.T || [],
      A: data.A || [],
    },
  };
};

const toHistoryItem = (item: any): HistoryItem => ({
  filename: item.name,
  name: item.meta?.name || item.name,
  timestamp: item.timestamp || '',
  meta: item.meta || {},
});

const normalizeError = (error: unknown): Error => {
  if (axios.isAxiosError(error)) {
    const err = error as AxiosError<{ detail?: string }>;
    const detail = err.response?.data?.detail;
    return new Error(detail || err.message);
  }
  return new Error((error as Error)?.message || '未知错误');
};

export const processSpectra = async (
  files: { sample: File; water: File; dark: File },
  params: ProcessingParams
): Promise<ProcessedData> => {
  try {
    const form = new FormData();
    form.append('sample', files.sample);
    form.append('water', files.water);
    form.append('dark', files.dark);
    form.append('out_corr', 'true');
    form.append('out_T', 'true');
    form.append('out_A', 'true');
    form.append('enableSmoothing', String(params.enableSmoothing));
    form.append('smoothWindow', String(params.smoothWindow));
    form.append('smoothOrder', String(params.smoothOrder));

    const { data } = await api.post('/process', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return toProcessedData(data);
  } catch (error) {
    throw normalizeError(error);
  }
};

export const saveHistory = async (
  name: string,
  data: ProcessedData,
  saveType: 'standard' | 'multicomponent',
  concentration?: string,
  dyeCode?: string
): Promise<void> => {
  try {
    await api.post('/save', {
      name,
      data: data.data,
      meta: {
        ...data.meta,
        name,
        save_type: saveType,
        concentration: concentration ?? data.meta.concentration,
        dye_code: dyeCode ?? data.meta.dye_code,
      },
    });
  } catch (error) {
    throw normalizeError(error);
  }
};

export const fetchHistoryList = async (): Promise<HistoryItem[]> => {
  try {
    const { data } = await api.get('/history');
    return (data as any[]).map(toHistoryItem);
  } catch (error) {
    throw normalizeError(error);
  }
};

export const fetchHistoryItem = async (filename: string): Promise<ProcessedData> => {
  try {
    const { data } = await api.get(`/history/${filename}`);
    return toProcessedData(data);
  } catch (error) {
    throw normalizeError(error);
  }
};

export const renameHistoryItem = async (filename: string, newName: string): Promise<void> => {
  try {
    await api.patch(`/history/${filename}`, { new_name: newName });
  } catch (error) {
    throw normalizeError(error);
  }
};

export const updateHistoryItem = async (
  filename: string,
  update: { name?: string; concentration?: string; save_type?: string }
): Promise<void> => {
  try {
    await api.patch(`/history/${filename}`, {
      new_name: update.name,
      name: update.name,
      concentration: update.concentration,
      save_type: update.save_type,
    });
  } catch (error) {
    throw normalizeError(error);
  }
};

export const deleteHistoryItem = async (filename: string): Promise<void> => {
  try {
    await api.delete(`/history/${filename}`);
  } catch (error) {
    throw normalizeError(error);
  }
};

export const downloadHistoryZip = async (): Promise<Blob> => {
  try {
    const { data } = await api.get('/export/batch', { responseType: 'blob' });
    return data as Blob;
  } catch (error) {
    throw normalizeError(error);
  }
};

export const analyzeConcentration = async (
  sampleFilename: string,
  standardFilenames: string[]
): Promise<ConcentrationResult> => {
  try {
    const { data } = await api.post('/analysis/concentration', {
      sample: sampleFilename,
      standards: standardFilenames,
    });
    return data as ConcentrationResult;
  } catch (error) {
    throw normalizeError(error);
  }
};

export const analyzeConcentrationMethods = async (
  payload: Record<string, any>
): Promise<ConcentrationMethodResult> => {
  try {
    const { data } = await api.post('/analysis/concentration-methods', payload);
    return data as ConcentrationMethodResult;
  } catch (error) {
    throw normalizeError(error);
  }
};

// --- 用户认证服务 ---

export const loginUser = async (username: string, password: string): Promise<User> => {
  try {
    const { data } = await api.post('/auth/login', { username, password });
    const user: User = {
      username: data.username,
      role: data.role,
      lastLogin: data.last_login || data.lastLogin || '',
    };
    const session = { ...user, _lastActivity: Date.now() };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  } catch (error) {
    throw normalizeError(error);
  }
};

export const logoutUser = async (): Promise<void> => {
  localStorage.removeItem(SESSION_KEY);
};

export const getSessionUser = (): User | null => {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  const session = JSON.parse(raw);
  if (session._lastActivity) {
    const now = Date.now();
    if (now - session._lastActivity > SESSION_TIMEOUT) {
      logoutUser();
      return null;
    }
  }
  return session as User;
};

export const updateSessionActivity = (): void => {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return;
  const session = JSON.parse(raw);
  session._lastActivity = Date.now();
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
};

export const getAllUsers = async (): Promise<User[]> => {
  try {
    const { data } = await api.get('/auth/users');
    return (data as any[]).map((u) => ({
      username: u.username,
      role: u.role,
      lastLogin: u.last_login || u.lastLogin || '',
    }));
  } catch (error) {
    throw normalizeError(error);
  }
};

export const addUser = async (user: User): Promise<void> => {
  try {
    await api.post('/auth/users', {
      username: user.username,
      password: user.password,
      role: user.role,
    });
  } catch (error) {
    throw normalizeError(error);
  }
};

export const deleteUser = async (username: string): Promise<void> => {
  try {
    await api.delete(`/auth/users/${username}`);
  } catch (error) {
    throw normalizeError(error);
  }
};
