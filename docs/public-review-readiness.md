# Public Review readiness

This checklist tracks the minimum engineering checks before inviting public
review for the pre-v0.1 Public Preview.

## Repository checks

- Public README and documentation links are present and do not contain empty
  placeholders.
- Public docs do not mention private CAPI/internal naming.
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
