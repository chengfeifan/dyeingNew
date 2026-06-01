from __future__ import annotations
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pathlib import Path
import io, zipfile, json
from datetime import datetime
import numpy as np
import pandas as pd

from schemas import (
    SavePayload, HistoryItem, HistoryUpdatePayload,
    UserLogin, UserCreate, UserPublic, ConcentrationRequest,
    ConcentrationAnalysisRequest, ConcentrationAnalysisResponse,
    PcaLibraryRequest, PcaRealtimeProjectRequest
)
from core import (
    read_spc_first_xy, read_spectrum_first_xy, interp_to, compute_corrected,
    poly_smooth, build_export_columns, ndarray_to_list_dict,
    solve_non_negative_least_squares, estimate_by_lambda_equations,
    estimate_by_peak_area, ratio_derivative_feature,
    apply_wavelength_range, pca_fit, pca_transform
)
from storage import (
    save_json, list_history, load_json, rename_history,
    update_history_meta, delete_history, authenticate_user,
    list_users, create_user, delete_user, replace_history_data, count_history_rows, iter_history_rows
)

app = FastAPI(title="Spectra Processor API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/process")
async def process_spectra(
    sample: UploadFile = File(...),
    water: UploadFile = File(...),
    dark: UploadFile = File(...),
    out_corr: bool = Form(True),
    out_T: bool = Form(True),
    out_A: bool = Form(True),
    smooth_enabled: bool = Form(False, alias="enableSmoothing"),
    smooth_window: int = Form(11, alias="smoothWindow"),
    smooth_order: int = Form(3, alias="smoothOrder"),
    range_min_nm: float = Form(380.0, alias="rangeMinNm"),
    range_max_nm: float = Form(780.0, alias="rangeMaxNm"),
):
    try:
        tmp_dir = Path("./_tmp"); tmp_dir.mkdir(exist_ok=True)
        async def to_path(up: UploadFile) -> Path:
            p = tmp_dir / up.filename
            with open(p, "wb") as f:
                f.write(await up.read())
            return p

        p_s = await to_path(sample)
        p_w = await to_path(water)
        p_d = await to_path(dark)

        x_s, y_s = read_spectrum_first_xy(p_s)
        x_w, y_w = read_spectrum_first_xy(p_w)
        x_d, y_d = read_spectrum_first_xy(p_d)

        y_wi = interp_to(x_w, y_w, x_s)
        y_di = interp_to(x_d, y_d, x_s)
        I_corr, T, A = compute_corrected(y_s, y_wi, y_di)

        if smooth_enabled:
            if out_corr:
                I_corr = poly_smooth(I_corr, window=smooth_window, order=smooth_order)
            if out_T:
                T = poly_smooth(T, window=smooth_window, order=smooth_order)
            if out_A:
                A = poly_smooth(A, window=smooth_window, order=smooth_order)

        x_s, I_corr, T, A = apply_wavelength_range(
            x_s, I_corr, T, A, min_nm=range_min_nm, max_nm=range_max_nm
        )
        cols = build_export_columns(x_s, I_corr, T, A, out_corr, out_T, out_A)
        meta = {
            "name": Path(sample.filename).stem,
            "timestamp": pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S"),
            "smooth_enabled": smooth_enabled,
            "smooth_window": smooth_window,
            "smooth_order": smooth_order,
            "range_min_nm": range_min_nm,
            "range_max_nm": range_max_nm,
            "files": {
                "sample": sample.filename,
                "water": water.filename,
                "dark": dark.filename
            }
        }
        return {"data": ndarray_to_list_dict(cols), "meta": meta}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/history/{name}/reprocess")
