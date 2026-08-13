import { createReadStream, existsSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createServer } from "node:http";
import { createSign } from "node:crypto";
import { connect as tlsConnect } from "node:tls";

const root = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};
const auditLogPath = join(root, "tracking-audit-log.jsonl");
const monthlyLinksPath = join(root, "tracking-monthly-links.json");
const defaultTrackingConfigSpreadsheetId = process.env.TRACKING_CONFIG_SPREADSHEET_ID || "1rznxjL6t9u1D9nrAwYLoDsstBTU9k-ZbIH6sS0aHAU4";
const dashboardConfigSheetTitle = "\uB300\uC2DC\uBCF4\uB4DC \uC124\uC815";
const appBaseUrl = process.env.APP_BASE_URL || "https://settlement-image-generator.onrender.com";
const reminderSecret = process.env.REMINDER_SECRET || "";
const googleTokenUrl = "https://oauth2.googleapis.com/token";
const sheetsApiBase = "https://sheets.googleapis.com/v4/spreadsheets";
const sheetsScope = "https://www.googleapis.com/auth/spreadsheets";
let cachedGoogleToken = null;
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

createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  if (url.pathname === "/sheet.csv") {
    proxySheetCsv(url, response);
    return;
  }
  if (url.pathname === "/tracking/complete" && request.method === "POST") {
    completeTrackingIssue(request, response);
    return;
  }
  if (url.pathname === "/tracking/audit-log" && request.method === "GET") {
    readTrackingAuditLog(response);
    return;
  }
  if (url.pathname === "/tracking/monthly-links" && request.method === "GET") {
    readTrackingMonthlyLinks(url, response);
    return;
  }
  if (url.pathname === "/tracking/monthly-links" && request.method === "POST") {
    saveTrackingMonthlyLinks(request, response);
    return;
  }
  if (url.pathname === "/tracking/email-reminder" && request.method === "POST") {
    sendTrackingEmailReminder(request, response);
    return;
  }

  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname === "/tracking" ? "/tracking.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(root, requestedPath));

  if (!filePath.startsWith(normalize(root)) || !existsSync(filePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, { "content-type": types[extname(filePath)] || "application/octet-stream" });
  createReadStream(filePath).pipe(response);
}).listen(port, host, () => {
  const localUrl = host === "0.0.0.0" ? `http://127.0.0.1:${port}` : `http://${host}:${port}`;
  console.log(localUrl);
});

async function completeTrackingIssue(request, response) {
  try {
    const payload = await readJsonBody(request);
    const completedAt = new Date().toISOString();
    const writeResult = await applyIssueToGoogleSheet(payload.issue, payload.approval, completedAt);
    const record = {
      completedAt,
      sheetApplied: writeResult.sheetApplied,
      writeStatus: writeResult.writeStatus,
      resolvedRowNumber: writeResult.resolvedRowNumber,
      resolvedTargetColumn: writeResult.resolvedTargetColumn,
      reason: writeResult.reason,
      issue: payload.issue,
      approval: payload.approval,
    };

    await appendAuditLog(record);
    sendJson(response, writeResult.sheetApplied ? 200 : 202, {
      completedAt,
      sheetApplied: writeResult.sheetApplied,
      writeStatus: record.writeStatus,
      resolvedRowNumber: record.resolvedRowNumber,
      resolvedTargetColumn: record.resolvedTargetColumn,
      reason: record.reason,
    });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : "Invalid complete request" });
  }
}

