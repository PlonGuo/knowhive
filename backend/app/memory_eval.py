# Memory eval A/B: does cross-session long-term memory lift answer quality?
# Each scenario plants a USER-SPECIFIC anchor (not in the KB, not in the question),
# then a FRESH session asks a memory-dependent question.
#   ON  arm: reset memory -> plant -> wait for distillation -> ask (memory present)
#   OFF arm: reset memory -> ask directly            (memory absent)
# memory_recall = fraction of scenarios whose answer contains an anchor.
# OFF hit-rate is the honesty check: a valid item must MISS on OFF (anchor is truly
# memory-dependent, not derivable from the KB or the question).
import json, sqlite3, sys, time, urllib.request

import argparse

_ap = argparse.ArgumentParser()
_ap.add_argument("--base", default="http://127.0.0.1:18302", help="sidecar base URL")
_ap.add_argument("--db", required=True, help="path to the sidecar's knowhive.db (for memory reset/inspect)")
_ap.add_argument("--out", default="eval_results/memory_eval.json")
_ARGS = _ap.parse_args()
BASE, DB, OUT = _ARGS.base, _ARGS.db, _ARGS.out


def post(session_id: str, text: str) -> str:
    payload = {
        "session_id": session_id,
        "messages": [{"id": "1", "role": "user", "parts": [{"type": "text", "text": text}]}],
    }
    req = urllib.request.Request(
        f"{BASE}/chat", data=json.dumps(payload).encode(), headers={"content-type": "application/json"}
    )
    answer = ""
    with urllib.request.urlopen(req, timeout=180) as resp:
        for raw in resp:
            line = raw.decode("utf-8").strip()
            if not line.startswith("data: ") or line == "data: [DONE]":
                continue
            try:
                evt = json.loads(line[6:])
            except json.JSONDecodeError:
                continue
            if evt.get("type") == "text-delta":
                answer += evt.get("delta", "")
    return answer


def reset_memory():
    con = sqlite3.connect(DB)
    con.execute("DELETE FROM memories")
    con.execute("DELETE FROM chat_messages")
    con.execute("DELETE FROM chat_summaries")
    con.execute("DELETE FROM sessions")
    con.commit()
    con.close()


def mem_count():
    con = sqlite3.connect(DB)
    n = con.execute("SELECT COUNT(*) FROM memories WHERE kind IN ('semantic','procedural')").fetchone()[0]
    con.close()
    return n


def is_chinese(s: str) -> bool:
    return any("一" <= ch <= "鿿" for ch in s)


# anchors: substrings that only appear if the user-specific fact was recalled.
# match: "any" (>=1 anchor present) or "chinese" (answered in Chinese, procedural pref).
SCENARIOS = [
    {
        "id": "company",
        "plant": ["我在准备 Rippling 这家公司的面试,帮我看看图论。", "谢谢,我会好好准备。"],
        "q": "提醒我一下,我正在准备哪家公司的面试?",
        "anchors": ["Rippling"],
    },
    {
        "id": "language-pref",
        "plant": ["From now on always answer me in Chinese, 这是我的硬性要求。", "好的谢谢。"],
        "q": "Give me one tip for reviewing graph algorithms.",
        "match": "chinese",
    },
    {
        "id": "name",
        "plant": ["我叫 Jason,正在刷题准备面试。", "嗯,继续。"],
        "q": "你还记得我叫什么名字吗?",
        "anchors": ["Jason"],
    },
    {
        "id": "tool-pref",
        "plant": ["我只用 Python 刷题,特别依赖 heapq 这个库。", "对,就是这样。"],
        "q": "推荐我练最短路时用什么方式实现?",
        "anchors": ["Python", "heapq"],
    },
    {
        "id": "least-familiar",
        "plant": ["我别的还行,就是并查集 union-find 最不熟,老出错。", "是的,这块最弱。"],
        "q": "我最应该优先补哪一个数据结构?",
        "anchors": ["并查集", "union", "Union"],
    },
    {
        "id": "deadline",
        "plant": ["我的面试定在 7 月 25 号,时间挺紧的。", "所以得抓紧。"],
        "q": "我大概还剩多少时间准备,面试是哪天来着?",
        "anchors": ["25", "7 月", "7月"],
    },
    {
        "id": "prior-plan",
        "plant": ["我们说好了复习顺序:先图论,再动态规划,最后字符串。", "对,就按这个来。"],
        "q": "我们之前商量的复习顺序是怎样的?",
        "anchors": ["图论"],  # scored together with the ordering check below
        "all_of": ["图论", "字符串"],
    },
    {
        "id": "constraint",
        "plant": ["我这次只想主攻中等难度题,hard 先不碰。", "嗯,难度就中等。"],
        "q": "给我定个刷题的难度范围。",
        "anchors": ["中等", "medium", "Medium"],
    },
]


def hit(scn, ans: str) -> bool:
    if scn.get("match") == "chinese":
        return is_chinese(ans)
    if scn.get("all_of"):
        return all(a in ans for a in scn["all_of"])
    return any(a in ans for a in scn["anchors"])


def main():
    results = []
    for i, scn in enumerate(SCENARIOS, 1):
        sid_on, sid_off = f"on-{scn['id']}", f"off-{scn['id']}"

        # OFF arm: no memory.
        reset_memory()
        off_ans = post(sid_off, scn["q"])
        off_hit = hit(scn, off_ans)

        # ON arm: plant -> distill -> ask.
        reset_memory()
        for t in scn["plant"]:
            post(sid_on + "-plant", t)
            time.sleep(1)
        time.sleep(6)  # async distillation
        planted = mem_count()
        on_ans = post(sid_on, scn["q"])
        on_hit = hit(scn, on_ans)

        results.append(
            {"id": scn["id"], "planted_memories": planted, "on_hit": on_hit, "off_hit": off_hit,
             "on_answer": on_ans[:240], "off_answer": off_ans[:240]}
        )
        flag = "" if not off_hit else "  ⚠ LEAKY(off hit)"
        print(f"[{i}/{len(SCENARIOS)}] {scn['id']:16} planted={planted:2}  ON={'HIT' if on_hit else 'miss'}  OFF={'hit' if off_hit else 'miss'}{flag}")

    n = len(results)
    on_rate = sum(r["on_hit"] for r in results) / n
    off_rate = sum(r["off_hit"] for r in results) / n
    valid = [r for r in results if not r["off_hit"]]
    on_rate_valid = (sum(r["on_hit"] for r in valid) / len(valid)) if valid else 0.0
    summary = {
        "n": n,
        "memory_recall_on": round(on_rate, 3),
        "memory_recall_off": round(off_rate, 3),
        "memory_recall_on_valid_items_only": round(on_rate_valid, 3),
        "valid_items": len(valid),
        "results": results,
    }
    print("\n=== SUMMARY ===")
    print(f"  memory_recall ON  = {on_rate:.2f}")
    print(f"  memory_recall OFF = {off_rate:.2f}  (leaky items: {n - len(valid)})")
    print(f"  ON on valid-only  = {on_rate_valid:.2f}  ({len(valid)} items)")
    with open(OUT, "w") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f"  wrote {OUT}")


if __name__ == "__main__":
    main()
