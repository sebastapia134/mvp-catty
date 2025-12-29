import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import styles from "../styles/FileEditor.module.css";
import { AuthContext } from "../context/AuthContext";
import { getFile, saveFileContent } from "../services/files";
import * as XLSX from "xlsx-js-style";

const TYPES = { LEVEL: "LEVEL", GROUP: "GROUP", ITEM: "ITEM" };

const SCALES = {
  VI: [
    { key: "VI_5", label: "Muy importante / Crítico", value: 5 },
    { key: "VI_4", label: "Importante", value: 4 },
    { key: "VI_3", label: "Medianamente importante", value: 3 },
    { key: "VI_2", label: "Poco importante", value: 2 },
    { key: "VI_1", label: "No importante", value: 1 },
  ],
  VC: [
    { key: "VC_1", label: "Aplica", value: 1 },
    { key: "VC_05", label: "Parcialmente", value: 0.5 },
    { key: "VC_0", label: "No aplica", value: 0 },
  ],
};

function normalizeKey(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_]/g, "");
}

function viValue(key) {
  return SCALES.VI.find((x) => x.key === key)?.value ?? "";
}
function vcValue(key) {
  return SCALES.VC.find((x) => x.key === key)?.value ?? "";
}
function viLabel(key) {
  return SCALES.VI.find((x) => x.key === key)?.label ?? "";
}
function vcLabel(key) {
  return SCALES.VC.find((x) => x.key === key)?.label ?? "";
}

function nodeLabel(n) {
  return `${n.code ? `${n.code} — ` : ""}${n.title || "(sin título)"}`;
}

function mkNode({ type, code, title, parentId, viKey, vcKey, weight, order }) {
  return {
    id: crypto.randomUUID(),
    type,
    code: code ?? "",
    title: title ?? "",
    desc: "",
    parentId: parentId ?? null,
    viKey: viKey ?? "VI_3",
    vcKey: vcKey ?? "VC_1",
    weight: weight ?? 1,
    required: true,
    active: true,
    order: order ?? 10,
    custom: {},
  };
}

function mkCol({ label, key, type, appliesTo, editable, options, formula }) {
  return {
    id: crypto.randomUUID(),
    label: (label || "").trim(),
    key: normalizeKey(key || label),
    type,
    appliesTo: appliesTo || "ALL",
    editable: !!editable,
    options: Array.isArray(options) ? options : [],
    formula: formula || "",
  };
}

function seedDoc() {
  const lvl = mkNode({
    type: TYPES.LEVEL,
    code: "N1",
    title: "Usabilidad",
    order: 10,
  });
  const grp = mkNode({
    type: TYPES.GROUP,
    code: "G1",
    title: "Interfaz",
    parentId: lvl.id,
    order: 10,
  });
  const it1 = mkNode({
    type: TYPES.ITEM,
    code: "UX-01",
    title: "La navegación es clara y consistente",
    parentId: grp.id,
    viKey: "VI_4",
    vcKey: "VC_1",
    weight: 1,
    order: 10,
  });

  const cols = [
    mkCol({
      label: "Evidencia (URL)",
      key: "EVIDENCIA_URL",
      type: "text",
      appliesTo: "ITEM",
      editable: true,
    }),
    mkCol({
      label: "Severidad",
      key: "SEVERIDAD",
      type: "select",
      appliesTo: "ITEM",
      editable: true,
      options: ["Alta", "Media", "Baja"],
    }),
    mkCol({
      label: "Puntaje",
      key: "PUNTAJE",
      type: "formula",
      appliesTo: "ITEM",
      editable: false,
      formula: "={VI}*{VC}*{PESO}",
    }),
  ];

  return {
    meta: {
      name: "",
      email: "",
      company: "",
      company_current: "",
      industry: "",
      size: "",
      experience: "",
    },
    nodes: [lvl, grp, it1],
    columns: cols,
    ui: { showMeta: true },
  };
}

function nextOrderForParent(nodes, parentId) {
  const pid = parentId || "__root__";
  const sibs = nodes.filter((n) => (n.parentId || "__root__") === pid);
  const max = sibs.reduce((m, n) => Math.max(m, Number(n.order || 0)), 0);
  return max + 10;
}

