const path = require("path");
const { parseImageFilename } = require("./images");
const { normalizeName, sanitizeFilename } = require("./utils");

function deriveStudentStatus(student, sessionData) {
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
    return { status: "Sent", selectable: false, reason: "Already sent in this session." };
  }
  if (student.sendState === "failed") {
    return { status: "Failed", selectable: true, reason: student.sendError || "Previous send failed." };
  }
  if (sessionData.queue.currentStudentId === student.id) {
    return { status: "Sending", selectable: false, reason: "Currently sending." };
  }
  return { status: "Ready", selectable: true, reason: "" };
}

function buildAttachmentName(studentName, originalPath) {
  const extension = path.extname(originalPath || "").toLocaleLowerCase() || ".jpg";
  return sanitizeFilename(`${studentName} - Graduation Invitation${extension}`);
}

function matchStudentsWithImages(students, imageFiles, existingIssues = []) {
  const issues = [...existingIssues];
  const imagesByStudent = new Map();
  const studentsBySficOnly = new Map(students.map((student) => [student.sficId, student]));

  imageFiles.forEach((image) => {
    const parsed = parseImageFilename(image.originalName);
    if (!parsed.valid) {
      issues.push({
        type: "unsupported_file",
        fileName: image.originalName,
        message: parsed.error
      });
      return;
    }

    const student = studentsBySficOnly.get(parsed.sficId);
    if (!student) {
      issues.push({
        type: "unknown_sfic_id",
        fileName: image.originalName,
        sficId: parsed.sficId,
        message: "Unknown SFIC ID."
      });
      return;
    }

    const bucket = imagesByStudent.get(student.id) || [];
    bucket.push({
      ...image,
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
        filePath: readyMatch.filePath,
        attachmentName: buildAttachmentName(student.studentName, readyMatch.filePath)
      };
    } else if (matches.length === 1) {
      imageMatch = {
        matchStatus: "name_mismatch",
        originalName: matches[0].originalName,
        filePath: matches[0].filePath,
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

module.exports = {
  deriveStudentStatus,
  buildAttachmentName,
  matchStudentsWithImages
};
