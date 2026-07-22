const { createApp } = require("../server/app");
const TEST_TOKEN_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function makeStudent(index, overrides = {}) {
  return {
    id: `student-${index}`,
    studentName: `Student ${index}`,
    sficId: `2022B${String(index).padStart(4, "0")}`,
    email: `student${index}@example.com`,
    emailRaw: `student${index}@example.com`,
    hasMultipleEmails: false,
    workbookSheet: "Wolver BA",
    sessionKey: index % 2 === 0 ? "B" : "A",
    sessionLabel: index % 2 === 0 ? "Session B" : "Session A",
    imageMatch: {
      matchStatus: "ready",
      originalName: `Student ${index} - Graduation Invitation.jpg`,
      filePath: "fixture.jpg",
      attachmentName: `Student ${index} - Graduation Invitation.jpg`
    },
    sendState: "not_sent",
    sendError: "",
    ...overrides
  };
}

async function startServer() {
  const { app, shutdown, sessionStore, gmailState } = createApp({
    tokenEncryptionKey: TEST_TOKEN_KEY
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    app,
    shutdown,
    sessionStore,
    gmailState,
    baseUrl: `http://localhost:${server.address().port}`,
    async close() {
      await shutdown();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

describe("automatic batch send endpoint", () => {
  test("queues all eligible students from the server session and ignores client-supplied ids", async () => {
    const server = await startServer();

    try {
      const sessionResponse = await fetch(`${server.baseUrl}/api/session`);
      const cookie = sessionResponse.headers.get("set-cookie").split(";")[0];
      const sessionState = Array.from(server.sessionStore._store.values())[0];
      Object.assign(server.gmailState, {
        connected: true,
        address: "student_registry@mystrategyfirst.com",
        tokens: { refresh_token: "redacted" },
        grantedScopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"],
        canSend: true,
        missingScopes: [],
        error: ""
      });
      sessionState.students = Array.from({ length: 173 }, (_, index) => makeStudent(index + 1));

      const response = await fetch(`${server.baseUrl}/api/send/batch`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          studentIds: ["not-used-1", "not-used-2"]
        })
      });
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.queue.remaining).toBe(173);
      expect(json.queue.pending + (json.queue.currentStudentId ? 1 : 0)).toBe(173);
    } finally {
      await server.close();
    }
  });

  test("excludes invalid and previously sent students and prevents an immediate duplicate job", async () => {
    const server = await startServer();

    try {
      const sessionResponse = await fetch(`${server.baseUrl}/api/session`);
      const cookie = sessionResponse.headers.get("set-cookie").split(";")[0];
      const sessionState = Array.from(server.sessionStore._store.values())[0];
      Object.assign(server.gmailState, {
        connected: true,
        address: "student_registry@mystrategyfirst.com",
        tokens: { refresh_token: "redacted" },
        grantedScopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"],
        canSend: true,
        missingScopes: [],
        error: ""
      });
      sessionState.students = [
        makeStudent(1),
        makeStudent(2, { email: "invalid email" }),
        makeStudent(3, { sendState: "sent" }),
        makeStudent(4, { imageMatch: null }),
        makeStudent(5)
      ];

      const firstResponse = await fetch(`${server.baseUrl}/api/send/batch`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: "{}"
      });
      const firstJson = await firstResponse.json();

      expect(firstResponse.status).toBe(200);
      expect(firstJson.queue.remaining).toBe(2);

      const secondResponse = await fetch(`${server.baseUrl}/api/send/batch`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: "{}"
      });
      const secondJson = await secondResponse.json();

      expect(secondResponse.status).toBe(400);
      expect(secondJson.error).toMatch(/No Ready emails to send/);
    } finally {
      await server.close();
    }
  });
});
