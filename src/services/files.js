import { apiFetch } from "./api";

export async function listFiles(token) {
  return apiFetch("/files", { token });
}

export async function deleteFile(fileId, token) {
  return apiFetch(`/files/${fileId}`, { method: "DELETE", token });
}

export function getFile(idOrCode, token) {
  return apiFetch(`/files/${idOrCode}`, { token });
}

export async function downloadFileXlsx(fileId, token) {
  return apiFetch(`/files/${fileId}/export.xlsx`, {
    token,
    responseType: "blob",
    headers: {
      Accept:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}
