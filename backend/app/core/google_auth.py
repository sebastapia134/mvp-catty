from google.oauth2 import id_token
from google.auth.transport import requests
from app.core.config import GOOGLE_CLIENT_ID

def verify_google_id_token(token: str) -> dict:
    req = requests.Request()
    return id_token.verify_oauth2_token(token, req, GOOGLE_CLIENT_ID)
