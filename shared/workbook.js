const XLSX = require("xlsx");
const {
  REQUIRED_HEADERS,
  SHEET_SESSION_MAP,
  SESSION_LABELS
} = require("./constants");
const {
  collapseWhitespace,
  parsePossibleEmails,
  makeStudentKey
} = require("./utils");

function normalizeHeader(value) {
  return collapseWhitespace(value).toLocaleLowerCase();
}

function detectHeaderRow(rows) {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index].map(normalizeHeader);
    const hasAll = REQUIRED_HEADERS.every((header) =>
      row.includes(normalizeHeader(header))
    );
    if (hasAll) {
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
  }

  return null;
}

function parseWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const students = [];
  const sheetSummaries = [];
  const errors = [];

  workbook.SheetNames.forEach((sheetName) => {
    const sessionKey = SHEET_SESSION_MAP[sheetName];
    if (!sessionKey) {
      return;
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
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

    let sheetCount = 0;
    for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const studentName = collapseWhitespace(row[header.headerIndex["Student Name"]]);
      const sficId = collapseWhitespace(row[header.headerIndex["SFIC ID"]]);
      const emailRaw = collapseWhitespace(row[header.headerIndex["Email Address"]]);

      if (!studentName && !sficId && !emailRaw) {
        continue;
      }

      const emailInfo = parsePossibleEmails(emailRaw);
      const email = emailInfo.hasMultiple ? "" : (emailInfo.emails[0] || "");

      students.push({
        id: makeStudentKey(sheetName, sficId),
        studentName,
        sficId,
        email,
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
      sheetCount += 1;
    }

    sheetSummaries.push({
      sheetName,
      sessionKey,
      count: sheetCount,
      headerRowNumber: header.rowIndex + 1
    });
  });

  return { students, sheetSummaries, errors };
}

module.exports = {
  detectHeaderRow,
  parseWorkbook
};
