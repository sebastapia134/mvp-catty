import { apiFetch } from "./api";

export async function listFiles(token) {
  return apiFetch("/files", { token });
}

export async function deleteFile(fileId, token) {
  return apiFetch(`/files/${fileId}`, { method: "DELETE", token });
}
