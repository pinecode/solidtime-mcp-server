import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { ApiClient } from "../api-client.js";
import { GROUP_BY_VALUES } from "../constants.js";
import { coerceUuidArray } from "../schemas.js";
import { reportHtml } from "../app/report-html.js";

const appUri = "ui://solidtime/labor-costs.html";
const read = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
const write = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
export const costQuery = {
  date_from: date.optional().describe("Inclusive first cost date in the organization timezone."),
  date_to: date.optional().describe("Inclusive last cost date in the organization timezone."),
  currency: currency
    .optional()
    .describe("Report currency, e.g. RUB; original currencies are always included separately."),
  native: z.enum(["true", "false"]).optional(),
  group: z.enum(GROUP_BY_VALUES).optional(),
  sub_group: z
    .enum(GROUP_BY_VALUES)
    .optional()
    .describe("Nested breakdown, e.g. group=project and sub_group=task."),
  member_id: z.string().uuid().optional(),
  member_ids: coerceUuidArray.optional(),
  project_ids: coerceUuidArray.optional(),
  client_ids: coerceUuidArray.optional(),
  task_ids: coerceUuidArray.optional(),
  tag_ids: coerceUuidArray.optional(),
  tag_match_type: z.enum(["contains", "not_contains"]).optional(),
  page: z.number().int().min(1).optional(),
  per_page: z.number().int().min(1).max(200).optional(),
};
export function queryString(params: Record<string, unknown>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((id) => query.append(`${key}[]`, String(id)));
    else query.set(key, String(value));
  }
  return query.toString();
}
const json = (data: Record<string, unknown>) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
  structuredContent: data,
});

