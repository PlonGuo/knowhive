"""Tests for ExportService — ZIP export of knowledge + chat history + config."""
import json
import zipfile
from io import BytesIO
from pathlib import Path

import pytest
import pytest_asyncio

from app.database import close_db, get_db, init_db
from app.services.export_service import ExportService


@pytest_asyncio.fixture
async def db(tmp_path):
    db_path = str(tmp_path / "test.db")
    await init_db(db_path)
    yield
    await close_db()


@pytest.fixture
def knowledge_dir(tmp_path):
    kdir = tmp_path / "knowledge"
    kdir.mkdir()
    (kdir / "notes.md").write_text("# Hello World\n\nSome notes.")
    subdir = kdir / "subdir"
    subdir.mkdir()
    (subdir / "deep.md").write_text("# Deep\n\nDeep content.")
    return kdir


@pytest.fixture
def config_path(tmp_path):
    cfg = tmp_path / "config.yaml"
    cfg.write_text("llm_provider: ollama\nmodel_name: llama3\n")
    return cfg


@pytest.fixture
def svc(tmp_path, knowledge_dir, config_path):
    return ExportService(
        knowledge_dir=knowledge_dir,
        config_path=config_path,
        db_path=str(tmp_path / "test.db"),
    )


# ── export_full ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_export_full_returns_bytes(svc, db):
    data = await svc.export_full()
    assert isinstance(data, bytes)
    assert len(data) > 0


@pytest.mark.asyncio
async def test_export_full_is_valid_zip(svc, db):
    data = await svc.export_full()
    with zipfile.ZipFile(BytesIO(data)) as zf:
        names = zf.namelist()
    assert len(names) > 0


@pytest.mark.asyncio
async def test_export_full_includes_knowledge_files(svc, db):
    data = await svc.export_full()
    with zipfile.ZipFile(BytesIO(data)) as zf:
        names = zf.namelist()
    assert any("notes.md" in n for n in names)


@pytest.mark.asyncio
async def test_export_full_includes_nested_knowledge_files(svc, db):
    data = await svc.export_full()
    with zipfile.ZipFile(BytesIO(data)) as zf:
        names = zf.namelist()
    assert any("deep.md" in n for n in names)


@pytest.mark.asyncio
async def test_export_full_includes_config_yaml(svc, db):
    data = await svc.export_full()
    with zipfile.ZipFile(BytesIO(data)) as zf:
        names = zf.namelist()
    assert any("config.yaml" in n for n in names)


@pytest.mark.asyncio
async def test_export_full_includes_chat_history(svc, db):
    data = await svc.export_full()
    with zipfile.ZipFile(BytesIO(data)) as zf:
        names = zf.namelist()
    assert any("chat_history.json" in n for n in names)


@pytest.mark.asyncio
async def test_export_full_chat_history_is_valid_json(svc, db):
    data = await svc.export_full()
    with zipfile.ZipFile(BytesIO(data)) as zf:
        history_name = next(n for n in zf.namelist() if "chat_history.json" in n)
        history_bytes = zf.read(history_name)
    history = json.loads(history_bytes)
    assert isinstance(history, list)


# ── export_chat_history ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_export_chat_history_returns_list(svc, db):
    result = await svc.export_chat_history()
    assert isinstance(result, list)


@pytest.mark.asyncio
async def test_export_chat_history_includes_messages(svc, db):
    async with get_db() as conn:
        await conn.execute(
            "INSERT INTO chat_messages (role, content) VALUES (?, ?)",
            ("user", "Hello!"),
        )
        await conn.execute(
            "INSERT INTO chat_messages (role, content) VALUES (?, ?)",
            ("assistant", "Hi there!"),
        )
        await conn.commit()

    result = await svc.export_chat_history()
    assert len(result) == 2
    roles = [m["role"] for m in result]
    assert "user" in roles
    assert "assistant" in roles
