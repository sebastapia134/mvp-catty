import uuid
from sqlalchemy import Column, Text, Boolean, BigInteger, DateTime
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from app.db.session import Base


class File(Base):
    __tablename__ = "files"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    code = Column(Text, unique=True, nullable=False)
    name = Column(Text, nullable=False)

    owner_id = Column(UUID(as_uuid=True), nullable=False)
    template_id = Column(UUID(as_uuid=True), nullable=False)

    is_public = Column(Boolean, nullable=False, default=False)

    share_token = Column(Text, unique=True, nullable=False)
    share_enabled = Column(Boolean, nullable=False, default=True)

    file_json = Column(JSONB, nullable=False)
    size_bytes = Column(BigInteger, nullable=False, default=0)

    last_opened_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
