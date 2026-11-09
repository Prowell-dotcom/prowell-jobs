"""Prowell Jobs free account credential helpers. No payment functionality."""
import hashlib
import hmac
import secrets

SESSION_SECONDS = 7*86400
COOKIE_NAME = 'prowell_member_session'
PBKDF2_ROUNDS = 390000

def password_hash(password):
    salt=secrets.token_bytes(16)
    hashed=hashlib.pbkdf2_hmac('sha256',password.encode('utf-8'),salt,PBKDF2_ROUNDS)
    return salt.hex(),hashed.hex()

def verify_password(password,salt,digest):
    try:
        expected=bytes.fromhex(digest)
        current=hashlib.pbkdf2_hmac('sha256',password.encode('utf-8'),bytes.fromhex(salt),PBKDF2_ROUNDS)
        return hmac.compare_digest(current,expected)
    except (ValueError,TypeError):
        return False
