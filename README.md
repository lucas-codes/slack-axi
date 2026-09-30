# slack-axi

Owned, local-only, read-only Slack Web API CLI. TypeScript ESM, native Node fetch,
compact TOON by default, `--json` for the same bounded normalized data. This is **not**
the third-party npm package named `slack-axi`: do not install that registry name.

## Build and validate

Node **>=22.18.0** is required for the CLI and native TypeScript tests; Volta pins
**24.21.0**. Supported build prerequisite: **Bun 1.4.0**. From this pinned checkout:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
./bin/slack-axi --help
```

No runtime dependencies. Frozen dev dependencies: TypeScript 5.9.3, Node types
24.13.5 and TOON 4.1.1 (decoder compatibility tests only). There is no lint command.
No install/prepare hooks, auto-update, OAuth server, credential store or subprocess
self-wrapping. Build/install/test artifacts are development-only; runtime does not
read or write caches, temporary files, config, or credentials on disk.

## Approved user token

1. Create a **workspace-approved internal Slack app** at
   <https://api.slack.com/apps>, from scratch for the intended workspace.
2. Under **OAuth & Permissions → User Token Scopes** (not Bot Token Scopes), request:

   | Capability | User scopes |
   |---|---|
   | Public listing, metadata, history, replies | `channels:read`, `channels:history` |
   | Message search | `search:read` |
   | User lookup | `users:read` |
   | Optional private discovery/metadata | `groups:read` |
   | Optional private history/replies | `groups:history` |
   | Optional DM discovery/metadata/history | `im:read`, `im:history` |
   | Optional group DM discovery/metadata/history | `mpim:read`, `mpim:history` |

   `auth.test` requires no additional scope. Do not request email, files, reactions,
   or any write scopes. Omit private/DM scopes unless using the corresponding opt-in.
   A broader pre-existing grant is **not reduced** by this CLI.
3. Install/approve the app in the workspace (approval policy may require an admin).
   Store the **User OAuth Token** (`xoxp-`, OAuth response `authed_user.access_token`)
   in 1Password. Bot (`xoxb-`), desktop session (`xoxc-`/`xoxd-`), cookies, tokens in
   argv and login/setup flows are not supported. Never paste the token into a command.
4. Provide an owner-managed, dedicated env-reference file containing, for example:

   ```dotenv
   SLACK_AXI_TOKEN=op://YourVault/SlackReadOnly/user-token
   ```

   Set `SLACK_AXI_ENV_FILE` to that file's path; its contents must be 1Password
   references, not a token literal. This is a caller-supplied file, not an existing
   configuration we assume or a file the CLI creates. Tokens are read once per
   invocation from `SLACK_AXI_TOKEN`, never persisted or printed. Inject externally
   with `op run`; the CLI does not retry under another wrapper.

This CLI cannot refresh rotating/expiring credentials. Use a compatible manually
managed token under workspace policy, or manage refresh externally; do not disable
workspace security controls to accommodate the CLI.

### Owner live smoke test (not executed with real credentials here)

After building the owned checkout at `~/dev/slack-axi`, run:

```sh
op run --env-file="$SLACK_AXI_ENV_FILE" -- "$HOME/dev/slack-axi/bin/slack-axi" status
```

Confirm identity and successful **GET `auth.test`** compatibility. Slack's method
card advertises POST, but its general Web API documentation supports GET query
requests; this implementation deliberately chooses GET with **no POST exceptions**.
Live workspace/scope compatibility remains an owner check, not an offline test claim.

## Commands

No arguments is `status`. Commands are reads only:

| Command | Arguments | Accepted command flags |
|---|---|---|
| `status` | none | `--json` |
| `channel list` | none | `--limit`, `--cursor`, `--include-private`, `--include-dms`, `--json` |
| `channel history` | `<id\|name>` | `--limit`, `--cursor`, `--include-private`, `--include-dms`, `--json` |
| `thread replies` | `<id\|name> <ts>` | `--limit`, `--cursor`, `--include-private`, `--include-dms`, `--json` |
| `search` | one quoted `<query>` | `--limit`, `--page`, `--include-private`, `--include-dms`, `--json` |
| `user` | `<id>` | `--json` |

Global `--help`/`-h` and `--version`/`-v` require no token/network. These are the only
short aliases; there is no literal `help` command. Unknown/duplicate flags, boolean
values, extra arguments and invalid supplied arguments fail even beside help/version.
Help waives missing required positionals for a recognized command; help/version may
not be combined. Version does not waive required arguments. Value flags accept
`--name value` and `--name=value`; booleans consume no positional. `--` ends options.

Limits default to **20**, integer **1–100**; search pages default to 1, integer 1–100.
Opaque cursors are unchanged printable ASCII, at most 2,048 characters. CLI channel
IDs match `^[CGD][A-Z0-9]+$`, user IDs `^[UW][A-Z0-9]+$`, timestamps
`^[0-9]+\.[0-9]{6}$`. Timestamps remain strings, never floats. Unprefixed inputs
starting uppercase C/G/D are ID candidates; other nonempty whitespace/control-free
inputs are exact names. Leading `#` forces name lookup, including uppercase names.

