from __future__ import annotations
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Header, Cookie, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pathlib import Path
import io, zipfile
import numpy as np
import pandas as pd
from datetime import datetime

from .schemas import (
    ProcessOptions,
    SavePayload,
    HistoryItem,
    HistoryRename,
    LoginRequest,
    LoginResponse,
    User,
    UserCreateRequest,
    UserUpdateRequest,
    ConcentrationRequest,
    ConcentrationResult,
    PredictionRequest,
    PredictionResult,
)
from .core import (
    read_spc_first_xy, interp_to, compute_corrected,
    poly_smooth, build_export_columns, ndarray_to_list_dict
)
from .storage import save_json, list_history, load_json, rename_history
from . import auth

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

def _extract_token(
    authorization: str = Header(None),
    session_token: str = Cookie(None),
    token: str = Query(None),
) -> str:
    if token:
        return token
    if authorization and authorization.lower().startswith("bearer "):
        return authorization.split(" ", 1)[1]
    if session_token:
        return session_token
    return ""


def _require_user(token: str = Depends(_extract_token)) -> dict:
    sess = auth.get_session(token)
    if not sess:
        raise HTTPException(status_code=401, detail="未登录或会话已过期")
    return {
        "token": token,
        "user": {
            "username": sess["username"],
            "role": sess["role"],
            "lastLogin": sess.get("last_login", ""),
        },
    }


def _require_admin(ctx: dict = Depends(_require_user)) -> dict:
    if ctx["user"]["role"] != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return ctx

@app.post("/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest, response: Response):
    user = auth.validate_credentials(payload.username, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    token, public_user = auth.create_session(user)
    response.set_cookie(
        "session_token",
        token,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24,
    )
    return {"token": token, "user": public_user}


@app.get("/auth/session", response_model=LoginResponse)
def get_session(ctx: dict = Depends(_require_user)):
    return {"token": ctx["token"], "user": ctx["user"]}


@app.post("/auth/logout")
def logout(ctx: dict = Depends(_require_user)):
    auth.drop_session(ctx["token"])
    return {"ok": True}


@app.post("/auth/activity", response_model=LoginResponse)
def update_activity(ctx: dict = Depends(_require_user)):
    sess = auth.touch_session(ctx["token"])
    if not sess:
        raise HTTPException(status_code=401, detail="会话已失效")
    return {"token": ctx["token"], "user": ctx["user"]}


@app.get("/users", response_model=list[User])
def list_users_endpoint(_: dict = Depends(_require_admin)):
    users = auth.list_users()
    return [
        {"username": u["username"], "role": u["role"], "lastLogin": u.get("last_login", "")}
        for u in users
    ]


@app.post("/users", response_model=User)
def create_user_endpoint(payload: UserCreateRequest, _: dict = Depends(_require_admin)):
    try:
        u = auth.create_user(payload.username, payload.password, payload.role)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"username": u["username"], "role": u["role"], "lastLogin": u.get("last_login", "")}


@app.patch("/users/{username}", response_model=User)
def update_user_endpoint(username: str, payload: UserUpdateRequest, _: dict = Depends(_require_admin)):
    try:
        u = auth.update_user(username, password=payload.password, role=payload.role)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"username": u["username"], "role": u["role"], "lastLogin": u.get("last_login", "")}


@app.delete("/users/{username}")
def delete_user_endpoint(username: str, _: dict = Depends(_require_admin)):
    auth.delete_user(username)
    return {"ok": True}
@app.post("/process")
async def process_spectra(
    sample: UploadFile = File(...),
    water: UploadFile = File(...),
    dark: UploadFile = File(...),
    name: str = Form(None),
    out_corr: bool = Form(True),
    out_T: bool = Form(True),
    out_A: bool = Form(True),
    smooth_enabled: bool = Form(False),
    smooth_window: int = Form(11),
    smooth_order: int = Form(3),
    _: dict = Depends(_require_user),
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
            "name": name or Path(sample.filename).stem,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "smooth_enabled": smooth_enabled,
            "smooth_window": smooth_window,
            "smooth_order": smooth_order,
            "files": {
                "sample": sample.filename,
                "water": water.filename,
                "dark": dark.filename,
            },
        }
        return {"data": ndarray_to_list_dict(cols), "meta": meta}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/save")
