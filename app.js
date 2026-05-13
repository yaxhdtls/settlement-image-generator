const EXCLUDED_TRANSLATORS = new Set(["윤토투어", "直客"]);

const els = {
  sheetUrl: document.querySelector("#sheetUrl"),
  startDate: document.querySelector("#startDate"),
  endDate: document.querySelector("#endDate"),
  loadBtn: document.querySelector("#loadBtn"),
  downloadAllBtn: document.querySelector("#downloadAllBtn"),
  cardViewBtn: document.querySelector("#cardViewBtn"),
  listViewBtn: document.querySelector("#listViewBtn"),
  periodText: document.querySelector("#periodText"),
  countText: document.querySelector("#countText"),
  translatorText: document.querySelector("#translatorText"),
  status: document.querySelector("#status"),
  results: document.querySelector("#results"),
  template: document.querySelector("#cardTemplate"),
  listTemplate: document.querySelector("#listTemplate"),
};

let currentEntries = [];
let currentView = "card";
let savedKeys = new Set();

init();

function init() {
  const defaultEnd = getThisWeekFriday(new Date());
  const defaultStart = addDays(defaultEnd, -6);
  els.startDate.value = toInputDate(defaultStart);
  els.endDate.value = toInputDate(defaultEnd);
  els.endDate.addEventListener("change", () => {
    if (!els.endDate.value) return;
    els.startDate.value = toInputDate(addDays(parseInputDate(els.endDate.value), -6));
  });
  els.loadBtn.addEventListener("click", loadAndRender);
  els.downloadAllBtn.addEventListener("click", downloadAll);
  els.cardViewBtn.addEventListener("click", () => setView("card"));
  els.listViewBtn.addEventListener("click", () => setView("list"));
}

async function loadAndRender() {
  setStatus("시트를 읽고 정산 대상 행을 고르는 중입니다.");
  els.loadBtn.disabled = true;
  els.downloadAllBtn.disabled = true;
  els.results.replaceChildren();
  savedKeys = new Set();

  try {
    const csvUrl = toCsvExportUrl(els.sheetUrl.value.trim());
    const response = await fetchCsv(csvUrl);
    if (!response.ok) throw new Error(`시트 CSV를 읽지 못했습니다. HTTP ${response.status}`);

    const csvText = await response.text();
    const rows = parseCsv(csvText);
    const start = parseInputDate(els.startDate.value, "기준 시작 날짜");
    const end = parseInputDate(els.endDate.value, "기준 끝 날짜");
    if (start > end) throw new Error("기준 시작 날짜가 기준 끝 날짜보다 늦을 수 없습니다.");
    const entries = extractSettlementRows(rows, start, end);
    currentEntries = entries;

    updateSummary(start, end, entries);
    renderEntries();
    setStatus(entries.length ? "이미지 생성이 완료되었습니다." : "조건에 맞는 정산 대상 건이 없습니다.");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "처리 중 오류가 발생했습니다.", true);
  } finally {
    els.loadBtn.disabled = false;
    els.downloadAllBtn.disabled = currentEntries.length === 0;
  }
}

function fetchCsv(csvUrl) {
  if (location.protocol === "file:") {
    return fetch(csvUrl);
  }
  return fetch(`/sheet.csv?url=${encodeURIComponent(csvUrl)}`);
}

function toCsvExportUrl(url) {
  const parsed = new URL(url);
  const match = parsed.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!match) throw new Error("Google Sheet URL 형식이 아닙니다.");

  const id = match[1];
  const gid = parsed.searchParams.get("gid") || parsed.hash.match(/gid=(\d+)/)?.[1];
  if (!gid) throw new Error("탭 gid가 포함된 Google Sheet 링크가 필요합니다.");

  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
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

