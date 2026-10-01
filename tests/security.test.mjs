import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiClient, SolidTimeApiError } from "../dist/api-client.js";
import { createServer } from "../dist/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const origin = "https://solidtime.example.com";
const token = "FAKE-TEST-TOKEN";
const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("requires an explicit HTTPS origin and a valid token", () => {
  for (const url of [
    undefined,
    "",
    "http://solidtime.example.com",
    "https://user:password@solidtime.example.com",
    `${origin}/api`,
    `${origin}?token=secret`,
    `${origin}#fragment`,
    "not a URL",
  ]) {
    assert.throws(() => new ApiClient(url, token));
  }
  assert.throws(() => new ApiClient(origin, ""));
  assert.throws(() => new ApiClient(origin, "token\nvalue"));
  assert.doesNotThrow(() => new ApiClient(origin, token));
});

test("pins requests to the configured origin and refuses redirects", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json({ data: [] });
  });
  const api = new ApiClient(origin, token);
  await api.get("/users/me");
  assert.equal(calls[0].url, `${origin}/api/v1/users/me`);
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${token}`);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  await assert.rejects(api.get("/../../outside"), /Invalid API request path/);
  assert.equal(calls.length, 1);
});

test("read-only mode blocks writes before making a network request", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ data: [] }));
  const api = new ApiClient(origin, token);
  await assert.rejects(api.post("/projects", {}), /disabled/);
  await assert.rejects(api.put("/projects/1", {}), /disabled/);
  await assert.rejects(api.delete("/projects/1"), /disabled/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("API and transport errors never echo tokens or response bodies", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ token, email: "private@example.com" }, { status: 422 })
  );
  const api = new ApiClient(origin, token);
  await assert.rejects(api.get("/users/me"), (error) => {
    assert.ok(error instanceof SolidTimeApiError);
    assert.equal(error.status, 422);
    assert.ok(!JSON.stringify(error).includes(token));
    assert.ok(!String(error).includes("private@example.com"));
    return true;
  });
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error(token);
  });
  await assert.rejects(api.get("/users/me"), (error) => !String(error).includes(token));
});

test("MCP advertises only read tools by default and emits no user logs", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(String(url));
    const data = String(url).includes("/members")
      ? [{ id: "member", user_id: "user" }]
      : { id: "user", name: "Private Name", email: "private@example.com" };
    return Response.json({ data });
  });
  const log = t.mock.method(console, "error", () => {});
  const server = await createServer({ apiUrl: origin, apiToken: token, organizationId: org });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 8);
    assert.ok(tools.every((tool) => tool.annotations.readOnlyHint === true));
    const blocked = await client.callTool({
      name: "solidtime_delete_project",
      arguments: { id: org },
    });
    assert.equal(blocked.isError, true);
    assert.equal(calls.length, 2);
    assert.equal(log.mock.callCount(), 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test("invalid organization IDs fail before making API requests", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({}));
  await assert.rejects(
    createServer({ apiUrl: origin, apiToken: token, organizationId: "../outside" }),
    /UUID/
  );
  assert.equal(fetch.mock.callCount(), 0);
});

test("writes require explicit opt-in and retain the configured destination", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json({ data: {} });
  });
  const api = new ApiClient(origin, token, false);
  await api.post("/projects", { name: "Test" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${origin}/api/v1/projects`);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.redirect, "error");
});
