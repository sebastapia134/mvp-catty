from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from app.schemas.user import UserOut

class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    full_name: Optional[str] = None

class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=72)

class GoogleLoginIn(BaseModel):
    id_token: str

class AuthOut(BaseModel):
    token: str
    user: UserOut
