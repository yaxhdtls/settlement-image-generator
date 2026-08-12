const TRACKING_EXCLUDED_TRANSLATORS = new Set(["윤토투어", "直客"]);
const TODAY = new Date();
const MONTHLY_SHEETS_STORAGE_KEY = "settlementTrackingMonthlySheetUrls:v1";
const APPROVAL_STORAGE_KEY = "settlementTrackingApprovals:v1";
const I18N = {
  ko: {
    roleAll: "권한: 전체",
    roleStaff: "권한: 실무자",
    roleAdmin: "권한: 관리자",
    help: "사용 설명서",
    close: "닫기",
    settlementImage: "정산 이미지 생성",
    tracking: "미완료 트래킹",
    linkManage: "링크 관리",
    search: "조회",
    auditLog: "로그 기록",
    year: "조회 연도",
    month: "월 필터",
    all: "전체",
    hospitalSearch: "병원 검색",
    translatorSearch: "통역사 검색",
    practitioner: "실무자",
    admin: "관리자",
    select: "선택",
    totalPending: "전체 미완료",
    receivable: "병원 미수령",
    translatorPending: "통역사 미정산",
    invoicePending: "계산서 미발행",
    date: "날짜",
    type: "유형",
    hospital: "병원",
    translator: "통역사",
    customerInfo: "고객정보",
    elapsed: "경과",
    amount: "금액",
    approval: "확인 / 승인",
    apply: "반영",
    waiting: "대기",
    adminOnly: "관리자 처리",
    noPermission: "현재 권한에서는 이 칸을 처리할 수 없습니다.",
    helpTitle: "사용 설명서",
    helpSubtitle: "역할별로 어떤 작업을 해야 하는지 정리했습니다.",
  },
  zh: {
    roleAll: "权限：全部",
    roleStaff: "权限：实务",
    roleAdmin: "权限：管理",
    help: "使用说明",
    close: "关闭",
    settlementImage: "生成结算图片",
    tracking: "未完成追踪",
    linkManage: "链接管理",
    search: "查询",
    auditLog: "操作记录",
    year: "查询年份",
    month: "月份筛选",
    all: "全部",
    hospitalSearch: "医院搜索",
    translatorSearch: "翻译搜索",
    practitioner: "实务",
    admin: "管理",
    select: "选择",
    totalPending: "全部未完成",
    receivable: "医院未收款",
    translatorPending: "翻译未结算",
    invoicePending: "税票未开",
    date: "日期",
    type: "类型",
    hospital: "医院",
    translator: "翻译",
    customerInfo: "客户信息",
    elapsed: "经过",
    amount: "金额",
    approval: "确认 / 审批",
    apply: "反映",
    waiting: "等待",
    adminOnly: "管理处理",
    noPermission: "当前权限不能处理此项目。",
    helpTitle: "使用说明",
    helpSubtitle: "按角色整理了需要处理的事项。",
  },
};
const TRACKING_FALLBACK_COLUMNS = {
  date: 0,
  hospital: 1,
  procedureAmount: 2,
  supplyAmount: 3,
  receivableAmount: 14,
  translator: 6,
  customerInfo: 7,
  settlementAmount: 11,
  paymentReceived: 13,
  invoiceStatus: 14,
  reportAmount: 15,
  translatorSettled: 16,
};

const trackingEls = {
  sheetUrl: document.querySelector("#trackingSheetUrl"),
  year: document.querySelector("#trackingYear"),
  month: document.querySelector("#trackingMonth"),
  hospitalSearch: document.querySelector("#hospitalSearch"),
  translatorSearch: document.querySelector("#translatorSearch"),
  practitionerName: document.querySelector("#practitionerName"),
  adminName: document.querySelector("#adminName"),
  loadBtn: document.querySelector("#trackingLoadBtn"),
  monthlySummary: document.querySelector("#monthlySheetSummary"),
  toggleMonthlySheetsBtn: document.querySelector("#toggleMonthlySheetsBtn"),
  monthlySheetsPanel: document.querySelector(".monthly-sheets-panel"),
  monthlySheetsBody: document.querySelector("#monthlySheetsBody"),
  monthlyUrlInputs: [...document.querySelectorAll("[data-month-url]")],
  saveMonthlySheetsBtn: document.querySelector("#saveMonthlySheetsBtn"),
  clearMonthlySheetsBtn: document.querySelector("#clearMonthlySheetsBtn"),
  status: document.querySelector("#trackingStatus"),
  allIssueCount: document.querySelector("#allIssueCount"),
  allIssueAmount: document.querySelector("#allIssueAmount"),
  receivableCount: document.querySelector("#receivableCount"),
  receivableAmount: document.querySelector("#receivableAmount"),
  translatorPendingCount: document.querySelector("#translatorPendingCount"),
  translatorPendingAmount: document.querySelector("#translatorPendingAmount"),
  invoiceCount: document.querySelector("#invoiceCount"),
  invoiceAmount: document.querySelector("#invoiceAmount"),
  tabs: [...document.querySelectorAll("[data-tracking-tab]")],
  list: document.querySelector("#trackingList"),
  template: document.querySelector("#trackingRowTemplate"),
  auditLogBtn: document.querySelector("#auditLogBtn"),
  closeAuditLogBtn: document.querySelector("#closeAuditLogBtn"),
  auditLogPanel: document.querySelector("#auditLogPanel"),
  auditLogList: document.querySelector("#auditLogList"),
  roleIndicator: document.querySelector("#roleIndicator"),
  langButtons: [...document.querySelectorAll("[data-lang]")],
  helpGuideBtn: document.querySelector("#helpGuideBtn"),
  closeHelpGuideBtn: document.querySelector("#closeHelpGuideBtn"),
  helpGuidePanel: document.querySelector("#helpGuidePanel"),
  helpGuideContent: document.querySelector("#helpGuideContent"),
};

let trackingRows = [];
let dismissedKeys = new Set();
let activeTab = "all";
let approvalState = readApprovalState();
let currentRole = readRole();
let currentLang = readLanguage();
let sharedMonthlySheetUrls = {};
let monthlyLinksSynced = false;

loadMonthlySheetInputs();
updateMonthlySheetSummary();
applyRoleShell();
applyLanguage();
syncMonthlySheetLinksFromServer();

trackingEls.loadBtn.addEventListener("click", loadTrackingBoard);
[trackingEls.month, trackingEls.hospitalSearch, trackingEls.translatorSearch].forEach((input) => {
  input.addEventListener("input", renderTracking);
});
trackingEls.year.addEventListener("change", () => {
  sharedMonthlySheetUrls = {};
  monthlyLinksSynced = false;
  loadMonthlySheetInputs();
  updateMonthlySheetSummary();
  trackingRows = [];
  renderTracking();
  syncMonthlySheetLinksFromServer();
});
trackingEls.toggleMonthlySheetsBtn.addEventListener("click", toggleMonthlySheets);
trackingEls.saveMonthlySheetsBtn.addEventListener("click", saveMonthlySheetInputsShared);
trackingEls.clearMonthlySheetsBtn.addEventListener("click", clearMonthlySheetInputs);
trackingEls.auditLogBtn.addEventListener("click", loadAuditLog);
trackingEls.closeAuditLogBtn.addEventListener("click", () => {
  trackingEls.auditLogPanel.hidden = true;
});
trackingEls.langButtons.forEach((button) => {
  button.addEventListener("click", () => {
    currentLang = button.dataset.lang === "zh" ? "zh" : "ko";
    localStorage.setItem("settlementTrackingLanguage:v1", currentLang);
    applyLanguage();
    renderTracking();
  });
});
trackingEls.helpGuideBtn.addEventListener("click", () => {
  renderRoleHelpGuide();
  trackingEls.helpGuidePanel.hidden = false;
});
trackingEls.closeHelpGuideBtn.addEventListener("click", () => {
  trackingEls.helpGuidePanel.hidden = true;
});
trackingEls.helpGuidePanel.addEventListener("click", (event) => {
  if (event.target === trackingEls.helpGuidePanel) trackingEls.helpGuidePanel.hidden = true;
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !trackingEls.helpGuidePanel.hidden) {
    trackingEls.helpGuidePanel.hidden = true;
  }
});
trackingEls.tabs.forEach((button) => {
  button.addEventListener("click", () => {
    activeTab = button.dataset.trackingTab;
    trackingEls.tabs.forEach((item) => item.classList.toggle("active", item === button));
    renderTracking();
  });
});

