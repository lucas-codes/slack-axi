# Implementation contract

The two bound cold-read reports define the v1 contract. Implement in three local stages: production-path failing security/command tests; strict parser, closed GET transport, normalized projection and bounded output; README, owned skill and fixtures with offline validation.

Modules: `args.ts` (command-aware grammar); `transport.ts` (closed method/parameter allowlist, exact-origin verification, streaming bounds); `output.ts` (redaction, sanitation, clipping and owned TOON); `slack.ts` (schema validation, privacy and bounded name lookup); `index.ts` (side-effect-free async dispatch); launcher only executes dispatch.

Unknown remote fields are ignored. No automatic retry, cursor following or metadata enrichment. Search filtering is an output boundary only. Runtime never touches disk. IDs and timestamps are validated, preserved and never clipped. Unknown error details at transport boundaries use static messages except bounded Slack error codes. Tests replace global fetch with a default-deny stub, synthetic tokens only.
