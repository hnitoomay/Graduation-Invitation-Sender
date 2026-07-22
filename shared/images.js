const path = require("path");
const {
  SUPPORTED_IMAGE_EXTENSIONS
} = require("./constants");
const { collapseWhitespace, normalizeName } = require("./utils");

function isSupportedImageExtension(filename) {
  return SUPPORTED_IMAGE_EXTENSIONS.includes(
    path.extname(filename || "").toLocaleLowerCase()
  );
}

function parseImageFilename(filename) {
  const base = path.basename(filename || "");
  const extension = path.extname(base).toLocaleLowerCase();
  if (!SUPPORTED_IMAGE_EXTENSIONS.includes(extension)) {
    return { valid: false, error: "Unsupported file type." };
  }

  const stem = base.slice(0, -extension.length);
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

module.exports = {
  isSupportedImageExtension,
  parseImageFilename
};
