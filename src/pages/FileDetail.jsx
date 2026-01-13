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
  const id = maybeId !== null ? maybeId : node.id ?? nextId();

  const p = toNumericOrNull(node.parentId);
  let parentId;
  if (p !== null) {
    parentId = p === 0 ? null : p;
  } else {
    parentId = node.parentId ?? null;
  }

  return { ...node, id, parentId };
}

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

  for (const k of candidates) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }

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
  return s.replace(/\s+/g, " ").replace(/\.+$/g, "");
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

  if (depthHint === 1) return "LEVEL";
  if (hasChildren) return "GROUP";
  return "ITEM";
}

function coerceViKey(scales, raw) {
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
      observaciones:
        getAny(node, ["observaciones", "obs"]) ??
        getByRegex(node, [/observaciones/, /obs/]) ??
        "",
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
  const rawNodes =
    (Array.isArray(payload?.nodes) && payload.nodes) ||
    (Array.isArray(payload?.nodos) && payload.nodos) ||
    (Array.isArray(payload?.items) && payload.items) ||
    null;

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
        observaciones:
          getAny(n, ["observaciones", "obs"]) ??
          getByRegex(n, [/observaciones/, /obs/]) ??
          "",
      };
    });
  } else if (rawTree) {
    nodes = flattenTreeAny(rawTree, scales);
  }

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
          parentId: null,
          viKey: coerceViKey(
            scales,
            getAny(r, ["viKey", "vi", "nivel_importancia", "importancia"])
          ),
          vcKey: coerceVcKey(scales, getAny(r, ["vcKey", "vc", "aplica"])),
          weight: coerceNumber(getAny(r, ["weight", "peso"]), 1),
          required: coerceBool(getAny(r, ["required", "requerido"]), true),
          active: coerceBool(getAny(r, ["active", "activo"]), true),
          order: (idx + 1) * 10,
          observaciones:
            getAny(r, ["observaciones", "obs"]) ??
            getByRegex(r, [/observaciones/, /obs/]) ??
            "",
        };
      });

      nodes = nodes.map((n) => {
        const pc = parentCodeFromCode(n.code);
        if (!pc) return n;
        const pid = mapCodeToId.get(normalizeCode(pc));
        return pid ? { ...n, parentId: pid } : n;
      });
    }
  }

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
    nodes,
    selectedId,
    warning,
  };
}

function mapTypeToOriginal(t) {
  if (!t) return null;
  if (String(t).toUpperCase() === "GROUP") return "G";
  if (String(t).toUpperCase() === "ITEM") return "A";
  if (String(t).toUpperCase() === "LEVEL") return "G";
  return String(t).toUpperCase();
}

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

function editedToOriginal(edited, options = {}) {
  const preserveScales = !!options.preserveScales;

  const metaOut = edited.meta || {};
  const introOut = Array.isArray(edited.intro) ? edited.intro : [];
  const questionsOut = edited.questions || {};
  const uiOut = edited.ui || { showMeta: true };

  const nodesOut = (Array.isArray(edited.nodes) ? edited.nodes : []).map(
    (n) => {
      const idOut = toNumericOrNull(n.id) ?? n.id;
      const code = String(n.code ?? n.codigo ?? "").trim();
      const [p1, p2, p3, p4, p5] = parseHierarchyParts(code);

      const agrup_es =
        n.agrupacion_es ??
        findField(n, [
          "agrupacion_es",
          "agrupación_es",
          "agrupacion_español",
        ]) ??
        null;

      const observaciones =
        n.observaciones ?? findField(n, ["observaciones", "obs"]) ?? null;

      const nivel_aplicacion =
        n.nivel_aplicacion ??
        findField(n, ["nivel_aplicacion", "nivel_aplicación"]) ??
        null;

      const nivel_importancia =
        n.nivel_importancia ??
        findField(n, ["nivel_importancia", "nivel_importancia"]) ??
        null;

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
        parent: parentOut,
      };
    }
  );

  const out = {
    meta: metaOut,
    intro: introOut,
    questions: questionsOut,
    ui: uiOut,
    nodes: nodesOut,
  };

  if (preserveScales && edited.scales) {
    out.scales = edited.scales;
  } else if (!preserveScales && edited.scales) {
    out.scales = edited.scales;
  }

  return out;
}

/** Helpers escalas (pestaña Configuración) */

