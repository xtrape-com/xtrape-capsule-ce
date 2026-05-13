# ADR 0001 — Ephemeral action-result secrets

- Status: **Accepted** (v0.1 → v0.2 carry-over)
- Date: 2026-05-08
- Edition: CE v0.1, v0.2
- Tracking issue: [xtrape-capsule-ce#12](https://github.com/xtrape-com/xtrape-capsule-ce/issues/12)

## Context

Some operator-triggered actions generate a secret as part of their result —
for example, a "rotate API key" action that returns the newly-generated key.
Two desired properties are in tension:

1. **Operator can read the secret once.** After triggering the action from
   the Opstage console, the operator must be able to copy the resulting key
   off-screen.
2. **The secret never lands in long-term storage.** The Opstage SQLite
   database persists command results forever (subject to audit retention),
   and a database leak should not expose customer secrets.

The agent already redacts secret-bearing fields at the wire boundary via
`redactSecrets()` before they hit `command_results.dataJson`, but
**specific opt-in fields** like a freshly-generated key would be valuable
to deliver to the operator once and then drop.

## Decision

`apps/opstage-backend/src/app.ts` maintains a **process-local Map**,
`ephemeralCommandSecrets`, keyed by `commandId`. When the agent reports a
command result containing a string field literally named `generatedKey`:

1. The plaintext is stored in the Map with a 5-minute TTL.
2. The persisted `command_results.dataJson` row goes through `redactSecrets()`
   as usual, so the database **never** sees the plaintext.
3. On the next read of that command's detail endpoint with
   `consumeEphemeralSecrets: true`, the stored value is injected back into
   the response and **deleted** from the Map. Subsequent reads see only the
   redacted DB value.

Background sweeps (`pruneExpiredEphemeralCommandSecrets`) drop entries past
TTL even if nobody reads them.

### Why this design (v0.1)

- **Zero new dependencies.** No Redis, no Vault, no encryption-at-rest.
- **Honors the "don't persist secrets" rule** strictly: a database leak
  doesn't expose any generated key.
- **Single-node CE.** The Map fits the v0.1 deployment story (one backend
  process, one SQLite file).

## Known limits

| Limit | Impact | Mitigation |
| --- | --- | --- |
| Lost on backend restart | If the backend restarts inside the 5-minute window, the operator who triggered the action can never see the generated key again. | Operator workflow: open the action panel immediately after triggering. Most rotations are followed by an immediate copy. v0.2+ may move to a SQLite-backed encrypted table with explicit TTL columns. |
| Single-process only | Two backend replicas would not share the Map. | CE v0.x is explicitly single-node. Documented in `editions/ce`. EE design will use a shared store. |
| Hardcoded field name (`generatedKey`) | Only that exact string triggers the cache. Other action results that produce secrets do not benefit. | v0.2 (planned): allow the action declaration to mark specific result fields as ephemeral via a contract field (e.g. `ephemeralFields: [...]`) — see [contracts-node#?](https://github.com/xtrape-com/xtrape-capsule-contracts-node/issues) (to file). |
| Plaintext sits in V8 heap | A memory dump could surface the value within the 5-minute window. | Same threat model as any in-process secret. Acceptable for CE; out-of-scope to defend against. |
| In-memory state is not auditable | Operators cannot see "X seconds remaining". | UI displays the result freshly on consume; subsequent reads show the redacted DB value. |

## Alternatives considered

- **Persist with encryption-at-rest in SQLite.** Adds a key-management
  problem (where does the KEK live?) and tilts the dependency footprint.
  Deferred to v0.2+ if needed.
- **Don't store at all; require the operator to copy from the action
  response directly.** Already the fallback. The cache is a UX nicety for
  operators who close the modal without copying.
- **Vault-backed.** Right answer for EE; overkill for CE.

## Consequences

- Generated secrets remain bounded: at most one 5-minute window per
  command, in one process, in V8 heap.
- The audit row is **never** redacted via this path — it goes through
  `redactSecrets()` like every other command-result write.
- Code reviewers must treat the `generatedKey` literal as part of the
  Opstage contract; renaming it without updating both the agent that
  produces it and the backend that consumes it would silently break the
  delivery path.

## Migration path to v0.2

Tracked in [xtrape-capsule-ce#12](https://github.com/xtrape-com/xtrape-capsule-ce/issues/12):

1. Add an `ephemeralFields?: string[]` to the action declaration contract.
2. Backend reads that list off the action definition at command-prepare
   time, and at result-report time stashes the named string fields rather
   than a hardcoded `generatedKey`.
3. ADR revision: document the contract field and the contract-stability
   policy around it.

## References

- `apps/opstage-backend/src/app.ts` — `ephemeralCommandSecrets`,
  `stashEphemeralCommandSecrets`, `pruneExpiredEphemeralCommandSecrets`,
  `publicCommandResult({ consumeEphemeralSecrets })`.
- [xtrape-capsule-site security/overview](https://xtrape-com.github.io/xtrape-capsule-site/security/overview)
- [xtrape-capsule-site security/token-model](https://xtrape-com.github.io/xtrape-capsule-site/security/token-model)
