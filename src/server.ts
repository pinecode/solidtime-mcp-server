import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiClient } from "./api-client.js";
import { API_PATHS } from "./constants.js";
import { registerUserTools } from "./tools/users.js";
import { registerTimeEntryTools } from "./tools/time-entries.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerClientTools } from "./tools/clients.js";
import { registerTagTools } from "./tools/tags.js";
import { registerTaskTools } from "./tools/tasks.js";
import type { User, Member, PaginatedResponse } from "./types.js";
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
  const userResponse = await api.get<{ data: User }>(API_PATHS.me);
  const user = userResponse.data;
  const membersResponse = await api.get<PaginatedResponse<Member>>(API_PATHS.members(orgId));
  const members = membersResponse.data ?? [];
  const member = members.find((m) => m.user_id === user.id);

  if (!member) {
    throw new Error(
      "Could not resolve the current member. Verify SOLIDTIME_ORGANIZATION_ID and membership permissions."
    );
  }

  const memberId = member.id;
  const getMemberId = () => memberId;

  const server = new McpServer({
    name: "solidtime",
    version: "1.0.0",
  });

  registerUserTools(server, api, getMemberId);
  registerTimeEntryTools(server, api, orgId, getMemberId, readOnly);
  registerProjectTools(server, api, orgId, readOnly);
  registerClientTools(server, api, orgId, readOnly);
  registerTagTools(server, api, orgId, readOnly);
  registerTaskTools(server, api, orgId, readOnly);

  return server;
}