function siblingsOf(nodes, node) {
  const pid = node.parentId || "__root__";
  return nodes
    .filter((n) => (n.parentId || "__root__") === pid)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function isApplicable(col, node) {
  return col.appliesTo === "ALL" || col.appliesTo === node.type;
}

function excelColLetter(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function buildExcelPlaceholderMap(headerKeys, rowIndex1Based) {
  const map = {};
  for (let i = 0; i < headerKeys.length; i++) {
    map[headerKeys[i]] = `${excelColLetter(i + 1)}${rowIndex1Based}`;
  }
  map.VI = map.VI || map.VI_VALUE || map.VI;
  map.VC = map.VC || map.VC_VALUE || map.VC;
  map.PESO = map.PESO || map.WEIGHT || map.PESO;
  return map;
}

function applyPlaceholdersToFormula(template, placeholderCellMap) {
  if (!template) return "";
  let f = String(template).trim();
  if (!f.startsWith("=")) f = "=" + f;
  return f.replace(
    /\{([A-Z0-9_]+)\}/g,
    (_, k) => placeholderCellMap[String(k || "").toUpperCase()] ?? `{${k}}`
  );
}

function validateDoc(doc) {
  const errors = [];

  const codes = new Map();
  for (const n of doc.nodes || []) {
    const c = (n.code || "").trim();
    if (!c) continue;
    if (codes.has(c)) errors.push(`Código duplicado: "${c}"`);
    else codes.set(c, n.id);
  }

  for (const n of doc.nodes || []) {
    if (n.parentId && n.parentId === n.id)
      errors.push("Ciclo: un nodo no puede ser padre de sí mismo.");
  }

  const byId = new Map((doc.nodes || []).map((n) => [n.id, n]));
  for (const n of doc.nodes || []) {
    if (!n.parentId) continue;
    const p = byId.get(n.parentId);
    if (!p) continue;
    if (n.type === TYPES.ITEM && p.type === TYPES.ITEM)
      errors.push("Jerarquía inválida: ITEM no puede tener padre ITEM.");
  }

  const keys = new Set();
  for (const c of doc.columns || []) {
    const k = String(c.key || "").toUpperCase();
    if (!k) errors.push("Columna sin key.");
    if (keys.has(k)) errors.push(`Columna con key duplicada: ${k}`);
    keys.add(k);
  }

  return errors;
}

function buildTree(nodes) {
  const byParent = new Map();
  for (const n of nodes || []) {
    const pid = n.parentId || "__root__";
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(n);
  }
  for (const arr of byParent.values())
    arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return { byParent };
}

export default function FileEditor() {
  const { fileId } = useParams();
  const navigate = useNavigate();
  const { user, token } = useContext(AuthContext);

  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [fileMeta, setFileMeta] = useState(null);
  const [doc, setDoc] = useState(seedDoc());
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState("");
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState({ kind: "", msg: "Listo." });

  const [colModalOpen, setColModalOpen] = useState(false);
  const [colEditId, setColEditId] = useState(null);
  const [colForm, setColForm] = useState({
    label: "",
    key: "",
    type: "text",
    appliesTo: "ALL",
    editable: "true",
    options: "",
    formula: "",
  });

  const toastTimer = useRef(null);
  const showToast = (msg) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3200);
  };

  const displayName = user?.full_name || user?.email || "usuario";
  const initials = (displayName || "U").trim().slice(0, 1).toUpperCase();

  const byId = useMemo(
    () => new Map((doc.nodes || []).map((n) => [n.id, n])),
    [doc.nodes]
  );
  const tree = useMemo(() => buildTree(doc.nodes || []), [doc.nodes]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = (doc.nodes || []).filter((n) => {
      if (!q) return true;
      const blob = `${n.code} ${n.title} ${n.type}`.toLowerCase();
      return blob.includes(q);
    });
    return rows.sort((a, b) => {
      const pa = a.parentId || "";
      const pb = b.parentId || "";
      if (pa !== pb) return pa.localeCompare(pb);
      return (a.order ?? 0) - (b.order ?? 0);
    });
  }, [doc.nodes, search]);

  const selected = useMemo(
    () => (selectedId ? byId.get(selectedId) : null),
    [selectedId, byId]
  );

  const markDirty = (msg) => {
    setDirty(true);
    if (msg) setStatus({ kind: "warn", msg });
  };

  const setSelected = (id) => {
    setSelectedId(id);
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await getFile(fileId, token);
      setFileMeta(data);
      const content = data?.content_json || seedDoc();

      const safe = {
        meta: content.meta || seedDoc().meta,
        nodes: Array.isArray(content.nodes)
          ? content.nodes.map((n) => ({ ...n, custom: n.custom || {} }))
          : seedDoc().nodes,
        columns: Array.isArray(content.columns)
          ? content.columns
          : seedDoc().columns,
        ui: content.ui || { showMeta: true },
      };

      setDoc(safe);
      setDirty(false);
      setStatus({ kind: "ok", msg: "Documento cargado." });

      const first = safe.nodes?.[0]?.id || null;
      setSelectedId(first);
    } catch {
      showToast("No se pudo abrir el archivo.");
      navigate("/dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!fileId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  const updateNode = (id, patch) => {
    setDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    }));
    markDirty();
  };

  const updateNodeCustom = (id, key, value) => {
    setDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) =>
        n.id === id
          ? { ...n, custom: { ...(n.custom || {}), [key]: value } }
          : n
      ),
    }));
    markDirty();
  };

  const addNode = (type) => {
    const title = window.prompt(
      type === TYPES.LEVEL
        ? "Nombre del NIVEL:"
        : type === TYPES.GROUP
        ? "Nombre de la AGRUPACIÓN:"
        : "Enunciado del ÍTEM:"
    );
    if (!title) return;

    const code = window.prompt("Código (opcional):", "") || "";

    const selectedNow = selectedId ? byId.get(selectedId) : null;
    let parentId = null;
    if (selectedNow) {
      if (selectedNow.type === TYPES.LEVEL || selectedNow.type === TYPES.GROUP)
        parentId = selectedNow.id;
      else parentId = selectedNow.parentId || null;
    }

    setDoc((prev) => {
      const order = nextOrderForParent(prev.nodes, parentId);
      const node = mkNode({ type, code, title, parentId, order });
      return { ...prev, nodes: [...prev.nodes, node] };
    });

    markDirty(`Creado: ${type}.`);
    window.setTimeout(() => {
      const newest = doc.nodes?.[doc.nodes.length - 1]?.id;
      if (newest) setSelected(newest);
    }, 0);
  };

  const duplicateSelected = () => {
    if (!selected) return;
    const copy = structuredClone(selected);
    copy.id = crypto.randomUUID();
    copy.code = selected.code ? `${selected.code}_copy` : "";
    copy.title = selected.title ? `${selected.title} (copia)` : "";
    copy.order = nextOrderForParent(doc.nodes, copy.parentId);

    setDoc((prev) => ({ ...prev, nodes: [...prev.nodes, copy] }));
    markDirty("Fila duplicada.");
    setSelected(copy.id);
  };

  const deleteNode = (id) => {
    if (!id) return;
    const children = doc.nodes.filter((x) => x.parentId === id);
    if (children.length) {
      showToast("Este nodo tiene hijos. (Por ahora no se elimina en cascada).");
      return;
    }
    setDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== id),
    }));
    if (selectedId === id) setSelectedId(null);
    markDirty("Nodo eliminado.");
  };

  const moveWithinSiblings = (id, dir) => {
    const node = byId.get(id);
    if (!node) return;
    const sibs = siblingsOf(doc.nodes, node);
    const idx = sibs.findIndex((s) => s.id === id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= sibs.length) return;

    const a = sibs[idx];
    const b = sibs[j];

    setDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id === a.id) return { ...n, order: b.order };
        if (n.id === b.id) return { ...n, order: a.order };
        return n;
      }),
    }));
    markDirty("Orden actualizado.");
  };

  const toggleMeta = () => {
    setDoc((prev) => ({
      ...prev,
      ui: { ...(prev.ui || {}), showMeta: !prev.ui?.showMeta },
    }));
    markDirty();
  };

  const onValidate = () => {
    const errors = validateDoc(doc);
    if (errors.length) {
      setStatus({ kind: "bad", msg: errors[0] });
      alert("Errores:\n\n- " + errors.join("\n- "));
      return;
    }
    setStatus({ kind: "ok", msg: "Validación OK." });
  };

  const onSave = async () => {
    const errors = validateDoc(doc);
    if (errors.length) {
      setStatus({ kind: "bad", msg: errors[0] });
      alert("Errores:\n\n- " + errors.join("\n- "));
      return;
    }

    setSaving(true);
    try {
      await saveFileContent(fileId, doc, token);
      setDirty(false);
      setStatus({ kind: "ok", msg: "Guardado." });
      showToast("Guardado.");
    } catch {
      setStatus({ kind: "bad", msg: "No se pudo guardar." });
      showToast("No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  };

  const onExportJson = () => {
    const payload = {
      meta: { exportedAt: new Date().toISOString() },
      scales: SCALES,
      ...doc,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileMeta?.code || "archivo"}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus({ kind: "ok", msg: "Exportado a JSON." });
  };

  const onExportExcel = () => {
    const W = 11;

    const aoa = [];
    const pushMergedRow = (text) => {
      const row = new Array(W).fill("");
      row[0] = text;
      aoa.push(row);
    };

    pushMergedRow(
      "Checklist para evaluación de usabilidad en etapas iniciales de desarrollo de software"
    );
    pushMergedRow(
      "Los datos recopilados mediante este instrumento serán utilizados exclusivamente con fines académicos y de investigación."
    );
    aoa.push(new Array(W).fill(""));

    const form = doc.meta || {};
    const addField = (label, value) => {
      const row = new Array(W).fill("");
      row[0] = label;
      row[1] = value ?? "";
      aoa.push(row);
    };

    addField("Nombre", form.name);
    addField("Correo", form.email);
    addField("Nombre de la empresa", form.company);
    addField("Empresa actual", form.company_current);
    aoa.push(new Array(W).fill(""));
    addField("Industria", form.industry);
    addField("Tamaño", form.size);
    addField("Experiencia (años)", form.experience);
    aoa.push(new Array(W).fill(""));

    const header = new Array(W).fill("");
    header[0] = "Escala de Importancia";
    header[1] = "Valor (VI)";
    header[3] = "Escala de Cumplimiento";
    header[4] = "Valor (VC)";
    aoa.push(header);

    const maxLen = Math.max(SCALES.VI.length, SCALES.VC.length);
    for (let i = 0; i < maxLen; i++) {
      const r = new Array(W).fill("");
      if (SCALES.VI[i]) {
        r[0] = SCALES.VI[i].label;
        r[1] = SCALES.VI[i].value;
      }
      if (SCALES.VC[i]) {
        r[3] = SCALES.VC[i].label;
        r[4] = SCALES.VC[i].value;
      }
      aoa.push(r);
    }

    const wsDatos = XLSX.utils.aoa_to_sheet(aoa);
    wsDatos["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 10 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 10 } },
    ];

    const baseHeaders = [
      { key: "CODE", label: "Código" },
      { key: "TITLE", label: "Enunciado" },
      { key: "TYPE", label: "Tipo" },
      { key: "PARENT_CODE", label: "Padre" },
      { key: "VI_LABEL", label: "VI (texto)" },
      { key: "VI", label: "VI (valor)" },
      { key: "VC_LABEL", label: "VC (texto)" },
      { key: "VC", label: "VC (valor)" },
      { key: "PESO", label: "Peso" },
      { key: "REQ", label: "Req." },
      { key: "ACTIVO", label: "Activo" },
    ];

    const customHeaders = (doc.columns || []).map((c) => ({
      key: String(c.key || "").toUpperCase(),
      label: c.type === "formula" ? `ƒ ${c.label}` : c.label,
      col: c,
    }));

    const sheetHeader = [
      { key: "ID", label: "ID" },
      ...baseHeaders,
      ...customHeaders.map((h) => ({ key: h.key, label: h.label })),
      { key: "ORDEN", label: "Orden" },
      { key: "DESC", label: "Descripción" },
    ];

    const rows = filteredRows.slice();
    const sheet2 = [sheetHeader.map((h) => h.label)];

    for (const n of rows) {
      const parent = n.parentId ? byId.get(n.parentId) : null;

      const baseValuesByKey = {
        CODE: n.code,
        TITLE: n.title,
        TYPE: n.type,
        PARENT_CODE: parent ? parent.code : "",
        VI_LABEL: viLabel(n.viKey),
        VI: viValue(n.viKey),
        VC_LABEL: vcLabel(n.vcKey),
        VC: vcValue(n.vcKey),
        PESO: n.weight,
        REQ: n.required ? 1 : 0,
        ACTIVO: n.active ? 1 : 0,
      };

      const rowArr = new Array(sheetHeader.length).fill("");
      rowArr[0] = n.id;

      for (let i = 0; i < baseHeaders.length; i++) {
        const k = baseHeaders[i].key;
        rowArr[1 + i] = baseValuesByKey[k] ?? "";
      }

      const customStart = 1 + baseHeaders.length;
      for (let i = 0; i < customHeaders.length; i++) {
        const col = customHeaders[i].col;
        const cellIdx = customStart + i;

        if (!isApplicable(col, n)) {
          rowArr[cellIdx] = "";
          continue;
        }
        if (col.type === "formula") rowArr[cellIdx] = col.formula || "";
        else {
          const v = n.custom?.[col.key];
          rowArr[cellIdx] = col.type === "boolean" ? (v ? 1 : 0) : v ?? "";
        }
      }

      rowArr[sheetHeader.length - 2] = n.order ?? 0;
      rowArr[sheetHeader.length - 1] = n.desc || "";
      sheet2.push(rowArr);
    }

    const wsChecklist = XLSX.utils.aoa_to_sheet(sheet2);

    const headerKeys = sheetHeader.map((h) =>
      String(h.key || "").toUpperCase()
    );
    for (let r = 1; r < sheet2.length; r++) {
      const excelRow = r + 1;
      const placeholderMap = buildExcelPlaceholderMap(headerKeys, excelRow);

      for (const col of doc.columns || []) {
        if (col.type !== "formula") continue;
        const colIndex = headerKeys.indexOf(
          String(col.key || "").toUpperCase()
        );
        if (colIndex < 0) continue;

        const cellAddr = XLSX.utils.encode_cell({ r, c: colIndex });
        const node = rows[r - 1];
        if (!node || !isApplicable(col, node)) {
          wsChecklist[cellAddr] = { t: "s", v: "" };
          continue;
        }

        const template = sheet2[r][colIndex] || col.formula || "";
        const f = applyPlaceholdersToFormula(template, placeholderMap);

        wsChecklist[cellAddr] = wsChecklist[cellAddr] || {};
        wsChecklist[cellAddr].t = "n";
        wsChecklist[cellAddr].f = f.startsWith("=") ? f.slice(1) : f;
        wsChecklist[cellAddr].v = null;
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsDatos, "Datos");
    XLSX.utils.book_append_sheet(wb, wsChecklist, "Checklist");

    XLSX.writeFile(wb, `${fileMeta?.code || "archivo"}.xlsx`);
    setStatus({ kind: "ok", msg: "Excel exportado." });
  };

  const openColModal = () => {
    setColModalOpen(true);
    setColEditId(null);
    setColForm({
      label: "",
      key: "",
      type: "text",
      appliesTo: "ALL",
      editable: "true",
      options: "",
      formula: "",
    });
  };

  const loadColForm = (id) => {
    setColEditId(id);
    const c = (doc.columns || []).find((x) => x.id === id);
    if (!c) return;
    setColForm({
      label: c.label || "",
      key: c.key || "",
      type: c.type || "text",
      appliesTo: c.appliesTo || "ALL",
      editable: String(!!c.editable),
      options: (c.options || []).join(", "),
      formula: c.formula || "",
    });
  };

  const saveCol = () => {
    const label = colForm.label.trim();
    if (!label) return showToast("Pon un nombre (label) para la columna.");

    const type = colForm.type;
    const appliesTo = colForm.appliesTo;
    const editable = colForm.editable === "true";
    const key = normalizeKey(colForm.key || label);
    if (!key) return showToast("Key inválida.");

    const exists = (doc.columns || []).find(
      (c) => String(c.key || "").toUpperCase() === key && c.id !== colEditId
    );
    if (exists) return showToast(`Ya existe una columna con key ${key}.`);

    const options = colForm.options
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const formula = colForm.formula.trim();

    if (type === "select" && !options.length)
      return showToast("Para tipo select, agrega al menos 1 opción.");
    if (type === "formula" && !formula)
      return showToast("Para tipo formula, escribe la fórmula.");

    setDoc((prev) => {
      const cols = prev.columns.slice();

      if (colEditId) {
        const idx = cols.findIndex((x) => x.id === colEditId);
        if (idx >= 0) {
          cols[idx] = {
            ...cols[idx],
            label,
            key,
            type,
            appliesTo,
            editable,
            options,
            formula,
          };
        }
      } else {
        cols.push(
          mkCol({ label, key, type, appliesTo, editable, options, formula })
        );
      }

      return { ...prev, columns: cols };
    });

    markDirty("Columnas actualizadas.");
    showToast("Columna guardada.");
  };

  const deleteCol = () => {
    if (!colEditId) return;
    const c = (doc.columns || []).find((x) => x.id === colEditId);
    if (!c) return;

    const ok = window.confirm(`Eliminar columna "${c.label}" (${c.key})?`);
    if (!ok) return;

    setDoc((prev) => {
      const cols = prev.columns.filter((x) => x.id !== colEditId);
      const nodes = prev.nodes.map((n) => {
        if (!n.custom) return n;
        const custom = { ...n.custom };
        if (Object.prototype.hasOwnProperty.call(custom, c.key))
          delete custom[c.key];
        return { ...n, custom };
      });
      return { ...prev, columns: cols, nodes };
    });

    setColEditId(null);
    markDirty("Columna eliminada.");
  };

  const renderTreeNode = (node) => {
    const children = tree.byParent.get(node.id) || [];
    return (
      <li key={node.id}>
        <button
          type="button"
          className={`${styles.treeItem} ${
            selectedId === node.id ? styles.treeItemSelected : ""
          }`}
          onClick={() => setSelected(node.id)}
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
          <span className={styles.treeText}>{nodeLabel(node)}</span>
        </button>

        {children.length > 0 && (
          <ul className={styles.treeIndent}>
            {children.map((ch) => renderTreeNode(ch))}
          </ul>
        )}
      </li>
    );
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>Cargando…</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {toast && <div className={styles.toast}>{toast}</div>}

      <header className={styles.header}>
        <div className={styles.topbar}>
          <div className={styles.brand}>
            <div className={styles.brandTitle}>mvp-catty</div>
            <div className={styles.brandSub}>
              {fileMeta?.name || "Archivo"} • {fileMeta?.code || fileId}
            </div>
          </div>

          <div className={styles.pills}>
            <span className={styles.pill}>
              {dirty ? "Documento: Borrador*" : "Documento: Guardado"}
            </span>
            <span className={styles.pill}>
              Selección: {selected ? nodeLabel(selected) : "—"}
            </span>
          </div>

          <div className={styles.grow} />

          <div className={styles.actionsTop}>
            <button className={styles.btn} type="button" onClick={onValidate}>
              Validar
            </button>
            <button
              className={`${styles.btn} ${styles.primary}`}
              type="button"
              onClick={onSave}
              disabled={saving}
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
            <button
              className={`${styles.btn} ${styles.secondary}`}
              type="button"
              onClick={onExportExcel}
            >
              Exportar Excel
            </button>
            <button
              className={`${styles.btn} ${styles.btnGhost}`}
              type="button"
              onClick={onExportJson}
            >
              Exportar JSON
            </button>

            <div className={styles.userbox} title="Sesión">
              <div className={styles.avatar}>{initials}</div>
              <div className={styles.usermeta}>
                <div className={styles.username}>{displayName}</div>
                <div className={styles.userrole}>
                  {user?.is_admin ? "Admin" : "Usuario"}
                </div>
              </div>

              <button
                className={styles.backBtn}
                type="button"
                onClick={() => navigate("/dashboard")}
              >
                Volver
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className={styles.layout}>
        <section className={styles.panel} aria-label="Árbol">
          <div className={styles.panelHead}>Estructura</div>

          <div className={styles.panelTools}>
            <button
              className={styles.btnSmall}
              type="button"
              onClick={() => addNode(TYPES.LEVEL)}
            >
              + Nivel
            </button>
            <button
              className={styles.btnSmall}
              type="button"
              onClick={() => addNode(TYPES.GROUP)}
            >
              + Agrupación
            </button>
            <button
              className={styles.btnSmall}
              type="button"
              onClick={() => addNode(TYPES.ITEM)}
            >
              + Ítem
            </button>
            <button
              className={`${styles.btnSmall} ${styles.danger}`}
              type="button"
              onClick={() => selectedId && deleteNode(selectedId)}
              disabled={!selectedId}
            >
              Eliminar
            </button>
          </div>

          <div className={styles.panelBody}>
            <ul className={styles.treeRoot}>
              {(tree.byParent.get("__root__") || []).map((n) =>
                renderTreeNode(n)
              )}
            </ul>
          </div>
        </section>

        <section className={styles.panel} aria-label="Tabla">
          <div className={styles.panelHeadRow}>
            <div className={styles.panelHead}>Checklist</div>
            <button
              className={styles.btnSmall}
              type="button"
              onClick={openColModal}
            >
              Columnas
            </button>
          </div>

          <div className={styles.metaWrap}>
            <div className={styles.metaToggle}>
              <button
                className={styles.bullet}
                type="button"
                onClick={toggleMeta}
                title="Ocultar/mostrar preguntas iniciales"
              >
                •
              </button>
              <div className={styles.metaTitleWrap}>
                <div className={styles.metaTitle}>Preguntas iniciales</div>
                <div className={styles.metaSub}>
                  Oculta esto para ver solo la estructura
                </div>
              </div>
              <span className={styles.pill}>
                {doc.ui?.showMeta ? "Visible" : "Oculto"}
              </span>
            </div>

            {doc.ui?.showMeta && (
              <div className={styles.metaCard}>
                <div className={styles.metaHeading}>
                  Checklist para evaluación de usabilidad
                </div>

                <div className={styles.metaGrid}>
                  <div className={styles.field}>
                    <div className={styles.label}>Nombre</div>
                    <input
                      className={styles.input}
                      value={doc.meta?.name ?? ""}
                      onChange={(e) => {
                        setDoc((p) => ({
                          ...p,
                          meta: { ...(p.meta || {}), name: e.target.value },
                        }));
                        markDirty();
                      }}
                    />
                  </div>

                  <div className={styles.field}>
                    <div className={styles.label}>Correo</div>
                    <input
                      className={styles.input}
                      value={doc.meta?.email ?? ""}
                      onChange={(e) => {
                        setDoc((p) => ({
                          ...p,
                          meta: { ...(p.meta || {}), email: e.target.value },
                        }));
                        markDirty();
                      }}
                    />
                  </div>

                  <div className={styles.field}>
                    <div className={styles.label}>Empresa</div>
                    <input
                      className={styles.input}
                      value={doc.meta?.company ?? ""}
                      onChange={(e) => {
                        setDoc((p) => ({
                          ...p,
                          meta: { ...(p.meta || {}), company: e.target.value },
                        }));
                        markDirty();
                      }}
                    />
                  </div>

                  <div className={styles.field}>
                    <div className={styles.label}>Empresa actual</div>
                    <input
                      className={styles.input}
                      value={doc.meta?.company_current ?? ""}
                      onChange={(e) => {
                        setDoc((p) => ({
                          ...p,
                          meta: {
                            ...(p.meta || {}),
                            company_current: e.target.value,
                          },
                        }));
                        markDirty();
                      }}
                    />
                  </div>

                  <div className={styles.field}>
                    <div className={styles.label}>Industria</div>
                    <input
                      className={styles.input}
                      value={doc.meta?.industry ?? ""}
                      onChange={(e) => {
                        setDoc((p) => ({
                          ...p,
                          meta: { ...(p.meta || {}), industry: e.target.value },
                        }));
                        markDirty();
                      }}
                    />
                  </div>

                  <div className={styles.field}>
                    <div className={styles.label}>Tamaño</div>
                    <input
                      className={styles.input}
                      value={doc.meta?.size ?? ""}
                      onChange={(e) => {
                        setDoc((p) => ({
                          ...p,
                          meta: { ...(p.meta || {}), size: e.target.value },
                        }));
                        markDirty();
                      }}
                    />
                  </div>

                  <div className={styles.fieldWide}>
                    <div className={styles.label}>Experiencia (años)</div>
                    <input
                      className={styles.input}
                      type="number"
                      min="0"
                      step="1"
                      value={doc.meta?.experience ?? ""}
                      onChange={(e) => {
                        setDoc((p) => ({
                          ...p,
                          meta: {
                            ...(p.meta || {}),
                            experience: e.target.value,
                          },
                        }));
                        markDirty();
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className={styles.tableToolbar}>
            <input
              className={styles.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por código, enunciado o tipo…"
            />
            <button
              className={styles.btnSmall}
              type="button"
              onClick={() => addNode(TYPES.ITEM)}
            >
              + Fila
            </button>
            <button
              className={styles.btnSmall}
              type="button"
              onClick={duplicateSelected}
              disabled={!selected}
            >
              Duplicar
            </button>
            <button
              className={`${styles.btnSmall} ${styles.danger}`}
              type="button"
              onClick={() => selectedId && deleteNode(selectedId)}
              disabled={!selectedId}
            >
              Eliminar fila
            </button>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Enunciado</th>
                  <th>Tipo</th>
                  <th>Padre</th>
                  <th>VI (texto)</th>
                  <th>VI</th>
                  <th>VC (texto)</th>
                  <th>VC</th>
                  <th>Peso</th>
                  <th>Req.</th>
                  <th>Activo</th>
                  {(doc.columns || []).map((c) => (
                    <th key={c.id}>
                      {c.type === "formula" ? `ƒ ${c.label}` : c.label}
                    </th>
                  ))}
                  <th>Acciones</th>
                </tr>
              </thead>

              <tbody>
                {filteredRows.map((n) => {
                  const parent = n.parentId ? byId.get(n.parentId) : null;

                  return (
                    <tr
                      key={n.id}
                      className={n.id === selectedId ? styles.trSelected : ""}
                      onClick={() => setSelected(n.id)}
                    >
                      <td>
                        <input
                          className={styles.cellInput}
                          value={n.code ?? ""}
                          onChange={(e) =>
                            updateNode(n.id, { code: e.target.value })
                          }
                        />
                      </td>

                      <td>
                        <input
                          className={styles.cellInput}
                          value={n.title ?? ""}
                          onChange={(e) =>
                            updateNode(n.id, { title: e.target.value })
                          }
                        />
                      </td>

                      <td>
                        <select
                          className={styles.cellSelect}
                          value={n.type}
                          onChange={(e) => {
                            const newType = e.target.value;
                            updateNode(n.id, { type: newType });
                          }}
                        >
                          <option value={TYPES.LEVEL}>LEVEL</option>
                          <option value={TYPES.GROUP}>GROUP</option>
                          <option value={TYPES.ITEM}>ITEM</option>
                        </select>
                      </td>

                      <td>
                        <select
                          className={styles.cellSelect}
                          value={n.parentId || ""}
                          onChange={(e) => {
                            const parentId = e.target.value || null;
                            setDoc((prev) => {
                              const nodes = prev.nodes.map((x) => {
                                if (x.id !== n.id) return x;
                                return {
                                  ...x,
                                  parentId,
                                  order: nextOrderForParent(
                                    prev.nodes,
                                    parentId
                                  ),
                                };
                              });
                              return { ...prev, nodes };
                            });
                            markDirty("Padre actualizado.");
                          }}
                        >
                          <option value="">— (sin padre)</option>
                          {(doc.nodes || [])
                            .filter(
                              (p) =>
                                p.id !== n.id &&
                                (p.type === TYPES.LEVEL ||
                                  p.type === TYPES.GROUP)
                            )
                            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.type}: {nodeLabel(p)}
                              </option>
                            ))}
                        </select>
                      </td>

                      <td className={styles.mutedCell}>{viLabel(n.viKey)}</td>
                      <td className={styles.mutedCell}>{viValue(n.viKey)}</td>
                      <td className={styles.mutedCell}>{vcLabel(n.vcKey)}</td>
                      <td className={styles.mutedCell}>{vcValue(n.vcKey)}</td>

                      <td>
                        <input
                          className={`${styles.cellInput} ${styles.mini}`}
                          type="number"
                          step="0.1"
                          value={n.weight ?? 1}
                          onChange={(e) =>
                            updateNode(n.id, {
                              weight: Number(e.target.value || 0),
                            })
                          }
                        />
                      </td>

                      <td>
                        <select
                          className={`${styles.cellSelect} ${styles.mini}`}
                          value={String(!!n.required)}
                          onChange={(e) =>
                            updateNode(n.id, {
                              required: e.target.value === "true",
                            })
                          }
                        >
                          <option value="true">Sí</option>
                          <option value="false">No</option>
                        </select>
                      </td>

                      <td>
                        <select
                          className={`${styles.cellSelect} ${styles.mini}`}
                          value={String(!!n.active)}
                          onChange={(e) =>
                            updateNode(n.id, {
                              active: e.target.value === "true",
                            })
                          }
                        >
                          <option value="true">Sí</option>
                          <option value="false">No</option>
                        </select>
                      </td>

                      {(doc.columns || []).map((c) => {
                        if (!isApplicable(c, n)) {
                          return (
                            <td key={c.id} className={styles.mutedCell}>
                              —
                            </td>
                          );
                        }

                        if (c.type === "formula") {
                          return (
                            <td key={c.id}>
                              <span className={styles.formulaChip}>
                                ƒ <b>{c.key}</b>{" "}
                                <span>{c.formula || "(sin fórmula)"}</span>
                              </span>
                            </td>
                          );
                        }

                        const editable = !!c.editable;
                        const v = n.custom?.[c.key];

                        if (c.type === "select") {
                          return (
                            <td key={c.id}>
                              <select
                                className={styles.cellSelect}
                                disabled={!editable}
                                value={v ?? ""}
                                onChange={(e) =>
                                  updateNodeCustom(n.id, c.key, e.target.value)
                                }
                              >
                                <option value="">—</option>
                                {(c.options || []).map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
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
                                disabled={!editable}
                                value={String(!!v)}
                                onChange={(e) =>
                                  updateNodeCustom(
                                    n.id,
                                    c.key,
                                    e.target.value === "true"
                                  )
                                }
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
                              disabled={!editable}
                              type={c.type === "number" ? "number" : "text"}
                              step={c.type === "number" ? "0.1" : undefined}
                              value={v ?? ""}
                              onChange={(e) => {
                                const raw = e.target.value;
                                updateNodeCustom(
                                  n.id,
                                  c.key,
                                  c.type === "number"
                                    ? raw === ""
                                      ? ""
                                      : Number(raw)
                                    : raw
                                );
                              }}
                            />
                          </td>
                        );
                      })}

                      <td
                        className={styles.actionsCol}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          className={styles.iconBtn}
                          type="button"
                          onClick={() => moveWithinSiblings(n.id, -1)}
                          title="Subir"
                        >
                          ↑
                        </button>
                        <button
                          className={styles.iconBtn}
                          type="button"
                          onClick={() => moveWithinSiblings(n.id, +1)}
                          title="Bajar"
                        >
                          ↓
                        </button>
                        <button
                          className={`${styles.iconBtn} ${styles.danger}`}
                          type="button"
                          onClick={() => deleteNode(n.id)}
                          title="Eliminar"
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.panel} aria-label="Inspector">
          <div className={styles.panelHead}>Inspector</div>

          <div className={styles.panelBody}>
            {!selected ? (
              <div className={styles.hint}>
                Selecciona un nodo del árbol o una fila de la tabla.
              </div>
            ) : (
              <>
                <div className={styles.row2}>
                  <div className={styles.field}>
                    <div className={styles.label}>ID</div>
                    <input
                      className={styles.input}
                      value={selected.id}
                      disabled
                    />
                  </div>

                  <div className={styles.field}>
                    <div className={styles.label}>Tipo</div>
                    <select
                      className={styles.input}
                      value={selected.type}
                      onChange={(e) =>
                        updateNode(selected.id, { type: e.target.value })
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
                    className={styles.input}
                    value={selected.code ?? ""}
                    onChange={(e) =>
                      updateNode(selected.id, { code: e.target.value })
                    }
                  />
                </div>

                <div className={styles.field}>
                  <div className={styles.label}>Enunciado / Nombre</div>
                  <input
                    className={styles.input}
                    value={selected.title ?? ""}
                    onChange={(e) =>
                      updateNode(selected.id, { title: e.target.value })
                    }
                  />
                </div>

                <div className={styles.row2}>
                  <div className={styles.field}>
                    <div className={styles.label}>Escala VI</div>
                    <select
                      className={styles.input}
                      value={selected.viKey}
                      onChange={(e) =>
                        updateNode(selected.id, { viKey: e.target.value })
                      }
                    >
                      {SCALES.VI.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.field}>
                    <div className={styles.label}>Escala VC</div>
                    <select
                      className={styles.input}
                      value={selected.vcKey}
                      onChange={(e) =>
                        updateNode(selected.id, { vcKey: e.target.value })
                      }
                    >
                      {SCALES.VC.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className={styles.row2}>
                  <div className={styles.field}>
                    <div className={styles.label}>Peso</div>
                    <input
                      className={styles.input}
                      type="number"
                      step="0.1"
                      value={selected.weight ?? 1}
                      onChange={(e) =>
                        updateNode(selected.id, {
                          weight: Number(e.target.value || 0),
                        })
                      }
                    />
                  </div>

                  <div className={styles.field}>
                    <div className={styles.label}>Padre</div>
                    <select
                      className={styles.input}
                      value={selected.parentId || ""}
                      onChange={(e) =>
                        updateNode(selected.id, {
                          parentId: e.target.value || null,
                          order: nextOrderForParent(
                            doc.nodes,
                            e.target.value || null
                          ),
                        })
                      }
                    >
                      <option value="">— (sin padre)</option>
                      {(doc.nodes || [])
                        .filter(
                          (p) =>
                            p.id !== selected.id &&
                            (p.type === TYPES.LEVEL || p.type === TYPES.GROUP)
                        )
                        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
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
                      className={styles.input}
                      value={String(!!selected.required)}
                      onChange={(e) =>
                        updateNode(selected.id, {
                          required: e.target.value === "true",
                        })
                      }
                    >
                      <option value="true">Sí</option>
                      <option value="false">No</option>
                    </select>
                  </div>

                  <div className={styles.field}>
                    <div className={styles.label}>Activo</div>
                    <select
                      className={styles.input}
                      value={String(!!selected.active)}
                      onChange={(e) =>
                        updateNode(selected.id, {
                          active: e.target.value === "true",
                        })
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
                    className={styles.textarea}
                    value={selected.desc ?? ""}
                    onChange={(e) =>
                      updateNode(selected.id, { desc: e.target.value })
                    }
                  />
                </div>

                <div className={styles.sectionTitle}>Campos adicionales</div>
                <div className={styles.extraBox}>
                  {(doc.columns || []).filter((c) => isApplicable(c, selected))
                    .length === 0 ? (
                    <div className={styles.hint}>
                      No hay columnas aplicables para este tipo de nodo.
                    </div>
                  ) : (
                    (doc.columns || [])
                      .filter((c) => isApplicable(c, selected))
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

                        const v = selected.custom?.[c.key];
                        const editable = !!c.editable;

                        if (c.type === "select") {
                          return (
                            <div key={c.id} className={styles.field}>
                              <div className={styles.label}>
                                {c.label} (select)
                              </div>
                              <select
                                className={styles.input}
                                disabled={!editable}
                                value={v ?? ""}
                                onChange={(e) =>
                                  updateNodeCustom(
                                    selected.id,
                                    c.key,
                                    e.target.value
                                  )
                                }
                              >
                                <option value="">—</option>
                                {(c.options || []).map((o) => (
                                  <option key={o} value={o}>
                                    {o}
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
                                className={styles.input}
                                disabled={!editable}
                                value={String(!!v)}
                                onChange={(e) =>
                                  updateNodeCustom(
                                    selected.id,
                                    c.key,
                                    e.target.value === "true"
                                  )
                                }
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
                              className={styles.input}
                              disabled={!editable}
                              type={c.type === "number" ? "number" : "text"}
                              step={c.type === "number" ? "0.1" : undefined}
                              value={v ?? ""}
                              onChange={(e) => {
                                const raw = e.target.value;
                                updateNodeCustom(
                                  selected.id,
                                  c.key,
                                  c.type === "number"
                                    ? raw === ""
                                      ? ""
                                      : Number(raw)
                                    : raw
                                );
                              }}
                            />
                          </div>
                        );
                      })
                  )}
                </div>

                <div className={styles.logBox}>
                  <span
                    className={`${styles.badge} ${
                      status.kind === "ok"
                        ? styles.badgeOk
                        : status.kind === "warn"
                        ? styles.badgeWarn
                        : status.kind === "bad"
                        ? styles.badgeBad
                        : ""
                    }`}
                  >
                    {status.kind === "ok"
                      ? "OK"
                      : status.kind === "warn"
                      ? "Atención"
                      : status.kind === "bad"
                      ? "Error"
                      : "Listo"}
                  </span>
                  <span className={styles.logLine}>{status.msg}</span>
                </div>
              </>
            )}
          </div>
        </section>
      </main>

      {colModalOpen && (
        <div
          className={styles.modalBackdrop}
          onMouseDown={() => setColModalOpen(false)}
        >
          <div
            className={styles.modal}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>
                Columnas (dinámicas + fórmulas)
              </div>
              <button
                className={styles.btnSmall}
                type="button"
                onClick={() => setColModalOpen(false)}
              >
                Cerrar
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.colList}>
                <div className={styles.colListHead}>
                  Columnas personalizadas
                </div>

                <div className={styles.colListBody}>
                  {(doc.columns || []).length === 0 ? (
                    <div className={styles.colItemMuted}>Sin columnas</div>
                  ) : (
                    (doc.columns || []).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={`${styles.colItem} ${
                          colEditId === c.id ? styles.colItemSelected : ""
                        }`}
                        onClick={() => loadColForm(c.id)}
                      >
                        <div className={styles.colItemLeft}>
                          <div className={styles.colItemTitle}>
                            {c.label}{" "}
                            <span className={styles.colItemKey}>({c.key})</span>
                          </div>
                          <div className={styles.colItemMeta}>
                            {c.type} • aplica: {c.appliesTo} • editable:{" "}
                            {c.editable ? "sí" : "no"}
                          </div>
                          {c.type === "formula" && c.formula && (
                            <div className={styles.colItemFormula}>
                              ƒ {c.formula}
                            </div>
                          )}
                        </div>
                        <span className={styles.colTag}>{c.type}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className={styles.colForm}>
                <div className={styles.field}>
                  <div className={styles.label}>Nombre (label)</div>
                  <input
                    className={styles.input}
                    value={colForm.label}
                    onChange={(e) => {
                      const v = e.target.value;
                      setColForm((p) => ({
                        ...p,
                        label: v,
                        key: p.key.trim() ? p.key : normalizeKey(v),
                      }));
                    }}
                    placeholder="Ej: Evidencia"
                  />
                </div>

                <div className={styles.row2}>
                  <div className={styles.field}>
                    <div className={styles.label}>Key</div>
                    <input
                      className={styles.input}
                      value={colForm.key}
                      onChange={(e) =>
                        setColForm((p) => ({ ...p, key: e.target.value }))
                      }
                      placeholder="EJ: EVIDENCIA"
                    />
                  </div>

                  <div className={styles.field}>
                    <div className={styles.label}>Tipo</div>
                    <select
                      className={styles.input}
                      value={colForm.type}
                      onChange={(e) => {
                        const t = e.target.value;
                        setColForm((p) => ({
                          ...p,
                          type: t,
                          editable: t === "formula" ? "false" : p.editable,
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
                      className={styles.input}
                      value={colForm.appliesTo}
                      onChange={(e) =>
                        setColForm((p) => ({ ...p, appliesTo: e.target.value }))
                      }
                    >
                      <option value="ALL">ALL</option>
                      <option value="LEVEL">LEVEL</option>
                      <option value="GROUP">GROUP</option>
                      <option value="ITEM">ITEM</option>
                    </select>
                  </div>

                  <div className={styles.field}>
                    <div className={styles.label}>Editable</div>
                    <select
                      className={styles.input}
                      value={colForm.editable}
                      onChange={(e) =>
                        setColForm((p) => ({ ...p, editable: e.target.value }))
                      }
                    >
                      <option value="true">Sí</option>
                      <option value="false">No</option>
                    </select>
                  </div>
                </div>

                {colForm.type === "select" && (
                  <div className={styles.field}>
                    <div className={styles.label}>
                      Opciones (separa con comas)
                    </div>
                    <textarea
                      className={styles.textarea}
                      value={colForm.options}
                      onChange={(e) =>
                        setColForm((p) => ({ ...p, options: e.target.value }))
                      }
                      placeholder="Alta, Media, Baja"
                    />
                  </div>
                )}

                {colForm.type === "formula" && (
                  <div className={styles.field}>
                    <div className={styles.label}>Fórmula</div>
                    <input
                      className={styles.input}
                      value={colForm.formula}
                      onChange={(e) =>
                        setColForm((p) => ({ ...p, formula: e.target.value }))
                      }
                      placeholder="Ej: ={VI}*{VC}*{PESO}"
                    />
                    <div className={styles.hint} style={{ marginTop: 8 }}>
                      Placeholders: {"{VI}"}, {"{VC}"}, {"{PESO}"} y keys de
                      columnas (ej. {"{EVIDENCIA_URL}"} si fuera numérica).
                    </div>
                  </div>
                )}

                <div className={styles.modalFooter}>
                  <button
                    className={`${styles.btnSmall} ${styles.danger}`}
                    type="button"
                    onClick={deleteCol}
                    disabled={!colEditId}
                  >
                    Eliminar
                  </button>
                  <button
                    className={styles.btnSmall}
                    type="button"
                    onClick={() => {
                      setColEditId(null);
                      setColForm({
                        label: "",
                        key: "",
                        type: "text",
                        appliesTo: "ALL",
                        editable: "true",
                        options: "",
                        formula: "",
                      });
                    }}
                  >
                    Nueva
                  </button>
                  <button
                    className={`${styles.btnSmall} ${styles.primary}`}
                    type="button"
                    onClick={saveCol}
                  >
                    Guardar columna
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
