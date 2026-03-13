"""Tests for review API router — GET /review/due, POST /review/record, GET /review/stats."""
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.models import ReviewItem, ReviewQuality
from app.routers.review import _reset_review_router, init_review_router, router


def make_review_item(**kwargs):
    defaults = dict(
        id=1,
        file_path="packs/python/intro.md",
        question="What is a list?",
        answer="An ordered sequence.",
        repetitions=0,
        easiness=2.5,
        interval=1,
        due_date="2026-03-13",
    )
    defaults.update(kwargs)
    return ReviewItem(**defaults)


def make_app(svc):
    _reset_review_router()
    init_review_router(svc)
    app = FastAPI()
    app.include_router(router)
    return app


# ── GET /review/due ───────────────────────────────────────────────────────────

def test_get_due_returns_list():
    svc = MagicMock()
    svc.get_due_items = AsyncMock(return_value=[make_review_item()])
    client = TestClient(make_app(svc))

    resp = client.get("/review/due")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 1


def test_get_due_returns_item_fields():
    svc = MagicMock()
    svc.get_due_items = AsyncMock(return_value=[make_review_item(id=42)])
    client = TestClient(make_app(svc))

    resp = client.get("/review/due")
    assert resp.status_code == 200
    item = resp.json()[0]
    assert item["id"] == 42
    assert item["question"] == "What is a list?"
    assert item["answer"] == "An ordered sequence."


def test_get_due_returns_empty_when_none_due():
    svc = MagicMock()
    svc.get_due_items = AsyncMock(return_value=[])
    client = TestClient(make_app(svc))

    resp = client.get("/review/due")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_due_returns_503_when_not_initialized():
    _reset_review_router()
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/review/due")
    assert resp.status_code == 503


# ── POST /review/record ───────────────────────────────────────────────────────

def test_post_record_returns_updated_item():
    svc = MagicMock()
    updated = make_review_item(repetitions=1, interval=6, due_date="2026-03-19")
    svc.record_review = AsyncMock(return_value=updated)
    client = TestClient(make_app(svc))

    resp = client.post("/review/record", json={"item_id": 1, "quality": 3})
    assert resp.status_code == 200
    data = resp.json()
    assert data["repetitions"] == 1
    assert data["interval"] == 6


def test_post_record_calls_service_with_quality():
    svc = MagicMock()
    svc.record_review = AsyncMock(return_value=make_review_item())
    client = TestClient(make_app(svc))

    client.post("/review/record", json={"item_id": 5, "quality": 4})
    svc.record_review.assert_called_once_with(5, ReviewQuality(4))


def test_post_record_returns_404_when_item_not_found():
    svc = MagicMock()
    svc.record_review = AsyncMock(side_effect=ValueError("ReviewItem 99 not found"))
    client = TestClient(make_app(svc))

    resp = client.post("/review/record", json={"item_id": 99, "quality": 3})
    assert resp.status_code == 404


def test_post_record_returns_422_for_invalid_quality():
    svc = MagicMock()
    svc.record_review = AsyncMock(return_value=make_review_item())
    client = TestClient(make_app(svc))

    resp = client.post("/review/record", json={"item_id": 1, "quality": 99})
    assert resp.status_code == 422


# ── GET /review/stats ─────────────────────────────────────────────────────────

def test_get_stats_returns_total_and_due():
    svc = MagicMock()
    svc.get_stats = AsyncMock(return_value={"total": 10, "due_today": 3})
    client = TestClient(make_app(svc))

    resp = client.get("/review/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 10
    assert data["due_today"] == 3
