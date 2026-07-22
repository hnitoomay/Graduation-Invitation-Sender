const { detectHeaderRow } = require("../shared/workbook");
const { parsePossibleEmails, normalizeName } = require("../shared/utils");
const { SHEET_SESSION_MAP } = require("../shared/constants");

describe("workbook helpers", () => {
  test("detects header row after title rows", () => {
    const result = detectHeaderRow([
      ["Graduation Ceremony 2026"],
      [],
      ["No", "Student Name", "SFIC ID", "Email Address"]
    ]);
    expect(result.rowIndex).toBe(2);
    expect(result.headerIndex["Student Name"]).toBe(1);
  });

  test("normalizes unicode names", () => {
    expect(normalizeName("  O\u00A0u   O\u00A0u Aung  ")).toBe("o u o u aung");
  });

  test("trims email whitespace", () => {
    const parsed = parsePossibleEmails("  student@example.com  ");
    expect(parsed.emails).toEqual(["student@example.com"]);
  });

  test("detects multiple emails", () => {
    const parsed = parsePossibleEmails("a@example.com; b@example.com");
    expect(parsed.hasMultiple).toBe(true);
  });

  test("maps sheets to sessions", () => {
    expect(SHEET_SESSION_MAP["Wolver BA"]).toBe("A");
    expect(SHEET_SESSION_MAP.UClan).toBe("B");
  });
});
