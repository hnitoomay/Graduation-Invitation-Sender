/* @vitest-environment jsdom */

import { describe, expect, test } from "vitest";
import {
  matchStudentsWithImages,
  deriveStudentStatus,
  createFolderSummary
} from "../src/browserData";

function makeStudent(overrides = {}) {
  return {
    id: "Wolver BA::2022B2177",
    studentName: "Ou Ou Aung",
    sficId: "2022B2177",
    email: "student@example.com",
    hasMultipleEmails: false,
    sessionKey: "A",
    sessionLabel: "Session A",
    workbookSheet: "Wolver BA",
    imageMatch: null,
    sendState: "not_sent",
    sendError: "",
    gmailMessageId: "",
    ...overrides
  };
}

describe("browser-side workbook and image matching", () => {
  test("matches a browser File object to the correct student", () => {
    const file = new File(["x"], "2022B2177_Ou Ou Aung.jpg", {
      type: "image/jpeg"
    });
    const result = matchStudentsWithImages([makeStudent()], [file]);

    expect(result.students[0].imageMatch.matchStatus).toBe("ready");
    expect(result.students[0].imageMatch.file).toBe(file);
  });

  test("derives ready and error states in browser memory", () => {
    const matchedImage = {
      matchStatus: "ready",
      originalName: "2022B2177_Ou Ou Aung.jpg",
      file: new File(["x"], "2022B2177_Ou Ou Aung.jpg", { type: "image/jpeg" })
    };
    const readyStudent = makeStudent({
      imageMatch: matchedImage
    });
    const failedStudent = makeStudent({
      imageMatch: matchedImage,
      sendState: "failed",
      sendError: "Mailbox unavailable"
    });

    expect(deriveStudentStatus(readyStudent, { currentStudentId: "" }).status).toBe("Ready");
    expect(deriveStudentStatus(failedStudent, { currentStudentId: "" }).status).toBe("Failed");
  });

  test("summarizes a selected browser folder without backend uploads", () => {
    const files = [
      new File(["1"], "2022B2177_Ou Ou Aung.jpg", { type: "image/jpeg" }),
      new File(["2"], "notes.txt", { type: "text/plain" })
    ];
    Object.defineProperty(files[0], "webkitRelativePath", {
      value: "Invitations/2022B2177_Ou Ou Aung.jpg"
    });
    Object.defineProperty(files[1], "webkitRelativePath", {
      value: "Invitations/notes.txt"
    });

    const summary = createFolderSummary(files);

    expect(summary.folderName).toBe("Invitations");
    expect(summary.validImageCount).toBe(1);
    expect(summary.ignoredFileCount).toBe(1);
  });
});
