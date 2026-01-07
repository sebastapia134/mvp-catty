import { Routes, Route, Navigate } from "react-router-dom";
import { useContext } from "react";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import NewFile from "./pages/NewFile";
import FileDetail from "./pages/FileDetail";
import AdminDashboard from "./pages/AdminDashboard";
import { AuthContext } from "./context/AuthContext";

function Protected({ children }) {
  const { token, loadingUser } = useContext(AuthContext);
  if (loadingUser) return null;
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        path="/dashboard"
        element={
          <Protected>
            <Dashboard />
          </Protected>
        }
      />

      <Route
        path="/files/new"
        element={
          <Protected>
            <NewFile />
          </Protected>
        }
      />

      <Route
        path="/files/:fileId"
        element={
          <Protected>
            <FileDetail />
          </Protected>
        }
      />

      <Route
        path="/admin"
        element={
          <Protected>
            <AdminDashboard />
          </Protected>
        }
      />

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
