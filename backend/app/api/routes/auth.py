from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import or_
from datetime import datetime, timezone

from app.db.session import get_db
from app.models.user import User
from app.schemas.auth import RegisterIn, LoginIn, GoogleLoginIn, AuthOut
from app.schemas.user import UserOut
from app.core.security import hash_password, verify_password, create_access_token
from app.core.google_auth import verify_google_id_token
from app.api.deps import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])

def _auth_response(user: User) -> AuthOut:
    token = create_access_token(str(user.id))
    return AuthOut(token=token, user=UserOut.model_validate(user))

@router.post("/register", response_model=AuthOut)
def register(payload: RegisterIn, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="El Email ya ha sido usado ")

    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        provider="local",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _auth_response(user)

@router.post("/login", response_model=AuthOut)
def login(payload: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not user.password_hash:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario Inactivo")
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas")

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    return _auth_response(user)

@router.post("/google", response_model=AuthOut)
def google_login(payload: GoogleLoginIn, db: Session = Depends(get_db)):
    if not payload.id_token:
        raise HTTPException(status_code=400, detail="Falta id_token")

    try:
        info = verify_google_id_token(payload.id_token)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google token inválido")

    email = info.get("email")
    sub = info.get("sub")
    name = info.get("name")
    picture = info.get("picture")

    if not email or not sub:
        raise HTTPException(status_code=401, detail="Google payload inválido")

    user = db.query(User).filter(or_(User.google_sub == sub, User.email == email)).first()

    if not user:
        user = User(
            email=email,
            google_sub=sub,
            full_name=name,
            avatar_url=picture,
            provider="google",
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        if not user.google_sub:
            user.google_sub = sub
        if not user.full_name and name:
            user.full_name = name
        if not user.avatar_url and picture:
            user.avatar_url = picture
        if user.provider == "local":
            user.provider = "mixed"
        user.last_login_at = datetime.now(timezone.utc)
        db.commit()

    if not user.is_active:
        raise HTTPException(status_code=401, detail="Usuario Inactivo")

    return _auth_response(user)

@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return UserOut.model_validate(current_user)

@router.get("/ping")
def admin_ping(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permisos de administrador",
        )

    return {"message": "Bienvenido admin", "email": current_user.email}