/* @vitest-environment jsdom */

import ReactDOM from "react-dom/client";
import { act } from "react";
import { vi } from "vitest";
import App from "../src/App";

vi.mock("../src/api", () => ({
  apiFetch: vi.fn(),
  apiJson: vi.fn()
}));

const { apiFetch, apiJson } = await import("../src/api");

function makeStudent(index, overrides = {}) {
  return {
    id: `student-${index}`,
    studentName: `Student ${index}`,
    sficId: `2022B${String(index).padStart(4, "0")}`,
    email: `student${index}@example.com`,
    workbookSheet: "Wolver BA",
    sessionKey: index % 2 === 0 ? "B" : "A",
    sessionLabel: index % 2 === 0 ? "Session B" : "Session A",
    status: "Ready",
    sendState: "not_sent",
    imageMatch: {
      matchStatus: "ready",
      originalName: `Student ${index} - Graduation Invitation.jpg`
    },
    ...overrides
  };
}

function createSession(overrides = {}) {
  return {
    demoMode: false,
    gmail: {
      connected: false,
      address: "",
      canSend: false,
      missingScopes: [],
      error: ""
    },
    workbookLoaded: false,
    folderUpload: {
      folderName: "",
      validImageCount: 0,
      ignoredFileCount: 0,
      totalImageBytes: 0
    },
    summary: {
      totalStudents: 3,
      sessionAStudents: 2,
      sessionBStudents: 1,
      successfullyMatched: 3,
      missingImages: 0,
      errors: 0,
      sentDuringSession: 0,
      failedDuringSession: 0
    },
    sheetSummaries: [],
    issues: [],
    students: [makeStudent(1), makeStudent(2), makeStudent(3, { status: "Error", email: "invalid" })],
    queue: {
      pending: 0,
      pendingIds: [],
      currentStudentId: "",
      sent: 0,
      failed: 0,
      remaining: 0,
      log: []
    },
    expiresAt: Date.now() + 1000,
    ...overrides
  };
}

async function renderApp(sessionData, authData = sessionData.gmail) {
  apiFetch.mockImplementation(async (_path) => ({
    ok: true,
    async json() {
      return sessionData;
    }
  }));
  apiJson.mockImplementation(async (path) => {
    if (path === "/api/auth/status") {
      return authData;
    }
    if (path === "/api/send/batch" || path === "/api/send/retry-failed" || path.startsWith("/api/students/")) {
      return sessionData;
    }
    throw new Error(`Unexpected apiJson path: ${path}`);
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  await act(async () => {
    root.render(<App />);
  });
  await act(async () => {
    await Promise.resolve();
  });

  return {
    container,
    root,
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
      apiFetch.mockReset();
      apiJson.mockReset();
    }
  };
}

describe("App UI", () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(window, "setInterval").mockImplementation(() => 1);
    vi.spyOn(window, "clearInterval").mockImplementation(() => {});
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  test("disables uploads until Gmail is connected and shows no selection UI", async () => {
    const sessionData = createSession();
    const { container, cleanup } = await renderApp(sessionData);

    try {
      const fileInputs = container.querySelectorAll('input[type="file"]');
      expect(fileInputs).toHaveLength(2);
      expect(fileInputs[0].disabled).toBe(true);
      expect(fileInputs[1].disabled).toBe(true);
      expect(container.textContent).toContain(
        "Connect your Gmail sender account before uploading student files."
      );
      expect(container.textContent).not.toContain("Select All Ready");
      expect(container.textContent).not.toContain("Clear Selected");
      expect(container.textContent).not.toContain("Selected count");
      expect(container.textContent).not.toContain("Maximum batch size");
      expect(container.textContent).not.toContain("Clear Uploaded Files");
      expect(container.textContent).not.toContain("Reset Session");
      expect(container.querySelector("th").textContent).toBe("Student name");
    } finally {
      cleanup();
    }
  });

  test("shows automatic ready counts, compact status only, and no preview or selection controls", async () => {
    const sessionData = createSession({
      gmail: {
        connected: true,
        address: "student_registry@mystrategyfirst.com",
        canSend: true,
        missingScopes: [],
        error: ""
      },
      summary: {
        totalStudents: 4,
        sessionAStudents: 3,
        sessionBStudents: 1,
        successfullyMatched: 4,
        missingImages: 0,
        errors: 1,
        sentDuringSession: 0,
        failedDuringSession: 0
      },
      students: [
        makeStudent(1, { sessionKey: "A", sessionLabel: "Session A" }),
        makeStudent(2, { sessionKey: "A", sessionLabel: "Session A" }),
        makeStudent(3, { sessionKey: "B", sessionLabel: "Session B" }),
        makeStudent(4, { status: "Error", email: "invalid" })
      ],
      queue: {
        pending: 2,
        pendingIds: ["student-2", "student-3"],
        currentStudentId: "student-1",
        sent: 4,
        failed: 1,
        remaining: 3,
        log: []
      }
    });
    const { container, cleanup } = await renderApp(sessionData);

    try {
      const fileInputs = container.querySelectorAll('input[type="file"]');
      expect(fileInputs[0].disabled).toBe(false);
      expect(fileInputs[1].disabled).toBe(false);
      expect(container.textContent).toContain("Ready to send: 0");
      expect(container.textContent).toContain("Session A: 0");
      expect(container.textContent).toContain("Session B: 0");
      expect(container.textContent).toContain("Blocked: 4");
      expect(container.textContent).toContain("No Ready Emails to Send");
      expect(container.textContent).toContain("Pending: 2");
      expect(container.textContent).toContain("Currently sending: Student 1");
      expect(container.textContent).toContain("Sent: 4");
      expect(container.textContent).toContain("Failed: 1");
      expect(container.textContent).toContain("Remaining: 3");
      expect(container.textContent).toContain("Retry Failed");
      expect(container.textContent).not.toContain("Clear Uploaded Files");
      expect(container.textContent).not.toContain("Reset Session");
      expect(container.textContent).not.toContain("Preview");
      expect(container.textContent).not.toContain("Select");
      expect(container.textContent).not.toContain("Email Preview");
      expect(container.textContent).not.toContain("Message ID");
      expect(container.querySelector(".student-table-scroll")).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  test("button label reflects all unsent ready students", async () => {
    const sessionData = createSession({
      gmail: {
        connected: true,
        address: "student_registry@mystrategyfirst.com",
        canSend: true,
        missingScopes: [],
        error: ""
      },
      students: [
        makeStudent(1, { sessionKey: "A", sessionLabel: "Session A" }),
        makeStudent(2, { sessionKey: "A", sessionLabel: "Session A" }),
        makeStudent(3, { sessionKey: "B", sessionLabel: "Session B" })
      ],
      summary: {
        totalStudents: 3,
        sessionAStudents: 2,
        sessionBStudents: 1,
        successfullyMatched: 3,
        missingImages: 0,
        errors: 0,
        sentDuringSession: 0,
        failedDuringSession: 0
      }
    });
    const { container, cleanup } = await renderApp(sessionData);

    try {
      expect(container.textContent).toContain("Ready to send: 3");
      expect(container.textContent).toContain("Session A: 2");
      expect(container.textContent).toContain("Session B: 1");
      expect(container.textContent).toContain("Send All 3 Ready Emails");
      expect(container.textContent).toContain(
        "Uploads, matches, and send progress are temporary. Gmail remains connected until you disconnect it."
      );
    } finally {
      cleanup();
    }
  });
});
