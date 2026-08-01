#!/bin/bash
# Fake knowhive-pdf for server tests: speaks the stdio protocol without docling.
echo '{"type":"ready","schema_version":1,"plugin_version":"9.9.9-fake","docling_version":"0.0.0"}'
while IFS= read -r p; do
  case "$p" in
    *scan*) printf '{"type":"error","path":"%s","code":"needs_ocr","message":"scanned document"}\n' "$p" ;;
    *broken*) printf '{"type":"error","path":"%s","code":"bad_text_layer","message":"broken layer"}\n' "$p" ;;
    *) printf '{"type":"result","path":"%s","ir":{"format":"pdf","blocks":[{"type":"heading","text":"Fake PDF","level":1,"order":0},{"type":"paragraph","text":"fake pdf content about self attention mechanisms in transformers","order":1}]}}\n' "$p" ;;
  esac
done
