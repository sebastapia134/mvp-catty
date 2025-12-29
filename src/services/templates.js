import { apiFetch } from "./api";

export async function listTemplates(token) {
  return apiFetch("/templates", { token });
}
