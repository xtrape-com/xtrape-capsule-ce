# Release Checklist

## Pre-release verification

```bash
pnpm install --frozen-lockfile
pnpm contracts:check
pnpm db:validate
pnpm typecheck
pnpm test
pnpm smoke:demo
pnpm test:docker-smoke
pnpm release:check
```

## Required release files

- `VERSION`
- `CHANGELOG.md`
- `LICENSE`
- `NOTICE`
- `README.md`
- `deploy/README.md`
- `.env.example`

## Manual release steps

1. Confirm `VERSION` matches root `package.json`.
2. Confirm workspace package versions are aligned for release packages.
3. Confirm `.env.example` has no production secret values.
4. Confirm Docker Compose config parses.
5. Create a signed git tag:

```bash
git tag -s v$(cat VERSION) -m "Opstage CE v$(cat VERSION)"
```

6. Build release image:

```bash
docker build -f deploy/docker/Dockerfile -t xtrape/opstage-ce:$(cat VERSION) .
```

7. Publish release notes from `CHANGELOG.md`.
