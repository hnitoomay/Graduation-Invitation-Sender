const fs = require("fs");
const path = require("path");
const { TMP_DIR } = require("./config");
const {
  MAX_EXCEL_BYTES,
  MAX_IMAGE_COUNT,
  MAX_TOTAL_IMAGE_BYTES
} = require("../shared/constants");
const { sanitizeFilename } = require("../shared/utils");
const { isSupportedImageExtension } = require("../shared/images");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function deletePath(targetPath) {
  if (!targetPath) {
    return;
  }
  await fs.promises.rm(targetPath, { recursive: true, force: true });
}

function getSessionDir(sessionId) {
  return path.join(TMP_DIR, sanitizeFilename(sessionId));
}

function getSafeRelativePath(file) {
  const candidate = String(file.relativePath || file.webkitRelativePath || file.originalname || "");
  const normalized = candidate.replace(/\\/g, "/");
  if (
    normalized.includes("..") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new Error(`Unsafe upload path: ${candidate}`);
  }
  return normalized;
}

function shouldIgnoreFolderFile(file) {
  const relativePath = getSafeRelativePath(file);
  const base = path.basename(relativePath);
  if (!base) {
    return true;
  }
  if (base === ".DS_Store" || base === "Thumbs.db" || base === "desktop.ini") {
    return true;
  }
  return base.startsWith(".");
}

function isAcceptedImageMimeType(file) {
  const type = String(file.mimetype || "");
  return type.startsWith("image/") || type === "application/octet-stream" || type === "";
}

async function saveWorkbookUpload(file, sessionId) {
  if (!file) {
    throw new Error("Workbook file is required.");
  }
  if (file.size > MAX_EXCEL_BYTES) {
    throw new Error("Workbook exceeds size limit.");
  }

  const ext = path.extname(file.originalname || "").toLowerCase();
  const acceptedMimeTypes = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream"
  ];
  if (ext !== ".xlsx" || !acceptedMimeTypes.includes(file.mimetype)) {
    throw new Error("Only .xlsx workbooks are supported.");
  }

  const sessionDir = getSessionDir(sessionId);
  ensureDir(sessionDir);
  const workbookPath = path.join(sessionDir, "workbook.xlsx");
  await fs.promises.writeFile(workbookPath, file.buffer);
  return workbookPath;
}

async function saveImages(sessionId, imageFiles = [], options = {}) {
  const sessionDir = getSessionDir(sessionId);
  const imagesDir = path.join(sessionDir, "images");
  await deletePath(imagesDir);
  ensureDir(imagesDir);

  const stored = [];
  const usedStoredNames = new Set();
  let folderName = String(options.folderName || "");
  let ignoredFileCount = 0;
  let totalBytes = 0;

  for (const file of imageFiles) {
    const relativePath = getSafeRelativePath(file);
    const segments = relativePath.split("/").filter(Boolean);
    if (!folderName && segments.length > 1) {
      folderName = segments[0];
    }

    if (shouldIgnoreFolderFile(file)) {
      ignoredFileCount += 1;
      continue;
    }

    if (!isSupportedImageExtension(file.originalname) || !isAcceptedImageMimeType(file)) {
      ignoredFileCount += 1;
      continue;
    }

    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      throw new Error("Total image size exceeds limit.");
    }

    let storedName = sanitizeFilename(path.basename(file.originalname));
    const extension = path.extname(storedName);
    const base = storedName.slice(0, -extension.length);
    let suffix = 1;
    while (usedStoredNames.has(storedName)) {
      storedName = `${base}-${suffix}${extension}`;
      suffix += 1;
    }
    usedStoredNames.add(storedName);

    const filePath = path.join(imagesDir, storedName);
    await fs.promises.writeFile(filePath, file.buffer);
    stored.push({
      originalName: path.basename(file.originalname),
      relativePath,
      filePath
    });
  }

  if (stored.length > MAX_IMAGE_COUNT) {
    throw new Error("Too many images uploaded.");
  }

  return {
    images: stored,
    folderSummary: {
      folderName,
      validImageCount: stored.length,
      ignoredFileCount,
      totalImageBytes: totalBytes
    }
  };
}

module.exports = {
  ensureDir,
  deletePath,
  getSessionDir,
  saveWorkbookUpload,
  saveImages
};
