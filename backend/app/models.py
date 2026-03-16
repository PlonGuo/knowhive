"""Pydantic models for KnowHive database entities."""
from datetime import date
from enum import IntEnum, StrEnum
from typing import Optional

from pydantic import BaseModel, Field


# ── Enums ────────────────────────────────────────────────────────


class DocumentStatus(StrEnum):
    PENDING = "pending"
    INDEXED = "indexed"
    ERROR = "error"


class ChatMessageRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"


class IngestTaskStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


# ── Documents ────────────────────────────────────────────────────


class DocumentCreate(BaseModel):
    file_path: str
    file_name: str
    file_size: Optional[int] = None
    file_hash: Optional[str] = None
    modified_at: str
    title: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[str] = None
    difficulty: Optional[str] = None
    pack_id: Optional[str] = None
    chunk_strategy: Optional[str] = None


class Document(BaseModel):
    id: int
    file_path: str
    file_name: str
    file_size: Optional[int] = None
    file_hash: Optional[str] = None
    modified_at: str
    indexed_at: Optional[str] = None
    chunk_count: int = 0
    status: DocumentStatus = DocumentStatus.PENDING
    error_message: Optional[str] = None
    title: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[str] = None
    difficulty: Optional[str] = None
    pack_id: Optional[str] = None
    chunk_strategy: Optional[str] = None
    created_at: str
    updated_at: str


# ── Chat Messages ────────────────────────────────────────────────


class ChatMessageCreate(BaseModel):
    role: ChatMessageRole
    content: str
    sources: Optional[str] = None


class ChatMessage(BaseModel):
    id: int
    role: ChatMessageRole
    content: str
    sources: Optional[str] = None
    created_at: str


# ── Chat Summaries ──────────────────────────────────────────────


class ChatSummaryCreate(BaseModel):
    summary: str
    first_message_id: int
    last_message_id: int


class ChatSummary(BaseModel):
    id: int
    summary: str
    first_message_id: int
    last_message_id: int
    created_at: str


# ── Ingest Tasks ─────────────────────────────────────────────────


class IngestTaskCreate(BaseModel):
    id: str
    total_files: int = 0
    status: IngestTaskStatus = IngestTaskStatus.PENDING


class IngestTask(BaseModel):
    id: str
    status: IngestTaskStatus
    total_files: int = 0
    processed_files: int = 0
    errors: Optional[str] = None
    created_at: str
    completed_at: Optional[str] = None


# ── Spaced Repetition ─────────────────────────────────────────────────────────


class ReviewQuality(IntEnum):
    """SM-2 quality grades: 0=blackout … 4=easy."""
    BLACKOUT = 0
    INCORRECT = 1
    HARD = 2
    GOOD = 3
    EASY = 4


class ReviewItem(BaseModel):
    """A flashcard item tracked with SM-2 scheduling."""
    id: Optional[int] = None
    file_path: str
    question: str
    answer: str
    repetitions: int = 0
    easiness: float = 2.5
    interval: int = 1  # days until next review
    due_date: str = Field(default_factory=lambda: date.today().isoformat())