function readRole() {
  const role = new URLSearchParams(location.search).get("role");
  return ["staff", "admin", "all"].includes(role) ? role : "staff";
}

function readLanguage() {
  const urlLang = new URLSearchParams(location.search).get("lang");
  if (urlLang === "zh" || urlLang === "ko") return urlLang;
  return localStorage.getItem("settlementTrackingLanguage:v1") === "zh" ? "zh" : "ko";
}

function t(key) {
  return I18N[currentLang]?.[key] || I18N.ko[key] || key;
}

function applyRoleShell() {
  document.body.dataset.role = currentRole;
  if (trackingEls.roleIndicator) {
    trackingEls.roleIndicator.textContent = t(currentRole === "staff" ? "roleStaff" : currentRole === "admin" ? "roleAdmin" : "roleAll");
  }
  if (trackingEls.practitionerName) trackingEls.practitionerName.disabled = currentRole === "admin";
  if (trackingEls.adminName) trackingEls.adminName.disabled = currentRole === "staff";
  if (trackingEls.toggleMonthlySheetsBtn) trackingEls.toggleMonthlySheetsBtn.hidden = currentRole === "staff";
  if (trackingEls.monthlySheetsBody && currentRole === "staff") trackingEls.monthlySheetsBody.hidden = true;
  if (trackingEls.monthlySheetsPanel && currentRole === "staff") trackingEls.monthlySheetsPanel.classList.add("is-collapsed");
  applyNavigationLinks();
}

function applyNavigationLinks() {
  const roleQuery = `role=${encodeURIComponent(currentRole)}&lang=${encodeURIComponent(currentLang)}`;
  const tabLinks = [...document.querySelectorAll(".admin-tabs a")];
  const imageLink = tabLinks.find((link) => new URL(link.href, location.origin).pathname === "/");
  const trackingLink = tabLinks.find((link) => new URL(link.href, location.origin).pathname === "/tracking");
  if (imageLink) imageLink.href = `/?${roleQuery}`;
  if (trackingLink) trackingLink.href = `/tracking?${roleQuery}`;
}