async function applyIssueToGoogleSheet(issue, approval, completedAt) {
  if (!hasGoogleCredentials()) {
    return {
      sheetApplied: false,
      writeStatus: "pending_google_credentials",
      reason: "Google Sheets write credentials are not configured yet.",
    };
  }

  const spreadsheetId = required(issue?.spreadsheetId, "spreadsheetId");
  const gid = required(issue?.gid, "gid");
  const sheetRowNumber = required(issue?.sheetRowNumber, "sheetRowNumber");
  const targetValue = issue?.targetValue;
  const token = await getGoogleAccessToken();
  const sheetTitle = await getSheetTitleByGid(spreadsheetId, gid, token);
  const sheetRows = await readSheetRows(spreadsheetId, sheetTitle, token);
  const headerIndex = findTrackingHeaderIndex(sheetRows);
  const columns = detectTrackingColumns(sheetRows[headerIndex] || []);
  adjustTrackingColumns(sheetRows, headerIndex, columns);
  const resolvedRowNumber = resolveIssueSheetRowNumber(sheetRows, columns, headerIndex, issue, sheetRowNumber);
  const targetColumn = resolveTargetColumnForIssue(issue, columns);

  await updateSheetValue(spreadsheetId, `${quoteSheetName(sheetTitle)}!${targetColumn}${resolvedRowNumber}`, targetValue, token);
  await appendSheetLog(spreadsheetId, token, [
    completedAt,
    approval?.practitioner || "",
    approval?.practitionerCheckedAt || "",
    approval?.admin || "",
    approval?.adminCheckedAt || "",
    issue?.type || "",
    issue?.label || "",
    issue?.date || "",
    issue?.hospital || "",
    issue?.translator || "",
    issue?.customerInfo || "",
    targetColumn,
    String(issue?.targetValue ?? ""),
    issue?.amount || 0,
    `${issue?.key || ""} | row ${resolvedRowNumber}`,
  ]);

  return {
    sheetApplied: true,
    writeStatus: "applied",
    resolvedRowNumber,
    resolvedTargetColumn: targetColumn,
    reason: "",
  };
}

function hasGoogleCredentials() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

async function getGoogleAccessToken() {
  if (cachedGoogleToken && cachedGoogleToken.expiresAt > Date.now() + 60_000) {
    return cachedGoogleToken.accessToken;
  }

  const credentials = await readGoogleCredentials();
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(
    JSON.stringify({
      iss: credentials.client_email,
      scope: sheetsScope,
      aud: googleTokenUrl,
      exp: now + 3600,
      iat: now,
    }),
  );
  const unsignedJwt = `${header}.${claim}`;
  const signature = createSign("RSA-SHA256").update(unsignedJwt).sign(credentials.private_key);
  const assertion = `${unsignedJwt}.${base64Url(signature)}`;

  const response = await fetch(googleTokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.error || "Failed to authorize Google Sheets");

  cachedGoogleToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  return cachedGoogleToken.accessToken;
}

async function readGoogleCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || (process.env.GOOGLE_APPLICATION_CREDENTIALS ? await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8") : "");
  if (!raw) throw new Error("Google service account credentials are missing");
  const credentials = JSON.parse(raw);
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("Google service account credentials must include client_email and private_key");
  }
  return credentials;
}

async function getSheetTitleByGid(spreadsheetId, gid, token) {
  const response = await googleFetch(`${sheetsApiBase}/${spreadsheetId}?fields=sheets.properties(sheetId,title)`, token);
  if (!response.ok) throw await googleError(response, "Failed to read spreadsheet metadata");
  const data = await response.json();
  const sheet = data.sheets?.find((item) => String(item.properties?.sheetId) === String(gid));
  if (!sheet) throw new Error(`Sheet gid ${gid} was not found`);
  return sheet.properties.title;
}

async function readSheetRows(spreadsheetId, sheetTitle, token) {
  const response = await googleFetch(`${sheetsApiBase}/${spreadsheetId}/values/${encodeURIComponent(`${quoteSheetName(sheetTitle)}!A:ZZ`)}`, token);
  if (!response.ok) throw await googleError(response, "Failed to read sheet rows before update");

  const data = await response.json();
  return data.values || [];
}

function resolveIssueSheetRowNumber(values, columns, headerIndex, issue, fallbackRowNumber) {
  const targetDate = clean(issue?.date);
  const targetHospital = clean(issue?.hospital);
  const targetTranslator = clean(issue?.translator);
  const targetProcedureAmount = Number(issue?.procedureAmount || 0);
  const targetSupplyAmount = Number(issue?.supplyAmount || 0);
  const targetSettlementAmount = Number(issue?.settlementAmount || 0);
  const targetCustomerInfo = normalizeText(issue?.customerInfo);
  let activeDate = "";
  const candidates = [];

  for (let index = headerIndex + 1; index < values.length; index += 1) {
    const row = values[index] || [];
    const parsedDate = parseSheetDate(clean(row[columns.date]), targetDate.slice(0, 4));
    if (parsedDate) activeDate = parsedDate;
    if (!activeDate || activeDate !== targetDate) continue;
    if (clean(row[columns.hospital]) !== targetHospital) continue;
    if (clean(row[columns.translator]) !== targetTranslator) continue;
    if (toNumber(row[columns.procedureAmount]) !== targetProcedureAmount) continue;

    let score = 0;
    if (!targetSupplyAmount || toNumber(row[columns.supplyAmount]) === targetSupplyAmount) score += 2;
    if (!targetSettlementAmount || toNumber(row[columns.settlementAmount]) === targetSettlementAmount) score += 2;

    const rowCustomerInfo = normalizeText(row[columns.customerInfo]);
    if (!targetCustomerInfo || rowCustomerInfo.includes(targetCustomerInfo) || targetCustomerInfo.includes(rowCustomerInfo)) {
      score += 3;
    }

    candidates.push({ rowNumber: index + 1, score });
  }

  if (!candidates.length) return fallbackRowNumber;
  candidates.sort((a, b) => b.score - a.score || Math.abs(a.rowNumber - fallbackRowNumber) - Math.abs(b.rowNumber - fallbackRowNumber));
  return candidates[0].rowNumber;
}

