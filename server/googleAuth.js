const { google } = require("googleapis");
const { OAuth2Client } = require("google-auth-library");
const {
  DEMO_MODE,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
} = require("./config");
const { sanitizeFilename } = require("../shared/utils");

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const OAUTH_SCOPES = ["openid", "email", GMAIL_SEND_SCOPE];
const REQUIRED_SCOPES = [...OAUTH_SCOPES];
const MISSING_GMAIL_SEND_MESSAGE =
  "Google connected, but Gmail sending permission was not granted. Disconnect and reconnect, then approve the Gmail sending permission.";
const RECONNECT_REQUIRED_MESSAGE =
  "Reconnect required. Remove the application from your Google Account connections, then connect again to grant offline access.";

function createOAuthClient() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

function createIdTokenVerifier() {
  return new OAuth2Client(GOOGLE_CLIENT_ID);
}

function buildAuthUrl(sessionState, oauth = createOAuthClient()) {
  if (DEMO_MODE) {
    throw new Error("Demo mode is enabled. Gmail OAuth is disabled.");
  }

  const state = sanitizeFilename(`${sessionState.sessionId}:${Date.now()}`);
  sessionState.gmail.state = state;
  return oauth.generateAuthUrl({
    access_type: "offline",
    scope: OAUTH_SCOPES,
    state,
    prompt: "consent select_account",
    include_granted_scopes: true
  });
}

function normalizeGrantedScopes(scopeInput) {
  if (!scopeInput) {
    return [];
  }
  if (Array.isArray(scopeInput)) {
    return Array.from(new Set(scopeInput.map((scope) => String(scope).trim()).filter(Boolean)));
  }
  return Array.from(
    new Set(
      String(scopeInput)
        .split(/\s+/)
        .map((scope) => scope.trim())
        .filter(Boolean)
    )
  );
}

function getMissingScopes(grantedScopes) {
  const grantedSet = new Set(normalizeGrantedScopes(grantedScopes));
  return REQUIRED_SCOPES.filter((scope) => !grantedSet.has(scope));
}

function hasRequiredSendScope(grantedScopes) {
  return getMissingScopes(grantedScopes).length === 0;
}

async function extractVerifiedEmailFromIdToken(idToken, verifier = createIdTokenVerifier()) {
  if (!idToken) {
    throw new Error("ID token was not returned by Google.");
  }

  const ticket = await verifier.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID
  });
  const payload = ticket.getPayload();

  if (!payload) {
    throw new Error("Google ID token payload was empty.");
  }
  if (!payload.email) {
    throw new Error("Google ID token did not contain an email address.");
  }
  if (!payload.email_verified) {
    throw new Error("Google account email is not verified.");
  }

  return {
    emailAddress: payload.email,
    emailVerified: Boolean(payload.email_verified)
  };
}

async function exchangeCodeForTokens(code, options = {}) {
  const oauth = createOAuthClient();
  const result = await oauth.getToken(code);
  const tokens = result.tokens || {};
  const verifier = options.verifier || createIdTokenVerifier();
  const grantedScopeInspector = options.grantedScopeInspector || (async (accessToken) => {
    const tokenInfo = await oauth.getTokenInfo(accessToken);
    return tokenInfo.scopes || tokenInfo.scope || [];
  });
  const identity = await extractVerifiedEmailFromIdToken(tokens.id_token, verifier);
  const grantedScopes = tokens.access_token
    ? normalizeGrantedScopes(await grantedScopeInspector(tokens.access_token))
    : normalizeGrantedScopes(tokens.scope);
  const missingScopes = getMissingScopes(grantedScopes);

  return {
    tokens,
    emailAddress: identity.emailAddress,
    grantedScopes,
    canSend: missingScopes.length === 0,
    missingScopes
  };
}

async function fetchGrantedScopesFromAccessToken(accessToken, oauth = createOAuthClient()) {
  const tokenInfo = await oauth.getTokenInfo(accessToken);
  return normalizeGrantedScopes(tokenInfo.scopes || tokenInfo.scope || []);
}

function getGoogleErrorCode(error) {
  return (
    error?.response?.data?.error ||
    error?.cause?.error ||
    error?.error ||
    error?.code ||
    ""
  );
}

function isPermanentAuthorizationError(error) {
  const code = String(getGoogleErrorCode(error) || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return (
    code === "invalid_grant" ||
    code === "unauthorized_client" ||
    code === "invalid_client" ||
    message.includes("invalid_grant") ||
    message.includes("token has been expired or revoked") ||
    message.includes("unauthorized_client")
  );
}

async function revokeTokens(tokens) {
  if (!tokens || DEMO_MODE) {
    return;
  }
  const oauth = createOAuthClient();
  oauth.setCredentials(tokens);
  try {
    await oauth.revokeCredentials();
  } catch {
    // Ignore revoke failures during cleanup.
  }
}

module.exports = {
  GMAIL_SEND_SCOPE,
  REQUIRED_SCOPES,
  OAUTH_SCOPES,
  MISSING_GMAIL_SEND_MESSAGE,
  RECONNECT_REQUIRED_MESSAGE,
  buildAuthUrl,
  exchangeCodeForTokens,
  extractVerifiedEmailFromIdToken,
  fetchGrantedScopesFromAccessToken,
  normalizeGrantedScopes,
  getMissingScopes,
  hasRequiredSendScope,
  isPermanentAuthorizationError,
  revokeTokens,
  createOAuthClient,
  createIdTokenVerifier
};
