import {
  memo,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import styles from "../styles/FileDetail.module.css";
import { AuthContext } from "../context/AuthContext";
import { getFile, updateFile, downloadFileXlsx } from "../services/files";
import { downloadJSON } from "../utils/export";

const TYPES = { LEVEL: "LEVEL", GROUP: "GROUP", ITEM: "ITEM" };

const DEFAULT_SCALES = {
  VI: [
    { key: "VI_5", label: "Muy importante / Crítico", value: 5 },
    { key: "VI_4", label: "Importante", value: 4 },
    { key: "VI_3", label: "Neutro", value: 3 },
    { key: "VI_2", label: "Poco importante", value: 2 },
    { key: "VI_1", label: "No importante", value: 1 },
  ],
  VC: [
    { key: "VC_1", label: "Aplica", value: 3 },
    { key: "VC_05", label: "Parcialmente", value: 2 },
    { key: "VC_0", label: "No aplica", value: 1 },
  ],
};

// Convierte a número si es posible; devuelve null si no es numérico.
function toNumericOrNull(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Normaliza un nodo para que sus IDs sean numéricos.
function normalizeNodeIds(node, nextId) {
  const maybeId = toNumericOrNull(node.id);
  // Si node.id es numérico lo usamos como number; si no, conservamos el id string (si existe)
  const id = maybeId !== null ? maybeId : node.id ?? nextId();

  // parentId: si es numérico lo ponemos como number (y 0 => null),
  // si no es numérico lo conservamos (puede ser código o uuid).
  const p = toNumericOrNull(node.parentId);
  let parentId;
  if (p !== null) {
    parentId = p === 0 ? null : p;
  } else {
    parentId = node.parentId ?? null;
  }

  return { ...node, id, parentId };
}

// Resuelve un valor de input (p.ej. value de <select>) al id real del nodo
// devolviendo el id con el tipo correcto (number o string), o null.

function uuid() {
  try {
    return (
      crypto?.randomUUID?.() || `tmp-${Math.random().toString(36).slice(2)}`
    );
  } catch {
    return `tmp-${Math.random().toString(36).slice(2)}`;
  }
}
function deepClone(obj) {
  try {
    return structuredClone(obj);
  } catch {
    return JSON.parse(JSON.stringify(obj));
  }
}
function normalizeKey(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_]/g, "");
}
function nodeLabel(n) {
  return `${n?.code ? `${n.code} — ` : ""}${n?.title || "(sin título)"}`;
}

const TreeNode = memo(function TreeNode({
  node,
  byParent,
  selectedId,
  onSelect,
}) {
  const kids = byParent.get(String(node.id)) || [];
  const selected = node.id === selectedId;

  return (
    <li>
      <div
        className={`${styles.treeItem} ${
          selected ? styles.treeItemSelected : ""
        }`}
        onClick={() => onSelect(node.id)}
        role="button"
        tabIndex={0}
      >
        <span
          className={`${styles.tag} ${
            node.type === TYPES.LEVEL
              ? styles.tagLevel
              : node.type === TYPES.GROUP
              ? styles.tagGroup
              : styles.tagItem
          }`}
        >
          {node.type}
        </span>
        <div className={styles.treeText}>{nodeLabel(node)}</div>
      </div>

      {kids.length > 0 ? (
        <ul className={`${styles.tree} ${styles.indent}`}>
          {kids.map((ch) => (
            <TreeNode
              key={ch.id}
              node={ch}
              byParent={byParent}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
});

function safeFilename(name) {
  return String(name || "file").replace(/[^a-z0-9_\-\.]/gi, "_");
}

function labelize(key) {
  const map = {
    name: "Nombre",
    email: "Correo",
    company: "Nombre de la empresa",
    company_current: "Empresa actual",
    industry: "Área o industria",
    size: "Tamaño (según uso de software)",
    experience: "Experiencia profesional (años)",
  };
  return map[key] || String(key).replaceAll("_", " ");
}

function isApplicable(col, node) {
  return col.appliesTo === "ALL" || col.appliesTo === node.type;
}

function viLabel(scales, viKey) {
  return scales?.VI?.find((s) => s.key === viKey)?.label ?? "";
}
function vcLabel(scales, vcKey) {
  return scales?.VC?.find((s) => s.key === vcKey)?.label ?? "";
}
function viValue(scales, viKey) {
  return scales?.VI?.find((s) => s.key === viKey)?.value ?? null;
}
function vcValue(scales, vcKey) {
  return scales?.VC?.find((s) => s.key === vcKey)?.value ?? null;
}

// 1) Añade este helper cerca de los otros helpers
function mergeCustomFromRoot(nodes, columns) {
  const keys = new Set((columns || []).map((c) => c.key).filter(Boolean));
  if (!keys.size) return nodes;

  return (nodes || []).map((n) => {
    const cleaned = { ...n };
    const customFromRoot = {};

    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(cleaned, k)) {
        customFromRoot[k] = cleaned[k];
        delete cleaned[k]; // ✅ importante: evita duplicado root vs custom
      }
    }

    const mergedCustom = { ...customFromRoot, ...(cleaned.custom || {}) };
    return { ...cleaned, custom: mergedCustom };
  });
}
const RESERVED_NODE_KEYS = new Set([
  "id",
  "parentId",
  "order",
  "type",
  "code",
  "title",
  "desc",
  "viKey",
  "vcKey",
  "weight",
  "required",
  "active",
  "custom",
]);

function baseHeaderDefs() {
  return [
    { key: "CODE", label: "Código", width: 110 },
    { key: "TITLE", label: "Enunciado", width: 110 },
    { key: "TYPE", label: "Tipo", width: 110 },
    { key: "PARENT_CODE", label: "Padre", width: 220 },
    { key: "VI_LABEL", label: "VI (texto)", width: 160 },
    { key: "VI", label: "VI (valor)", width: 110 },
    { key: "VC_LABEL", label: "VC (texto)", width: 160 },
    { key: "VC", label: "VC (valor)", width: 110 },
    { key: "PESO", label: "Peso", width: 90 },
    { key: "REQ", label: "Req.", width: 90 },
    { key: "ACTIVO", label: "Activo", width: 100 },
  ];
}

function ConfirmModal({
  open,
  title,
  body,
  confirmText,
  danger,
  onClose,
  onConfirm,
}) {
  if (!open) return null;
  return (
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>{title}</div>
          <button
            className={`${styles.btn} ${styles.tiny}`}
            onClick={onClose}
            type="button"
          >
            Cerrar
          </button>
        </div>

        <div className={styles.modalContent}>
          <div className={styles.hint} style={{ whiteSpace: "pre-wrap" }}>
            {body}
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.btn} onClick={onClose} type="button">
            Cancelar
          </button>
          <button
            className={`${styles.btn} ${
              danger ? styles.danger : styles.primary
            }`}
            onClick={onConfirm}
            type="button"
          >
            {confirmText || "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ColumnsModal({
  open,
  onClose,
  columns,
  setColumns,
  nodes,
  setNodes,
  setDirty,
  setStatus,
}) {
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({
    label: "",
    key: "",
    type: "text",
    appliesTo: "ALL",
    editable: true,
    optionsText: "",
    formula: "",
  });

  useEffect(() => {
    if (!open) return;
    // reset selection each time opens
    setEditId(null);
    setForm({
      label: "",
      key: "",
      type: "text",
      appliesTo: "ALL",
      editable: true,
      optionsText: "",
      formula: "",
    });
  }, [open]);

  const selected = useMemo(
    () => columns.find((c) => c.id === editId) || null,
    [columns, editId]
  );

  function loadCol(id) {
    const c = columns.find((x) => x.id === id);
    if (!c) return;
    setEditId(id);
    setForm({
      label: c.label || "",
      key: c.key || "",
      type: c.type || "text",
      appliesTo: c.appliesTo || "ALL",
      editable: c.editable !== false,
      optionsText: (c.options || []).join(", "),
      formula: c.formula || "",
    });
  }

  function newCol() {
    setEditId(null);
    setForm({
      label: "",
      key: "",
      type: "text",
      appliesTo: "ALL",
      editable: true,
      optionsText: "",
      formula: "",
    });
  }

  function saveCol() {
    const label = (form.label || "").trim();
    const key = normalizeKey(form.key || label);
    if (!label || !key) {
      setStatus("bad", "Pon un label y un key válidos.");
      return;
    }

    const exists = columns.find((c) => c.key === key && c.id !== editId);
    if (exists) {
      setStatus("bad", `Ya existe una columna con key ${key}.`);
      return;
    }

    const type = form.type;
    const options = (form.optionsText || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (type === "select" && options.length === 0) {
      setStatus("bad", "Tipo select requiere al menos 1 opción.");
      return;
    }
    if (type === "formula" && !String(form.formula || "").trim()) {
      setStatus(
        "bad",
        "Tipo formula requiere una fórmula (ej: ={VI}*{VC}*{PESO})."
      );
      return;
    }

    const payload = {
      id: key,
      label,
      key,
      type,
      appliesTo: form.appliesTo || "ALL",
      editable: type === "formula" ? false : !!form.editable,
      options,
      formula: type === "formula" ? String(form.formula || "").trim() : "",
    };

    if (editId) {
      const prevCol = columns.find((c) => c.id === editId);
      const oldKey = prevCol?.key;
      if (oldKey && oldKey !== key) {
        setNodes((prev) =>
          prev.map((n) => {
            const cst = n.custom || {};
            if (!Object.prototype.hasOwnProperty.call(cst, oldKey)) return n;
            const custom = { ...cst, [key]: cst[oldKey] };
            delete custom[oldKey];
            return { ...n, custom };
          })
        );
      }
    }

    setColumns((prev) => {
      const next = [...prev];
      const idx = next.findIndex((c) => c.id === editId);
      if (idx >= 0) next[idx] = payload;
      else next.push(payload);
      return next;
    });

    setDirty(true);
    setStatus("ok", "Columnas actualizadas.");
    setEditId(payload.id);
  }

  function deleteCol() {
    if (!selected) return;
    const key = selected.key;

    // UI: eliminación directa (sin alert). Usa status + confirm modal externo si quieres.
    setColumns((prev) => prev.filter((c) => c.id !== selected.id));
    setNodes((prev) =>
      prev.map((n) => {
        if (!n.custom) return n;
        if (!Object.prototype.hasOwnProperty.call(n.custom, key)) return n;
        const custom = { ...n.custom };
        delete custom[key];
        return { ...n, custom };
      })
    );

    setDirty(true);
    setStatus("warn", `Columna eliminada: ${selected.label}`);
    newCol();
  }

  if (!open) return null;

  const showOptions = form.type === "select";
  const showFormula = form.type === "formula";

  return (
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        className={styles.modalWide}
        role="dialog"
        aria-modal="true"
        aria-label="Gestión de columnas"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>
            Columnas (dinámicas + fórmulas)
          </div>
          <button
            className={`${styles.btn} ${styles.tiny}`}
            onClick={onClose}
            type="button"
          >
            Cerrar
          </button>
        </div>

        <div className={styles.modalBodyGrid}>
          <div className={styles.colList}>
            <div className={styles.colListHead}>Columnas personalizadas</div>
            <div>
              {columns.length === 0 ? (
                <div className={styles.colItem} style={{ cursor: "default" }}>
                  <div>
                    <b style={{ color: "var(--text)" }}>Sin columnas</b>
                    <br />
                    <small>Crea la primera con “Nueva”.</small>
                  </div>
                </div>
              ) : (
                columns.map((c) => (
                  <div
                    key={c.id}
                    className={`${styles.colItem} ${
                      c.id === editId ? styles.colItemSelected : ""
                    }`}
                    onClick={() => loadCol(c.id)}
                    role="button"
                    tabIndex={0}
                  >
                    <div>
                      <div>
                        <b style={{ color: "var(--text)" }}>{c.label}</b>{" "}
                        <small>({c.key})</small>
                      </div>
                      <small>
                        {c.type} • aplica: {c.appliesTo} • editable:{" "}
                        {c.editable ? "sí" : "no"}
                      </small>
                      {c.type === "formula" ? (
                        <div style={{ marginTop: 6 }}>
                          <small>ƒ {c.formula || ""}</small>
                        </div>
                      ) : null}
                    </div>
                    <div className={styles.colActions}>
                      <span className={styles.tag}>{c.type}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <div className={styles.field}>
              <div className={styles.label}>Nombre (label)</div>
              <input
                className={styles.cellInput}
                value={form.label}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((p) => ({
                    ...p,
                    label: v,
                    key: p.key ? p.key : normalizeKey(v),
                  }));
                }}
                placeholder="Ej: Evidencia"
              />
            </div>

            <div className={styles.row2}>
              <div className={styles.field}>
                <div className={styles.label}>Nombre DB</div>
                <input
                  className={styles.cellInput}
                  value={form.key}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      key: normalizeKey(e.target.value),
                    }))
                  }
                  placeholder="EJ: EVIDENCIA"
                />
              </div>
              <div className={styles.field}>
                <div className={styles.label}>Tipo</div>
                <select
                  className={styles.cellSelect}
                  value={form.type}
                  onChange={(e) => {
                    const t = e.target.value;
                    setForm((p) => ({
                      ...p,
                      type: t,
                      editable: t === "formula" ? false : p.editable,
                    }));
                  }}
                >
                  <option value="text">text</option>
                  <option value="number">number</option>
                  <option value="select">select</option>
                  <option value="boolean">boolean</option>
                  <option value="formula">formula</option>
                </select>
              </div>
            </div>

            <div className={styles.row2}>
              <div className={styles.field}>
                <div className={styles.label}>Aplica a</div>
                <select
                  className={styles.cellSelect}
                  value={form.appliesTo}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, appliesTo: e.target.value }))
                  }
                >
                  <option value="ALL">ALL</option>
                  <option value="GROUP">GROUP</option>
                  <option value="ITEM">ITEM</option>
                </select>
              </div>
              <div className={styles.field}>
                <div className={styles.label}>Editable</div>
                <select
                  className={styles.cellSelect}
                  value={String(!!form.editable)}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      editable: e.target.value === "true",
                    }))
                  }
                  disabled={form.type === "formula"}
                >
                  <option value="true">Sí</option>
                  <option value="false">No</option>
                </select>
              </div>
            </div>

            {showOptions ? (
              <div className={styles.field}>
                <div className={styles.label}>
                  Opciones (select) — separa con comas
                </div>
                <textarea
                  className={styles.cellInput}
                  value={form.optionsText}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, optionsText: e.target.value }))
                  }
                  placeholder="Alta, Media, Baja"
                />
              </div>
            ) : null}

            {showFormula ? (
              <div className={styles.field}>
                <div className={styles.label}>
                  Fórmula (se exporta a Excel tal cual)
                </div>
                <input
                  className={styles.cellInput}
                  value={form.formula}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, formula: e.target.value }))
                  }
                  placeholder="Ej: ={VI}*{VC}*{PESO}"
                />
                <div className={styles.hint} style={{ marginTop: 6 }}>
                  Placeholders típicos: {"{VI}"}, {"{VC}"}, {"{PESO}"} y
                  cualquier key de columna (ej. {"{SEVERIDAD}"}).
                  <br />
                  La app no calcula; Excel calcula al abrir el archivo.
                </div>
              </div>
            ) : null}

            <div className={styles.hint} style={{ marginTop: 8 }}>
              Tip: usa key en MAYÚSCULAS sin espacios (EJ: EVIDENCIA, SEVERIDAD,
              PUNTAJE).
            </div>
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button
            className={`${styles.btn} ${styles.danger}`}
            onClick={deleteCol}
            disabled={!selected}
            type="button"
          >
            Eliminar
          </button>
          <button className={styles.btn} onClick={newCol} type="button">
            Nueva
          </button>
          <button
            className={`${styles.btn} ${styles.primary}`}
            onClick={saveCol}
            type="button"
          >
            Guardar columna
          </button>
        </div>
      </div>
    </div>
  );
}

