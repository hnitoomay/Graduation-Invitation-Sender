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
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    const body = await response.text();
    if (contentType.includes("application/json")) {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new Error(`API request failed with ${response.status}.`);
      }
      throw new Error(parsed.error || `Request failed with ${response.status}`);
    }
    throw new Error(
      `API deployment error: ${path} returned ${response.status} ${response.statusText || ""}`.trim()
    );
  }

  if (!contentType.includes("application/json")) {
    await response.text();
    throw new Error(`API deployment error: ${path} did not return JSON.`);
  }

  return response.json();
}