function nextScaleKey(prefix, existing) {
  const base = prefix.toUpperCase();
  const nums = existing
    .map((s) => Number(s.value))
    .filter((n) => Number.isFinite(n));
  const max = nums.length ? Math.max(...nums) : 0;
  const next = max + 1;
  return `${base}_${String(next).replace(".", "").replace(",", "")}`;
}

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

export default function FileDetail() {
  const { fileId } = useParams();
  const navigate = useNavigate();
  const { token } = useContext(AuthContext);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [file, setFile] = useState(null);

  const [meta, setMeta] = useState({});
  const [intro, setIntro] = useState([]);
  const [questions, setQuestions] = useState({});
  const [scales, setScales] = useState(DEFAULT_SCALES);
  const [nodes, setNodes] = useState([]);
  const [ui, setUi] = useState({ showMeta: true });
  const nextIdRef = useRef(1);

  const [selectedId, setSelectedId] = useState(null);
  const [search] = useState(""); // búsqueda ya no visible en la UI de plantilla
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [statusKind, setStatusKind] = useState("");
  const [statusMsg, setStatusMsg] = useState("—");

  const [confirm, setConfirm] = useState({
    open: false,
    title: "",
    body: "",
    confirmText: "Confirmar",
    danger: false,
    onConfirm: null,
  });

  const [draft, setDraft] = useState(null);
  const draftRef = useRef(null);
  draftRef.current = draft;

  // pestaña activa
  const [activeTab, setActiveTab] = useState("presentation"); // 'presentation' | 'config' | 'template'

  function setStatus(kind, msg) {
    setStatusKind(kind || "");
    setStatusMsg(msg || "—");
  }

  function resolveParentInput(input) {
    if (input == null || input === "") return null;
    const found = nodes.find((n) => String(n.id) === String(input));
    if (found) return found.id;
    const maybe = toNumericOrNull(input);
    return maybe !== null ? maybe : input;
  }
  function markDirty(msg) {
    setDirty(true);
    if (msg) setStatus("warn", msg);
  }

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

    const raw0 = file?.file_json ?? file?.data ?? file ?? {};
    const raw = parseJsonMaybe(raw0);

    const {
      meta: m,
      intro: i,
      questions: q,
      scales: sc,
      ui: u,
      nodes: nds,
      selectedId: sel,
      warning,
    } = adaptEditorPayload(raw, DEFAULT_SCALES);

    setMeta(m || {});
    setIntro(Array.isArray(i) ? i : []);
    setQuestions(q || {});
    setScales(sc || DEFAULT_SCALES);

    let counter = 1;
    const normalizedNodes = (Array.isArray(nds) ? nds : []).map((n) =>
      normalizeNodeIds(n, () => counter++)
    );
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
      setStatus("", "Editor listo.");
    }
  }, [file]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) || null,
    [nodes, selectedId]
  );

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
      observaciones: selectedNode.observaciones || "",
    });
  }, [selectedNode?.id]);

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

  const deferredSearch = useDeferredValue(search);

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
      observaciones: "",
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

  function toggleMeta() {
    setUi((p) => ({ ...p, showMeta: !p.showMeta }));
    markDirty();
  }

  function validate() {
    const errors = [];

    const codes = new Map();
    for (const n of nodes) {
      const c = (n.code || "").trim();
      if (!c) continue;
      if (codes.has(c))
        errors.push(`Código duplicado: "${c}" (${n.title || n.id})`);
      else codes.set(c, n.id);
    }

    for (const n of nodes) {
      if (n.parentId && isDescendant(n.id, n.parentId)) {
        errors.push(`Jerarquía inválida: ciclo detectado en ${nodeLabel(n)}`);
        break;
      }
    }

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

  async function handleSave() {
    if (!validate()) return;

    setSaving(true);
    try {
      const rawFileJson = parseJsonMaybe(file?.file_json ?? null) || {};
      const hasDataLayer =
        rawFileJson && typeof rawFileJson === "object" && rawFileJson.data;
      const originalHadScales =
        (rawFileJson && rawFileJson.scales) ||
        (rawFileJson && rawFileJson.data && rawFileJson.data.scales);

      const dataObj = editedToOriginal(
        {
          meta,
          intro,
          questions,
          scales,
          ui,
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

  function handleExportJson() {
    const dataObj = editedToOriginal(
      {
        meta,
        intro,
        questions,
        scales,
        ui,
        nodes,
      },
      { preserveScales: !!scales }
    );

    downloadJSON(`${safeFilename(file?.name || "checklist")}.json`, {
      data: dataObj,
    });
    setStatus("ok", "Exportado a JSON.");
  }

  async function handleExportExcel() {
    try {
      if (dirty) {
        setStatus("warn", "Guardando cambios antes de exportar…");
        try {
          await handleSave();
        } catch (err) {}
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
          observaciones: draft.observaciones || "",
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
      observaciones: selectedNode.observaciones || "",
    });
    setStatus("warn", "Inspector revertido.");
  }

  function updateMeta(key, value) {
    setMeta((prev) => ({ ...prev, [key]: value }));
    markDirty();
  }

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

  const allowedParents = useMemo(() => {
    return nodes
      .filter((n) => n.type === TYPES.LEVEL || n.type === TYPES.GROUP)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [nodes]);

  const selectionPill = selectedNode
    ? `Selección: ${nodeLabel(selectedNode)}`
    : "Selección: —";
  const docPill = dirty ? "Documento: Borrador*" : "Documento: Guardado";

  const headerBase = baseHeaderDefs();

  function updateScale(kind, index, field, value) {
    setScales((prev) => {
      const list = [...(prev?.[kind] || [])];
      const item = { ...list[index], [field]: value };
      if (field === "value") {
        const n = Number(value);
        item.value = Number.isFinite(n) ? n : "";
      }
      const others = list.filter((_, i) => i !== index);
      const existsSameValue = others.some((s) => s.value === item.value);
      if (!existsSameValue && typeof item.value === "number") {
        const base = kind.toUpperCase();
        item.key = `${base}_${String(item.value)
          .replace(".", "")
          .replace(",", "")}`;
      }
      list[index] = item;
      return { ...prev, [kind]: list };
    });
    markDirty();
  }

  function addScaleRow(kind) {
    setScales((prev) => {
      const list = prev?.[kind] || [];
      const key = nextScaleKey(kind, list);
      const next = [
        ...list,
        { key, label: "Nueva opción", value: list.length + 1 },
      ];
      return { ...prev, [kind]: next };
    });
    markDirty("Añadida opción de escala.");
  }

  function removeScaleRow(kind, index) {
    setScales((prev) => {
      const list = [...(prev?.[kind] || [])];
      list.splice(index, 1);
      return { ...prev, [kind]: list };
    });
    markDirty("Eliminada opción de escala.");
  }

  const derivedName = file?.name || "Checklist";

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.topbar}>
          <div className={styles.brand}>
            <div className={styles.logo} />
            <div>
              <div className={styles.title}>{derivedName}</div>
              <div className={styles.subtitle}>
                Presentación • Configuración • Plantilla
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

          <button
            className={`${styles.btn} ${styles.tiny}`}
            onClick={() => navigate(-1)}
            type="button"
          >
            ← Volver
          </button>
        </div>

        {/* TABS */}
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${
              activeTab === "presentation" ? styles.tabActive : ""
            }`}
            onClick={() => setActiveTab("presentation")}
          >
            1. Presentación
          </button>
          <button
            type="button"
            className={`${styles.tab} ${
              activeTab === "config" ? styles.tabActive : ""
            }`}
            onClick={() => setActiveTab("config")}
          >
            2. Configuración VI/VC
          </button>
          <button
            type="button"
            className={`${styles.tab} ${
              activeTab === "template" ? styles.tabActive : ""
            }`}
            onClick={() => setActiveTab("template")}
          >
            3. Plantilla
          </button>
        </div>
      </header>

      {/* PRESENTACIÓN */}
      {activeTab === "presentation" && (
        <main className={styles.presentation}>
          <section className={styles.panelWide}>
            <h2 className={styles.sectionTitle}>Presentación</h2>

            {intro?.length ? (
              <div className={styles.metaIntro}>
                {intro.map((p, i) => (
                  <div key={i} className={styles.metaP}>
                    {p}
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.hint}>
                No hay texto de introducción definido en el JSON.
              </div>
            )}

            <div className={styles.sectionTitle} style={{ marginTop: 24 }}>
              Preguntas para el usuario
            </div>
            <div className={styles.metaGrid}>
              {metaKeys.length === 0 ? (
                <div className={styles.hint}>No hay metadatos en el JSON.</div>
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
          </section>
        </main>
      )}

      {/* CONFIGURACIÓN VI/VC */}
      {activeTab === "config" && (
        <main className={styles.configLayout}>
          <section className={styles.panelWide}>
            <h2 className={styles.sectionTitle}>Escalas VI</h2>
            <p className={styles.hint}>
              Edita las opciones de importancia (VI). Puedes añadir opciones
              como “Aplica mucho” con valor 4, cambiar textos o eliminar filas.
            </p>

            <table className={styles.scaleTable}>
              <thead>
                <tr>
                  <th>Etiqueta visible</th>
                  <th>Valor numérico</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(scales?.VI || []).map((s, idx) => (
                  <tr key={s.key || idx}>
                    <td>
                      <input
                        className={styles.cellInput}
                        value={s.label || ""}
                        onChange={(e) =>
                          updateScale("VI", idx, "label", e.target.value)
                        }
                      />
                    </td>
                    <td>
                      <input
                        className={`${styles.cellInput} ${styles.mini}`}
                        type="number"
                        step="1"
                        value={String(s.value ?? "")}
                        onChange={(e) =>
                          updateScale("VI", idx, "value", e.target.value)
                        }
                      />
                    </td>
                    <td className={styles.actionsCol}>
                      <button
                        type="button"
                        className={`${styles.iconbtn} ${styles.iconDanger}`}
                        onClick={() => removeScaleRow("VI", idx)}
                        title="Eliminar opción"
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                ))}
                {(!scales?.VI || scales.VI.length === 0) && (
                  <tr>
                    <td colSpan={3}>
                      <div className={styles.hint}>
                        No hay opciones definidas para VI.
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <button
              type="button"
              className={`${styles.btn} ${styles.primary}`}
              onClick={() => addScaleRow("VI")}
              style={{ marginTop: 8 }}
            >
              + Añadir opción VI
            </button>
          </section>

          <section className={styles.panelWide}>
            <h2 className={styles.sectionTitle}>Escalas VC</h2>
            <p className={styles.hint}>
              Edita las opciones de aplicación (VC). Ejemplo: “Aplica mucho” con
              valor 4.
            </p>

            <table className={styles.scaleTable}>
              <thead>
                <tr>
                  <th>Etiqueta visible</th>
                  <th>Valor numérico</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(scales?.VC || []).map((s, idx) => (
                  <tr key={s.key || idx}>
                    <td>
                      <input
                        className={styles.cellInput}
                        value={s.label || ""}
                        onChange={(e) =>
                          updateScale("VC", idx, "label", e.target.value)
                        }
                      />
                    </td>
                    <td>
                      <input
                        className={`${styles.cellInput} ${styles.mini}`}
                        type="number"
                        step="1"
                        value={String(s.value ?? "")}
                        onChange={(e) =>
                          updateScale("VC", idx, "value", e.target.value)
                        }
                      />
                    </td>
                    <td className={styles.actionsCol}>
                      <button
                        type="button"
                        className={`${styles.iconbtn} ${styles.iconDanger}`}
                        onClick={() => removeScaleRow("VC", idx)}
                        title="Eliminar opción"
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                ))}
                {(!scales?.VC || scales.VC.length === 0) && (
                  <tr>
                    <td colSpan={3}>
                      <div className={styles.hint}>
                        No hay opciones definidas para VC.
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <button
              type="button"
              className={`${styles.btn} ${styles.primary}`}
              onClick={() => addScaleRow("VC")}
              style={{ marginTop: 8 }}
            >
              + Añadir opción VC
            </button>
          </section>
        </main>
      )}

      {/* PLANTILLA */}
      {activeTab === "template" && (
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

          {/* RIGHT: Inspector */}
          <section className={styles.panel} aria-label="Inspector">
            <div className={styles.panelHeader}>Inspector</div>

            <div className={styles.panelBody}>
              <div className={styles.hint}>
                Selecciona un nodo del árbol para ver/editar detalles.
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
                    <div className={styles.label}>Observaciones</div>
                    <textarea
                      className={styles.cellInput}
                      value={draft.observaciones || ""}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          observaciones: e.target.value,
                        }))
                      }
                      placeholder="Notas, comentarios, contexto adicional…"
                    />
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
      )}

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
