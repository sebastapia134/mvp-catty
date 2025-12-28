import { useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "../styles/Login.module.css";
import { AuthContext } from "../context/AuthContext";
import { apiFetch } from "../services/api";

export default function Login() {
  const navigate = useNavigate();
  const { setAuth, reloadUser } = useContext(AuthContext);

  const googleBtnRef = useRef(null);

  const [isLogin, setIsLogin] = useState(true);
  const [isSwitching, setIsSwitching] = useState(false);
  const [notification, setNotification] = useState("");

  const [loadingLogin, setLoadingLogin] = useState(false);
  const [loadingRegister, setLoadingRegister] = useState(false);

  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const showNotification = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(""), 5000);
  };

  const switchTo = (toLogin) => {
    if (isSwitching) return;
    if ((toLogin && isLogin) || (!toLogin && !isLogin)) return;

    setIsSwitching(true);
    setTimeout(() => {
      setIsLogin(toLogin);
      requestAnimationFrame(() => setTimeout(() => setIsSwitching(false), 20));
    }, 140);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoadingLogin(true);

    const email = e.target.email?.value?.trim();
    const password = e.target.password?.value || "";

    if (!email || !password) {
      showNotification("Completa todos los campos.");
      setLoadingLogin(false);
      return;
    }

    try {
      const data = await apiFetch("/auth/login", {
        method: "POST",
        body: { email, password },
      });

      setAuth(data.token);
      await reloadUser();
      navigate("/dashboard");
    } catch (err) {
      showNotification(err.message || "Error al iniciar sesión.");
    } finally {
      setLoadingLogin(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoadingRegister(true);

    const full_name = e.target.full_name?.value?.trim();
    const email = e.target.email?.value?.trim();
    const password = e.target.password?.value || "";
    const passwordConfirm = e.target.passwordConfirm?.value || "";

    if (!email || !password || !passwordConfirm) {
      showNotification("Completa todos los campos.");
      setLoadingRegister(false);
      return;
    }

    if (password !== passwordConfirm) {
      showNotification("Las contraseñas no coinciden.");
      setLoadingRegister(false);
      return;
    }

    try {
      const data = await apiFetch("/auth/register", {
        method: "POST",
        body: { email, password, full_name: full_name || null },
      });

      setAuth(data.token);
      await reloadUser();
      navigate("/dashboard");
    } catch (err) {
      showNotification(err.message || "Error en el registro.");
    } finally {
      setLoadingRegister(false);
    }
  };

  const handleGoogleResponse = async (response) => {
    try {
      const data = await apiFetch("/auth/google", {
        method: "POST",
        body: { id_token: response.credential },
      });

      setAuth(data.token);
      await reloadUser();
      navigate("/dashboard");
    } catch (err) {
      showNotification(err.message || "Error con Google.");
    }
  };

  useEffect(() => {
    if (!window.google || !googleBtnRef.current) return;

    googleBtnRef.current.innerHTML = "";
    window.google.accounts.id.initialize({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      callback: handleGoogleResponse,
    });

    window.google.accounts.id.renderButton(googleBtnRef.current, {
      theme: "outline",
      size: "large",
      text: isLogin ? "signin_with" : "signup_with",
      shape: "pill",
      logo_alignment: "left",
    });
  }, [isLogin]);

  return (
    <div className={styles.page}>
      {notification && <div className={styles.toast}>{notification}</div>}

      <div className={styles.panelRight} />

      <div className={styles.brand}>
        <div className={styles.brandTitle}>mvp-catty</div>
        <div className={styles.brandLine} />
        <div className={styles.brandSubtitle}>
          Accede para continuar con tus archivos.
        </div>
      </div>

      <button
        className={`${styles.tab} ${isLogin ? styles.active : ""}`}
        onClick={() => switchTo(true)}
        type="button"
      >
        Iniciar sesión
      </button>

      <button
        className={`${styles.tab} ${!isLogin ? styles.active : ""}`}
        onClick={() => switchTo(false)}
        type="button"
      >
        Registrarse
      </button>

      {isLogin ? (
        <form
          className={`${styles.form} ${styles.formLogin} ${
            isSwitching ? styles.formExit : styles.formEnter
          }`}
          onSubmit={handleLogin}
          noValidate
        >
          <div className={styles.group}>
            <label>Correo</label>
            <input type="email" name="email" autoComplete="email" required />

            <label>Contraseña</label>
            <div className={styles.passwordWrap}>
              <input
                type={showLoginPassword ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className={styles.eyeBtn}
                onClick={() => setShowLoginPassword((v) => !v)}
                aria-label={showLoginPassword ? "Ocultar" : "Mostrar"}
              >
                {showLoginPassword ? "Ocultar" : "Mostrar"}
              </button>
            </div>
          </div>
          <button
            className={styles.primaryBtn}
            type="submit"
            disabled={loadingLogin}
          >
            {loadingLogin ? "Entrando..." : "Entrar"}
          </button>

          <div ref={googleBtnRef} className={styles.googleBtn} />
        </form>
      ) : (
        <form
          className={`${styles.form} ${styles.formRegister} ${
            isSwitching ? styles.formExit : styles.formEnter
          }`}
          onSubmit={handleRegister}
          noValidate
        >
          <div className={styles.group}>
            <label>Nombre</label>
            <input type="text" name="full_name" autoComplete="name" />

            <label>Correo</label>
            <input type="email" name="email" autoComplete="email" required />

            <div className={styles.passwordRow}>
              <div className={styles.passwordCol}>
                <label>Contraseña</label>
                <div className={styles.passwordWrap}>
                  <input
                    type={showRegisterPassword ? "text" : "password"}
                    name="password"
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    className={styles.eyeBtn}
                    onClick={() => setShowRegisterPassword((v) => !v)}
                    aria-label={showRegisterPassword ? "Ocultar" : "Mostrar"}
                  >
                    {showRegisterPassword ? "Ocultar" : "Mostrar"}
                  </button>
                </div>
              </div>

              <div className={styles.passwordCol}>
                <label>Confirmar</label>
                <div className={styles.passwordWrap}>
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    name="passwordConfirm"
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    className={styles.eyeBtn}
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    aria-label={showConfirmPassword ? "Ocultar" : "Mostrar"}
                  >
                    {showConfirmPassword ? "Ocultar" : "Mostrar"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <button
            className={styles.primaryBtn}
            type="submit"
            disabled={loadingRegister}
          >
            {loadingRegister ? "Creando..." : "Crear cuenta"}
          </button>

          <div ref={googleBtnRef} className={styles.googleBtn} />
        </form>
      )}
    </div>
  );
}
