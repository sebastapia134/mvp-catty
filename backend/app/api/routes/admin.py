from fastapi import APIRouter, Depends, HTTPException, status
from app.models.user import User
from app.db.session import get_db
from sqlalchemy.orm import Session
from app.api.deps import get_current_user  # o el nombre real de tu dependencia

router = APIRouter(prefix="/admin", tags=["admin"])

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