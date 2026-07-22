const fs = require("fs");
const path = require("path");
const { createApp } = require("../server/app");
const { validateStudentPayload } = require("../server/gmailService");

function createMockGmailService(overrides = {}) {
  return {
    buildStateValue() {
      return "state-123";
    },
    buildAuthUrl(_redirectUri, state) {
      return `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`;
    },
    async exchangeCodeForTokens() {
      if (overrides.exchangeCodeForTokens) {
        return overrides.exchangeCodeForTokens();
      }
      return {
        tokens: {
          refresh_token: "refresh-token-123",
          access_token: "access-token-123",
          scope: "openid email https://www.googleapis.com/auth/gmail.send"
        },
        emailAddress: "student_registry@mystrategyfirst.com",
        grantedScopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"],
        missingScopes: []
      };
    },
    sanitizeAuthBundle(auth) {
      return {
        tokens: {
          refresh_token: auth.tokens?.refresh_token || "",
          access_token: auth.tokens?.access_token || "",
          scope: auth.tokens?.scope || "openid email https://www.googleapis.com/auth/gmail.send"
        },
        verifiedEmail: auth.verifiedEmail || "student_registry@mystrategyfirst.com",
        grantedScopes:
          auth.grantedScopes || ["openid", "email", "https://www.googleapis.com/auth/gmail.send"]
      };
    },
    async verifyConnectedSender(auth) {
      if (overrides.verifyConnectedSender) {
        return overrides.verifyConnectedSender(auth);
      }
      return {
        connected: true,
        address: "student_registry@mystrategyfirst.com",
        canSend: true,
        auth
      };
    },
    async sendInvitation(payload, auth) {
      validateStudentPayload(payload);
      if (overrides.sendInvitation) {
        return overrides.sendInvitation(payload, auth);
      }
      return {
        messageId: `demo-${payload.sficId}`,
        auth
      };
    },
    isInsufficientScopeError(error) {
      return /insufficient authentication scopes/i.test(String(error?.message || ""));
    }
  };
}

