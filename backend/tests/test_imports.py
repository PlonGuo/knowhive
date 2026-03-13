"""
Task 5 verification: backend scaffold imports are available.
"""
import importlib


def test_fastapi_importable():
    fastapi = importlib.import_module("fastapi")
    assert fastapi.__version__, "fastapi should have a version"


def test_uvicorn_importable():
    uvicorn = importlib.import_module("uvicorn")
    assert uvicorn.__version__, "uvicorn should have a version"


def test_pydantic_importable():
    pydantic = importlib.import_module("pydantic")
    assert pydantic.__version__, "pydantic should have a version"
