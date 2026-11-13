# Changelog

## 1.4.0

- Add native Goals listing, details, personal creation and partial editing with server-calculated current-period progress.
- Allow only Goal creation/editing with `SOLIDTIME_GOALS_WRITE_ENABLED=true`, leaving timers, labor rates, payment currencies and other writes disabled in read-only mode.
- Validate goal targets, periods, timezones and filters; preserve omitted fields and filter keys during edits. Keep Solidtime's creator-only permissions and plan limits, without exposing deletion, archiving or ownership changes.
- Document Codex setup and cover read-only discovery, opt-in writes, permission failures, partial updates and invalid inputs in protocol tests.
- Upgrade Zod to 4.6.7 and refresh compatible transitive dependencies to clear the production dependency audit; retain the current MCP SDK and local stdio transport.

## 1.3.1

- Update the pinned MCP SDK to 1.32.1 and transitive ip-address to 10.7.4, clearing the production dependency audit. The server continues to use local stdio, not the SDK's HTTP authentication/task transports.
- Wrap the currency list in a `data` object so `structuredContent` conforms to MCP instead of returning an invalid top-level array. This fixes an existing integration bug, not a Solidtime API change.
- Verify read-only MCP tools, dual-currency employee expenses, private exports and the inline report against Solidtime v0.22.1.

## 1.1.0

- Historical labor expense reports, rate histories, settings, CSV/PDF resources and opt-in rate/currency management.
- Sandboxed MCP App for interactive inline dual-currency reports; text/JSON retained for non-UI hosts.
- Read-only discovery tools for members, organization, project and currencies.
- Fix report/list array filters to use the actual API parameter names, and format billing amounts in the organization currency instead of hard-coded EUR.
- Resolve the caller via personal memberships, avoiding the first-page member-list limitation at startup.
- Bound binary downloads and session-only export retention; no widget token, remote assets or telemetry.
- Require Node 20+ for the pinned MCP Apps SDK.

## 1.0.0 (2026-03-03)

### Features

- **Time Entries**: Start/stop timers, create/update/delete entries, list with filters, aggregated reports
- **Projects**: List, create, update, delete projects with billable rates and estimates
- **Clients**: List, create, update clients
- **Tags**: List, create, update tags
- **Tasks**: List, create, update tasks with project assignment
- **Users**: Get current user profile with resolved member ID
- **Auto member_id resolution**: No need to manually configure member IDs
- **Actionable error messages**: Every error tells you what to do next
- **MCP annotations**: Read-only, destructive, and idempotent hints for all tools
