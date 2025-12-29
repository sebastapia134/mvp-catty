// helpers para descargar JSON y generar CSV desde objetos/arrays JSON (sin dependencias)

// ---------- JSON ----------
export function downloadJSON(filename, data) {
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- CSV core helpers ----------
function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // si contiene comillas, saltos de línea o comas, encerrar entre comillas y duplicar comillas internas
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function normalizeValue(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString();
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function downloadCSV(filename, csvText, { bom = true } = {}) {
  const content = (bom ? "\uFEFF" : "") + csvText; // BOM para Excel + UTF-8
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- Detecta tu estructura FileOut / file_json ----------
function extractFileTable(input) {
  // Caso típico: FileOut del backend
  if (
    input?.file_json?.data?.nodes &&
    Array.isArray(input.file_json.data.nodes)
  ) {
    return {
      kind: "file",
      fileInfo: {
        file_id: input.id ?? "",
        file_code: input.code ?? "",
        file_name: input.name ?? "",
        created_at: input.created_at ?? "",
        updated_at: input.updated_at ?? "",
      },
      columns: Array.isArray(input.file_json.data.columns)
        ? input.file_json.data.columns
        : null,
      rows: input.file_json.data.nodes,
    };
  }

  // Caso: ya pasas directamente file_json
  if (input?.data?.nodes && Array.isArray(input.data.nodes)) {
    return {
      kind: "file",
      fileInfo: null,
      columns: Array.isArray(input.data.columns) ? input.data.columns : null,
      rows: input.data.nodes,
    };
  }

  // Caso: ya pasas directamente data (ui/meta/columns/nodes)
  if (input?.nodes && Array.isArray(input.nodes)) {
    return {
      kind: "file",
      fileInfo: null,
      columns: Array.isArray(input.columns) ? input.columns : null,
      rows: input.nodes,
    };
  }

  return null;
}

function buildHeaderMap(columns) {
  // Devuelve [{ header, key }]
  if (!Array.isArray(columns) || columns.length === 0) return null;

  const used = new Set();
  return columns.map((c) => {
    const key = c?.key;
    const label = (c?.label ?? "").trim();
    const base = label || String(key ?? "");
    let header = base || String(key ?? "");
    if (used.has(header)) header = `${header} (${key})`;
    used.add(header);
    return { header, key };
  });
}

function inferHeaderMapFromRows(rows) {
  const keys = new Set();
  for (const r of rows || []) Object.keys(r || {}).forEach((k) => keys.add(k));
  const orderedKeys = Array.from(keys);
  return orderedKeys.map((k) => ({ header: k, key: k }));
}

// ---------- Export: tu “Excel” real (nodes x columns) ----------
function exportNodesTableToCSV(filename, fileLike, opts = {}) {
  const {
    includeFileInfo = true, // añade columnas file_id/file_code/... repetidas por fila
    bom = true,
  } = opts;

  const table = extractFileTable(fileLike);
  if (!table)
    throw new Error(
      "No se detectó estructura con nodes/columns para exportar."
    );

  const rows = table.rows || [];
  const headerMap =
    buildHeaderMap(table.columns) || inferHeaderMapFromRows(rows);

  // Headers finales
  const prefix =
    includeFileInfo && table.fileInfo
      ? Object.keys(table.fileInfo).map((k) => ({
          header: k,
          key: k,
          _prefix: true,
        }))
      : [];

  const finalMap = [...prefix, ...headerMap];

  const lines = [];
  lines.push(finalMap.map((h) => csvEscape(h.header)).join(","));

  for (const r of rows) {
    const outRow = finalMap.map((h) => {
      if (h._prefix) return csvEscape(normalizeValue(table.fileInfo[h.key]));
      return csvEscape(normalizeValue(r?.[h.key]));
    });
    lines.push(outRow.join(","));
  }

  downloadCSV(filename, lines.join("\r\n"), { bom });

  return { rows: rows.length };
}

// ---------- Export genérico (array de records) ----------
function exportRecordsToCSV(filename, jsonData, opts = {}) {
  const { bom = true } = opts;

  let arr = Array.isArray(jsonData) ? jsonData : [jsonData];

  // si viene envuelto tipo {items:[...]} o {data:[...]}
  if (arr.length === 1 && (arr[0]?.items || arr[0]?.data)) {
    const candidate = arr[0].items || arr[0].data;
    if (Array.isArray(candidate)) arr = candidate;
  }

  // headers (union de llaves)
  const headersSet = new Set();
  const normalized = arr.map((rec) => {
    const r = rec || {};
    Object.keys(r).forEach((k) => headersSet.add(k));
    return r;
  });

  const headers = Array.from(headersSet);
  // orden determinista: id, name primero si existen; resto alfabético
  const ordered = [];
  if (headers.includes("id")) {
    ordered.push("id");
    headers.splice(headers.indexOf("id"), 1);
  }
  if (headers.includes("name")) {
    ordered.push("name");
    headers.splice(headers.indexOf("name"), 1);
  }
  headers.sort();
  ordered.push(...headers);

  const lines = [];
  lines.push(ordered.join(","));
  for (const rec of normalized) {
    const row = ordered.map((h) => csvEscape(normalizeValue(rec?.[h])));
    lines.push(row.join(","));
  }

  downloadCSV(filename, lines.join("\r\n"), { bom });
  return { rows: normalized.length };
}

// ---------- API pública: misma firma que ya usas ----------
export async function exportToCSV(filename, jsonData, opts = {}) {
  // Si es tu FileOut / file_json -> exporta nodes como tabla
  const asFile = extractFileTable(jsonData);
  if (asFile) {
    return exportNodesTableToCSV(filename, jsonData, opts);
  }

  // Si no, fallback genérico
  return exportRecordsToCSV(filename, jsonData, opts);
}

// (opcional) export directo “solo nodes” si quieres llamarlo explícito
export function exportFileNodesToCSV(filename, fileObj, opts = {}) {
  return exportNodesTableToCSV(filename, fileObj, opts);
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
