import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient


@pytest.mark.django_db
def test_token_contains_tenant_id():
    user = get_user_model().objects.create_user("owner@example.com", "password123")
    response = APIClient().post(
        "/api/auth/token/",
        {"email": user.email, "password": "password123"},
        format="json",
    )

    assert response.status_code == 200
    assert response.data["tenant_id"] == user.tenant_id
    assert user.tenant_id == f"T-{user.public_id}"


@pytest.mark.django_db
def test_legacy_profile_me_route_is_not_available():
    response = APIClient().get("/api/auth/profile/me/")

    assert response.status_code == 404
