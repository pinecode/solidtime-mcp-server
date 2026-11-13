import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { createServer } from "../dist/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const member = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const goal = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const project = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const root = `/api/v1/organizations/${org}/goals`;
const body = { name: "Focus time", comparison: "at_least", target_seconds: 21600, period: "day" };
const progress = { tracked_seconds: 7200, status: "in_progress", period_start: "2026-11-13T00:00:00Z", period_end: "2026-11-14T00:00:00Z" };

async function setup(t, handler, config = {}) {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/memberships")) return Response.json({ data: [{ id: member, organization: { id: org, currency: "USD" } }] });
    if (parsed.pathname.endsWith("/users/me")) return Response.json({ data: { id: "user" } });
    return handler(parsed, options);
  });
  const server = await createServer({ apiUrl: "https://solidtime.example.com", apiToken: "TEST-TOKEN", organizationId: org, ...config });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "Goals protocol test", version: "1" });
  await server.connect(b);
  await client.connect(a);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}

test("default mode exposes goal reads and progress, never goal or other writes", async t => {
  const calls = [];
  const page = { data: [{ id: goal, ...body, type: "personal", progress }], links: { next: "?page=2" }, meta: { current_page: 1, last_page: 2 } };
  const client = await setup(t, async (url, options) => { calls.push({ url, options }); return Response.json(page); });
  const { tools } = await client.listTools();
  assert.equal(tools.length, 21);
  assert.ok(tools.every(tool => tool.annotations.readOnlyHint));
  assert.ok(tools.some(tool => tool.name === "solidtime_get_goal"));
  assert.ok(!tools.some(tool => tool.name === "solidtime_create_goal" || tool.name === "solidtime_update_goal"));
  const result = await client.callTool({ name: "solidtime_list_goals", arguments: { archived: "all", type: "personal", page: 2 } });
  assert.notEqual(result.isError, true);
  assert.deepEqual(result.structuredContent, page);
  assert.deepEqual(JSON.parse(result.content[0].text), page);
  assert.equal(calls[0].url.pathname, root);
  assert.equal(calls[0].url.searchParams.get("archived"), "all");
  assert.equal(calls[0].url.searchParams.get("type"), "personal");
  assert.equal(calls[0].url.searchParams.get("page"), "2");
  assert.equal(calls[0].options.method, "GET");
});

test("goal-only write mode preserves all other tools' read-only registration", async t => {
  const client = await setup(t, async () => { throw new Error("Unexpected API request"); }, { goalWrites: true });
  const { tools } = await client.listTools();
  assert.equal(tools.length, 23);
  assert.deepEqual(tools.filter(tool => !tool.annotations.readOnlyHint).map(tool => tool.name).sort(), ["solidtime_create_goal", "solidtime_update_goal"]);
  for (const name of ["solidtime_start_timer", "solidtime_create_labor_cost_rate", "solidtime_update_member_payment_currency", "solidtime_delete_goal"])
    assert.ok(!tools.some(tool => tool.name === name));
});

test("full-write opt-in also supports Goals without a separate flag", async t => {
  const client = await setup(t, async () => Response.json({ data: {} }), { readOnly: false });
  const { tools } = await client.listTools();
  assert.ok(tools.some(tool => tool.name === "solidtime_create_goal"));
  assert.ok(tools.some(tool => tool.name === "solidtime_update_goal"));
});

test("get goal preserves server progress, filters and permission errors", async t => {
  let status = 200;
  const client = await setup(t, async url => {
    assert.equal(url.pathname, `${root}/${goal}`);
    return Response.json(status === 200 ? { data: { id: goal, progress, filters: { billable: false } } } : { private: "do not echo" }, { status });
  });
  const get = () => client.callTool({ name: "solidtime_get_goal", arguments: { id: goal } });
  assert.deepEqual((await get()).structuredContent.data.progress, progress);
  for (status of [403, 404]) {
    const result = await get();
    assert.equal(result.isError, true);
    assert.ok(!JSON.stringify(result).includes("do not echo"));
  }
});

test("create sends a personal goal with seconds, native filters, timezone and false values", async t => {
  const calls = [];
  const client = await setup(t, async (url, options) => {
    calls.push({ url, options });
    return Response.json({ data: { id: goal, ...JSON.parse(options.body), progress } }, { status: 201 });
  }, { goalWrites: true });
  const args = { ...body, name: "  Focus time  ", timezone: "Europe/Budapest", week_start: "monday", filters: { project_ids: [project, "none"], tag_ids: [], client_ids: null, billable: "false", time_entry_type: "work", tag_match_type: "not_contains" } };
  const result = await client.callTool({ name: "solidtime_create_goal", arguments: args });
  assert.notEqual(result.isError, true);
  assert.equal(result.structuredContent.data.progress.tracked_seconds, 7200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, root);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.redirect, "error");
  assert.deepEqual(JSON.parse(calls[0].options.body), { ...args, name: "Focus time", type: "personal", filters: { ...args.filters, billable: false } });
});

