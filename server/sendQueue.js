const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { createOAuthClient } = require("./googleAuth");
const { DEMO_MODE, ROOT_DIR } = require("./config");
const { buildEmailModel, renderSubject } = require("../shared/email");
const { deriveStudentStatus } = require("../shared/matching");
const {
  collapseWhitespace,
  delay,
  parsePossibleEmails,
  sanitizeFilename
} = require("../shared/utils");
const {
  PROJECT_SAMPLE_FILES,
  STRATEGY_FIRST_LOGO_CID
} = require("../shared/constants");

function isAutomatedTestRun() {
  return Boolean(process.env.VITEST || process.env.NODE_ENV === "test");
}

function toBase64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sanitizeHeaderValue(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function buildMimeMessageSource({
  from,
  to,
  subject,
  text,
  html,
  logoPath,
  attachmentPath,
  attachmentName
}) {
  const mixedBoundary = `mixed_${Date.now()}`;
  const alternativeBoundary = `alt_${Date.now()}`;
  const relatedBoundary = `related_${Date.now()}`;
  const safeAttachmentName = sanitizeFilename(sanitizeHeaderValue(attachmentName));
  const safeLogoName = sanitizeFilename(PROJECT_SAMPLE_FILES.logo);
  const safeFrom = sanitizeHeaderValue(from);
  const safeTo = sanitizeHeaderValue(to);
  const safeSubject = sanitizeHeaderValue(subject);
  const logo = fs.readFileSync(logoPath);
  const attachment = fs.readFileSync(attachmentPath);
  const logoBase64 = logo.toString("base64");
  const attachmentBase64 = attachment.toString("base64");
  const ext = safeAttachmentName.toLowerCase().endsWith(".png") ? "png" : "jpeg";
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
    `Content-Type: image/${ext}; name="${safeAttachmentName}"`,
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

function getSingleValidEmailAddress(value) {
  const raw = collapseWhitespace(value);
  const parsed = parsePossibleEmails(raw);
  if (parsed.emails.length !== 1) {
    return "";
  }
  return parsed.emails[0] === raw ? parsed.emails[0] : "";
}

function isStudentPendingOrSending(sessionState, studentId) {
  return (
    sessionState.queue.currentStudentId === studentId ||
    sessionState.queue.pending.includes(studentId)
  );
}

function isStudentEligibleForAutomaticSend(sessionState, student) {
  const status = deriveStudentStatus(student, sessionState);
  return (
    status.status === "Ready" &&
    Boolean(getSingleValidEmailAddress(student.email)) &&
    student.imageMatch?.matchStatus === "ready" &&
    student.sendState !== "sent" &&
    !isStudentPendingOrSending(sessionState, student.id)
  );
}

function getEligibleStudentsForAutomaticSend(sessionState, students = sessionState.students) {
  return students.filter((student) => isStudentEligibleForAutomaticSend(sessionState, student));
}

function makeQueueSnapshot(queue) {
  return {
    pending: queue.pending.length,
    pendingIds: [...queue.pending],
    currentStudentId: queue.currentStudentId,
    sent: queue.sentIds.length,
    failed: queue.failedIds.length,
    remaining: queue.pending.length + (queue.currentStudentId ? 1 : 0),
    log: queue.log.slice(-100)
  };
}

async function sendOneRealEmail(gmailTokens, payload) {
  const oauth = createOAuthClient();
  oauth.setCredentials(gmailTokens);
  const gmail = google.gmail({ version: "v1", auth: oauth });
  const raw = createMimeMessage(payload);
  const result = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw
    }
  });
  return result.data.id;
}

async function sendOneEmail(sessionState, student, template, subjectTemplate, testRecipient = "") {
  const model = buildEmailModel(student, template);
  const subject = renderSubject(student.studentName, subjectTemplate || model.subject);
  const to = testRecipient || student.email;

  if (DEMO_MODE || isAutomatedTestRun()) {
    await delay(150);
    return `demo-${student.sficId}-${Date.now()}`;
  }

  return sendOneRealEmail(sessionState.gmail.tokens, {
    from: sessionState.gmail.address,
    to,
    subject,
    text: model.text,
    html: model.html,
    logoPath: path.join(ROOT_DIR, PROJECT_SAMPLE_FILES.logo),
    attachmentPath: student.imageMatch.filePath,
    attachmentName: student.imageMatch.attachmentName
  });
}

function isRetryableError(error) {
  const status = error?.code || error?.status;
  return status === 429 || (status >= 500 && status < 600);
}

async function withRetries(task) {
  const delays = [1000, 2000, 4000];
  let attempt = 0;
  while (true) {
    try {
      return await task();
    } catch (error) {
      if (!isRetryableError(error) || attempt >= delays.length) {
        throw error;
      }
      await delay(delays[attempt]);
      attempt += 1;
    }
  }
}

async function processQueue(sessionState, template, getStudentById) {
  if (sessionState.queue.running) {
    return;
  }
  sessionState.queue.running = true;

  while (sessionState.queue.pending.length > 0) {
    const studentId = sessionState.queue.pending.shift();
    const student = getStudentById(studentId);
    if (!student) {
      continue;
    }
    sessionState.queue.currentStudentId = studentId;

    try {
      const messageId = await withRetries(() =>
        sendOneEmail(sessionState, student, template)
      );
      student.sendState = "sent";
      student.gmailMessageId = messageId;
      student.sendError = "";
      student.lastAttemptAt = new Date().toISOString();
      if (!sessionState.queue.sentIds.includes(student.id)) {
        sessionState.queue.sentIds.push(student.id);
      }
      sessionState.queue.log.push({
        studentId: student.id,
        studentName: student.studentName,
        result: "sent",
        messageId,
        at: new Date().toISOString()
      });
    } catch (error) {
      student.sendState = "failed";
      student.sendError = error.message || "Email send failed.";
      student.lastAttemptAt = new Date().toISOString();
      if (!sessionState.queue.failedIds.includes(student.id)) {
        sessionState.queue.failedIds.push(student.id);
      }
      sessionState.queue.log.push({
        studentId: student.id,
        studentName: student.studentName,
        result: "failed",
        error: student.sendError,
        at: new Date().toISOString()
      });
    }
    sessionState.queue.currentStudentId = "";
    await delay(1200);
  }

  sessionState.queue.running = false;
}

function enqueueStudents(sessionState, students, allowResendIds = []) {
  students.forEach((student) => {
    const status = deriveStudentStatus(student, sessionState);
    if (student.sendState === "sent" && !allowResendIds.includes(student.id)) {
      throw new Error(`Student ${student.studentName} was already sent in this session.`);
    }
    if (!status.selectable && student.sendState !== "sent") {
      throw new Error(`Student ${student.studentName} is not sendable.`);
    }
    if (!sessionState.queue.pending.includes(student.id)) {
      sessionState.queue.pending.push(student.id);
    }
  });
}

module.exports = {
  STRATEGY_FIRST_LOGO_CID,
  buildMimeMessageSource,
  createMimeMessage,
  getEligibleStudentsForAutomaticSend,
  getSingleValidEmailAddress,
  isStudentEligibleForAutomaticSend,
  makeQueueSnapshot,
  sendOneEmail,
  withRetries,
  processQueue,
  enqueueStudents
};