function applyLanguage() {
  document.documentElement.lang = currentLang === "zh" ? "zh-CN" : "ko";
  trackingEls.langButtons.forEach((button) => button.classList.toggle("active", button.dataset.lang === currentLang));
  applyRoleShell();

  setText("#helpGuideBtn", t("help"));
  setText(".topbar-kicker", currentLang === "zh" ? "\u7ED3\u7B97\u7BA1\u7406" : "\uC815\uC0B0 \uAD00\uB9AC");
  setText(".admin-topbar strong", t("tracking"));
  setText("#closeHelpGuideBtn", t("close"));
  setText("#toggleMonthlySheetsBtn", t("linkManage"));
  setText("#trackingLoadBtn", t("search"));
  setText("#auditLogBtn", t("auditLog"));
  setText(".admin-tabs a[href='/']", t("settlementImage"));
  setText(".admin-tabs a[href='/tracking']", t("tracking"));
  setLabel("trackingYear", t("year"));
  setLabel("trackingMonth", t("month"));
  setLabel("hospitalSearch", t("hospitalSearch"));
  setLabel("translatorSearch", t("translatorSearch"));
  setLabel("practitionerName", t("practitioner"));
  setLabel("adminName", t("admin"));
  setSelectPlaceholder(trackingEls.practitionerName, t("select"));
  setSelectPlaceholder(trackingEls.adminName, t("select"));
  setSelectPlaceholder(trackingEls.month, t("all"));
  setText("[data-guide-title]", t("helpTitle"));
  setText("[data-guide-subtitle]", t("helpSubtitle"));
  setText("[data-guide-close]", t("close"));

  setSummaryLabel("allIssueCount", t("totalPending"));
  setSummaryLabel("receivableCount", t("receivable"));
  setSummaryLabel("translatorPendingCount", t("translatorPending"));
  setSummaryLabel("invoiceCount", t("invoicePending"));
  setTabLabel("all", t("all"));
  setTabLabel("receivable", t("receivable"));
  setTabLabel("translator", t("translatorPending"));
  setTabLabel("invoice", t("invoicePending"));
  setTableHeaders(".tracking-table", [t("date"), t("type"), t("hospital"), t("translator"), t("customerInfo"), t("elapsed"), t("amount"), t("approval")]);
  renderRoleHelpGuide();
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function setLabel(controlId, value) {
  const label = document.querySelector(`label[for="${controlId}"]`);
  if (label) label.textContent = value;
}

function setSummaryLabel(id, value) {
  const label = document.querySelector(`#${id}`)?.parentElement?.querySelector("span");
  if (label) label.textContent = value;
}

function setTabLabel(tab, value) {
  const button = document.querySelector(`[data-tracking-tab="${tab}"]`);
  if (button) button.textContent = value;
}

function setTableHeaders(tableSelector, labels) {
  document.querySelectorAll(`${tableSelector} thead th`).forEach((cell, index) => {
    if (labels[index]) cell.textContent = labels[index];
  });
}

function setSelectPlaceholder(select, value) {
  const firstOption = select?.querySelector("option[value='']");
  if (firstOption) firstOption.textContent = value;
}

function renderHelpGuide() {
  renderRoleHelpGuide();
}

function legacyHelpGuideMarkup() {
  const staffUrl = "";
  const adminUrl = "";
  const allUrl = "";

  trackingEls.helpGuideContent.innerHTML = currentLang === "zh" ? `
    <div class="guide-grid">
      <article>
        <h3>实务人员</h3>
        <ol>
          <li>选择月份后点击“查询”。</li>
          <li>确认医院未收款或翻译未结算项目。</li>
          <li>只勾选“实务”栏。管理栏无法操作。</li>
          <li>实务和管理都勾选后，系统会反映到 Google Sheet。</li>
        </ol>
      </article>
      <article>
        <h3>管理人员</h3>
        <ol>
          <li>确认实务人员已勾选的项目。</li>
          <li>只勾选“管理”栏。</li>
          <li>税票/现金项目由管理人员选择“完成”或“不需要”后反映。</li>
          <li>需要确认历史时点击“操作记录”。</li>
        </ol>
      </article>
      <article>
        <h3>访问链接</h3>
        <p><strong>实务：</strong> ${escapeHtml(staffUrl)}</p>
        <p><strong>管理：</strong> ${escapeHtml(adminUrl)}</p>
        <p><strong>测试全部：</strong> ${escapeHtml(allUrl)}</p>
      </article>
    </div>
  ` : `
    <div class="guide-grid">
      <article>
        <h3>실무자</h3>
        <ol>
          <li>월을 선택한 뒤 “조회”를 누릅니다.</li>
          <li>병원 미수령 또는 통역사 미정산 항목을 확인합니다.</li>
          <li>실무자 칸만 체크합니다. 관리자 칸은 조작할 수 없습니다.</li>
          <li>실무자와 관리자 체크가 모두 완료되면 Google Sheet에 반영됩니다.</li>
        </ol>
      </article>
      <article>
        <h3>관리자</h3>
        <ol>
          <li>실무자가 확인한 항목을 검토합니다.</li>
          <li>관리자 칸만 체크합니다.</li>
          <li>계산서/현금 항목은 관리자가 “완료” 또는 “불필요”를 선택해 반영합니다.</li>
          <li>나중에 확인이 필요하면 “로그 기록”을 확인합니다.</li>
        </ol>
      </article>
      <article>
        <h3>접속 링크</h3>
        <p><strong>실무자:</strong> ${escapeHtml(staffUrl)}</p>
        <p><strong>관리자:</strong> ${escapeHtml(adminUrl)}</p>
        <p><strong>전체 테스트:</strong> ${escapeHtml(allUrl)}</p>
      </article>
    </div>
  `;
}

function renderRoleHelpGuide() {
  if (!trackingEls.helpGuideContent) return;
  const role = currentRole === "admin" ? "admin" : currentRole === "staff" ? "staff" : "all";
  trackingEls.helpGuideContent.innerHTML = currentLang === "zh" ? helpGuideZh(role) : helpGuideKo(role);
}

function helpGuideKo(role) {
  const staff = `
    <article>
      <h3>실무자 작업</h3>
      <ol>
        <li>월 필터를 선택하고 조회 버튼을 누릅니다.</li>
        <li>병원 미수령, 통역사 미정산 항목의 내용을 실제 업무 기준으로 확인합니다.</li>
        <li>확인이 끝난 항목은 실무자 칸만 체크합니다.</li>
        <li>관리자 칸과 계산서 처리는 관리자 검토용입니다.</li>
      </ol>
    </article>`;
  const admin = `
    <article>
      <h3>관리자 작업</h3>
      <ol>
        <li>실무자가 확인한 항목을 검토합니다.</li>
        <li>문제가 없으면 관리자 칸을 체크합니다.</li>
        <li>실무자와 관리자 체크가 모두 완료되면 Google Sheet에 자동 반영됩니다.</li>
        <li>계산서/현금 항목은 완료 또는 불필요를 선택한 뒤 반영합니다.</li>
      </ol>
    </article>`;
  const common = `
    <article>
      <h3>공통 확인</h3>
      <ol>
        <li>처리 후 항목이 화면에서 사라지는지 확인합니다.</li>
        <li>필요하면 로그 기록에서 처리자, 처리 시간, 반영 위치를 확인합니다.</li>
        <li>시트 값이 이상하면 반복 처리하지 말고 관리자에게 먼저 확인합니다.</li>
      </ol>
    </article>`;
  return `<div class="guide-grid">${role === "staff" ? staff + common : role === "admin" ? admin + common : staff + admin + common}</div>`;
}

function helpGuideZh(role) {
  const staff = `
    <article>
      <h3>实务操作</h3>
      <ol>
        <li>选择月份筛选后点击查询。</li>
        <li>确认医院未收款、翻译未结算项目是否符合实际情况。</li>
        <li>确认完成后，只勾选实务栏。</li>
        <li>管理栏和税票处理由管理员操作。</li>
      </ol>
    </article>`;
  const admin = `
    <article>
      <h3>管理操作</h3>
      <ol>
        <li>审核已由实务人员确认的项目。</li>
        <li>确认无误后，勾选管理栏。</li>
        <li>实务和管理都完成后，系统会自动反映到 Google Sheet。</li>
        <li>税票/现金项目由管理员选择完成或不需要后反映。</li>
      </ol>
    </article>`;
  const common = `
    <article>
      <h3>共同确认</h3>
      <ol>
        <li>处理后确认该项目是否从画面中消失。</li>
        <li>需要追踪时，在操作记录中确认处理人、时间和反映位置。</li>
        <li>如果表格数据异常，不要反复处理，先向管理员确认。</li>
      </ol>
    </article>`;
  return `<div class="guide-grid">${role === "staff" ? staff + common : role === "admin" ? admin + common : staff + admin + common}</div>`;
}

async function loadTrackingBoard() {
  setTrackingStatus("시트를 읽고 미완료 업무들을 만드는 중입니다.");
  trackingEls.loadBtn.disabled = true;
  dismissedKeys = new Set();

  try {
    const sources = getTrackingSources();
    const allRows = [];

    for (const source of sources) {
      const response = await fetchTrackingCsv(toCsvExportUrl(source.url));
      if (!response.ok) throw new Error(`${source.label}: ${await readTrackingCsvError(response)}`);
      allRows.push(...extractRows(parseCsv(await response.text()), source));
    }

    trackingRows = allRows.filter((row) => row.date.getFullYear() === selectedYear()).sort(compareByDateAndSheetOrder);
    renderTracking();
    setTrackingStatus(`${selectedYear()}년 ${sourceSummary(sources)} 미완료 항목을 날짜순으로 표시 중입니다.`);
  } catch (error) {
    console.error(error);
    setTrackingStatus(error.message || "트래킹 데이터를 불러오지 못했습니다.", true);
  } finally {
    trackingEls.loadBtn.disabled = false;
  }
}

function extractRows(rows, source = {}) {
  const result = [];
  let activeDate = null;
  const headerIndex = findTrackingHeaderIndex(rows);
  const columns = detectTrackingColumns(rows[headerIndex] || []);
  adjustTrackingColumns(rows, headerIndex, columns);

  for (const [offset, row] of rows.slice(headerIndex + 1).entries()) {
    const sourceIndex = headerIndex + 1 + offset;
    const parsedDate = parseSheetDate(clean(row[columns.date]), source.month);
    if (parsedDate) activeDate = parsedDate;
    if (!activeDate) continue;

    const hospital = clean(row[columns.hospital]);
    const procedureAmount = toNumber(row[columns.procedureAmount]);
    if (!hospital || !procedureAmount) continue;

    const supplyAmount = toNumber(row[columns.supplyAmount]);
    const translator = clean(row[columns.translator]);
    const customerInfo = cleanCustomerInfo(row[columns.customerInfo], translator);
    const settlementAmount = toNumber(row[columns.settlementAmount]);
    const receivableAmount = toNumber(row[columns.receivableAmount]);
    const paymentReceived = isChecked(row[columns.paymentReceived]);
    const invoiceStatus = clean(row[columns.invoiceStatus]);
    const reportAmount = toNumber(row[columns.reportAmount]);
    const translatorSettled = isChecked(row[columns.translatorSettled]);
    const paymentKind = classifyPaymentKind(procedureAmount, supplyAmount);
    const isCash = paymentKind === "cash";

    result.push({
      sourceIndex,
      sheetRowNumber: sourceIndex + 1,
      sourceMonth: source.month || "",
      sourceLabel: source.label || "",
      spreadsheetId: source.spreadsheetId || "",
      gid: source.gid || "",
      baseKey: `${toInputDate(activeDate)}|${sourceIndex}|${hospital}|${translator}|${procedureAmount}`,
      date: activeDate,
      dateLabel: formatShortDate(activeDate),
      hospital,
      procedureAmount,
      supplyAmount,
      translator,
      customerInfo,
      settlementAmount,
      receivableAmount,
      paymentReceived,
      invoiceStatus,
      reportAmount,
      translatorSettled,
      paymentKind,
      isCash,
      targetColumns: {
        receivable: columnLetter(columns.paymentReceived),
        invoice: columnLetter(columns.invoiceStatus),
        translator: columnLetter(columns.translatorSettled),
      },
    });
  }

  return result.sort(compareByDateAndSheetOrder);
}

function legacyFindTrackingHeaderIndex(rows) {
  const index = rows.findIndex((row) => {
    const joined = row.map((cell) => clean(cell).replace(/\s+/g, "")).join("|");
    return (joined.includes("일자") || joined.includes("日期")) && (joined.includes("병원") || joined.includes("医院"));
  });
  return index >= 0 ? index : 0;
}

function legacyDetectTrackingColumns(header) {
  const find = (fallback, ...keywords) => {
    const index = header.findIndex((cell) => {
      const text = clean(cell).replace(/\s+/g, "");
      return keywords.some((keyword) => text.includes(keyword));
    });
    return index >= 0 ? index : fallback;
  };

  return {
    date: find(0, "일자", "日期"),
    hospital: find(1, "병원", "医院"),
    procedureAmount: find(2, "시술금액", "结账金额"),
    supplyAmount: find(3, "공급가액", "不含税"),
    receivableAmount: find(5, "부가세제외", "중개수수료", "不含税"),
    translator: find(6, "통역사", "翻译"),
    customerInfo: find(7, "고객정보", "客户"),
    settlementAmount: find(11, "정산금액", "结算金额"),
    paymentReceived: find(13, "금액수령", "收款"),
    invoiceStatus: find(14, "세금계산서", "税单"),
    reportAmount: find(15, "신고금액", "申报金额"),
    translatorSettled: find(16, "정산완료", "结算完毕"),
  };
}

function legacyAdjustTrackingColumns(rows, headerIndex, columns) {
  columns.paymentReceived = preferCheckboxColumnBeforeAmount(rows, headerIndex, columns.paymentReceived);
}

function preferCheckboxColumnBeforeAmount(rows, headerIndex, amountColumn) {
  const checkboxColumn = amountColumn - 1;
  if (checkboxColumn < 0) return amountColumn;
  return isCheckboxLikeColumn(rows, headerIndex, checkboxColumn) && isAmountLikeColumn(rows, headerIndex, amountColumn)
    ? checkboxColumn
    : amountColumn;
}

function isCheckboxLikeColumn(rows, headerIndex, columnIndex) {
  let checked = 0;
  let meaningful = 0;
  for (const row of rows.slice(headerIndex + 1, headerIndex + 80)) {
    const value = clean(row[columnIndex]).toLowerCase();
    if (!value) continue;
    meaningful += 1;
    if (["true", "false", "o", "x", "완료", "yes", "no", "y", "n", "1", "0"].includes(value)) checked += 1;
  }
  return meaningful > 0 && checked / meaningful >= 0.8;
}

function isAmountLikeColumn(rows, headerIndex, columnIndex) {
  let numeric = 0;
  let meaningful = 0;
  for (const row of rows.slice(headerIndex + 1, headerIndex + 80)) {
    const value = clean(row[columnIndex]);
    if (!value) continue;
    meaningful += 1;
    if (toNumber(value) > 0) numeric += 1;
  }
  return meaningful > 0 && numeric / meaningful >= 0.5;
}

function normalizeHeaderText(value) {
  return clean(value).replace(/\s+/g, "").toLowerCase();
}

function findTrackingHeaderIndex(rows) {
  const index = rows.findIndex((row) => {
    const joined = normalizeHeaderText(row.join("|"));
    const hasDate = joined.includes("\uC77C\uC790") || joined.includes("\uB0A0\uC9DC") || joined.includes("\u65E5\u671F");
    const hasHospital = joined.includes("\uBCD1\uC6D0") || joined.includes("\u533B\u9662");
    return hasDate && hasHospital;
  });
  return index >= 0 ? index : 0;
}

function findHeaderColumn(header, fallback, keywords) {
  const normalizedKeywords = keywords.map(normalizeHeaderText);
  const index = header.findIndex((cell) => {
    const text = normalizeHeaderText(cell);
    return normalizedKeywords.some((keyword) => keyword && text.includes(keyword));
  });
  return index >= 0 ? index : fallback;
}

function resolveCheckboxColumn(rows, headerIndex, detectedColumn, fallbackColumn) {
  if (isCheckboxLikeColumn(rows, headerIndex, detectedColumn)) return detectedColumn;
  if (isCheckboxLikeColumn(rows, headerIndex, detectedColumn - 1)) return detectedColumn - 1;
  if (isCheckboxLikeColumn(rows, headerIndex, detectedColumn + 1)) return detectedColumn + 1;
  if (isCheckboxLikeColumn(rows, headerIndex, fallbackColumn)) return fallbackColumn;
  return detectedColumn;
}

function resolveReceivableAmountColumn(rows, headerIndex, columns, paymentAmountColumn) {
  const candidates = [
    paymentAmountColumn,
    columns.reportAmount,
    columns.receivableAmount,
    columns.settlementAmount,
  ].filter((column, index, list) => Number.isInteger(column) && column >= 0 && list.indexOf(column) === index);

  return candidates.find((column) => column !== columns.paymentReceived && isAmountLikeColumn(rows, headerIndex, column))
    ?? columns.reportAmount
    ?? columns.receivableAmount;
}

function detectTrackingColumns(header) {
  const find = (fallback, ...keywords) => findHeaderColumn(header, fallback, keywords);
  const paymentReceivedAmount = find(-1, "\uAE08\uC561\uC218\uB839", "\u6536\u6B3E");
  const reportAmount = find(TRACKING_FALLBACK_COLUMNS.reportAmount, "\uC2E0\uACE0\uAE08\uC561", "\u7533\u62A5\u91D1\u989D");

  return {
    date: find(TRACKING_FALLBACK_COLUMNS.date, "\uC77C\uC790", "\u65E5\u671F"),
    hospital: find(TRACKING_FALLBACK_COLUMNS.hospital, "\uBCD1\uC6D0", "\u533B\u9662"),
    procedureAmount: find(TRACKING_FALLBACK_COLUMNS.procedureAmount, "\uC2DC\uC220\uAE08\uC561", "\u7ED3\u8D26\u91D1\u989D"),
    supplyAmount: find(TRACKING_FALLBACK_COLUMNS.supplyAmount, "\uACF5\uAE09\uAC00\uC561", "\u4E0D\u542B\u7A0E"),
    receivableAmount: paymentReceivedAmount >= 0 ? paymentReceivedAmount : reportAmount,
    translator: find(TRACKING_FALLBACK_COLUMNS.translator, "\uD1B5\uC5ED\uC0AC", "\u7FFB\u8BD1"),
    customerInfo: find(TRACKING_FALLBACK_COLUMNS.customerInfo, "\uACE0\uAC1D\uC815\uBCF4", "\u5BA2\u6237"),
    settlementAmount: find(TRACKING_FALLBACK_COLUMNS.settlementAmount, "\uC815\uC0B0\uAE08\uC561", "\u7ED3\u7B97\u91D1\u989D"),
    paymentReceived: paymentReceivedAmount >= 0 ? paymentReceivedAmount : TRACKING_FALLBACK_COLUMNS.paymentReceived,
    invoiceStatus: find(TRACKING_FALLBACK_COLUMNS.invoiceStatus, "\uC138\uAE08\uACC4\uC0B0\uC11C", "\u7A0E\u5355"),
    reportAmount,
    translatorSettled: find(TRACKING_FALLBACK_COLUMNS.translatorSettled, "\uC815\uC0B0\uC644\uB8CC", "\u7ED3\u7B97\u5B8C\u6BD5"),
  };
}

function adjustTrackingColumns(rows, headerIndex, columns) {
  const paymentAmountColumn = columns.paymentReceived;
  columns.paymentReceived = isAmountLikeColumn(rows, headerIndex, paymentAmountColumn) && paymentAmountColumn > 0
    ? paymentAmountColumn - 1
    : resolveCheckboxColumn(rows, headerIndex, paymentAmountColumn, TRACKING_FALLBACK_COLUMNS.paymentReceived);
  columns.receivableAmount = resolveReceivableAmountColumn(rows, headerIndex, columns, paymentAmountColumn);
  columns.translatorSettled = resolveCheckboxColumn(rows, headerIndex, columns.translatorSettled, TRACKING_FALLBACK_COLUMNS.translatorSettled);
}

function columnLetter(index) {
  let number = index + 1;
  let letters = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    number = Math.floor((number - 1) / 26);
  }
  return letters;
}

