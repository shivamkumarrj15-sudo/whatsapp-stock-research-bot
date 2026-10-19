#!/usr/bin/env bash
set -e

echo "[+] Starting OpenWA WhatsApp Gateway on port 2785..."
cd /app/OpenWA
node dist/main.js &
OPENWA_PID=$!

echo "[*] Waiting for OpenWA server to become ready on http://localhost:2785..."
until curl -s http://localhost:2785/api/health > /dev/null 2>&1; do
    sleep 2
done
echo "[✓] OpenWA is UP and HEALTHY!"

cd /app
echo "[+] Starting Institutional Equity Research Engine & Listener..."
python -u whatsapp_research_engine.py &
BOT_PID=$!

# Wait on either process
wait -n $OPENWA_PID $BOT_PID
