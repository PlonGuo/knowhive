"""KnowHive PDF plugin: PDF → DocumentIR JSON.

The host app (KnowHive's TS sidecar) spawns `knowhive-pdf --stdio`, feeds file
paths on stdin, and reads one JSON object per line on stdout. The IR schema is
the TS side's DocumentIR (server/src/documentIr.ts); SCHEMA_VERSION gates
compatibility across releases.
"""

__version__ = "0.1.0"

# Bump when the emitted IR shape changes incompatibly. The host refuses to talk
# to a plugin whose schema_version it doesn't know.
SCHEMA_VERSION = 1
