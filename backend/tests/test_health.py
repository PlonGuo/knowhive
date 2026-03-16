"""
Task 6 + 7: FastAPI entry point and GET /health endpoint.
"""
from fastapi.testclient import TestClient

from app.main import create_app


def test_health_returns_ok():
    client = TestClient(create_app())
    response = client.get("/health")
    assert response.status_code == 200


def test_health_returns_status_ok():
    client = TestClient(create_app())
    response = client.get("/health")
    data = response.json()
    assert data["status"] == "ok"


def test_health_returns_version():
    client = TestClient(create_app())
    response = client.get("/health")
    data = response.json()
    assert "version" in data
    assert data["version"] == "0.1.0"


def test_health_content_type_is_json():
    client = TestClient(create_app())
    response = client.get("/health")
    assert "application/json" in response.headers["content-type"]
