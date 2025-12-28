import secrets
import string


_ALPH = string.ascii_uppercase + string.digits


def random_code(prefix: str, length: int) -> str:
    return prefix + "".join(secrets.choice(_ALPH) for _ in range(length))


def random_share_token() -> str:
    return "sh_" + secrets.token_urlsafe(18)
