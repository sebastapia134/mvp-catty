from sqlalchemy.orm import Session
from app.models.template import Template


BASE_TEMPLATE_CODE = "TPL-BASE-001"

BASE_TEMPLATE_JSON = {
    "meta": {"name": "Plantilla base", "version": 1},
    "columns": [
        {"id": "col_section", "name": "Sección", "type": "text", "locked": True},
        {"id": "col_item", "name": "Ítem", "type": "text", "locked": True},
        {"id": "col_answer", "name": "Respuesta", "type": "text", "locked": False},
        {"id": "col_score", "name": "Puntaje", "type": "number", "locked": False},
    ],
    "rows": [
        {
            "id": "row_1",
            "parent_id": None,
            "level": 0,
            "cells": {
                "col_section": "Inicio",
                "col_item": "Pregunta de ejemplo",
                "col_answer": "",
                "col_score": 0,
            },
            "type": "item"
        }
    ],
    "rules": {
        "group_requires_parent": True,
        "max_depth": 6
    }
}


def ensure_base_template(db: Session) -> None:
    exists = db.query(Template).first()
    if exists:
        return

    t = Template(
        code=BASE_TEMPLATE_CODE,
        name="Plantilla base",
        description="Plantilla mínima para pruebas.",
        template_json=BASE_TEMPLATE_JSON,
        version=1,
        is_active=True,
        is_user_template=False,
        visibility="public",
        owner_id=None,
        created_by=None,
    )
    db.add(t)
    db.commit()