// ====== ADAPTADOR ROBUSTO PARA JSON DINÁMICO (claves variadas) ======

function stripDiacritics(s) {
  try {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  } catch {
    return String(s || "");
  }
}

function normFieldName(k) {
  return stripDiacritics(k).toLowerCase().replace(/\s+/g, "_");
}

function parseJsonMaybe(x) {
  if (typeof x !== "string") return x;
  const t = x.trim();
  if (!t) return {};
  try {
    return JSON.parse(t);
  } catch {
    return x;
  }
}

function unwrapDataLayer(x) {
  // Soporta: {data:{...}} o {file_json:{data:{...}}} etc
  let p = x;
  for (let i = 0; i < 3; i++) {
    if (p && typeof p === "object" && p.data && typeof p.data === "object")
      p = p.data;
    else break;
  }
  return p;
}

function getAny(obj, candidates) {
  if (!obj || typeof obj !== "object") return undefined;

  // 1) match exact (case-sensitive)
  for (const k of candidates) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }

  // 2) match por nombre normalizado
  const entries = Object.entries(obj);
  const want = candidates.map(normFieldName);
  for (const [k, v] of entries) {
    const nk = normFieldName(k);
    if (want.includes(nk)) return v;
  }

  return undefined;
}

function getByRegex(obj, regexes) {
  if (!obj || typeof obj !== "object") return undefined;
  const entries = Object.entries(obj);
  for (const rx of regexes) {
    for (const [k, v] of entries) {
      const nk = normFieldName(k);
      if (rx.test(nk)) return v;
    }
  }
  return undefined;
}

function normalizeCode(code) {
  const s = String(code ?? "").trim();
  return s.replace(/\s+/g, " ").replace(/\.+$/g, ""); // quita puntos finales tipo "1.1."
}

function depthFromCode(code) {
  const c = normalizeCode(code);
  if (!c) return 0;
  const parts = c.split(".").filter(Boolean);
  return parts.length;
}

function parentCodeFromCode(code) {
  const c = normalizeCode(code);
  const parts = c.split(".").filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join(".");
}

function coerceBool(v, fallback = true) {
  if (v === true || v === false) return v;
  if (v === "true" || v === "false") return v === "true";
  if (v === 1 || v === 0) return !!v;
  return fallback;
}

function coerceNumber(v, fallback = 1) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function coerceType(rawType, depthHint = 0, hasChildren = false) {
  const t = String(rawType ?? "")
    .trim()
    .toUpperCase();

  // equivalencias comunes
  if (t === "LEVEL" || t === "NIVEL" || t === "N") return "LEVEL";
  if (
    t === "GROUP" ||
    t === "GRUPO" ||
    t === "AGRUPACION" ||
    t === "AGRUPACIÓN" ||
    t === "G"
  )
    return "GROUP";
  if (
    t === "ITEM" ||
    t === "ITEMS" ||
    t === "I" ||
    t === "A" ||
    t === "CRITERIO" ||
    t === "PREGUNTA"
  )
    return "ITEM";

  // inferencia por jerarquía (si no viene tipo)
  if (depthHint === 1) return "LEVEL";
  if (hasChildren) return "GROUP";
  return "ITEM";
}

