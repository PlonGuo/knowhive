"""
File-based logging with daily rotation and 7-day retention.
"""
import logging
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

_DEFAULT_LOG_DIR = Path(__file__).resolve().parent.parent / "logs"


def setup_logging(
    log_dir: Path | None = None,
    level: int = logging.INFO,
) -> TimedRotatingFileHandler:
    """Configure file-based logging for the KnowHive backend.

    Returns the file handler (useful for testing).
    """
    log_dir = log_dir or _DEFAULT_LOG_DIR
    log_dir.mkdir(parents=True, exist_ok=True)

    log_file = log_dir / "backend.log"

    handler = TimedRotatingFileHandler(
        filename=str(log_file),
        when="midnight",
        backupCount=7,
        encoding="utf-8",
    )
    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    handler.setFormatter(formatter)

    # Configure the knowhive root logger
    logger = logging.getLogger("knowhive")
    logger.setLevel(level)
    # Avoid duplicate handlers on repeated calls
    logger.handlers = [handler]

    # Route uvicorn logs through our handler
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error"):
        uv_logger = logging.getLogger(name)
        uv_logger.setLevel(level)
        uv_logger.handlers = [handler]
        uv_logger.propagate = False

    return handler
