/* @vitest-environment jsdom */

import { afterEach, describe, expect, test, vi } from "vitest";

const { apiJson } = await import("../src/api");

describe("apiJson", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns parsed JSON for successful API responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8"
        }
      })
    );

    await expect(apiJson("/api/health")).resolves.toEqual({ ok: true });
  });

  test("shows a useful deployment error when the API returns html", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html><body>This is Vercel's 404 page</body></html>", {
        status: 404,
        statusText: "Not Found",
        headers: {
          "content-type": "text/html; charset=utf-8"
        }
      })
    );

    await expect(apiJson("/api/auth/status")).rejects.toThrow(
      "API deployment error: /api/auth/status returned 404 Not Found"
    );
  });
});
