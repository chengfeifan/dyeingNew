export interface ProcessedData {
  meta: {
    name?: string;
    timestamp: string;
    smooth_enabled: boolean;
    smooth_window?: number;
    smooth_order?: number;
    files: {
        sample: string;
        water: string;
        dark: string;
    };
    save_type?: 'standard' | 'multicomponent';
    concentration?: string;
    [key: string]: any;
  };
  data: {
    lambda: number[];
    I_corr: number[];
    T: number[];
    A: number[];
  };
}

export interface ProcessingParams {
  enableSmoothing: boolean;
  smoothWindow: number;
  smoothOrder: number;
}

export interface HistoryItem {
  filename: string;
  name: string;
  timestamp: string;
  meta?: {
      save_type?: 'standard' | 'multicomponent';
      concentration?: string;
      [key: string]: any;
  }
}

export interface ConcentrationResult {
    components: {
        name: string;
        concentration: number;
        contribution: number;
    }[];
    metrics: {
        rmse: number;
        residual_norm: number;
    };
    chart_data: {
        lambda: number[];
        original: number[];
        fitted: number[];
        residual: number[];
    };
}

export interface FabricParams {
    fabricType: string;
    weight: number; // grams
    liquorRatio: number; // e.g. 1:10 -> 10
    exhaustionRate: number; // 0-100%
}

export interface ColorResult {
    rgb: string; // hex
    lab: { l: number; a: number; b: number };
    xyz: { x: number; y: number; z: number };
}

export interface User {
    username: string;
    role: 'admin' | 'user';
    lastLogin: string;
    password?: string; // Optional for frontend handling
}
