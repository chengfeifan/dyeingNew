from __future__ import annotations
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pathlib import Path
import io, zipfile
import numpy as np
import pandas as pd

from .schemas import ProcessOptions, SavePayload, HistoryItem
from .core import (
    read_spc_first_xy, interp_to, compute_corrected,
    poly_smooth, build_export_columns, ndarray_to_list_dict
)
from .storage import save_json, list_history, load_json

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
    smooth_enabled: bool = Form(False),
    smooth_window: int = Form(11),
    smooth_order: int = Form(3),
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
        return {"data": ndarray_to_list_dict(cols), "meta": {"smooth_enabled": smooth_enabled}}
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
