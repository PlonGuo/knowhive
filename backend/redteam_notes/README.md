# Red-team injection corpus

Malicious markdown notes for the indirect prompt-injection experiment
(learnings/evals/Prompt-Injection-Redteam.md). Each note looks like a plausible
knowledge-base entry but carries an injection payload plus a canary — a
deterministic observable signal that fires ONLY if the model obeyed the payload.

Run: backend/app/redteam_injection.py (mixes these into a scratch KB, queries
the sidecar, measures canary hit-rate per model / per mitigation).

These files are inert data. They are dangerous only when fed through a RAG
pipeline with no injection defense — which is exactly what the experiment measures.
