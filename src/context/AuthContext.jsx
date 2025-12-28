import { createContext, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../services/api";

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem("token") || "");
  const [user, setUser] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);

  const setAuth = (nextToken) => {
    setToken(nextToken);
    if (nextToken) localStorage.setItem("token", nextToken);
    else localStorage.removeItem("token");
  };

  const reloadUser = async () => {
    if (!token) {
      setUser(null);
      setLoadingUser(false);
      return;
    }
    try {
      const me = await apiFetch("/auth/me", { token });
      setUser(me);
    } catch {
      setAuth("");
      setUser(null);
    } finally {
      setLoadingUser(false);
    }
  };

  useEffect(() => {
    setLoadingUser(true);
    reloadUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const value = useMemo(
    () => ({ token, user, loadingUser, setAuth, reloadUser }),
    [token, user, loadingUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
