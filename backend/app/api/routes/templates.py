from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.api.deps import get_current_user
from app.models.template import Template
from app.schemas.template import TemplateOut

router = APIRouter(prefix="/templates", tags=["templates"])


@router.get("", response_model=list[TemplateOut])
def list_templates(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    q = db.query(Template).filter(Template.is_active == True)

    if not current_user.is_admin:
        q = q.filter(
            (Template.visibility.in_(["public", "shared"])) |
            (Template.owner_id == current_user.id)
        )

    return q.order_by(Template.updated_at.desc()).all()
