const express = require("express");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const {
  buildServerConfig,
  ROOT_DIR
} = require("./config");
const { loadDocxTemplate } = require("./docxTemplate");
const {
  createGmailService,
  validateGmailConfiguration,
  getMissingScopes,
  normalizeGrantedScopes,
  isInsufficientScopeError
} = require("./gmailService");
const {
  createTokenCookieStore
} = require("./tokenCookie");
const { collapseWhitespace } = require("../shared/utils");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 4_500_000,
    files: 1
  }
});

function createApp(overrides = {}) {
  const config = buildServerConfig(overrides);
  const templatePromise =
    overrides.templatePromise || loadDocxTemplate(ROOT_DIR);
  const gmailService =
    overrides.gmailService ||
    createGmailService(config, {
      templateLoader: async () => templatePromise,
      logoBuffer: overrides.logoBuffer
    });
  const tokenCookieStore =
    overrides.tokenCookieStore || createTokenCookieStore(config);
  const idempotencyStore = new Map();

  function resolveAllowedOrigins() {
    const origins = new Set([config.APP_URL]);
    if (config.NODE_ENV !== "production") {
      origins.add(config.DEV_FRONTEND_URL);
    }
    return origins;
  }

  function resolveRedirectBaseUrl(req) {
    const cookieState = tokenCookieStore.readStateCookie(req);
    if (cookieState?.returnTo && resolveAllowedOrigins().has(cookieState.returnTo)) {
      return cookieState.returnTo;
    }
    return config.NODE_ENV === "production" ? config.APP_URL : config.DEV_FRONTEND_URL;
  }

  function getGoogleCallbackUrl() {
    return config.NODE_ENV === "production"
      ? `${config.APP_URL}/api/auth/google/callback`
      : "http://localhost:3001/api/auth/google/callback";
  }

  function setApiHeaders(req, res, next) {
    const origin = req.headers.origin;
    if (origin && resolveAllowedOrigins().has(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Access-Control-Allow-Credentials", "true");
      res.header("Access-Control-Allow-Headers", "Content-Type");
      res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.header("Vary", "Origin");
    }
    res.header("X-Content-Type-Options", "nosniff");
    res.header("X-Frame-Options", "DENY");
    res.header("Referrer-Policy", "no-referrer");
    if (req.path.startsWith("/api/")) {
      res.header("Cache-Control", "no-store");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  }

  function requireSameOriginPost(req, _res, next) {
    if (req.method !== "POST") {
      next();
      return;
    }

    const allowedOrigins = resolveAllowedOrigins();
    const origin = collapseWhitespace(req.headers.origin);
    const referer = collapseWhitespace(req.headers.referer);
    const originAllowed = origin && allowedOrigins.has(origin);
    const refererAllowed = referer && Array.from(allowedOrigins).some((allowed) => referer.startsWith(allowed));

    if (!originAllowed && !refererAllowed) {
      const error = new Error("Request origin is not allowed.");
      error.statusCode = 403;
      next(error);
      return;
    }
    next();
  }

  function readConnectedAuth(req) {
    try {
      return tokenCookieStore.readTokenCookie(req);
    } catch {
      return null;
    }
  }

  async function getGmailStatus(req, res) {
    if (!validateGmailConfiguration(config)) {
      return {
        connected: false,
        address: ""
      };
    }

    let auth;
    try {
      auth = tokenCookieStore.readTokenCookie(req);
    } catch {
      tokenCookieStore.clearTokenCookie(res);
      return {
        connected: false,
        address: ""
      };
    }
    if (!auth) {
      return {
        connected: false,
        address: ""
      };
    }

    const verifiedEmail = collapseWhitespace(auth.verifiedEmail).toLowerCase();
    const allowedEmail = collapseWhitespace(config.ALLOWED_GMAIL_SENDER).toLowerCase();
    const missingScopes = getMissingScopes(normalizeGrantedScopes(auth.grantedScopes));

    if (!auth.tokens?.refresh_token || verifiedEmail !== allowedEmail || missingScopes.length > 0) {
      tokenCookieStore.clearTokenCookie(res);
      return {
        connected: false,
        address: ""
      };
    }

    return {
      connected: true,
      address: auth.verifiedEmail,
      canSend: true
    };
  }

  function requireConnectedGmail(req, res, next) {
    getGmailStatus(req, res)
      .then((status) => {
        if (!status.connected || !status.canSend) {
          const error = new Error("Connect Gmail before sending invitation emails.");
          error.statusCode = 401;
          next(error);
          return;
        }
        next();
      })
      .catch(next);
  }

  function cleanupIdempotencyStore() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [key, value] of idempotencyStore.entries()) {
      if (value.createdAt < cutoff) {
        idempotencyStore.delete(key);
      }
    }
  }

  const app = express();
  app.use(setApiHeaders);
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true
    });
  });

  app.get("/api/auth/status", async (req, res, next) => {
    try {
      res.json(await getGmailStatus(req, res));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/gmail/status", async (req, res, next) => {
    try {
      res.json(await getGmailStatus(req, res));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/google", (req, res, next) => {
    try {
      tokenCookieStore.ensureConfigured();
      const state = gmailService.buildStateValue();
      const returnTo =
        resolveAllowedOrigins().has(collapseWhitespace(req.headers.origin))
          ? collapseWhitespace(req.headers.origin)
          : resolveRedirectBaseUrl(req);
      tokenCookieStore.writeStateCookie(res, {
        state,
        returnTo
      });
      res.json({
        url: gmailService.buildAuthUrl(getGoogleCallbackUrl(), state)
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/google/callback", async (req, res) => {
    const redirectBaseUrl = resolveRedirectBaseUrl(req);
    try {
      tokenCookieStore.ensureConfigured();
      const stateCookie = tokenCookieStore.readStateCookie(req);
      tokenCookieStore.clearStateCookie(res);
      const state = collapseWhitespace(req.query.state);
      const code = collapseWhitespace(req.query.code);
      if (!stateCookie || !state || !code || stateCookie.state !== state) {
        throw new Error("Google OAuth state validation failed.");
      }

      const result = await gmailService.exchangeCodeForTokens(code, getGoogleCallbackUrl());
      const allowedAddress = collapseWhitespace(config.ALLOWED_GMAIL_SENDER).toLowerCase();
      if (result.emailAddress !== allowedAddress) {
        tokenCookieStore.clearTokenCookie(res);
        res.redirect(`${redirectBaseUrl}/?gmail=wrong_account`);
        return;
      }
      if (result.missingScopes.length > 0) {
        tokenCookieStore.clearTokenCookie(res);
        res.redirect(`${redirectBaseUrl}/?gmail=missing_permission`);
        return;
      }

      tokenCookieStore.writeTokenCookie(res, gmailService.sanitizeAuthBundle({
        tokens: result.tokens,
        verifiedEmail: result.emailAddress,
        grantedScopes: result.grantedScopes
      }));
      res.redirect(`${redirectBaseUrl}/?gmail=connected`);
    } catch {
      tokenCookieStore.clearTokenCookie(res);
      res.redirect(`${redirectBaseUrl}/?gmail=error`);
    }
  });

  app.post("/api/auth/google/disconnect", requireSameOriginPost, (req, res) => {
    tokenCookieStore.clearTokenCookie(res);
    tokenCookieStore.clearStateCookie(res);
    res.json({
      connected: false,
      address: ""
    });
  });

  app.post(
    "/api/send-one",
    requireSameOriginPost,
    requireConnectedGmail,
    upload.single("invitationImage"),
    async (req, res) => {
      try {
        cleanupIdempotencyStore();
        const idempotencyKey = collapseWhitespace(req.body?.idempotencyKey);
        if (!idempotencyKey) {
          const error = new Error("Idempotency key is required.");
          error.statusCode = 400;
          throw error;
        }

        const existing = idempotencyStore.get(idempotencyKey);
        if (existing) {
          res.status(existing.statusCode).json(existing.payload);
          return;
        }

        const payload = {
          studentName: req.body?.studentName,
          recipientEmail: req.body?.recipientEmail,
          sficId: req.body?.sficId,
          sessionKey: req.body?.sessionKey,
          subject: req.body?.subject,
          jobId: req.body?.jobId,
          imageFile: req.file
        };

        if (!collapseWhitespace(payload.jobId)) {
          const error = new Error("Job identifier is required.");
          error.statusCode = 400;
          throw error;
        }

        const result = await gmailService.sendInvitation(payload, readConnectedAuth(req));
        tokenCookieStore.writeTokenCookie(res, result.auth);
        const responsePayload = {
          ok: true,
          messageId: result.messageId || ""
        };
        idempotencyStore.set(idempotencyKey, {
          createdAt: Date.now(),
          statusCode: 200,
          payload: responsePayload
        });
        res.json(responsePayload);
      } catch (error) {
        const statusCode = error.statusCode || error.code || error.status || 400;
        const safeStatus =
          typeof statusCode === "number" && statusCode >= 400 && statusCode < 600
            ? statusCode
            : 400;
        const payload = {
          error: error.message || "Request failed."
        };
        const idempotencyKey = collapseWhitespace(req.body?.idempotencyKey);
        if (idempotencyKey && safeStatus < 500) {
          idempotencyStore.set(idempotencyKey, {
            createdAt: Date.now(),
            statusCode: safeStatus,
            payload
          });
        }
        if (safeStatus === 401 || safeStatus === 403 || isInsufficientScopeError(error)) {
          tokenCookieStore.clearTokenCookie(res);
        }
        res.status(safeStatus).json(payload);
      }
    }
  );

  app.use((error, _req, res, _next) => {
    const statusCode =
      typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 400;
    res.status(statusCode).json({
      error: error.message || "Request failed."
    });
  });

  return {
    app,
    config,
    gmailService,
    tokenCookieStore
  };
}

module.exports = {
  createApp
};
