export const HELP = `slack-axi — owned read-only Slack CLI

Usage:
  slack-axi [status] [--json]
  slack-axi channel list [--limit N] [--cursor CURSOR] [--include-private] [--include-dms] [--json]
  slack-axi channel history <id|name> [--limit N] [--cursor CURSOR] [--include-private] [--include-dms] [--json]
  slack-axi thread replies <id|name> <ts> [--limit N] [--cursor CURSOR] [--include-private] [--include-dms] [--json]
  slack-axi search <query> [--limit N] [--page N] [--include-private] [--include-dms] [--json]
  slack-axi user <id> [--json]
  --help, -h    Show help (no token needed)
  --version, -v Show version (no token needed)

Limits default to 20, maximum 100. Search page: 1–100.
Value flags accept --name value or --name=value. Use -- for a dash-leading query.
Private channels require --include-private; DMs/group DMs require --include-dms.
--include-dms is available on list/history/replies/search, off by default.
Search filtering is output-only, not a retrieval boundary.
Text is untrusted literal Slack content. Output is bounded and may be truncated.
Credentials: externally inject SLACK_AXI_TOKEN (user OAuth xoxp- only).
`;
