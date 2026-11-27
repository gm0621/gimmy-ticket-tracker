import { snapshot } from "./snapshot.js";

const workbook = "https://docs.google.com/spreadsheets/d/16L_dB4jd_NTfzB31MR9omKmNgDjbFf8MfU_GtvIJ-oo";
const source = workbook + "/edit#gid=1685660058";
const endpoint = workbook + "/gviz/tq?gid=1685660058&range=A1:L&headers=1&tqx=out:json";
const ticketBase = "https://192.168.2.86/ticket/422b495c460ae8a748b46fcbbd894ff9/#/Ticket/ticket/311/";
const ticketNumbers = new Map([
  ["RD2509036", 13384],
  ["RD2511004", 13383],
  ["RD2511005", 13382],
  ["RD2511009", 13381],
  ["RD2602033", 13368],
  ["RD2603014", 13365],
  ["RD2604003", 13363],
  ["RD2609021", 13139],
]);
const reportDeadline = "2026-11-30";
const dateFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei", dateStyle: "short" });
const timeFormat = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map(node => [node.id, node]));
const views = [...document.querySelectorAll("[data-view]")];
const shortcuts = [...document.querySelectorAll("button[data-filter]")];
const viewCards = [...document.querySelectorAll("button[data-card-view]")];
const cellDate = value => {
  const parts = String(value ?? "").match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  return parts ? [parts[1], parts[2].padStart(2, "0"), parts[3].padStart(2, "0")].join("-") : "";
};
const displayDate = date => date ? date.replaceAll("-", "/") : "—";
const shortDate = date => date.split("-").slice(1).map(Number).join("/");
const expandedTickets = new Set();
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

function ticketLink(row) {
  const link = make("a", row.id, "ticket-link");
  const ticketNumber = ticketNumbers.get(row.id);
  link.href = ticketNumber ? ticketBase + ticketNumber : source + "&range=A" + row.row + ":H" + row.row;
  link.title = ticketNumber ? "2.86 工單 #" + ticketNumber : "試算表原始列";
  link.target = "_blank";
  link.rel = "noopener";
  return link;
}

function renderRow(row, flags, today) {
  const ticket = make("td");
  ticket.append(ticketLink(row));
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
  const tr = make("tr", "", "detail-row");
  tr.id = "task-" + row.row;
  if (flags.due) tr.classList.add("due-row");
  if (flags.dec) tr.classList.add("future-row");
  tr.append(ticket, item, make("td", (row.owner || "—") + " / " + (row.member || "—"), "person"), make("td", displayDate(row.start), "date"), make("td", displayDate(row.end), "date"), progress);
  return tr;
}

function groupByTicket(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const id = entry.row.id;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(entry);
  }
  return groups;
}

function renderGroup(shown, all, today) {
  const first = shown[0].row;
  const titles = [...new Set(all.map(({ row }) => row.item))];
  const prefix = titles[0].split(" - ")[0];
  const title = titles.every(item => item.split(" - ")[0] === prefix) && titles.length > 1
    ? prefix
    : titles.join("／");
  const pending = all.flatMap(({ row }) => !row.done && row.end ? [row.end] : []).sort();
  const nextDue = pending.find(date => date >= today);
  const overdue = pending.filter(date => date < today);
  const completed = all.filter(({ row }) => row.done).length;
  const children = shown.map(({ row, flags }) => renderRow(row, flags, today));

  const ticket = make("td");
  ticket.append(ticketLink(first));
  const item = make("td");
  item.colSpan = 3;
  const toggle = make("button", "", "group-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-label", first.id + " " + title);
  toggle.setAttribute("aria-controls", children.map(row => row.id).join(" "));
  const indicator = make("span", "", "group-indicator");
  indicator.setAttribute("aria-hidden", "true");
  toggle.append(indicator, make("span", title));
  item.append(toggle);

  const due = make("td", "", "date");
  due.append(make("span", "下一個到期日", "group-label"), make("span", displayDate(nextDue)));
  if (overdue.length) {
    due.append(make("span", "逾期 " + overdue.length + " 筆", "tag late group-overdue"));
  }
  const progress = make("td");
  progress.append(
    make("span", "已完成／總數", "group-label"),
    make("strong", completed + " / " + all.length, "group-count"),
  );
  const summary = make("tr", "", "group-row");
  summary.append(ticket, item, due, progress);

  function setExpanded(expanded) {
    toggle.setAttribute("aria-expanded", String(expanded));
    for (const child of children) child.hidden = !expanded;
  }
  setExpanded(expandedTickets.has(first.id));
  toggle.addEventListener("click", () => {
    const expanded = !expandedTickets.has(first.id);
    if (expanded) expandedTickets.add(first.id);
    else expandedTickets.delete(first.id);
    setExpanded(expanded);
  });
  return [summary, ...children];
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
  viewCards.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.cardView === view && !filter)));
  const shown = entries.filter(({ row, flags }) =>
    (view === "all" || (view === "open" ? !row.done : Boolean(row.done))) &&
    (!filter || flags[filter]) &&
    (!term || [row.id, row.item, row.task, row.owner, row.member].some(value => value.toLocaleLowerCase("zh-TW").includes(term)))
  );
  shown.sort((a, b) => view === "done"
    ? b.row.done.localeCompare(a.row.done) || a.row.row - b.row.row
    : (a.row.end || "9999").localeCompare(b.row.end || "9999") || a.row.row - b.row.row);
  const allGroups = groupByTicket(entries);
  const shownGroups = groupByTicket(shown);
  const order = view === "done" ? "依篩選結果的實際結束日由新到舊" : "依篩選結果的預計結束日由近到遠";
  elements.result.textContent = shownGroups.size + " 張工單・" + shown.length + " 筆明細・" + order;
  elements.rows.replaceChildren(...[...shownGroups].flatMap(([id, group]) => renderGroup(group, allGroups.get(id), today)));
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
viewCards.forEach(button => button.addEventListener("click", () => {
  elements.search.value = "";
  selectView(button.dataset.cardView);
}));
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