function getTrackingSources() {
  const selectedMonthValue = trackingEls.month.value;
  const configured = currentMonthlySheetUrls();
  const months = selectedMonthValue ? [selectedMonthValue] : Object.keys(configured).sort();
  const sources = months
    .map((month) => toTrackingSource(month, clean(configured[month])))
    .filter((source) => source.url);

  if (sources.length) return sources;

  const hasAnyMonthlyUrl = Object.values(configured).some((url) => clean(url));
  if (hasAnyMonthlyUrl && selectedMonthValue) {
    throw new Error(`${Number(selectedMonthValue)}월 시트 링크가 저장되어 있지 않습니다.`);
  }

  const legacyUrl = clean(trackingEls.sheetUrl.value);
  if (legacyUrl) return [toTrackingSource(selectedMonthValue || "", legacyUrl, "기본 시트")];

  throw new Error("먼저 월별 시트 링크를 저장하세요.");
}

function toTrackingSource(month, url, fallbackLabel = "") {
  const sheetRef = parseSheetRef(url);
  return {
    month,
    url,
    label: fallbackLabel || `${Number(month)}월`,
    spreadsheetId: sheetRef.spreadsheetId,
    gid: sheetRef.gid,
  };
}

function sourceSummary(sources) {
  if (sources.length === 1) return sources[0].label;
  return `${sources.length}개 월`;
}

