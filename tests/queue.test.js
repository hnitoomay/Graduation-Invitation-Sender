const path = require("path");
const {
  buildMimeMessageSource,
  enqueueStudents,
  getEligibleStudentsForAutomaticSend,
  sendOneEmail,
  withRetries
} = require("../server/sendQueue");
const { ROOT_DIR } = require("../server/config");
const { loadDocxTemplate, FOOTER_LINES } = require("../server/docxTemplate");
const { PROJECT_SAMPLE_FILES } = require("../shared/constants");
const { createSessionStore } = require("../server/sessionStore");

function makeStudent(index, overrides = {}) {
  return {
    id: `student-${index}`,
    studentName: `Student ${index}`,
    sficId: `${index}`,
    email: `student${index}@example.com`,
    sessionKey: index % 2 === 0 ? "A" : "B",
    workbookSheet: "Wolver BA",
    imageMatch: {
      matchStatus: "ready",
      originalName: `Student ${index} - Graduation Invitation.jpg`,
      filePath: path.join(ROOT_DIR, PROJECT_SAMPLE_FILES.images[0]),
      attachmentName: `Student ${index} - Graduation Invitation.jpg`
    },
    sendState: "not_sent",
    hasMultipleEmails: false,
    sendError: "",
    ...overrides
  };
}

function makeSessionState(students = []) {
  return {
    students,
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

describe("queue and session behavior", () => {
  test("prevents duplicate send without explicit resend", () => {
    const sessionState = makeSessionState();
    const student = makeStudent(1, { sendState: "sent" });
    expect(() => enqueueStudents(sessionState, [student])).toThrow(/already sent/);
  });

  test("session reset and expiration cleanup", async () => {
    const store = createSessionStore();
    const state = store.get("session-1");
    state.workbookPath = "tmp/session-1/workbook.xlsx";
    await store.reset("session-1");
    expect(store.get("session-1").workbookPath).toBe("");
    store.get("session-1").expiresAt = Date.now() - 1;
    const expired = await store.cleanupExpiredSessions();
    expect(expired).toContain("session-1");
  });

  test("builds MIME with one inline logo, one invitation attachment, and plain-text footer", async () => {
    const template = await loadDocxTemplate(ROOT_DIR);
    const student = makeStudent(1, { sessionKey: "A" });
    const model = require("../shared/email").buildEmailModel(student, template);
    const mime = buildMimeMessageSource({
      from: "sender@example.com",
      to: student.email,
      subject: model.subject,
      text: model.text,
      html: model.html,
      logoPath: path.join(ROOT_DIR, PROJECT_SAMPLE_FILES.logo),
      attachmentPath: student.imageMatch.filePath,
      attachmentName: student.imageMatch.attachmentName
    });

    expect((mime.match(/Content-ID: <strategy-first-logo>/g) || []).length).toBe(1);
    expect((mime.match(/Content-Disposition: inline; filename="Picture1\.png"/g) || []).length).toBe(1);
    expect((mime.match(/Content-Disposition: attachment; filename="Student 1 - Graduation Invitation\.jpg"/g) || []).length).toBe(1);
    expect((mime.match(/Content-Disposition: attachment;/g) || []).length).toBe(1);
    expect(mime).toContain('Content-Type: multipart/alternative;');
    expect(mime).toContain('Content-Type: multipart/related;');
    FOOTER_LINES.forEach((line) => {
      if (line) {
        expect(mime).toContain(line);
      }
    });
  });

  test("keeps logo inline and invitation attachment separate", async () => {
    const mime = buildMimeMessageSource({
      from: "sender@example.com",
      to: "student@example.com",
      subject: "Subject",
      text: "Plain text footer",
      html: '<img src="cid:strategy-first-logo" alt="Strategy First International College" width="105" />',
      logoPath: path.join(ROOT_DIR, PROJECT_SAMPLE_FILES.logo),
      attachmentPath: path.join(ROOT_DIR, PROJECT_SAMPLE_FILES.images[0]),
      attachmentName: "Student A - Graduation Invitation.jpg"
    });

    expect(mime).toContain('src="cid:strategy-first-logo"');
    expect(mime).toContain('Content-Type: image/png; name="Picture1.png"');
    expect(mime).toContain('Content-Disposition: inline; filename="Picture1.png"');
    expect(mime).toContain('Content-Disposition: attachment; filename="Student A - Graduation Invitation.jpg"');
  });

  test("derives all 173 eligible ready students for one automatic batch", () => {
    const students = Array.from({ length: 173 }, (_, index) => makeStudent(index + 1));
    const sessionState = makeSessionState(students);

    const eligible = getEligibleStudentsForAutomaticSend(sessionState);

    expect(eligible).toHaveLength(173);
    enqueueStudents(sessionState, eligible);
    expect(sessionState.queue.pending).toHaveLength(173);
  });

  test("excludes missing, invalid, failed, mismatched, duplicate, sent, pending, and sending students", () => {
    const students = [
      makeStudent(1),
      makeStudent(2, { email: "invalid email" }),
      makeStudent(3, { imageMatch: null }),
      makeStudent(4, { imageMatch: { matchStatus: "name_mismatch" } }),
      makeStudent(5, { imageMatch: { matchStatus: "duplicate_image" } }),
      makeStudent(6, { sendState: "failed", sendError: "Temporary failure" }),
      makeStudent(7, { sendState: "sent" }),
      makeStudent(8),
      makeStudent(9)
    ];
    const sessionState = makeSessionState(students);
    sessionState.queue.pending = ["student-8"];
    sessionState.queue.currentStudentId = "student-9";

    const eligible = getEligibleStudentsForAutomaticSend(sessionState);

    expect(eligible.map((student) => student.id)).toEqual(["student-1"]);
  });

  test("eligible students are queued as individual messages", () => {
    const students = [makeStudent(1), makeStudent(2), makeStudent(3)];
    const sessionState = makeSessionState(students);
    const eligible = getEligibleStudentsForAutomaticSend(sessionState);

    enqueueStudents(sessionState, eligible);

    expect(sessionState.queue.pending).toEqual(["student-1", "student-2", "student-3"]);
  });

  test("retryable failures remain retryable", async () => {
    let attempts = 0;

    const result = await withRetries(async () => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("Temporary Gmail failure");
        error.code = 429;
        throw error;
      }
      return "ok";
    });

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  test("does not send real email during automated tests", async () => {
    const template = {
      render() {
        return "<p>Test</p>";
      },
      renderText() {
        return "Test";
      }
    };
    const messageId = await sendOneEmail(
      {
        gmail: {
          tokens: { access_token: "unused" },
          address: "sender@example.com"
        }
      },
      makeStudent(1),
      template
    );

    expect(messageId).toMatch(/^demo-1-/);
  });
});
