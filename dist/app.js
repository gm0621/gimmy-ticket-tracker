import { snapshot } from "./snapshot.js?v=sheet-ticket-links";

const workbook = "https://docs.google.com/spreadsheets/d/16L_dB4jd_NTfzB31MR9omKmNgDjbFf8MfU_GtvIJ-oo";
const source = workbook + "/edit#gid=1685660058";
const endpoint = workbook + "/gviz/tq?gid=1685660058&range=A1:O&headers=1&tqx=out:json";
const reportDeadline = "2026-11-30";
const dateFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei", dateStyle: "short" });
const timeFormat = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map(node => [node.id, node]));
const views = [...document.querySelectorAll("[data-view]")];
const shortcuts = [...document.querySelectorAll("button[data-filter]")];
const viewCards = [...document.querySelectorAll("button[data-card-view]")];
const filterOptions = elements.filter.querySelectorAll("option[data-filter-scope]");
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
let syncFailed = false;
let renderedDate;
let dateTimer;

document.querySelector("[data-source]").href = source;

function ticketURL(value) {
  try {
    const link = new URL(value);
    if (link.protocol === "https:" && link.host === "192.168.2.86" &&
        !link.username && !link.password && link.pathname.startsWith("/ticket/")) {
      return link.href;
    }
  } catch {
    // Missing or invalid URLs fall back to the sheet.
  }
  return "";
}

function parseFeed(payload) {
  const start = payload.indexOf("({");
  const end = payload.lastIndexOf(")");
  if (start < 0 || end < 0) throw new Error("Missing data response");
  const response = JSON.parse(payload.slice(start + 1, end));
  const expected = ["seq", "參與成員", "項目名稱", "子任務", "負責人", "預計開始時間", "預計結束時間", "實際結束時間"];
  if (response.status !== "ok" || !expected.every((name, i) => response.table?.cols?.[i]?.label === name)) {
    throw new Error("Unexpected sheet columns");
  }
  const headers = response.table.cols.map(column => column.label?.trim());
  const confirmationColumn = headers.indexOf("待確認");
  const nextStepColumn = headers.indexOf("下一步");
  const ticketColumn = headers.indexOf("2.86 工單網址");
  const sheetRows = response.table.rows.map(({ c }) => c.map(cell => String(cell?.f ?? cell?.v ?? "").trim()));
  const ticketLinks = new Map();
  for (const values of sheetRows) {
    if (!values[0] || ticketLinks.has(values[0]) || !values[ticketColumn]) continue;
    const link = ticketURL(values[ticketColumn]);
    if (link) ticketLinks.set(values[0], link);
  }
  return sheetRows.flatMap((values, index) => {
    const [id, member, item, task, owner, startDate, endDate, doneDate] = values;
    if (!id || !item || !values.slice(0, 12).some(value => /gimmy/i.test(value))) return [];
    return [{
      row: index + 2, id, member, item, task, owner,
      start: cellDate(startDate), end: cellDate(endDate), done: cellDate(doneDate),
      confirmation: values[confirmationColumn] ?? "",
      nextStep: values[nextStepColumn] ?? "",
      ticketUrl: ticketLinks.get(id) ?? "",
    }];
  });
}

