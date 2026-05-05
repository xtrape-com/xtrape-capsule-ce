# Security Policy

Xtrape Capsule CE is a self-hosted control plane for operating Capsule Services. It handles credentials that can affect service runtime behavior, so treat every deployment as security-sensitive.

## Reporting a vulnerability

Please report suspected vulnerabilities privately. Do not open a public GitHub issue with exploit details, tokens, logs containing secrets, or screenshots containing sensitive data.

Until a public security contact is announced, contact the maintainers through the project owner channel and include:

- affected repository and version/commit;
- deployment mode;
- impact and reproduction steps;
- whether any token, command, or secret may have leaked;
- suggested mitigation if known.

## Supported versions

`v0.1.x` is Public Preview. Security fixes target the latest `main` branch and the latest preview release once releases are published.

## Deployment guidance

- Change the bootstrap admin password before running outside local development.
- Set a strong `OPSTAGE_SESSION_SECRET` with at least 32 characters.
- Do not expose Opstage CE directly to the public internet without a trusted reverse proxy, TLS, IP allowlists, and additional authentication controls.
- Use HTTPS in non-local environments.
- Restrict access to the SQLite database, backup directory, logs, and `.env` files.

## Token model

- Registration Tokens are bootstrap credentials and should be short-lived, single-use, and revoked when no longer needed.
- Agent Tokens are long-lived bearer credentials. Store them in a private token file or secret manager.
- If an Agent Token leaks, revoke the Agent in Opstage and create a new registration flow.
- Never commit token files or raw registration tokens.

## Command and Action safety

Actions are remote operational capabilities. Service authors should:

- mark risky actions with `dangerLevel` and `requiresConfirmation`;
- validate every payload server-side in the action handler;
- make destructive actions idempotent or clearly irreversible;
- return operator-safe messages only;
- avoid long-running synchronous actions when asynchronous status tracking is safer.

## Secret handling

Do not report raw secrets through health, config, manifest, action prepare, action result, audit metadata, or logs. Use redacted previews and stable secret references instead, for example:

```text
secretRef: env://UPSTREAM_API_KEY
valuePreview: [REDACTED]
```

## Future secret boundary

Future EE/Cloud editions are expected to provide stronger secret boundaries such as SSO, external vault integrations, customer-side secret references, stronger audit controls, and high-availability deployments. CE should still avoid storing or displaying raw service secrets wherever possible.
