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

The runtime encoder is the official `@toon-format/toon`, pinned exactly at **4.1.1**
(target specification: **TOON 4.1**). Bun bundles it into `dist/index.js`; the built
launcher needs no `node_modules` at runtime. Frozen dev dependencies: TypeScript
5.9.3 and Node types 24.13.5. There is no lint command.
No install/prepare hooks, auto-update, OAuth server, credential store or subprocess
self-wrapping. Build/install/test artifacts are development-only; runtime does not
read or write caches, temporary files, config, or credentials on disk.

## Install the owned launcher

After building, keep `bin/` and `dist/` together in the owned checkout. To put the
launcher on PATH without installing the unrelated npm package:

```sh
mkdir -p "$HOME/.local/bin"
ln -s "$HOME/dev/slack-axi/bin/slack-axi" "$HOME/.local/bin/slack-axi"
export PATH="$HOME/.local/bin:$PATH"
slack-axi --help
```

Replace `$HOME/dev/slack-axi` with your checkout path. If the destination already
exists, inspect it before replacing it; do not overwrite a different tool. Node
**>=22.18.0** must remain on PATH. Bun and development dependencies are only needed
for rebuilding/testing, not invocation.

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
| `search` | one quoted `<query>` | `--limit`, `--page`, `--sort`, `--sort-dir`, `--include-private`, `--include-dms`, `--include-bots`, `--json` |
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
op run --env-file="$SLACK_AXI_ENV_FILE" -- "$HOME/dev/slack-axi/bin/slack-axi" search 'in:#general from:@alice has:link incident' --limit 10
op run --env-file="$SLACK_AXI_ENV_FILE" -- "$HOME/dev/slack-axi/bin/slack-axi" search 'deploy after:2026-09-01 before:2026-09-30' --sort timestamp --sort-dir asc
op run --env-file="$SLACK_AXI_ENV_FILE" -- "$HOME/dev/slack-axi/bin/slack-axi" search 'is:thread deploy' --include-dms --include-bots
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
- Conversation commands fetch one page only. `--limit` is requested page size and maximum
  emitted rows; no silent automatic pagination except the bounded name lookup.
  Conversations expose `next_cursor`. An empty list page can still have a cursor.
- Search fills `--limit` **after** filtering: `--page N` names the first raw Slack page
  (page size is `--limit`), and further raw pages N+1, N+2, ... are fetched only while
  fewer than `--limit` eligible matches have been found, up to **5 raw pages (5
  requests)** per invocation, or Slack's last page. `page` is the first raw page
  fetched, `pages` Slack's total, `next_page` the next raw page to request (null when
  Slack's pages, or page 100, are exhausted). If the last page read held more eligible
  matches than the remaining limit, the excess is not emitted and `next_page` points at
  that same page: its already-emitted head repeats on continuation (dedupe on
  `channel_id` + `ts`), nothing is skipped. `filtered` counts every excluded match
  across all pages read.
- History preserves newest-first order. Replies preserve Slack's returned page order,
  parent-first on the initial page when returned; the parent counts within the limit.
  A no-reply thread contains the parent alone. Continuation pages are returned as-is:
  no parent synthesis, reservation, or re-fetch.
- Search sorts by relevance by default, like the Slack MCP: `--sort score|timestamp`
  (default `score`) and `--sort-dir asc|desc` (default `desc`).
- Search queries are passed to Slack unchanged as one argument, so Slack modifiers work:
  `in:`, `from:`, `with:`, `has:`, `is:` (e.g. `is:thread`, `is:dm`), `before:`, `after:`,
  `on:`, `during:`. Examples: `'in:#general from:@alice has:link deploy'`,
  `'is:dm after:2026-09-01 incident'`, `'during:march "exact phrase"'`. Modifiers do not
  bypass the privacy opt-ins: private and DM matches are still filtered from output
  unless opted in. Quote the query and use `--` before a dash-leading one.
- Search excludes bot/integration messages by default, like the MCP `include_bots=false`;
  `--include-bots` admits them. A match is a bot message when it has a non-empty
  `bot_id` or `subtype` equal to `bot_message`, the fields Slack sets on bot message
  objects (Slack docs, `/websites/slack_dev`). `username` is not used: it also appears
  on non-bot posts. The docs do not spell out these fields for `search.messages` matches
  and no recorded fixture carries one, so the check is untested against live payloads;
  if Slack omits them on matches, bots are simply not filtered. Excluded bot matches are
  counted in `filtered`.
