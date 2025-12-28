from pydantic import BaseModel
from typing import Optional
from uuid import UUID
from datetime import datetime


class TemplateOut(BaseModel):
    id: UUID
    code: str
    name: str
    description: Optional[str] = None
    version: int
    visibility: str
    is_active: bool
    is_user_template: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
