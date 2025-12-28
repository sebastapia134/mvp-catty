import { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "../styles/Dashboard.module.css";
import { AuthContext } from "../context/AuthContext";
import { listFiles, deleteFile } from "../services/files";
import { formatBytes, formatDate } from "../utils/format";

function ExcelIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"
        fill="currentColor"
        opacity="0.18"
      />
      <path
        d="M14 2v6h6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M8.2 16.9 10.2 14l-2-2.9h1.9l1.1 1.9 1.1-1.9h1.9l-2 2.9 2 2.9h-1.9l-1.1-2-1.1 2z"
        fill="currentColor"
      />
      <path
        d="M7 22h10a2 2 0 0 0 2-2V8l-5-6H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, token, setAuth } = useContext(AuthContext);

  const [q, setQ] = useState("");
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [busyDeleteId, setBusyDeleteId] = useState("");

  const showToast = (msg) => {
    setToast(msg);
    window.clearTimeout(window.__cattyToastTimer);
    window.__cattyToastTimer = window.setTimeout(() => setToast(""), 3200);
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await listFiles(token);
      setFiles(Array.isArray(data) ? data : data?.items || []);
    } catch (e) {
      setFiles([]);
      showToast(
        "No se pudo cargar archivos (backend /files aún no está listo)."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return files;
    return files.filter((f) => (f?.name || "").toLowerCase().includes(s));
  }, [files, q]);

  const totalBytes = useMemo(() => {
    return files.reduce((acc, f) => acc + (Number(f?.size_bytes) || 0), 0);
  }, [files]);

  const displayName = user?.full_name || user?.email || "usuario";
  const initials = (displayName || "U").trim().slice(0, 1).toUpperCase();

  const onDelete = async (fileId) => {
    if (!fileId) return;
    setBusyDeleteId(fileId);
    try {
      await deleteFile(fileId, token);
      setFiles((prev) => prev.filter((x) => x.id !== fileId));
      showToast("Archivo eliminado.");
    } catch {
      showToast(
        "No se pudo eliminar (backend DELETE /files/{id} aún no está listo)."
      );
    } finally {
      setBusyDeleteId("");
    }
  };

  return (
    <div className={styles.page}>
      {toast && <div className={styles.toast}>{toast}</div>}

      <header className={styles.header}>
        <div className={styles.title}>mvp-catty</div>

        <div className={styles.profile}>
          <div className={styles.avatar} aria-hidden="true">
            {initials}
          </div>
          <div className={styles.profileMeta}>
            <div className={styles.profileName}>{displayName}</div>
            <button
              className={styles.logout}
              onClick={() => setAuth("")}
              type="button"
            >
              Cerrar sesión
            </button>
          </div>

          <button
            className={styles.settings}
            type="button"
            onClick={() => showToast("Configuración (pronto).")}
            aria-label="Configuración"
            title="Configuración"
          >
            ⚙
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.sectionHeader}>
          <div className={styles.sectionTitleWrap}>
            <ExcelIcon className={styles.excelIcon} />
            <h2 className={styles.sectionTitle}>Mis archivos</h2>
          </div>
        </section>

        <section className={styles.statsRow}>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Archivos</div>
            <div className={styles.statValue}>{files.length}</div>
          </div>

          <div className={styles.statCard}>
            <div className={styles.statLabel}>Tamaño usado</div>
            <div className={styles.statValue}>{formatBytes(totalBytes)}</div>
            <div className={styles.statHint}>Tamaño del JSON</div>
          </div>

          <div className={styles.statCardWide}>
            <button
              className={styles.primaryBtn}
              type="button"
              onClick={() => navigate("/files/new")}
            >
              + Crear nuevo archivo
            </button>

            <div className={styles.searchWrap}>
              <input
                className={styles.search}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por nombre…"
              />
              <button
                className={styles.refresh}
                type="button"
                onClick={load}
                title="Recargar"
              >
                ↻
              </button>
            </div>
          </div>
        </section>

        <section className={styles.listCard}>
          <div className={styles.listHeader}>
            <div>Nombre</div>
            <div>Creado</div>
            <div>Última modificación</div>
            <div>Tamaño</div>
            <div className={styles.actionsHead}>Acciones</div>
          </div>

          {loading ? (
            <div className={styles.empty}>Cargando…</div>
          ) : filtered.length === 0 ? (
            <div className={styles.empty}>No hay archivos para mostrar.</div>
          ) : (
            <div className={styles.listBody}>
              {filtered.map((f) => (
                <div className={styles.row} key={f.id || f.code}>
                  <div className={styles.nameCell}>
                    <div className={styles.fileName}>
                      {f.name || "Sin nombre"}
                    </div>
                  </div>

                  <div className={styles.cell}>{formatDate(f.created_at)}</div>
                  <div className={styles.cell}>{formatDate(f.updated_at)}</div>
                  <div className={styles.cell}>{formatBytes(f.size_bytes)}</div>

                  <div className={styles.actions}>
                    <button
                      className={styles.iconBtn}
                      type="button"
                      onClick={() => showToast("Compartir/Exportar (pronto).")}
                      title="Compartir / Exportar"
                    >
                      ⤴
                    </button>

                    <button
                      className={styles.dangerBtn}
                      type="button"
                      onClick={() => onDelete(f.id)}
                      disabled={busyDeleteId === f.id}
                      title="Eliminar"
                    >
                      {busyDeleteId === f.id ? "…" : "Eliminar"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
