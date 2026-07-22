require("dotenv").config();

const path = require("path");

function asBool(value, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }
  return String(value).toLowerCase() === "true";
}

const ROOT_DIR = path.resolve(__dirname, "..");
const TMP_DIR = path.join(ROOT_DIR, "tmp");

module.exports = {
  ROOT_DIR,
  TMP_DIR,
  DATA_DIR: path.join(ROOT_DIR, ".data"),
  GMAIL_AUTH_FILE: path.join(ROOT_DIR, ".data", "gmail-auth.enc"),
  PORT: Number(process.env.PORT || 3001),
  HOST: process.env.HOST || "127.0.0.1",
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:5173",
  SESSION_SECRET: process.env.SESSION_SECRET || "dev-session-secret",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "",
  GOOGLE_REDIRECT_URI:
    process.env.GOOGLE_REDIRECT_URI ||
    "http://localhost:3001/api/auth/google/callback",
  TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY || "",
  DEMO_MODE: asBool(process.env.DEMO_MODE, true),
  SESSION_TTL_MS: Number(process.env.SESSION_TTL_MS || 2 * 60 * 60 * 1000),
  NODE_ENV: process.env.NODE_ENV || "development"
};
