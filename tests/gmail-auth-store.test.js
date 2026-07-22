const fs = require("fs");
const os = require("os");
const path = require("path");
const { createEncryptedAuthStore } = require("../server/gmailAuthStore");

const TEST_TOKEN_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("encrypted gmail auth store", () => {
  test("encrypts authorization before writing and never stores tokens as plaintext", async () => {
    const authDir = fs.mkdtempSync(path.join(os.tmpdir(), "gmail-auth-store-"));
    const authFile = path.join(authDir, "gmail-auth.enc");
    const store = createEncryptedAuthStore({
      filePath: authFile,
      encryptionKey: TEST_TOKEN_KEY
    });

    try {
      await store.save({
        refreshToken: "plain-refresh-token",
        address: "sender@example.com",
        grantedScopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"],
        connectedAt: "2026-07-22T00:00:00.000Z"
      });

      const raw = await fs.promises.readFile(authFile);
      expect(raw.equals(Buffer.from(JSON.stringify({
        refreshToken: "plain-refresh-token"
      })))).toBe(false);
      expect(raw.includes(Buffer.from("plain-refresh-token"))).toBe(false);
      expect(raw.includes(Buffer.from("sender@example.com"))).toBe(false);

      const restored = await store.load();
      expect(restored.refreshToken).toBe("plain-refresh-token");
      expect(restored.address).toBe("sender@example.com");
    } finally {
      await fs.promises.rm(authDir, { recursive: true, force: true });
    }
  });
});
