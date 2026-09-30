# Release readiness review

## Outcome

The owned CLI passes offline validation, uses the official runtime TOON encoder,
and has no npm audit findings, including development dependencies. This is a local
source delivery, not a published release. Before GitHub publication, resolve the
historical documentation disclosure below and choose a license. No Slack endpoint
was contacted, no real credential supplied, and no remote created or push performed.

## TOON and visible contract changes

`@toon-format/toon` is pinned exactly to `4.1.1` in `package.json:28-30` and the
lockfile, installed with `npm ci --ignore-scripts`. `src/output.ts:22-28` delegates
to `encode`, then retains final credential redaction, one terminating CLI newline,
and the 1 MiB UTF-8 cap. `Cleaner` and its code-point clipping/truncation records
are unchanged (`src/output.ts:8-20`); field bounds and privacy gates are unchanged.

Target: [TOON specification 4.1](https://github.com/toon-format/spec/blob/v4.1.0/SPEC.md),
section 13 and Appendix C. The official encoder owns quoting, escaping, primitive
spelling, table shape, field order, lengths and indentation. Its returned document
has no trailing newline; the CLI adds its existing stdout newline as framing.
This is application-level conformance evidence, not a separate certification of
all normative encoder/decoder requirements or a run of the entire upstream fixture
suite. Appendix C's language-agnostic fixtures remain the upstream implementation's
broader compliance suite.

`src/__tests__/fixtures.test.ts:10-36` exercises production dispatch for every
command (`status`, list, history, replies, search, user), empty results, errors and
bot search. It explicitly decodes with `{strict:true}`, compares with independent
locked expected data, then compares directly with JSON output from the same mocked
responses. The previous null-substitution helper is gone. Additional production
serializer tests cover ambiguous strings, escaping, heterogeneous rows and the
TOON byte cap (`src/__tests__/response.test.ts`). The launcher load-error fallback
is a fixed valid TOON literal; strict-decoded fallback equals JSON in
`src/__tests__/bounds.test.ts:141-157`.

Deliberately updated all nine `.toon` fixtures and `commands.json`:

1. JSON null now emits TOON `null`, not the non-null house string `-`: collection
   cells, cursors, search continuation and error `retry_after`.
2. Empty arrays now emit `key: []`, not `key[0]:`: `truncation` everywhere and the
   empty channels fixture. Both are valid TOON; this is the official canonical form.
3. All successful command and error envelopes now carry `help: string[]`. Official
   TOON renders these primitive arrays inline (`help[1]: ...`, or `help[2]: ...,...`).
   JSON includes the identical strings. The fixed launcher fallback also has help.
4. Empty collection envelopes now add an explicit `empty` message describing zero
   emitted results on this page, without claiming global exhaustion.
5. Outside the locked homogeneous fixtures, heterogeneous rows now use TOON list
   form and retain every row's keys; the old first-row-only column projection lost
   later fields. Quoting is now entirely the official encoder's policy, rather than
   the house serializer's regex. Existing timestamp strings and LF/TAB escapes in
   the locked fixtures remain unchanged.

These are intentional output-contract changes; consumers expecting `-` or exact
legacy bytes must update. JSON command data fields are unchanged except the
additive `help` and conditional `empty` fields.

Bun builds eight modules into `dist/index.js` (46.1 KB), including encoder code;
there is no external package import. A separate offline validation temporarily hid
`node_modules` inside the worktree, copied only `bin/`, `dist/` and an ESM manifest,
and ran all nine command fixtures in both formats through a `.local/bin` symlink.
All 18 runs matched the locked outputs and exit codes. The dependencies were
restored immediately. This proves the encoder is bundled, not merely that help
works without dependencies.

Documentation lookup for the encoder was attempted but the documentation service
returned HTTP 429. Verification used the versioned published spec and installed
package declarations/source instead.

## AXI response principles

Reviewed [axi.md](https://axi.md/) against production paths:

| Principle | Result / evidence |
|---|---|
| Definitive empty state | Fixed: explicit zero-emitted-results message for list/history/replies/search; preserves continuation metadata (`src/slack.ts:248-251`). Tested for all four paths. |
| Structured errors and exit codes | Retained: stdout data, 0 success, 1 operational failure, 2 usage; unknown flags fail before fetch (`src/index.ts:19-24`, `src/args.ts:14,38-43`, `bin/slack-axi:9-19`). Added help; fixed fallback null spelling. |
| Content-first no arguments | Retained: parser defaults to status, dispatch fetches identity, not help (`src/args.ts:50`, `src/slack.ts:166-175`). Production test proves it. |
| Truncation size hints | Retained original/emitted code-point counts (`src/output.ts:16-19`). Added an honest source-in-Slack hint only when clipped (`src/help.ts:25`). |
| `--full` escape hatch | Follow-up, not implemented: it would alter the required unchanged safety bounds and introduce a new feature. Unknown `--full` remains exit 2. No hint falsely advertises a working flag. |
| Contextual `help[]` | Fixed: concrete command templates after data/errors, placeholders for query/ID/ts/cursor, privacy opt-ins carried forward; search continuation retains sort and bot choice (`src/help.ts:4-26`, `src/index.ts:22`). |
| Concise per-command help | Partial: every recognized command accepts `--help`, but returns the complete global reference. A command-specific reference is a follow-up. |
| Token efficiency / aggregates | Bounded projected columns and pagination/filter counts remain. Source-wide totals unavailable for conversations; no invented totals. More compact field selection is a follow-up, not a new flag here. |
| Ambient context | Intentionally absent executable hooks; existing on-demand skill retained. Hook installation would conflict with the read-only/no-persistence security contract. |

This is not a claim of full compliance with all ten AXI principles.

## Third-party audit: applicability to owned code

Reviewed all seven ranked findings and the associated credential/egress/execution
inventory in the earlier third-party security report. The findings below refer to
our source, not the third-party source or its dependency graph.

| Finding | Applicability and owned-code evidence |
|---|---|
| 1. Arbitrary local deletion via auth/draft IDs | Does not apply. Only six read commands are parsed; auth/draft are unknown (`src/args.ts:3,52-61`). Runtime dispatch/transport has no filesystem write/delete path (`src/index.ts:8-26`, `src/transport.ts:32-81`). Production tests reject forbidden commands before fetch. |
| 2. Download credential leakage to arbitrary hosts/redirects | Does not apply. No files/download method; closed seven-method allowlist (`src/transport.ts:3-11,33-39`), exact HTTPS Slack origin/path with no userinfo/fragment (`:16-20`), GET/header auth and manual redirect rejection (`:44-46`). Cursors stay query values, never destinations. Offline tests cover arbitrary URLs and redirects. |
| 3. Frozen vulnerable dependencies, including dev-only findings | Does not apply to the owned lock: full `npm audit` reports zero vulnerabilities before and after the change. Only runtime package is TOON 4.1.1, not 2.3.0 (`package.json:28-34`). No Axios, form-data, Vitest/mocker, nanoid or postcss entries. No advisory fix was necessary. |
| 4. Overgranting defaults / writes without approval | No mutation/approval issue: no write command or write API method (`src/args.ts:3,52-61`, `src/transport.ts:3-11`). Scope guidance excludes writes, reactions, files and email (`README.md:49-63`). The CLI cannot reduce an existing token grant, inspect all scopes, or refresh tokens; workspace approval/least privilege remain operator obligations (`README.md:63-82`). |
| 5a. Broad private/DM visibility | Residual risk applies to Slack search retrieval: `search:read` can see whatever the user can see, before local filtering. Public-only defaults and separate private/DM opt-ins enforce emitted content, not retrieval (`src/slack.ts:49-54,110-112,136-139,208-218`). Do not represent this as a public-only confidentiality boundary; documented explicitly in README and skill. |
| 5b. Persistent cache/drafts/token permissions | Does not apply. No cache, draft, token-file or credential argv command; captured environment credential only (`src/index.ts:8-17`, `src/transport.ts:22-26`). No runtime filesystem persistence exists. |
| 5c. Download collisions, symlinks, unbounded bytes | Does not apply: download is absent and there are no output-file writes. Network responses are capped at 2 MiB before JSON parsing (`src/transport.ts:54-68`); stdout has a 1 MiB limit (`src/output.ts:25-28`). |
| 6. Prompt injection / disguised links in output | Residual risk applies: Slack text is untrusted, not a safe instruction channel. Rich-text link labels can stand in for their URL (`src/slack.ts:66-74`); do not infer a safe destination from a label. Text is projected/cleaned/clipped (`src/slack.ts:95-108`, `src/output.ts:12-19`), encoded as data, never evaluated or passed to a shell. No automatic URL fetching. Existing skill explicitly forbids obeying embedded instructions. |
| 7a. Mutable release workflows | Does not apply today: no `.github/` workflows are tracked and there is no remote. Future publication automation needs a separate review and pinned action SHAs. |
| 7b. Executable hooks / persistence | Does not apply: no setup command, generated plugin, spawning SDK or runtime child process (`src/args.ts:3,52-61`, `package.json:28-34`). Keep executable hooks out of the deployment. |

### Inventory and adoption conditions

- **Credential source:** external environment capture; user OAuth `xoxp-` only,
  bot/session/cookie credentials rejected (`src/index.ts:9`, `src/transport.ts:22-26`).
  No browser/desktop harvesting, callback server, keychain or token-login command.
- **Credential output:** cleaner redacts before and after control stripping,
  before clipping, and after formatting (`src/output.ts:12-19,25-27`); errors use
  the same cleaner (`src/index.ts:20-23`). Transport does not echo URLs, headers,
  raw bodies or exception details (`src/transport.ts:46-76`). Existing synthetic
  credential and control-interleaving tests still pass.
- **Egress:** only the central `fetch` at `src/transport.ts:44`; no telemetry,
  updater, download, remote config, cookie flow or host override. All application
  requests are allowlisted GETs to Slack. This is source-derived and offline-tested,
  not verified against a live workspace or a corporate proxy.
- **Execution:** runtime source has no `child_process`, eval, Function constructor
  or content-derived imports. Launcher's one fixed dynamic import is
  `../dist/index.js` (`bin/slack-axi:3`). Test subprocesses are offline launcher
  probes, not runtime features.
- **Supply chain:** lock has registry URLs and integrity hashes; no install/prepare
  hooks. `prepublishOnly` explicitly runs checks/build (`package.json:22-26`).
  `npm ci --ignore-scripts` succeeded; the build still executes local Bun tooling.
  Production bundling avoids dependency resolution at invocation, not build-time
  supply-chain risk. Full dependency line-by-line review was not performed.
- **Adoption conditions retained:** pinned owned revision, reviewed lock, approved
  least-privilege user grant, external 1Password injection, no forbidden commands
  or hooks, and token/OS sandbox controls for agent access. Search filtering alone
  cannot constrain what a broadly granted user token retrieves.

## Release hygiene and historical scan

`README.md:9-43` documents Node >=22.18.0, Bun build prerequisite, frozen install,
build/validation and the `~/.local/bin` symlink approach. The symlinked launcher was
exercised offline without dependencies. No lint script exists. `.gitignore:1-3`
already excludes `node_modules/`, `dist/`, and local semantic-index state; those
artifacts are untracked. Package stays private/local-only, not an npm release.

**License question:** README specifies no license and root has no LICENSE. No
license was invented or copied from the unrelated third-party project. Which
license should the owner choose before public distribution?

Scanned all reachable history using `git rev-list --all` and
`git rev-list --objects --all`, reading every unique blob with `git cat-file blob`
and every commit message with `git show -s --format=%B`. Baseline: **5 commits,
43 unique blobs**, including superseded/deleted content, not just HEAD. Checked
absolute home paths, credential prefixes/private-key headers, credential-looking
assignments, and a local-internal-name denylist; manually classified assignment
matches. No real credential or absolute personal path detected. Six historical
assignment matches were synthetic test tokens. Author names/emails remain in Git
metadata; they are attribution, not a claim of anonymized history. This heuristic
scan does not prove absence of every possible secret encoding.

**Publication gate still open:** an internal documentation CLI name appears in
historical README blobs. Exact source locations:

- `6aa46032c2fec221faece782086fd6d03e6036bd:README.md:273,275`
- `b7626b72ee07c6b6dee8454721183b62959701a3:README.md:237`

Current README is cleaned without repeating the name in this report. A normal
commit cannot remove old blobs from history. Rewriting shared history or publishing
a sanitized initial snapshot is a repository-owner decision; neither was performed.
Do not publish the full existing history while the no-internal-names condition is
required. Resolve this separately before creating a remote or pushing.

## Validation evidence

Node `v24.21.0`, Bun `1.4.0`, synthetic credentials and mocked fetch only:

```text
Before implementation: npm test -> 61 tests, 48 pass, 13 fail
  strict null equality, official serializer fidelity, missing empty/help hints
Launcher fallback regression before fix: '-' !== null (exit 1)
npm ci --ignore-scripts -> added 4 packages; found 0 vulnerabilities
npm run typecheck -> tsc --noEmit; exit 0
npm test -> 62 tests, 62 pass, 0 fail; exit 0
npm run build -> bundled 8 modules; index.js 46.1 KB; exit 0
npm audit -> found 0 vulnerabilities; exit 0 (dev included)
Offline bundled/symlink launcher -> 9 fixtures x 2 formats passed with node_modules hidden
 git diff --check -> no output; exit 0
```

No lint command is configured. Live Slack scope/method compatibility, minimum-Node
execution, token lifecycle, licensing and eventual GitHub publication remain owner
checks/decisions; they are not asserted as tested here.