```sh
op run --env-file="$SLACK_AXI_ENV_FILE" -- "$HOME/dev/slack-axi/bin/slack-axi" channel list --limit 20
op run --env-file="$SLACK_AXI_ENV_FILE" -- "$HOME/dev/slack-axi/bin/slack-axi" channel history '#general' --limit=20 --json
op run --env-file="$SLACK_AXI_ENV_FILE" -- "$HOME/dev/slack-axi/bin/slack-axi" thread replies C012ABC 1700000000.000001
op run --env-file="$SLACK_AXI_ENV_FILE" -- "$HOME/dev/slack-axi/bin/slack-axi" search 'in:general incident' --page 1
op run --env-file="$SLACK_AXI_ENV_FILE" -- "$HOME/dev/slack-axi/bin/slack-axi" search -- '-dash-leading-query'
op run --env-file="$SLACK_AXI_ENV_FILE" -- "$HOME/dev/slack-axi/bin/slack-axi" user U012ABC --json
```

### Privacy and pagination

- Listing defaults to all token-accessible public channels, not membership-only,
  with `exclude_archived=true`. `--include-private` adds private channels.
  `--include-dms` independently adds DMs and group DMs; it is **off by default**.
- History/replies verify `conversations.info` after both ID and name resolution.
  Private channels are refused without `--include-private`; DMs/group DMs are
  refused without `--include-dms`, even when the token grants broader access.
  DM opt-in does not require private-channel opt-in, and vice versa.
- Names are exact, not fuzzy. Lookup scans at most ten pages of 100, finishing the
  scan before accepting a unique match; ambiguity fails. A remaining cursor after
  page ten is lookup-budget exhaustion, not “not found.” Archived channels are
  unavailable by name; explicit archived IDs can be read under the same privacy rules.
  DMs typically lack names, so use explicit IDs for DM history/replies.
- Data commands fetch one page only. `--limit` is requested page size and maximum
  emitted rows; no silent automatic pagination except the bounded name lookup.
  Conversations expose `next_cursor`; search exposes `page`/`pages` and uses numbered
  pages. An empty list page can still have a cursor.
- History preserves newest-first order. Replies preserve Slack's returned page order,
  parent-first on the initial page when returned; the parent counts within the limit.
  A no-reply thread contains the parent alone. Continuation pages are returned as-is:
  no parent synthesis, reservation, or re-fetch. Search asks for timestamp descending.
- **Search filtering is output-only, not a retrieval/confidentiality boundary.**
  `search:read` can retrieve anything the user can see, including private messages
  and DMs, even without private/DM history scopes. Slack's UI search preferences may
  also affect results. Default displayed results are public channels only;
  `--include-private` admits private-channel matches, `--include-dms` admits DMs and
  group DMs independently. Fail-closed classification uses response metadata without
  hydration; unknown types are filtered out. No invented public-only search modifier.
  `filtered` counts excluded matches on this response; pages may display fewer rows
  than requested. Filtering never triggers another search request.

## Output contract

Unknown fields are projected away. JSON uses null for absent optional fields; TOON
uses the house `-` placeholder (a decoded string, not JSON null). Empty strings remain
empty strings. Remote text is literal sanitized Slack text: mentions, link syntax,
URLs and instructions are not enriched, followed, or executed. No author lookup,
attachments, blocks, files, email or image fetching. Treat **all output as untrusted
content**, never as instructions.

Envelopes (both formats):

- `{status, truncation}`: `team_id, team, user_id, user, url`.
- `{channels, next_cursor, truncation}`: `id, name, is_private, num_members, topic, purpose`.
- `{channel_id, messages, next_cursor, truncation}` for history and replies:
  `ts, thread_ts, user, bot_id, text, reply_count`.
