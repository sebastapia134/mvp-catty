import { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "../styles/NewFile.module.css";
import { AuthContext } from "../context/AuthContext";
import { listTemplates } from "../services/templates";
import { apiFetch } from "../services/api";

export default function NewFile() {
  const navigate = useNavigate();
  const { user, token, setAuth } = useContext(AuthContext);

  const [toast, setToast] = useState("");

  const [templates, setTemplates] = useState([]);
  const [loadingTpl, setLoadingTpl] = useState(true);

  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [isPublic, setIsPublic] = useState(false);

  const [creating, setCreating] = useState(false);

  const showToast = (msg) => {
    setToast(msg);
    window.clearTimeout(window.__cattyToastTimer);
    window.__cattyToastTimer = window.setTimeout(() => setToast(""), 3200);
  };

  const displayName = user?.full_name || user?.email || "usuario";
  const initials = (displayName || "U").trim().slice(0, 1).toUpperCase();

  const tplOptions = useMemo(() => {
    const data = Array.isArray(templates) ? templates : templates?.items || [];
    return data;
  }, [templates]);

  useEffect(() => {
    const load = async () => {
      setLoadingTpl(true);
      try {
        const data = await listTemplates(token);
        const arr = Array.isArray(data) ? data : data?.items || [];
        setTemplates(arr);
        if (arr.length && !templateId) setTemplateId(arr[0].id);
      } catch {
        setTemplates([]);
        showToast("No se pudieron cargar plantillas.");
      } finally {
        setLoadingTpl(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreate = async (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) {
      showToast("Pon un nombre para el archivo.");
      return;
    }
    if (!templateId) {
      showToast("Selecciona una plantilla.");
      return;
    }

    setCreating(true);
    try {
      await apiFetch("/files", {
        method: "POST",
        token,
        body: {
          name: n,
          template_id: templateId,
          is_public: isPublic,
        },
      });

      showToast("Archivo creado.");
      navigate("/dashboard");
    } catch (err) {
      showToast(err?.message || "No se pudo crear el archivo.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={styles.page}>
      {toast && <div className={styles.toast}>{toast}</div>}

      <header className={styles.header}>
        <button
          className={styles.back}
          type="button"
          onClick={() => navigate("/dashboard")}
        >
          ← Volver
        </button>

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
        <div className={styles.card}>
          <h1 className={styles.h1}>Crear nuevo archivo</h1>
          <p className={styles.sub}>
            Crea un archivo a partir de una plantilla y guárdalo en tu cuenta.
          </p>

          <form className={styles.form} onSubmit={onCreate}>
            <div className={styles.field}>
              <label>Nombre del archivo</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Evaluación de usabilidad - Enero"
                maxLength={120}
              />
            </div>

            <div className={styles.field}>
              <label>Seleccionar plantilla</label>
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                disabled={loadingTpl}
              >
                {loadingTpl ? (
                  <option value="">Cargando plantillas…</option>
                ) : tplOptions.length === 0 ? (
                  <option value="">No hay plantillas</option>
                ) : (
                  tplOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.code})
                    </option>
                  ))
                )}
              </select>

              {!loadingTpl && tplOptions.length === 0 && (
                <div className={styles.helper}>
                  No tienes plantillas activas en la base de datos.
                </div>
              )}
            </div>

            <div className={styles.field}>
              <label>Visibilidad</label>
              <div className={styles.toggleRow}>
                <button
                  type="button"
                  className={`${styles.pill} ${
                    !isPublic ? styles.pillActive : ""
                  }`}
                  onClick={() => setIsPublic(false)}
                >
                  Privado
                </button>
                <button
                  type="button"
                  className={`${styles.pill} ${
                    isPublic ? styles.pillActive : ""
                  }`}
                  onClick={() => setIsPublic(true)}
                >
                  Público
                </button>
              </div>
              <div className={styles.helper}>
                Público permite link compartible (si luego activas compartir).
              </div>
            </div>

            <button
              className={styles.primary}
              type="submit"
              disabled={creating || loadingTpl || !templateId}
            >
              {creating ? "Creando…" : "Crear"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
