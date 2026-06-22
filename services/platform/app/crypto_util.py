from __future__ import annotations

import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def encrypt_bytes(master_key: bytes, plaintext: bytes) -> bytes:
    nonce = secrets.token_bytes(12)
    aesgcm = AESGCM(master_key)
    ciphertext = aesgcm.encrypt(nonce, plaintext, None)
    return nonce + ciphertext


def decrypt_bytes(master_key: bytes, payload: bytes) -> bytes:
    if len(payload) < 13:
        raise ValueError("Invalid encrypted payload")
    nonce, ciphertext = payload[:12], payload[12:]
    aesgcm = AESGCM(master_key)
    return aesgcm.decrypt(nonce, ciphertext, None)