function resolveTargetColumnForIssue(issue, columns) {
  const targetIndex = {
    receivable: columns.paymentReceived,
    invoice: columns.invoiceStatus,
    translator: columns.translatorSettled,
  }[issue?.type];
  if (!Number.isInteger(targetIndex) || targetIndex < 0) {
    throw new Error(`Unable to resolve target column for ${issue?.type || "unknown"} issue`);
  }
  return columnLetter(targetIndex);
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
    translator: find(6, "통역사", "翻译"),
    customerInfo: find(7, "고객정보", "客户"),
    settlementAmount: find(11, "정산금액", "结算金额"),
  };
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

function isCheckboxLikeColumn(rows, headerIndex, columnIndex) {
  if (!Number.isInteger(columnIndex) || columnIndex < 0) return false;
  let checked = 0;
  let meaningful = 0;
  for (const row of rows.slice(headerIndex + 1, headerIndex + 80)) {
    const value = clean(row[columnIndex]).toLowerCase();
    if (!value) continue;
    meaningful += 1;
    if (["true", "false", "o", "x", "\uC644\uB8CC", "yes", "no", "y", "n", "1", "0"].includes(value)) checked += 1;
  }
  return meaningful > 0 && checked / meaningful >= 0.8;
}

function isAmountLikeColumn(rows, headerIndex, columnIndex) {
  if (!Number.isInteger(columnIndex) || columnIndex < 0) return false;
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

function parseSheetDate(value, fallbackYear = "2026") {
  const normalized = clean(value);
  const fullDate = normalized.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?$/);
  if (fullDate) {
    return `${fullDate[1]}-${fullDate[2].padStart(2, "0")}-${fullDate[3].padStart(2, "0")}`;
  }

  const shortDate = normalized.match(/^(\d{1,2})[.\-/]\s*(\d{1,2})\.?$/);
  if (shortDate) {
    return `${fallbackYear}-${shortDate[1].padStart(2, "0")}-${shortDate[2].padStart(2, "0")}`;
  }

  return "";
}

function clean(value) {
  return String(value ?? "").trim();
}

