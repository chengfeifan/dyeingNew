from __future__ import annotations
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pathlib import Path
import io, zipfile
import numpy as np
import pandas as pd

from schemas import (
    SavePayload, HistoryItem, HistoryUpdatePayload,
    UserLogin, UserCreate, UserPublic, ConcentrationRequest
)
from core import (
    read_spc_first_xy, interp_to, compute_corrected,
    poly_smooth, build_export_columns, ndarray_to_list_dict,
    solve_non_negative_least_squares
)
from storage import (
    save_json, list_history, load_json, rename_history,
    update_history_meta, delete_history, authenticate_user,
    list_users, create_user, delete_user
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

        x_s, y_s = read_spc_first_xy(p_s)
        x_w, y_w = read_spc_first_xy(p_w)
        x_d, y_d = read_spc_first_xy(p_d)

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

        cols = build_export_columns(x_s, I_corr, T, A, out_corr, out_T, out_A)
        meta = {
            "name": sample.filename.replace(".spc", ""),
            "timestamp": pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S"),
            "smooth_enabled": smooth_enabled,
            "smooth_window": smooth_window,
            "smooth_order": smooth_order,
            "files": {
                "sample": sample.filename,
                "water": water.filename,
                "dark": dark.filename
            }
        }
        return {"data": ndarray_to_list_dict(cols), "meta": meta}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/save")
async def save_result(payload: SavePayload):
    try:
        out = save_json(payload.name, payload.data, payload.meta)
        return {"ok": True, "name": out["name"], "timestamp": out["timestamp"]}
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

@app.get("/export/batch")
async def export_batch_zip():
    histories = list_history()
    if not histories:
        return JSONResponse({"ok": False, "message": "历史目录暂无数据"}, status_code=404)

    mem = io.BytesIO()
    with zipfile.ZipFile(mem, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for item in histories:
            try:
                obj = load_json(item["name"])
                data = obj.get("data", {})
                if data:
                    df = pd.DataFrame(data)
                    csv_bytes = df.to_csv(index=False).encode("utf-8")
                    zf.writestr(f"{item['name']}.csv", csv_bytes)
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
        sample_A = np.asarray(sample_data.get("A"), dtype=float)
        if sample_A.size == 0 or sample_A.ndim != 1:
            raise ValueError("样品缺少A光谱数据")
        standards_A = []
        for obj in standard_objs:
            arr = np.asarray(obj.get("data", {}).get("A"), dtype=float)
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
                "lambda": sample_data.get("lambda"),
                "original": sample_A.tolist(),
                "fitted": fitted.tolist(),
                "residual": residual.tolist()
            }
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
