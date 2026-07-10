import os
from django.conf import settings
from hashids import Hashids

# Get salt from environment or Django settings, fallback to default
salt = os.environ.get("HASHIDS_SALT")
hashids = Hashids(salt=salt, min_length=6)

def encode_model_id(int_id: int) -> str:
    """Encode an integer model ID to a hash string."""
    return hashids.encode(int_id)

def decode_model_id(hash_str: str) -> int:
    """Decode a hash string back to an integer model ID.
    Raises ValueError if invalid.
    """
    res = hashids.decode(hash_str)
    if res:
        return res[0]
    raise ValueError(f"Invalid model_id hash: {hash_str}")