async def reprocess_history_item(
    name: str,
    sample: UploadFile = File(...),
    water: UploadFile = File(...),
    dark: UploadFile = File(...),
    smooth_enabled: bool = Form(False, alias="enableSmoothing"),
    smooth_window: int = Form(11, alias="smoothWindow"),
    smooth_order: int = Form(3, alias="smoothOrder"),
    range_min_nm: float = Form(380.0, alias="rangeMinNm"),
    range_max_nm: float = Form(780.0, alias="rangeMaxNm"),
):
    try:
        tmp_dir = Path("./_tmp"); tmp_dir.mkdir(exist_ok=True)
        async def to_path(up: UploadFile) -> Path:
            p = tmp_dir / up.filename
            with open(p, "wb") as f:
                f.write(await up.read())
            return p
        p_s = await to_path(sample)
        p_w = await to_path(water)
        p_d = await to_path(dark)
        x_s, y_s = read_spectrum_first_xy(p_s)
        x_w, y_w = read_spectrum_first_xy(p_w)
        x_d, y_d = read_spectrum_first_xy(p_d)
        y_wi = interp_to(x_w, y_w, x_s)
        y_di = interp_to(x_d, y_d, x_s)
        I_corr, T, A = compute_corrected(y_s, y_wi, y_di)
        if smooth_enabled:
            I_corr = poly_smooth(I_corr, window=smooth_window, order=smooth_order)
            T = poly_smooth(T, window=smooth_window, order=smooth_order)
            A = poly_smooth(A, window=smooth_window, order=smooth_order)
        x_s, I_corr, T, A = apply_wavelength_range(
            x_s, I_corr, T, A, min_nm=range_min_nm, max_nm=range_max_nm
        )
        data = ndarray_to_list_dict(build_export_columns(x_s, I_corr, T, A, True, True, True))
        meta = {
            "smooth_enabled": smooth_enabled,
            "smooth_window": smooth_window,
            "smooth_order": smooth_order,
            "range_min_nm": range_min_nm,
            "range_max_nm": range_max_nm,
            "files": {"sample": sample.filename, "water": water.filename, "dark": dark.filename}
        }
        replace_history_data(name, data, meta)
        return load_json(name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/save")
async def save_result(payload: SavePayload):
    try:
        out = save_json(payload.name, payload.data, payload.meta)
        return {"ok": True, "name": out["name"], "timestamp": out["timestamp"], "id": out.get("id")}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/history", response_model=list[HistoryItem])
async def history():
    return list_history()

@app.get("/history/{name}")
async def history_item(name: str):
    try:
        return load_json(name)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.patch("/history/{name}")
async def update_history(name: str, payload: HistoryUpdatePayload):
    try:
        target = payload.target_name
        final_name = name
        if target and target != name:
            rename_history(name, target)
            final_name = target
        updates = {}
        if payload.concentration is not None:
            updates["concentration"] = payload.concentration
        if payload.save_type is not None:
            updates["save_type"] = payload.save_type
        if payload.order_no is not None:
            updates["order_no"] = payload.order_no
        if updates:
            update_history_meta(final_name, updates)
        return load_json(final_name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/history/{name}")
async def delete_history_item(name: str):
    try:
        delete_history(name)
        return {"ok": True}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/history/{name}/csv")
async def history_item_csv(name: str):
    obj = load_json(name)
    data = obj.get("data", {})
    if not data:
        raise HTTPException(status_code=400, detail="无数据")
    df = pd.DataFrame(data)
    buff = io.StringIO()
    df.to_csv(buff, index=False)
    buff.seek(0)
    return StreamingResponse(iter([buff.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f"attachment; filename={name}.csv"})


@app.get("/export/history-json")
async def export_history_json():
    now = datetime.now()
    exported_at = now.strftime("%Y-%m-%d %H:%M:%S")
    filename = f"history{now.strftime('%Y-%m-%d')}.json"

    def iter_json():
        yield (
            '{'
            f'"table":{json.dumps("history", ensure_ascii=False)},'
            f'"exported_at":{json.dumps(exported_at, ensure_ascii=False)},'
            f'"count":{count_history_rows()},'
            '"rows":['
        )
        first = True
        for row in iter_history_rows():
            if not first:
                yield ','
            yield json.dumps(row, ensure_ascii=False, separators=(",", ":"))
            first = False
        yield ']}\n'

    return StreamingResponse(
        iter_json(),
        media_type="application/json",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
        },
    )

@app.get("/export/batch")
async def export_batch_zip():
    histories = list_history()
    if not histories:
        return JSONResponse({"ok": False, "message": "历史目录暂无数据"}, status_code=404)

    mem = io.BytesIO()
    with zipfile.ZipFile(mem, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        used_names: dict[str, int] = {}
        for item in histories:
            try:
                obj = load_json(item["name"])
                data = obj.get("data", {})
                if data:
                    df = pd.DataFrame(data)
                    csv_bytes = df.to_csv(index=False).encode("utf-8")
                    preferred_name = str(obj.get("meta", {}).get("name") or item.get("name") or "spectrum").strip()
                    safe_name = "".join(ch for ch in preferred_name if ch not in '<>:"/\\|?*').strip() or "spectrum"
                    seq = used_names.get(safe_name, 0)
                    used_names[safe_name] = seq + 1
                    export_name = safe_name if seq == 0 else f"{safe_name}_{seq + 1}"
                    zf.writestr(f"{export_name}.csv", csv_bytes)
            except Exception:
                pass
    mem.seek(0)
    return StreamingResponse(mem, media_type="application/zip",
                             headers={"Content-Disposition": "attachment; filename=histories.zip"})

@app.post("/analysis/concentration")
async def analyze_concentration(payload: ConcentrationRequest):
    try:
        sample_obj = load_json(payload.sample)
        standard_objs = [load_json(name) for name in payload.standards]
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    try:
        sample_data = sample_obj.get("data", {})
        sample_lambda = np.asarray(sample_data.get("lambda"), dtype=float)
        sample_A = np.asarray(sample_data.get("A"), dtype=float)
        if sample_lambda.size == 0 or sample_A.size == 0 or sample_A.ndim != 1:
            raise ValueError("样品缺少A光谱数据")
        sample_lambda, sample_A = apply_wavelength_range(
            sample_lambda,
            sample_A,
            min_nm=payload.range_min_nm,
            max_nm=payload.range_max_nm
        )
        standards_A = []
        for obj in standard_objs:
            std_lambda = np.asarray(obj.get("data", {}).get("lambda"), dtype=float)
            arr = np.asarray(obj.get("data", {}).get("A"), dtype=float)
            if std_lambda.size == 0:
                raise ValueError("标准样缺少波长轴数据")
            _, arr = apply_wavelength_range(
                std_lambda,
                arr,
                min_nm=payload.range_min_nm,
                max_nm=payload.range_max_nm
            )
            if arr.shape != sample_A.shape:
                raise ValueError("标准样与样品的光谱长度不一致")
            standards_A.append(arr)
        matrix = np.column_stack(standards_A)
        coeffs, fitted, rmse, residual_norm = solve_non_negative_least_squares(matrix, sample_A)
        total = float(np.sum(coeffs))
        components = []
        for coef, std_obj, name in zip(coeffs, standard_objs, payload.standards):
            meta_name = std_obj.get("meta", {}).get("name") or name
            contribution = float((coef / total) * 100) if total > 0 else 0.0
            components.append({
                "name": meta_name,
                "concentration": float(coef),
                "contribution": contribution
            })
        residual = sample_A - fitted
        return {
            "components": components,
            "metrics": {"rmse": rmse, "residual_norm": residual_norm},
            "chart_data": {
                "lambda": sample_lambda.tolist(),
                "original": sample_A.tolist(),
                "fitted": fitted.tolist(),
                "residual": residual.tolist()
            }
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/analysis/concentration-methods", response_model=ConcentrationAnalysisResponse)
async def analyze_concentration_methods(payload: ConcentrationAnalysisRequest):
    try:
        wavelength = np.asarray(payload.sample.wavelength_nm, dtype=float)
        absorbance = np.asarray(payload.sample.absorbance, dtype=float)
        if wavelength.size == 0 or absorbance.size == 0:
            raise ValueError("光谱数据不能为空")
        wavelength, absorbance = apply_wavelength_range(
            wavelength,
            absorbance,
            min_nm=payload.range_min_nm,
            max_nm=payload.range_max_nm
        )
        method = payload.method
        concentrations = {}
        features = {}

        if method == "lambda_equations":
            if payload.calibration is None:
                raise ValueError("缺少矩阵标定数据")
            K = np.asarray(payload.calibration.K, dtype=float)
            b = np.asarray(payload.calibration.b, dtype=float)
            if payload.lambda_points:
                feature_nms = payload.lambda_points
            else:
                feature_nms = [
                    f.nm for f in payload.calibration.feature_defs
                    if f.kind == "wavelength" and f.nm is not None
                ]
            if not feature_nms:
                raise ValueError("缺少波长特征点")
            coeffs = estimate_by_lambda_equations(wavelength, absorbance, K, b, feature_nms)
            concentrations = {
                name: float(coef)
                for name, coef in zip(payload.calibration.component_names, coeffs)
            }
            features = {"lambda_points": feature_nms}

        elif method == "peak_area":
            if payload.calibration is None:
                raise ValueError("缺少矩阵标定数据")
            K = np.asarray(payload.calibration.K, dtype=float)
            b = np.asarray(payload.calibration.b, dtype=float)
            if payload.area_intervals:
                intervals = [(item[0], item[1]) for item in payload.area_intervals]
            else:
                intervals = [
                    (f.nm_left, f.nm_right) for f in payload.calibration.feature_defs
                    if f.kind == "area_interval" and f.nm_left is not None and f.nm_right is not None
                ]
            if not intervals:
                raise ValueError("缺少峰面积积分区间")
            coeffs = estimate_by_peak_area(wavelength, absorbance, K, b, intervals)
            concentrations = {
                name: float(coef)
                for name, coef in zip(payload.calibration.component_names, coeffs)
            }
            features = {"area_intervals": intervals}

        elif method == "ratio_derivative_2c":
            if payload.divisor_reference is None:
                raise ValueError("缺少除数参考谱")
            if not payload.ratio_methods:
                raise ValueError("缺少比值导数标定配置")
            divisor_wl = np.asarray(payload.divisor_reference.wavelength_nm, dtype=float)
            divisor_abs = np.asarray(payload.divisor_reference.absorbance, dtype=float)
            divisor_wl, divisor_abs = apply_wavelength_range(
                divisor_wl,
                divisor_abs,
                min_nm=payload.range_min_nm,
                max_nm=payload.range_max_nm
            )
            if divisor_abs.shape != absorbance.shape or divisor_wl.shape != wavelength.shape:
                raise ValueError("除数参考谱与样品谱长度不一致")
            for item in payload.ratio_methods:
                if item.lambda_nm is None:
                    raise ValueError("比值导数缺少计算波长")
                y_val = ratio_derivative_feature(wavelength, absorbance, divisor_abs, item.lambda_nm)
                if item.calib.k == 0:
                    raise ValueError("标定斜率不能为0")
                concentration = max((y_val - item.calib.b) / item.calib.k, 0.0)
                concentrations[item.component] = float(concentration)
                features[item.component] = {
                    "lambda_nm": item.lambda_nm,
                    "divisor_component": item.divisor_component or payload.divisor_component
                }

        elif method == "zero_cross_ratio_derivative_3c":
            if payload.divisor_reference is None:
                raise ValueError("缺少除数参考谱")
            if not payload.zero_cross_methods:
                raise ValueError("缺少零交点标定配置")
            divisor_wl = np.asarray(payload.divisor_reference.wavelength_nm, dtype=float)
            divisor_abs = np.asarray(payload.divisor_reference.absorbance, dtype=float)
            divisor_wl, divisor_abs = apply_wavelength_range(
                divisor_wl,
                divisor_abs,
                min_nm=payload.range_min_nm,
                max_nm=payload.range_max_nm
            )
            if divisor_abs.shape != absorbance.shape or divisor_wl.shape != wavelength.shape:
                raise ValueError("除数参考谱与样品谱长度不一致")
            for item in payload.zero_cross_methods:
                if item.lambda_nm is None:
                    raise ValueError("零交点法缺少计算波长")
                y_val = ratio_derivative_feature(wavelength, absorbance, divisor_abs, item.lambda_nm)
                if item.calib.k == 0:
                    raise ValueError("标定斜率不能为0")
                concentration = max((y_val - item.calib.b) / item.calib.k, 0.0)
                concentrations[item.component] = float(concentration)
                features[item.component] = {
                    "lambda_nm": item.lambda_nm,
                    "divisor_component": item.divisor_component or payload.divisor_component
                }
        else:
            raise ValueError("未知的浓度分析方法")

        return ConcentrationAnalysisResponse(
            method=method,
            concentrations=concentrations,
            features=features
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/analysis/pca/library")
async def analyze_pca_library(payload: PcaLibraryRequest):
    try:
        target_map = {
            "i_corr": "I_corr",
            "transmittance": "T",
            "absorbance": "A",
            "I_corr": "I_corr",
            "T": "T",
            "A": "A",
        }
        target_key = target_map.get(payload.analysis_target, payload.analysis_target)
        if target_key not in {"I_corr", "T", "A"}:
            raise ValueError("analysis_target 仅支持 I_corr/transmittance/Absorbance")
        all_history = list_history()
        standard_items = [item for item in all_history if item.get("meta", {}).get("save_type") == "standard"]
        names = payload.standard_names or [item["name"] for item in standard_items]
        if not names:
            raise ValueError("标准库为空，无法进行 PCA 分析")
        spectra = []
        labels = []
        wavelength_base = None
        for name in names:
            obj = load_json(name)
            data = obj.get("data", {})
            wavelength = np.asarray(data.get("lambda"), dtype=float)
            spectrum = np.asarray(data.get(target_key), dtype=float)
            if wavelength.size == 0 or spectrum.size == 0:
                continue
            if wavelength_base is None:
                wavelength_base = wavelength
                spectra.append(spectrum)
            else:
                spectra.append(interp_to(wavelength, spectrum, wavelength_base))
            labels.append(obj.get("meta", {}).get("name") or name)
        if wavelength_base is None or len(spectra) < 2:
            raise ValueError("可用标准谱不足，至少需要 2 条")
        matrix = np.vstack(spectra)
        pca_result = pca_fit(matrix, n_components=payload.n_components)
        scores = pca_result["scores"]
        points = [
            {"label": label, "pc1": float(scores[i, 0]), "pc2": float(scores[i, 1] if scores.shape[1] > 1 else 0.0)}
            for i, label in enumerate(labels)
        ]
        return {
            "points": points,
            "explained_variance_ratio": pca_result["explained_variance_ratio"].tolist(),
            "analysis_target": target_key,
            "model": {
                "wavelength_nm": wavelength_base.tolist(),
                "mean": pca_result["mean"].tolist(),
                "components": pca_result["components"].tolist(),
            }
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/analysis/pca/realtime")
async def project_realtime_pca(payload: PcaRealtimeProjectRequest):
    try:
        model_wl = np.asarray(payload.model.wavelength_nm, dtype=float)
        if model_wl.size == 0:
            raise ValueError("PCA 模型缺少波长轴")
        source_wl = np.asarray(payload.wavelength_nm, dtype=float)
        if source_wl.size == 0:
            raise ValueError("实时光谱缺少波长轴")
        rows = []
        labels = []
        for series in payload.realtime_series:
            absorbance = np.asarray(series.absorbance, dtype=float)
            if absorbance.shape[0] != source_wl.shape[0]:
                raise ValueError(f"实时光谱 {series.label} 与波长长度不一致")
            rows.append(interp_to(source_wl, absorbance, model_wl))
            labels.append(series.label)
        if not rows:
            raise ValueError("未提供实时光谱数据")
        projected = pca_transform(np.vstack(rows), np.asarray(payload.model.mean), np.asarray(payload.model.components))
        path = [
            {"label": labels[i], "pc1": float(projected[i, 0]), "pc2": float(projected[i, 1] if projected.shape[1] > 1 else 0.0)}
            for i in range(len(labels))
        ]
        return {"path": path}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/analysis/spc/reference")
async def parse_reference_spc(file: UploadFile = File(...)):
    try:
        tmp_dir = Path("./_tmp"); tmp_dir.mkdir(exist_ok=True)
        file_path = tmp_dir / file.filename
        with open(file_path, "wb") as f:
            f.write(await file.read())
        wavelength, intensity = read_spc_first_xy(file_path)
        if wavelength.size == 0 or intensity.size == 0:
            raise ValueError("SPC 文件为空")
        return {
            "wavelength_nm": wavelength.tolist(),
            "intensity": intensity.tolist(),
            "filename": file.filename
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/auth/login", response_model=UserPublic)
async def login(payload: UserLogin):
    try:
        return authenticate_user(payload.username, payload.password)
    except PermissionError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/auth/users", response_model=list[UserPublic])
async def get_users():
    return list_users()

@app.post("/auth/users", response_model=UserPublic)
async def add_user(payload: UserCreate):
    try:
        return create_user(payload.username, payload.password, payload.role)
    except FileExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/auth/users/{username}")
async def remove_user(username: str):
    try:
        delete_user(username)
        return {"ok": True}
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
