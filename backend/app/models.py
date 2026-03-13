"""Pydantic models for KnowHive database entities."""
from enum import StrEnum
from typing import Optional

from pydantic import BaseModel


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
