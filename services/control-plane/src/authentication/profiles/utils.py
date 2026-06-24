def avatar_url(avatar):
    if not avatar:
        return ""
    try:
        return avatar.url
    except Exception:
        return str(avatar)
