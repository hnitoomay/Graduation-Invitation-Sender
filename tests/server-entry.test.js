const { spawn } = require("child_process");

async function waitForServer(baseUrl, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // The dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Timed out waiting for server/index.js to start.");
}

describe("server entry integration", () => {
  test(
    "server/index.js serves /api/auth/google with state and the required scopes",
    async () => {
      const port = 3300 + Math.floor(Math.random() * 200);
    const host = "127.0.0.1";
    const baseUrl = `http://${host}:${port}`;
    let stderr = "";
    const child = spawn(process.execPath, ["server/index.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        HOST: host,
        NODE_ENV: "test",
        APP_URL: baseUrl,
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
        TOKEN_ENCRYPTION_KEY:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        ALLOWED_GMAIL_SENDER: "student_registry@mystrategyfirst.com"
      },
      stdio: ["ignore", "ignore", "pipe"]
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    try {
      await waitForServer(baseUrl, 12000);

      const response = await fetch(`${baseUrl}/api/auth/google`, {
        headers: {
          Origin: "http://localhost:5173"
        }
      });
      const body = await response.json();
      const url = new URL(body.url);

      expect(response.status).toBe(200);
      expect(url.origin).toBe("https://accounts.google.com");
      expect(url.searchParams.get("state")).toBeTruthy();
      expect(url.searchParams.get("access_type")).toBe("offline");
      expect(url.searchParams.get("prompt")).toBe("consent");
      expect(url.searchParams.get("include_granted_scopes")).toBe("true");
      expect(url.searchParams.get("scope")).toContain("openid");
      expect(url.searchParams.get("scope")).toContain("email");
      expect(url.searchParams.get("scope")).toContain(
        "https://www.googleapis.com/auth/gmail.send"
      );
    } finally {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
      if (stderr) {
        stderr = stderr.trim();
      }
    }
      if (stderr) {
        throw new Error(stderr);
      }
    },
    15000
  );
});
