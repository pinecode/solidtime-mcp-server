# Changelog

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
