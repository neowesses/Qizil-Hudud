#!/bin/bash
# QIZIL HUDUD — подключает Telegram-бота к формам сайта.
# Токен хранится ТОЛЬКО на сервере (/etc/nginx/qizil-hudud-tg.conf), в коде сайта его нет.
# Запуск: bash tg-setup.sh <ТОКЕН_БОТА>
set -eu
exec 1>&2
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
TOKEN="${1:-}"
CHAT="6508479737"
DOMAIN="qizil-hudud.milliybiz.uz"
SNIP="/etc/nginx/qizil-hudud-tg.conf"
[[ "$TOKEN" =~ ^[0-9]{6,}:[A-Za-z0-9_-]{30,}$ ]] || { echo "!! Токен не похож на токен бота"; exit 1; }

echo "== 1/4 Записываю настройку пересылки"
umask 077
cat > "$SNIP" <<CONF
location = /api/tg {
    limit_except POST { deny all; }
    client_max_body_size 8k;
    proxy_set_header Host api.telegram.org;
    proxy_ssl_server_name on;
    proxy_pass https://api.telegram.org/bot$TOKEN/sendMessage?chat_id=$CHAT;
}
CONF

echo "== 2/4 Подключаю к сайту $DOMAIN"
FILES=$(grep -lE "server_name[^;]*$DOMAIN" /etc/nginx/nginx.conf /etc/nginx/conf.d/*.conf /etc/nginx/sites-enabled/* 2>/dev/null || true)
[ -n "$FILES" ] || { echo "!! Не нашёл настройки сайта в nginx"; exit 1; }
for f in $FILES; do
  cp -a "$f" "$f.bak-tg"
  grep -q "qizil-hudud-tg.conf" "$f" || sed -i -E "/server_name[^;]*$DOMAIN/a\    include $SNIP;" "$f"
  echo "   $f"
done
setsebool -P httpd_can_network_connect 1 2>/dev/null || true

echo "== 3/4 Проверяю nginx"
if ! nginx -t; then
  for f in $FILES; do cp -a "$f.bak-tg" "$f"; done
  echo "!! Ошибка в настройках — всё возвращено как было"; exit 1
fi
systemctl reload nginx

echo "== 4/4 Тестовое сообщение в бота"
sleep 1
CODE=$(curl -s -o /tmp/qh-tg-test.json -w "%{http_code}" -X POST --data-urlencode "text=✅ QIZIL HUDUD: формы сайта подключены к боту" \
  --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/tg" || true)
echo "   ответ: $CODE $(head -c 200 /tmp/qh-tg-test.json 2>/dev/null)"
[ "$CODE" = "200" ] && echo "ГОТОВО! Заявки с сайта приходят в Telegram." || echo "!! Пересылка не сработала — пришлите этот вывод"
