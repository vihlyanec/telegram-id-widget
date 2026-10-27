#!/usr/bin/env bash
# Guided installer for a dedicated Ubuntu 22.04/24.04 server.
set -Eeuo pipefail
umask 077
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"
# shellcheck source=scripts/installer-lib.sh
. "$PROJECT_DIR/scripts/installer-lib.sh"
fail() { printf '\nОшибка: %s\n' "$1" >&2; exit 1; }
trap 'printf "\nУстановка прервана. Секреты не выводятся. См. README → Если что-то не работает.\n" >&2' ERR

[[ "$(id -u)" = 0 ]] || fail 'Запустите мастер командой sudo bash install.sh'
[[ -r /etc/os-release ]] || fail 'Нужен сервер Ubuntu 22.04 или 24.04.'
# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" = ubuntu && ( "${VERSION_ID:-}" = 22.04 || "${VERSION_ID:-}" = 24.04 ) ]] ||
  fail 'Мастер рассчитан на Ubuntu 22.04/24.04. Для другой ОС используйте docs/advanced.md.'
[[ -t 0 ]] || fail 'Запустите мастер в интерактивном терминале сервера.'
printf '\nTelegram ID Widget — установка на ваш сервер\n'
printf 'Нужны домен, email, api_id, api_hash и токен НОВОГО отдельного бота.\n'

reuse=no
if [[ -f .env ]]; then
  read -r -p 'Настройки .env уже есть. Использовать их? [Y/n] ' reply
  case "$reply" in n|N|no|NO) ;; *) reuse=yes ;; esac
fi
if [[ "$reuse" = yes ]]; then
  APP_DOMAIN="$(sed -n 's/^APP_DOMAIN=//p' .env | head -n 1)"
  valid_domain "$APP_DOMAIN" || fail 'В .env неверный APP_DOMAIN. Исправьте его или запустите мастер с новыми настройками.'
else
  read -r -p '1/5. Домен без https:// и слеша: ' APP_DOMAIN
  APP_DOMAIN="$(printf '%s' "$APP_DOMAIN" | tr '[:upper:]' '[:lower:]')"
  valid_domain "$APP_DOMAIN" || fail 'Введите свой настоящий домен без https://, пробелов и слеша.'
  read -r -p '2/5. Email для HTTPS-сертификата: ' ACME_EMAIL
  valid_email "$ACME_EMAIL" || fail 'Проверьте email.'
  read -r -p '3/5. api_id (только цифры): ' TG_API_ID
  valid_api_id "$TG_API_ID" || fail 'api_id должен быть положительным числом.'
  read -r -s -p '4/5. api_hash (ввод скрыт): ' TG_API_HASH
  printf '\n'
  valid_api_hash "$TG_API_HASH" || fail 'api_hash: 32 символа, без подписи и кавычек.'
  read -r -s -p '5/5. Токен нового бота (ввод скрыт): ' TG_BOT_TOKEN
  printf '\n'
  valid_bot_token "$TG_BOT_TOKEN" || fail 'Проверьте токен из BotFather.'
fi

printf '\nПроверяем сервер…\n'
command -v ss >/dev/null || fail 'Нужна команда ss для проверки портов. Установите пакет iproute2.'
owns_ports=no
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  if docker compose ps --services --status running 2>/dev/null | grep -qx caddy; then owns_ports=yes; fi
fi
if [[ "$owns_ports" != yes ]]; then
  [[ -z "$(ss -H -ltn '( sport = :80 or sport = :443 )')" ]] ||
    fail 'Порты 80/443 уже заняты. Мастер не отключает чужие сайты. Используйте отдельный VPS или docs/advanced.md.'
fi
if ! command -v docker >/dev/null 2>&1; then
  installed_packages="$(dpkg-query -W -f='${Status}\n' docker.io podman-docker containerd runc 2>/dev/null || true)"
  if grep -q 'install ok installed' <<< "$installed_packages"; then
    fail 'Есть существующие контейнерные пакеты. Мастер не удаляет их. Настройте Docker по docs/advanced.md.'
  fi
  printf 'Устанавливаем Docker из официального репозитория…\n'
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi
docker compose version >/dev/null 2>&1 || fail 'Не найден Docker Compose plugin. См. docs/advanced.md.'
docker info >/dev/null 2>&1 || fail 'Docker не отвечает. Проверьте его состояние у хостинга.'
command -v curl >/dev/null || apt-get install -y curl ca-certificates

if [[ "$reuse" != yes ]]; then
  if [[ -e .env ]]; then cp -p .env ".env.backup-$(date -u +%Y%m%dT%H%M%SZ)"; fi
  write_env "$PROJECT_DIR/.env"
  unset TG_API_HASH TG_BOT_TOKEN
fi
chmod 600 .env
docker compose config --quiet
printf '\nСобираем и запускаем сервис. Это может занять несколько минут…\n'
docker compose up -d --build --wait --wait-timeout 180
printf '\nЖдём HTTPS. DNS и порты 80/443 должны вести на этот сервер…\n'
ready=no
for attempt in $(seq 1 24); do
  if curl --noproxy '*' -fsS --max-time 5 "https://$APP_DOMAIN/health" 2>/dev/null | grep -q '"ok":true'; then
    ready=yes
    break
  fi
  printf '.'
  sleep 3
done
if [[ "$ready" != yes ]]; then
  printf '\nКонтейнеры запущены, но публичный HTTPS ещё не подтверждён.\n'
  printf 'Проверьте DNS, порты и журнал: sudo docker compose logs --tail 50 lookup caddy\n'
  exit 1
fi
printf '\nГотово!\nДемо: https://%s/demo.html\nСкрипт: https://%s/widget.js\n' "$APP_DOMAIN" "$APP_DOMAIN"
printf 'Дальше откройте README → Шаг 5. Подключите к сайту.\n'
