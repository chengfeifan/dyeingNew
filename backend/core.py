from __future__ import annotations
from pathlib import Path
from typing import Tuple, Dict, Any, Iterable, List
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

def solve_non_negative_least_squares(
    standards_matrix: np.ndarray, sample: np.ndarray
) -> Tuple[np.ndarray, np.ndarray, float, float]:
    """
    Solve a simple non-negative least squares problem using numpy.linalg.lstsq
    followed by clipping to enforce non-negativity.
    """
    if standards_matrix.ndim != 2:
        raise ValueError("标准样数据矩阵必须是二维的")
    if standards_matrix.shape[0] != sample.shape[0]:
        raise ValueError("标准样与样品的光谱长度不一致")
    coeffs, _, _, _ = np.linalg.lstsq(standards_matrix, sample, rcond=None)
    coeffs = np.clip(coeffs, 0, None)
    fitted = standards_matrix @ coeffs
    residual = sample - fitted
    rmse = float(np.sqrt(np.mean(residual ** 2)))
    residual_norm = float(np.linalg.norm(residual))
    return coeffs, fitted, rmse, residual_norm

def ensure_sorted_spectrum(
    wavelength: np.ndarray, absorbance: np.ndarray
) -> Tuple[np.ndarray, np.ndarray]:
    if wavelength.ndim != 1 or absorbance.ndim != 1:
        raise ValueError("光谱数组必须是一维")
    if wavelength.shape[0] != absorbance.shape[0]:
        raise ValueError("波长与吸光度长度不一致")
    if np.all(np.diff(wavelength) > 0):
        return wavelength, absorbance
    if np.all(np.diff(wavelength) < 0):
        return wavelength[::-1], absorbance[::-1]
    idx = np.argsort(wavelength)
    return wavelength[idx], absorbance[idx]

def interp_absorbance(
    wavelength: np.ndarray, absorbance: np.ndarray, nm: float
) -> float:
    wavelength, absorbance = ensure_sorted_spectrum(wavelength, absorbance)
    return float(np.interp(nm, wavelength, absorbance))

def integrate_trapezoid(
    wavelength: np.ndarray,
    absorbance: np.ndarray,
    nm_left: float,
    nm_right: float
) -> float:
    if nm_right <= nm_left:
        raise ValueError("积分区间右端必须大于左端")
    wavelength, absorbance = ensure_sorted_spectrum(wavelength, absorbance)
    left = max(nm_left, float(wavelength[0]))
    right = min(nm_right, float(wavelength[-1]))
    if right <= left:
        return 0.0
    mask = (wavelength > left) & (wavelength < right)
    wl_segment = np.concatenate(([left], wavelength[mask], [right]))
    abs_left = np.interp(left, wavelength, absorbance)
    abs_right = np.interp(right, wavelength, absorbance)
    abs_segment = np.concatenate(([abs_left], absorbance[mask], [abs_right]))
    return float(np.trapz(abs_segment, wl_segment))

def derivative_central(wavelength: np.ndarray, values: np.ndarray) -> np.ndarray:
    wavelength, values = ensure_sorted_spectrum(wavelength, values)
    return np.gradient(values, wavelength)

def solve_linear_or_lstsq(K: np.ndarray, rhs: np.ndarray) -> np.ndarray:
    K = np.asarray(K, dtype=float)
    rhs = np.asarray(rhs, dtype=float)
    if K.ndim != 2:
        raise ValueError("K 必须是二维矩阵")
    if rhs.ndim != 1 or rhs.shape[0] != K.shape[0]:
        raise ValueError("rhs 维度与 K 不匹配")
    coeffs, _, _, _ = np.linalg.lstsq(K, rhs, rcond=None)
    return coeffs

def clip_negative_to_zero(values: Iterable[float]) -> List[float]:
    return [float(v) if v > 0 else 0.0 for v in values]

def estimate_by_lambda_equations(
    wavelength: np.ndarray,
    absorbance: np.ndarray,
    K: np.ndarray,
    b: np.ndarray,
    feature_nms: Iterable[float]
) -> List[float]:
    y = [interp_absorbance(wavelength, absorbance, nm) for nm in feature_nms]
    b_total = np.sum(b, axis=1)
    rhs = np.asarray(y, dtype=float) - b_total
    coeffs = solve_linear_or_lstsq(K, rhs)
    return clip_negative_to_zero(coeffs)

def estimate_by_peak_area(
    wavelength: np.ndarray,
    absorbance: np.ndarray,
    K: np.ndarray,
    b: np.ndarray,
    feature_intervals: Iterable[Tuple[float, float]]
) -> List[float]:
    y = [
        integrate_trapezoid(wavelength, absorbance, left, right)
        for left, right in feature_intervals
    ]
    b_total = np.sum(b, axis=1)
    rhs = np.asarray(y, dtype=float) - b_total
    coeffs = solve_linear_or_lstsq(K, rhs)
    return clip_negative_to_zero(coeffs)

def ratio_derivative_feature(
    wavelength: np.ndarray,
    absorbance: np.ndarray,
    divisor_absorbance: np.ndarray,
    nm: float
) -> float:
    wavelength, absorbance = ensure_sorted_spectrum(wavelength, absorbance)
    _, divisor_absorbance = ensure_sorted_spectrum(wavelength, divisor_absorbance)
    ratio = absorbance / np.maximum(divisor_absorbance, EPS)
    derivative = derivative_central(wavelength, ratio)
    return float(np.interp(nm, wavelength, derivative))