async function startServer(overrides = {}) {
  const appOverrides = {
    tokenEncryptionKey:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    allowedGmailSender: "student_registry@mystrategyfirst.com",
    appUrl: "http://localhost:3001",
    nodeEnv: "test",
    ...overrides
  };
  if (!Object.prototype.hasOwnProperty.call(overrides, "gmailService")) {
    appOverrides.gmailService = createMockGmailService();
  }
  const { app } = createApp(appOverrides);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

function getCookieHeader(response) {
  const setCookies = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return setCookies.map((value) => value.split(";")[0]).join("; ");
}

function makeImageFormData({ sizeBytes = 1024, fileName = "2022B2177_Ou Ou Aung.jpg" } = {}) {
  const formData = new FormData();
  formData.append("studentName", "Ou Ou Aung");
  formData.append("recipientEmail", "student@example.com");
  formData.append("sficId", "2022B2177");
  formData.append("sessionKey", "A");
  formData.append("subject", "Graduation Ceremony 2026 Invitation - Ou Ou Aung");
  formData.append("jobId", "job-1");
  formData.append("idempotencyKey", "job-1:A::2022B2177");
  formData.append(
    "invitationImage",
    new Blob([new Uint8Array(sizeBytes)], { type: "image/jpeg" }),
    fileName
  );
  return formData;
}

describe("server application", () => {
  test("starts and serves /api/health even when Picture1.png is unavailable from the filesystem", async () => {
    const originalReadFile = fs.promises.readFile.bind(fs.promises);
    const originalReadFileSync = fs.readFileSync.bind(fs);
    const pictureReadSpy = vi
      .spyOn(fs.promises, "readFile")
      .mockImplementation(async (filePath, ...args) => {
        if (String(filePath).includes("Picture1.png")) {
          throw new Error("Picture1.png is unavailable.");
        }
        return originalReadFile(filePath, ...args);
      });
    const readFileSyncSpy = vi
      .spyOn(fs, "readFileSync")
      .mockImplementation((filePath, ...args) => {
        if (String(filePath).includes("Picture1.png")) {
          throw new Error("Picture1.png is unavailable.");
        }
        return originalReadFileSync(filePath, ...args);
      });
    const server = await startServer({ gmailService: null });

    try {
      const response = await fetch(`${server.baseUrl}/api/health`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ ok: true });
      expect(
        pictureReadSpy.mock.calls.some(([filePath]) => String(filePath).includes("Picture1.png"))
      ).toBe(false);
      expect(
        readFileSyncSpy.mock.calls.some(([filePath]) => String(filePath).includes("Picture1.png"))
      ).toBe(false);
    } finally {
      pictureReadSpy.mockRestore();
      readFileSyncSpy.mockRestore();
      await server.close();
    }
  });

  test("serves /api/health as JSON", async () => {
    const server = await startServer();

    try {
      const response = await fetch(`${server.baseUrl}/api/health`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(body).toEqual({ ok: true });
    } finally {
      await server.close();
    }
  });

  test("reports disconnected gmail safely before oauth", async () => {
    const server = await startServer();

    try {
      const statusResponse = await fetch(`${server.baseUrl}/api/auth/status`);
      const statusJson = await statusResponse.json();
      expect(statusResponse.headers.get("content-type")).toContain("application/json");
      expect(statusJson.connected).toBe(false);
      expect(statusJson.address).toBe("");
    } finally {
      await server.close();
    }
  });

  test("connects gmail through oauth callback and persists the encrypted cookie", async () => {
    const server = await startServer();

    try {
      const startResponse = await fetch(`${server.baseUrl}/api/auth/google`, {
        headers: {
          Origin: "http://localhost:5173"
        }
      });
      const startJson = await startResponse.json();
      const stateCookie = getCookieHeader(startResponse);

      expect(startResponse.status).toBe(200);
      expect(startJson.url).toContain("state=state-123");

      const callbackResponse = await fetch(
        `${server.baseUrl}/api/auth/google/callback?code=fake-code&state=state-123`,
        {
          headers: {
            Cookie: stateCookie
          },
          redirect: "manual"
        }
      );

      expect(callbackResponse.status).toBe(302);
      expect(callbackResponse.headers.get("location")).toBe(
        "http://localhost:5173/?gmail=connected"
      );
      expect(callbackResponse.headers.get("set-cookie")).not.toContain("refresh-token-123");

      const statusResponse = await fetch(`${server.baseUrl}/api/auth/status`, {
        headers: {
          Cookie: getCookieHeader(callbackResponse)
        }
      });
      const statusJson = await statusResponse.json();
      expect(statusJson.connected).toBe(true);
      expect(statusJson.address).toBe("student_registry@mystrategyfirst.com");
      expect(statusJson.canSend).toBe(true);
    } finally {
      await server.close();
    }
  });

  test("rejects oauth connection when the Google account does not match ALLOWED_GMAIL_SENDER", async () => {
    const server = await startServer({
      gmailService: createMockGmailService({
        async exchangeCodeForTokens() {
          return {
            tokens: {
              refresh_token: "refresh-token-123",
              access_token: "access-token-123"
            },
            emailAddress: "other@gmail.com",
            grantedScopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"],
            missingScopes: []
          };
        }
      })
    });

    try {
      const startResponse = await fetch(`${server.baseUrl}/api/auth/google`, {
        headers: {
          Origin: "http://localhost:5173"
        }
      });
      const stateCookie = getCookieHeader(startResponse);

      const callbackResponse = await fetch(
        `${server.baseUrl}/api/auth/google/callback?code=fake-code&state=state-123`,
        {
          headers: {
            Cookie: stateCookie
          },
          redirect: "manual"
        }
      );

      expect(callbackResponse.status).toBe(302);
      expect(callbackResponse.headers.get("location")).toBe(
        "http://localhost:5173/?gmail=wrong_account"
      );
    } finally {
      await server.close();
    }
  });

  test("does not save an auth cookie when gmail.send is genuinely missing", async () => {
    const server = await startServer({
      gmailService: createMockGmailService({
        async exchangeCodeForTokens() {
          return {
            tokens: {
              refresh_token: "refresh-token-123",
              access_token: "access-token-123"
            },
            emailAddress: "student_registry@mystrategyfirst.com",
            grantedScopes: ["openid", "email"],
            missingScopes: ["https://www.googleapis.com/auth/gmail.send"]
          };
        }
      })
    });

    try {
      const startResponse = await fetch(`${server.baseUrl}/api/auth/google`, {
        headers: {
          Origin: "http://localhost:5173"
        }
      });
      const stateCookie = getCookieHeader(startResponse);

      const callbackResponse = await fetch(
        `${server.baseUrl}/api/auth/google/callback?code=fake-code&state=state-123`,
        {
          headers: {
            Cookie: stateCookie
          },
          redirect: "manual"
        }
      );

      expect(callbackResponse.status).toBe(302);
      expect(callbackResponse.headers.get("location")).toBe(
        "http://localhost:5173/?gmail=missing_permission"
      );
      expect(callbackResponse.headers.get("set-cookie") || "").not.toContain("refresh-token-123");

      const statusResponse = await fetch(`${server.baseUrl}/api/auth/status`, {
        headers: {
          Cookie: getCookieHeader(callbackResponse)
        }
      });
      const statusJson = await statusResponse.json();

      expect(statusJson).toEqual({
        connected: false,
        address: ""
      });
    } finally {
      await server.close();
    }
  });

  test("rejects send-one requests without same-origin validation", async () => {
    const server = await startServer();

    try {
      const sendResponse = await fetch(`${server.baseUrl}/api/send-one`, {
        method: "POST",
        body: makeImageFormData()
      });
      const sendJson = await sendResponse.json();

      expect(sendResponse.status).toBe(403);
      expect(sendJson.error).toMatch(/origin is not allowed/i);
    } finally {
      await server.close();
    }
  });

  test("rejects invitation images larger than 3 MB", async () => {
    const server = await startServer();

    try {
      const startResponse = await fetch(`${server.baseUrl}/api/auth/google`, {
        headers: {
          Origin: "http://localhost:5173"
        }
      });
      const stateCookie = getCookieHeader(startResponse);
      const callbackResponse = await fetch(
        `${server.baseUrl}/api/auth/google/callback?code=fake-code&state=state-123`,
        {
          headers: {
            Cookie: stateCookie
          },
          redirect: "manual"
        }
      );
      const authCookie = getCookieHeader(callbackResponse);

      const sendResponse = await fetch(`${server.baseUrl}/api/send-one`, {
        method: "POST",
        headers: {
          Cookie: authCookie,
          Origin: "http://localhost:5173"
        },
        body: makeImageFormData({ sizeBytes: 3 * 1024 * 1024 + 1 })
      });
      const sendJson = await sendResponse.json();

      expect(sendResponse.status).toBe(400);
      expect(sendJson.error).toMatch(/3 MB or smaller/);
    } finally {
      await server.close();
    }
  });

  test("accepts one valid image per request, reuses idempotency, and disconnect clears the cookie", async () => {
    const calls = [];
    const server = await startServer({
      gmailService: createMockGmailService({
        async sendInvitation(payload, tokens) {
          calls.push(payload.imageFile.originalname);
          return {
            messageId: "message-1",
            auth: tokens
          };
        }
      })
    });

    try {
      const startResponse = await fetch(`${server.baseUrl}/api/auth/google`, {
        headers: {
          Origin: "http://localhost:5173"
        }
      });
      const stateCookie = getCookieHeader(startResponse);
      const callbackResponse = await fetch(
        `${server.baseUrl}/api/auth/google/callback?code=fake-code&state=state-123`,
        {
          headers: {
            Cookie: stateCookie
          },
          redirect: "manual"
        }
      );
      const authCookie = getCookieHeader(callbackResponse);

      const firstResponse = await fetch(`${server.baseUrl}/api/send-one`, {
        method: "POST",
        headers: {
          Cookie: authCookie,
          Origin: "http://localhost:5173"
        },
        body: makeImageFormData()
      });
      const secondResponse = await fetch(`${server.baseUrl}/api/send-one`, {
        method: "POST",
        headers: {
          Cookie: authCookie,
          Origin: "http://localhost:5173"
        },
        body: makeImageFormData()
      });

      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(200);
      expect(calls).toEqual(["2022B2177_Ou Ou Aung.jpg"]);

      const disconnectResponse = await fetch(`${server.baseUrl}/api/auth/google/disconnect`, {
        method: "POST",
        headers: {
          Cookie: authCookie,
          Origin: "http://localhost:5173",
          "Content-Type": "application/json"
        },
        body: "{}"
      });
      const disconnectJson = await disconnectResponse.json();

      expect(disconnectJson.connected).toBe(false);
    } finally {
      await server.close();
    }
  });

  test("clears the auth cookie automatically after an insufficient-scope send failure", async () => {
    const server = await startServer({
      gmailService: createMockGmailService({
        async sendInvitation() {
          const error = new Error("Request had insufficient authentication scopes.");
          error.statusCode = 403;
          throw error;
        }
      })
    });

    try {
      const startResponse = await fetch(`${server.baseUrl}/api/auth/google`, {
        headers: {
          Origin: "http://localhost:5173"
        }
      });
      const stateCookie = getCookieHeader(startResponse);
      const callbackResponse = await fetch(
        `${server.baseUrl}/api/auth/google/callback?code=fake-code&state=state-123`,
        {
          headers: {
            Cookie: stateCookie
          },
          redirect: "manual"
        }
      );
      const authCookie = getCookieHeader(callbackResponse);

      const sendResponse = await fetch(`${server.baseUrl}/api/send-one`, {
        method: "POST",
        headers: {
          Cookie: authCookie,
          Origin: "http://localhost:5173"
        },
        body: makeImageFormData()
      });
      const sendJson = await sendResponse.json();
      const setCookie = sendResponse.headers.get("set-cookie") || "";

      expect(sendResponse.status).toBe(403);
      expect(sendJson.error).toMatch(/insufficient authentication scopes/i);
      expect(setCookie).toContain("gmail_oauth=");
      expect(setCookie).toMatch(/Max-Age=0|Expires=/i);
    } finally {
      await server.close();
    }
  });

  test("clears stale invalid cookies and returns a disconnected empty-address status", async () => {
    const server = await startServer();

    try {
      const statusResponse = await fetch(`${server.baseUrl}/api/auth/status`, {
        headers: {
          Cookie: "gmail_oauth=not-a-valid-cookie"
        }
      });
      const statusJson = await statusResponse.json();
      const setCookie = statusResponse.headers.get("set-cookie") || "";

      expect(statusJson).toEqual({
        connected: false,
        address: ""
      });
      expect(setCookie).toContain("gmail_oauth=");
      expect(setCookie).toMatch(/Max-Age=0|Expires=/i);
    } finally {
      await server.close();
    }
  });

  test("contains no local token persistence file and no blob or database dependency", async () => {
    const packageJson = JSON.parse(
      await fs.promises.readFile(path.join(__dirname, "..", "package.json"), "utf8")
    );

    expect(fs.existsSync(path.join(__dirname, "..", "server", "gmailAuthStore.js"))).toBe(false);
    expect(packageJson.dependencies).not.toHaveProperty("@vercel/blob");
    expect(packageJson.dependencies).not.toHaveProperty("redis");
    expect(packageJson.dependencies).not.toHaveProperty("ioredis");
    expect(packageJson.dependencies).not.toHaveProperty("pg");
    expect(packageJson.dependencies).not.toHaveProperty("mysql2");
  });
});
