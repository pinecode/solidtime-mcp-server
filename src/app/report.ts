import { App, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

type Money = { amount: string; currency: string };
type PaymentTotals = {
  known_subtotal: Money[];
  complete: boolean;
  missing_rate: number;
  missing_fx: number;
  exchange_rates: {
    source_currency: string;
    payment_currency: string;
    weighted_rate: string | null;
  }[];
};
type Totals = {
  native: Money[];
  known_subtotal: Money[];
  complete: boolean;
  seconds: number;
  missing_rate: number;
  missing_fx: number;
  payment?: PaymentTotals;
};
type Report = {
  currency: string | null;
  totals: Totals;
  groups_additive: boolean;
  groups: { label: string; totals: Totals; groups?: Report["groups"] }[];
  entries: {
    cost_date: string;
    member_name: string;
    project_name: string | null;
    seconds: number;
    native: Money | null;
    amount: Money | null;
    payment?: Money | null;
  }[];
  pagination: { page: number; per_page: number; total: number };
};
const app = new App({ name: "Solidtime expense report", version: "1.2.0" }, {});
const element = <T extends HTMLElement>(id: string) => document.getElementById(id)! as T;
const text = (id: string, value: string) => {
  element(id).textContent = value;
};
const money = (values: Money[]) =>
  values.map((value) => `${value.amount} ${value.currency}`).join("\n") || "0";
const paymentMoney = (payment?: PaymentTotals) =>
  payment
    ? payment.known_subtotal.length
      ? money(payment.known_subtotal)
      : payment.complete
        ? "0"
        : "Unknown"
    : "Unavailable";
const paymentRates = (payment?: PaymentTotals) =>
  (payment?.exchange_rates ?? [])
    .map(
      (pair) =>
        `Weighted FX: ${pair.weighted_rate?.replace(/\.?0+$/, "") ?? "Unavailable"} ${pair.payment_currency} / ${pair.source_currency}`
    )
    .join("\n");
for (const option of element<HTMLSelectElement>("group").options)
  element<HTMLSelectElement>("subgroup").add(new Option(option.text, option.value));
let query: Record<string, unknown> = {};
let current: Report | undefined;
let pending = false;
function render(result: CallToolResult) {
  if (result.isError)
    throw new Error("Report request failed. Verify extension availability and permissions.");
  const data = result.structuredContent as
    { report?: Report; query?: Record<string, unknown> } | undefined;
  if (!data?.report) throw new Error("The server returned no expense report.");
  const report = (current = data.report);
  query = data.query ?? query;
  for (const [id, key] of [
    ["from", "date_from"],
    ["to", "date_to"],
    ["group", "group"],
    ["subgroup", "sub_group"],
  ]) {
    element<HTMLInputElement | HTMLSelectElement>(id).value = String(
      query[key] ?? (id === "group" ? "user" : "")
    );
  }
  const selectedCurrency = query.native === "true" ? "native" : String(query.currency ?? "");
  const select = element<HTMLSelectElement>("currency");
  if (selectedCurrency && ![...select.options].some((option) => option.value === selectedCurrency))
    select.add(new Option(selectedCurrency, selectedCurrency));
  select.value = selectedCurrency;
  text("native", money(report.totals.native));
  text("total", money(report.totals.known_subtotal));
  text("payment", paymentMoney(report.totals.payment));
  text("payment-rate", paymentRates(report.totals.payment));
  text("hours", (report.totals.seconds / 3600).toFixed(2));
  text(
    "status",
    [
      report.totals.complete
        ? report.groups_additive
          ? ""
          : "Tag groups overlap; the total counts each entry once."
        : `Incomplete subtotal: ${report.totals.missing_rate} missing rates, ${report.totals.missing_fx} missing FX quotes.`,
      report.totals.payment && !report.totals.payment.complete
        ? `Payment incomplete: ${report.totals.payment.missing_rate} missing rates, ${report.totals.payment.missing_fx} missing FX quotes.`
        : "",
    ]
      .filter(Boolean)
      .join(" ")
  );
  function rows(id: string, values: string[][]) {
    const headings = [...element(id).closest("table")!.querySelectorAll("th")].map(
      (heading) => heading.textContent ?? ""
    );
    element(id).replaceChildren(
      ...values.map((values) => {
        const row = document.createElement("tr");
        for (const [index, value] of values.entries()) {
          const cell = document.createElement("td");
          cell.textContent = value;
          if (index > 0) cell.dataset.label = headings[index];
          row.append(cell);
        }
        return row;
      })
    );
  }
  rows(
    "groups",
    report.groups.flatMap((group) =>
      [
        group,
        ...(group.groups ?? []).map((child) => ({
          ...child,
          label: `↳ ${child.label}`,
        })),
      ].map((item) => [
        item.label,
        (item.totals.seconds / 3600).toFixed(2),
        money(item.totals.native),
        money(item.totals.known_subtotal),
        [paymentMoney(item.totals.payment), paymentRates(item.totals.payment)]
          .filter(Boolean)
          .join("\n"),
        item.totals.complete && item.totals.payment?.complete !== false ? "Complete" : "Incomplete",
      ])
    )
  );
  for (const row of element("groups").children)
    if (row.firstChild?.textContent?.startsWith("↳ ")) row.classList.add("subgroup");
  rows(
    "entries",
    report.entries.map((entry) => [
      entry.cost_date,
      `${entry.member_name} / ${entry.project_name ?? "No project"}`,
      (entry.seconds / 3600).toFixed(2),
      entry.native ? money([entry.native]) : "Missing rate",
      entry.amount ? money([entry.amount]) : "Incomplete",
      entry.payment
        ? money([entry.payment])
        : entry.payment === null
          ? "Incomplete"
          : "Unavailable",
    ])
  );
  const amounts = report.groups.map((group) => group.totals.seconds);
  const max = Math.max(...amounts, 1);
  element("bars").replaceChildren(
    ...report.groups.map((group, index) => {
      const row = document.createElement("div");
      row.className = "bar-row";
      const label = document.createElement("span");
      label.textContent = group.label;
      const track = document.createElement("div");
      const bar = document.createElement("div");
      bar.className = "bar";
      bar.style.width = `${Math.max(0, Math.min(100, (amounts[index] / max) * 100))}%`;
      track.append(bar);
      const amount = document.createElement("span");
      amount.className = "money";
      amount.textContent = `${(group.totals.seconds / 3600).toFixed(2)} h`;
      row.append(label, track, amount);
      return row;
    })
  );
  text("page", `Page ${report.pagination.page}`);
  element<HTMLButtonElement>("previous").disabled = report.pagination.page <= 1;
  element<HTMLButtonElement>("next").disabled =
    report.pagination.page * report.pagination.per_page >= report.pagination.total;
}
async function run(action: () => Promise<void>) {
  if (pending) return;
  pending = true;
  for (const id of ["refresh", "csv", "pdf", "previous", "next"])
    element<HTMLButtonElement>(id).disabled = true;
  try {
    await action();
  } catch (error) {
    text("status", error instanceof Error ? error.message : "Request failed.");
  } finally {
    pending = false;
    for (const id of ["refresh", "csv", "pdf"]) element<HTMLButtonElement>(id).disabled = false;
    element<HTMLButtonElement>("previous").disabled = !current || current.pagination.page <= 1;
    element<HTMLButtonElement>("next").disabled =
      !current || current.pagination.page * current.pagination.per_page >= current.pagination.total;
  }
}
async function refresh(page = 1) {
  const code = element<HTMLSelectElement>("currency").value;
  const filters = {
    ...query,
    date_from: element<HTMLInputElement>("from").value || undefined,
    date_to: element<HTMLInputElement>("to").value || undefined,
    group: element<HTMLSelectElement>("group").value,
    sub_group: element<HTMLSelectElement>("subgroup").value || undefined,
    currency: code && code !== "native" ? code : undefined,
    native: code === "native" ? "true" : undefined,
    page,
  };
  // Host transports may encode undefined as null; omit unset optional filters.
  query = Object.fromEntries(Object.entries(filters).filter(([, value]) => value != null));
  render(await app.callServerTool({ name: "solidtime_get_labor_cost_report", arguments: query }));
}
element("refresh").addEventListener("click", () => void run(() => refresh()));
element("filters").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  void run(() => refresh());
});
element("previous").addEventListener(
  "click",
  () => void run(() => refresh((current?.pagination.page ?? 2) - 1))
);
element("next").addEventListener(
  "click",
  () => void run(() => refresh((current?.pagination.page ?? 0) + 1))
);
for (const format of ["csv", "pdf"])
  element(format).addEventListener(
    "click",
    () =>
      void run(async () => {
        const result = await app.callServerTool({
          name: "solidtime_export_labor_costs",
          arguments: { ...query, format },
        });
        if (result.isError) throw new Error("Export failed.");
        const links = result.content.filter((content) => content.type === "resource_link");
        if (!links.length) throw new Error("No export resource returned.");
        const download = await app.downloadFile({ contents: links });
        if (download.isError) throw new Error("The host could not download this export.");
      })
  );
app.ontoolresult = (result) => {
  try {
    render(result);
  } catch (error) {
    text("status", String(error));
  }
};
app.onhostcontextchanged = (context) => {
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.theme) document.documentElement.dataset.theme = context.theme;
};
await app.connect();
const context = app.getHostContext();
if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
document.documentElement.dataset.theme =
  context?.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
