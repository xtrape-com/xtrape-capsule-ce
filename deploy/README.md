# Opstage CE Deployment

## Local container deployment

1. Create an environment file from the root template:

```bash
cp .env.example .env
```

2. Edit `.env` before first boot:

- `OPSTAGE_ADMIN_USERNAME`
- `OPSTAGE_ADMIN_PASSWORD` — at least 12 characters
- `OPSTAGE_SESSION_SECRET` — at least 32 characters, random

3. Build and start:

```bash
docker compose -f deploy/compose/docker-compose.yml up --build -d
```

4. Open the console:

```text
http://localhost:8080
```

The backend serves the built React UI from `OPSTAGE_STATIC_DIR` and stores SQLite data under the `opstage-data` Docker volume mounted at `/app/data`.

## Health checks

Container health uses:

```bash
node scripts/healthcheck.mjs
```

The script calls `/api/system/health` and expects `data.status = UP`.

## Operational notes

- Logs are written to stdout/stderr for collection by Docker or the host runtime.
- Keep `.env` out of version control.
- Rotate `OPSTAGE_SESSION_SECRET` only when you are prepared to invalidate all active sessions.
- Back up the `opstage-data` volume for SQLite persistence.

## Backups and exports

Owners can create a SQLite backup from Settings or by calling `POST /api/admin/backup/sqlite`. Backups are also written inside `OPSTAGE_BACKUP_DIR` before being returned to the caller. Audit events can be exported as CSV or JSON from the Audit Events page.

For Docker deployments, `/app/data/backups` is inside the persisted `opstage-data` volume.
