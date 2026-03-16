"""Pre-retrieval strategy classifier — rule-based and LLM-based.

Classifies user queries to determine the optimal pre-retrieval strategy:
- "hyde": factual/knowledge-seeking questions → HyDE retrieval
- "multi_query": ambiguous/broad/comparative queries → multi-query expansion
- "none": specific keyword lookups or commands → direct retrieval
"""
import logging
import re

from langchain_core.messages import HumanMessage, SystemMessage

from app.config import AppConfig
from app.services.llm_factory import create_chat_model

logger = logging.getLogger(__name__)


# --- EN comparison patterns ---
_EN_COMPARISON_PATTERNS = [
    r"\bvs\.?\b",
    r"\bdifference(?:s)?\s+between\b",
    r"\bpros?\s+and\s+cons?\b",
    r"\bcompare\b",
    r"\bcomparison\b",
    r"\bversus\b",
]

# --- CN comparison patterns ---
_CN_COMPARISON_PATTERNS = [
    r"对比",
    r"区别",
    r"优缺点",
    r"还是",
    r"比较",
]

# --- EN interrogative patterns ---
_EN_INTERROGATIVE_PATTERNS = [
    r"\bwhat\s+is\b",
    r"\bwhat\s+are\b",
    r"\bhow\s+does\b",
    r"\bhow\s+do\b",
    r"\bhow\s+to\b",
    r"\bexplain\b",
    r"\bdescribe\b",
    r"\bwhy\b",
    r"\bdefine\b",
    r"\btell\s+me\s+about\b",
]

# --- CN interrogative patterns ---
_CN_INTERROGATIVE_PATTERNS = [
    r"什么是",
    r"如何",
    r"为什么",
    r"怎么",
    r"解释",
    r"描述",
    r"介绍",
]

_COMPILED_COMPARISON_EN = [re.compile(p, re.IGNORECASE) for p in _EN_COMPARISON_PATTERNS]
_COMPILED_COMPARISON_CN = [re.compile(p) for p in _CN_COMPARISON_PATTERNS]
_COMPILED_INTERROGATIVE_EN = [re.compile(p, re.IGNORECASE) for p in _EN_INTERROGATIVE_PATTERNS]
_COMPILED_INTERROGATIVE_CN = [re.compile(p) for p in _CN_INTERROGATIVE_PATTERNS]


def _is_cjk_dominant(text: str) -> bool:
    """Check if text is predominantly CJK characters."""
    cjk_count = sum(1 for ch in text if "\u4e00" <= ch <= "\u9fff")
    return cjk_count > len(text) / 3


def _is_short_query(query: str) -> bool:
    """Check if query is short/ambiguous (keyword-style).

    EN: <= 4 words, no question mark.
    CJK: <= 8 non-space characters, no question mark.
    """
    stripped = query.strip()
    if not stripped:
        return False
    has_question_mark = stripped.endswith("?") or stripped.endswith("？")
    if has_question_mark:
        return False
    if _is_cjk_dominant(stripped):
        non_space = stripped.replace(" ", "")
        return len(non_space) <= 8
    else:
        words = stripped.split()
        return len(words) <= 4


def classify_query(query: str) -> str:
    """Classify a query into a pre-retrieval strategy using rule-based heuristics.

    Evaluation order:
    1. Multi-Query — comparison patterns or short/ambiguous queries
    2. HyDE — interrogative patterns or long questions ending with ?
    3. None — fallback

    Returns: "hyde", "multi_query", or "none"
    """
    if not query or not query.strip():
        return "none"

    q = query.strip()

    # 1. Check comparison patterns → multi_query
    for pat in _COMPILED_COMPARISON_EN:
        if pat.search(q):
            return "multi_query"
    for pat in _COMPILED_COMPARISON_CN:
        if pat.search(q):
            return "multi_query"

    # Short/ambiguous queries → multi_query
    if _is_short_query(q):
        return "multi_query"

    # 2. Check interrogative patterns → hyde
    for pat in _COMPILED_INTERROGATIVE_EN:
        if pat.search(q):
            return "hyde"
    for pat in _COMPILED_INTERROGATIVE_CN:
        if pat.search(q):
            return "hyde"

    # Long question ending with ? → hyde
    has_question_mark = q.endswith("?") or q.endswith("？")
    if has_question_mark:
        if _is_cjk_dominant(q):
            return "hyde"
        words = q.split()
        if len(words) >= 5:
            return "hyde"

    # 3. Fallback
    return "none"


_VALID_STRATEGIES = {"hyde", "multi_query", "none"}

_CLASSIFY_SYSTEM_PROMPT = (
    "You are a query classifier for a RAG knowledge-base system. "
    "Given a user query, classify it into exactly ONE of three pre-retrieval strategies:\n\n"
    "- hyde: The query is a factual or knowledge-seeking question (e.g., 'What is X?', "
    "'How does Y work?', 'Explain Z'). HyDE generates a hypothetical answer to improve retrieval.\n"
    "- multi_query: The query is ambiguous, broad, comparative, or very short/keyword-style "
    "(e.g., 'React vs Vue', 'sorting algorithms', 'difference between X and Y'). "
    "Multi-query expands into multiple search variants.\n"
    "- none: The query is a specific lookup, file path, command, or already precise enough "
    "for direct retrieval (e.g., 'src/App.tsx error', 'list files').\n\n"
    "Reply with ONLY the strategy name: hyde, multi_query, or none. "
    "Do not include any explanation or extra text."
)


async def classify_query_llm(query: str, config: AppConfig) -> str:
    """Classify a query using an LLM for more nuanced strategy selection.

    Falls back to rule-based classify_query() on empty/invalid LLM response or errors.

    Returns: "hyde", "multi_query", or "none"
    """
    if not query or not query.strip():
        return "none"

    try:
        model = create_chat_model(config)
        messages = [
            SystemMessage(content=_CLASSIFY_SYSTEM_PROMPT),
            HumanMessage(content=f"Query: {query.strip()}"),
        ]
        response = await model.ainvoke(messages)
        content = response.content
        if not content or not content.strip():
            logger.warning("LLM classifier returned empty response, falling back to rule-based")
            return classify_query(query)
        result = content.strip().lower()
        if result not in _VALID_STRATEGIES:
            logger.warning("LLM classifier returned invalid strategy '%s', falling back to rule-based", result)
            return classify_query(query)
        return result
    except Exception:
        logger.warning("LLM classifier failed, falling back to rule-based", exc_info=True)
        return classify_query(query)
