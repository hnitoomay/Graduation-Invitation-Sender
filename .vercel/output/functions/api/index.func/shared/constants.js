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
const MAX_BATCH_SIZE = 100;
const MAX_IMAGE_COUNT = 300;
const MAX_TOTAL_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_EXCEL_BYTES = 10 * 1024 * 1024;
const SUPPORTED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png"];
const DEFAULT_SUBJECT = "Graduation Ceremony 2026 Invitation - {{studentName}}";
const STRATEGY_FIRST_LOGO_CID = "strategy-first-logo";
const PROJECT_SAMPLE_FILES = {
  workbook: "Graduation List 2026 Bachelor's Student.xlsx",
  docx: "Email Body.docx",
  logo: "Picture1.png",
  images: ["2022B2177_Ou Ou Aung.jpg", "2022B4575_Yamin Myat.jpg"]
};

module.exports = {
  SESSION_LABELS,
  SHEET_SESSION_MAP,
  REQUIRED_HEADERS,
  MAX_BATCH_SIZE,
  MAX_IMAGE_COUNT,
  MAX_TOTAL_IMAGE_BYTES,
  MAX_EXCEL_BYTES,
  SUPPORTED_IMAGE_EXTENSIONS,
  DEFAULT_SUBJECT,
  STRATEGY_FIRST_LOGO_CID,
  PROJECT_SAMPLE_FILES
};
