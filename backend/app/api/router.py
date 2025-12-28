from fastapi import APIRouter
from app.api.routes.auth import router as auth_router
from app.api.routes.templates import router as templates_router
from app.api.routes.files import router as files_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(templates_router)
api_router.include_router(files_router)