function legacyToNumber(value) {
  const numeric = Number(clean(value).replace(/[₩,\s]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeText(value) {
  return clean(value).replace(/\s+/g, "").toLowerCase();
}

function toNumber(value) {
  const numeric = Number(clean(value).replace(/[\u20A9,\s]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

async function updateSheetValue(spreadsheetId, range, value, token) {
  const response = await googleFetch(`${sheetsApiBase}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, token, {
    method: "PUT",
    body: JSON.stringify({ values: [[value]] }),
  });
  if (!response.ok) throw await googleError(response, "Failed to update sheet value");
}

async function updateSheetValues(spreadsheetId, range, values, token) {
  const response = await googleFetch(`${sheetsApiBase}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, token, {
    method: "PUT",
    body: JSON.stringify({ values }),
  });
  if (!response.ok) throw await googleError(response, "Failed to update sheet values");
}

async function clearSheetRange(spreadsheetId, range, token) {
  const response = await googleFetch(`${sheetsApiBase}/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`, token, {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!response.ok) throw await googleError(response, "Failed to clear sheet range");
}

async function appendSheetLog(spreadsheetId, token, values) {
  await ensureAuditSheet(spreadsheetId, token);
  const response = await googleFetch(`${sheetsApiBase}/${spreadsheetId}/values/${encodeURIComponent("'작업로그'!A:O")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, token, {
    method: "POST",
    body: JSON.stringify({ values: [values] }),
  });
  if (!response.ok) throw await googleError(response, "Failed to append audit log");
}

async function ensureAuditSheet(spreadsheetId, token) {
  const metadata = await googleFetch(`${sheetsApiBase}/${spreadsheetId}?fields=sheets.properties(title)`, token);
  if (!metadata.ok) throw await googleError(metadata, "Failed to read spreadsheet metadata");
  const data = await metadata.json();
  if (data.sheets?.some((sheet) => sheet.properties?.title === "작업로그")) return;

  const response = await googleFetch(`${sheetsApiBase}/${spreadsheetId}:batchUpdate`, token, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        { addSheet: { properties: { title: "작업로그" } } },
      ],
    }),
  });
  if (!response.ok) throw await googleError(response, "Failed to create audit sheet");

  const headerResponse = await googleFetch(`${sheetsApiBase}/${spreadsheetId}/values/${encodeURIComponent("'작업로그'!A:O")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, token, {
    method: "POST",
    body: JSON.stringify({
      values: [
        [
          "완료시각",
          "실무자",
          "실무자확인시각",
          "관리자",
          "관리자승인시각",
          "유형",
          "라벨",
          "날짜",
          "병원",
          "통역사",
          "고객정보",
          "반영열",
          "반영값",
          "금액",
          "항목키",
        ],
      ],
    }),
  });
  if (!headerResponse.ok) throw await googleError(headerResponse, "Failed to initialize audit sheet");
}

async function googleFetch(url, token, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
}

async function googleError(response, fallback) {
  const data = await response.json().catch(() => ({}));
  return new Error(data.error?.message || fallback);
}

function required(value, label) {
  if (value === undefined || value === null || value === "") throw new Error(`${label} is required`);
  return value;
}

function quoteSheetName(name) {
  return `'${String(name).replaceAll("'", "''")}'`;
}

function base64Url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function readTrackingAuditLog(response) {
  try {
    if (!existsSync(auditLogPath)) {
      sendJson(response, 200, { logs: [] });
      return;
    }
    const text = await readFile(auditLogPath, "utf8");
    const logs = text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    sendJson(response, 200, { logs });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Failed to read audit log" });
  }
}

async function readTrackingMonthlyLinks(url, response) {
  try {
    const year = clean(url.searchParams.get("year")) || String(new Date().getFullYear());
    const spreadsheetId = clean(url.searchParams.get("spreadsheetId")) || defaultTrackingConfigSpreadsheetId;
    const store = await readMonthlyLinksStore(spreadsheetId);
    sendJson(response, 200, { year, links: store[year] || {} });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Failed to read monthly sheet links" });
  }
}

async function saveTrackingMonthlyLinks(request, response) {
  try {
    const payload = await readJsonBody(request);
    const year = clean(payload.year) || String(new Date().getFullYear());
    const links = sanitizeMonthlyLinks(payload.links || {});
    const spreadsheetId = clean(payload.spreadsheetId) || defaultTrackingConfigSpreadsheetId;
    const store = await readMonthlyLinksStore(spreadsheetId);
    store[year] = links;
    await writeMonthlyLinksStore(store, spreadsheetId);
    sendJson(response, 200, { year, links });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : "Failed to save monthly sheet links" });
  }
}

async function readMonthlyLinksStore(spreadsheetId = defaultTrackingConfigSpreadsheetId) {
  if (hasGoogleCredentials()) {
    try {
      return await readMonthlyLinksFromConfigSheet(spreadsheetId);
    } catch (error) {
      console.warn(error);
    }
  }

  const envStore = readMonthlyLinksFromEnv();
  if (!existsSync(monthlyLinksPath)) return envStore;
  try {
    return { ...envStore, ...JSON.parse(await readFile(monthlyLinksPath, "utf8")) };
  } catch {
    return envStore;
  }
}

async function writeMonthlyLinksStore(store, spreadsheetId = defaultTrackingConfigSpreadsheetId) {
  if (hasGoogleCredentials()) {
    await writeMonthlyLinksToConfigSheet(store, spreadsheetId);
    return;
  }
  await writeFile(monthlyLinksPath, JSON.stringify(store, null, 2), "utf8");
}

async function readMonthlyLinksFromConfigSheet(spreadsheetId) {
  const token = await getGoogleAccessToken();
  await ensureDashboardConfigSheet(spreadsheetId, token);
  const rows = await readSheetRows(spreadsheetId, dashboardConfigSheetTitle, token);
  const store = {};

  for (const row of rows.slice(1)) {
    const year = clean(row[0]);
    const monthNumber = Number(clean(row[1]));
    const month = Number.isInteger(monthNumber) && monthNumber >= 1 && monthNumber <= 12 ? String(monthNumber).padStart(2, "0") : "";
    const url = clean(row[2]);
    if (!year || !month || !url) continue;
    if (!store[year]) store[year] = {};
    store[year][month] = url;
  }

  return store;
}

async function writeMonthlyLinksToConfigSheet(store, spreadsheetId) {
  const token = await getGoogleAccessToken();
  await ensureDashboardConfigSheet(spreadsheetId, token);
  const rows = [["\uC5F0\uB3C4", "\uC6D4", "\uC2DC\uD2B8 \uB9C1\uD06C"]];

  for (const year of Object.keys(store).sort()) {
    const links = store[year] || {};
    for (const month of Object.keys(links).sort((a, b) => Number(a) - Number(b))) {
      const url = clean(links[month]);
      if (url) rows.push([year, String(Number(month)), url]);
    }
  }

  await clearSheetRange(spreadsheetId, `${quoteSheetName(dashboardConfigSheetTitle)}!A:C`, token);
  await updateSheetValues(spreadsheetId, `${quoteSheetName(dashboardConfigSheetTitle)}!A1:C${rows.length}`, rows, token);
}

async function ensureDashboardConfigSheet(spreadsheetId, token) {
  const metadata = await googleFetch(`${sheetsApiBase}/${spreadsheetId}?fields=sheets.properties(title)`, token);
  if (!metadata.ok) throw await googleError(metadata, "Failed to read spreadsheet metadata");
  const data = await metadata.json();
  if (data.sheets?.some((sheet) => sheet.properties?.title === dashboardConfigSheetTitle)) return;

  const response = await googleFetch(`${sheetsApiBase}/${spreadsheetId}:batchUpdate`, token, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        { addSheet: { properties: { title: dashboardConfigSheetTitle } } },
      ],
    }),
  });
  if (!response.ok) throw await googleError(response, "Failed to create dashboard config sheet");
}

function readMonthlyLinksFromEnv() {
  if (!process.env.TRACKING_MONTHLY_SHEET_URLS) return {};
  try {
    const parsed = JSON.parse(process.env.TRACKING_MONTHLY_SHEET_URLS);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    return {};
  }
  return {};
}

function sanitizeMonthlyLinks(input) {
  const links = {};
  for (const month of Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"))) {
    const value = clean(input[month]);
    if (value) links[month] = value;
  }
  return links;
}

async function appendAuditLog(record) {
  await appendFile(auditLogPath, `${JSON.stringify(record)}\n`, "utf8");
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, data) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

async function sendTrackingEmailReminder(request, response) {
  try {
    const payload = await readJsonBody(request);
    assertReminderAuthorized(request, payload);
    const year = clean(payload.year) || String(new Date().getFullYear());
    const summary = await buildTrackingReminderSummary(year);

    if (payload.dryRun === true) {
      const recipients = reminderRecipients({ allowEmpty: true });
      sendJson(response, 200, {
        sent: false,
        dryRun: true,
        recipients: recipients.map(({ role, name, email }) => ({ role, name, email })),
        summary: serializeReminderSummary(summary),
      });
      return;
    }

    if (summary.groups.all.length === 0) {
      sendJson(response, 200, { sent: false, reason: "no_pending_items", summary: serializeReminderSummary(summary) });
      return;
    }

    const recipients = reminderRecipients();
    const sent = [];
    for (const recipient of recipients) {
      await sendEmail({
        to: recipient.email,
        subject: reminderSubject(recipient, summary),
        text: reminderBody(recipient, summary),
      });
      sent.push({ role: recipient.role, name: recipient.name, email: recipient.email });
    }

    sendJson(response, 200, { sent: true, recipients: sent, summary: serializeReminderSummary(summary) });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : "Failed to send email reminder" });
  }
}

