#!/usr/bin/env bash
for f in /tmp/mohalla-e2e-api.pid /tmp/mohalla-e2e-web.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; rm -f "$f"; done
pkill -f "tsx src/serve[r].ts" 2>/dev/null || true
exit 0
