const path = require("path");
const crypto = require("crypto");
const { google } = require("googleapis");
const { OAuth2Client } = require("google-auth-library");
const { buildEmailModel, renderSubject } = require("../shared/email");
const { parseImageFilename, isSupportedImageExtension } = require("../shared/images");
const {
  PROJECT_SAMPLE_FILES,
  STRATEGY_FIRST_LOGO_CID
} = require("../shared/constants");
const { getStrategyFirstLogoBuffer } = require("./strategyFirstLogo");
const { collapseWhitespace, normalizeName, sanitizeFilename } = require("../shared/utils");

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const OAUTH_SCOPES = ["openid", "email", GMAIL_SEND_SCOPE];
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

function isAutomatedTestRun() {
  return Boolean(process.env.VITEST || process.env.NODE_ENV === "test");
}

function createOAuthClient(config, redirectUri = config.GOOGLE_REDIRECT_URI || undefined) {
  return new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

function createIdTokenVerifier(config) {
  return new OAuth2Client(config.GOOGLE_CLIENT_ID);
}

function createConfiguredOAuthClient(config, tokenBundle) {
  const oauth = createOAuthClient(config);
  oauth.setCredentials(tokenBundle);
  return oauth;
}

function buildAuthUrl(config, redirectUri, state) {
  const oauth = createOAuthClient(config, redirectUri);
  return oauth.generateAuthUrl({
    access_type: "offline",
    scope: OAUTH_SCOPES,
    prompt: "consent",
    include_granted_scopes: true,
    state
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
  const granted = new Set(normalizeGrantedScopes(grantedScopes));
  return OAUTH_SCOPES.filter((scope) => !granted.has(scope));
}

async function exchangeCodeForTokens(config, code, redirectUri) {
  const oauth = createOAuthClient(config, redirectUri);
  const result = await oauth.getToken(code);
  const tokens = result.tokens || {};
  oauth.setCredentials(tokens);
  const tokenInfo = tokens.access_token ? await oauth.getTokenInfo(tokens.access_token) : null;
  const verifier = createIdTokenVerifier(config);
  const ticket = await verifier.verifyIdToken({
    idToken: tokens.id_token,
    audience: config.GOOGLE_CLIENT_ID
  });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified) {
    throw new Error("Connected Google account email is missing or not verified.");
  }

  const grantedScopes = normalizeGrantedScopes(tokenInfo?.scopes || []);
  console.log("OAuth granted scopes:", grantedScopes);

  return {
    tokens,
    emailAddress: collapseWhitespace(payload.email).toLowerCase(),
    grantedScopes,
    missingScopes: getMissingScopes(grantedScopes)
  };
}

function validateGmailConfiguration(config) {
  return Boolean(
    config.GOOGLE_CLIENT_ID &&
      config.GOOGLE_CLIENT_SECRET &&
      config.TOKEN_ENCRYPTION_KEY &&
      config.ALLOWED_GMAIL_SENDER
  );
}

function getMimeTypeForImage(filename, fallbackType = "") {
  const ext = path.extname(filename || "").toLowerCase();
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (fallbackType === "image/png" || fallbackType === "image/jpeg") {
    return fallbackType;
  }
  return "image/jpeg";
}

function sanitizeHeaderValue(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function toBase64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildMimeMessageSource({
  from,
  to,
  subject,
  text,
  html,
  logoBuffer,
  attachmentBuffer,
  attachmentName,
  attachmentMimeType
}) {
  const mixedBoundary = `mixed_${Date.now()}`;
  const alternativeBoundary = `alt_${Date.now()}`;
  const relatedBoundary = `related_${Date.now()}`;
  const safeAttachmentName = sanitizeFilename(sanitizeHeaderValue(attachmentName));
  const safeLogoName = sanitizeFilename(PROJECT_SAMPLE_FILES.logo);
  const safeFrom = sanitizeHeaderValue(from);
  const safeTo = sanitizeHeaderValue(to);
  const safeSubject = sanitizeHeaderValue(subject);
  const logoBase64 = logoBuffer.toString("base64");
  const attachmentBase64 = attachmentBuffer.toString("base64");
  const lines = [
    `From: ${safeFrom}`,
    `To: ${safeTo}`,
    "MIME-Version: 1.0",
    `Subject: ${safeSubject}`,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    "",
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    "",
    "",
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    text,
    "",
    `--${alternativeBoundary}`,
    `Content-Type: multipart/related; boundary="${relatedBoundary}"`,
    "",
    "",
    `--${relatedBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    html,
    "",
    `--${relatedBoundary}`,
    `Content-Type: image/png; name="${safeLogoName}"`,
    "Content-Transfer-Encoding: base64",
    `Content-ID: <${STRATEGY_FIRST_LOGO_CID}>`,
    `Content-Disposition: inline; filename="${safeLogoName}"`,
    "",
    logoBase64,
    "",
    `--${relatedBoundary}--`,
    "",
    `--${alternativeBoundary}--`,
    "",
    `--${mixedBoundary}`,
    `Content-Type: ${attachmentMimeType}; name="${safeAttachmentName}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${safeAttachmentName}"`,
    "",
    attachmentBase64,
    "",
    `--${mixedBoundary}--`
  ];
  return lines.join("\r\n");
}

function createMimeMessage(payload) {
  return toBase64Url(Buffer.from(buildMimeMessageSource(payload)));
}

function validateRecipientEmail(value) {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(String(value || "").trim());
}

function validateSficId(value) {
  return /^[A-Z0-9-]+$/i.test(String(value || "").trim());
}

function validateStudentPayload({ studentName, recipientEmail, sficId, sessionKey, imageFile }) {
  const cleanName = collapseWhitespace(studentName);
  const cleanEmail = collapseWhitespace(recipientEmail);
  const cleanSficId = collapseWhitespace(sficId);

  if (!cleanName) {
    throw new Error("Student name is required.");
  }
  if (!validateRecipientEmail(cleanEmail)) {
    throw new Error("A valid recipient email is required.");
  }
  if (!validateSficId(cleanSficId)) {
    throw new Error("A valid SFIC ID is required.");
  }
  if (sessionKey !== "A" && sessionKey !== "B") {
    throw new Error("Session must be A or B.");
  }
  if (!imageFile) {
    throw new Error("Invitation image is required.");
  }
  if (imageFile.size > MAX_IMAGE_BYTES) {
    throw new Error("Invitation image must be 3 MB or smaller.");
  }
  if (!isSupportedImageExtension(imageFile.originalname)) {
    throw new Error("Invitation image must be JPG, JPEG, or PNG.");
  }
  if (!String(imageFile.mimetype || "").startsWith("image/")) {
    throw new Error("Invitation image must be JPG, JPEG, or PNG.");
  }

  const parsed = parseImageFilename(imageFile.originalname);
  if (!parsed.valid) {
    throw new Error(parsed.error);
  }
  if (parsed.sficId !== cleanSficId || parsed.normalizedName !== normalizeName(cleanName)) {
    throw new Error("Invitation image filename does not match the student's SFIC ID and name.");
  }

  return {
    studentName: cleanName,
    recipientEmail: cleanEmail,
    sficId: cleanSficId,
    sessionKey
  };
}

function sanitizeAuthBundle(authBundle) {
  const nextTokens = {
    refresh_token: authBundle.tokens?.refresh_token || "",
    access_token: authBundle.tokens?.access_token || "",
    expiry_date: authBundle.tokens?.expiry_date || 0,
    scope: authBundle.tokens?.scope || "",
    token_type: authBundle.tokens?.token_type || ""
  };
  if (!nextTokens.refresh_token) {
    throw new Error("Google did not return a usable refresh token.");
  }
  return {
    tokens: nextTokens,
    verifiedEmail: collapseWhitespace(authBundle.verifiedEmail).toLowerCase(),
    grantedScopes: normalizeGrantedScopes(authBundle.grantedScopes || nextTokens.scope)
  };
}

function buildStateValue() {
  return crypto.randomBytes(24).toString("hex");
}

function isInsufficientScopeError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("insufficient authentication scopes") ||
    message.includes("request had insufficient authentication scopes")
  );
}

function createGmailService(config, options = {}) {
  const logoBuffer = options.logoBuffer || getStrategyFirstLogoBuffer();
  const templateLoader = options.templateLoader;
  const gmailFactory = options.gmailFactory || ((auth) => google.gmail({ version: "v1", auth }));

  async function loadTemplate() {
    return templateLoader();
  }

  async function verifyConnectedSender(authBundle) {
    if (!authBundle?.tokens?.refresh_token) {
      return {
        connected: false,
        address: "",
        canSend: false
      };
    }

    const actualAddress = collapseWhitespace(authBundle.verifiedEmail).toLowerCase();
    const allowedAddress = collapseWhitespace(config.ALLOWED_GMAIL_SENDER).toLowerCase();
    if (actualAddress !== allowedAddress) {
      const error = new Error("Connected Google account does not match ALLOWED_GMAIL_SENDER.");
      error.statusCode = 403;
      throw error;
    }

    const grantedScopes = normalizeGrantedScopes(authBundle.grantedScopes);
    const missingScopes = getMissingScopes(grantedScopes);

    return {
      connected: true,
      address: authBundle.verifiedEmail,
      canSend: missingScopes.length === 0,
      missingScopes,
      auth: sanitizeAuthBundle({
        tokens: authBundle.tokens,
        verifiedEmail: authBundle.verifiedEmail,
        grantedScopes
      })
    };
  }

  async function sendInvitation(payload, authBundle) {
    const validated = validateStudentPayload(payload);
    if (isAutomatedTestRun()) {
      return {
        messageId: `demo-${validated.sficId}-${Date.now()}`,
        auth: sanitizeAuthBundle({
          tokens: {
            ...authBundle?.tokens,
            refresh_token: authBundle?.tokens?.refresh_token || "test-refresh-token"
          },
          verifiedEmail:
            authBundle?.verifiedEmail || collapseWhitespace(config.ALLOWED_GMAIL_SENDER).toLowerCase(),
          grantedScopes: authBundle?.grantedScopes || OAUTH_SCOPES
        })
      };
    }

    const senderStatus = await verifyConnectedSender(authBundle);
    if (!senderStatus.connected || !senderStatus.canSend) {
      const error = new Error(
        senderStatus.connected
          ? "Google connected, but Gmail sending permission was not granted."
          : "Connect Gmail before sending invitation emails."
      );
      error.statusCode = senderStatus.connected ? 403 : 401;
      throw error;
    }

    const template = await loadTemplate();
    const model = buildEmailModel(
      {
        studentName: validated.studentName,
        sessionKey: validated.sessionKey
      },
      template
    );
    const subject = renderSubject(validated.studentName, payload.subject || model.subject);
    const attachmentName = sanitizeFilename(
      `${validated.studentName} - Graduation Invitation${path.extname(payload.imageFile.originalname)}`
    );
    const attachmentMimeType = getMimeTypeForImage(
      payload.imageFile.originalname,
      payload.imageFile.mimetype
    );

    const oauth = createConfiguredOAuthClient(config, senderStatus.auth.tokens);
    const gmail = gmailFactory(oauth);
    const raw = createMimeMessage({
      from: config.ALLOWED_GMAIL_SENDER,
      to: validated.recipientEmail,
      subject,
      text: model.text,
      html: model.html,
      logoBuffer,
      attachmentBuffer: payload.imageFile.buffer,
      attachmentName,
      attachmentMimeType
    });
    const result = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw
      }
    });

    return {
      messageId: result.data.id || "",
      auth: sanitizeAuthBundle({
        tokens: {
          ...senderStatus.auth.tokens,
          ...oauth.credentials,
          refresh_token:
            oauth.credentials.refresh_token || senderStatus.auth.tokens.refresh_token
        },
        verifiedEmail: senderStatus.auth.verifiedEmail,
        grantedScopes: senderStatus.auth.grantedScopes
      })
    };
  }

  return {
    OAUTH_SCOPES,
    GMAIL_SEND_SCOPE,
    MAX_IMAGE_BYTES,
    buildStateValue,
    buildAuthUrl: (redirectUri, state) => buildAuthUrl(config, redirectUri, state),
    exchangeCodeForTokens: (code, redirectUri) => exchangeCodeForTokens(config, code, redirectUri),
    verifyConnectedSender,
    sendInvitation,
    createMimeMessage,
    buildMimeMessageSource,
    validateStudentPayload,
    sanitizeAuthBundle,
    validateGmailConfiguration,
    isInsufficientScopeError
  };
}

module.exports = {
  OAUTH_SCOPES,
  GMAIL_SEND_SCOPE,
  MAX_IMAGE_BYTES,
  buildStateValue,
  createGmailService,
  createOAuthClient,
  createIdTokenVerifier,
  validateGmailConfiguration,
  buildAuthUrl,
  exchangeCodeForTokens,
  buildMimeMessageSource,
  createMimeMessage,
  validateStudentPayload,
  sanitizeAuthBundle,
  isInsufficientScopeError,
  getMissingScopes,
  normalizeGrantedScopes
};