function assertReminderAuthorized(request, payload) {
  if (!reminderSecret) return;
  const headerSecret = clean(request.headers["x-reminder-secret"]);
  const bodySecret = clean(payload.secret);
  if (headerSecret !== reminderSecret && bodySecret !== reminderSecret) {
    throw new Error("Invalid reminder secret");
  }
}

function reminderRecipients(options = {}) {
  const staffEmail = clean(process.env.REMINDER_STAFF_EMAIL);
  const adminEmail = clean(process.env.REMINDER_ADMIN_EMAIL);
  const recipients = [];
  if (staffEmail) recipients.push({ role: "staff", name: process.env.REMINDER_STAFF_NAME || "kiki", email: staffEmail });
  if (adminEmail) recipients.push({ role: "admin", name: process.env.REMINDER_ADMIN_NAME || "\u5468\u5409\u9633", email: adminEmail });
  if (!recipients.length && !options.allowEmpty) throw new Error("Reminder recipient emails are not configured");
  return recipients;
}

function reminderSubject(recipient, summary) {
  return recipient.role === "staff"
    ? `【润兔国际】结算待处理事项提醒（${summary.groups.all.length}件）`
    : `【润兔国际】结算待复核事项提醒（${summary.groups.all.length}件）`;
}

function reminderBody(recipient, summary) {
  const dashboardUrl = `${appBaseUrl}/tracking?role=${recipient.role === "staff" ? "staff" : "admin"}&lang=zh`;
  const urgent = summary.urgentCount > 0 ? `\n优先处理：目前有 ${summary.urgentCount} 件事项已超过 21 天，请尽快确认。\n` : "";
  const large = summary.largeAmountCount > 0 ? `\n金额提醒：其中有 ${summary.largeAmountCount} 件事项金额达到 1,000,000 韩元以上，请特别留意。\n` : "";
  const roleText = recipient.role === "staff"
    ? "请先核对待处理事项的日期、医院、客户信息和金额。确认无误后，请选择自己的名字并勾选“操作者”栏；勾选完成后，请及时提醒管理员进行最终复核。"
    : "请复核操作者已确认的事项，并再次确认日期、医院、客户信息、金额和处理状态。确认无误后，请选择自己的名字并勾选“管理员”栏，完成最终确认。";

  return [
    `${recipient.name}，您好。`,
    "",
    "目前结算追踪看板中仍有未完成事项，请按照您的角色进行确认和处理。",
    "",
    "当前待处理概况：",
    `- 未完成事项：${summary.groups.all.length}件`,
    `- 医院款项未确认：${summary.groups.receivable.length}件 / ${formatWon(sumIssues(summary.groups.receivable))}`,
    `- 翻译费用未结算：${summary.groups.translator.length}件 / ${formatWon(sumIssues(summary.groups.translator))}`,
    `- 税单未开具：${summary.groups.invoice.length}件 / ${formatWon(sumIssues(summary.groups.invoice))}`,
    urgent.trim(),
    large.trim(),
    "处理方式：",
    roleText,
    "",
    "看板链接：",
    dashboardUrl,
    "",
    "处理完成后，请确认相关事项是否已从看板列表中消失。",
    "谢谢。",
  ].filter((line) => line !== "").join("\n");
}