function shiftDate(date, days) {
  const day = new Date(date);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

function startOfWeek(today) {
  const weekday = new Date(today).getUTCDay();
  return shiftDate(today, -((weekday + 6) % 7));
}

function highlights(row, today, weekEnd, monday) {
  return {
    due: !row.done && row.end === reportDeadline,
    dec: !row.done && row.start.startsWith("2026-12-"),
    late: !row.done && Boolean(row.end) && row.end < today,
    today: !row.done && row.end === today,
    week: !row.done && row.end > today && row.end <= weekEnd,
    "done-week": row.done >= monday && row.done <= today,
  };
}

function make(tag, value, className) {
  const node = document.createElement(tag);
  if (value) node.textContent = value;
  if (className) node.className = className;
  return node;
}

function ticketLink(row, label = row.id, className = "ticket-link") {
  const link = make("a", label, className);
  const ticketNumber = row.ticketUrl?.match(/\/(\d+)\/?$/)?.[1];
  link.href = row.ticketUrl || source + "&range=A" + row.row + ":O" + row.row;
  link.title = row.ticketUrl ? "2.86 工單" : "試算表原始列";
  if (ticketNumber) link.title += " #" + ticketNumber;
  link.target = "_blank";
  link.rel = "noopener";
  return link;
}

function renderTask(row, flags, today, groupTitle, previousItem) {
  const overview = make("div", "", "task-overview");
  overview.append(ticketLink(row, row.task || row.item, "task-title"));
  if (row.task && row.item !== groupTitle && row.item !== previousItem) {
    const prefix = groupTitle + " - ";
    const context = row.item.startsWith(prefix) ? row.item.slice(prefix.length) : row.item;
    overview.append(make("span", context, "task-context"));
  }
  const meta = make("div", "", "task-meta");
  if (row.owner) meta.append(make("span", "負責 " + row.owner));
  if (row.member && row.member !== row.owner) meta.append(make("span", "參與 " + row.member));
  if (row.start || row.end) {
    const format = date => date && date.slice(0, 4) === today.slice(0, 4) ? shortDate(date) : displayDate(date);
    const period = row.start && row.end ? format(row.start) + "–" + format(row.end)
      : row.start ? format(row.start) + " 起" : "至 " + format(row.end);
    const schedule = make("span", period);
    schedule.title = "原訂排程 " + displayDate(row.start) + " 至 " + displayDate(row.end);
    meta.append(schedule);
  }
  overview.append(meta);

  const task = make("li", "", "detail-row");
  task.append(overview);
  for (const [label, value] of [["待確認", row.confirmation], ["下一步", row.nextStep]]) {
    const field = make("div", "", "task-field");
    field.append(
      make("span", label, "task-field-label"),
      make("span", value || "未填", value ? "task-field-value" : "task-field-value unset"),
    );
    task.append(field);
  }
  const tags = make("div", "", "tags task-status");
  if (row.done) tags.append(make("span", shortDate(row.done) + " 完成", "tag done"));
  if (flags.today) tags.append(make("span", "今天到期", "tag due"));
  else if (flags.due) tags.append(make("span", "11/30 到期", "tag due"));
  if (flags.dec) tags.append(make("span", "12 月排定開始", "tag future"));
  if (flags.late) tags.append(make("span", "已逾期", "tag late"));
  if (!tags.childElementCount) {
    tags.append(make("span", row.start > today ? "尚未到預計開始日" : "未填實際結束日", "tag"));
  }
  task.append(tags);
  return task;
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
  const details = make("tr", "", "group-details");
  details.setAttribute("role", "row");
  details.id = "details-" + first.row;
  const panel = make("td", "", "detail-panel");
  panel.setAttribute("role", "cell");
  panel.colSpan = 4;
  const headings = make("div", "", "detail-head");
  headings.setAttribute("aria-hidden", "true");
  for (const text of ["子任務", "待確認", "下一步", "進度"]) {
    headings.append(make("span", text));
  }
  const tasks = make("ul", "", "detail-list");
  tasks.setAttribute("role", "list");
  tasks.append(...shown.map(({ row, flags }, index) => renderTask(row, flags, today, title, shown[index - 1]?.row.item)));
  panel.append(headings, tasks);
  details.append(panel);

  const ticket = make("td", "", "group-ticket");
  ticket.append(ticketLink(first));
  const item = make("td", "", "group-item");
  const toggle = make("button", "", "group-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-controls", details.id);
  const indicator = make("span", "", "group-indicator");
  indicator.setAttribute("aria-hidden", "true");
  const toggleText = make("span");
  const action = make("span", "", "group-action");
  toggleText.append(make("span", title), action);
  toggle.append(indicator, toggleText);
  item.append(toggle);

  const due = make("td", "", "group-date");
  due.append(make("span", "下一個到期日", "group-label"), make("span", displayDate(nextDue)));
  if (overdue.length) {
    due.append(make("span", "逾期 " + overdue.length + " 筆", "tag late group-overdue"));
  }
  const progress = make("td", "", "group-progress");
  progress.append(
    make("span", "已完成／總數", "group-label"),
    make("strong", completed + " / " + all.length, "group-count"),
  );
  const summary = make("tr", "", "group-row");
  summary.setAttribute("role", "row");
  for (const cell of [ticket, item, due, progress]) cell.setAttribute("role", "cell");
  summary.append(ticket, item, due, progress);

  function setExpanded(expanded) {
    action.textContent = expanded ? "收合明細" : "展開明細";
    toggle.setAttribute("aria-label", first.id + " " + title + " " + action.textContent);
    toggle.setAttribute("aria-expanded", String(expanded));
    details.hidden = !expanded;
  }
  setExpanded(expandedTickets.has(first.id));
  toggle.addEventListener("click", () => {
    const expanded = !expandedTickets.has(first.id);
    if (expanded) expandedTickets.add(first.id);
    else expandedTickets.delete(first.id);
    setExpanded(expanded);
  });
  return [summary, details];
}

function render() {
  const today = dateFormat.format(new Date());
  renderedDate = today;
  const weekEnd = shiftDate(today, 7);
  const monday = startOfWeek(today);
  const entries = rows.map(row => ({ row, flags: highlights(row, today, weekEnd, monday) }));
  const totals = {
    open: rows.filter(row => !row.done).length,
    due: entries.filter(({ flags }) => flags.due).length,
    dec: entries.filter(({ flags }) => flags.dec).length,
    done: rows.filter(row => row.done).length,
    late: entries.filter(({ flags }) => flags.late).length,
    today: entries.filter(({ flags }) => flags.today).length,
    week: entries.filter(({ flags }) => flags.week).length,
    "done-week": entries.filter(({ flags }) => flags["done-week"]).length,
  };
  for (const [key, count] of Object.entries(totals)) {
    const counter = elements[key + "-count"];
    if (counter) counter.textContent = count;
  }
  const term = elements.search.value.trim().toLocaleLowerCase("zh-TW");
  const filter = elements.filter.value;
  shortcuts.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.filter === filter)));
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
    td.colSpan = 4;
    tr.append(td);
    elements.rows.append(tr);
  }
}