function toggleMonthlySheets() {
  const isOpening = trackingEls.monthlySheetsBody.hidden;
  trackingEls.monthlySheetsBody.hidden = !isOpening;
  trackingEls.monthlySheetsPanel.classList.toggle("is-collapsed", !isOpening);
  trackingEls.toggleMonthlySheetsBtn.setAttribute("aria-expanded", String(isOpening));
  trackingEls.toggleMonthlySheetsBtn.textContent = isOpening ? "닫기" : "링크 관리";
}

function loadMonthlySheetInputs() {
  const urls = currentMonthlySheetUrls();
  trackingEls.monthlyUrlInputs.forEach((input) => {
    input.value = urls[input.dataset.monthUrl] || "";
  });
}

function saveMonthlySheetInputs() {
  const store = readMonthlySheetStore();
  const year = String(selectedYear());
  store[year] = {};
  trackingEls.monthlyUrlInputs.forEach((input) => {
    const url = clean(input.value);
    if (url) store[year][input.dataset.monthUrl] = url;
  });
  localStorage.setItem(MONTHLY_SHEETS_STORAGE_KEY, JSON.stringify(store));
  updateMonthlySheetSummary();
  setTrackingStatus(`${year}년 월별 시트 링크를 저장했습니다.`);
  loadTrackingBoard();
}

function clearMonthlySheetInputs() {
  trackingEls.monthlyUrlInputs.forEach((input) => {
    input.value = "";
  });
  saveMonthlySheetInputsShared();
}

function currentMonthlySheetUrls() {
  const localUrls = readMonthlySheetStore()[String(selectedYear())] || {};
  return monthlyLinksSynced ? sharedMonthlySheetUrls : localUrls;
}

