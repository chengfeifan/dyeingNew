from __future__ import annotations
from pydantic import BaseModel, Field
from typing import List, Optional, Dict

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
    meta: Dict[str, str] = {}

class HistoryItem(BaseModel):
    name: str
    file: str
    timestamp: str
