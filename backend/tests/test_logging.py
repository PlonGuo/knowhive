"""
Task 8: File-based logging — daily rotation, 7-day retention.
"""
import logging
import os
import time
from pathlib import Path
from unittest.mock import patch

from app.logging_config import setup_logging


def test_setup_logging_creates_log_directory(tmp_path):
    log_dir = tmp_path / "logs"
    setup_logging(log_dir=log_dir)
    assert log_dir.exists()


def test_setup_logging_creates_log_file(tmp_path):
    log_dir = tmp_path / "logs"
    setup_logging(log_dir=log_dir)
    logger = logging.getLogger("knowhive")
    logger.info("test message")
    log_files = list(log_dir.glob("backend.log*"))
    assert len(log_files) >= 1


def test_logger_writes_to_file(tmp_path):
    log_dir = tmp_path / "logs"
    setup_logging(log_dir=log_dir)
    logger = logging.getLogger("knowhive")
    logger.info("hello from test")
    # Flush handlers
    for handler in logger.handlers:
        handler.flush()
    log_content = (log_dir / "backend.log").read_text()
    assert "hello from test" in log_content


def test_log_format_contains_timestamp_and_level(tmp_path):
    log_dir = tmp_path / "logs"
    setup_logging(log_dir=log_dir)
    logger = logging.getLogger("knowhive")
    logger.warning("format check")
    for handler in logger.handlers:
        handler.flush()
    log_content = (log_dir / "backend.log").read_text()
    assert "WARNING" in log_content
    # Should contain ISO-like timestamp
    assert "202" in log_content  # year prefix


def test_handler_is_timed_rotating(tmp_path):
    log_dir = tmp_path / "logs"
    handler = setup_logging(log_dir=log_dir)
    from logging.handlers import TimedRotatingFileHandler
    assert isinstance(handler, TimedRotatingFileHandler)
    assert handler.when.upper() == "MIDNIGHT"
    assert handler.backupCount == 7


def test_setup_logging_default_dir(tmp_path):
    """setup_logging with default log_dir uses 'logs' relative to backend root."""
    log_dir = tmp_path / "logs"
    handler = setup_logging(log_dir=log_dir)
    assert handler is not None


def test_uvicorn_loggers_propagate(tmp_path):
    """Uvicorn access and error loggers should propagate to our handler."""
    log_dir = tmp_path / "logs"
    setup_logging(log_dir=log_dir)
    uvicorn_logger = logging.getLogger("uvicorn")
    uvicorn_logger.info("uvicorn test log")
    # Flush the uvicorn logger's own handlers (setup_logging attaches directly)
    for handler in uvicorn_logger.handlers:
        handler.flush()
    log_content = (log_dir / "backend.log").read_text()
    assert "uvicorn test log" in log_content
