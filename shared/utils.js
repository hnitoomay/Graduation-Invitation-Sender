function collapseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeName(value) {
  return collapseWhitespace(value).normalize("NFKC").toLocaleLowerCase();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeFilename(value) {
  const clean = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\.\.+/g, ".")
    .trim();
  return clean || "file";
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  collapseWhitespace,
  normalizeName,
  escapeHtml,
  sanitizeFilename,
  makeStudentKey,
  parsePossibleEmails,
  delay
};
