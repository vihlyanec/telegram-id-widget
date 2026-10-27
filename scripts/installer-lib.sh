#!/usr/bin/env bash
# Shared input validation; safe to source without executing installation.
valid_domain() {
  [[ "$1" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] &&
  [[ "$1" != example.com && "$1" != *.example.com && "$1" != example.org && "$1" != *.example.org ]]
}
valid_email() { [[ "$1" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; }
valid_api_id() { [[ "$1" =~ ^[1-9][0-9]{0,14}$ ]]; }
valid_api_hash() { [[ "$1" =~ ^[a-fA-F0-9]{32}$ ]]; }
valid_bot_token() { [[ "$1" =~ ^[0-9]+:[A-Za-z0-9_-]{20,}$ ]]; }

write_env() {
  # Called only after validation; never source/eval the resulting file.
  local target="$1"
  (umask 077; cat > "$target" <<EOF
APP_DOMAIN=$APP_DOMAIN
ACME_EMAIL=$ACME_EMAIL
TG_API_ID=$TG_API_ID
TG_API_HASH=$TG_API_HASH
TG_BOT_TOKEN=$TG_BOT_TOKEN
ALLOWED_ORIGINS=*
EOF
  )
  chmod 600 "$target"
}