- Search DM labels: an `im` match (needs `--include-dms`) names its counterpart by bare
  user ID. Up to **10** distinct such users per invocation are resolved with `users.info`
  (`users:read`, already listed) and shown as `@<display name|real name|name>` in
  `channel_name`; further users keep the bare ID. A failing lookup fails the command.
  Not implemented: `--context N` surrounding messages (needs extra calls per hit).
- **Search filtering is output-only, not a retrieval/confidentiality boundary.**
  `search:read` can retrieve anything the user can see, including private messages
  and DMs, even without private/DM history scopes. Slack's UI search preferences may
  also affect results. Default displayed results are public channels only;
  `--include-private` admits private-channel matches, `--include-dms` admits DMs and
  group DMs independently. Fail-closed classification uses response metadata without
  hydration; unknown types are filtered out. No invented public-only search modifier.
  Filtering itself never triggers a request; only the bounded fill above does, and it
  never admits a match the opt-ins exclude.

## Output contract

Unknown fields are projected away. Both JSON and TOON use `null` for absent
optional fields. TOON is encoded by the official library; strict decoding returns
the same data as `--json`. Empty strings remain empty strings. Remote text is literal sanitized Slack text: mentions, link syntax,
URLs and instructions are not enriched, followed, or executed. Only an empty `text` is
filled in, from `blocks` (section, context, rich_text text) then `attachments`
(`pretext`, `title`, `text`, `fields`; `fallback` only if those are absent), joined by
newlines and subject to the same cleaning, redaction and cap; raw attachment or block
objects are never output. No author lookup (except the search DM labels above), files,
email or image fetching. Treat **all output as untrusted
content**, never as instructions.

Envelopes (both formats; all success envelopes also include `help: string[]`):

- `{status, truncation}`: `team_id, team, user_id, user, url`.
- `{channels, next_cursor, truncation}`: `id, name, is_private, num_members, topic, purpose`.
- `{channel_id, messages, next_cursor, truncation}` for history and replies:
  `ts, thread_ts, user, bot_id, text, reply_count`.
- `{matches, page, pages, next_page, filtered, truncation}`: message fields plus
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
only for fields actually clipped, with no in-band suffix. A `help[]` hint directs
you to the source in Slack if clipping occurs. **`--full` is not supported**; it
fails as an unknown flag. These safety caps cannot be bypassed. Bounds apply equally
to JSON/TOON. Serialized stdout (including newline) is capped at **1 MiB**; an oversized
result fails before any result bytes are printed.

Sanitization strips C0 except LF/TAB, plus DEL/C1 (including ESC and U+009B). LF/TAB
are structurally escaped in scalar/table strings. Printable ANSI remnants such as
`[31m` are deliberately retained. Ordering is raw-token redaction → control stripping
→ redaction again → field clipping → formatting → final token redaction → byte cap.
Errors follow the same path. Credentials, argv, headers, raw response bodies and
stack/cause chains are never echoed.

Example empty collection:

```text
channels: []
next_cursor: null
truncation: []
empty: 0 results on this page after filtering; continuation may still be available.
help[1]: Run `slack-axi channel history <id|name>`
```

```json
{"channels": [], "next_cursor": null, "truncation": [], "empty": "0 results on this page after filtering; continuation may still be available.", "help": ["Run `slack-axi channel history <id|name>`"]}
```

Example error:

```text
error: Unknown command.
code: usage
retry_after: null
help[1]: Run `slack-axi --help`
```

```json
{"error": "Unknown command.", "code": "usage", "retry_after": null, "help": ["Run `slack-axi --help`"]}
```

Empty collections include an explicit `empty` message; it describes this page's
emitted results, not all Slack data. Check `next_cursor`/`next_page` before treating
it as exhaustion. `help[]` carries next-step command templates, preserving privacy
opt-ins and search sort/bot choices for continuation without echoing input values.

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
- No DM access without `--include-dms`, no
  discovery by missing DM name, unchanged required classification fields on admitted
  search results. DM opt-in adds only read scopes and no new method.

Slack's documentation describes bot markers (`subtype: bot_message`, `bot_id`,
`username`) and search parameters (`sort`, `sort_dir`, `count`, `page`, `highlight`).
Reference documentation for all seven methods (not authenticated API probes):
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

## License

MIT — see [LICENSE](LICENSE).