function serializeReminderSummary(summary) {
  return {
    year: summary.year,
    all: summary.groups.all.length,
    receivable: summary.groups.receivable.length,
    translator: summary.groups.translator.length,
    invoice: summary.groups.invoice.length,
    urgentCount: summary.urgentCount,
    largeAmountCount: summary.largeAmountCount,
  };
}

async function buildTrackingReminderSummary(year) {
  const store = await readMonthlyLinksStore(defaultTrackingConfigSpreadsheetId);
  const links = store[year] || {};
  const token = await getGoogleAccessToken();
  const rows = [];

  for (const month of Object.keys(links).sort((a, b) => Number(a) - Number(b))) {
    const source = parseSheetSource(links[month], month);
    const sheetTitle = await getSheetTitleByGid(source.spreadsheetId, source.gid, token);
    const values = await readSheetRows(source.spreadsheetId, sheetTitle, token);
    rows.push(...extractReminderRows(values, source, year));
  }

  const issues = rows.flatMap((row) => reminderIssuesForRow(row)).sort((a, b) => {
    const byDate = a.row.date.localeCompare(b.row.date);
    if (byDate !== 0) return byDate;
    const byRow = a.row.sheetRowNumber - b.row.sheetRowNumber;
    if (byRow !== 0) return byRow;
    return { receivable: 1, translator: 2, invoice: 3 }[a.type] - { receivable: 1, translator: 2, invoice: 3 }[b.type];
  });

  const groups = {
    all: issues,
    receivable: issues.filter((issue) => issue.type === "receivable"),
    translator: issues.filter((issue) => issue.type === "translator"),
    invoice: issues.filter((issue) => issue.type === "invoice"),
  };
  const urgentCount = issues.filter((issue) => issue.elapsedDays >= 21).length;
  const largeAmountCount = issues.filter((issue) => issue.amount >= 1_000_000).length;
  return { year, rows, groups, urgentCount, largeAmountCount };
}

