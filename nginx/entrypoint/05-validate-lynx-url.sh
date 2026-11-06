#!/bin/sh
# Refuse to start if LYNX_URL could point the proxy somewhere unintended (misconfiguration guard).
#   - must be https://<host>[:port] with NO path and NO trailing slash
#     (a path would change how nginx maps /api/... and /mqtt)
#   - host must be listed in ALLOWED_LYNX_HOSTS (comma separated, default lynx.iotopen.se)
#   - plain http:// only when ALLOW_INSECURE_LYNX_URL=true (local demo/mock)
set -eu

url="${LYNX_URL:-}"
allowed="${ALLOWED_LYNX_HOSTS:-lynx.iotopen.se}"
insecure="${ALLOW_INSECURE_LYNX_URL:-false}"

fail() {
  echo "ERROR: LYNX_URL='$url' rejected: $1" >&2
  exit 1
}

[ -n "$url" ] || fail "not set"

case "$url" in
  https://*) rest="${url#https://}" ;;
  http://*)
    [ "$insecure" = "true" ] || fail "must use https:// (set ALLOW_INSECURE_LYNX_URL=true only for local demos)"
    rest="${url#http://}"
    ;;
  *) fail "must start with https://" ;;
esac

# no path, query, fragment, credentials or trailing slash
case "$rest" in
  */* | *\?* | *\#* | *@*) fail "only scheme://host[:port] is allowed – remove any path, trailing slash, query or credentials" ;;
esac

host="${rest%%:*}"
port=""
[ "$host" != "$rest" ] && port="${rest#*:}"

# hostname: letters, digits, dots and dashes only
echo "$host" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$' || fail "invalid host name '$host'"
if [ -n "$port" ]; then
  echo "$port" | grep -Eq '^[0-9]{1,5}$' || fail "invalid port '$port'"
fi

ok=false
for h in $(echo "$allowed" | tr ',' ' '); do
  [ "$(echo "$host" | tr 'A-Z' 'a-z')" = "$(echo "$h" | tr 'A-Z' 'a-z')" ] && ok=true
done
[ "$ok" = true ] || fail "host '$host' is not in ALLOWED_LYNX_HOSTS ($allowed)"

echo "LYNX_URL ok: $url"

# BASE_PATH: "" (served at /) or "/segment[/segment…]" without trailing slash, e.g. "/dashboard".
# It ends up in nginx location paths and regexes, so only plain path characters are accepted.
base="${BASE_PATH:-}"
if [ -n "$base" ]; then
  echo "$base" | grep -Eq '^(/[A-Za-z0-9._~-]+)+$' \
    || { echo "ERROR: BASE_PATH='$base' rejected: use \"\" or e.g. \"/dashboard\" (no trailing slash, letters, digits, . _ ~ -)" >&2; exit 1; }
fi
echo "BASE_PATH ok: '${base}'"

case "${API_MODE:-proxy}" in
  proxy | direct) echo "API_MODE ok: ${API_MODE:-proxy}" ;;
  *) echo "ERROR: API_MODE='$API_MODE' rejected: use proxy or direct" >&2; exit 1 ;;
esac

case "${CUSTOM_SERVERS:-true}" in
  true | false) echo "CUSTOM_SERVERS ok: ${CUSTOM_SERVERS:-true}" ;;
  *) echo "ERROR: CUSTOM_SERVERS='$CUSTOM_SERVERS' rejected: use true or false" >&2; exit 1 ;;
esac

# MAP_TILES: map background of the Tracker widget, "" = none. An https URL template with {z}, {x} and {y};
# it ends up in the CSP (img-src) and in config.json, so only plain URL characters are accepted.
tiles="${MAP_TILES:-}"
if [ -n "$tiles" ]; then
  echo "$tiles" | grep -Eq '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/[A-Za-z0-9._~/{}=&?%-]*$' \
    || { echo "ERROR: MAP_TILES='$tiles' rejected: use e.g. https://tile.openstreetmap.org/{z}/{x}/{y}.png (https only)" >&2; exit 1; }
  for p in '{z}' '{x}' '{y}'; do
    case "$tiles" in *"$p"*) ;; *) echo "ERROR: MAP_TILES='$tiles' rejected: $p is missing" >&2; exit 1 ;; esac
  done
fi
echo "MAP_TILES ok: '${tiles}'"

# APP_TITLE is written into config.json inside the nginx configuration and shown as the page title: one line,
# no quotes, backslashes, $, < or >
case "${APP_TITLE:-}" in
  *\"* | *\'* | *\\* | *\$* | *\<* | *\>*) echo "ERROR: APP_TITLE rejected: no quotes, backslashes, \$, < or >" >&2; exit 1 ;;
esac
if [ "$(printf '%s' "${APP_TITLE:-}" | tr -d '[:cntrl:]')" != "${APP_TITLE:-}" ]; then
  echo "ERROR: APP_TITLE rejected: one line, no control characters" >&2; exit 1
fi
case "${LIVE_UPDATES:-true}" in
  true | false) echo "LIVE_UPDATES ok: ${LIVE_UPDATES:-true}" ;;
  *) echo "ERROR: LIVE_UPDATES='$LIVE_UPDATES' rejected: use true or false" >&2; exit 1 ;;
esac

# TRUSTED_PROXIES: the reverse proxies / load balancers in front (comma separated IPs or CIDRs). Their
# X-Forwarded-For then gives the client's own address, for the login rate limit and for what IoT Open sees.
# Empty = the connecting address is the client (no proxy in front, or every user counted as the proxy).
REAL_IP_CONF="${REAL_IP_CONF:-/etc/nginx/conf.d/00-real-ip.conf}"
proxies="${TRUSTED_PROXIES:-}"
{
  echo "# Written by 05-validate-lynx-url.sh from TRUSTED_PROXIES."
  if [ -n "$proxies" ]; then
    for p in $(echo "$proxies" | tr ',' ' '); do
      echo "$p" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}(/[0-9]{1,2})?$|^[0-9A-Fa-f:]*:[0-9A-Fa-f:.]*(/[0-9]{1,3})?$' \
        || { echo "ERROR: TRUSTED_PROXIES entry '$p' rejected: use IP addresses or CIDRs, e.g. 10.0.0.0/8,192.168.1.10" >&2; exit 1; }
      echo "set_real_ip_from $p;"
    done
    echo "real_ip_header X-Forwarded-For;"
    echo "real_ip_recursive on;"
  fi
} > "$REAL_IP_CONF" || exit 1
echo "TRUSTED_PROXIES ok: '${proxies}'"

# MAP_ATTRIBUTION is shown on the map; it is written into config.json, so no quotes, backslashes or $.
case "${MAP_ATTRIBUTION:-}" in
  *\"* | *\'* | *\\* | *\$* | *\<* | *\>*) echo "ERROR: MAP_ATTRIBUTION rejected: no quotes, backslashes, \$, < or >" >&2; exit 1 ;;
esac
