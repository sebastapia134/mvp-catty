import copy
import json
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.api.deps import get_current_user
from app.models.file import File
from app.models.template import Template
from app.schemas.file import FileCreateIn, FileListOut, FileOut
from app.core.ids import random_code, random_share_token
from uuid import UUID


router = APIRouter(prefix="/files", tags=["files"])


def _unique_file_code(db: Session) -> str:
    while True:
        code = random_code("F-", 6)
        exists = db.query(File).filter(File.code == code).first()
        if not exists:
            return code


def _unique_share_token(db: Session) -> str:
    while True:
        tok = random_share_token()
        exists = db.query(File).filter(File.share_token == tok).first()
        if not exists:
            return tok


@router.get("", response_model=list[FileListOut])
def list_files(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    files = (
        db.query(File)
        .filter(File.owner_id == current_user.id)
        .order_by(File.updated_at.desc())
        .all()
    )
    return files


# ✅ NUEVO: detalle para abrir /files/{id} y pintar el JSON en el front
@router.get("/{file_id}", response_model=FileOut)
def get_file(file_id: UUID, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    f = (
        db.query(File)
        .filter(File.id == file_id, File.owner_id == current_user.id)
        .first()
    )

    # opcional: permitir admins ver cualquier file
    if not f and getattr(current_user, "is_admin", False):
        f = db.query(File).filter(File.id == file_id).first()

    # opcional: permitir abrir por code (F-XXXXXX)
    if not f:
        f = (
            db.query(File)
            .filter(File.code == file_id, File.owner_id == current_user.id)
            .first()
        )
        if not f and getattr(current_user, "is_admin", False):
            f = db.query(File).filter(File.code == file_id).first()

    if not f:
        raise HTTPException(status_code=404, detail="File not found")

    # si no es admin, doble check de ownership (por si lo encontraste por code)
    if (not getattr(current_user, "is_admin", False)) and (f.owner_id != current_user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")

    return f


@router.post("", response_model=FileOut, status_code=201)
def create_file(payload: FileCreateIn, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    tpl = db.query(Template).filter(Template.id == payload.template_id, Template.is_active == True).first()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")

    if not current_user.is_admin:
        allowed = (tpl.visibility in ["public", "shared"]) or (tpl.owner_id == current_user.id)
        if not allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Template not allowed")

    def _unwrap_template_json(tj):
        if not isinstance(tj, dict):
            return {}

        # Caso: guardaste el JSON completo del "file" en template_json -> { template:..., data:... }
        if "template" in tj and "data" in tj and isinstance(tj["data"], dict):
            return tj["data"]

        # Caso extra: {"data": {"columns":..., "nodes":...}}  (doble wrapper)
        if "data" in tj and isinstance(tj["data"], dict) and (
            "columns" in tj["data"] or "nodes" in tj["data"] or "meta" in tj["data"]
        ):
            return tj["data"]

        # Caso ideal: ya viene plano (ui/meta/columns/nodes)
        return tj

    base_json = _unwrap_template_json(copy.deepcopy(tpl.template_json))

    file_json = {
        "template": {"id": str(tpl.id), "code": tpl.code, "version": tpl.version},
        "data": base_json,
    }

    raw = json.dumps(file_json, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    size_bytes = len(raw)

    f = File(
        code=_unique_file_code(db),
        name=payload.name,
        owner_id=current_user.id,
        template_id=tpl.id,
        is_public=payload.is_public,
        share_token=_unique_share_token(db),
        share_enabled=True,
        file_json=file_json,
        size_bytes=size_bytes,
    )
    db.add(f)
    db.commit()
    db.refresh(f)
    return f


@router.delete("/{file_id}", status_code=204)
def delete_file(file_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    f = db.query(File).filter(File.id == file_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="File not found")

    if (not current_user.is_admin) and (f.owner_id != current_user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")

    db.delete(f)
    db.commit()
    return None