function parseSheetSource(url, month) {
  const parsed = new URL(url);
  const match = parsed.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!match) throw new Error(`Invalid sheet URL for month ${Number(month)}`);
  const gid = parsed.searchParams.get("gid") || parsed.hash.match(/gid=(\d+)/)?.[1];
  if (!gid) throw new Error(`Missing gid in sheet URL for month ${Number(month)}`);
  return {
    month,
    spreadsheetId: match[1],
    gid,
    url,
  };
}

function extractReminderRows(values, source, year) {
  const result = [];
  let activeDate = "";
  const headerIndex = findTrackingHeaderIndex(values);
  const columns = detectTrackingColumns(values[headerIndex] || []);
  adjustTrackingColumns(values, headerIndex, columns);

  for (const [offset, row] of values.slice(headerIndex + 1).entries()) {
    const sourceIndex = headerIndex + 1 + offset;
    const parsedDate = parseSheetDate(clean(row[columns.date]), year);
    if (parsedDate) activeDate = parsedDate;
    if (!activeDate) continue;

    const hospital = clean(row[columns.hospital]);
    const procedureAmount = toNumber(row[columns.procedureAmount]);
    if (!hospital || !procedureAmount) continue;

    const supplyAmount = toNumber(row[columns.supplyAmount]);
    const translator = clean(row[columns.translator]);
    const settlementAmount = toNumber(row[columns.settlementAmount]);
    const receivableAmount = toNumber(row[columns.receivableAmount]);
    const invoiceStatus = clean(row[columns.invoiceStatus]);
    const reportAmount = toNumber(row[columns.reportAmount]);
    const paymentKind = classifyPaymentKind(procedureAmount, supplyAmount);

    result.push({
      date: activeDate,
      elapsedDays: daysSince(activeDate),
      sheetRowNumber: sourceIndex + 1,
      hospital,
      translator,
      procedureAmount,
      supplyAmount,
      settlementAmount,
      receivableAmount,
      paymentReceived: isChecked(row[columns.paymentReceived]),
      invoiceStatus,
      reportAmount,
      translatorSettled: isChecked(row[columns.translatorSettled]),
      paymentKind,
      isCash: paymentKind === "cash",
    });
  }

  return result;
}

function reminderIssuesForRow(row) {
  const issues = [];
  if (!row.paymentReceived && row.receivableAmount > 0) {
    issues.push(toReminderIssue(row, "receivable", row.receivableAmount));
  }
  if (isTranslatorSettlementTarget(row) && !row.translatorSettled && row.settlementAmount > 0) {
    issues.push(toReminderIssue(row, "translator", row.settlementAmount));
  }
  const invoiceAmount = invoiceReminderAmount(row);
  if (invoiceAmount > 0) {
    issues.push(toReminderIssue(row, "invoice", invoiceAmount));
  }
  return issues;
}

function toReminderIssue(row, type, amount) {
  return { type, amount, elapsedDays: row.elapsedDays, row };
}

function invoiceReminderAmount(row) {
  const status = row.invoiceStatus.trim();
  if (row.paymentKind === "cash") return status === "\uBD88\uD544\uC694" ? 0 : row.procedureAmount;
  if (row.paymentKind === "tax_invoice") return status === "" ? row.reportAmount || row.procedureAmount : 0;
  if (row.paymentKind === "amount_error" || row.paymentKind === "unknown") return row.procedureAmount || row.supplyAmount;
  return 0;
}

function isTranslatorSettlementTarget(row) {
  return row.translator && !["\uC724\uD1A0\uD22C\uC5B4", "\u76F4\u5BA2"].includes(row.translator);
}

function classifyPaymentKind(procedureAmount, supplyAmount) {
  if (!procedureAmount || !supplyAmount) return "unknown";
  if (procedureAmount === supplyAmount) return "cash";
  if (procedureAmount > supplyAmount) return "tax_invoice";
  return "amount_error";
}