test("less-than weekly goals preserve target seconds without rounding or automatic retries", async t => {
  let calls = 0;
  const client = await setup(t, async (_url, options) => {
    calls++;
    assert.deepEqual(JSON.parse(options.body), { ...body, target_seconds: 18000, comparison: "less_than", period: "week", type: "personal" });
    return Response.json({ private: "plan-limit-details" }, { status: 403 });
  }, { goalWrites: true });
  const result = await client.callTool({ name: "solidtime_create_goal", arguments: { ...body, target_seconds: 18000, comparison: "less_than", period: "week" } });
  assert.equal(result.isError, true);
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(result).includes("plan-limit-details"));
});

test("invalid create arguments and ownership overrides fail before making API calls", async t => {
  let calls = 0;
  const client = await setup(t, async () => { calls++; return Response.json({ data: {} }); }, { goalWrites: true });
  for (const invalid of [
    { target_seconds: 0 }, { target_seconds: -1 }, { target_seconds: 1.5 }, { target_seconds: 2147483648 },
    { name: " " }, { name: "x".repeat(256) }, { comparison: "greater_than" }, { period: "year" },
    { timezone: "invalid/timezone" }, { week_start: "Monday" }, { type: "organization" }, { member_id: member },
    { filters: { project_ids: ["../other"] } }, { filters: { member_ids: [member] } },
    { filters: { time_entry_type: "holiday" } }, { filters: { billable: "yes" } },
    { filters: { tag_match_type: "any" } }, { is_archived: true },
  ]) {
    const result = await client.callTool({ name: "solidtime_create_goal", arguments: { ...body, ...invalid } });
    assert.equal(result.isError, true, JSON.stringify(invalid));
  }
  assert.equal(calls, 0);
});

test("partial updates preserve omitted goal fields and do not expose type/member/archive mutations", async t => {
  const calls = [];
  const client = await setup(t, async (url, options) => { calls.push({ url, options }); return Response.json({ data: { id: goal, progress } }); }, { goalWrites: true });
  const result = await client.callTool({ name: "solidtime_update_goal", arguments: { id: goal, target_seconds: 72000 } });
  assert.notEqual(result.isError, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, `${root}/${goal}`);
  assert.equal(calls[0].options.method, "PUT");
  assert.deepEqual(JSON.parse(calls[0].options.body), { target_seconds: 72000 });
  for (const invalid of [{}, { type: "personal" }, { member_id: member }, { is_archived: true }, { name: "" }]) {
    const result = await client.callTool({ name: "solidtime_update_goal", arguments: { id: goal, ...invalid } });
    assert.equal(result.isError, true);
  }
  assert.equal(calls.length, 1);
});

test("filter edits merge fresh server filters and explicitly clear only requested filters", async t => {
  const calls = [];
  const current = { project_ids: [project], tag_ids: [member], billable: true, time_entry_type: "work", member_ids: null };
  const client = await setup(t, async (url, options) => {
    calls.push({ url, options });
    return Response.json(options.method === "GET" ? { data: { type: "personal", filters: current } } : { data: { id: goal, progress } });
  }, { goalWrites: true });
  const result = await client.callTool({ name: "solidtime_update_goal", arguments: { id: goal, filters: { tag_ids: [], billable: false }, period: "month" } });
  assert.notEqual(result.isError, true);
  assert.deepEqual(calls.map(c => c.options.method), ["GET", "PUT"]);
  assert.ok(calls.every(c => c.url.pathname === `${root}/${goal}`));
  assert.deepEqual(JSON.parse(calls[1].options.body), { period: "month", filters: { ...current, tag_ids: [], billable: false } });
});

test("forbidden reads prevent a filter edit from issuing a write", async t => {
  const methods = [];
  const client = await setup(t, async (_url, options) => { methods.push(options.method); return Response.json({}, { status: 403 }); }, { goalWrites: true });
  const result = await client.callTool({ name: "solidtime_update_goal", arguments: { id: goal, filters: { project_ids: null } } });
  assert.equal(result.isError, true);
  assert.deepEqual(methods, ["GET"]);
});

test("goal path traversal and invalid pagination are rejected locally", async t => {
  let calls = 0;
  const client = await setup(t, async () => { calls++; return Response.json({ data: {} }); }, { goalWrites: true });
  for (const [name, args] of [
    ["solidtime_get_goal", { id: "../outside" }],
    ["solidtime_update_goal", { id: "../outside", name: "No" }],
    ["solidtime_list_goals", { page: 0 }],
    ["solidtime_list_goals", { archived: "yes" }],
    ["solidtime_list_goals", { type: "../outside" }],
  ]) assert.equal((await client.callTool({ name, arguments: args })).isError, true);
  assert.equal(calls, 0);
});

test("invalid goals-write environment flag fails before connecting to Solidtime", () => {
  const result = spawnSync(process.execPath, [new URL("../dist/index.js", import.meta.url).pathname], {
    env: { ...process.env, SOLIDTIME_GOALS_WRITE_ENABLED: "yes" }, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SOLIDTIME_GOALS_WRITE_ENABLED must be true or false/);
});
