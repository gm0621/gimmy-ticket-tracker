import { snapshot } from "./snapshot.js";

const workbook = "https://docs.google.com/spreadsheets/d/16L_dB4jd_NTfzB31MR9omKmNgDjbFf8MfU_GtvIJ-oo";
const source = workbook + "/edit#gid=1685660058";
const endpoint = workbook + "/gviz/tq?gid=1685660058&range=A1:L&headers=1&tqx=out:json";
const reportDeadline = "2026-11-30";
const dateFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei", dateStyle: "short" });
const timeFormat = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map(node => [node.id, node]));
const views = [...document.querySelectorAll("[data-view]")];
const shortcuts = [...document.querySelectorAll("button[data-filter]")];
const cellDate = value => {
  const parts = String(value ?? "").match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  return parts ? [parts[1], parts[2].padStart(2, "0"), parts[3].padStart(2, "0")].join("-") : "";
};
const displayDate = date => date ? date.replaceAll("-", "/") : "—";
const shortDate = date => date.split("-").slice(1).map(Number).join("/");
let rows = snapshot;
let view = "open";
let refreshing = false;

document.querySelector("[data-source]").href = source;

function parseFeed(payload) {
  const start = payload.indexOf("({");
  const end = payload.lastIndexOf(")");
  if (start < 0 || end < 0) throw new Error("Missing data response");
  const response = JSON.parse(payload.slice(start + 1, end));
  const expected = ["seq", "參與成員", "項目名稱", "子任務", "負責人", "預計開始時間", "預計結束時間", "實際結束時間"];
  if (response.status !== "ok" || !expected.every((name, i) => response.table?.cols?.[i]?.label === name)) {
    throw new Error("Unexpected sheet columns");
  }
  return response.table.rows.flatMap(({ c }, index) => {
    const values = c.map(cell => String(cell?.f ?? cell?.v ?? "").trim());
    const [id, member, item, task, owner, startDate, endDate, doneDate] = values;
    if (!id || !item || !values.some(value => /gimmy/i.test(value))) return [];
    return [{ row: index + 2, id, member, item, task, owner, start: cellDate(startDate), end: cellDate(endDate), done: cellDate(doneDate) }];
  });
}

function highlights(row, today) {
  return {
    due: !row.done && row.end === reportDeadline,
    dec: !row.done && row.start.startsWith("2026-12-"),
    late: !row.done && Boolean(row.end) && row.end < today,
  };
}

function make(tag, value, className) {
  const node = document.createElement(tag);
  if (value) node.textContent = value;
  if (className) node.className = className;
  return node;
}

function renderRow(row, flags, today) {
  const link = make("a", row.id, "ticket-link");
  link.href = source + "&range=A" + row.row + ":H" + row.row;
  link.target = "_blank";
  link.rel = "noopener";
  const ticket = make("td");
  ticket.append(link);
  const item = make("td");
  item.append(make("span", row.item, "item"));
  if (row.task) item.append(make("span", row.task, "subtask"));
  const tags = make("div", "", "tags");
  if (row.done) tags.append(make("span", shortDate(row.done) + " 完成", "tag done"));
  if (flags.due) tags.append(make("span", "11/30 到期", "tag due"));
  if (flags.dec) tags.append(make("span", "12 月排定開始", "tag future"));
  if (flags.late) tags.append(make("span", "已逾期", "tag late"));
  if (!tags.childElementCount) {
    tags.append(make("span", row.start > today ? "尚未到預計開始日" : "未填實際結束日", "tag"));
  }
  const progress = make("td");
  progress.append(tags);
  const tr = make("tr", "", flags.due ? "due-row" : flags.dec ? "future-row" : "");
  tr.append(ticket, item, make("td", (row.owner || "—") + " / " + (row.member || "—"), "person"), make("td", displayDate(row.start), "date"), make("td", displayDate(row.end), "date"), progress);
  return tr;
}

function render() {
  const today = dateFormat.format(new Date());
  const entries = rows.map(row => ({ row, flags: highlights(row, today) }));
  const totals = {
    open: rows.filter(row => !row.done).length,
    due: entries.filter(({ flags }) => flags.due).length,
    dec: entries.filter(({ flags }) => flags.dec).length,
    done: rows.filter(row => row.done).length,
  };
  for (const [key, count] of Object.entries(totals)) elements[key + "-count"].textContent = count;
  const term = elements.search.value.trim().toLocaleLowerCase("zh-TW");
  const filter = elements.filter.value;
  shortcuts.forEach(button => button.setAttribute("aria-pressed", String(view === "open" && button.dataset.filter === filter)));
  const shown = entries.filter(({ row, flags }) =>
    (view === "all" || (view === "open" ? !row.done : Boolean(row.done))) &&
    (!filter || flags[filter]) &&
    (!term || [row.id, row.item, row.task, row.owner, row.member].some(value => value.toLocaleLowerCase("zh-TW").includes(term)))
  );
  shown.sort((a, b) => view === "done"
    ? b.row.done.localeCompare(a.row.done) || a.row.row - b.row.row
    : (a.row.end || "9999").localeCompare(b.row.end || "9999") || a.row.row - b.row.row);
  elements["end-heading"].setAttribute("aria-sort", view === "done" ? "none" : "ascending");
  elements.result.textContent = shown.length + " 筆・" + (view === "done" ? "依實際結束日由新到舊" : "依預計結束日由近到遠");
  elements.rows.replaceChildren(...shown.map(({ row, flags }) => renderRow(row, flags, today)));
  if (!shown.length) {
    const tr = make("tr");
    const td = make("td", "沒有符合的工單。", "empty");
    td.colSpan = 6;
    tr.append(td);
    elements.rows.append(tr);
  }
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  elements.refresh.disabled = true;
  elements["sync-state"].textContent = "正在讀取試算表…";
  try {
    const response = await fetch(endpoint, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error("Sheet request failed");
    rows = parseFeed(await response.text());
    const time = timeFormat.format(new Date());
    elements["sync-state"].textContent = "已同步 Google 試算表・" + time;
    render();
  } catch {
    elements["sync-state"].textContent = rows === snapshot ? "同步暫時失敗，顯示 11/27 的報告版本" : "同步暫時失敗，保留上次成功讀取的資料";
  } finally {
    refreshing = false;
    elements.refresh.disabled = false;
  }
}

function selectView(nextView, filter = "") {
  view = nextView;
  views.forEach(control => control.setAttribute("aria-pressed", String(control.dataset.view === view)));
  elements.filter.value = filter;
  elements.filter.disabled = view === "done";
  render();
}

views.forEach(button => button.addEventListener("click", () => selectView(button.dataset.view)));
shortcuts.forEach(button => button.addEventListener("click", () => {
  const filter = button.getAttribute("aria-pressed") === "true" ? "" : button.dataset.filter;
  elements.search.value = "";
  selectView("open", filter);
}));
elements.search.addEventListener("input", render);
elements.filter.addEventListener("change", render);
elements.refresh.addEventListener("click", refresh);
render();
refresh();