function coerceViKey(scales, raw) {
  // acepta "VI_3" o 3
  const s = String(raw ?? "").trim();
  if (!s) return "VI_3";
  if (/^VI_\d+$/i.test(s)) return s.toUpperCase();
  const n = Number(raw);
  if (Number.isFinite(n)) {
    const k = `VI_${Math.max(1, Math.min(5, Math.round(n)))}`;
    const exists = (scales?.VI || []).some((x) => x.key === k);
    return exists ? k : "VI_3";
  }
  return "VI_3";
}

function coerceVcKey(scales, raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "VC_1";
  if (/^VC_\d+$/i.test(s) || /^VC_0?5$/i.test(s))
    return s.toUpperCase().replace("VC_05", "VC_05");
  const n = Number(raw);
  if (Number.isFinite(n)) {
    if (n === 1) return "VC_1";
    if (n === 0.5) return "VC_05";
    if (n === 0) return "VC_0";
  }
  return "VC_1";
}

function normalizeColumnsAny(payload) {
  const rawCols =
    (Array.isArray(payload?.columns) && payload.columns) ||
    (Array.isArray(payload?.columnas) && payload.columnas) ||
    (Array.isArray(payload?.cols) && payload.cols) ||
    [];

  return rawCols
    .map((c) => {
      const label = String(
        getAny(c, ["label", "nombre", "titulo", "título"]) ?? c.key ?? ""
      ).trim();

      const key = normalizeKey(getAny(c, ["key", "clave", "campo"]) ?? label);

      const type = String(getAny(c, ["type", "tipo"]) ?? "text").toLowerCase();

      const appliesTo = String(
        getAny(c, ["appliesTo", "aplica_a", "aplica"]) ?? "ALL"
      ).toUpperCase();

      const editable = coerceBool(
        getAny(c, ["editable", "edit", "es_editable"]),
        true
      );

      const optionsRaw = getAny(c, ["options", "opciones", "vals", "values"]);
      const options = Array.isArray(optionsRaw) ? optionsRaw.map(String) : [];

      const formula = String(getAny(c, ["formula", "fórmula"]) ?? "").trim();
      const stableId = String(c.id || c.key || key); // 👈 estable

      return {
        id: stableId,
        label: label || key,
        key,
        type: ["text", "number", "select", "boolean", "formula"].includes(type)
          ? type
          : "text",
        appliesTo: ["ALL", "LEVEL", "GROUP", "ITEM"].includes(appliesTo)
          ? appliesTo
          : "ALL",
        editable: type === "formula" ? false : !!editable,
        options,
        formula: type === "formula" ? formula : formula || "",
      };
    })
    .filter((c) => c.key);
}

function flattenTreeAny(treeArray, scales) {
  const out = [];
  const walk = (node, parentId, depth) => {
    const kids =
      getAny(node, ["children", "hijos", "nodes", "items"]) ||
      getByRegex(node, [/^children$/, /^hijos$/, /^nodes$/, /^items$/]) ||
      [];
    const hasChildren = Array.isArray(kids) && kids.length > 0;

    const rawCode =
      getAny(node, ["code", "codigo", "código"]) ??
      getByRegex(node, [/^code$/, /codigo/]);

    const rawTitle =
      getAny(node, [
        "title",
        "titulo",
        "título",
        "enunciado",
        "nombre",
        "name",
        "label",
        "agrupacion",
        "agrupación",
      ]) ??
      getByRegex(node, [
        /enunciado/,
        /titulo/,
        /title/,
        /nombre/,
        /label/,
        /agrup/,
      ]);

    const rawType =
      getAny(node, ["type", "tipo", "kind"]) ??
      getByRegex(node, [/^type$/, /^tipo$/, /kind/]);

    const code = String(rawCode ?? "").trim();
    const title = String(rawTitle ?? "").trim();

    out.push({
      id: node.id || uuid(),
      type: coerceType(rawType, depth, hasChildren),
      code,
      title,
      desc: String(
        getAny(node, ["desc", "descripcion", "descripción", "ayuda", "help"]) ??
          ""
      ),
      parentId:
        parentId == null || parentId === ""
          ? null
          : typeof parentId === "string" || typeof parentId === "number"
          ? String(parentId)
          : null,

      viKey: coerceViKey(
        scales,
        getAny(node, [
          "viKey",
          "vi",
          "vi_key",
          "nivel_importancia",
          "importancia",
        ])
      ),
      vcKey: coerceVcKey(
        scales,
        getAny(node, ["vcKey", "vc", "vc_key", "aplica"])
      ),
      weight: coerceNumber(getAny(node, ["weight", "peso"]), 1),
      required: coerceBool(getAny(node, ["required", "requerido"]), true),
      active: coerceBool(getAny(node, ["active", "activo"]), true),
      order: coerceNumber(getAny(node, ["order", "orden"]), out.length * 10),
      custom: node.custom && typeof node.custom === "object" ? node.custom : {},
    });

    if (hasChildren) {
      const thisId = out[out.length - 1].id;
      kids.forEach((k) => walk(k, thisId, depth + 1));
    }
  };

  (treeArray || []).forEach((n) => walk(n, null, 1));
  return out;
}

function normalizeNodesAny(payload, scales) {
  // 1) ya viene en flat nodes
  const rawNodes =
    (Array.isArray(payload?.nodes) && payload.nodes) ||
    (Array.isArray(payload?.nodos) && payload.nodos) ||
    (Array.isArray(payload?.items) && payload.items) ||
    null;

  // 2) viene como tree
  const rawTree =
    (!rawNodes && Array.isArray(payload?.tree) && payload.tree) ||
    (!rawNodes && Array.isArray(payload?.estructura) && payload.estructura) ||
    (!rawNodes && Array.isArray(payload?.structure) && payload.structure) ||
    null;

  let nodes = [];

  if (rawNodes) {
    nodes = rawNodes.map((n, idx) => {
      const rawCode =
        getAny(n, ["code", "codigo", "código"]) ??
        getByRegex(n, [/^code$/, /codigo/]);

      const rawTitle =
        getAny(n, [
          "title",
          "titulo",
          "título",
          "enunciado",
          "nombre",
          "name",
          "label",
          "agrupacion",
          "agrupación",
        ]) ??
        getByRegex(n, [
          /enunciado/,
          /titulo/,
          /title/,
          /nombre/,
          /label/,
          /agrup/,
        ]);

      const rawType =
        getAny(n, ["type", "tipo", "kind"]) ??
        getByRegex(n, [/^type$/, /^tipo$/, /kind/]);

      const rawParent =
        getAny(n, [
          "parentId",
          "parent_id",
          "padre",
          "padreId",
          "id_padre",
          "parent",
        ]) ?? getByRegex(n, [/parent/, /padre/]);

      const code = String(rawCode ?? "").trim();
      const title = String(rawTitle ?? "").trim();

      const depth = depthFromCode(code);
      const type = coerceType(rawType, depth, false);
      const { custom: _custom, children, hijos, ...rest } = n || {};
      const customObj = _custom && typeof _custom === "object" ? _custom : {};

      return {
        id: n.id || getAny(n, ["uuid", "ID", "Id"]) || uuid(),
        type,
        code,
        title,
        desc: String(
          getAny(n, ["desc", "descripcion", "descripción", "ayuda", "help"]) ??
            ""
        ),
        parentId:
          rawParent == null || rawParent === ""
            ? null
            : typeof rawParent === "string" || typeof rawParent === "number"
            ? String(rawParent)
            : null,

        viKey: coerceViKey(
          scales,
          getAny(n, [
            "viKey",
            "vi",
            "vi_key",
            "nivel_importancia",
            "importancia",
          ])
        ),
        vcKey: coerceVcKey(
          scales,
          getAny(n, ["vcKey", "vc", "vc_key", "aplica"])
        ),
        weight: coerceNumber(getAny(n, ["weight", "peso"]), 1),
        required: coerceBool(getAny(n, ["required", "requerido"]), true),
        active: coerceBool(getAny(n, ["active", "activo"]), true),
        order: coerceNumber(getAny(n, ["order", "orden"]), (idx + 1) * 10),
        custom: n.custom && typeof n.custom === "object" ? n.custom : {},
      };
    });
  } else if (rawTree) {
    nodes = flattenTreeAny(rawTree, scales);
  }

  // 3) Si no hay nodes/tree, intenta derivar de "rows"/"checklist"
  if (nodes.length === 0) {
    const rows =
      (Array.isArray(payload?.rows) && payload.rows) ||
      (Array.isArray(payload?.checklist) && payload.checklist) ||
      (Array.isArray(payload?.data) && payload.data) ||
      [];

    if (Array.isArray(rows) && rows.length) {
      const mapCodeToId = new Map();

      nodes = rows.map((r, idx) => {
        const code = String(
          getAny(r, ["code", "codigo", "código"]) ??
            getByRegex(r, [/^code$/, /codigo/]) ??
            ""
        ).trim();

        const title = String(
          getAny(r, [
            "title",
            "titulo",
            "título",
            "enunciado",
            "agrupacion",
            "agrupación",
            "nombre",
            "name",
            "label",
          ]) ??
            getByRegex(r, [
              /enunciado/,
              /titulo/,
              /title/,
              /agrup/,
              /nombre/,
              /label/,
            ]) ??
            ""
        ).trim();

        const depth = depthFromCode(code);
        const rawType =
          getAny(r, ["type", "tipo"]) ?? getByRegex(r, [/^type$/, /^tipo$/]);
        const type = coerceType(rawType, depth, false);

        const id = uuid();
        mapCodeToId.set(normalizeCode(code), id);

        return {
          id,
          type,
          code,
          title,
          desc: String(
            getAny(r, [
              "desc",
              "descripcion",
              "descripción",
              "observaciones",
              "obs",
            ]) ?? ""
          ),
          parentId: null, // se resuelve abajo por código
          viKey: coerceViKey(
            scales,
            getAny(r, ["viKey", "vi", "nivel_importancia", "importancia"])
          ),
          vcKey: coerceVcKey(scales, getAny(r, ["vcKey", "vc", "aplica"])),
          weight: coerceNumber(getAny(r, ["weight", "peso"]), 1),
          required: coerceBool(getAny(r, ["required", "requerido"]), true),
          active: coerceBool(getAny(r, ["active", "activo"]), true),
          order: (idx + 1) * 10,
          custom: {},
        };
      });

      // parent por código (ej: 1.1.1 -> 1.1)
      nodes = nodes.map((n) => {
        const pc = parentCodeFromCode(n.code);
        if (!pc) return n;
        const pid = mapCodeToId.get(normalizeCode(pc));
        return pid ? { ...n, parentId: pid } : n;
      });
    }
  }

  // Resolver parentId si venía como "código" en vez de UUID
  if (nodes.length) {
    const idSet = new Set(nodes.map((n) => n.id));
    const byCode = new Map(
      nodes.filter((n) => n.code).map((n) => [normalizeCode(n.code), n.id])
    );

    nodes = nodes.map((n) => {
      if (!n.parentId) return n;
      if (idSet.has(n.parentId)) return n;

      const maybe = byCode.get(normalizeCode(n.parentId));
      return maybe ? { ...n, parentId: maybe } : n;
    });
  }

  return nodes;
}

