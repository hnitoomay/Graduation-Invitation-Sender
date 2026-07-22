export const API_BASE = import.meta.env.DEV
  ? "http://localhost:3001"
  : "";

export async function apiFetch(path, options = {}) {
  return fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include"
  });
}

export async function apiJson(path, options = {}) {
  const response = await apiFetch(path, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Request failed with ${response.status}`);
  }
  return data;
}
