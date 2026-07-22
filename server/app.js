const fs = require("fs");
const path = require("path");
const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const {
  ROOT_DIR,
  FRONTEND_URL,
  SESSION_SECRET,
  DEMO_MODE,
  NODE_ENV,
  GMAIL_AUTH_FILE,
  TOKEN_ENCRYPTION_KEY,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET
} = require("./config");
const { createSessionStore } = require("./sessionStore");
const { loadDocxTemplate } = require("./docxTemplate");
const { parseWorkbook } = require("../shared/workbook");
const { matchStudentsWithImages, deriveStudentStatus } = require("../shared/matching");
const { buildEmailModel } = require("../shared/email");
const { SESSION_LABELS } = require("../shared/constants");
const {
  saveWorkbookUpload,
  saveImages,
  deletePath
} = require("./fileStore");
const {
  buildAuthUrl,
  exchangeCodeForTokens,
  revokeTokens,
  MISSING_GMAIL_SEND_MESSAGE,
  RECONNECT_REQUIRED_MESSAGE,
  fetchGrantedScopesFromAccessToken,
  isPermanentAuthorizationError,
  getMissingScopes,
  createOAuthClient
} = require("./googleAuth");
const { createEncryptedAuthStore, hashOAuthClient } = require("./gmailAuthStore");
const {
  processQueue,
  enqueueStudents,
  getEligibleStudentsForAutomaticSend,
  makeQueueSnapshot,
  sendOneEmail
} = require("./sendQueue");
const { collapseWhitespace } = require("../shared/utils");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 301
  }
});

function sessionLogId(sessionId) {
  return String(sessionId || "").slice(0, 8);
}

function logAuthDebug(event, details = {}) {
  console.log(
    `[auth] ${event} ${JSON.stringify({
      sessionId: details.sessionId ? sessionLogId(details.sessionId) : "",
      sessionFound: details.sessionFound,
      tokensExist: details.tokensExist,
      profileSucceeded: details.profileSucceeded,
      stateValid: details.stateValid
    })}`
  );
}

function getGmailAuthStatus(gmailState) {
  const connected = Boolean(gmailState.connected && gmailState.address);
  return {
    connected,
    address: connected ? gmailState.address : "",
    canSend: connected && Boolean(gmailState.canSend),
    missingScopes: connected ? [...(gmailState.missingScopes || [])] : [],
    error: gmailState.error || ""
  };
}

function requireGmailSendPermission(sessionData, connectMessage, sendMessage) {
  if (!sessionData.gmail.connected) {
    throw new Error(connectMessage);
  }
  if (!sessionData.gmail.canSend) {
    throw new Error(sendMessage || MISSING_GMAIL_SEND_MESSAGE);
  }
}