function adaptEditorPayload(raw, fallbackScales) {
  const parsed = unwrapDataLayer(parseJsonMaybe(raw));
  const payload = parsed && typeof parsed === "object" ? parsed : {};

  const scales = payload.scales || payload.escalas || fallbackScales;

  const meta =
    payload.meta || payload.form || payload.datos || payload.metadata || {};

  const intro = Array.isArray(payload.intro)
    ? payload.intro
    : Array.isArray(payload.introduccion)
    ? payload.introduccion
    : [];

  const questions = payload.questions || payload.preguntas || {};

  const ui = payload.ui || { showMeta: true };

  const columns = normalizeColumnsAny(payload);
  const nodes = normalizeNodesAny(payload, scales);

  const selectedIdRaw =
    payload.selectedId || payload.selected_id || payload.seleccion || null;

  const selectedId =
    selectedIdRaw && nodes.some((n) => n.id === selectedIdRaw)
      ? selectedIdRaw
      : nodes[0]?.id || null;

  const warning =
    nodes.length === 0
      ? "No encontré nodos en el JSON (revisa la forma del payload)."
      : "";

  return {
    meta,
    intro,
    questions,
    scales,
    ui,
    columns,
    nodes,
    selectedId,
    warning,
  };
}

function mapTypeToOriginal(t) {
  if (!t) return null;
  if (String(t).toUpperCase() === "GROUP") return "G";
  if (String(t).toUpperCase() === "ITEM") return "A";
  return String(t).toUpperCase();
}

// parse "1.1.2.3." -> [1,1,2,3,null]
function parseHierarchyParts(code) {
  const c = normalizeCode(code || "");
  if (!c) return [null, null, null, null, null];
  const parts = c
    .split(".")
    .filter(Boolean)
    .map((p) => {
      const n = Number(p);
      return Number.isFinite(n) ? n : null;
    });
  const out = [null, null, null, null, null];
  for (let i = 0; i < Math.min(5, parts.length); i++) out[i] = parts[i];
  return out;
}

// busca claves similares (normalizadas) dentro de custom u objeto
function findField(o, candidates) {
  if (!o || typeof o !== "object") return undefined;
  for (const k of candidates) {
    if (Object.prototype.hasOwnProperty.call(o, k)) return o[k];
  }
  const entries = Object.entries(o);
  const want = candidates.map(normFieldName);
  for (const [k, v] of entries) {
    if (want.includes(normFieldName(k))) return v;
  }
  return undefined;
}

/*
  Serializa el estado del editor al "formato original" esperado.
  - edited: objeto con campos meta,intro,questions,scales,ui,columns,nodes
  - options.preserveScales: si true, incluye scales en la salida (si el archivo original lo tenía)
*/
function editedToOriginal(edited, options = {}) {
  const preserveScales = !!options.preserveScales;

  const metaOut = edited.meta || {};
  const introOut = Array.isArray(edited.intro) ? edited.intro : [];
  const questionsOut = edited.questions || {};
  const uiOut = edited.ui || { showMeta: true };

  // columns -> formato original: { key, type, label }
  const colsOut = (Array.isArray(edited.columns) ? edited.columns : []).map(
    (c) => {
      const keyLow = String(c.key || c.id || "").toLowerCase();
      // map type: mantén tipo simple (number/text/longtext) - adaptalo si necesitas otros mapeos
      const type =
        c.type === "number"
          ? "number"
          : c.type === "formula"
          ? "text"
          : c.type === "select"
          ? "text"
          : c.type === "boolean"
          ? "text"
          : "text";
      return {
        key: keyLow,
        type,
        label: c.label || c.key || "",
      };
    }
  );

  // nodes: mapear cada nodo al esquema original
  // nodes: mapear cada nodo al esquema original
  const nodesOut = (Array.isArray(edited.nodes) ? edited.nodes : []).map(
    (n) => {
      const idOut = toNumericOrNull(n.id) ?? n.id;
      const code = String(n.code ?? n.codigo ?? "").trim();
      const [p1, p2, p3, p4, p5] = parseHierarchyParts(code);

      // intentar recuperar agrupacion_es / observaciones / nivel_* de custom u otros campos conservados
      const agrup_es =
        n.agrupacion_es ??
        findField(n, [
          "agrupacion_es",
          "agrupación_es",
          "agrupacion_español",
        ]) ??
        findField(n.custom || {}, [
          "AGRUPACION_ES",
          "agrupacion_es",
          "agrupacion_español",
        ]) ??
        null;

      const observaciones =
        n.observaciones ??
        findField(n, ["observaciones", "obs"]) ??
        findField(n.custom || {}, ["OBSERVACIONES", "observaciones", "obs"]) ??
        null;

      const nivel_aplicacion =
        n.nivel_aplicacion ??
        findField(n, ["nivel_aplicacion", "nivel_aplicación"]) ??
        null;

      const nivel_importancia =
        n.nivel_importancia ??
        findField(n, ["nivel_importancia", "nivel_importancia"]) ??
        null;

      // --- NUEVO: preservar referencia al padre al exportar ---
      // si parentId es numérico sacamos número, si no lo dejamos como string (uuid o código)
      const rawParent = n.parentId ?? n.parent ?? null;
      const parentOut =
        rawParent == null ? null : toNumericOrNull(rawParent) ?? rawParent;

      return {
        id: idOut,
        1: p1,
        2: p2,
        3: p3,
        4: p4,
        5: p5,
        tipo: mapTypeToOriginal(n.type),
        codigo: code,
        descripcion: n.desc ?? n.descripcion ?? "",
        agrupacion_en: n.title ?? n.agrupacion_en ?? "",
        agrupacion_es: agrup_es ?? null,
        observaciones: observaciones ?? null,
        nivel_aplicacion: nivel_aplicacion ?? null,
        nivel_importancia: nivel_importancia ?? null,

        // exportar referencia al padre para no perder jerarquía
        parentId: parentOut,
        parent: parentOut,
      };
    }
  );

  const out = {
    meta: metaOut,
    intro: introOut,
    questions: questionsOut,
    ui: uiOut,
    columns: colsOut,
    nodes: nodesOut,
  };

  if (preserveScales && edited.scales) {
    // si el archivo original tenía scales, las movemos tal cual (para no perder info)
    out.scales = edited.scales;
  }

  return out;
}