async def save_result(payload: SavePayload, _: dict = Depends(_require_user)):
    try:
        meta = dict(payload.meta or {})
        meta.setdefault("timestamp", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        meta.setdefault("name", payload.name)
        out = save_json(payload.name, payload.data, meta)
        return {"ok": True, "name": out["name"], "timestamp": out["timestamp"]}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/history", response_model=list[HistoryItem])
async def history(_: dict = Depends(_require_user)):
    return list_history()

@app.get("/history/{name}")
async def history_item(name: str, _: dict = Depends(_require_user)):
    try:
        return load_json(name)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.patch("/history/{name}", response_model=HistoryItem)
async def history_rename(name: str, payload: HistoryRename, _: dict = Depends(_require_user)):
    try:
        renamed = rename_history(name, payload.new_name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="记录不存在")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "name": renamed["name"],
        "file": renamed.get("filename") or f"{renamed['name']}.sqlite",
        "filename": renamed.get("filename") or f"{renamed['name']}.sqlite",
        "timestamp": renamed["timestamp"],
        "meta": {"name": renamed["name"]},
    }

@app.get("/history/{name}/csv")
async def history_item_csv(name: str, _: dict = Depends(_require_user)):
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
async def export_batch_zip(_: dict = Depends(_require_user)):
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


@app.post("/concentration/analyze", response_model=ConcentrationResult)
def concentration_analyze(payload: ConcentrationRequest, _: dict = Depends(_require_user)):
    if not payload.references:
        raise HTTPException(status_code=400, detail="参考谱不能为空")
    sample = np.asarray(payload.sample, dtype=float)
    refs = [np.asarray(r.spectrum, dtype=float) for r in payload.references]
    lengths = {len(sample)} | {len(r) for r in refs}
    if len(lengths) != 1:
        raise HTTPException(status_code=400, detail="样本和参考谱长度不一致")
    A = np.vstack(refs).T
    coeffs, _, _, _ = np.linalg.lstsq(A, sample, rcond=None)
    fitted = A @ coeffs
    residual = sample - fitted
    total = float(np.sum(np.abs(coeffs))) or 1.0
    components = []
    for coef, ref in zip(coeffs, payload.references):
        components.append({
            "name": ref.name,
            "concentration": float(coef),
            "contribution": float(abs(coef)) / total,
        })
    wl = payload.wavelength or list(range(len(sample)))
    metrics = {
        "rmse": float(np.sqrt(np.mean(residual ** 2))),
        "residual_norm": float(np.linalg.norm(residual)),
    }
    chart_data = {
        "lambda": wl,
        "original": sample.tolist(),
        "fitted": fitted.tolist(),
        "residual": residual.tolist(),
    }
    return {"components": components, "metrics": metrics, "chart_data": chart_data}


@app.post("/prediction", response_model=PredictionResult)
def predict_color(payload: PredictionRequest, _: dict = Depends(_require_user)):
    fabric = payload.fabric
    strength = max(0.0, min(1.0, fabric.exhaustionRate / 100))
    weight_factor = min(1.5, fabric.weight / 100.0)
    l_val = max(0.0, 100 - strength * 30 - weight_factor * 5)
    a_val = strength * 10 - 5
    b_val = 15 + strength * 20
    r = int(max(0, min(255, (1 - strength * 0.3) * 255)))
    g = int(max(0, min(255, (1 - strength * 0.5) * 255)))
    b = int(max(0, min(255, (1 - strength * 0.8) * 255)))
    rgb = f"#{r:02x}{g:02x}{b:02x}"

    wavelengths = payload.wavelength or list(range(len(payload.absorbance) or 30))
    base_curve = np.linspace(0.1, 1.0, len(wavelengths))
    if payload.absorbance:
        base_curve = np.asarray(payload.absorbance[: len(wavelengths)], dtype=float)
    predicted_curve = (base_curve * (1 + strength * 0.2)).tolist()

    xyz = {"x": r / 255.0, "y": g / 255.0, "z": b / 255.0}
    color = {
        "rgb": rgb,
        "lab": {"l": l_val, "a": a_val, "b": b_val},
        "xyz": xyz,
    }
    return {
        "color": color,
        "curve": {"lambda": wavelengths, "predicted": predicted_curve, "reference": base_curve.tolist()},
        "message": "模拟预测完成，可根据色差和曲线调整工艺参数。",
    }

# 兼容以 /api 前缀访问的前端代理配置
app.post("/api/process")(process_spectra)
app.post("/api/save")(save_result)
app.get("/api/history")(history)
app.get("/api/history/{name}")(history_item)
app.patch("/api/history/{name}")(history_rename)
app.get("/api/history/{name}/csv")(history_item_csv)
app.get("/api/export/batch")(export_batch_zip)
app.post("/api/auth/login")(login)
app.get("/api/auth/session")(get_session)
app.post("/api/auth/logout")(logout)
app.post("/api/auth/activity")(update_activity)
app.get("/api/users")(list_users_endpoint)
app.post("/api/users")(create_user_endpoint)
app.patch("/api/users/{username}")(update_user_endpoint)
app.delete("/api/users/{username}")(delete_user_endpoint)
app.post("/api/concentration/analyze")(concentration_analyze)
app.post("/api/prediction")(predict_color)
