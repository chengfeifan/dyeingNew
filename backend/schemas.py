from __future__ import annotations
from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any

class SpectrumPayload(BaseModel):
    wavelength_nm: List[float]
    absorbance: List[float]

    @validator("absorbance")
    def _validate_lengths(cls, v: List[float], values: Dict[str, Any]) -> List[float]:
        wavelength = values.get("wavelength_nm")
        if wavelength is not None and len(wavelength) != len(v):
            raise ValueError("wavelength_nm 与 absorbance 长度不一致")
        return v

class LinearCalibPayload(BaseModel):
    k: float
    b: float
    r2: Optional[float] = None

class FeatureDefPayload(BaseModel):
    kind: str = Field(..., description="wavelength/area_interval/ratio_derivative_point/zero_cross_ratio_derivative_point")
    nm: Optional[float] = None
    nm_left: Optional[float] = None
    nm_right: Optional[float] = None
    divisor_component: Optional[str] = None
    target_component: Optional[str] = None

class MatrixCalibPayload(BaseModel):
    component_names: List[str]
    feature_defs: List[FeatureDefPayload]
    K: List[List[float]]
    b: List[List[float]]

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
    file: str
    timestamp: str
    meta: Dict[str, Any] = {}

class HistoryUpdatePayload(BaseModel):
    new_name: Optional[str] = Field(None, description="重命名后的名称")
    name: Optional[str] = Field(None, description="保持兼容的名称字段")
    concentration: Optional[str] = None
    save_type: Optional[str] = None

    @property
    def target_name(self) -> Optional[str]:
        return self.new_name or self.name

class UserLogin(BaseModel):
    username: str
    password: str

class UserCreate(BaseModel):
    username: str
    password: str
    role: str = Field("user", pattern="^(admin|user)$")

class UserPublic(BaseModel):
    username: str
    role: str
    last_login: str = ""

class ConcentrationRequest(BaseModel):
    sample: str = Field(..., description="需要解析的样品名称")
    standards: List[str] = Field(..., description="标准样名称列表")

    @validator("standards")
    def _validate_standards(cls, v: List[str]) -> List[str]:
        if not v:
            raise ValueError("标准样列表不能为空")
        return v

class ComponentMethodPayload(BaseModel):
    component: str
    divisor_component: Optional[str] = None
    lambda_nm: Optional[float] = None
    calib: LinearCalibPayload

class ConcentrationAnalysisRequest(BaseModel):
    method: str = Field(..., description="lambda_equations/peak_area/ratio_derivative_2c/zero_cross_ratio_derivative_3c")
    sample: SpectrumPayload
    calibration: Optional[MatrixCalibPayload] = None
    lambda_points: Optional[List[float]] = None
    area_intervals: Optional[List[List[float]]] = None
    divisor_component: Optional[str] = None
    divisor_reference: Optional[SpectrumPayload] = None
    lambda_star_nm: Optional[float] = None
    ratio_methods: Optional[List[ComponentMethodPayload]] = None
    zero_cross_methods: Optional[List[ComponentMethodPayload]] = None

class ConcentrationAnalysisResponse(BaseModel):
    method: str
    concentrations: Dict[str, float]
    features: Dict[str, Any] = {}