function isChecked(value) {
  const normalized = clean(value).toLowerCase();
  return ["true", "o", "\uC644\uB8CC", "yes", "y", "1"].includes(normalized);
}

function daysSince(inputDate) {
  const date = new Date(`${inputDate}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
}

function sumIssues(issues) {
  return issues.reduce((sum, issue) => sum + Number(issue.amount || 0), 0);
}

function formatWon(amount) {
  return `${Math.round(Number(amount || 0)).toLocaleString("ko-KR")}韩元`;
}

async function sendEmail({ to, subject, text }) {
  const host = clean(process.env.SMTP_HOST);
  const port = Number(process.env.SMTP_PORT || 465);
  const user = clean(process.env.SMTP_USER);
  const pass = clean(process.env.SMTP_PASS);
  const from = clean(process.env.SMTP_FROM) || user;
  if (!host || !user || !pass || !from) throw new Error("SMTP settings are not configured");

  const message = buildEmailMessage({ from, to, subject, text });
  await smtpSend({ host, port, user, pass, from, to, message });
}

function buildEmailMessage({ from, to, subject, text }) {
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${mimeHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    "",
  ].join("\r\n");
}

function mimeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(String(value), "utf8").toString("base64")}?=`;
}

function smtpSend({ host, port, user, pass, from, to, message }) {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({ host, port, servername: host }, () => {});
    let buffer = "";
    const queue = [
      { expect: 220, command: `EHLO ${host}` },
      { expect: 250, command: "AUTH LOGIN" },
      { expect: 334, command: Buffer.from(user).toString("base64") },
      { expect: 334, command: Buffer.from(pass).toString("base64") },
      { expect: 235, command: `MAIL FROM:<${extractEmail(from)}>` },
      { expect: 250, command: `RCPT TO:<${extractEmail(to)}>` },
      { expect: 250, command: "DATA" },
      { expect: 354, command: `${message}\r\n.` },
      { expect: 250, command: "QUIT" },
      { expect: 221, command: null },
    ];
    let step = 0;

    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (!buffer.endsWith("\r\n")) return;
      const lines = buffer.trimEnd().split(/\r?\n/);
      const last = lines[lines.length - 1] || "";
      if (/^\d{3}-/.test(last)) return;
      const code = Number(last.slice(0, 3));
      buffer = "";
      const current = queue[step];
      if (!current) return;
      if (code !== current.expect) {
        socket.destroy();
        reject(new Error(`SMTP error ${code}: ${last}`));
        return;
      }
      step += 1;
      if (current.command === null) {
        socket.end();
        resolve();
        return;
      }
      socket.write(`${current.command}\r\n`);
    });
    socket.on("error", reject);
  });
}

function extractEmail(value) {
  const match = String(value).match(/<([^>]+)>/);
  return clean(match ? match[1] : value);
}

async function proxySheetCsv(url, response) {
  const target = url.searchParams.get("url");
  if (!target || !target.startsWith("https://docs.google.com/spreadsheets/")) {
    response.writeHead(400);
    response.end("Invalid sheet URL");
    return;
  }

  try {
    const upstream = await fetchSheetCsv(target);
    if (!upstream.ok) {
      response.writeHead(upstream.status);
      response.end(await upstream.text());
      return;
    }

    response.writeHead(200, { "content-type": "text/csv; charset=utf-8" });
    response.end(await upstream.text());
  } catch (error) {
    response.writeHead(502);
    response.end(error instanceof Error ? error.message : "Failed to fetch sheet");
  }
}

async function fetchSheetCsv(inputUrl) {
  const targets = toSheetCsvCandidates(inputUrl);
  let lastResponse = null;
  let lastError = null;

  for (const target of targets) {
    try {
      const response = await fetch(target, {
        headers: {
          "user-agent": "settlement-image-generator/0.1",
        },
      });
      if (response.ok) return response;
      lastResponse = response;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError || new Error("Failed to fetch sheet");
}

function toSheetCsvCandidates(inputUrl) {
  const parsed = new URL(inputUrl);
  const match = parsed.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!match) return [inputUrl];

  const id = match[1];
  const gid = parsed.searchParams.get("gid") || parsed.hash.match(/gid=(\d+)/)?.[1];
  if (!gid) return [inputUrl];

  const exportUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
  const gvizUrl = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}`;
  return [...new Set([inputUrl, exportUrl, gvizUrl])];
}
