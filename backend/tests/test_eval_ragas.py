"""Tests for RAGAs evaluation CLI script."""
import json
import subprocess
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.eval_ragas import (
    load_eval_dataset,
    run_rag_pipeline,
    build_ragas_samples,
)


# ── Dataset loading ──────────────────────────────────────────


class TestLoadEvalDataset:
    """Tests for loading evaluation datasets from JSON/JSONL."""

    def test_load_json_array(self, tmp_path: Path):
        """Load a JSON file containing an array of samples."""
        data = [
            {"question": "What is RAG?", "ground_truth": "Retrieval-Augmented Generation"},
            {"question": "What is Chroma?", "ground_truth": "A vector database"},
        ]
        fp = tmp_path / "eval.json"
        fp.write_text(json.dumps(data))

        result = load_eval_dataset(fp)
        assert len(result) == 2
        assert result[0]["question"] == "What is RAG?"
        assert result[1]["ground_truth"] == "A vector database"

    def test_load_jsonl(self, tmp_path: Path):
        """Load a JSONL file (one JSON object per line)."""
        lines = [
            json.dumps({"question": "Q1", "ground_truth": "A1"}),
            json.dumps({"question": "Q2", "ground_truth": "A2"}),
        ]
        fp = tmp_path / "eval.jsonl"
        fp.write_text("\n".join(lines))

        result = load_eval_dataset(fp)
        assert len(result) == 2
        assert result[0]["question"] == "Q1"

    def test_load_jsonl_skips_blank_lines(self, tmp_path: Path):
        """JSONL loader ignores blank lines."""
        lines = [
            json.dumps({"question": "Q1", "ground_truth": "A1"}),
            "",
            json.dumps({"question": "Q2", "ground_truth": "A2"}),
        ]
        fp = tmp_path / "eval.jsonl"
        fp.write_text("\n".join(lines))

        result = load_eval_dataset(fp)
        assert len(result) == 2

    def test_load_file_not_found(self, tmp_path: Path):
        """Raises FileNotFoundError for missing file."""
        with pytest.raises(FileNotFoundError):
            load_eval_dataset(tmp_path / "nonexistent.json")

    def test_load_validates_required_fields(self, tmp_path: Path):
        """Raises ValueError if a sample is missing required fields."""
        data = [{"question": "Q1"}]  # missing ground_truth
        fp = tmp_path / "eval.json"
        fp.write_text(json.dumps(data))

        with pytest.raises(ValueError, match="ground_truth"):
            load_eval_dataset(fp)


# ── RAG pipeline execution ──────────────────────────────────


class TestRunRagPipeline:
    """Tests for running questions through the RAG pipeline."""

    @pytest.mark.asyncio
    async def test_returns_answer_and_contexts(self):
        """Pipeline returns answer text and retrieved context strings."""
        mock_collection = MagicMock()
        mock_collection.query.return_value = {
            "documents": [["chunk1 text", "chunk2 text"]],
            "metadatas": [[
                {"file_path": "a.md", "chunk_index": 0},
                {"file_path": "b.md", "chunk_index": 0},
            ]],
        }

        mock_config = MagicMock()
        mock_config.llm_provider = "ollama"
        mock_config.model_name = "llama3"
        mock_config.base_url = "http://localhost:11434"
        mock_config.api_key = None

        with patch("app.eval_ragas.RAGService") as MockRAG:
            service = MockRAG.return_value
            service.retrieve.return_value = [
                {"content": "chunk1 text", "file_path": "a.md", "chunk_index": 0},
                {"content": "chunk2 text", "file_path": "b.md", "chunk_index": 0},
            ]
            service.build_prompt.return_value = [{"role": "user", "content": "test"}]
            service.call_llm = AsyncMock(return_value="The answer is 42")

            result = await run_rag_pipeline(
                question="What is the answer?",
                rag_service=service,
                config=mock_config,
            )

        assert result["answer"] == "The answer is 42"
        assert result["contexts"] == ["chunk1 text", "chunk2 text"]

    @pytest.mark.asyncio
    async def test_empty_retrieval(self):
        """Pipeline handles empty retrieval results."""
        mock_config = MagicMock()

        with patch("app.eval_ragas.RAGService") as MockRAG:
            service = MockRAG.return_value
            service.retrieve.return_value = []
            service.build_prompt.return_value = [{"role": "user", "content": "test"}]
            service.call_llm = AsyncMock(return_value="No relevant context found.")

            result = await run_rag_pipeline(
                question="Unknown question?",
                rag_service=service,
                config=mock_config,
            )

        assert result["answer"] == "No relevant context found."
        assert result["contexts"] == []


# ── RAGAs sample building ───────────────────────────────────


class TestBuildRagasSamples:
    """Tests for constructing RAGAs SingleTurnSample objects."""

    def test_builds_samples_with_all_fields(self):
        """Samples include user_input, response, retrieved_contexts, reference."""
        eval_data = [
            {"question": "What is RAG?", "ground_truth": "Retrieval-Augmented Generation"},
        ]
        pipeline_results = [
            {"answer": "RAG is Retrieval-Augmented Generation", "contexts": ["RAG stands for..."]},
        ]

        samples = build_ragas_samples(eval_data, pipeline_results)
        assert len(samples) == 1
        s = samples[0]
        assert s.user_input == "What is RAG?"
        assert s.response == "RAG is Retrieval-Augmented Generation"
        assert s.retrieved_contexts == ["RAG stands for..."]
        assert s.reference == "Retrieval-Augmented Generation"

    def test_builds_multiple_samples(self):
        """Handles multiple evaluation samples."""
        eval_data = [
            {"question": "Q1", "ground_truth": "A1"},
            {"question": "Q2", "ground_truth": "A2"},
        ]
        pipeline_results = [
            {"answer": "R1", "contexts": ["c1"]},
            {"answer": "R2", "contexts": ["c2"]},
        ]

        samples = build_ragas_samples(eval_data, pipeline_results)
        assert len(samples) == 2
        assert samples[1].user_input == "Q2"
        assert samples[1].reference == "A2"


# ── CLI entry point ──────────────────────────────────────────


class TestCLIEntryPoint:
    """Tests for the CLI interface."""

    def test_module_is_runnable(self):
        """Script can be invoked with --help without errors."""
        result = subprocess.run(
            [sys.executable, "-m", "app.eval_ragas", "--help"],
            capture_output=True,
            text=True,
            cwd=str(Path(__file__).parent.parent),
        )
        assert result.returncode == 0
        assert "usage" in result.stdout.lower() or "eval" in result.stdout.lower()

    def test_missing_dataset_arg(self):
        """Script fails with clear error when no dataset file is given."""
        result = subprocess.run(
            [sys.executable, "-m", "app.eval_ragas"],
            capture_output=True,
            text=True,
            cwd=str(Path(__file__).parent.parent),
        )
        assert result.returncode != 0