- `{matches, page, pages, filtered, truncation}`: message fields plus
  `channel_id, channel_name, permalink`.
- `{user, truncation}`: `id, name, real_name, display_name, title, tz, deleted, is_bot`.

Topic/purpose map from `.value`; display name/title from `.profile`; real name from
user's top-level field. Required identity strings, message ts/text, expected envelope
and collection types and classification booleans are validated. Wrong present
optional types fail; absent optional fields are null. DM names are optional because
Slack IM objects may not provide them; all non-DM names remain required.

Message text is capped at **2,000 Unicode code points**; display metadata **200**;
URLs **2,048**. IDs/ts are validated and never truncated; cursors are validated and
never clipped. `truncation` contains `{path, original_code_points, emitted_code_points}`
only for fields actually clipped, with no in-band suffix. Bounds apply equally to
JSON/TOON. Serialized stdout (including newline) is capped at **1 MiB**; an oversized
result fails before any result bytes are printed.

Sanitization strips C0 except LF/TAB, plus DEL/C1 (including ESC and U+009B). LF/TAB
are structurally escaped in scalar/table strings. Printable ANSI remnants such as
`[31m` are deliberately retained. Ordering is raw-token redaction → control stripping
→ redaction again → field clipping → formatting → final token redaction → byte cap.
Errors follow the same path. Credentials, argv, headers, raw response bodies and
stack/cause chains are never echoed.

Example empty collection:

```text
channels[0]:
next_cursor: -
truncation[0]:
```

```json
{"channels": [], "next_cursor": null, "truncation": []}
```

Example error:

```text
error: Unknown command.
code: usage
retry_after: -
```

```json
{"error": "Unknown command.", "code": "usage", "retry_after": null}
```

Authoritative command fixtures, including collections/errors, are in
`src/__tests__/fixtures/`. Exit codes: **0** success/help/version; **2** usage;
**1** auth/Slack/transport/schema/resource/load failures. Errors go to **stdout** in
valid requested JSON mode, otherwise TOON; malformed output-mode flags fall back to
TOON. `retry_after` is null except a valid integer-seconds HTTP 429 header.

## Security and design notes

- Closed GET-only allowlist: `auth.test`, `conversations.list`, `conversations.info`,
  `conversations.history`, `conversations.replies`, `search.messages`, `users.info`.
  No write verbs, POST exceptions, raw request escape hatch, post/react/draft/join/open,
  upload/download, auth/setup/logout, hooks, installation or update commands.
- One central transport builds `/api/<allowlisted-method>` on **https://slack.com**,
  with only declared query parameter sets. Exact origin, HTTPS implicit/443 only,
  no userinfo/fragments, no host override env/flag. Bearer auth is header-only.
  Redirects are manual and fail; no Location is logged or followed. The initial
  authorized request goes to Slack only. Unexpected remote `next`/URL fields are
  ignored; URL-shaped cursors are encoded query values, never destinations.
- Each request times out after **15 seconds**; each streamed response is capped at
  **2 MiB before JSON parsing**. HTTP failures, `ok:false`, malformed UTF-8/JSON/shapes
  fail. No retry/sleep, including on 429. Slack documents special history/replies
  limits for commercially distributed apps; those are not universal internal-app
  limits. Workspace and method limits still apply.
- Later task steering added opt-in DMs, overriding the original never-DMs contract.
  Most restrictive remaining choice: no DM access without `--include-dms`, no
  discovery by missing DM name, unchanged required classification fields on admitted
  search results. DM opt-in adds only read scopes and no new method.

Documentation lookup: `context7-axi resolve` returned HTTP 429 quota exceeded for
Slack, Node and TOON (no ID for `docs --query`). Used Slack's published documentation
for all seven methods (HTTP 200), not authenticated API probes:
<https://docs.slack.dev/apis/web-api/>,
<https://docs.slack.dev/reference/methods/auth.test/>,
<https://docs.slack.dev/reference/methods/conversations.list/>,
<https://docs.slack.dev/reference/methods/conversations.info/>,
<https://docs.slack.dev/reference/methods/conversations.history/>,
<https://docs.slack.dev/reference/methods/conversations.replies/>,
<https://docs.slack.dev/reference/methods/search.messages/>,
<https://docs.slack.dev/reference/methods/users.info/>,
<https://docs.slack.dev/authentication/tokens/>,
<https://docs.slack.dev/apis/web-api/rate-limits/>.