function createApp(overrides = {}) {
  const app = express();
  const sessionStore = createSessionStore();
  const oauthStateToSessionId = new Map();
  let templatePromise = loadDocxTemplate(ROOT_DIR);
  const exchangeTokens = overrides.exchangeCodeForTokens || exchangeCodeForTokens;
  const revokeGmailTokens = overrides.revokeTokens || revokeTokens;
  const authStore =
    overrides.authStore ||
    createEncryptedAuthStore({
      filePath: overrides.gmailAuthFile ?? GMAIL_AUTH_FILE,
      encryptionKey: overrides.tokenEncryptionKey ?? TOKEN_ENCRYPTION_KEY
    });
  const refreshAccessToken =
    overrides.refreshAccessToken ||
    (async (refreshToken, oauthFactory = overrides.createOAuthClient || createOAuthClient) => {
      const oauth = oauthFactory();
      oauth.setCredentials({ refresh_token: refreshToken });
      const tokenResult = await oauth.getAccessToken();
      const accessToken =
        typeof tokenResult === "string"
          ? tokenResult
          : tokenResult?.token || tokenResult?.access_token || "";
      if (!accessToken) {
        throw new Error("Google did not return an access token.");
      }
      return {
        accessToken,
        grantedScopes: await fetchGrantedScopesFromAccessToken(accessToken, oauth)
      };
    });
  const clientHash = hashOAuthClient(
    overrides.googleClientId ?? GOOGLE_CLIENT_ID,
    overrides.googleClientSecret ?? GOOGLE_CLIENT_SECRET
  );
  const gmailState = {
    connected: false,
    address: "",
    tokens: null,
    grantedScopes: [],
    canSend: false,
    missingScopes: [],
    error: "",
    state: "",
    connectedAt: "",
    persistent: false
  };

  function clearGlobalGmailState() {
    gmailState.connected = false;
    gmailState.address = "";
    gmailState.tokens = null;
    gmailState.grantedScopes = [];
    gmailState.canSend = false;
    gmailState.missingScopes = [];
    gmailState.error = "";
    gmailState.connectedAt = "";
    gmailState.persistent = false;
  }

  function syncSessionGmail(sessionData) {
    const state = sessionData.gmail?.state || "";
    sessionData.gmail = {
      connected: gmailState.connected,
      address: gmailState.address,
      tokens: gmailState.tokens,
      grantedScopes: [...gmailState.grantedScopes],
      canSend: gmailState.canSend,
      missingScopes: [...gmailState.missingScopes],
      error: gmailState.error,
      state
    };
  }

  function applyGlobalGmailAuth(nextState) {
    gmailState.connected = Boolean(nextState.connected && nextState.address);
    gmailState.address = gmailState.connected ? nextState.address : "";
    gmailState.tokens = nextState.tokens || null;
    gmailState.grantedScopes = [...(nextState.grantedScopes || [])];
    gmailState.canSend = gmailState.connected && Boolean(nextState.canSend);
    gmailState.missingScopes = [...(nextState.missingScopes || [])];
    gmailState.error = nextState.error || "";
    gmailState.connectedAt = nextState.connectedAt || "";
    gmailState.persistent = Boolean(nextState.persistent);
  }

  async function deletePersistentAuth() {
    await authStore.remove();
  }

  async function restorePersistentGmailAuth() {
    if (DEMO_MODE) {
      clearGlobalGmailState();
      return getGmailAuthStatus(gmailState);
    }

    let persistedAuth = null;
    try {
      persistedAuth = await authStore.load();
    } catch (error) {
      clearGlobalGmailState();
      gmailState.error = error.message;
      return getGmailAuthStatus(gmailState);
    }

    if (!persistedAuth) {
      clearGlobalGmailState();
      return getGmailAuthStatus(gmailState);
    }

    if (persistedAuth.oauthClientHash !== clientHash) {
      await deletePersistentAuth();
      clearGlobalGmailState();
      gmailState.error = "Google OAuth credentials changed. Reconnect Gmail.";
      return getGmailAuthStatus(gmailState);
    }

    applyGlobalGmailAuth({
      connected: true,
      address: persistedAuth.address,
      tokens: { refresh_token: persistedAuth.refreshToken },
      grantedScopes: persistedAuth.grantedScopes || [],
      canSend: false,
      missingScopes: [],
      error: "",
      connectedAt: persistedAuth.connectedAt,
      persistent: true
    });

    try {
      const refreshed = await refreshAccessToken(persistedAuth.refreshToken);
      const missingScopes = getMissingScopes(refreshed.grantedScopes);
      const canSend = missingScopes.length === 0;
      applyGlobalGmailAuth({
        connected: true,
        address: persistedAuth.address,
        tokens: { refresh_token: persistedAuth.refreshToken },
        grantedScopes: refreshed.grantedScopes,
        canSend,
        missingScopes,
        error: canSend ? "" : MISSING_GMAIL_SEND_MESSAGE,
        connectedAt: persistedAuth.connectedAt,
        persistent: true
      });
    } catch (error) {
      if (isPermanentAuthorizationError(error)) {
        await deletePersistentAuth();
        clearGlobalGmailState();
        gmailState.error = "Google authorization expired or was revoked. Reconnect Gmail.";
      } else {
        applyGlobalGmailAuth({
          connected: true,
          address: persistedAuth.address,
          tokens: { refresh_token: persistedAuth.refreshToken },
          grantedScopes: persistedAuth.grantedScopes || [],
          canSend: false,
          missingScopes: getMissingScopes(persistedAuth.grantedScopes || []),
          error: "Gmail authorization is saved, but Google could not be reached to refresh access.",
          connectedAt: persistedAuth.connectedAt,
          persistent: true
        });
      }
    }

    return getGmailAuthStatus(gmailState);
  }

  const restorePromise = restorePersistentGmailAuth();

  async function ensureGmailReady() {
    await restorePromise;
  }

  function ensurePersistentAuthIsConfigured() {
    authStore.getKey();
  }

  function startGoogleAuth(req, res, next) {
    try {
      ensurePersistentAuthIsConfigured();
      const url = buildAuthUrl(req.sessionData);
      if (req.sessionData.gmail.state) {
        oauthStateToSessionId.set(req.sessionData.gmail.state, req.sessionID);
      }
      logAuthDebug("start", {
        sessionId: req.sessionID,
        sessionFound: true,
        tokensExist: Boolean(req.sessionData.gmail.tokens)
      });
      res.json({ url });
    } catch (error) {
      next(error);
    }
  }

  app.use((req, res, next) => {
    if (req.headers.origin === FRONTEND_URL) {
      res.header("Access-Control-Allow-Origin", FRONTEND_URL);
      res.header("Access-Control-Allow-Credentials", "true");
      res.header("Access-Control-Allow-Headers", "Content-Type");
      res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.header("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(cookieParser());
  app.use(express.json({ limit: "5mb" }));
  app.use(
    session({
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: true,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: NODE_ENV === "production",
        path: "/"
      }
    })
  );

  app.use((req, _res, next) => {
    req.sessionData = sessionStore.get(req.sessionID);
    syncSessionGmail(req.sessionData);
    next();
  });

  function getStudentById(sessionData, studentId) {
    return sessionData.students.find((student) => student.id === studentId);
  }

  function summarize(sessionData) {
    const students = sessionData.students.map((student) => {
      const state = deriveStudentStatus(student, sessionData);
      return {
        ...student,
        status: state.status,
        statusReason: state.reason,
        selectable: state.selectable
      };
    });

    const summary = {
      totalStudents: students.length,
      sessionAStudents: students.filter((student) => student.sessionKey === "A").length,
      sessionBStudents: students.filter((student) => student.sessionKey === "B").length,
      imagesUploaded: sessionData.imageFiles.length,
      successfullyMatched: students.filter(
        (student) => student.imageMatch?.matchStatus === "ready"
      ).length,
      missingImages: students.filter((student) => !student.imageMatch).length,
      errors: students.filter((student) => student.status === "Error").length + sessionData.issues.length + sessionData.workbookErrors.length,
      sentDuringSession: students.filter((student) => student.sendState === "sent").length,
      failedDuringSession: students.filter((student) => student.sendState === "failed").length
    };

    return {
      demoMode: DEMO_MODE,
      gmail: getGmailAuthStatus(sessionData.gmail),
      workbookLoaded: Boolean(sessionData.workbookPath),
      folderUpload: sessionData.folderUpload,
      summary,
      sheetSummaries: sessionData.sheetSummaries,
      issues: [...sessionData.workbookErrors, ...sessionData.issues],
      students,
      queue: makeQueueSnapshot(sessionData.queue),
      expiresAt: sessionData.expiresAt
    };
  }

  async function refreshMatches(sessionData) {
    if (!sessionData.workbookPath) {
      return;
    }

    const workbookBuffer = await fs.promises.readFile(sessionData.workbookPath);
    const parsedWorkbook = parseWorkbook(workbookBuffer);
    sessionData.workbookErrors = parsedWorkbook.errors;
    sessionData.sheetSummaries = parsedWorkbook.sheetSummaries;

    let students = parsedWorkbook.students;
    students = students.map((student) => {
      const existing = sessionData.students.find((item) => item.id === student.id);
      if (!existing) {
        return student;
      }
      return {
        ...student,
        email: existing.email || student.email,
        emailRaw: existing.emailRaw || student.emailRaw,
        hasMultipleEmails: existing.hasMultipleEmails,
        sendState: existing.sendState,
        sendError: existing.sendError,
        gmailMessageId: existing.gmailMessageId,
        lastAttemptAt: existing.lastAttemptAt
      };
    });

    const matched = matchStudentsWithImages(students, sessionData.imageFiles);
    sessionData.students = matched.students;
    sessionData.issues = matched.issues;
  }

  app.get("/api/session", async (req, res) => {
    await ensureGmailReady();
    syncSessionGmail(req.sessionData);
    res.json(summarize(req.sessionData));
  });

  app.get("/api/auth/status", async (req, res) => {
    await ensureGmailReady();
    syncSessionGmail(req.sessionData);
    const gmailStatus = getGmailAuthStatus(gmailState);
    logAuthDebug("status", {
      sessionId: req.sessionID,
      sessionFound: true,
      tokensExist: Boolean(gmailState.tokens)
    });
    res.json(gmailStatus);
  });

  app.post("/api/upload/workbook", upload.single("workbook"), async (req, res, next) => {
    try {
      const workbookPath = await saveWorkbookUpload(req.file, req.sessionID);
      req.sessionData.workbookPath = workbookPath;
      req.sessionData.workbookName = req.file.originalname;
      await refreshMatches(req.sessionData);
      res.json(summarize(req.sessionData));
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/upload/images",
    upload.array("imageFolderFiles", 1000),
    async (req, res, next) => {
      try {
        const relativePaths = Array.isArray(req.body.imageFolderRelativePaths)
          ? req.body.imageFolderRelativePaths
          : (req.body.imageFolderRelativePaths ? [req.body.imageFolderRelativePaths] : []);
        const files = (req.files || []).map((file, index) => ({
          ...file,
          relativePath: relativePaths[index] || file.originalname
        }));
        const uploadResult = await saveImages(req.sessionID, files, {
          folderName: req.body.imageFolderName || ""
        });
        req.sessionData.imageFiles = uploadResult.images;
        req.sessionData.folderUpload = uploadResult.folderSummary;
        await refreshMatches(req.sessionData);
        res.json(summarize(req.sessionData));
      } catch (error) {
        next(error);
      }
    }
  );

  app.get("/api/auth/google", startGoogleAuth);
  app.get("/api/auth/google/connect", startGoogleAuth);

  app.get("/api/auth/google/callback", async (req, res) => {
    if (DEMO_MODE) {
      req.sessionData.gmail.error = "Demo mode is enabled. Gmail OAuth is disabled.";
      res.redirect(`${FRONTEND_URL}?gmail=error&demo=1`);
      return;
    }

    try {
      const { code, state } = req.query;
      const originalSessionId = oauthStateToSessionId.get(state);
      const targetSessionData = originalSessionId
        ? sessionStore.get(originalSessionId)
        : req.sessionData;
      const stateValid = Boolean(code && state && state === targetSessionData.gmail.state);
      logAuthDebug("callback", {
        sessionId: originalSessionId || req.sessionID,
        sessionFound: Boolean(targetSessionData),
        tokensExist: Boolean(targetSessionData?.gmail?.tokens),
        stateValid
      });
      if (!stateValid) {
        throw new Error("Google OAuth state validation failed.");
      }
      const result = await exchangeTokens(code);
      if (!result.canSend) {
        applyGlobalGmailAuth({
          connected: true,
          address: result.emailAddress,
          tokens: null,
          grantedScopes: result.grantedScopes || [],
          canSend: false,
          missingScopes: result.missingScopes || [],
          error: MISSING_GMAIL_SEND_MESSAGE,
          connectedAt: "",
          persistent: false
        });
        syncSessionGmail(targetSessionData);
        oauthStateToSessionId.delete(state);
        res.redirect(`${FRONTEND_URL}?gmail=missing_permission`);
        return;
      }
      if (!result.tokens?.refresh_token) {
        clearGlobalGmailState();
        targetSessionData.gmail.error = RECONNECT_REQUIRED_MESSAGE;
        oauthStateToSessionId.delete(state);
        res.redirect(`${FRONTEND_URL}?gmail=error&reason=reconnect_required`);
        return;
      }
      const connectedAt = new Date().toISOString();
      await authStore.save({
        refreshToken: result.tokens.refresh_token,
        address: result.emailAddress,
        grantedScopes: result.grantedScopes || [],
        connectedAt,
        oauthClientHash: clientHash
      });
      applyGlobalGmailAuth({
        connected: true,
        address: result.emailAddress,
        tokens: { refresh_token: result.tokens.refresh_token },
        grantedScopes: result.grantedScopes || [],
        canSend: Boolean(result.canSend),
        missingScopes: result.missingScopes || [],
        error: "",
        connectedAt,
        persistent: true
      });
      targetSessionData.gmail.state = "";
      syncSessionGmail(targetSessionData);
      logAuthDebug("profile", {
        sessionId: originalSessionId || req.sessionID,
        sessionFound: true,
        tokensExist: true,
        profileSucceeded: Boolean(result.emailAddress)
      });
      oauthStateToSessionId.delete(state);
      res.redirect(
        `${FRONTEND_URL}?gmail=${result.canSend ? "connected" : "missing_permission"}`
      );
    } catch (error) {
      req.sessionData.gmail.error = error.message;
      if (req.query.state) {
        oauthStateToSessionId.delete(req.query.state);
      }
      res.redirect(`${FRONTEND_URL}?gmail=error`);
    }
  });

  app.post("/api/auth/google/disconnect", async (req, res, next) => {
    try {
      await ensureGmailReady();
      await revokeGmailTokens(gmailState.tokens);
      await deletePersistentAuth();
      clearGlobalGmailState();
      syncSessionGmail(req.sessionData);
      logAuthDebug("disconnect", {
        sessionId: req.sessionID,
        sessionFound: true,
        tokensExist: false
      });
      res.json(summarize(req.sessionData));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/students/:studentId/email", (req, res, next) => {
    try {
      const student = getStudentById(req.sessionData, req.params.studentId);
      if (!student) {
        throw new Error("Student not found.");
      }
      const email = collapseWhitespace(req.body.email);
      student.email = email;
      student.emailRaw = email;
      student.hasMultipleEmails = false;
      res.json(summarize(req.sessionData));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/preview/:studentId", async (req, res, next) => {
    try {
      const template = await templatePromise;
      const student = getStudentById(req.sessionData, req.params.studentId);
      if (!student) {
        throw new Error("Student not found.");
      }
      const email = buildEmailModel(student, template);
      const backendOrigin = `${req.protocol}://${req.get("host")}`;
      const previewHtml = email.html.replace(
        "cid:strategy-first-logo",
        `${backendOrigin}/api/assets/strategy-first-logo`
      );
      res.json({
        studentId: student.id,
        studentName: student.studentName,
        session: SESSION_LABELS[student.sessionKey],
        email: {
          ...email,
          html: previewHtml
        },
        attachment: student.imageMatch
          ? {
              thumbnailUrl: `/api/images/${encodeURIComponent(student.id)}`,
              fileName: student.imageMatch.attachmentName
            }
          : null
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/assets/strategy-first-logo", (_req, res, next) => {
    try {
      res.sendFile(path.join(ROOT_DIR, "Picture1.png"));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/images/:studentId", (req, res, next) => {
    try {
      const student = getStudentById(req.sessionData, req.params.studentId);
      if (!student?.imageMatch?.filePath) {
        res.status(404).end();
        return;
      }
      res.sendFile(student.imageMatch.filePath);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/send/test", async (req, res, next) => {
    try {
      await ensureGmailReady();
      syncSessionGmail(req.sessionData);
      if (DEMO_MODE) {
        throw new Error("Demo mode is enabled. Gmail sending is disabled.");
      }
      requireGmailSendPermission(
        req.sessionData,
        "Connect Gmail before sending a test email.",
        MISSING_GMAIL_SEND_MESSAGE
      );
      const template = await templatePromise;
      const student = getStudentById(req.sessionData, req.body.studentId);
      if (!student) {
        throw new Error("Student not found.");
      }
      const messageId = await sendOneEmail(
        req.sessionData,
        student,
        template,
        `[TEST] ${req.body.subject || ""}`.trim(),
        req.body.testRecipient
      );
      res.json({ messageId });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/send/batch", async (req, res, next) => {
    try {
      await ensureGmailReady();
      syncSessionGmail(req.sessionData);
      if (DEMO_MODE) {
        throw new Error("Demo mode is enabled. Gmail sending is disabled.");
      }
      requireGmailSendPermission(
        req.sessionData,
        "Connect Gmail before sending.",
        MISSING_GMAIL_SEND_MESSAGE
      );
      const eligibleStudents = getEligibleStudentsForAutomaticSend(req.sessionData);
      if (!eligibleStudents.length) {
        throw new Error("No Ready emails to send.");
      }
      enqueueStudents(req.sessionData, eligibleStudents);
      const template = await templatePromise;
      processQueue(req.sessionData, template, (studentId) =>
        getStudentById(req.sessionData, studentId)
      );
      res.json(summarize(req.sessionData));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/send/retry-failed", async (req, res, next) => {
    try {
      await ensureGmailReady();
      syncSessionGmail(req.sessionData);
      if (DEMO_MODE) {
        throw new Error("Demo mode is enabled. Gmail sending is disabled.");
      }
      requireGmailSendPermission(
        req.sessionData,
        "Connect Gmail before retrying failed emails.",
        MISSING_GMAIL_SEND_MESSAGE
      );
      const failed = req.sessionData.students.filter(
        (student) => student.sendState === "failed"
      );
      enqueueStudents(req.sessionData, failed);
      const template = await templatePromise;
      processQueue(req.sessionData, template, (studentId) =>
        getStudentById(req.sessionData, studentId)
      );
      res.json(summarize(req.sessionData));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/report.csv", (req, res) => {
    const lines = [
      "Student Name,SFIC ID,Email,Session,Status,Message ID,Error"
    ];
    req.sessionData.students.forEach((student) => {
      const state = deriveStudentStatus(student, req.sessionData);
      const row = [
        student.studentName,
        student.sficId,
        student.email,
        student.sessionLabel,
        state.status,
        student.gmailMessageId,
        student.sendError
      ]
        .map((value) => `"${String(value || "").replace(/"/g, '""')}"`)
        .join(",");
      lines.push(row);
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="graduation-session-report.csv"'
    );
    res.send(lines.join("\n"));
  });

  app.use((error, _req, res, _next) => {
    res.status(400).json({ error: error.message || "Request failed." });
  });

  const cleanupTimer = setInterval(() => {
    sessionStore.cleanupExpiredSessions();
  }, 60 * 1000);

  async function shutdown() {
    clearInterval(cleanupTimer);
    await deletePath(path.join(ROOT_DIR, "tmp"));
  }

  return {
    app,
    shutdown,
    sessionStore,
    gmailState,
    restorePersistentGmailAuth,
    authStore
  };
}

module.exports = {
  createApp
};