function readMonthlySheetStore() {
  try {
    return JSON.parse(localStorage.getItem(MONTHLY_SHEETS_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function updateMonthlySheetSummary() {
  const urls = currentMonthlySheetUrls();
  const months = Object.keys(urls).filter((month) => clean(urls[month])).sort();
  trackingEls.monthlySummary.textContent = months.length
    ? `${selectedYear()}년 ${months.map((month) => `${Number(month)}월`).join(", ")} 링크 저장됨`
    : `${selectedYear()}년 저장된 월별 링크가 없습니다.`;
}

function collectMonthlySheetInputs() {
  const links = {};
  trackingEls.monthlyUrlInputs.forEach((input) => {
    const url = clean(input.value);
    if (url) links[input.dataset.monthUrl] = url;
  });
  return links;
}

function currentMonthlySheetUrlsShared() {
  const localUrls = readMonthlySheetStore()[String(selectedYear())] || {};
  return monthlyLinksSynced ? sharedMonthlySheetUrls : localUrls;
}

async function saveMonthlySheetInputsShared() {
  const store = readMonthlySheetStore();
  const year = String(selectedYear());
  store[year] = collectMonthlySheetInputs();
  localStorage.setItem(MONTHLY_SHEETS_STORAGE_KEY, JSON.stringify(store));
  sharedMonthlySheetUrls = store[year];
  updateMonthlySheetSummary();
  try {
    const response = await fetch("/tracking/monthly-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, links: store[year] }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Failed to save monthly sheet links");
    sharedMonthlySheetUrls = result.links || store[year];
    monthlyLinksSynced = true;
    store[year] = sharedMonthlySheetUrls;
    localStorage.setItem(MONTHLY_SHEETS_STORAGE_KEY, JSON.stringify(store));
    loadMonthlySheetInputs();
    updateMonthlySheetSummary();
    setTrackingStatus(`${year}년 월별 시트 링크를 저장했습니다.`);
    loadTrackingBoard();
  } catch (error) {
    setTrackingStatus("월별 링크를 이 브라우저에만 저장했습니다. 서버 공유 저장에는 실패했습니다.", true);
  }
}

async function syncMonthlySheetLinksFromServer() {
  const year = String(selectedYear());
  try {
    const response = await fetch(`/tracking/monthly-links?year=${encodeURIComponent(year)}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Failed to load monthly sheet links");
    sharedMonthlySheetUrls = result.links || {};
    monthlyLinksSynced = true;
    const store = readMonthlySheetStore();
    store[year] = sharedMonthlySheetUrls;
    localStorage.setItem(MONTHLY_SHEETS_STORAGE_KEY, JSON.stringify(store));
    loadMonthlySheetInputs();
    updateMonthlySheetSummary();
  } catch (error) {
    console.warn(error);
  }
}

function renderTracking() {
  const issueGroups = buildIssueGroups();
  updateSummaryDisplay(issueGroups);
  renderActiveList(issueGroups[activeTab]);
}

function buildIssueGroups() {
  const filteredRows = trackingRows.filter(matchesFilters);
  const issues = [];

  for (const row of filteredRows) {
    if (!row.paymentReceived && row.receivableAmount > 0) {
      issues.push(toIssue(row, "receivable", "병원 미수령", "받을 금액", row.receivableAmount));
    }
    if (isTranslatorSettlementTarget(row) && !row.translatorSettled && row.settlementAmount > 0) {
      issues.push(toIssue(row, "translator", "통역사 미정산", "정산 금액", row.settlementAmount));
    }
    const invoiceIssue = invoiceIssueForRow(row);
    if (invoiceIssue) {
      issues.push(invoiceIssue);
    }
  }

  const visibleIssues = issues
    .filter((issue) => !dismissedKeys.has(issue.key))
    .sort((a, b) => {
      const byDate = a.row.date - b.row.date;
      if (byDate !== 0) return byDate;
      const bySource = a.row.sourceIndex - b.row.sourceIndex;
      if (bySource !== 0) return bySource;
      return typeOrder(a.type) - typeOrder(b.type);
    });

  return {
    all: visibleIssues,
    receivable: visibleIssues.filter((issue) => issue.type === "receivable"),
    translator: visibleIssues.filter((issue) => issue.type === "translator"),
    invoice: visibleIssues.filter((issue) => issue.type === "invoice"),
  };
}

function toIssue(row, type, label, amountLabel, amount) {
  return {
    type,
    label,
    amountLabel,
    amount,
    key: `${row.baseKey}|${type}`,
    row,
  };
}

function invoiceIssueForRow(row) {
  const status = row.invoiceStatus.trim();
  if (row.paymentKind === "amount_error") {
    return toIssue(row, "invoice", "금액 오류", "확인 금액", row.procedureAmount);
  }
  if (row.paymentKind === "unknown") {
    return toIssue(row, "invoice", "금액 확인", "확인 금액", row.procedureAmount || row.supplyAmount);
  }
  if (row.paymentKind === "cash") {
    return status === "불필요" ? null : toIssue(row, "invoice", "현금 확인 필요", "현금 금액", row.procedureAmount);
  }
  return status === "" ? toIssue(row, "invoice", "계산서 미발행", "신고 금액", row.reportAmount || row.procedureAmount) : null;
}

function updateSummary(groups) {
  trackingEls.allIssueCount.textContent = `${groups.all.length}건`;
  trackingEls.allIssueAmount.textContent = `${money(sumIssues(groups.all))}원`;
  trackingEls.receivableCount.textContent = `${groups.receivable.length}건`;
  trackingEls.receivableAmount.textContent = `${money(sumIssues(groups.receivable))}원`;
  trackingEls.translatorPendingCount.textContent = `${groups.translator.length}건`;
  trackingEls.translatorPendingAmount.textContent = `${money(sumIssues(groups.translator))}원`;
  trackingEls.invoiceCount.textContent = `${groups.invoice.length}건`;
  trackingEls.invoiceAmount.textContent = `${money(sumIssues(groups.invoice))}원`;
}

function updateSummaryDisplay(groups) {
  trackingEls.allIssueCount.textContent = `${groups.all.length}${itemUnit()}`;
  trackingEls.allIssueAmount.textContent = `${money(sumIssues(groups.all))}${currencyUnit()}`;
  trackingEls.receivableCount.textContent = `${groups.receivable.length}${itemUnit()}`;
  trackingEls.receivableAmount.textContent = `${money(sumIssues(groups.receivable))}${currencyUnit()}`;
  trackingEls.translatorPendingCount.textContent = `${groups.translator.length}${itemUnit()}`;
  trackingEls.translatorPendingAmount.textContent = `${money(sumIssues(groups.translator))}${currencyUnit()}`;
  trackingEls.invoiceCount.textContent = `${groups.invoice.length}${itemUnit()}`;
  trackingEls.invoiceAmount.textContent = `${money(sumIssues(groups.invoice))}${currencyUnit()}`;
}

function itemUnit() {
  return currentLang === "zh" ? "件" : "건";
}

function currencyUnit() {
  return currentLang === "zh" ? "韩元" : "원";
}

function renderActiveList(issues) {
  const fragment = document.createDocumentFragment();

  if (!issues.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "tracking-empty";
    cell.colSpan = 8;
    cell.textContent = "현재 표시할 미완료 항목이 없습니다.";
    cell.textContent = currentLang === "zh" ? "\u5F53\u524D\u6CA1\u6709\u53EF\u663E\u793A\u7684\u672A\u5B8C\u6210\u9879\u76EE\u3002" : "\uD604\uC7AC \uD45C\uC2DC\uD560 \uBBF8\uC644\uB8CC \uD56D\uBAA9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.";
    row.appendChild(cell);
    trackingEls.list.replaceChildren(row);
    return;
  }

  for (const issue of issues) {
    const row = issue.row;
    const node = trackingEls.template.content.firstElementChild.cloneNode(true);
    const age = daysOpen(row.date);
    node.classList.add(`age-level-${ageLevel(age)}`);
    node.classList.toggle("is-cash-row", row.isCash);
    node.querySelector(".issue-badge").textContent = displayIssueLabel(issue);
    node.querySelector(".issue-badge").dataset.type = issue.type;
    node.querySelector(".row-hospital-name").textContent = row.hospital;
    node.querySelector(".row-date-text").textContent = row.dateLabel;
    node.querySelector(".row-translator-name").textContent = row.translator || "-";
    node.querySelector(".age-badge").textContent = age > 0 ? `${age}일 경과` : "";
    node.querySelector(".row-detail").textContent = detailText(issue);
    node.querySelector(".row-amount-label").textContent = displayAmountLabel(issue);
    node.querySelector(".row-amount").textContent = `${money(issue.amount)}원`;
    node.querySelector(".age-badge").textContent = age > 0 ? displayAge(age) : "";
    node.querySelector(".row-amount").textContent = `${money(issue.amount)}${currencyUnit()}`;
    bindWorkflowControls(node, issue);
    fragment.appendChild(node);
  }

  trackingEls.list.replaceChildren(fragment);
}

function displayIssueLabel(issue) {
  if (issue.type === "receivable") return t("receivable");
  if (issue.type === "translator") return t("translatorPending");
  if (issue.type === "invoice") return t("invoicePending");
  return issue.label;
}

function displayAmountLabel(issue) {
  if (issue.type === "receivable") return currentLang === "zh" ? "\u5E94\u6536\u91D1\u989D" : "\uBC1B\uC744 \uAE08\uC561";
  if (issue.type === "translator") return currentLang === "zh" ? "\u7ED3\u7B97\u91D1\u989D" : "\uC815\uC0B0 \uAE08\uC561";
  if (issue.row?.isCash) return currentLang === "zh" ? "\u73B0\u91D1\u91D1\u989D" : "\uD604\uAE08 \uAE08\uC561";
  return currentLang === "zh" ? "\u7533\u62A5\u91D1\u989D" : "\uC2E0\uACE0 \uAE08\uC561";
}

function displayAge(age) {
  return currentLang === "zh" ? `${age}\u5929\u7ECF\u8FC7` : `${age}\uC77C \uACBD\uACFC`;
}

function canUseRole(role) {
  if (currentRole === "all") return true;
  return role === "practitioner" ? currentRole === "staff" : currentRole === "admin";
}

function bindWorkflowControls(node, issue) {
  if (issue.type === "invoice") {
    bindInvoiceControls(node, issue);
    return;
  }
  bindApprovalControls(node, issue);
}

function bindApprovalControls(node, issue) {
  const practitionerCheck = node.querySelector(".practitioner-check");
  const adminCheck = node.querySelector(".admin-check");
  const stateLabel = node.querySelector(".approval-state");
  const labels = node.querySelectorAll(".approval-controls label span");
  if (labels[0]) labels[0].textContent = t("practitioner");
  if (labels[1]) labels[1].textContent = t("admin");
  const saved = approvalState[issue.key] || {};

  practitionerCheck.checked = Boolean(saved.practitionerCheckedAt);
  adminCheck.checked = Boolean(saved.adminCheckedAt);
  adminCheck.disabled = !practitionerCheck.checked;
  practitionerCheck.disabled = currentRole === "admin";
  adminCheck.disabled = currentRole === "staff" || !practitionerCheck.checked;
  updateApprovalLabel(stateLabel, saved);

  practitionerCheck.addEventListener("change", () => {
    updateIssueApprovalInline(issue, "practitioner", practitionerCheck.checked, node);
  });
  adminCheck.addEventListener("change", () => {
    updateIssueApprovalInline(issue, "admin", adminCheck.checked, node);
  });
}

function bindInvoiceControls(node, issue) {
  const actionCell = node.lastElementChild;
  const saved = approvalState[issue.key] || {};
  const defaultValue = issue.row.isCash ? "불필요" : "완료";
  actionCell.innerHTML = `
    <div class="invoice-controls">
      <select class="invoice-value" aria-label="계산서 처리값">
        <option value="불필요">불필요</option>
        <option value="완료">완료</option>
      </select>
      <button class="invoice-apply-btn" type="button">반영</button>
      <small class="approval-state" data-state="${saved.sheetApplied ? "done" : "idle"}">${saved.sheetApplied ? "완료" : "관리자 처리"}</small>
    </div>
  `;

  const select = actionCell.querySelector(".invoice-value");
  select.value = saved.invoiceValue || defaultValue;
  const applyButton = actionCell.querySelector(".invoice-apply-btn");
  select.disabled = currentRole === "staff";
  applyButton.disabled = currentRole === "staff";
  applyButton.textContent = t("apply");
  actionCell.querySelector(".approval-state").textContent = saved.sheetApplied ? (currentLang === "zh" ? "\u5B8C\u6210" : "\uC644\uB8CC") : t("adminOnly");
  applyButton.addEventListener("click", () => {
    completeInvoiceIssue(issue, select.value);
  });
}

async function completeInvoiceIssue(issue, invoiceValue) {
  if (currentRole === "staff") {
    setTrackingStatus(t("noPermission"), true);
    return;
  }
  const admin = clean(trackingEls.adminName.value);
  if (!admin) {
    setTrackingStatus("계산서 처리자는 관리자 이름을 먼저 입력하세요.", true);
    renderTracking();
    return;
  }

  const now = new Date().toISOString();
  approvalState[issue.key] = {
    ...(approvalState[issue.key] || {}),
    admin,
    adminCheckedAt: now,
    invoiceValue,
    practitioner: "",
    practitionerCheckedAt: "",
  };
  saveApprovalState();
  await completeIssue(issue);
  renderTracking();
}

async function updateIssueApprovalInline(issue, role, checked, node) {
  if (!canUseRole(role)) {
    setTrackingStatus(t("noPermission"), true);
    refreshApprovalControls(node, approvalState[issue.key] || {});
    return;
  }
  const actor = role === "practitioner" ? clean(trackingEls.practitionerName.value) : clean(trackingEls.adminName.value);
  if (checked && !actor) {
    setTrackingStatus(`${role === "practitioner" ? "실무자" : "관리자"} 이름을 먼저 입력하세요.`, true);
    refreshApprovalControls(node, approvalState[issue.key] || {});
    return;
  }

  const next = { ...(approvalState[issue.key] || {}) };
  const now = new Date().toISOString();
  if (role === "practitioner") {
    next.practitioner = checked ? actor : "";
    next.practitionerCheckedAt = checked ? now : "";
    if (!checked) {
      next.admin = "";
      next.adminCheckedAt = "";
      next.sheetApplied = false;
      next.sheetAppliedAt = "";
    }
  } else {
    next.admin = checked ? actor : "";
    next.adminCheckedAt = checked ? now : "";
  }

  approvalState[issue.key] = next;
  saveApprovalState();

  if (next.practitionerCheckedAt && next.adminCheckedAt) {
    await completeIssue(issue);
    renderTrackingKeepingScroll();
    return;
  }

  setTrackingStatus(`${issue.label} 항목의 ${role === "practitioner" ? "실무자 확인" : "관리자 승인"} 상태를 저장했습니다.`);
  refreshApprovalControls(node, next);
}

function refreshApprovalControls(node, state = {}) {
  const practitionerCheck = node.querySelector(".practitioner-check");
  const adminCheck = node.querySelector(".admin-check");
  const stateLabel = node.querySelector(".approval-state");

  practitionerCheck.checked = Boolean(state.practitionerCheckedAt);
  adminCheck.checked = Boolean(state.adminCheckedAt);
  practitionerCheck.disabled = currentRole === "admin";
  adminCheck.disabled = currentRole === "staff" || !practitionerCheck.checked;
  updateApprovalLabel(stateLabel, state);
}

function renderTrackingKeepingScroll() {
  const scrollY = window.scrollY;
  renderTracking();
  requestAnimationFrame(() => window.scrollTo(0, scrollY));
}

async function loadAuditLog() {
  trackingEls.auditLogPanel.hidden = false;
  trackingEls.auditLogList.innerHTML = `<tr><td class="tracking-empty" colspan="9">로그를 불러오는 중입니다.</td></tr>`;

  try {
    const response = await fetch("/tracking/audit-log");
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "로그를 불러오지 못했습니다.");
    renderAuditLog(data.logs || []);
  } catch (error) {
    trackingEls.auditLogList.innerHTML = `<tr><td class="tracking-empty error-text" colspan="9">${escapeHtml(error.message || "로그를 불러오지 못했습니다.")}</td></tr>`;
  }
}

function renderAuditLog(logs) {
  if (!logs.length) {
    trackingEls.auditLogList.innerHTML = `<tr><td class="tracking-empty" colspan="9">아직 기록된 처리 로그가 없습니다.</td></tr>`;
    return;
  }

  const rows = logs
    .slice()
    .reverse()
    .map((log) => {
      const issue = log.issue || {};
      const approval = log.approval || {};
      const rowNumber = log.resolvedRowNumber || issue.sheetRowNumber || "";
      const targetColumn = log.resolvedTargetColumn || issue.targetColumn;
      const targetCell = targetColumn && rowNumber ? `${targetColumn}${rowNumber}` : "-";
      const resultText = log.sheetApplied ? "시트 반영 완료" : "로컬 기록";

      return `
        <tr>
          <td>${escapeHtml(formatDateTime(log.completedAt))}</td>
          <td><span class="issue-badge" data-type="${escapeHtml(issue.type || "")}">${escapeHtml(readableIssueType(issue.type, issue.label))}</span></td>
          <td>
            <strong>${escapeHtml(issue.dateLabel || issue.date || "-")} · ${escapeHtml(issue.hospital || "-")}</strong>
            <span>${escapeHtml(issue.translator || "-")}</span>
          </td>
          <td>${escapeHtml(issue.customerInfo || "-")}</td>
          <td><strong>${escapeHtml(targetCell)}</strong><span>${escapeHtml(String(issue.targetValue ?? ""))}</span></td>
          <td class="tracking-money"><strong>${money(issue.amount || 0)}원</strong></td>
          <td>${escapeHtml(approval.practitioner || "-")}</td>
          <td>${escapeHtml(approval.admin || "-")}</td>
          <td><span class="approval-state" data-state="${log.sheetApplied ? "done" : "pending"}">${resultText}</span></td>
        </tr>
      `;
    })
    .join("");

  trackingEls.auditLogList.innerHTML = rows;
}

function readableIssueType(type, fallback = "") {
  return { receivable: "병원 미수령", translator: "통역사 미정산", invoice: "계산서/현금" }[type] || fallback || "-";
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function updateIssueApproval(issue, role, checked, node) {
  const actor = role === "practitioner" ? clean(trackingEls.practitionerName.value) : clean(trackingEls.adminName.value);
  if (checked && !actor) {
    setTrackingStatus(`${role === "practitioner" ? "실무자" : "관리자"} 이름을 먼저 입력하세요.`, true);
    renderTracking();
    return;
  }

  const next = { ...(approvalState[issue.key] || {}) };
  const now = new Date().toISOString();
  if (role === "practitioner") {
    next.practitioner = checked ? actor : "";
    next.practitionerCheckedAt = checked ? now : "";
    if (!checked) {
      next.admin = "";
      next.adminCheckedAt = "";
      next.sheetApplied = false;
      next.sheetAppliedAt = "";
    }
  } else {
    next.admin = checked ? actor : "";
    next.adminCheckedAt = checked ? now : "";
  }

  approvalState[issue.key] = next;
  saveApprovalState();

  if (next.practitionerCheckedAt && next.adminCheckedAt) {
    await completeIssue(issue);
  } else {
    setTrackingStatus(`${issue.label} 항목의 ${role === "practitioner" ? "실무자 확인" : "관리자 승인"} 상태를 저장했습니다.`);
  }

  renderTracking();
}

async function completeIssue(issue) {
  const state = approvalState[issue.key];
  try {
    const response = await fetch("/tracking/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        issue: serializeIssue(issue),
        approval: state,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "완료 처리 요청에 실패했습니다.");

    approvalState[issue.key] = {
      ...state,
      sheetApplied: Boolean(result.sheetApplied),
      sheetAppliedAt: result.completedAt || new Date().toISOString(),
      resolvedTargetColumn: result.resolvedTargetColumn || "",
      writeStatus: result.sheetApplied ? "applied" : "pending_google_credentials",
    };
    saveApprovalState();
    dismissedKeys.add(issue.key);
    setTrackingStatus(result.sheetApplied ? "Google Sheet 반영과 로그 기록이 완료되었습니다." : "승인 로그를 남겼습니다. Google Sheet 쓰기는 인증 연결 후 반영됩니다.");
  } catch (error) {
    setTrackingStatus(error.message || "완료 처리 중 오류가 발생했습니다.", true);
  }
}

function serializeIssue(issue) {
  const row = issue.row;
  return {
    key: issue.key,
    type: issue.type,
    label: issue.label,
    amountLabel: issue.amountLabel,
    amount: issue.amount,
    targetColumn: targetColumnForIssue(issue),
    targetValue: targetValueForIssue(issue),
    date: toInputDate(row.date),
    dateLabel: row.dateLabel,
    hospital: row.hospital,
    translator: row.translator,
    customerInfo: row.customerInfo,
    sourceIndex: row.sourceIndex,
    sheetRowNumber: row.sheetRowNumber,
    sourceMonth: row.sourceMonth,
    sourceLabel: row.sourceLabel,
    spreadsheetId: row.spreadsheetId,
    gid: row.gid,
    procedureAmount: row.procedureAmount,
    supplyAmount: row.supplyAmount,
    paymentKind: row.paymentKind,
    isCash: row.isCash,
    invoiceStatus: row.invoiceStatus,
    settlementAmount: row.settlementAmount,
  };
}

function targetColumnForIssue(issue) {
  return issue.row.targetColumns?.[issue.type] || { receivable: "N", invoice: "O", translator: "Q" }[issue.type] || "";
}

function targetValueForIssue(issue) {
  if (issue.type === "receivable" || issue.type === "translator") return true;
  return approvalState[issue.key]?.invoiceValue || (issue.row.isCash ? "불필요" : "완료");
}

function classifyPaymentKind(procedureAmount, supplyAmount) {
  if (!procedureAmount || !supplyAmount) return "unknown";
  if (procedureAmount === supplyAmount) return "cash";
  if (procedureAmount > supplyAmount) return "tax_invoice";
  return "amount_error";
}

function updateApprovalLabel(element, state = {}) {
  if (state.sheetApplied) {
    element.textContent = "완료";
    element.dataset.state = "done";
  } else if (state.practitionerCheckedAt && state.adminCheckedAt) {
    element.textContent = "반영 대기";
    element.dataset.state = "pending";
  } else if (state.practitionerCheckedAt) {
    element.textContent = "승인 필요";
    element.dataset.state = "ready";
  } else {
    element.textContent = "대기";
    element.dataset.state = "idle";
  }
}

function readApprovalState() {
  try {
    return JSON.parse(localStorage.getItem(APPROVAL_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveApprovalState() {
  localStorage.setItem(APPROVAL_STORAGE_KEY, JSON.stringify(approvalState));
}

function detailText(issue) {
  const row = issue.row;
  const parts = [];
  if (row.customerInfo) parts.push(row.customerInfo);
  if (issue.label === "금액 오류") parts.push("금액 오류: 공급가액이 시술금액보다 큽니다.");
  if (issue.label === "금액 확인") parts.push("금액 확인: 시술금액 또는 공급가액이 비어 있습니다.");
  if (issue.label === "계산서 미발행") parts.push(`계산서 상태: ${row.invoiceStatus || "미발행"}`);
  return parts.join(" · ");
}

function matchesFilters(row) {
  const month = trackingEls.month.value;
  const hospitalQuery = clean(trackingEls.hospitalSearch.value).toLowerCase();
  const translatorQuery = clean(trackingEls.translatorSearch.value).toLowerCase();
  if (month && String(row.date.getMonth() + 1).padStart(2, "0") !== month) return false;
  if (hospitalQuery && !row.hospital.toLowerCase().includes(hospitalQuery)) return false;
  if (translatorQuery && !row.translator.toLowerCase().includes(translatorQuery)) return false;
  return true;
}

function isTranslatorSettlementTarget(row) {
  return row.translator && !TRACKING_EXCLUDED_TRANSLATORS.has(row.translator);
}

function isChecked(value) {
  const normalized = clean(value).toLowerCase();
  return ["true", "o", "완료", "yes", "y", "1"].includes(normalized);
}

function selectedYear() {
  return Number(trackingEls.year.value || 2026);
}

function typeOrder(type) {
  return { receivable: 1, translator: 2, invoice: 3 }[type] || 99;
}

function compareByDateAndSheetOrder(a, b) {
  const byDate = a.date - b.date;
  if (byDate !== 0) return byDate;
  return a.sourceIndex - b.sourceIndex;
}

function daysOpen(date) {
  return Math.max(0, Math.floor((stripTime(TODAY) - stripTime(date)) / 86400000));
}

function ageLevel(age) {
  if (age >= 21) return 4;
  if (age >= 14) return 3;
  if (age >= 7) return 2;
  return 1;
}

function fetchTrackingCsv(csvUrl) {
  if (location.protocol === "file:") return fetch(csvUrl);
  return fetch(`/sheet.csv?url=${encodeURIComponent(csvUrl)}`);
}

async function readTrackingCsvError(response) {
  const message = (await response.text()).trim().slice(0, 240);
  return `시트 CSV를 읽지 못했습니다. HTTP ${response.status}${message ? ` - ${message}` : ""}`;
}

function toCsvExportUrl(url) {
  const { spreadsheetId, gid } = parseSheetRef(url);
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
}

function parseSheetRef(url) {
  const parsed = new URL(url);
  const match = parsed.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!match) throw new Error("Google Sheet URL 형식이 아닙니다.");
  const spreadsheetId = match[1];
  const gid = parsed.searchParams.get("gid") || parsed.hash.match(/gid=(\d+)/)?.[1];
  if (!gid) throw new Error("탭 gid가 포함된 Google Sheet 링크가 필요합니다.");
  return { spreadsheetId, gid };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }

  row.push(field);
  rows.push(row);
  return rows.filter((items) => items.some((item) => item.trim() !== ""));
}

function parseSheetDate(value, sourceMonth = "") {
  const normalized = value.replace(/\s+/g, " ").trim();
  const fullDate = normalized.match(/^(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\.?$/);
  if (fullDate) return new Date(Number(fullDate[1]), Number(fullDate[2]) - 1, Number(fullDate[3]));

  const shortDate = normalized.match(/^(\d{1,2})[.\-/]\s*(\d{1,2})\.?$/);
  if (!shortDate) return null;

  const month = Number(shortDate[1]);
  const day = Number(shortDate[2]);
  if (sourceMonth && month !== Number(sourceMonth)) return null;
  return new Date(selectedYear(), month - 1, day);
}

function stripTime(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatShortDate(date) {
  return `${date.getMonth() + 1}.${date.getDate()}`;
}

function clean(value) {
  return String(value ?? "").trim();
}

function cleanCustomerInfo(value, translator = "") {
  let text = clean(value).replace(/\s+/g, " ");
  const escapedTranslator = escapeRegExp(clean(translator));
  const translatorPatterns = [
    /^통역사\s*[:：]?\s*[^·|,/]+[\s·|,/:-]*/i,
    /^翻译\s*[:：]?\s*[^·|,/]+[\s·|,/:-]*/i,
  ];
  if (escapedTranslator) {
    translatorPatterns.push(new RegExp(`^통역사\\s*[:：]?\\s*${escapedTranslator}[\\s·|,/:-]*`, "i"));
    translatorPatterns.push(new RegExp(`^翻译\\s*[:：]?\\s*${escapedTranslator}[\\s·|,/:-]*`, "i"));
  }

  for (const pattern of translatorPatterns) {
    text = text.replace(pattern, "");
  }
  return text.trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toNumber(value) {
  const cleaned = clean(value).replace(/[₩,\s]/g, "");
  if (!cleaned) return 0;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : 0;
}

function money(value) {
  return Math.round(value).toLocaleString("ko-KR");
}

function sumIssues(issues) {
  return issues.reduce((total, issue) => total + (issue.amount || 0), 0);
}

function setTrackingStatus(message, isError = false) {
  trackingEls.status.textContent = message;
  trackingEls.status.classList.toggle("error", isError);
}