function extractSettlementRows(rows, start, end) {
  const entries = [];
  let activeDate = null;

  for (const [sourceIndex, row] of rows.slice(1).entries()) {
    const rawDate = clean(row[0]);
    const parsedDate = parseSheetDate(rawDate);
    if (parsedDate) activeDate = parsedDate;

    if (!activeDate || activeDate < start || activeDate > end) continue;

    const hospital = clean(row[1]);
    const procedureAmount = toNumber(row[2]);
    const translator = clean(row[6]);
    const settlementAmount = toNumber(row[11]);

    if (!hospital || !translator) continue;
    if (EXCLUDED_TRANSLATORS.has(translator)) continue;
    if (!procedureAmount || procedureAmount <= 0) continue;
    if (!settlementAmount || settlementAmount < 0) continue;

    const supplyAmount = toNumber(row[3]);
    const withholding = clean(row[10]).toUpperCase() === "TRUE";
    const withholdingTax = withholding ? Math.round(settlementAmount * 0.033) : 0;

    entries.push({
      sourceIndex,
      date: activeDate,
      dateLabel: formatShortDate(activeDate),
      hospital,
      procedureAmount,
      supplyAmount,
      vatAmount: Math.max(0, procedureAmount - supplyAmount),
      translator,
      customerInfo: clean(row[7]),
      customerCount: clean(row[8]),
      translatorRate: clean(row[9]),
      withholding,
      settlementAmount,
      withholdingTax,
      finalAmount: settlementAmount - withholdingTax,
    });
  }

  return entries.sort((a, b) => {
    const byDate = a.date - b.date;
    if (byDate !== 0) return byDate;
    return a.sourceIndex - b.sourceIndex;
  });
}

function renderEntries() {
  if (currentView === "list") {
    renderListEntries();
    return;
  }

  renderCardEntries();
}

function renderCardEntries() {
  const fragment = document.createDocumentFragment();
  els.results.classList.remove("list");

  for (const entry of currentEntries) {
    const node = els.template.content.firstElementChild.cloneNode(true);
    const preview = node.querySelector(".preview");
    const title = node.querySelector(".card-title");
    const meta = node.querySelector(".card-meta");
    const button = node.querySelector(".download-btn");

    title.textContent = entry.translator;
    meta.textContent = `${entry.dateLabel} ${entry.hospital} · ${money(entry.finalAmount)}원`;
    const svg = createSettlementSvg(entry);
    preview.src = svgToDataUrl(svg);

    const filename = makeFileName(entry);
    applySavedState(node, button, entry);
    button.addEventListener("click", async () => {
      await downloadPng(svg, filename);
      markSaved(entry);
    });
    fragment.appendChild(node);
  }

  els.results.replaceChildren(fragment);
}

function renderListEntries() {
  const fragment = document.createDocumentFragment();
  els.results.classList.add("list");

  for (const entry of currentEntries) {
    const node = els.listTemplate.content.firstElementChild.cloneNode(true);
    const svg = createSettlementSvg(entry);
    const filename = makeFileName(entry);

    node.querySelector(".row-date").textContent = entry.dateLabel;
    node.querySelector(".row-translator").textContent = entry.translator;
    node.querySelector(".row-hospital").textContent = entry.hospital;
    node.querySelector(".row-customer").textContent = entry.customerInfo.replace(/\s+/g, " ").trim() || "-";
    node.querySelector(".row-tax").textContent = entry.withholding ? "3.3%" : "-";
    node.querySelector(".row-final").textContent = `${money(entry.finalAmount)}원`;
    const button = node.querySelector(".download-btn");
    applySavedState(node, button, entry);
    button.addEventListener("click", async () => {
      await downloadPng(svg, filename);
      markSaved(entry);
    });
    fragment.appendChild(node);
  }

  els.results.replaceChildren(fragment);
}

function setView(view) {
  currentView = view;
  els.cardViewBtn.classList.toggle("active", view === "card");
  els.listViewBtn.classList.toggle("active", view === "list");
  renderEntries();
}

function drawSettlementImage(canvas, entry) {
  const width = 480;
  const height = entry.withholding ? 360 : 280;
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  drawGrid(ctx, width, height);
  ctx.fillStyle = "#d7cde8";
  ctx.fillRect(0, 0, 280, 34);
  text(ctx, entry.translator, 10, 22, { size: 18, align: "left" });

  const centerLines = [
    `${entry.dateLabel} ${entry.hospital}`,
    ...entry.customerInfo.split(/\n+/).map((line) => line.trim()).filter(Boolean),
  ];
  const firstY = centerLines.length > 2 ? 60 : 70;
  centerLines.slice(0, 4).forEach((line, index) => {
    text(ctx, line, width / 2, firstY + index * 22, { size: 16, align: "center" });
  });

  const rows = [
    ["税前", entry.procedureAmount, false],
    ["10%附加税", entry.vatAmount, true],
    ["税后", entry.supplyAmount, false],
    [`返点 ${entry.translatorRate || ""}`.trim(), entry.settlementAmount, false],
  ];

  if (entry.withholding) {
    rows.push(["3.3%个人所得税", entry.withholdingTax, true]);
    rows.push(["总返点金额", entry.finalAmount, false]);
  }

  const startY = entry.withholding ? 150 : 138;
  rows.forEach(([label, value, red], index) => {
    const y = startY + index * 34;
    text(ctx, label, 10, y + 22, { size: 16, align: "left" });
    text(ctx, money(value), 370, y + 22, {
      size: 16,
      align: "right",
      color: red ? "#ff0000" : "#000000",
    });
  });
}

