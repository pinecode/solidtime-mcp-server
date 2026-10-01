# solidtime-mcp-server

[![CI](https://github.com/pinecode/solidtime-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/pinecode/solidtime-mcp-server/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP server for [SolidTime](https://www.solidtime.io/) — the open-source time tracking app. Start/stop timers, manage time entries, projects, clients, tags, and tasks directly from Claude, Cursor, or any MCP-compatible client.

## Features

- **8 read-only tools by default**, or 22 tools with explicitly enabled writes
- **Start/stop timers** with automatic active-timer detection
- **Aggregated reports** grouped by day, week, project, client, and more
- **Auto member_id resolution** — no manual configuration needed
- **Actionable error messages** — every error tells you what to do next
- Uses native `fetch`, the MCP SDK, and Zod
- Works with self-hosted SolidTime instances and the hosted version

## Quick Start

### Build this fork locally

```bash
git clone https://github.com/pinecode/solidtime-mcp-server.git
cd solidtime-mcp-server
npm ci --ignore-scripts
npm run build
npm test
```

This fork is not published to npm. Run the built `dist/index.js` from this
checkout; an npm package with the upstream name is not this audited fork.
Use `git checkout <reviewed-commit>` before installation to pin a reviewed revision.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SOLIDTIME_API_TOKEN` | Yes | — | Your SolidTime API token |
| `SOLIDTIME_ORGANIZATION_ID` | Yes | — | Your organization UUID |
| `SOLIDTIME_API_URL` | Yes | None | Explicit HTTPS origin of your Solidtime instance, with no path, credentials, query, or fragment |
| `SOLIDTIME_READ_ONLY` | No | `true` | Keep `true` for reports; only `false` enables write tools |

Get your API token from **SolidTime > Settings > API**.

## Security

- There is no default cloud endpoint. Missing or invalid configuration prevents startup.
- All API calls stay under `/api/v1/` on the configured HTTPS origin. Redirects are rejected.
- Requests time out after 30 seconds. TLS verification is enabled.
- Read-only mode hides write tools and blocks non-GET API calls independently.
- Startup logs do not contain user names, emails, member IDs, or tokens.
- API error responses and transport details are not echoed into MCP errors.
- This restricts the current application code, not arbitrary modified code or dependencies.
  A runtime firewall or sandbox is needed for an OS-enforced network allowlist.
- Tool results are shared with the MCP host and may be sent to its model provider.
- Read-only MCP mode does not reduce the underlying API token's permissions.

## Codex Configuration

Codex starts this server as a local stdio process. It does not need a public
MCP URL or an open listening port. Use Node.js 18 or newer.

1. Build the checkout as above.
2. Activate personal API tokens on self-hosted Solidtime if necessary:
   `php artisan passport:client --personal --name="API" -n`.
   Create a personal token in Profile Settings and obtain your organization UUID.
3. Store the token in a secret manager. Do not put it in this repository, command
   arguments, or `config.toml`.
4. Register the server, using absolute paths to Node and the checkout:

```bash
codex mcp add solidtime \
  --env SOLIDTIME_API_URL=https://solidtime.example.com \
  --env SOLIDTIME_ORGANIZATION_ID=your-organization-uuid \
  --env SOLIDTIME_READ_ONLY=true \
  -- /absolute/path/to/node /absolute/path/to/solidtime-mcp-server/dist/index.js
```

5. Add `env_vars` and the tool allowlist to the existing server section in
   `~/.codex/config.toml` (do not create a duplicate section):

```toml
[mcp_servers.solidtime]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/solidtime-mcp-server/dist/index.js"]
env_vars = ["SOLIDTIME_API_TOKEN"]
startup_timeout_sec = 30
enabled_tools = [
  "solidtime_get_current_user",
  "solidtime_get_active_timer",
  "solidtime_list_time_entries",
  "solidtime_get_time_entry_report",
  "solidtime_list_projects",
  "solidtime_list_clients",
  "solidtime_list_tags",
  "solidtime_list_tasks",
]

[mcp_servers.solidtime.env]
SOLIDTIME_API_URL = "https://solidtime.example.com"
SOLIDTIME_ORGANIZATION_ID = "your-organization-uuid"
SOLIDTIME_READ_ONLY = "true"
```

6. Launch Codex from an environment where the secret manager supplies
   `SOLIDTIME_API_TOKEN`. Setting it in an unrelated terminal will not update
   the environment of an already-running desktop app. For desktop use, a local
   launcher can load the token from the OS credential store and execute the server;
   set that launcher's absolute path as `command` instead.
7. Run `codex mcp get solidtime` to check registration. Restart the MCP connection
   or Codex, then check `/mcp` and ask for a read-only report. Registration alone
   does not prove that authentication and tool calls work.

The default 8 tools cannot change data. Setting `SOLIDTIME_READ_ONLY=false`
enables writes in the server; Codex's allowlist must also be changed to expose
them. Only do that intentionally with an appropriately permissioned token.

See the [official Codex MCP documentation](https://developers.openai.com/codex/mcp).

## Other MCP Clients

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "solidtime": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/solidtime-mcp-server/dist/index.js"],
      "env": {
        "SOLIDTIME_ORGANIZATION_ID": "your-org-uuid-here",
        "SOLIDTIME_API_URL": "https://your-instance.example.com",
        "SOLIDTIME_READ_ONLY": "true"
      }
    }
  }
}
```

Supply `SOLIDTIME_API_TOKEN` through the client's inherited environment or a
credential-store launcher, rather than embedding it in JSON configuration.

## Tools

Tools that create, update, delete, or start/stop timers are available only when
`SOLIDTIME_READ_ONLY=false`. All other tools are enabled by default.

### Time Entries (8 tools)

| Tool | Description |
|------|-------------|
| `solidtime_start_timer` | Start a running timer (checks for existing active timer first) |
| `solidtime_stop_timer` | Stop the active timer |
| `solidtime_get_active_timer` | Get the currently running timer |
| `solidtime_list_time_entries` | List entries with filters (date range, project, client, tags, billable) |
| `solidtime_create_time_entry` | Create a completed entry with start and end times |
| `solidtime_update_time_entry` | Update any field on an existing entry |
| `solidtime_delete_time_entry` | Permanently delete an entry |
| `solidtime_get_time_entry_report` | Aggregated report by day/week/month/project/client/etc. |

### Projects (4 tools)

| Tool | Description |
|------|-------------|
| `solidtime_list_projects` | List all projects (filter by archived status) |
| `solidtime_create_project` | Create a project with name, color, billable rate |
| `solidtime_update_project` | Update project fields |
| `solidtime_delete_project` | Permanently delete a project |

### Clients (3 tools)

| Tool | Description |
|------|-------------|
| `solidtime_list_clients` | List all clients (filter by archived status) |
| `solidtime_create_client` | Create a client |
| `solidtime_update_client` | Update a client's name |

### Tags (3 tools)

| Tool | Description |
|------|-------------|
| `solidtime_list_tags` | List all tags |
| `solidtime_create_tag` | Create a tag |
| `solidtime_update_tag` | Update a tag's name |

### Tasks (3 tools)

| Tool | Description |
|------|-------------|
| `solidtime_list_tasks` | List tasks (filter by project, done status) |
| `solidtime_create_task` | Create a task within a project |
| `solidtime_update_task` | Update task name, done status, or estimated time |

### Users (1 tool)

| Tool | Description |
|------|-------------|
| `solidtime_get_current_user` | Get your user profile and resolved member ID |

## Usage Examples

**Start tracking time:**
> "Start a timer for the website redesign project"

**Log completed work:**
> "Create a time entry for today 9:00-11:30 on the API project, tagged as development"

**Get a weekly report:**
> "Show me a report of this week's hours grouped by project"

**Check what's running:**
> "Is there a timer running?"

## Troubleshooting

### "Authentication failed"
Your `SOLIDTIME_API_TOKEN` is invalid or expired. Generate a new one in SolidTime under Settings > API.

### "Permission denied"
Your token doesn't have access to the specified organization. Verify `SOLIDTIME_ORGANIZATION_ID`.

### "Cannot reach SolidTime"
Check that `SOLIDTIME_API_URL` is correct and the instance is accessible. For self-hosted: ensure the URL includes the protocol (e.g., `https://solidtime.example.com`).

### "Could not find member for user"
The authenticated user is not a member of the specified organization. Check `SOLIDTIME_ORGANIZATION_ID`.

## Development

```bash
git clone https://github.com/pinecode/solidtime-mcp-server.git
cd solidtime-mcp-server
npm ci --ignore-scripts
npm run dev          # Run with tsx (dev mode)
npm run build        # Compile TypeScript
npm test             # Security and MCP integration tests
npm audit --omit=dev # Audit runtime dependencies
npm run lint         # ESLint
npm run typecheck    # Type checking
npm run inspector    # Test with MCP Inspector
```

## License

MIT
