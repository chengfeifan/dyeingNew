from __future__ import annotations
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class ProcessOptions(BaseModel):
    out_corr: bool = True
    out_T: bool = True
    out_A: bool = True
    smooth_enabled: bool = False
    smooth_window: int = 11
    smooth_order: int = 3

class SavePayload(BaseModel):
    name: str = Field(..., description="保存名称（文件名不含扩展名）")
    data: Dict[str, List[float]]
    meta: Dict[str, Any] = {}

class HistoryItem(BaseModel):
    name: str
    filename: str
    file: Optional[str] = None
    timestamp: str
    meta: Optional[Dict[str, Any]] = None


class HistoryRename(BaseModel):
    new_name: str = Field(..., description="新的保存名称")


class User(BaseModel):
    username: str
    role: str
    lastLogin: str = ""


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    user: User


class UserCreateRequest(BaseModel):
    username: str
    password: str
    role: str = "user"


class UserUpdateRequest(BaseModel):
    password: Optional[str] = None
    role: Optional[str] = None


class ComponentSpectrum(BaseModel):
    name: str
    spectrum: List[float]


class ConcentrationRequest(BaseModel):
    wavelength: List[float] = []
    sample: List[float]
    references: List[ComponentSpectrum]


class ComponentResult(BaseModel):
    name: str
    concentration: float
    contribution: float


class ConcentrationResult(BaseModel):
    components: List[ComponentResult]
    metrics: Dict[str, float]
    chart_data: Dict[str, List[float]]


class FabricParams(BaseModel):
    fabricType: str
    weight: float
    liquorRatio: float
    exhaustionRate: float


class ColorResult(BaseModel):
    rgb: str
    lab: Dict[str, float]
    xyz: Dict[str, float]


class PredictionRequest(BaseModel):
    fabric: FabricParams
    wavelength: List[float] = []
    absorbance: List[float] = []
    shade: Optional[str] = None


class PredictionResult(BaseModel):
    color: ColorResult
    curve: Dict[str, List[float]]
    message: str = ""
