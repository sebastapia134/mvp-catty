import { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import styles from "../styles/FileDetail.module.css";
import { AuthContext } from "../context/AuthContext";
import { getFile } from "../services/files";

function flatten(obj, prefix = "", out = {}) {
  if (obj == null) return out;
  if (typeof obj !== "object") {
    out[prefix || "value"] = obj;
    return out;
  }
  if (Array.isArray(obj)) {
    out[prefix || "array"] = JSON.stringify(obj);
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function labelize(key) {
  const map = {
    name: "Nombre",
    email: "Correo",
    company: "Empresa",
    industry: "Área / Industria",
    size: "Tamaño",
    experience: "Experiencia profesional",
    company_current: "Empresa actual",
  };
  return map[key] || key.replaceAll("_", " ");
}

function coerceByType(value, type) {
  if (type === "number") {
    if (value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  return value;
}

export default function FileDetail() {
  const { fileId } = useParams();
  const navigate = useNavigate();
  const { token } = useContext(AuthContext);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [file, setFile] = useState(null);

  // ✅ estado editable (sin backend)
  const [mode, setMode] = useState("kv"); // "excel" | "rows" | "kv"
  const [meta, setMeta] = useState({});
  const [intro, setIntro] = useState([]);
  const [questions, setQuestions] = useState({});
  const [cols, setCols] = useState([]); // [{key,label,type,options?}]
  const [rows, setRows] = useState([]); // array de objetos
  const [kvRows, setKvRows] = useState([]); // [{key,value}]

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const data = await getFile(fileId, token);
        if (!alive) return;
        setFile(data);
      } catch {
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

  // Inicializa la vista editable según la forma del JSON
  useEffect(() => {
    if (!file) return;

    const payload = file?.file_json ?? file?.data ?? {};
    const excelData = payload?.data;

    const hasExcel =
      excelData &&
      Array.isArray(excelData.columns) &&
      Array.isArray(excelData.nodes);

    if (hasExcel) {
      setMode("excel");
      setMeta(excelData.meta ?? {});
      setIntro(Array.isArray(excelData.intro) ? excelData.intro : []);
      setQuestions(excelData.questions ?? {});

      const normalizedCols =
        excelData.columns
          ?.map((c) => ({
            key: String(c?.key ?? ""),
            label: String(c?.label ?? c?.key ?? ""),
            type: c?.type || "text",
            options: c?.options,
          }))
          .filter((c) => c.key) || [];

      setCols(normalizedCols);
      setRows(Array.isArray(excelData.nodes) ? excelData.nodes : []);
      setKvRows([]);
      return;
    }

    // Si viene como array de filas
    if (Array.isArray(payload)) {
      setMode("rows");
      const cols2 = Array.from(
        new Set(payload.flatMap((r) => Object.keys(r || {})))
      ).map((k) => ({ key: k, label: k, type: "text" }));
      setCols(cols2);
      setRows(payload);
      setMeta({});
      setIntro([]);
      setQuestions({});
      setKvRows([]);
      return;
    }

    // fallback: key/value editable
    setMode("kv");
    const kv = flatten(payload || {});
    setKvRows(Object.entries(kv).map(([k, v]) => ({ key: k, value: v })));
    setCols([]);
    setRows([]);
    setMeta({});
    setIntro([]);
    setQuestions({});
  }, [file]);

  const updateMeta = (k, v) => {
    setMeta((prev) => ({ ...prev, [k]: v }));
  };

  const updateCell = (rowIdx, colKey, rawValue) => {
    const colType = cols.find((c) => c.key === colKey)?.type;
    const value = coerceByType(rawValue, colType);

    setRows((prev) => {
      const next = [...prev];
      const current = next[rowIdx] ?? {};
      next[rowIdx] = { ...current, [colKey]: value };
      return next;
    });
  };

  const updateKvValue = (idx, rawValue) => {
    setKvRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], value: rawValue };
      return next;
    });
  };

  const metaKeys = useMemo(() => {
    const keys = Object.keys(meta || {});
    // orden bonito si están los campos típicos
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

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button
          className={styles.backBtn}
          type="button"
          onClick={() => navigate(-1)}
        >
          ← Volver
        </button>

        <div className={styles.headMeta}>
          <div className={styles.title}>{file?.name || "Archivo"}</div>
          <div className={styles.sub}>
            ID: {String(fileId)} · Tamaño: {file?.size_bytes ?? "—"} · (edición
            local)
          </div>
        </div>
      </header>

      <main className={styles.main}>
        {loading ? (
          <div className={styles.state}>Cargando…</div>
        ) : err ? (
          <div className={styles.stateError}>{err}</div>
        ) : (
          <>
            {/* ✅ Meta editable */}
            {mode === "excel" && (metaKeys.length > 0 || intro.length > 0) && (
              <div className={styles.card} style={{ marginBottom: 12 }}>
                <div style={{ padding: 14 }}>
                  {intro.length > 0 && (
                    <div
                      style={{
                        marginBottom: 12,
                        color: "rgba(168,179,209,0.95)",
                      }}
                    >
                      {intro.map((p, i) => (
                        <div
                          key={i}
                          style={{ marginBottom: 6, lineHeight: 1.35 }}
                        >
                          {p}
                        </div>
                      ))}
                    </div>
                  )}

                  {metaKeys.length > 0 && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: 10,
                      }}
                    >
                      {metaKeys.map((k) => (
                        <label key={k} style={{ display: "grid", gap: 6 }}>
                          <span
                            style={{
                              fontSize: 12,
                              color: "rgba(168,179,209,0.95)",
                            }}
                          >
                            {labelize(k)}
                          </span>
                          <input
                            value={meta?.[k] ?? ""}
                            onChange={(e) => updateMeta(k, e.target.value)}
                            style={{
                              width: "100%",
                              padding: "10px 10px",
                              borderRadius: 12,
                              border: "1px solid rgba(255,255,255,0.12)",
                              background: "rgba(255,255,255,0.03)",
                              color: "inherit",
                              outline: "none",
                            }}
                          />
                          {questions?.[`${k}_help`] ? (
                            <span
                              style={{
                                fontSize: 11,
                                color: "rgba(168,179,209,0.75)",
                              }}
                            >
                              {questions[`${k}_help`]}
                            </span>
                          ) : null}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ✅ Tabla editable */}
            <div className={styles.card}>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {mode === "excel" || mode === "rows" ? (
                        <>
                          <th style={{ width: 64 }}>#</th>
                          {cols.map((c) => (
                            <th key={c.key}>{c.label}</th>
                          ))}
                        </>
                      ) : (
                        <>
                          <th>key</th>
                          <th>value</th>
                        </>
                      )}
                    </tr>
                  </thead>

                  <tbody>
                    {(mode === "excel" || mode === "rows") &&
                      rows.map((r, rowIdx) => (
                        <tr key={rowIdx}>
                          <td>{rowIdx + 1}</td>

                          {cols.map((c) => {
                            const v = r?.[c.key];
                            const str = v == null ? "" : String(v);

                            // select si hay opciones
                            if (
                              Array.isArray(c.options) &&
                              c.options.length > 0
                            ) {
                              return (
                                <td key={c.key}>
                                  <select
                                    value={str}
                                    onChange={(e) =>
                                      updateCell(rowIdx, c.key, e.target.value)
                                    }
                                    style={{
                                      width: "100%",
                                      minWidth: 120,
                                      padding: "8px 8px",
                                      borderRadius: 10,
                                      border:
                                        "1px solid rgba(255,255,255,0.12)",
                                      background: "rgba(255,255,255,0.03)",
                                      color: "inherit",
                                      outline: "none",
                                    }}
                                  >
                                    <option value=""></option>
                                    {c.options.map((opt) => (
                                      <option
                                        key={String(opt)}
                                        value={String(opt)}
                                      >
                                        {String(opt)}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              );
                            }

                            const isLong =
                              c.type === "longtext" ||
                              (typeof str === "string" && str.length > 80);

                            return (
                              <td key={c.key} style={{ minWidth: 120 }}>
                                {isLong ? (
                                  <textarea
                                    value={str}
                                    onChange={(e) =>
                                      updateCell(rowIdx, c.key, e.target.value)
                                    }
                                    rows={1}
                                    style={{
                                      width: "100%",
                                      resize: "vertical",
                                      minHeight: 38,
                                      padding: "8px 10px",
                                      borderRadius: 10,
                                      border:
                                        "1px solid rgba(255,255,255,0.12)",
                                      background: "rgba(255,255,255,0.03)",
                                      color: "inherit",
                                      outline: "none",
                                    }}
                                  />
                                ) : (
                                  <input
                                    value={str}
                                    onChange={(e) =>
                                      updateCell(rowIdx, c.key, e.target.value)
                                    }
                                    type={
                                      c.type === "number" ? "number" : "text"
                                    }
                                    style={{
                                      width: "100%",
                                      minHeight: 38,
                                      padding: "8px 10px",
                                      borderRadius: 10,
                                      border:
                                        "1px solid rgba(255,255,255,0.12)",
                                      background: "rgba(255,255,255,0.03)",
                                      color: "inherit",
                                      outline: "none",
                                    }}
                                  />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}

                    {mode === "kv" &&
                      kvRows.map((r, idx) => (
                        <tr key={idx}>
                          <td>{r.key}</td>
                          <td>
                            <input
                              value={r.value == null ? "" : String(r.value)}
                              onChange={(e) =>
                                updateKvValue(idx, e.target.value)
                              }
                              style={{
                                width: "100%",
                                minHeight: 38,
                                padding: "8px 10px",
                                borderRadius: 10,
                                border: "1px solid rgba(255,255,255,0.12)",
                                background: "rgba(255,255,255,0.03)",
                                color: "inherit",
                                outline: "none",
                              }}
                            />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
