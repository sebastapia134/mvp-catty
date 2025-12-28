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


@router.post("", response_model=FileOut, status_code=201)
def create_file(payload: FileCreateIn, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    tpl = db.query(Template).filter(Template.id == payload.template_id, Template.is_active == True).first()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")

    if not current_user.is_admin:
        allowed = (tpl.visibility in ["public", "shared"]) or (tpl.owner_id == current_user.id)
        if not allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Template not allowed")

    base_json = copy.deepcopy(tpl.template_json)
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
