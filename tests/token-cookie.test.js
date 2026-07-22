const { createTokenCookieStore, parseEncryptionKey } = require("../server/tokenCookie");

function createResponseRecorder() {
  const cookies = [];
  return {
    cookies,
    cookie(name, value, options) {
      cookies.push({ type: "set", name, value, options });
    },
    clearCookie(name, options) {
      cookies.push({ type: "clear", name, options });
    }
  };
}

describe("gmail oauth token cookie", () => {
  test("rejects missing encryption key", () => {
    expect(() => parseEncryptionKey("")).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  test("encrypts token bundle and never exposes plaintext in the cookie value", () => {
    const store = createTokenCookieStore({
      TOKEN_ENCRYPTION_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      NODE_ENV: "test"
    });
    const res = createResponseRecorder();

    store.writeTokenCookie(res, {
      refresh_token: "refresh-token-123",
      access_token: "access-token-123"
    });

    const cookie = res.cookies[0];
    expect(cookie.value).not.toContain("refresh-token-123");
    expect(cookie.value).not.toContain("access-token-123");

    const req = {
      cookies: {
        [cookie.name]: cookie.value
      }
    };
    expect(store.readTokenCookie(req)).toEqual({
      refresh_token: "refresh-token-123",
      access_token: "access-token-123"
    });
  });
});