function trackTaipeiDate() {
  const now = new Date();
  const today = dateFormat.format(now);
  if (today !== renderedDate) render();
  clearTimeout(dateTimer);
  const midnight = new Date(shiftDate(today, 1) + "T00:00:00+08:00");
  dateTimer = setTimeout(trackTaipeiDate, midnight - now);
}

async function refresh(background = false) {
  if (refreshing) return;
  refreshing = true;
  elements.refresh.disabled = true;
  if (!background) elements["sync-state"].textContent = "正在讀取試算表…";
  try {
    const response = await fetch(endpoint, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error("Sheet request failed");
    const nextRows = parseFeed(await response.text());
    const changed = JSON.stringify(rows) !== JSON.stringify(nextRows);
    if (!background || changed || syncFailed) {
      elements["sync-state"].textContent = "已同步 Google 試算表・" + timeFormat.format(new Date());
    }
    syncFailed = false;
    if (changed) {
      rows = nextRows;
      render();
    }
  } catch {
    if (!background || !syncFailed) {
      elements["sync-state"].textContent = rows === snapshot ? "同步暫時失敗，顯示 11/27 的報告版本" : "同步暫時失敗，保留上次成功讀取的資料";
    }
    syncFailed = true;
  } finally {
    refreshing = false;
    elements.refresh.disabled = false;
  }
}

function selectView(nextView, filter = "") {
  view = nextView;
  views.forEach(control => control.setAttribute("aria-pressed", String(control.dataset.view === view)));
  for (const option of filterOptions) {
    option.hidden = option.disabled = view !== "all" && option.dataset.filterScope !== view;
  }
  elements.filter.value = filter;
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
  selectView(button.dataset.filterView || "open", filter);
}));
elements.search.addEventListener("input", render);
elements.filter.addEventListener("change", render);
elements.refresh.addEventListener("click", () => refresh());
document.addEventListener("visibilitychange", () => {
  trackTaipeiDate();
  if (!document.hidden) refresh(true);
});
setInterval(() => {
  if (!document.hidden) refresh(true);
}, 60_000);
trackTaipeiDate();
refresh();
