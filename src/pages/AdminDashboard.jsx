import { useEffect, useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../services/api";
import { AuthContext } from "../context/AuthContext";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { token } = useContext(AuthContext); // 🔹 leer token del contexto
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const load = async () => {
      // Si no hay token, ni siquiera intentes llamar al backend
      if (!token) {
        navigate("/login", { replace: true });
        return;
      }

      try {
        const data = await apiFetch("/admin/ping", {
          token, // 🔹 aquí va el token
        });
        setMessage(data.message || "Panel de administración");
      } catch (err) {
        setError(err.message || "No autorizado");
        navigate("/login", { replace: true });
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [navigate, token]);

  if (loading) return <div>Cargando panel de administrador...</div>;
  if (error) return <div>{error}</div>;

  return (
    <div>
      <h1>{message}</h1>
      <p>Esta es la pantalla exclusiva para administradores.</p>
    </div>
  );
}