function drawGrid(ctx, width, height) {
  ctx.strokeStyle = "#d9d9d9";
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 140) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += 34) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }
}

function text(ctx, value, x, y, options = {}) {
  ctx.save();
  ctx.fillStyle = options.color || "#000000";
  ctx.font = `${options.size || 15}px Arial, sans-serif`;
  ctx.textAlign = options.align || "left";
  ctx.textBaseline = "middle";
  ctx.fillText(String(value ?? ""), x, y);
  ctx.restore();
}

async function downloadAll() {
  if (!currentEntries.length) return;
  els.downloadAllBtn.disabled = true;
  els.downloadAllBtn.textContent = "묶는 중...";

  try {
    const files = [];
    for (const entry of currentEntries) {
      const svg = createSettlementSvg(entry);
      const filename = makeFileName(entry);
      const blob = await svgToPngBlob(svg);
      files.push({ filename, bytes: new Uint8Array(await blob.arrayBuffer()) });
    }

    const zipBlob = createZip(files);
    const link = document.createElement("a");
    link.download = `settlement_${els.startDate.value}_${els.endDate.value}.zip`;
    link.href = URL.createObjectURL(zipBlob);
    link.click();
    URL.revokeObjectURL(link.href);
    currentEntries.forEach((entry) => savedKeys.add(entryKey(entry)));
    renderEntries();
  } finally {
    els.downloadAllBtn.disabled = false;
    els.downloadAllBtn.textContent = "전체 ZIP 저장";
  }
}

function markSaved(entry) {
  savedKeys.add(entryKey(entry));
  renderEntries();
}

function applySavedState(container, button, entry) {
  const saved = savedKeys.has(entryKey(entry));
  container.classList.toggle("saved", saved);
  button.classList.toggle("saved", saved);
  button.textContent = saved ? "저장됨 ✓" : "저장";
}

function entryKey(entry) {
  return [
    toInputDate(entry.date),
    entry.sourceIndex,
    entry.translator,
    entry.hospital,
    entry.settlementAmount,
  ].join("|");
}

async function downloadPng(svg, filename) {
  const blob = await svgToPngBlob(svg);
  const link = document.createElement("a");
  link.download = filename;
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}

