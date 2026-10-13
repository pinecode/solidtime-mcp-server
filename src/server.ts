import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiClient } from "./api-client.js";
import { API_PATHS } from "./constants.js";
import { registerUserTools } from "./tools/users.js";
import { registerTimeEntryTools } from "./tools/time-entries.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerClientTools } from "./tools/clients.js";
import { registerTagTools } from "./tools/tags.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerLaborCostTools } from "./tools/labor-costs.js";
import { z } from "zod";

interface ServerConfig {
  apiToken: string;
  organizationId: string;
  apiUrl?: string;
  readOnly?: boolean;
}

export async function createServer(config: ServerConfig) {
  const readOnly = config.readOnly ?? true;
  const api = new ApiClient(config.apiUrl, config.apiToken, readOnly);
  const orgId = config.organizationId;
  if (!z.string().uuid().safeParse(orgId).success) {
    throw new Error("SOLIDTIME_ORGANIZATION_ID must be a UUID.");
  }

  // Resolve member_id at startup
  await api.get(API_PATHS.me);
  const memberships = await api.get<{
    data: { id: string; organization: { id: string; currency: string } }[];
  }>("/users/me/memberships");
  const member = memberships.data.find((m) => m.organization.id === orgId);

  if (!member) {
    throw new Error(
      "Could not resolve the current member. Verify SOLIDTIME_ORGANIZATION_ID and membership permissions."
    );
  }

  const memberId = member.id;
  const getMemberId = () => memberId;

  const server = new McpServer({
    name: "solidtime",
    version: "1.1.0",
  });

  registerUserTools(server, api, getMemberId);
  registerTimeEntryTools(server, api, orgId, getMemberId, readOnly, member.organization.currency);
  registerProjectTools(server, api, orgId, readOnly, member.organization.currency);
  registerClientTools(server, api, orgId, readOnly);
  registerTagTools(server, api, orgId, readOnly);
  registerTaskTools(server, api, orgId, readOnly);
  registerLaborCostTools(server, api, orgId, readOnly);

  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };
  const dataResult = (data: Record<string, unknown>) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data,
  });
  server.registerTool(
    "solidtime_list_members",
    {
      title: "Organization members",
      description:
        "List organization members with names and UUIDs for employee reports. Paginated; use page to retrieve more. Expense rate histories use their own tool.",
      inputSchema: { page: z.number().int().min(1).optional() },
      annotations,
    },
    async ({ page }) => dataResult(await api.get(`${API_PATHS.members(orgId)}?page=${page ?? 1}`))
  );
  server.registerTool(
    "solidtime_get_organization",
    {
      title: "Organization",
      description:
        "Current organization settings including its real billing currency. Expense settings are separate.",
      annotations,
    },
    async () => dataResult(await api.get(`/organizations/${orgId}`))
  );
  server.registerTool(
    "solidtime_get_currencies",
    {
      title: "Supported currencies",
      description:
        "Supported ISO currencies and names. A supported currency may still lack official CBR FX quotes.",
      annotations,
    },
    async () => dataResult(await api.get("/currencies"))
  );
  server.registerTool(
    "solidtime_get_project",
    {
      title: "Project details",
      description: "Project details, subject to the user's project access permissions.",
      inputSchema: { id: z.string().uuid() },
      annotations,
    },
    async ({ id }) => dataResult(await api.get(API_PATHS.project(orgId, id)))
  );

  return server;
}
