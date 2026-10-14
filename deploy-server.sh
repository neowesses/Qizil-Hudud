#!/bin/bash
# QIZIL HUDUD — публикация нового сайта на сервер (запускается на сервере)
# Старый сайт сохраняется в резервную копию, новый кладётся в корень сайта,
# старый сайт (уже внутри архива) открывается по адресу /red
set -euo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
CONF=$(mktemp)
nginx -T > "$CONF" 2>/dev/null || true
DOMAIN="qizil-hudud.milliybiz.uz"
ZIP="/tmp/qizil-hudud-new-site.zip"
ROOT="${1:-}"

echo "== 1/5 Ищу папку сайта $DOMAIN в настройках nginx..."
if [ -z "$ROOT" ]; then
  ROOT=$(awk -v d="$DOMAIN" '
    { line=$0; o=gsub(/\{/,"{",line); c=gsub(/\}/,"}",line) }
    !inblk && $0 ~ /^[[:space:]]*server[[:space:]]*\{/ { inblk=1; start=depth; hasd=0; r="" }
    inblk && $0 ~ /server_name/ && index($0,d) { hasd=1 }
    inblk && r=="" && $0 ~ /^[[:space:]]*root[[:space:]]/ { r=$0 }
    { depth+=o-c }
    inblk && depth==start { inblk=0; if (hasd && r!="") { sub(/^[[:space:]]*root[[:space:]]+/,"",r); sub(/;.*/,"",r); print r; exit } }' "$CONF")
fi
if [ -z "$ROOT" ] || [ ! -d "$ROOT" ]; then
  echo "!! Не нашёл папку сайта автоматически. Посмотрите строку root в настройках:"
  grep -n -E "configuration file|server_name|root |proxy_pass" "$CONF" | head -60
  echo "!! Запустите ещё раз, указав папку:  bash /tmp/deploy-server.sh /путь/к/папке"
  exit 1
fi
echo "   Папка сайта: $ROOT"

echo "== 2/5 Проверяю архив..."
command -v unzip >/dev/null || (dnf -y install unzip || yum -y install unzip || apt-get install -y unzip) >/dev/null
TMP=$(mktemp -d)
unzip -q "$ZIP" -d "$TMP"
test -f "$TMP/index.html" && test -f "$TMP/red/index.html" && test -d "$TMP/frames/desktop" || { echo "!! Архив неполный"; exit 1; }

BACKUP="/root/qizil-hudud-backup-$(date +%Y%m%d-%H%M%S)"
echo "== 3/5 Резервная копия текущего сайта -> $BACKUP"
cp -a "$ROOT" "$BACKUP"

echo "== 4/5 Публикую новый сайт..."
OWNER=$(stat -c '%U:%G' "$ROOT")
find "$ROOT" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -r "$TMP"/. "$ROOT"/
chown -R "$OWNER" "$ROOT"
find "$ROOT" -type d -exec chmod 755 {} +
find "$ROOT" -type f -exec chmod 644 {} +
command -v restorecon >/dev/null && restorecon -R "$ROOT" || true
rm -rf "$TMP"

echo "== 5/5 Проверяю nginx..."
nginx -t
systemctl reload nginx 2>/dev/null || nginx -s reload || true

echo
echo "ГОТОВО!"
echo "  Новый сайт:  https://$DOMAIN/"
echo "  Старый сайт: https://$DOMAIN/red"
echo "  Резервная копия старой версии сервера: $BACKUP"
echo "  Откатить всё назад:  rm -rf $ROOT/* && cp -a $BACKUP/. $ROOT/"
