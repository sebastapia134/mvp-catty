const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

// apiFetch soporta: json (default), text, blob
export async function apiFetch(
  path,
  {
    method = "GET",
    body,
    token,
    headers: extraHeaders = {},
    responseType = "json", // "json" | "text" | "blob"
  } = {}
) {
  const headers = { ...extraHeaders };

  if (token) headers.Authorization = `Bearer ${token}`;

  // Solo enviar Content-Type si realmente mandas body JSON
  const hasBody = body !== undefined && body !== null;
  const isFormData =
    typeof FormData !== "undefined" && body instanceof FormData;

  if (hasBody && !isFormData) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: hasBody ? (isFormData ? body : JSON.stringify(body)) : undefined,
  });

  // Errores: intenta leer algo útil sin asumir JSON
  if (!res.ok) {
    const ct = res.headers.get("content-type") || "";
    let msg = `Error (${res.status})`;

    try {
      if (ct.includes("application/json")) {
        const data = await res.json();
        msg = data?.detail || data?.message || msg;
      } else {
        const text = await res.text();
        if (text) msg = text;
      }
    } catch {
      // no-op
    }
    throw new Error(msg);
  }

  // Respuestas OK según tipo
  if (responseType === "blob") return await res.blob();
  if (responseType === "text") return await res.text();

  // json por defecto
  if (res.status === 204) return null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return await res.json();

  // fallback por si el backend responde sin content-type json
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}
