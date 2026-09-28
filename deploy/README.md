# Deployment — EU VPS

This slice ships deployment artifacts only. Provisioning and TLS require a live server.

## Prerequisites

- Node.js 22 LTS
- Caddy 2.x
- systemd
- A DNS A/AAAA record pointing at the VPS

## First-time setup

1. Create a system user and data directory:

   ```bash
   sudo useradd --system --home /opt/hugo --shell /usr/sbin/nologin hugo
   sudo mkdir -p /var/lib/hugo /opt/hugo
   sudo chown hugo:hugo /var/lib/hugo /opt/hugo
   ```

2. Copy the built application to `/opt/hugo` (build on the server or rsync `.next`, `node_modules`, `package.json`, `drizzle/`, and `public/`).

3. Create `/etc/hugo/hugo.env` from `.env.example` with real values. Never commit secrets.

4. Install the systemd unit:

   ```bash
   sudo cp deploy/hugo.service /etc/systemd/system/hugo.service
   sudo systemctl daemon-reload
   sudo systemctl enable hugo
   sudo systemctl start hugo
   ```

5. Install the Caddy site block:

   ```bash
   sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

   Caddy obtains and renews TLS certificates automatically.

## Migrations

Drizzle migrations run idempotently on application boot via `src/instrumentation.ts`. A manual run is also available:

```bash
npm run db:migrate
```

## Reboot survival

Both `hugo.service` and `caddy` are enabled via systemd and start on boot. No cron jobs or systemd timers are used: the app itself sweeps Drive every 15 minutes and on Drive notifications (ADR 0020).

## Drive notifications

With `DRIVE_WEBHOOK_URL=https://hugo.example.eu/api/drive/notifications`, the app asks Drive to notify it of changes and renews that channel every week. Caddy's certificate must be valid — Google will not call a self-signed or mismatched one. Without the variable the app only polls, and new files are read within the poll interval.

## Verify

```bash
curl -I https://hugo.example.eu
sudo systemctl status hugo caddy
```

Unauthenticated requests to `/companies` must receive a redirect to sign-in, not a client-only hide.
