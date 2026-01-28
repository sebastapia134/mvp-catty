import { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "../styles/Dashboard.module.css";
import { AuthContext } from "../context/AuthContext";
import { formatBytes, formatDate } from "../utils/format";

import {
  listFiles,
  deleteFile,
  getFile,
  downloadFileXlsx,
} from "../services/files";
import { downloadJSON, downloadBlob } from "../utils/export";

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

  // Modal confirmación (UI)
  const [confirmDelete, setConfirmDelete] = useState(null); // { id, name }

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
    } catch {
      setFiles([]);
      showToast("No se pudo cargar archivos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cerrar modal con ESC
  useEffect(() => {
    if (!confirmDelete) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setConfirmDelete(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmDelete]);

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

  const requestDelete = (fileId, fileName) => {
    if (!fileId) return;
    if (busyDeleteId) return;
    setConfirmDelete({ id: fileId, name: fileName || "Sin nombre" });
  };

  const cancelDelete = () => setConfirmDelete(null);

  const confirmDeleteNow = async () => {
    if (!confirmDelete?.id) return;
    const { id } = confirmDelete;

    setBusyDeleteId(id);
    try {
      await deleteFile(id, token);
      showToast("Archivo eliminado.");
      setConfirmDelete(null);
      await load(); // recarga lista desde backend
    } catch {
      showToast("No se pudo eliminar el archivo.");
    } finally {
      setBusyDeleteId("");
    }
  };

  const safeFilename = (s) =>
    (s || "export")
      .replace(/[^\w\-\. ]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);

  const handleExport = async (fileItem, e) => {
    e.stopPropagation();
    if (!fileItem) return;

    const id = fileItem.id || fileItem.code;
    if (!id) {
      showToast("No se puede exportar: no hay ID/código.");
      return;
    }

    const base = safeFilename(fileItem.name || fileItem.code || `file-${id}`);

    try {
      showToast("Exportando…");

      // 1) FileOut para JSON
      const data = await getFile(id, token);

      // guardas el file_json (lo útil)
      downloadJSON(`${base}.json`, data?.file_json ?? data);

      // 2) XLSX desde backend
      const xlsxBlob = await downloadFileXlsx(id, token);
      downloadBlob(`${base}.xlsx`, xlsxBlob);

      showToast("Exportado: JSON + Excel descargados.");
    } catch (err) {
      console.error("Export error:", err);
      showToast("No se pudo exportar el archivo.");
    }
  };

  // --- FIN handler de exportación ---

  return (
    <div className={styles.page}>
      {toast && <div className={styles.toast}>{toast}</div>}

      {/* Modal UI de confirmación */}
      {confirmDelete && (
        <div
          className={styles.modalOverlay}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) cancelDelete();
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar eliminación"
        >
          <div
            className={styles.modal}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className={styles.modalTitle}>Eliminar archivo</div>
            <div className={styles.modalText}>
              Vas a eliminar <strong>{confirmDelete.name}</strong>. Esta acción
              no se puede deshacer.
            </div>

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={cancelDelete}
                disabled={!!busyDeleteId}
              >
                Cancelar
              </button>

              <button
                type="button"
                className={styles.dangerBtn}
                onClick={confirmDeleteNow}
                disabled={!!busyDeleteId}
                title="Eliminar definitivamente"
              >
                {busyDeleteId ? "Eliminando…" : "Sí, eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}

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
                disabled={loading || !!busyDeleteId}
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
              {filtered.map((f) => {
                const id = f.id || f.code;
                const isBusy = busyDeleteId === f.id; // solo delete real usa f.id

                return (
                  <div className={styles.row} key={id}>
                    <div className={styles.nameCell}>
                      <button
                        type="button"
                        className={styles.fileLink}
                        onClick={() => navigate(`/files/${id}`)}
                        title="Abrir"
                      >
                        {f.name || "Sin nombre"}
                      </button>
                    </div>

                    <div className={styles.cell}>
                      {formatDate(f.created_at)}
                    </div>
                    <div className={styles.cell}>
                      {formatDate(f.updated_at)}
                    </div>
                    <div className={styles.cell}>
                      {formatBytes(f.size_bytes)}
                    </div>

                    <div className={styles.actions}>
                      <button
                        className={styles.iconBtn}
                        type="button"
                        onClick={(e) => handleExport(f, e)}
                        title="Compartir / Exportar"
                        disabled={!!busyDeleteId}
                      >
                        ⤴
                      </button>

                      <button
                        className={styles.dangerBtn}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          requestDelete(f.id, f.name);
                        }}
                        disabled={isBusy || !!busyDeleteId || !f.id}
                        title={
                          !f.id ? "No se puede eliminar sin ID" : "Eliminar"
                        }
                      >
                        {isBusy ? "…" : "Eliminar"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
