import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "../dist/server.js";
import { ApiClient } from "../dist/api-client.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { formatCurrency } from "../dist/formatting.js";
import { readFile } from "node:fs/promises";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const member = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const origin = "https://solidtime.example.com";
async function setup(t, handler, readOnly = true) {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/memberships")) return Response.json({data:[{id:member, organization:{id:org,currency:"USD"}}]});
    if (path.endsWith("/users/me")) return Response.json({data:{id:"user"}});
    return handler(new URL(url), options);
  });
  const server = await createServer({apiUrl:origin,apiToken:"FAKE-TEST-TOKEN",organizationId:org,readOnly});
  const [a,b] = InMemoryTransport.createLinkedPair();
  const client = new Client({name:"tests",version:"1"});
  await server.connect(b); await client.connect(a);
  t.after(async () => {await client.close();await server.close();});
  return client;
}
test("expense reports keep exact currency strings, real filters, and MCP App metadata", async t => {
  const client = await setup(t, async url => {
    assert.equal(url.pathname, `/api/v1/organizations/${org}/labor-costs/entries`);
    assert.equal(url.searchParams.get("member_ids[]"), member);
    assert.equal(url.searchParams.has("filter[member_ids][]"), false);
    assert.equal(url.searchParams.get("currency"), "RUB");
    assert.equal(url.searchParams.get("date_from"), "2026-09-01");
    assert.equal(url.searchParams.get("date_to"), "2026-09-30");
    assert.equal(url.searchParams.get("group"), "project");
    assert.equal(url.searchParams.get("sub_group"), "task");
    assert.equal(url.searchParams.get("per_page"), "20");
    return Response.json({data:{totals:{native:[{amount:"6.00",currency:"USD"}],known_subtotal:[{amount:"480.00",currency:"RUB"}],complete:true}}});
  });
  const {tools} = await client.listTools();
  const tool = tools.find(t => t.name === "solidtime_get_labor_cost_report");
  assert.equal(tool._meta.ui.resourceUri,"ui://solidtime/labor-costs.html");
  const result = await client.callTool({name:tool.name,arguments:{member_ids:[member],currency:"RUB",date_from:"2026-09-01",date_to:"2026-09-30",group:"project",sub_group:"task"}});
  assert.equal(result.structuredContent.report.totals.native[0].amount,"6.00");
  assert.equal(result.structuredContent.report.totals.known_subtotal[0].amount,"480.00");
  const resource = await client.readResource({uri:tool._meta.ui.resourceUri});
  assert.equal(resource.contents[0].mimeType,"text/html;profile=mcp-app");
  assert.deepEqual(resource.contents[0]._meta.ui.csp,{connectDomains:[],resourceDomains:[]});
  assert.ok(resource.contents[0].text.includes("Original expense"));
  assert.ok(resource.contents[0].text.includes('id="subgroup"'));
  assert.ok(resource.contents[0].text.includes('<details id="details">'));
  assert.ok(resource.contents[0].text.includes("Billable hours"));
  assert.ok(!resource.contents[0].text.includes("FAKE-TEST-TOKEN"));
  assert.ok(!resource.contents[0].text.includes("<script src=\"http"));
  const bundle = await readFile(new URL("../dist/app/report-ui.js", import.meta.url), "utf8");
  assert.ok(resource.contents[0].text.includes(bundle.replace(/<\/script/gi, "<\\/script")));
});

test("payment reports retain exact API money and weighted FX without changing report currency", async t => {
  const payment = {
    known_subtotal: [{amount:"1560.00",currency:"RUB"}],complete:true,missing_rate:0,missing_fx:0,
    exchange_rates:[{source_currency:"USD",payment_currency:"RUB",weighted_rate:"86.66666667",complete:true,missing_fx:0}],
  };
  const client = await setup(t, async () => Response.json({data:{
    currency:"USD",totals:{native:[{amount:"18.00",currency:"USD"}],known_subtotal:[{amount:"18.00",currency:"USD"}],payment,complete:true},
  }}));
  const result = await client.callTool({name:"solidtime_get_labor_cost_report",arguments:{currency:"USD",member_ids:[member]}});
  assert.equal(result.structuredContent.report.currency,"USD");
  assert.deepEqual(result.structuredContent.report.totals.payment,payment);
  const resource = await client.readResource({uri:"ui://solidtime/labor-costs.html"});
  assert.ok(resource.contents[0].text.includes('id="payment"'));
  assert.ok(resource.contents[0].text.includes('id="payment-rate"'));
  assert.ok(resource.contents[0].text.includes("Payment estimate"));
});