async function svgToPngBlob(svg) {
  const image = new Image();
  image.decoding = "async";
  image.src = svgToDataUrl(svg);
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function createSettlementSvg(entry) {
  const width = 560;
  const centerLines = [
    ...entry.customerInfo.split(/\n+/).map((line) => line.trim()).filter(Boolean),
  ].slice(0, 4);
  const rows = [
    ["税前", entry.procedureAmount, "normal"],
    ["10%附加税", entry.vatAmount, "deduct"],
    ["税后", entry.supplyAmount, "normal"],
    [`返点 ${entry.translatorRate || ""}`.trim(), entry.settlementAmount, "normal"],
  ];

  if (entry.withholding) {
    rows.push(["3.3%个人所得税", entry.withholdingTax, "deduct"]);
    rows.push(["总返点金额", entry.finalAmount, "total"]);
  }

  const customerFontSize = centerLines.length >= 4 ? 14 : centerLines.length >= 3 ? 15 : 16;
  const customerLineHeight = centerLines.length >= 4 ? 19 : 21;
  const customerHeight = Math.max(68, centerLines.length * customerLineHeight + 44);
  const rowStartY = 182 + customerHeight;
  const rowHeight = 42;
  const height = rowStartY + rows.length * rowHeight + 108;
  const customerText = centerLines
    .map((line, index) => {
      const blockTop = 148 + (customerHeight - centerLines.length * customerLineHeight) / 2;
      return svgText(line, 280, blockTop + index * customerLineHeight, "middle", customerFontSize, "#172033", 500);
    })
    .join("");

  const rowText = rows
    .map(([label, value, type], index) => {
      const y = rowStartY + index * rowHeight;
      const isTotal = type === "total" || (!entry.withholding && index === rows.length - 1);
      const valueColor = type === "deduct" ? "#e11d48" : isTotal ? "#174ea6" : "#111827";
      return [
        `<line x1="32" y1="${y - 21}" x2="528" y2="${y - 21}" stroke="#e8edf2" stroke-width="1"/>`,
        svgText(label, 42, y, "start", isTotal ? 18 : 16, "#475467", isTotal ? 700 : 500),
        svgText(`${money(value)}원`, 518, y, "end", isTotal ? 22 : 18, valueColor, isTotal ? 800 : 650),
      ].join("");
    })
    .join("");

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="${width}" height="${height}" rx="22" fill="#f7f9fd"/>
      <rect x="18" y="18" width="524" height="${height - 36}" rx="18" fill="#ffffff" stroke="#d8e1ee"/>
      <rect x="18" y="18" width="524" height="96" rx="18" fill="#1f5fbf"/>
      <path d="M18 90 H542 V114 H18 Z" fill="#1f5fbf"/>
      ${svgText(entry.translator, 42, 70, "start", 28, "#ffffff", 800)}
      ${svgText(`${entry.dateLabel} · ${entry.hospital}`, 518, 70, "end", 28, "#ffffff", 800)}

      <rect x="32" y="132" width="496" height="${customerHeight}" rx="12" fill="#f3f7ff" stroke="#dbe6f7"/>
      ${svgText("客户信息", 52, 154, "start", 13, "#4e6f9f", 800)}
      ${customerText || svgText("-", 280, 176, "middle", 16, "#172033", 500)}

      ${rowText}
      <rect x="32" y="${height - 78}" width="496" height="46" rx="12" fill="#edf5ff"/>
      ${svgText("최종 지급액", 52, height - 55, "start", 15, "#1f5fbf", 800)}
      ${svgText(`${money(entry.finalAmount)}원`, 518, height - 55, "end", 24, "#174ea6", 900)}
    </svg>
  `.trim();
}

function svgText(value, x, y, anchor, size, color = "#000000", weight = 400) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle" fill="${color}" font-size="${size}" font-weight="${weight}" font-family="'Inter', 'Segoe UI', 'Noto Sans CJK SC', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Malgun Gothic', Arial, sans-serif">${escapeXml(value)}</text>`;
}

function svgToDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function makeFileName(entry) {
  const date = toInputDate(entry.date);
  const safe = `${entry.translator}_${entry.hospital}`.replace(/[\\/:*?"<>|]/g, "_");
  return `${date}_${safe}.png`;
}

function updateSummary(start, end, entries) {
  const translators = new Set(entries.map((entry) => entry.translator));
  els.periodText.textContent = `${formatKoreanDate(start)} - ${formatKoreanDate(end)}`;
  els.countText.textContent = `${entries.length}건`;
  els.translatorText.textContent = `${translators.size}명`;
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle("error", isError);
}

function getThisWeekFriday(date) {
  const result = stripTime(date);
  const day = result.getDay();
  const diff = 5 - day;
  result.setDate(result.getDate() + diff);
  return result;
}

function parseInputDate(value, label = "날짜") {
  if (!value) throw new Error(`${label}를 선택하세요.`);
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const result = stripTime(date);
  result.setDate(result.getDate() + days);
  return result;
}

function parseSheetDate(value) {
  const match = value.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
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

function formatKoreanDate(date) {
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
}

function clean(value) {
  return String(value ?? "").trim();
}

function toNumber(value) {
  const cleaned = clean(value).replace(/[₩,\s]/g, "");
  if (!cleaned) return 0;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : 0;
}

function money(value) {
  return Math.round(value).toLocaleString("ko-KR").replaceAll(",", "");
}

function createZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.filename);
    const crc = crc32(file.bytes);
    const localHeader = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.bytes.length),
      u32(file.bytes.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    ]);

    localParts.push(localHeader, file.bytes);

    const centralHeader = concatBytes([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.bytes.length),
      u32(file.bytes.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + file.bytes.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralSize),
    u32(offset),
    u16(0),
  ]);

  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
}

function u16(value) {
  return new Uint8Array([value & 255, (value >>> 8) & 255]);
}

function u32(value) {
  return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255];
  }
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});
