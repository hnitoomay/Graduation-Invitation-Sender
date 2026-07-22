import * as XLSX from "xlsx";

const SESSION_LABELS = {
  A: {
    key: "A",
    label: "Session A",
    time: "8:00 AM to 10:30 AM (Session A)",
    arrival: "7:30 AM"
  },
  B: {
    key: "B",
    label: "Session B",
    time: "11:00 AM to 1:30 PM (Session B)",
    arrival: "10:30 AM"
  }
};

const SHEET_SESSION_MAP = {
  "Wolver BA": "A",
  "Wolver BSc": "A",
  "Greater Manchester": "A",
  UClan: "B"
};

const REQUIRED_HEADERS = ["Student Name", "SFIC ID", "Email Address"];
const DEFAULT_SUBJECT = "Graduation Ceremony 2026 Invitation - {{studentName}}";

function collapseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeName(value) {
  return collapseWhitespace(value).normalize("NFKC").toLocaleLowerCase();
}

function makeStudentKey(sheetName, sficId) {
  return `${sheetName}::${String(sficId || "").trim()}`;
}

function parsePossibleEmails(value) {
  const raw = collapseWhitespace(value);
  if (!raw) {
    return { raw: "", emails: [], hasMultiple: false };
  }
  const emails = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return {
    raw,
    emails: emails.map((email) => email.trim()),
    hasMultiple: emails.length > 1
  };
}

function normalizeHeader(value) {
  return collapseWhitespace(value).toLocaleLowerCase();
}

function detectHeaderRow(rows) {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index].map(normalizeHeader);
    const hasAll = REQUIRED_HEADERS.every((header) => row.includes(normalizeHeader(header)));
    if (!hasAll) {
      continue;
    }
    const headerIndex = {};
    row.forEach((cell, cellIndex) => {
      REQUIRED_HEADERS.forEach((header) => {
        if (cell === normalizeHeader(header)) {
          headerIndex[header] = cellIndex;
        }
      });
    });
    return { rowIndex: index, headerIndex };
  }
  return null;
}

export function parseWorkbookFile(file) {
  return file.arrayBuffer().then((arrayBuffer) => {
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const students = [];
    const sheetSummaries = [];
    const errors = [];

    workbook.SheetNames.forEach((sheetName) => {
      const sessionKey = SHEET_SESSION_MAP[sheetName];
      if (!sessionKey) {
        return;
      }

      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        raw: false,
        defval: ""
      });
      const header = detectHeaderRow(rows);
      if (!header) {
        errors.push({
          type: "header_not_found",
          message: `Required headers not found in ${sheetName}.`
        });
        return;
      }

      let count = 0;
      for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        const studentName = collapseWhitespace(row[header.headerIndex["Student Name"]]);
        const sficId = collapseWhitespace(row[header.headerIndex["SFIC ID"]]);
        const emailRaw = collapseWhitespace(row[header.headerIndex["Email Address"]]);
        if (!studentName && !sficId && !emailRaw) {
          continue;
        }
        const emailInfo = parsePossibleEmails(emailRaw);
        students.push({
          id: makeStudentKey(sheetName, sficId),
          studentName,
          sficId,
          email: emailInfo.hasMultiple ? "" : emailInfo.emails[0] || "",
          emailRaw,
          hasMultipleEmails: emailInfo.hasMultiple,
          workbookSheet: sheetName,
          sessionKey,
          sessionLabel: SESSION_LABELS[sessionKey].label,
          imageMatch: null,
          sendState: "not_sent",
          sendError: "",
          gmailMessageId: "",
          lastAttemptAt: "",
          rowNumber: rowIndex + 1
        });
        count += 1;
      }

      sheetSummaries.push({
        sheetName,
        sessionKey,
        count,
        headerRowNumber: header.rowIndex + 1
      });
    });

    return { students, sheetSummaries, errors };
  });
}

function parseImageFilename(filename) {
  const lastDot = filename.lastIndexOf(".");
  const extension = lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : "";
  if (![".jpg", ".jpeg", ".png"].includes(extension)) {
    return { valid: false, error: "Unsupported file type." };
  }
  const stem = filename.slice(0, -extension.length);
  const underscoreIndex = stem.indexOf("_");
  if (underscoreIndex <= 0 || underscoreIndex === stem.length - 1) {
    return { valid: false, error: "Filename must follow SFICID_Name.ext format." };
  }
  const sficId = collapseWhitespace(stem.slice(0, underscoreIndex));
  const studentName = collapseWhitespace(stem.slice(underscoreIndex + 1));
  return {
    valid: Boolean(sficId && studentName),
    sficId,
    studentName,
    normalizedName: normalizeName(studentName),
    extension
  };
}

function buildAttachmentName(studentName, filename) {
  const lastDot = filename.lastIndexOf(".");
  const extension = lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : ".jpg";
  return `${studentName} - Graduation Invitation${extension}`;
}

