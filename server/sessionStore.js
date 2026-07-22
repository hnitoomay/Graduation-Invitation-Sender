const fs = require("fs");
const path = require("path");
const { SESSION_TTL_MS, TMP_DIR } = require("./config");
const { deletePath } = require("./fileStore");

function createEmptyState(sessionId) {
  return {
    sessionId,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
    workbookPath: "",
    workbookName: "",
    students: [],
    workbookErrors: [],
    sheetSummaries: [],
    folderUpload: {
      folderName: "",
      validImageCount: 0,
      ignoredFileCount: 0,
      totalImageBytes: 0
    },
    imageFiles: [],
    issues: [],
    gmail: {
      connected: false,
      address: "",
      tokens: null,
      grantedScopes: [],
      canSend: false,
      missingScopes: [],
      error: "",
      state: ""
    },
    queue: {
      pending: [],
      currentStudentId: "",
      sentIds: [],
      failedIds: [],
      log: [],
      running: false
    }
  };
}

function createSessionStore() {
  const store = new Map();
  fs.mkdirSync(TMP_DIR, { recursive: true });

  async function destroySession(sessionId) {
    const state = store.get(sessionId);
    store.delete(sessionId);
    if (state) {
      await deletePath(path.join(TMP_DIR, sessionId));
    }
  }

  function get(sessionId) {
    let state = store.get(sessionId);
    if (!state) {
      state = createEmptyState(sessionId);
      store.set(sessionId, state);
    }
    state.expiresAt = Date.now() + SESSION_TTL_MS;
    return state;
  }

  function set(sessionId, nextState) {
    nextState.expiresAt = Date.now() + SESSION_TTL_MS;
    store.set(sessionId, nextState);
    return nextState;
  }

  async function reset(sessionId) {
    const state = createEmptyState(sessionId);
    await deletePath(path.join(TMP_DIR, sessionId));
    store.set(sessionId, state);
    return state;
  }

  async function cleanupExpiredSessions() {
    const now = Date.now();
    const expiredIds = [];
    store.forEach((state, sessionId) => {
      if (state.expiresAt <= now) {
        expiredIds.push(sessionId);
      }
    });
    for (const sessionId of expiredIds) {
      await destroySession(sessionId);
    }
    return expiredIds;
  }

  return {
    get,
    set,
    reset,
    destroySession,
    cleanupExpiredSessions,
    _store: store
  };
}

module.exports = {
  createSessionStore
};
