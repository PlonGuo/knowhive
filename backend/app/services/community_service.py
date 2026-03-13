"""CommunityService — fetch community content manifest, import packs."""
import time
from pathlib import Path
from typing import Any, Optional

import httpx
from pydantic import BaseModel

# Default manifest URL (GitHub raw)
MANIFEST_URL = "https://raw.githubusercontent.com/PlonGuo/knowhive-community/main/manifest.json"
DEFAULT_CACHE_TTL = 300  # 5 minutes


class ContentPack(BaseModel):
    id: str
    name: str
    description: str
    author: str
    tags: list[str]
    file_count: int
    size_kb: int
    path: str


class CommunityManifest(BaseModel):
    version: str
    packs: list[ContentPack]


class PackFile(BaseModel):
    filename: str
    path: str
    size_kb: int


class CommunityService:
    """Fetches and caches community content manifests; imports packs."""

    def __init__(
        self,
        knowledge_dir: Path,
        manifest_url: str = MANIFEST_URL,
        cache_ttl: int = DEFAULT_CACHE_TTL,
    ):
        self._knowledge_dir = knowledge_dir
        self._manifest_url = manifest_url
        self._cache_ttl = cache_ttl
        self._cached_manifest: Optional[CommunityManifest] = None
        self._cache_time: float = 0.0

    async def fetch_manifest(self) -> CommunityManifest:
        """Fetch and cache the community manifest. Respects TTL."""
        now = time.monotonic()
        if self._cached_manifest is not None and (now - self._cache_time) < self._cache_ttl:
            return self._cached_manifest

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(self._manifest_url)
            resp.raise_for_status()
            data = resp.json()

        self._cached_manifest = CommunityManifest(**data)
        self._cache_time = now
        return self._cached_manifest

    async def import_pack(self, pack: ContentPack) -> dict[str, Any]:
        """Download all files in a pack to knowledge/{pack.id}/. Returns status dict."""
        pack_dir = self._knowledge_dir / pack.id

        # Check if already imported (dir exists and is non-empty)
        if pack_dir.exists() and any(pack_dir.iterdir()):
            return {"status": "already_imported", "pack_id": pack.id}

        pack_dir.mkdir(parents=True, exist_ok=True)

        # Fetch file listing
        pack_files = await self.fetch_pack_files(pack)

        # Download each file
        base = self._manifest_url.rsplit("/manifest.json", 1)[0]
        async with httpx.AsyncClient(timeout=30.0) as client:
            for pack_file in pack_files:
                file_url = f"{base}/{pack_file.path}"
                resp = await client.get(file_url)
                resp.raise_for_status()
                (pack_dir / pack_file.filename).write_bytes(resp.content)

        return {"status": "imported", "pack_id": pack.id, "file_count": len(pack_files)}

    async def fetch_pack_files(self, pack: ContentPack) -> list[PackFile]:
        """Fetch the file listing for a content pack."""
        # files.json is at {pack.path}/files.json in the community repo
        base = self._manifest_url.rsplit("/manifest.json", 1)[0]
        files_url = f"{base}/{pack.path}/files.json"
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(files_url)
            resp.raise_for_status()
            data = resp.json()
        return [PackFile(**f) for f in data]