export function matchStudentsWithImages(students, files) {
  const issues = [];
  const imagesByStudent = new Map();
  const studentsBySficId = new Map(students.map((student) => [student.sficId, student]));

  files.forEach((file) => {
    const parsed = parseImageFilename(file.name);
    if (!parsed.valid) {
      issues.push({
        type: "unsupported_file",
        fileName: file.name,
        message: parsed.error
      });
      return;
    }

    const student = studentsBySficId.get(parsed.sficId);
    if (!student) {
      issues.push({
        type: "unknown_sfic_id",
        fileName: file.name,
        sficId: parsed.sficId,
        message: "Unknown SFIC ID."
      });
      return;
    }

    const bucket = imagesByStudent.get(student.id) || [];
    bucket.push({
      file,
      originalName: file.name,
      parsed,
      nameMatches: normalizeName(student.studentName) === parsed.normalizedName
    });
    imagesByStudent.set(student.id, bucket);
  });

  const nextStudents = students.map((student) => {
    const matches = imagesByStudent.get(student.id) || [];
    const readyMatch = matches.find((item) => item.nameMatches);

    let imageMatch = null;
    if (matches.length > 1) {
      issues.push({
        type: "duplicate_image",
        sficId: student.sficId,
        message: `Duplicate images detected for ${student.sficId}.`
      });
      imageMatch = {
        matchStatus: "duplicate_image",
        fileNames: matches.map((item) => item.originalName)
      };
    } else if (matches.length === 1 && readyMatch) {
      imageMatch = {
        matchStatus: "ready",
        originalName: readyMatch.originalName,
        file: readyMatch.file,
        attachmentName: buildAttachmentName(student.studentName, readyMatch.originalName)
      };
    } else if (matches.length === 1) {
      imageMatch = {
        matchStatus: "name_mismatch",
        originalName: matches[0].originalName,
        expectedName: student.studentName,
        parsedName: matches[0].parsed.studentName
      };
    }

    return {
      ...student,
      imageMatch
    };
  });

  return { students: nextStudents, issues };
}

export function deriveStudentStatus(student, queue) {
  if (!student.studentName || !student.sficId) {
    return { status: "Error", selectable: false, reason: "Missing student name or SFIC ID." };
  }
  if (student.hasMultipleEmails) {
    return { status: "Error", selectable: false, reason: "Multiple email addresses require manual resolution." };
  }
  if (!student.email) {
    return { status: "Error", selectable: false, reason: "Email address is required." };
  }
  if (!student.imageMatch) {
    return { status: "Missing", selectable: false, reason: "No invitation image matched." };
  }
  if (student.imageMatch.matchStatus === "name_mismatch") {
    return { status: "Error", selectable: false, reason: "Image SFIC ID matched but name did not." };
  }
  if (student.imageMatch.matchStatus === "duplicate_image") {
    return { status: "Error", selectable: false, reason: "Duplicate invitation image detected." };
  }
  if (student.sendState === "sent") {
    return { status: "Sent", selectable: false, reason: "Already sent in this browser session." };
  }
  if (student.sendState === "failed") {
    return { status: "Failed", selectable: true, reason: student.sendError || "Previous send failed." };
  }
  if (queue.currentStudentId === student.id) {
    return { status: "Sending", selectable: false, reason: "Currently sending." };
  }
  return { status: "Ready", selectable: true, reason: "" };
}

export function isSingleValidEmail(email) {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(String(email || "").trim());
}

export function createInitialQueue() {
  return {
    pending: 0,
    pendingIds: [],
    currentStudentId: "",
    sent: 0,
    failed: 0,
    remaining: 0
  };
}

export function resetStudentSending(students) {
  return students.map((student) => ({
    ...student,
    sendState: "not_sent",
    sendError: "",
    gmailMessageId: "",
    lastAttemptAt: ""
  }));
}

export function createFolderSummary(files) {
  const firstPath = files[0]?.webkitRelativePath || files[0]?.name || "";
  const folderName = firstPath.includes("/") ? firstPath.split("/")[0] : "";
  const validImageCount = files.filter((file) =>
    [".jpg", ".jpeg", ".png"].some((ext) => file.name.toLowerCase().endsWith(ext))
  ).length;
  const ignoredFileCount = files.length - validImageCount;
  const totalImageBytes = files.reduce((sum, file) => sum + file.size, 0);

  return {
    folderName,
    validImageCount,
    ignoredFileCount,
    totalImageBytes
  };
}

export function createCsvReport(students, queue) {
  const lines = ["Student Name,SFIC ID,Email,Session,Status,Message ID,Error"];
  students.forEach((student) => {
    const state = deriveStudentStatus(student, queue);
    lines.push(
      [
        student.studentName,
        student.sficId,
        student.email,
        student.sessionLabel,
        state.status,
        student.gmailMessageId,
        student.sendError
      ]
        .map((value) => `"${String(value || "").replace(/"/g, '""')}"`)
        .join(",")
    );
  });
  return lines.join("\n");
}

export function defaultSubjectFor(studentName) {
  return DEFAULT_SUBJECT.replace("{{studentName}}", studentName);
}
