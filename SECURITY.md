# Security

This document describes the security model of the IoT Open Dashboard, what has been checked, and what an operator must take care of when deploying it.

## Model in one paragraph

The dashboard is a static single-page app. It has no backend, no database and no secrets of its own. Every request is made **as the signed-in IoT Open user**, with that user's token, through a reverse proxy in the same container (or, if the user chose another IoT Open server at sign-in, directly to that server). **IoT Open is the authority** for who may read, write and control what; the dashboard never grants anything IoT Open does not. A compromised dashboard can therefore do whatever the signed-in account can do – which is why the account and token handling below matter most.

## What is in place

| Area | Measure |
|---|---|
| Proxy (SSRF) | nginx forwards only to one fixed `LYNX_URL`, set at start-up. Nothing in a request can change the target. The start-up script refuses a `LYNX_URL` with path, query, credentials, `http://` (unless explicitly allowed for the demo) or a host not in `ALLOWED_LYNX_HOSTS`, and a `BASE_PATH` with anything but plain path characters |
| Proxy (surface) | Only `/api/v2/…`, `GET /api/v3beta/log/…` and `/mqtt` (WebSocket upgrades only) are forwarded; everything else under `/api/` returns 404 |
| Upstream TLS | The certificate of IoT Open is verified (`proxy_ssl_verify on`, `proxy_ssl_verify_depth 3` so the full chain via the intermediate CA is accepted) |
| Brute force | `/api/v2/auth` is rate limited to 10 requests/minute per client IP (burst 5) |
| Forwarding headers | Client-supplied `X-Forwarded-*`/`Forwarded` are not passed on |
| Custom server | With `CUSTOM_SERVERS=true` (default) a user may type another IoT Open server at sign-in. Only `https://` origins without credentials, path or query are accepted (`http://` only for `localhost`). The address is saved in that browser only after a successful sign-in and cannot be preset through a link or URL parameter. The container's proxy is not involved, so this does not open the proxy for SSRF |
| Browser headers | `Content-Security-Policy` (scripts and images only from the same origin; connections from the same origin, plus any `https:`/`wss:` origin when `CUSTOM_SERVERS=true`; no objects; no framing by other sites), `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` |
| XSS | All text from IoT Open (names, texts, metadata) is rendered by React, which escapes it. The code uses no `innerHTML`/`dangerouslySetInnerHTML`/`eval` |
| CSS from metadata | Colours from metadata and the layout file are only applied if the browser accepts them as a CSS colour (`CSS.supports('color', …)`) |
| Container | `nginx-unprivileged` (non-root), port 8080, health check, multi-stage build (no sources or `node_modules` in the image) |
| Dependencies | Runtime: `react`, `react-dom` only. `npm audit`: 0 known vulnerabilities (2026-10-07) |
| Writes | Only the keys and the file listed in the README are written, and only from edit mode. Empty values delete the key (IoT Open rejects empty values) |

## Operator checklist

1. **Put TLS in front.** The container speaks plain HTTP on port 8080. Passwords, tokens and the MQTT connection (which carries the token) must only travel over HTTPS/WSS, so run it behind a TLS-terminating reverse proxy or load balancer. Add `Strict-Transport-Security` there.
2. **Real client IPs.** Behind a load balancer, configure nginx `real_ip` (`set_real_ip_from` / `real_ip_header`), otherwise the login rate limit counts all users as one IP.
3. **Least privilege accounts.**
   - Give the dashboard its own IoT Open account or API key – not shared with integrations (e.g. the Home Assistant integration) – so the IoT Open traceability log shows who wrote what.
   - A wall screen / kiosk should use an API key of a user that can **read** the installation but not write metadata or files. If that user can publish to `set/obj/…`, anyone in front of the screen can operate switches – grant control only where intended.
   - Admins who edit dashboards need write access to the installation's metadata, devices, functions and files.
4. **`dashboard.admins` is not a security boundary.** It only hides the edit button. Any user with write rights in IoT Open can change metadata through the API, including `dashboard.admins` itself. Restrict write access in IoT Open.
5. **Tokens in the browser.** The token is stored in `sessionStorage`, or in `localStorage` with *Remember me*. Anyone with access to the browser profile can use it. On shared devices: do not tick *Remember me*, and sign out. An API key does not expire and is **not revoked** by signing out – revoke it in IoT Open when a screen is retired or a device is lost.
6. **Do not deploy the mock.** `mock/server.mjs` has fixed test credentials (`demo@example.com`/`demo`, `demo-api-key`). It is only started by the `demo` compose profile and is never part of the production image.
7. **Keep secrets out of the project folder.** The project folder must not contain credential files. `*Account*.md`, the local change log and the branding source folder are excluded by `.gitignore` and `.dockerignore`, but files in a synced or shared folder (e.g. a public Nextcloud link) are still exposed. If a credential file has been in a shared folder, change that password or revoke that key.
8. **Decide on custom servers.** If the dashboard should only ever be used with your own IoT Open instance, set `CUSTOM_SERVERS=false`. The server choice is then hidden and the CSP allows connections to the same origin only, which also limits where an injected script could send a token.
9. **Pin and update the image.** Deploy a version tag (`:1.2.3`) rather than `:latest`, and rebuild regularly to pick up nginx/Alpine security updates.

## Known limitations / possible improvements

- With `CUSTOM_SERVERS=true` the CSP `connect-src` allows any `https:`/`wss:` origin. Scripts are still restricted to the same origin, so this only matters if a script injection were found. A user who types a server they do not trust sends their password or API key to it – the sign-in page always shows which server is used.
- `style-src 'unsafe-inline'` is needed because widget colours are set through style attributes. Scripts are not affected.
- `/api/v2/…` is forwarded for all methods the dashboard might need; IoT Open enforces authorisation. The allow-list could be narrowed further to the exact endpoints in `src/api/lynx.js`.
- There is no server-side session: if IoT Open accepts the token, the dashboard works. Session lifetime and 2FA policy are IoT Open's.
- Status (`dashboard.status`) written by a server-side service would need its own service account with write access to function metadata only.

## Reporting

Report security issues privately to the project owner rather than in a public issue.
