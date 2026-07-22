const crypto = require("crypto");

const GMAIL_AUTH_COOKIE_NAME = "gmail_oauth";
const GMAIL_STATE_COOKIE_NAME = "gmail_oauth_state";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const TOKEN_COOKIE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const STATE_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

function parseEncryptionKey(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be set to a 32-byte key.");
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  const base64Key = Buffer.from(raw, "base64");
  if (base64Key.length === 32) {
    return base64Key;
  }
  throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.");
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function encryptJson(payload, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return base64UrlEncode(Buffer.concat([iv, tag, ciphertext]));
}

function decryptJson(value, key) {
  const raw = base64UrlDecode(value);
  if (raw.length <= IV_LENGTH + TAG_LENGTH) {
    throw new Error("Encrypted Gmail cookie is invalid.");
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

function createTokenCookieStore(config) {
  function getKey() {
    return parseEncryptionKey(config.TOKEN_ENCRYPTION_KEY);
  }

  function getCookieOptions() {
    return {
      httpOnly: true,
      sameSite: "lax",
      secure: config.NODE_ENV === "production",
      path: "/"
    };
  }

  return {
    getCookieOptions,
    ensureConfigured() {
      getKey();
    },
    writeTokenCookie(res, authPayload) {
      const encrypted = encryptJson(
        {
          auth: authPayload,
          savedAt: new Date().toISOString()
        },
        getKey()
      );
      res.cookie(GMAIL_AUTH_COOKIE_NAME, encrypted, {
        ...getCookieOptions(),
        maxAge: TOKEN_COOKIE_MAX_AGE_MS
      });
    },
    readTokenCookie(req) {
      const value = req.cookies?.[GMAIL_AUTH_COOKIE_NAME];
      if (!value) {
        return null;
      }
      const payload = decryptJson(value, getKey());
      return payload.auth || null;
    },
    clearTokenCookie(res) {
      res.clearCookie(GMAIL_AUTH_COOKIE_NAME, getCookieOptions());
    },
    writeStateCookie(res, statePayload) {
      const encrypted = encryptJson(statePayload, getKey());
      res.cookie(GMAIL_STATE_COOKIE_NAME, encrypted, {
        ...getCookieOptions(),
        maxAge: STATE_COOKIE_MAX_AGE_MS
      });
    },
    readStateCookie(req) {
      const value = req.cookies?.[GMAIL_STATE_COOKIE_NAME];
      if (!value) {
        return null;
      }
      return decryptJson(value, getKey());
    },
    clearStateCookie(res) {
      res.clearCookie(GMAIL_STATE_COOKIE_NAME, getCookieOptions());
    }
  };
}

module.exports = {
  GMAIL_AUTH_COOKIE_NAME,
  GMAIL_STATE_COOKIE_NAME,
  TOKEN_COOKIE_MAX_AGE_MS,
  createTokenCookieStore,
  parseEncryptionKey
};
