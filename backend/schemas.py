from __future__ import annotations
from pydantic import BaseModel, Field, validator
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
