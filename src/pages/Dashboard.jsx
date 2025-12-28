import { useContext } from "react";
import { AuthContext } from "../context/AuthContext";

export default function Dashboard() {
  const { user, setAuth } = useContext(AuthContext);

  return (
    <div style={{ padding: 24, fontFamily: "Coolvetica, sans-serif" }}>
      <h1>Dashboard</h1>
      <p>{user?.email}</p>
      <button onClick={() => setAuth("")}>Cerrar sesión</button>
    </div>
  );
}
