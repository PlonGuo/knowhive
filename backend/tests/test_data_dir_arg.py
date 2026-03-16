"""
Task 77: --data-dir CLI argument — derive all data paths from a single directory.
"""
import argparse
from pathlib import Path

from app.main import _resolve_data_paths


def test_resolve_no_data_dir_returns_empty():
    result = _resolve_data_paths(None)
    assert result == {}


def test_resolve_data_dir_returns_all_keys():
    result = _resolve_data_paths("/tmp/kh_test")
    assert set(result.keys()) == {"config_path", "db_path", "chroma_path", "knowledge_dir"}


def test_resolve_db_path():
    result = _resolve_data_paths("/tmp/kh_test")
    assert result["db_path"] == str(Path("/tmp/kh_test") / "knowhive.db")


def test_resolve_chroma_path():
    result = _resolve_data_paths("/tmp/kh_test")
    assert result["chroma_path"] == str(Path("/tmp/kh_test") / "chroma_data")


def test_resolve_knowledge_dir():
    result = _resolve_data_paths("/tmp/kh_test")
    assert result["knowledge_dir"] == str(Path("/tmp/kh_test") / "knowledge")


def test_resolve_config_path():
    result = _resolve_data_paths("/tmp/kh_test")
    assert result["config_path"] == Path("/tmp/kh_test") / "config.yaml"


def test_argparse_accepts_data_dir():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=18234)
    parser.add_argument("--data-dir", type=str, default=None)
    args = parser.parse_args(["--data-dir", "/tmp/kh_test", "--port", "18200"])
    assert args.data_dir == "/tmp/kh_test"
    assert args.port == 18200


def test_create_app_accepts_data_dir_paths(tmp_path):
    from app.main import create_app
    app = create_app(
        db_path=str(tmp_path / "test.db"),
        chroma_path=str(tmp_path / "chroma"),
        knowledge_dir=str(tmp_path / "knowledge"),
        config_path=tmp_path / "config.yaml",
    )
    assert app is not None
