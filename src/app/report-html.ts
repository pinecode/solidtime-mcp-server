export const reportHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Labor costs</title><style>
:root {color-scheme:light dark; font:14px system-ui; color:var(--color-text-primary,#222); background:var(--color-background-primary,#fff)}
* {box-sizing:border-box} body {margin:0;padding:16px} h1 {font-size:18px;margin:0 0 14px} form,.toolbar {display:flex;flex-wrap:wrap;align-items:end;gap:10px} label {display:grid;gap:4px;font-size:12px} input,select,button {font:inherit;color:inherit;background:var(--color-background-secondary,#f4f4f5);border:1px solid var(--color-border-primary,#a1a1aa);border-radius:4px;padding:7px;min-height:34px} button {cursor:pointer} button:disabled {opacity:.5;cursor:wait} #status {min-height:20px;margin:10px 0} .summary {display:flex;flex-wrap:wrap;gap:24px;padding:12px 0;border-block:1px solid #a1a1aa} .summary small {display:block;opacity:.7} .summary strong {font-size:18px} .scroll {overflow:auto;margin-top:12px} table {border-collapse:collapse;width:100%;text-align:left} th,td {padding:10px 8px;border-bottom:1px solid #a1a1aa;vertical-align:top} th {font-size:12px} .money {font-variant-numeric:tabular-nums;white-space:nowrap} #bars {display:grid;gap:8px;margin:16px 0} .bar-row {display:grid;grid-template-columns:minmax(70px,130px) 1fr minmax(70px,auto);gap:8px;align-items:center} .bar {height:16px;background:#16a34a;max-width:100%} .bar-row:nth-child(even) .bar {background:#0284c7} #pagination {display:flex;gap:12px;align-items:center;margin-top:12px}
:root[data-theme=dark] {color:var(--color-text-primary,#eee);background:var(--color-background-primary,#18181b);color-scheme:dark}
:root[data-theme=light] {color-scheme:light}
:root[data-theme=dark] input,:root[data-theme=dark] select,:root[data-theme=dark] button {background:var(--color-background-secondary,#27272a)}
@media(max-width:480px){body{padding:10px}.bar-row{grid-template-columns:90px 1fr 90px}h1{font-size:17px}}
</style></head><body>
<h1>Labor costs</h1><form id="filters">
<label>From<input id="from" type="date"></label><label>Through<input id="to" type="date"></label>
<label>Display currency<select id="currency"><option value="">Automatic</option><option value="native">Original currencies</option><option>USD</option><option>RUB</option><option>EUR</option><option>HUF</option><option>GBP</option></select></label>
<label>Group<select id="group"><option value="user">Employee</option><option value="project">Project</option><option value="client">Client</option><option value="task">Task</option><option value="month">Month</option><option value="week">Week</option><option value="year">Year</option><option value="day">Day</option><option value="tag">Tag</option><option value="description">Description</option><option value="billable">Billable</option></select></label>
<button id="refresh" type="button" title="Refresh report" aria-label="Refresh report">↻</button>
<button id="csv" type="button" title="Download CSV">CSV ↓</button><button id="pdf" type="button" title="Download PDF">PDF ↓</button>
</form><p id="status" role="status">Waiting for report…</p>
<div class="summary"><div><small>Original expense</small><strong id="native">—</strong></div><div><small>Report expense</small><strong id="total">—</strong></div><div><small>Hours</small><strong id="hours">—</strong></div></div>
<div id="bars" aria-label="Expense chart"></div>
<div class="scroll"><table><thead><tr><th>Group</th><th>Hours</th><th>Original expense</th><th>Report expense</th><th>Status</th></tr></thead><tbody id="groups"></tbody></table></div>
<div class="scroll"><table><thead><tr><th>Date</th><th>Employee / project</th><th>Hours</th><th>Original expense</th><th>Report expense</th></tr></thead><tbody id="entries"></tbody></table></div>
<div id="pagination"><button id="previous" type="button">←</button><span id="page"></span><button id="next" type="button">→</button></div>
<script type="module">__SCRIPT__</script></body></html>`;
