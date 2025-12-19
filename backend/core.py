from __future__ import annotations
from pathlib import Path
from typing import Tuple, Dict, Any
import numpy as np
import json

try:
    import spc_io
except Exception:  # 允许在无 spc-io 的 CI 场景下导入模块
    spc_io = None

EPS = 1e-6

def read_spc_first_xy(path: Path) -> Tuple[np.ndarray, np.ndarray]:
    assert spc_io is not None, "未安装 spc-io，请先 pip install spc-io"
    with open(path, "br") as f:
        spc = spc_io.SPC.from_bytes_io(f)
    if len(spc) == 0:
        raise ValueError(f"SPC 中无子谱: {path}")
    sub = spc[0]
    x = np.asarray(sub.xarray, dtype=float)
    y = np.asarray(sub.yarray, dtype=float)
    return x, y

def interp_to(x_src: np.ndarray, y_src: np.ndarray, x_tgt: np.ndarray) -> np.ndarray:
    if not (np.all(np.diff(x_src) > 0) or np.all(np.diff(x_src) < 0)):
        idx = np.argsort(x_src)
        x_src = x_src[idx]
        y_src = y_src[idx]
    return np.interp(x_tgt, x_src, y_src)

def compute_corrected(sample: np.ndarray, water: np.ndarray, dark: np.ndarray,
                      eps: float = EPS) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    I_corr = sample - dark
    denom = water - dark
    denom = np.where(np.abs(denom) < eps, np.sign(denom) * eps + eps, denom)
    T = I_corr / denom
    T = np.clip(T, eps, 1.0)
    A = -np.log10(T)
    return I_corr, T, A

def poly_smooth(y: np.ndarray, window: int = 11, order: int = 3) -> np.ndarray:
    y = np.asarray(y, dtype=float)
    n = len(y)
    if n == 0 or window < 3:
        return y.copy()
    if window % 2 == 0:
        window += 1
    half = window // 2
    x_all = np.arange(n, dtype=float)
    ys = np.zeros_like(y, dtype=float)

    for i in range(n):
        left = max(0, i - half)
        right = min(n, i + half + 1)
        xi = x_all[left:right] - x_all[i]
        yi = y[left:right]
        deg = min(order, len(xi) - 1)
        if deg <= 0:
            ys[i] = yi.mean()
            continue
        try:
            coeffs = np.polyfit(xi, yi, deg)
            ys[i] = np.polyval(coeffs, 0.0)
        except Exception:
            ys[i] = yi.mean()
    return ys

def build_export_columns(x, I_corr, T, A, out_corr=True, out_T=True, out_A=True) -> Dict[str, Any]:
    cols = {"lambda": x}
    if out_corr:
        cols["I_corr"] = I_corr
    if out_T:
        cols["T"] = T
    if out_A:
        cols["A"] = A
    if len(cols) == 1:  # 至少导出 A
        cols["A"] = A
    return cols

def ndarray_to_list_dict(d: Dict[str, np.ndarray]) -> Dict[str, list]:
    return {k: np.asarray(v, dtype=float).tolist() for k, v in d.items()}

def json_dumps(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2)
