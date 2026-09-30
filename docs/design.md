# Implementation contract

The v1 contract is read-only, externally credentialed and bounded. Implementation stages: production-path failing security/command tests; strict parser, closed GET transport, normalized projection and bounded output; README, owned skill and fixtures with offline validation.

Modules: `args.ts` (command-aware grammar); `transport.ts` (closed method/parameter allowlist, exact-origin verification, streaming bounds); `output.ts` (redaction, sanitation, clipping and official TOON encoding); `slack.ts` (schema validation, privacy and bounded name lookup); `index.ts` (side-effect-free async dispatch); launcher only executes dispatch.

Unknown remote fields are ignored. No automatic retry, cursor following or general metadata enrichment. Search filtering is an output boundary only; search reads at most five raw pages to fill `--limit` after filtering and resolves at most ten DM counterparts through `users.info`, both within the existing read-only allowlist and scopes. Runtime never touches disk. IDs and timestamps are validated, preserved and never clipped. Unknown error details at transport boundaries use static messages except bounded Slack error codes. Tests replace global fetch with a default-deny stub, synthetic tokens only.
