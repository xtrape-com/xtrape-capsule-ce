# Public Review readiness

This checklist tracks the minimum engineering checks before inviting public
review for the pre-v0.1 Public Preview.

## Repository checks

- Public README and documentation links are present and do not contain empty
  placeholders.
- Public docs do not mention private/internal naming.
- Public docs do not advertise unreleased container images as the primary
  quick start path.
- Sidecar or standalone agent flows are described as roadmap or future
  capability until they are implemented and validated.

## Contract checks

- `HealthStatus` remains the runtime health signal:
  `UP`, `DEGRADED`, `DOWN`, `UNKNOWN`.
- `effectiveStatus` remains the console-derived lifecycle signal:
  `HEALTHY`, `UNHEALTHY`, `STALE`, `OFFLINE`.
- Public error codes and schema names are presented as pre-v0.1 preview
  contracts, not stable post-v1 guarantees.

## Local validation

Run these commands from the CE repository root before tagging the Public Review
candidate:

```bash
pnpm install
pnpm release:check
```

`pnpm release:check` should include the CE engineering validation path:
`contracts:check`, `db:validate`, `typecheck`, and `build`.

If running checks individually, use:

```bash
pnpm contracts:check
pnpm db:validate
pnpm typecheck
pnpm build
```

## CI validation

- CE CI runs `contracts:check`, `db:validate`, `typecheck`, and `build`.
- Agent SDK CI runs `build`, `typecheck`, and `test`.
- Contracts CI runs `build`, `typecheck`, and `test`.
- Site CI runs `docs:build`.

## Review intake

- Public Review feedback issue template is available in the CE repository.
- Feedback issues should identify the affected area: CE, Agent SDK, Contracts,
  Site/docs, Quick Start, deployment, security, or API design.
- Follow-up issues should separate documentation corrections from behavioral or
  contract changes.

## Start criteria

- [ ] site `pnpm docs:build` passed.
- [ ] contracts-node `pnpm build` passed.
- [ ] contracts-node `pnpm typecheck` passed.
- [ ] contracts-node `pnpm test` passed.
- [ ] agent-node `pnpm build` passed.
- [ ] agent-node `pnpm typecheck` passed.
- [ ] agent-node `pnpm test` passed.
- [ ] CE fresh `pnpm install` passed.
- [ ] CE `pnpm contracts:check` passed.
- [ ] CE `pnpm db:validate` passed.
- [ ] CE `pnpm typecheck` passed.
- [ ] CE `pnpm build` passed.
- [ ] Public docs contain no private/internal product names.
- [ ] Public examples contain no provider-specific SDK endpoint variables.
- [ ] Public docs contain no unresolved placeholder markers.
- [ ] Public Review feedback issue or issue template exists.
- [ ] Live site is accessible.
- [ ] `xtrape-capsule-docs` remains private and is not used as the public
      review entry point.