test("current personal rates use the scoped extension endpoint", async t => {
  const client = await setup(t, async url => {
    assert.equal(url.pathname,`/api/v1/organizations/${org}/labor-costs/member-rates/current`);
    return Response.json({data:{date:"2026-10-15",rates:[{member_id:member,amount:"0",currency:"JPY",effective_from:"2026-08-01"}]}});
  });
  const result = await client.callTool({name:"solidtime_get_current_labor_cost_rates",arguments:{}});
  assert.equal(result.structuredContent.data.rates[0].amount,"0");
});

test("payment currency writes are hidden by default and validate both UUID and nullable currency", async t => {
  const calls = [];
  const readClient = await setup(t, async () => {throw new Error("Unexpected API call");});
  const {tools} = await readClient.listTools();
  assert.ok(!tools.some(tool => tool.name === "solidtime_update_member_payment_currency"));
  const client = await setup(t, async (url,options) => {calls.push({url,options});return Response.json({data:{}});},false);
  const write = currency => client.callTool({name:"solidtime_update_member_payment_currency",arguments:{id:member,payment_currency:currency}});
  assert.ok(!(await write("RUB")).isError);
  assert.equal(calls[0].url.pathname,`/api/v1/organizations/${org}/labor-costs/members/${member}/payment-currency`);
  assert.equal(calls[0].options.method,"PUT");
  assert.deepEqual(JSON.parse(calls[0].options.body),{payment_currency:"RUB"});
  assert.ok(!(await write(null)).isError);
  assert.deepEqual(JSON.parse(calls[1].options.body),{payment_currency:null});
  assert.equal((await write("rub")).isError,true);
  assert.equal((await client.callTool({name:"solidtime_update_member_payment_currency",arguments:{id:"../outside",payment_currency:"RUB"}})).isError,true);
  assert.equal(calls.length,2);
});
test("expense exports are session-only resources and no filesystem/public URL is returned", async t => {
  const client = await setup(t, async () => new Response("%PDF-test",{headers:{"content-type":"application/pdf"}}));
  const result = await client.callTool({name:"solidtime_export_labor_costs",arguments:{format:"pdf",currency:"RUB"}});
  const link = result.content[0];
  assert.equal(link.type,"resource_link");
  assert.ok(link.uri.startsWith("solidtime://exports/"));
  const read = await client.readResource({uri:link.uri});
  assert.equal(Buffer.from(read.contents[0].blob,"base64").toString(),"%PDF-test");
  await assert.rejects(client.readResource({uri:"solidtime://exports/not-a-file"}));
});
test("expense writes are hidden in read-only mode and explicit writes preserve zero/string amounts", async t => {
  const calls=[];
  const client = await setup(t, async (url, options) => {calls.push({url,options});return Response.json({data:[]});}, false);
  const result = await client.callTool({name:"solidtime_create_labor_cost_rate",arguments:{subject:"members",id:member,amount:"0",currency:"JPY",effective_from:"2026-11-01"}});
  assert.ok(!result.isError);
  assert.equal(calls[0].url.pathname,`/api/v1/organizations/${org}/members/${member}/labor-cost-rates`);
  assert.equal(JSON.parse(calls[0].options.body).amount,"0");
  const invalid = await client.callTool({name:"solidtime_create_labor_cost_rate",arguments:{subject:"members",id:"../outside",amount:"1",currency:"USD",effective_from:"2026-11-01"}});
  assert.equal(invalid.isError,true);
  assert.equal(calls.length,1);
});
test("binary export refuses unexpected response formats and excessive size", async t => {
  t.mock.method(globalThis,"fetch",async()=>new Response("not a PDF",{headers:{"content-type":"text/html"}}));
  const api = new ApiClient(origin,"FAKE-TEST-TOKEN");
  await assert.rejects(api.getExport("/organizations/test/labor-costs/export?format=pdf"),/unexpected/);
  t.mock.method(globalThis,"fetch",async()=>new Response(new Uint8Array(8*1024*1024+1),{headers:{"content-type":"application/pdf"}}));
  await assert.rejects(api.getExport("/organizations/test/labor-costs/export?format=pdf"),/8 MiB/);
});
test("billing formatting uses the actual organization currency",()=>{
  assert.ok(formatCurrency(600,"USD").includes("$6.00"));
  assert.ok(!formatCurrency(600,"USD").includes("€"));
  assert.equal(formatCurrency(700,"JPY"),"¥700");
});

test("upstream time entry filters use the real array query fields", async t => {
  const paths = [];
  const client = await setup(t, async url => {
    paths.push(url);
    assert.equal(url.searchParams.get("project_ids[]"), member);
    assert.equal(url.searchParams.has("filter[project_ids][]"), false);
    return Response.json({data: url.pathname.endsWith("/aggregate") ? {grouped_data:[]} : []});
  });
  await client.callTool({name:"solidtime_list_time_entries",arguments:{project_ids:[member]}});
  await client.callTool({name:"solidtime_get_time_entry_report",arguments:{group_by:"month",project_ids:[member]}});
  assert.equal(paths.length,2);
});