export default function FileDetail() {
  const { fileId } = useParams();
  const navigate = useNavigate();
  const { token, user } = useContext(AuthContext);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [file, setFile] = useState(null);

  // Core editor state (dinámico desde JSON)
  const [meta, setMeta] = useState({});
  const [intro, setIntro] = useState([]);
  const [questions, setQuestions] = useState({});
  const [scales, setScales] = useState(DEFAULT_SCALES);
  const [columns, setColumns] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [ui, setUi] = useState({ showMeta: true });
  const nextIdRef = useRef(1); // generador incremental de IDs numéricos

  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Status/log
  const [statusKind, setStatusKind] = useState("");
  const [statusMsg, setStatusMsg] = useState("—");

  // Modals
  const [colsOpen, setColsOpen] = useState(false);
  const [confirm, setConfirm] = useState({
    open: false,
    title: "",
    body: "",
    confirmText: "Confirmar",
    danger: false,
    onConfirm: null,
  });

  // Inspector (draft, con aplicar/revertir)
  const [draft, setDraft] = useState(null);
  const draftRef = useRef(null);
  draftRef.current = draft;

  function setStatus(kind, msg) {
    setStatusKind(kind || "");
    setStatusMsg(msg || "—");
  }

  function resolveParentInput(input) {
    if (input == null || input === "") return null;
    // buscar nodo con id coincidente (String)
    const found = nodes.find((n) => String(n.id) === String(input));
    if (found) return found.id;
    // fallback: si input es numérico, devolver número
    const maybe = toNumericOrNull(input);
    return maybe !== null ? maybe : input;
  }
  function markDirty(msg) {
    setDirty(true);
    if (msg) setStatus("warn", msg);
  }

  // Load file
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const data = await getFile(fileId, token);
        if (!alive) return;
        setFile(data);
      } catch (e) {
        if (!alive) return;
        setErr("No se pudo cargar el archivo.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [fileId, token]);

  useEffect(() => {
    if (!file) return;

    // 1) toma lo que venga del backend
    const raw0 = file?.file_json ?? file?.data ?? file ?? {};
    const raw = parseJsonMaybe(raw0);

    // 2) adapta a tu modelo del editor (aunque venga con claves distintas)
    const {
      meta: m,
      intro: i,
      questions: q,
      scales: sc,
      ui: u,
      columns: cols,
      nodes: nds,
      selectedId: sel,
      warning,
    } = adaptEditorPayload(raw, DEFAULT_SCALES);
    const nodesWithCustom = mergeCustomFromRoot(nds, cols);

    //    y luego usa nodesWithCustom en lugar de nds para normalizar IDs:

    setMeta(m || {});
    setIntro(Array.isArray(i) ? i : []);
    setQuestions(q || {});
    setScales(sc || DEFAULT_SCALES);

    // columnas
    setColumns(Array.isArray(cols) ? cols : []);

    // nodos: normaliza IDs a numéricos y ajusta el contador
    let counter = 1;
    const normalizedNodes = (
      Array.isArray(nodesWithCustom) ? nodesWithCustom : []
    ).map((n) => normalizeNodeIds(n, () => counter++));
    const maxId = normalizedNodes.reduce(
      (m, n) => (Number.isFinite(n.id) ? Math.max(m, n.id) : m),
      0
    );
    nextIdRef.current = Math.max(maxId + 1, counter);
    setNodes(normalizedNodes);

    setUi(u || { showMeta: true });
    setSelectedId(sel || null);
    setDirty(false);

    if (warning) {
      setStatus("warn", warning);
    } else {
      setStatus(
        "",
        "Listo. Crea columnas en “Columnas”. Fórmulas se exportan a Excel para que Excel las calcule."
      );
    }
  }, [file]);
  // Selected node
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) || null,
    [nodes, selectedId]
  );

  // Sync draft on selection change
  useEffect(() => {
    if (!selectedNode) {
      setDraft(null);
      return;
    }
    setDraft({
      id: selectedNode.id,
      type: selectedNode.type,
      code: selectedNode.code,
      title: selectedNode.title,
      desc: selectedNode.desc || "",
      parentId: selectedNode.parentId || "",
      viKey: selectedNode.viKey,
      vcKey: selectedNode.vcKey,
      weight: selectedNode.weight,
      required: String(!!selectedNode.required),
      active: String(!!selectedNode.active),
    });
  }, [selectedNode?.id]); // solo al cambiar la selección

  // Tree build
  const byParent = useMemo(() => {
    const map = new Map();
    for (const n of nodes) {
      const pid = n.parentId == null ? "__root__" : String(n.parentId);
      if (!map.has(pid)) map.set(pid, []);
      map.get(pid).push(n);
    }
    for (const arr of map.values())
      arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return map;
  }, [nodes]);

  const roots = useMemo(() => byParent.get("__root__") || [], [byParent]);

  // Filtered table rows
  const deferredSearch = useDeferredValue(search);

  // O(1) lookup for parent labels (stringify to avoid id-type mismatches)
  const nodesById = useMemo(() => {
    const m = new Map();
    for (const n of nodes) m.set(String(n.id), n);
    return m;
  }, [nodes]);

  const sortedNodes = useMemo(() => {
    const arr = [...nodes];
    arr.sort((a, b) => {
      const pa = String(a.parentId ?? "");
      const pb = String(b.parentId ?? "");
      if (pa !== pb) return pa.localeCompare(pb);
      return (a.order ?? 0) - (b.order ?? 0);
    });
    return arr;
  }, [nodes]);

  const filteredRows = useMemo(() => {
    const q = String(deferredSearch || "")
      .trim()
      .toLowerCase();
    if (!q) return sortedNodes;
    return sortedNodes.filter((n) => {
      const blob = `${n.code} ${n.title} ${n.type}`.toLowerCase();
      return blob.includes(q);
    });
  }, [sortedNodes, deferredSearch]);

  function siblingsOf(node) {
    const pid = node?.parentId == null ? "__root__" : String(node.parentId);
    return nodes
      .filter(
        (n) => (n.parentId == null ? "__root__" : String(n.parentId)) === pid
      )
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  function nextOrderForParent(parentId) {
    const pid = parentId == null ? "__root__" : String(parentId);
    const sibs = nodes.filter(
      (n) => (n.parentId == null ? "__root__" : String(n.parentId)) === pid
    );
    const max = sibs.reduce((m, n) => Math.max(m, Number(n.order || 0)), 0);
    return max + 10;
  }

  function isDescendant(nodeId, candidateParentId) {
    if (!candidateParentId) return false;
    const lookup = new Map(nodes.map((r) => [String(r.id), r]));
    let cur = String(candidateParentId);
    const target = String(nodeId);
    while (cur) {
      if (cur === target) return true;
      const n = lookup.get(cur);
      if (!n) break;
      cur = n.parentId == null ? null : String(n.parentId);
    }
    return false;
  }

  function updateNode(id, patch, msg) {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    markDirty(msg);
  }

  function setSelected(id) {
    setSelectedId(id);
  }

  // CRUD nodes (sin prompts; todo editable luego)
  function addNode(type) {
    const selected = nodes.find((n) => n.id === selectedId) || null;

    let parentId = null;
    if (type === TYPES.LEVEL) parentId = null;
    else if (selected) {
      if (selected.type === TYPES.LEVEL || selected.type === TYPES.GROUP)
        parentId = selected.id;
      else parentId = selected.parentId || null;
    }

    const node = {
      id: nextIdRef.current++,
      type,
      code: "",
      title: "",
      desc: "",
      parentId,
      viKey: "VI_3",
      vcKey: "VC_1",
      weight: 1,
      required: true,
      active: true,
      order: nextOrderForParent(parentId),
      custom: {},
    };

    setNodes((prev) => [...prev, node]);
    setSelectedId(node.id);
    markDirty(`Creado: ${type}.`);
  }

  function duplicateSelected() {
    if (!selectedNode) return;
    const copy = deepClone(selectedNode);
    copy.id = nextIdRef.current++;
    copy.code = copy.code ? `${copy.code}_copy` : "";
    copy.title = copy.title ? `${copy.title} (copia)` : "";
    copy.order = nextOrderForParent(copy.parentId);
    setNodes((prev) => [...prev, copy]);
    setSelectedId(copy.id);
    markDirty("Fila duplicada.");
  }

  function deleteCascade(id) {
    const toDelete = new Set();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop();
      toDelete.add(String(cur));
      for (const ch of nodes)
        if (String(ch.parentId) === String(cur)) stack.push(ch.id);
    }
    setNodes((prev) => prev.filter((n) => !toDelete.has(String(n.id))));
    if (selectedId && toDelete.has(String(selectedId))) setSelectedId(null);
    markDirty("Nodo eliminado.");
  }

  function requestDelete(id) {
    const n = nodes.find((x) => x.id === id);
    if (!n) return;
    const children = nodes.filter((x) => x.parentId === id);

    setConfirm({
      open: true,
      title: "Eliminar",
      body:
        children.length > 0
          ? `Este nodo tiene ${children.length} hijo(s).\n\nSe eliminará en cascada (nodo + descendientes).`
          : "Se eliminará este nodo.",
      confirmText: "Eliminar",
      danger: true,
      onConfirm: () => {
        setConfirm((p) => ({ ...p, open: false }));
        deleteCascade(id);
      },
    });
  }

  function moveWithinSiblings(id, dir) {
    const node = nodes.find((n) => n.id === id);
    if (!node) return;

    const sibs = siblingsOf(node);
    const idx = sibs.findIndex((s) => s.id === id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= sibs.length) return;

    const a = sibs[idx];
    const b = sibs[j];

    setNodes((prev) =>
      prev.map((n) => {
        if (n.id === a.id) return { ...n, order: b.order };
        if (n.id === b.id) return { ...n, order: a.order };
        return n;
      })
    );
    markDirty("Orden actualizado.");
  }

  function setParent(id, parentIdInput) {
    const node = nodes.find((n) => n.id === id);
    if (!node) return;

    const pid = resolveParentInput(parentIdInput);

    if (String(pid) === String(id)) {
      setStatus("bad", "No puedes asignar el mismo nodo como padre.");
      return;
    }
    if (isDescendant(id, pid)) {
      setStatus(
        "bad",
        "No permitido: crearías un ciclo (el padre seleccionado es descendiente)."
      );
      return;
    }

    updateNode(
      id,
      { parentId: pid, order: nextOrderForParent(pid) },
      "Padre actualizado."
    );
  }
  // Meta toggle
  function toggleMeta() {
    setUi((p) => ({ ...p, showMeta: !p.showMeta }));
    markDirty();
  }

  // Validate
  function validate() {
    const errors = [];

    // keys de columnas únicas
    const keys = new Set();
    for (const c of columns) {
      if (keys.has(c.key)) errors.push(`Columna con key duplicada: ${c.key}`);
      keys.add(c.key);
    }

    // códigos únicos si existen
    const codes = new Map();
    for (const n of nodes) {
      const c = (n.code || "").trim();
      if (!c) continue;
      if (codes.has(c))
        errors.push(`Código duplicado: "${c}" (${n.title || n.id})`);
      else codes.set(c, n.id);
    }

    // ciclos
    for (const n of nodes) {
      if (n.parentId && isDescendant(n.id, n.parentId)) {
        errors.push(`Jerarquía inválida: ciclo detectado en ${nodeLabel(n)}`);
        break;
      }
    }

    // regla simple: ITEM no puede tener padre ITEM (si quieres mantener el modelo del mock)
    const lookup = new Map(nodes.map((n) => [n.id, n]));
    for (const n of nodes) {
      if (!n.parentId) continue;
      const p = lookup.get(n.parentId);
      if (!p) continue;
      if (n.type === TYPES.ITEM && p.type === TYPES.ITEM) {
        errors.push(
          `Jerarquía inválida: ITEM no puede tener padre ITEM → ${nodeLabel(
            n
          )}.`
        );
      }
    }

    if (errors.length) {
      setStatus(
        "bad",
        errors[0] + (errors.length > 1 ? ` (+${errors.length - 1} más)` : "")
      );
      setConfirm({
        open: true,
        title: "Errores de validación",
        body: `- ${errors.join("\n- ")}`,
        confirmText: "Entendido",
        danger: false,
        onConfirm: () => setConfirm((p) => ({ ...p, open: false })),
      });
      return false;
    }

    setStatus("ok", "Validación OK.");
    return true;
  }

  // Save backend
  async function handleSave() {
    if (!validate()) return;

    setSaving(true);
    try {
      // detecta si el archivo original venía empaquetado en { data: {...} }
      const rawFileJson = parseJsonMaybe(file?.file_json ?? null) || {};
      const hasDataLayer =
        rawFileJson && typeof rawFileJson === "object" && rawFileJson.data;
      const originalHadScales =
        (rawFileJson && rawFileJson.scales) ||
        (rawFileJson && rawFileJson.data && rawFileJson.data.scales);

      // serializa el estado del editor al formato original
      const dataObj = editedToOriginal(
        {
          meta,
          intro,
          questions,
          scales,
          ui,
          columns,
          nodes,
        },
        { preserveScales: !!originalHadScales }
      );

      const payload = {
        file_json: hasDataLayer ? { data: dataObj } : dataObj,
      };

      const updated = await updateFile(fileId, payload, token);
      setFile(updated);
      setDirty(false);
      setStatus("ok", "Guardado.");
    } catch (e) {
      console.error("save error", e);
      setStatus("bad", "No se pudo guardar (revisa consola).");
    } finally {
      setSaving(false);
    }
  }

  // Export JSON (cliente)
  function handleExportJson() {
    // exporta en la forma original (envuelta en { data: ... } para compatibilidad)
    const dataObj = editedToOriginal(
      {
        meta,
        intro,
        questions,
        scales,
        ui,
        columns,
        nodes,
      },
      { preserveScales: !!scales } // opcional: incluye scales si existen en el editor
    );

    // Mantener la envoltura { data: ... } para que sea idéntico a formato original mostrado en tu ejemplo
    downloadJSON(`${safeFilename(file?.name || "checklist")}.json`, {
      data: dataObj,
    });
    setStatus("ok", "Exportado a JSON.");
  }

  // Export Excel (backend)
  // Reemplaza la función handleExportExcel existente por esta versión.
  async function handleExportExcel() {
    try {
      // Si hay cambios locales, intenta guardarlos antes de exportar
      if (dirty) {
        setStatus("warn", "Guardando cambios antes de exportar…");

        // Llama a handleSave (que hace validate() y guarda). Esperamos su fin.
        try {
          await handleSave();
        } catch (err) {
          // handleSave maneja errores y setea status; aquí no hacemos más.
        }

        // Si sigue habiendo cambios (dirty === true) abortamos la exportación.
        if (dirty) {
          setStatus(
            "bad",
            "Exportación cancelada: primero corrige los errores y guarda los cambios."
          );
          return;
        }
      }

      setStatus("warn", "Exportando Excel…");
      const blob = await downloadFileXlsx(fileId, token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeFilename(file?.name || "checklist")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus("ok", "Excel exportado.");
    } catch (e) {
      console.error("excel export error", e);
      setStatus("bad", "No se pudo exportar Excel (revisa consola).");
    }
  }

  // Inspector apply/revert
  function applyInspector() {
    if (!draft || !selectedNode) return;

    const newParentId = resolveParentInput(draft.parentId);

    if (String(newParentId) === String(selectedNode.id)) {
      setStatus("bad", "No puedes asignar el mismo nodo como padre.");
      return;
    }
    if (isDescendant(selectedNode.id, newParentId)) {
      setStatus(
        "bad",
        "No permitido: crearías un ciclo (el padre seleccionado es descendiente)."
      );
      return;
    }

    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== selectedNode.id) return n;
        const parentChanged =
          String(n.parentId || "") !== String(newParentId || "");
        return {
          ...n,
          type: draft.type,
          code: String(draft.code || "").trim(),
          title: String(draft.title || "").trim(),
          desc: String(draft.desc || ""),
          viKey: draft.viKey,
          vcKey: draft.vcKey,
          weight: Number(draft.weight || 0),
          parentId: newParentId,
          order: parentChanged ? nextOrderForParent(newParentId) : n.order,
          required: draft.required === "true",
          active: draft.active === "true",
        };
      })
    );

    markDirty("Cambios aplicados (inspector).");
  }

  function revertInspector() {
    if (!selectedNode) return;
    setDraft({
      id: selectedNode.id,
      type: selectedNode.type,
      code: selectedNode.code,
      title: selectedNode.title,
      desc: selectedNode.desc || "",
      parentId: selectedNode.parentId || "",
      viKey: selectedNode.viKey,
      vcKey: selectedNode.vcKey,
      weight: selectedNode.weight,
      required: String(!!selectedNode.required),
      active: String(!!selectedNode.active),
    });
    setStatus("warn", "Inspector revertido.");
  }

  // Inspector extra fields (custom columns)
  function setCustomValue(nodeId, key, value) {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== nodeId) return n;
        const custom = { ...(n.custom || {}) };
        custom[key] = value;
        return { ...n, custom };
      })
    );
    markDirty();
  }

  // Meta update
  function updateMeta(key, value) {
    setMeta((prev) => ({ ...prev, [key]: value }));
    markDirty();
  }

  // Meta keys order (dinámico)
  const metaKeys = useMemo(() => {
    const keys = Object.keys(meta || {});
    const order = [
      "name",
      "email",
      "company",
      "company_current",
      "industry",
      "size",
      "experience",
    ];
    const ordered = order.filter((k) => keys.includes(k));
    const rest = keys.filter((k) => !order.includes(k)).sort();
    return [...ordered, ...rest];
  }, [meta]);

  // Allowed parents (LEVEL/GROUP)
  const allowedParents = useMemo(() => {
    return nodes
      .filter((n) => n.type === TYPES.LEVEL || n.type === TYPES.GROUP)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [nodes]);

  // Render tree recursively

  const selectionPill = selectedNode
    ? `Selección: ${nodeLabel(selectedNode)}`
    : "Selección: —";
  const docPill = dirty ? "Documento: Borrador*" : "Documento: Guardado";

  const headerBase = baseHeaderDefs();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.topbar}>
          <div className={styles.brand}>
            <div className={styles.logo} />
            <div>
              <div className={styles.title}>Checklist v2 — Editor</div>
              <div className={styles.subtitle}>
                Plantilla editable • Columnas dinámicas • Fórmulas para export
              </div>
            </div>
          </div>

          <span className={styles.pill}>{docPill}</span>
          <span className={styles.pill}>{selectionPill}</span>

          <div className={styles.grow} />

          <button
            className={styles.btn}
            onClick={validate}
            type="button"
            disabled={loading || !!err}
          >
            Validar
          </button>
          <button
            className={styles.btn}
            onClick={handleSave}
            type="button"
            disabled={loading || !!err || saving || !dirty}
            title={!dirty ? "No hay cambios" : "Guardar en backend"}
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
          <button
            className={`${styles.btn} ${styles.secondary}`}
            onClick={handleExportExcel}
            type="button"
            disabled={loading || !!err}
          >
            Exportar Excel
          </button>
          <button
            className={`${styles.btn} ${styles.primary}`}
            onClick={handleExportJson}
            type="button"
            disabled={loading || !!err}
          >
            Exportar JSON
          </button>

          <div className={styles.userbox} title="Usuario">
            <div className={styles.avatar}>
              {(user?.name?.[0] || user?.email?.[0] || "U").toUpperCase()}
            </div>
            <div className={styles.usermeta}>
              <div className={styles.username}>{user?.name || "Usuario"}</div>
              <div className={styles.userrole}>
                {user?.role ? `${user.role}` : "—"}
              </div>
            </div>
          </div>

          <button
            className={`${styles.btn} ${styles.tiny}`}
            onClick={() => navigate(-1)}
            type="button"
          >
            ← Volver
          </button>
        </div>
      </header>

      <main className={styles.layout}>
        {/* LEFT: Tree */}
        <section className={styles.panel} aria-label="Árbol">
          <div className={styles.panelHeader}>Estructura</div>

          <div className={styles.treeActions}>
            <button
              className={styles.btn}
              onClick={() => addNode(TYPES.GROUP)}
              type="button"
            >
              + Agrupación
            </button>
            <button
              className={styles.btn}
              onClick={() => addNode(TYPES.ITEM)}
              type="button"
            >
              + Ítem
            </button>
            <button
              className={`${styles.btn} ${styles.danger}`}
              onClick={() => selectedId && requestDelete(selectedId)}
              type="button"
              disabled={!selectedId}
            >
              Eliminar
            </button>
          </div>

          <div className={`${styles.panelBody} ${styles.compact}`}>
            {loading ? (
              <div className={styles.hint}>Cargando…</div>
            ) : err ? (
              <div className={styles.hint} style={{ color: "var(--bad)" }}>
                {err}
              </div>
            ) : (
              <ul className={styles.tree}>
                {roots.map((n) => (
                  <TreeNode
                    key={n.id}
                    node={n}
                    byParent={byParent}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* CENTER: Meta + Table */}
        <section className={styles.panel} aria-label="Tabla">
          <div className={styles.panelHeaderRow}>
            <span>Checklist v2</span>
            <button
              className={`${styles.btn} ${styles.tiny}`}
              onClick={() => setColsOpen(true)}
              type="button"
            >
              Columnas
            </button>
          </div>

          {/* Meta toggle + card (dinámico) */}
          <div className={styles.metaWrap}>
            <div className={styles.metaTogglebar}>
              <div className={styles.metaLeft}>
                <button
                  className={styles.bullet}
                  onClick={toggleMeta}
                  type="button"
                  title="Ocultar/mostrar"
                >
                  •
                </button>
                <div>
                  <div className={styles.metaTitle}>Preguntas iniciales</div>
                  <div className={styles.subtitle} style={{ margin: 0 }}>
                    Oculta esto para ver solo estructura
                  </div>
                </div>
              </div>
              <span className={styles.pill}>
                {ui?.showMeta ? "Visible" : "Oculto"}
              </span>
            </div>

            {ui?.showMeta ? (
              <div className={styles.metaCard}>
                {intro?.length ? (
                  <div className={styles.metaIntro}>
                    {intro.map((p, i) => (
                      <div key={i} className={styles.metaP}>
                        {p}
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className={styles.metaGrid}>
                  {metaKeys.length === 0 ? (
                    <div className={styles.hint}>
                      No hay metadatos en el JSON.
                    </div>
                  ) : (
                    metaKeys.map((k) => (
                      <label key={k} className={styles.field}>
                        <div className={styles.label}>{labelize(k)}</div>
                        <input
                          className={styles.cellInput}
                          value={meta?.[k] ?? ""}
                          onChange={(e) => updateMeta(k, e.target.value)}
                        />
                        {questions?.[`${k}_help`] ? (
                          <div className={styles.hint}>
                            {questions[`${k}_help`]}
                          </div>
                        ) : null}
                      </label>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {/* Table toolbar */}
          <div className={styles.tableToolbar}>
            <input
              className={styles.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por código, enunciado o tipo…"
            />
            <button
              className={styles.btn}
              onClick={() => addNode(TYPES.ITEM)}
              type="button"
            >
              + Fila
            </button>
            <button
              className={styles.btn}
              onClick={duplicateSelected}
              type="button"
              disabled={!selectedId}
            >
              Duplicar
            </button>
            <button
              className={`${styles.btn} ${styles.danger}`}
              onClick={() => selectedId && requestDelete(selectedId)}
              type="button"
              disabled={!selectedId}
            >
              Eliminar fila
            </button>
          </div>

          {/* Table */}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {headerBase.map((h) => (
                    <th
                      key={h.key}
                      style={h.width ? { width: h.width } : undefined}
                    >
                      {h.label}
                    </th>
                  ))}

                  {columns.map((c) => (
                    <th key={c.id} style={{ width: 160 }}>
                      {c.type === "formula" ? `ƒ ${c.label}` : c.label}
                    </th>
                  ))}

                  <th style={{ width: 170 }}>Acciones</th>
                </tr>
              </thead>

              <tbody>
                {filteredRows.map((n) => {
                  const isSel = n.id === selectedId;
                  const parent = n.parentId
                    ? nodesById.get(String(n.parentId))
                    : null;

                  return (
                    <tr
                      key={n.id}
                      className={isSel ? styles.rowSelected : ""}
                      onClick={() => setSelected(n.id)}
                    >
                      {/* CODE */}
                      <td>
                        {isSel ? (
                          <input
                            className={styles.cellInput}
                            value={n.code || ""}
                            placeholder="Código"
                            onChange={(e) =>
                              updateNode(
                                n.id,
                                { code: e.target.value },
                                undefined
                              )
                            }
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <div className={styles.cellText}>{n.code || "—"}</div>
                        )}
                      </td>

                      {/* TITLE */}
                      <td>
                        {isSel ? (
                          <input
                            className={styles.cellInput}
                            value={n.title || ""}
                            placeholder="Enunciado"
                            onChange={(e) =>
                              updateNode(
                                n.id,
                                { title: e.target.value },
                                undefined
                              )
                            }
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <div
                            className={`${styles.cellText} ${styles.cellTextMultiline}`}
                          >
                            {n.title || "—"}
                          </div>
                        )}
                      </td>

                      {/* TYPE */}
                      <td>
                        {isSel ? (
                          <select
                            className={styles.cellSelect}
                            value={n.type}
                            onChange={(e) =>
                              updateNode(
                                n.id,
                                { type: e.target.value },
                                "Tipo actualizado."
                              )
                            }
                            onClick={(e) => e.stopPropagation()}
                          >
                            <option value={TYPES.GROUP}>GROUP</option>
                            <option value={TYPES.ITEM}>ITEM</option>
                          </select>
                        ) : (
                          <div className={styles.cellText}>{n.type}</div>
                        )}
                      </td>

                      {/* PARENT */}
                      <td>
                        {isSel ? (
                          <select
                            className={styles.cellSelect}
                            value={n.parentId || ""}
                            onChange={(e) =>
                              setParent(n.id, e.target.value || null)
                            }
                            onClick={(e) => e.stopPropagation()}
                          >
                            <option value="">— (sin padre)</option>
                            {allowedParents
                              .filter((p) => p.id !== n.id)
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.type}: {nodeLabel(p)}
                                </option>
                              ))}
                          </select>
                        ) : (
                          <div className={styles.cellText}>
                            {parent
                              ? `${parent.type}: ${nodeLabel(parent)}`
                              : "—"}
                          </div>
                        )}
                      </td>

                      {/* VI/VC readonly */}
                      <td>
                        <div className={styles.mutedCell}>
                          {viLabel(scales, n.viKey) || "—"}
                        </div>
                      </td>
                      <td>
                        <div className={styles.mutedCell}>
                          {String(viValue(scales, n.viKey) ?? "") || "—"}
                        </div>
                      </td>
                      <td>
                        <div className={styles.mutedCell}>
                          {vcLabel(scales, n.vcKey) || "—"}
                        </div>
                      </td>
                      <td>
                        <div className={styles.mutedCell}>
                          {String(vcValue(scales, n.vcKey) ?? "") || "—"}
                        </div>
                      </td>

                      {/* PESO */}
                      <td>
                        {isSel ? (
                          <input
                            className={`${styles.cellInput} ${styles.mini}`}
                            type="number"
                            step="0.1"
                            value={String(n.weight ?? 1)}
                            onChange={(e) =>
                              updateNode(
                                n.id,
                                { weight: Number(e.target.value || 0) },
                                undefined
                              )
                            }
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <div className={styles.cellText}>
                            {String(n.weight ?? 1)}
                          </div>
                        )}
                      </td>

                      {/* REQ */}
                      <td>
                        {isSel ? (
                          <select
                            className={`${styles.cellSelect} ${styles.mini}`}
                            value={String(!!n.required)}
                            onChange={(e) =>
                              updateNode(
                                n.id,
                                { required: e.target.value === "true" },
                                undefined
                              )
                            }
                            onClick={(e) => e.stopPropagation()}
                          >
                            <option value="true">Sí</option>
                            <option value="false">No</option>
                          </select>
                        ) : (
                          <div className={styles.cellText}>
                            {n.required ? "Sí" : "No"}
                          </div>
                        )}
                      </td>

                      {/* ACTIVO */}
                      <td>
                        {isSel ? (
                          <select
                            className={`${styles.cellSelect} ${styles.mini}`}
                            value={String(!!n.active)}
                            onChange={(e) =>
                              updateNode(
                                n.id,
                                { active: e.target.value === "true" },
                                undefined
                              )
                            }
                            onClick={(e) => e.stopPropagation()}
                          >
                            <option value="true">Sí</option>
                            <option value="false">No</option>
                          </select>
                        ) : (
                          <div className={styles.cellText}>
                            {n.active === false ? "No" : "Sí"}
                          </div>
                        )}
                      </td>

                      {/* CUSTOM COLUMNS */}
                      {columns.map((c) => {
                        if (!isApplicable(c, n)) {
                          return (
                            <td key={c.id}>
                              <div className={styles.mutedCell}>—</div>
                            </td>
                          );
                        }

                        if (c.type === "formula") {
                          return (
                            <td key={c.id}>
                              <div className={styles.formulaChip}>
                                ƒ <b>{c.key}</b>{" "}
                                <span>{c.formula || "(sin fórmula)"}</span>
                              </div>
                            </td>
                          );
                        }

                        const val = n.custom?.[c.key];
                        const isEditableCell = isSel && c.editable !== false;
                        if (!isEditableCell) {
                          const display = (() => {
                            if (val === null || val === undefined || val === "")
                              return "—";
                            if (c.type === "boolean") {
                              const b = val === true || val === "true";
                              return b ? "Sí" : "No";
                            }
                            return String(val);
                          })();
                          return (
                            <td key={c.id}>
                              <div className={styles.cellText}>{display}</div>
                            </td>
                          );
                        }

                        if (c.type === "select") {
                          return (
                            <td key={c.id}>
                              <select
                                className={styles.cellSelect}
                                value={val ?? ""}
                                onChange={(e) =>
                                  setCustomValue(n.id, c.key, e.target.value)
                                }
                                onClick={(e) => e.stopPropagation()}
                                disabled={c.editable === false}
                              >
                                <option value="">—</option>
                                {(c.options || []).map((opt) => (
                                  <option key={String(opt)} value={String(opt)}>
                                    {String(opt)}
                                  </option>
                                ))}
                              </select>
                            </td>
                          );
                        }

                        if (c.type === "boolean") {
                          return (
                            <td key={c.id}>
                              <select
                                className={`${styles.cellSelect} ${styles.mini}`}
                                value={String(!!val)}
                                onChange={(e) =>
                                  setCustomValue(
                                    n.id,
                                    c.key,
                                    e.target.value === "true"
                                  )
                                }
                                onClick={(e) => e.stopPropagation()}
                                disabled={c.editable === false}
                              >
                                <option value="true">Sí</option>
                                <option value="false">No</option>
                              </select>
                            </td>
                          );
                        }

                        return (
                          <td key={c.id}>
                            <input
                              className={styles.cellInput}
                              value={val ?? ""}
                              type={c.type === "number" ? "number" : "text"}
                              step={c.type === "number" ? "0.1" : undefined}
                              onChange={(e) => {
                                const raw = e.target.value;
                                const v =
                                  c.type === "number"
                                    ? raw === ""
                                      ? ""
                                      : Number(raw)
                                    : raw;
                                setCustomValue(n.id, c.key, v);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              disabled={c.editable === false}
                            />
                          </td>
                        );
                      })}

                      {/* ACTIONS */}
                      <td
                        className={styles.actionsCol}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          className={styles.iconbtn}
                          title="Subir (entre hermanos)"
                          onClick={() => moveWithinSiblings(n.id, -1)}
                          type="button"
                        >
                          ↑
                        </button>
                        <button
                          className={styles.iconbtn}
                          title="Bajar (entre hermanos)"
                          onClick={() => moveWithinSiblings(n.id, +1)}
                          type="button"
                        >
                          ↓
                        </button>
                        <button
                          className={`${styles.iconbtn} ${styles.iconDanger}`}
                          title="Eliminar"
                          onClick={() => requestDelete(n.id)}
                          type="button"
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={headerBase.length + columns.length + 1}>
                      <div className={styles.hint} style={{ padding: 12 }}>
                        Sin resultados.
                      </div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        {/* RIGHT: Inspector */}
        <section className={styles.panel} aria-label="Inspector">
          <div className={styles.panelHeader}>Inspector</div>

          <div className={styles.panelBody}>
            <div className={styles.hint}>
              Selecciona un nodo del árbol o una fila de la tabla para
              ver/editar detalles.
            </div>

            <div className={styles.hr} />

            {!selectedNode || !draft ? (
              <div className={styles.hint}>No hay selección.</div>
            ) : (
              <>
                <div className={styles.row2}>
                  <div className={styles.field}>
                    <div className={styles.label}>ID</div>
                    <input
                      className={styles.cellInput}
                      value={draft.id}
                      disabled
                    />
                  </div>
                  <div className={styles.field}>
                    <div className={styles.label}>Tipo</div>
                    <select
                      className={styles.cellSelect}
                      value={draft.type}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, type: e.target.value }))
                      }
                    >
                      <option value={TYPES.LEVEL}>LEVEL</option>
                      <option value={TYPES.GROUP}>GROUP</option>
                      <option value={TYPES.ITEM}>ITEM</option>
                    </select>
                  </div>
                </div>

                <div className={styles.field}>
                  <div className={styles.label}>Código</div>
                  <input
                    className={styles.cellInput}
                    value={draft.code}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, code: e.target.value }))
                    }
                    placeholder="Ej: UX-01"
                  />
                </div>

                <div className={styles.field}>
                  <div className={styles.label}>Enunciado / Nombre</div>
                  <input
                    className={styles.cellInput}
                    value={draft.title}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, title: e.target.value }))
                    }
                    placeholder="Texto visible del criterio o agrupación"
                  />
                </div>

                <div className={styles.row2}>
                  <div className={styles.field}>
                    <div className={styles.label}>Escala VI</div>
                    <select
                      className={styles.cellSelect}
                      value={draft.viKey}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, viKey: e.target.value }))
                      }
                    >
                      {(scales?.VI || DEFAULT_SCALES.VI).map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.field}>
                    <div className={styles.label}>Escala VC</div>
                    <select
                      className={styles.cellSelect}
                      value={draft.vcKey}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, vcKey: e.target.value }))
                      }
                    >
                      {(scales?.VC || DEFAULT_SCALES.VC).map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className={styles.row2}>
                  <div className={styles.field}>
                    <div className={styles.label}>Peso</div>
                    <input
                      className={styles.cellInput}
                      type="number"
                      step="0.1"
                      value={String(draft.weight ?? 1)}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, weight: e.target.value }))
                      }
                    />
                  </div>
                  <div className={styles.field}>
                    <div className={styles.label}>Padre</div>
                    <select
                      className={styles.cellSelect}
                      value={draft.parentId}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, parentId: e.target.value }))
                      }
                    >
                      <option value="">— (sin padre)</option>
                      {allowedParents
                        .filter((p) => p.id !== selectedNode.id)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.type}: {nodeLabel(p)}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div className={styles.row2}>
                  <div className={styles.field}>
                    <div className={styles.label}>Requerido</div>
                    <select
                      className={styles.cellSelect}
                      value={draft.required}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, required: e.target.value }))
                      }
                    >
                      <option value="true">Sí</option>
                      <option value="false">No</option>
                    </select>
                  </div>
                  <div className={styles.field}>
                    <div className={styles.label}>Activo</div>
                    <select
                      className={styles.cellSelect}
                      value={draft.active}
                      onChange={(e) =>
                        setDraft((p) => ({ ...p, active: e.target.value }))
                      }
                    >
                      <option value="true">Sí</option>
                      <option value="false">No</option>
                    </select>
                  </div>
                </div>

                <div className={styles.field}>
                  <div className={styles.label}>Descripción / Ayuda</div>
                  <textarea
                    className={styles.cellInput}
                    value={draft.desc}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, desc: e.target.value }))
                    }
                    placeholder="Texto largo, ejemplos, guía para el evaluador…"
                  />
                </div>

                <div className={styles.inlineActions}>
                  <button
                    className={`${styles.btn} ${styles.primary}`}
                    onClick={applyInspector}
                    type="button"
                  >
                    Aplicar cambios
                  </button>
                  <button
                    className={styles.btn}
                    onClick={revertInspector}
                    type="button"
                  >
                    Revertir
                  </button>
                </div>

                <div className={styles.sectionTitle}>Campos adicionales</div>

                <div>
                  {columns.length === 0 ? (
                    <div className={styles.hint}>
                      No hay columnas personalizadas todavía.
                    </div>
                  ) : (
                    <>
                      {columns
                        .filter((c) => isApplicable(c, selectedNode))
                        .map((c) => {
                          if (c.type === "formula") {
                            return (
                              <div key={c.id} className={styles.field}>
                                <div className={styles.label}>
                                  {c.label} (formula)
                                </div>
                                <div className={styles.formulaChip}>
                                  ƒ <b>{c.key}</b>{" "}
                                  <span>{c.formula || "(sin fórmula)"}</span>
                                </div>
                              </div>
                            );
                          }

                          const val = selectedNode.custom?.[c.key];

                          if (c.type === "select") {
                            return (
                              <div key={c.id} className={styles.field}>
                                <div className={styles.label}>
                                  {c.label} (select)
                                </div>
                                <select
                                  className={styles.cellSelect}
                                  value={val ?? ""}
                                  onChange={(e) =>
                                    setCustomValue(
                                      selectedNode.id,
                                      c.key,
                                      e.target.value
                                    )
                                  }
                                  disabled={c.editable === false}
                                >
                                  <option value="">—</option>
                                  {(c.options || []).map((opt) => (
                                    <option
                                      key={String(opt)}
                                      value={String(opt)}
                                    >
                                      {String(opt)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            );
                          }

                          if (c.type === "boolean") {
                            return (
                              <div key={c.id} className={styles.field}>
                                <div className={styles.label}>
                                  {c.label} (boolean)
                                </div>
                                <select
                                  className={`${styles.cellSelect} ${styles.mini}`}
                                  value={String(!!val)}
                                  onChange={(e) =>
                                    setCustomValue(
                                      selectedNode.id,
                                      c.key,
                                      e.target.value === "true"
                                    )
                                  }
                                  disabled={c.editable === false}
                                >
                                  <option value="true">Sí</option>
                                  <option value="false">No</option>
                                </select>
                              </div>
                            );
                          }

                          return (
                            <div key={c.id} className={styles.field}>
                              <div className={styles.label}>
                                {c.label} ({c.type})
                              </div>
                              <input
                                className={styles.cellInput}
                                value={val ?? ""}
                                type={c.type === "number" ? "number" : "text"}
                                step={c.type === "number" ? "0.1" : undefined}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  const v =
                                    c.type === "number"
                                      ? raw === ""
                                        ? ""
                                        : Number(raw)
                                      : raw;
                                  setCustomValue(selectedNode.id, c.key, v);
                                }}
                                disabled={c.editable === false}
                              />
                            </div>
                          );
                        })}

                      {columns.filter((c) => isApplicable(c, selectedNode))
                        .length === 0 ? (
                        <div className={styles.hint}>
                          No hay columnas aplicables para este tipo de nodo.
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          <div className={styles.log}>
            <div
              className={`${styles.badge} ${
                statusKind ? styles[`badge_${statusKind}`] : ""
              }`}
            >
              {statusKind === "ok"
                ? "OK"
                : statusKind === "warn"
                ? "Atención"
                : statusKind === "bad"
                ? "Error"
                : "Listo"}
            </div>
            <div className={styles.logLine}>{statusMsg}</div>
          </div>
        </section>
      </main>

      <ColumnsModal
        open={colsOpen}
        onClose={() => setColsOpen(false)}
        columns={columns}
        setColumns={setColumns}
        nodes={nodes}
        setNodes={setNodes}
        setDirty={setDirty}
        setStatus={setStatus}
      />

      <ConfirmModal
        open={confirm.open}
        title={confirm.title}
        body={confirm.body}
        confirmText={confirm.confirmText}
        danger={confirm.danger}
        onClose={() => setConfirm((p) => ({ ...p, open: false }))}
        onConfirm={() => confirm.onConfirm?.()}
      />
    </div>
  );
}