export function registerLaborCostTools(
  server: McpServer,
  api: ApiClient,
  org: string,
  readOnly: boolean
) {
  const root = `/organizations/${org}`;
  registerAppResource(
    server,
    "labor-costs-report",
    appUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const appScript = (
        await readFile(new URL("../app/report-ui.js", import.meta.url), "utf8")
      ).replace(/<\/script/gi, "<\\/script");
      return {
        contents: [
          {
            uri: appUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: reportHtml.replace("__SCRIPT__", () => appScript),
            _meta: {
              ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true },
            },
          },
        ],
      };
    }
  );
  registerAppTool(
    server,
    "solidtime_get_labor_cost_report",
    {
      title: "Employee expense report",
      description:
        "Show an interactive billable work/expense report with original, report and employee payment currencies, plus earned-amount weighted daily FX. Use member_ids for one employee, group=project and sub_group=task for project/task hours. Only completed billable work counts; this is NOT all tracked hours or customer billable amounts. Missing rates/FX produce independently incomplete report/payment subtotals. Non-admin users can see only their own costs. Requires the PineCode LaborCosts extension.",
      inputSchema: costQuery,
      annotations: read,
      _meta: { ui: { resourceUri: appUri } },
    },
    async (params) => {
      const response = await api.get<{ data: Record<string, unknown> }>(
        `${root}/labor-costs/entries?${queryString({ ...params, group: params.group ?? "user", per_page: params.per_page ?? 20 })}`
      );
      return json({ report: response.data, query: params });
    }
  );
  server.registerTool(
    "solidtime_get_labor_cost_entries",
    {
      title: "Expense entry details",
      description:
        "Paginated completed billable work, effective expense rates, original and converted money, and missing-data flags. Never substitutes billing cost for expenses.",
      inputSchema: costQuery,
      annotations: read,
    },
    async (params) => json(await api.get(`${root}/labor-costs/entries?${queryString(params)}`))
  );
  server.registerTool(
    "solidtime_get_labor_cost_settings",
    {
      title: "Expense settings",
      description:
        "Organization expense timezone, project display currencies and scoped employee payment currencies, separate from hourly rates and billing settings.",
      annotations: read,
    },
    async () => json(await api.get(`${root}/labor-costs/settings`))
  );
  server.registerTool(
    "solidtime_get_current_labor_cost_rates",
    {
      title: "Current employee expense rates",
      description:
        "Personal hourly expense rates effective today in the organization timezone, excluding future/cancelled rates. Owner/Admin see all; other members see only their own. Zero and no assigned rate are distinct. Requires the PineCode extension.",
      annotations: read,
    },
    async () => json(await api.get(`${root}/labor-costs/member-rates/current`))
  );
  server.registerTool(
    "solidtime_get_labor_cost_rates",
    {
      title: "Expense rate history",
      description:
        "Active and cancelled effective-dated expense rates. Members may read only their own history; project fallbacks require Owner/Admin.",
      inputSchema: { subject: z.enum(["members", "projects"]), id: z.string().uuid() },
      annotations: read,
    },
    async ({ subject, id }) => json(await api.get(`${root}/${subject}/${id}/labor-cost-rates`))
  );

  const exports = new Map<
    string,
    { data: Buffer; mimeType: string; expires: number; name: string }
  >();
  function expire() {
    for (const [id, value] of exports) if (value.expires < Date.now()) exports.delete(id);
  }
  function exportResource(file: { data: Buffer; mimeType: string }, name: string) {
    expire();
    while (exports.size >= 5) exports.delete(exports.keys().next().value!);
    const id = randomUUID();
    exports.set(id, { ...file, expires: Date.now() + 600000, name });
    return {
      content: [
        {
          type: "resource_link" as const,
          uri: `solidtime://exports/${id}`,
          name,
          mimeType: file.mimeType,
        },
      ],
    };
  }
  server.registerResource(
    "expense-export",
    new ResourceTemplate("solidtime://exports/{id}", {
      list: async () => {
        expire();
        return {
          resources: [...exports].map(([id, file]) => ({
            uri: `solidtime://exports/${id}`,
            name: file.name,
            mimeType: file.mimeType,
          })),
        };
      },
    }),
    {},
    async (uri, { id }) => {
      expire();
      const file = exports.get(String(id));
      if (!file) throw new Error("Export expired or is unknown. Generate it again.");
      return {
        contents: [{ uri: uri.href, mimeType: file.mimeType, blob: file.data.toString("base64") }],
      };
    }
  );
  server.registerTool(
    "solidtime_export_labor_costs",
    {
      title: "Export dual-currency expenses",
      description:
        "Generate a private CSV or PDF with original, report and employee payment currencies and weighted FX, returning a session-only resource link valid for ten minutes. No public URL or file is created by MCP.",
      inputSchema: { ...costQuery, format: z.enum(["csv", "pdf"]) },
      annotations: read,
    },
    async (params) => {
      const file = await api.getExport(`${root}/labor-costs/export?${queryString(params)}`);
      return exportResource(file, `labor-costs.${params.format}`);
    }
  );
  server.registerTool(
    "solidtime_export_employee_report",
    {
      title: "Detailed employee PDF",
      description:
        "Download one employee's private detailed time-and-pay PDF for an inclusive date range. Reuses Overview's time charts and Project > Description breakdown; the header adds original earnings, payment-currency estimate and earned-amount weighted historical FX. Time includes all matching completed work, but only billable work earns money. No customer billing, rounding or settlement ledger. Owner/Admin may select anyone; others only themselves. Requires the PineCode employee-report endpoint. Returns a session-only PDF resource, valid ten minutes; use resources/read to obtain its bytes for an authorized document workflow, never a public URL.",
      inputSchema: {
        member_id: z
          .string()
          .uuid()
          .describe(
            "Organization membership ID, not a user ID; use solidtime_list_members to find it."
          ),
        date_from: date.describe("Inclusive first persisted cost date, YYYY-MM-DD."),
        date_to: date.describe("Inclusive last persisted cost date, YYYY-MM-DD."),
        project_ids: costQuery.project_ids,
        client_ids: costQuery.client_ids,
        task_ids: costQuery.task_ids,
        tag_ids: costQuery.tag_ids,
        tag_match_type: costQuery.tag_match_type,
        billable: z
          .enum(["true", "false"])
          .optional()
          .describe(
            "Omit to include all completed work in the time breakdown; earnings still include billable work only."
          ),
      },
      annotations: read,
    },
    async (params) => {
      const file = await api.getExport(
        `${root}/labor-costs/employee-report?${queryString(params)}`
      );
      if (
        file.mimeType !== "application/pdf" ||
        !file.data.subarray(0, 5).equals(Buffer.from("%PDF-"))
      )
        throw new Error("SolidTime returned an invalid employee PDF.");
      return exportResource(file, `employee-report-${params.date_from}-${params.date_to}.pdf`);
    }
  );
  if (readOnly) return;
  const rate = {
    amount: z
      .string()
      .regex(/^\d+$/)
      .describe("Hourly amount in currency minor units; use a string to preserve precision."),
    currency,
    effective_from: date,
  };
  server.registerTool(
    "solidtime_create_labor_cost_rate",
    {
      title: "Schedule expense rate",
      description:
        "Owner/Admin only. Add a dated employee rate or project fallback; a future raise preserves previous periods. Backdating intentionally recalculates its interval.",
      inputSchema: { subject: z.enum(["members", "projects"]), id: z.string().uuid(), ...rate },
      annotations: write,
    },
    async ({ subject, id, ...body }) =>
      json(await api.post(`${root}/${subject}/${id}/labor-cost-rates`, body))
  );
  server.registerTool(
    "solidtime_update_labor_cost_rate",
    {
      title: "Correct expense rate",
      description:
        "Owner/Admin only. Audited correction of an existing rate version. Confirm its historical impact with the user first.",
      inputSchema: { id: z.string().uuid(), ...rate },
      annotations: { ...write, destructiveHint: true, idempotentHint: true },
    },
    async ({ id, ...body }) => json(await api.put(`${root}/labor-cost-rates/${id}`, body))
  );
  server.registerTool(
    "solidtime_cancel_labor_cost_rate",
    {
      title: "Cancel expense rate",
      description:
        "Owner/Admin only. Audited cancellation; the old version remains in history. Confirm the affected period with the user before calling.",
      inputSchema: { id: z.string().uuid() },
      annotations: { ...write, destructiveHint: true, idempotentHint: true },
    },
    async ({ id }) => json(await api.delete(`${root}/labor-cost-rates/${id}`))
  );
  server.registerTool(
    "solidtime_update_expense_timezone",
    {
      title: "Expense timezone",
      description:
        "Owner/Admin only. Change organization timezone for new cost dates and FX scheduling; existing cost dates are preserved.",
      inputSchema: { timezone: z.string().min(1) },
      annotations: { ...write, idempotentHint: true },
    },
    async (body) => json(await api.put(`${root}/labor-costs/settings`, body))
  );
  server.registerTool(
    "solidtime_update_project_expense_currency",
    {
      title: "Project expense currency",
      description:
        "Owner/Admin only. Change display currency without editing employee rates, timers, or customer billing.",
      inputSchema: { id: z.string().uuid(), cost_currency: currency },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ id, ...body }) =>
      json(await api.put(`${root}/labor-costs/projects/${id}/currency`, body))
  );
  server.registerTool(
    "solidtime_update_member_payment_currency",
    {
      title: "Employee payment currency",
      description:
        "Owner/Admin only. Set a separate salary/payment currency, or null for original rate currencies. This current preference changes payment views of all periods, not hourly rate history, timers, billing or actual settlements. Confirm the desired currency with the user first.",
      inputSchema: { id: z.string().uuid(), payment_currency: currency.nullable() },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ id, ...body }) =>
      json(await api.put(`${root}/labor-costs/members/${id}/payment-currency`, body))
  );
}
