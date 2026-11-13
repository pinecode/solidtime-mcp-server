import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../api-client.js";
import { coerceBoolean } from "../schemas.js";

const ids = z
  .array(z.union([z.string().uuid(), z.literal("none")]))
  .nullable()
  .optional();
const filters = z
  .object({
    project_ids: ids,
    task_ids: ids,
    client_ids: ids,
    tag_ids: ids,
    tag_match_type: z.enum(["contains", "not_contains"]).nullable().optional(),
    billable: coerceBoolean.nullable().optional(),
    time_entry_type: z
      .enum(["work", "break"])
      .nullable()
      .optional()
      .describe("Use work for work-hour targets; omitted/null includes both work and breaks."),
  })
  .strict();
const comparison = z.enum(["at_least", "less_than"]);
const period = z.enum(["day", "week", "month"]);
const target = z
  .number()
  .int()
  .min(1)
  .max(2147483647)
  .describe("Target in seconds: 6 hours = 21600.");
const timezone = z.string().min(1).max(255).refine(isTimezone, "Use a valid IANA timezone.");
const weekStart = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);
const fields = {
  name: z.string().trim().min(1).max(255),
  comparison,
  target_seconds: target,
  period,
  filters: filters
    .optional()
    .describe(
      "Time filters. On update, only supplied filter keys change; null or [] clears that filter."
    ),
  timezone: timezone
    .optional()
    .describe("Period timezone; creation defaults to the current user's timezone."),
  week_start: weekStart
    .optional()
    .describe("Weekly period start; creation defaults to the current user's setting."),
};
const read = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
const json = (data: Record<string, unknown>) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
  structuredContent: data,
});

function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function registerGoalTools(
  server: McpServer,
  api: ApiClient,
  org: string,
  writer?: ApiClient
) {
  const root = `/organizations/${org}/goals`;
  server.registerTool(
    "solidtime_list_goals",
    {
      title: "Goals and progress",
      description:
        "List visible goals with current-period tracked_seconds, target, status and period boundaries. Personal goals are private to their creator, even from Owner/Admin. Core Solidtime supports personal goals; organization goals require its team-goals extension. Paginated; follow meta/links, not an assumed complete first page.",
      inputSchema: z
        .object({
          archived: z.enum(["true", "false", "all"]).optional(),
          type: z.enum(["personal", "organization"]).optional(),
          page: z.number().int().min(1).max(2147483647).optional(),
        })
        .strict(),
      annotations: read,
    },
    async (params) => {
      const query = new URLSearchParams(
        Object.entries(params).map(([key, value]) => [key, String(value)])
      );
      return json(await api.get(`${root}${query.size ? `?${query}` : ""}`));
    }
  );
  server.registerTool(
    "solidtime_get_goal",
    {
      title: "Goal details and progress",
      description:
        "Read one visible goal, its filters and server-calculated current-period progress. Use solidtime_list_goals for IDs. Personal goals remain private to their creator.",
      inputSchema: z.object({ id: z.string().uuid() }).strict(),
      annotations: read,
    },
    async ({ id }) => json(await api.get(`${root}/${id}`))
  );
  if (!writer) return;
  server.registerTool(
    "solidtime_create_goal",
    {
      title: "Create personal goal",
      description:
        "Create a personal goal for the authenticated member only when the user requests it. Choose at_least to reach a target or less_than to stay below it. Targets are seconds per day/week/month. Server permissions and plan limits still apply. This does not track time or modify other members' goals.",
      inputSchema: z.object(fields).strict(),
      annotations: { ...read, readOnlyHint: false, idempotentHint: false },
    },
    async (body) => json(await writer.post(root, { ...body, type: "personal" }))
  );
  server.registerTool(
    "solidtime_update_goal",
    {
      title: "Edit personal goal",
      description:
        "Edit a personal goal when requested by its creator. Omitted fields are preserved; supplied filter keys merge with the current filters, and null or [] clears a filter. Type/member ownership cannot change. Deleting, archiving, time entries and payments are not supported by this tool.",
      inputSchema: z
        .object({
          id: z.string().uuid(),
          name: fields.name.optional(),
          comparison: comparison.optional(),
          target_seconds: target.optional(),
          period: period.optional(),
          filters: fields.filters,
          timezone: fields.timezone,
          week_start: fields.week_start,
        })
        .strict(),
      annotations: { ...read, readOnlyHint: false },
    },
    async ({ id, ...body }) => {
      if (Object.keys(body).length === 0) throw new Error("Provide at least one field to update.");
      if (body.filters !== undefined) {
        const current = await api.get<{ data: { filters: Record<string, unknown> } }>(
          `${root}/${id}`
        );
        body.filters = { ...current.data.filters, ...body.filters };
      }
      return json(await writer.put(`${root}/${id}`, body));
    }
  );
}
