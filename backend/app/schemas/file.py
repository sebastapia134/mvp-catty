from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime
from typing import Optional, Any


class FileCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    template_id: UUID
    is_public: bool = False


class FileListOut(BaseModel):
    id: UUID
    code: str
    name: str
    size_bytes: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class FileOut(BaseModel):
    id: UUID
    code: str
    name: str
    owner_id: UUID
    template_id: UUID
    is_public: bool
    share_token: str
    share_enabled: bool

    file_json: Any  
    size_bytes: int
    last_opened_at: Optional[datetime] = None  
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
