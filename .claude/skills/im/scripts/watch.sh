#!/usr/bin/env bash
# IM message monitor — run in a separate tmux pane or terminal.
# Polls chat server every 2s, prints new messages.
# Reads token from $HOME/.im-token (must login first via /im-login).
set -euo pipefail

SERVER="http://192.168.5.116:9999"
TOKEN_FILE="$HOME/.im-token"
LAST_TS=$(date +%s)
LAST_MSG_ID=0

if [ ! -f "$TOKEN_FILE" ]; then
    echo "No token found — run /im-login first"
    exit 1
fi
TOKEN=$(cat "$TOKEN_FILE")

# Resolve username from token
ME=$(curl -s "${SERVER}/history?limit=1&token=${TOKEN}" 2>/dev/null | python3 -c "
import json,sys
msgs = json.load(sys.stdin).get('messages',[])
print('ok')  # token is valid
" 2>/dev/null || echo "")
if [ "$ME" != "ok" ]; then
    echo "Token invalid — re-run /im-login"
    exit 1
fi

echo "IM monitor — Ctrl+C to exit"
echo "─────────────────────────────────────────"

while true; do
    resp=$(curl -s "${SERVER}/poll?since=${LAST_TS}&token=${TOKEN}" 2>/dev/null || true)
    now=$(echo "$resp" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('now',0))" 2>/dev/null || echo 0)
    [[ "$now" == "0" ]] && { sleep 2; continue; }

    msgs=$(echo "$resp" | python3 -c "
import json,sys
for m in json.load(sys.stdin).get('messages',[]):
    to = f' → {m[\"to\"]}' if m.get('to') else ''
    print(f'{m[\"from\"]}{to}\t{m[\"text\"]}\t{m[\"id\"]}')
" 2>/dev/null)

    if [ -n "$msgs" ]; then
        while IFS=$'\t' read -r from text mid; do
            [ -z "$from" ] && continue
            mid_int=${mid:-0}
            if [ "$mid_int" -gt "${LAST_MSG_ID:-0}" ] 2>/dev/null; then
                TIME=$(date +%H:%M)
                echo "[$TIME] <$from> $text"
                LAST_MSG_ID=$mid_int
            fi
        done <<< "$msgs"
    fi

    LAST_TS=${now%.*}
    sleep 2
done
