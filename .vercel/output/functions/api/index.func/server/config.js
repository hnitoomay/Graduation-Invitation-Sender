require("dotenv").config();

const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_APP_URL = "http://localhost:3001";
const DEFAULT_DEV_FRONTEND_URL = "http://localhost:5173";

function readValue(explicit, fallback = "") {
  return explicit !== undefined ? explicit : fallback;
}

function buildServerConfig(overrides = {}) {
  const appUrl = readValue(overrides.appUrl, process.env.APP_URL || DEFAULT_APP_URL);

  return {
    ROOT_DIR,
    PORT: Number(readValue(overrides.port, process.env.PORT || 3001)),
    HOST: readValue(overrides.host, process.env.HOST || "127.0.0.1"),
    APP_URL: appUrl.replace(/\/+$/g, ""),
    DEV_FRONTEND_URL: readValue(overrides.devFrontendUrl, DEFAULT_DEV_FRONTEND_URL),
    GOOGLE_CLIENT_ID: readValue(overrides.googleClientId, process.env.GOOGLE_CLIENT_ID || ""),
    GOOGLE_CLIENT_SECRET: readValue(
      overrides.googleClientSecret,
      process.env.GOOGLE_CLIENT_SECRET || ""
    ),
    TOKEN_ENCRYPTION_KEY: readValue(
      overrides.tokenEncryptionKey,
      process.env.TOKEN_ENCRYPTION_KEY || ""
    ),
    ALLOWED_GMAIL_SENDER: readValue(
      overrides.allowedGmailSender,
      process.env.ALLOWED_GMAIL_SENDER || ""
    ),
    NODE_ENV: readValue(overrides.nodeEnv, process.env.NODE_ENV || "development")
  };
}

module.exports = {
  ROOT_DIR,
  DEFAULT_APP_URL,
  DEFAULT_DEV_FRONTEND_URL,
  buildServerConfig
};
