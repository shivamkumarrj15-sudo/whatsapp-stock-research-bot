#!/usr/bin/env bash
set -e

APP_PORT="${PORT:-2785}"
export PORT="$APP_PORT"

echo "[+] Starting OpenWA WhatsApp Gateway on port ${APP_PORT}..."
cd /app/OpenWA
mkdir -p data/sessions data/media data/plugins

node dist/main.js &
OPENWA_PID=$!

echo "[*] Waiting for OpenWA server to become ready on http://localhost:${APP_PORT}..."
until curl -s "http://localhost:${APP_PORT}/api/health" > /dev/null 2>&1; do
    sleep 2
done
echo "[✓] OpenWA is UP and HEALTHY on port ${APP_PORT}!"

cd /app
echo "[+] Starting Institutional Equity Research Engine & Listener..."
export OPENWA_URL="http://localhost:${APP_PORT}"
python -u whatsapp_research_engine.py &
BOT_PID=$!

# Wait on either process
wait -n $OPENWA_PID $BOT_PID
