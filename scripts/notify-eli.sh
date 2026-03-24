#!/bin/bash
# Send a message to Elias via Eli's Telegram bot
# Usage: ./notify-eli.sh "Your message here"

source /Users/elias/eli-agent/.env

MESSAGE="$1"
if [ -z "$MESSAGE" ]; then
  echo "Usage: notify-eli.sh 'message'"
  exit 1
fi

curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d chat_id="${TELEGRAM_CHAT_ID}" \
  -d text="${MESSAGE}" \
  -d parse_mode="Markdown" > /dev/null 2>&1

echo "Notification sent"
