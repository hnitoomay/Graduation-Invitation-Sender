const fs = require("fs");
const os = require("os");
const path = require("path");
const { createApp } = require("../server/app");
const { createEncryptedAuthStore, hashOAuthClient } = require("../server/gmailAuthStore");

const TEST_TOKEN_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TEST_CLIENT_ID = "client-id";
const TEST_CLIENT_SECRET = "client-secret";
const TEST_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.send"];

function makeTempAuthFile() {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "gmail-auth-")),
    "gmail-auth.enc"
  );
}

async function startTestServer(options = {}) {
  const authFile = options.authFile || makeTempAuthFile();
  let exchangeCallCount = 0;
  let revokeCallCount = 0;
  let refreshCallCount = 0;

  const { app, shutdown, authStore } = createApp({
    tokenEncryptionKey: options.tokenEncryptionKey ?? TEST_TOKEN_KEY,
    gmailAuthFile: authFile,
    googleClientId: TEST_CLIENT_ID,
    googleClientSecret: TEST_CLIENT_SECRET,
    exchangeCodeForTokens: async (...args) => {
      exchangeCallCount += 1;
      if (options.exchangeCodeForTokens) {
        return options.exchangeCodeForTokens(...args);
      }
      return {
        tokens: {
          access_token: "temporary-access-token",
          refresh_token: "persistent-refresh-token",
          id_token: "temporary-id-token"
        },
        emailAddress: "sender@example.com",
        grantedScopes: TEST_SCOPES,
        canSend: true,
        missingScopes: []
      };
    },
    refreshAccessToken: async (...args) => {
      refreshCallCount += 1;
      if (options.refreshAccessToken) {
        return options.refreshAccessToken(...args);
      }
      return {
        accessToken: "restored-access-token",
        grantedScopes: TEST_SCOPES
      };
    },
    revokeTokens: async (...args) => {
      revokeCallCount += 1;
      if (options.revokeTokens) {
        return options.revokeTokens(...args);
      }
      return undefined;
    }
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  return {
    authFile,
    authStore,
    baseUrl: `http://localhost:${server.address().port}`,
    getExchangeCallCount: () => exchangeCallCount,
    getRefreshCallCount: () => refreshCallCount,
    getRevokeCallCount: () => revokeCallCount,
    async close(options = {}) {
      await shutdown();
      await new Promise((resolve) => server.close(resolve));
      if (!options.preserveAuthDir) {
        await fs.promises.rm(path.dirname(authFile), { recursive: true, force: true });
      }
    }
  };
}

async function connectGmail(server) {
  const startResponse = await fetch(`${server.baseUrl}/api/auth/google`, {
    headers: {
      Origin: "http://localhost:5173"
    }
  });
  const cookie = startResponse.headers.get("set-cookie").split(";")[0];
  const startJson = await startResponse.json();
  const state = new URL(startJson.url).searchParams.get("state");

  const callbackResponse = await fetch(
    `${server.baseUrl}/api/auth/google/callback?code=fake-code&state=${encodeURIComponent(state)}`,
    {
      headers: {
        Cookie: cookie
      },
      redirect: "manual"
    }
  );

  return { cookie, callbackResponse };
}

describe("persistent gmail authorization", () => {
  test("stores Gmail auth persistently, restores after restart, and keeps uploads temporary", async () => {
    const firstServer = await startTestServer();

    try {
      const { cookie, callbackResponse } = await connectGmail(firstServer);
      expect(callbackResponse.status).toBe(302);
      expect(callbackResponse.headers.get("location")).toBe("http://localhost:5173?gmail=connected");
      expect(firstServer.getExchangeCallCount()).toBe(1);

      const savedBuffer = await fs.promises.readFile(firstServer.authFile);
      expect(savedBuffer.includes(Buffer.from("persistent-refresh-token"))).toBe(false);

      const workbookBytes = await fs.promises.readFile(
        path.join(__dirname, "..", "Graduation List 2026 Bachelor's Student.xlsx")
      );
      const workbookForm = new FormData();
      workbookForm.append(
        "workbook",
        new Blob([workbookBytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        }),
        "students.xlsx"
      );
      const uploadResponse = await fetch(`${firstServer.baseUrl}/api/upload/workbook`, {
        method: "POST",
        headers: {
          Cookie: cookie
        },
        body: workbookForm
      });
      const uploadJson = await uploadResponse.json();
      expect(uploadJson.workbookLoaded).toBe(true);
    } finally {
      await firstServer.close({ preserveAuthDir: true });
    }

    const secondServer = await startTestServer({ authFile: firstServer.authFile });
    try {
      const statusResponse = await fetch(`${secondServer.baseUrl}/api/auth/status`, {
        headers: {
          Origin: "http://localhost:5173"
        }
      });
      const statusJson = await statusResponse.json();

      expect(secondServer.getRefreshCallCount()).toBe(1);
      expect(statusResponse.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
      expect(statusJson).toEqual({
        connected: true,
        address: "sender@example.com",
        canSend: true,
        missingScopes: [],
        error: ""
      });

      const sessionResponse = await fetch(`${secondServer.baseUrl}/api/session`);
      const sessionJson = await sessionResponse.json();
      expect(sessionJson.gmail.connected).toBe(true);
      expect(sessionJson.workbookLoaded).toBe(false);
      expect(sessionJson.summary.sentDuringSession).toBe(0);
    } finally {
      await secondServer.close();
    }
  });

  test("returns reconnect guidance when Google omits refresh_token on first persistent connection", async () => {
    const server = await startTestServer({
      exchangeCodeForTokens: async () => ({
        tokens: {
          access_token: "temporary-access-token",
          id_token: "temporary-id-token"
        },
        emailAddress: "sender@example.com",
        grantedScopes: TEST_SCOPES,
        canSend: true,
        missingScopes: []
      })
    });

    try {
      const { cookie, callbackResponse } = await connectGmail(server);
      expect(callbackResponse.status).toBe(302);
      expect(callbackResponse.headers.get("location")).toBe(
        "http://localhost:5173?gmail=error&reason=reconnect_required"
      );
      expect(fs.existsSync(server.authFile)).toBe(false);

      const statusResponse = await fetch(`${server.baseUrl}/api/auth/status`, {
        headers: {
          Cookie: cookie
        }
      });
      const statusJson = await statusResponse.json();
      expect(statusJson.connected).toBe(false);
    } finally {
      await server.close();
    }
  });

  test("invalid_grant deletes unusable saved authorization", async () => {
    const authFile = makeTempAuthFile();
    const authStore = createEncryptedAuthStore({
      filePath: authFile,
      encryptionKey: TEST_TOKEN_KEY
    });
    await authStore.save({
      refreshToken: "persistent-refresh-token",
      address: "sender@example.com",
      grantedScopes: TEST_SCOPES,
      connectedAt: "2026-07-22T00:00:00.000Z",
      oauthClientHash: hashOAuthClient(TEST_CLIENT_ID, TEST_CLIENT_SECRET)
    });

    const server = await startTestServer({
      authFile,
      refreshAccessToken: async () => {
        const error = new Error("invalid_grant");
        error.response = { data: { error: "invalid_grant" } };
        throw error;
      }
    });

    try {
      const statusResponse = await fetch(`${server.baseUrl}/api/auth/status`);
      const statusJson = await statusResponse.json();
      expect(statusJson.connected).toBe(false);
      expect(fs.existsSync(authFile)).toBe(false);
    } finally {
      await server.close();
    }
  });

  test("temporary token refresh errors keep saved authorization on disk", async () => {
    const authFile = makeTempAuthFile();
    const authStore = createEncryptedAuthStore({
      filePath: authFile,
      encryptionKey: TEST_TOKEN_KEY
    });
    await authStore.save({
      refreshToken: "persistent-refresh-token",
      address: "sender@example.com",
      grantedScopes: TEST_SCOPES,
      connectedAt: "2026-07-22T00:00:00.000Z",
      oauthClientHash: hashOAuthClient(TEST_CLIENT_ID, TEST_CLIENT_SECRET)
    });

    const server = await startTestServer({
      authFile,
      refreshAccessToken: async () => {
        const error = new Error("temporary network failure");
        error.code = "ETIMEDOUT";
        throw error;
      }
    });

    try {
      const statusResponse = await fetch(`${server.baseUrl}/api/auth/status`);
      const statusJson = await statusResponse.json();
      expect(statusJson.connected).toBe(true);
      expect(statusJson.canSend).toBe(false);
      expect(fs.existsSync(authFile)).toBe(true);
    } finally {
      await server.close();
    }
  });

  test("missing or incorrect encryption keys fail safely", async () => {
    const authFile = makeTempAuthFile();
    const authStore = createEncryptedAuthStore({
      filePath: authFile,
      encryptionKey: TEST_TOKEN_KEY
    });
    await authStore.save({
      refreshToken: "persistent-refresh-token",
      address: "sender@example.com",
      grantedScopes: TEST_SCOPES,
      connectedAt: "2026-07-22T00:00:00.000Z",
      oauthClientHash: hashOAuthClient(TEST_CLIENT_ID, TEST_CLIENT_SECRET)
    });

    const wrongKeyServer = await startTestServer({
      authFile,
      tokenEncryptionKey: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    });
    try {
      const wrongKeyResponse = await fetch(`${wrongKeyServer.baseUrl}/api/auth/status`);
      const wrongKeyJson = await wrongKeyResponse.json();
      expect(wrongKeyJson.connected).toBe(false);
    } finally {
      await wrongKeyServer.close();
    }

    const missingKeyServer = await startTestServer({
      authFile,
      tokenEncryptionKey: ""
    });
    try {
      const startResponse = await fetch(`${missingKeyServer.baseUrl}/api/auth/google`);
      const startJson = await startResponse.json();
      expect(startResponse.status).toBe(400);
      expect(startJson.error).toMatch(/TOKEN_ENCRYPTION_KEY/);
    } finally {
      await missingKeyServer.close();
    }
  });

  test("disconnect revokes tokens and deletes saved authorization", async () => {
    const server = await startTestServer();

    try {
      const { cookie } = await connectGmail(server);
      expect(fs.existsSync(server.authFile)).toBe(true);

      const disconnectResponse = await fetch(`${server.baseUrl}/api/auth/google/disconnect`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: "{}"
      });
      const disconnectJson = await disconnectResponse.json();

      expect(disconnectJson.gmail.connected).toBe(false);
      expect(server.getRevokeCallCount()).toBe(1);
      expect(fs.existsSync(server.authFile)).toBe(false);
    } finally {
      await server.close();
    }
  });
});
