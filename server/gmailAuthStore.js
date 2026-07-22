const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const FILE_HEADER = Buffer.from("GMAILAUTH1");
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function parseEncryptionKey(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be set to a 32-byte key.");
  }

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  const base64Key = Buffer.from(raw, "base64");
  if (base64Key.length === 32) {
    return base64Key;
  }

  throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.");
}

function hashOAuthClient(clientId, clientSecret) {
  return crypto
    .createHash("sha256")
    .update(String(clientId || ""))
    .update("\0")
    .update(String(clientSecret || ""))
    .digest("hex");
}

function createEncryptedAuthStore({
  filePath,
  encryptionKey,
  fsModule = fs
}) {
  function getKey() {
    return parseEncryptionKey(encryptionKey);
  }

  function encrypt(payload) {
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([FILE_HEADER, iv, tag, ciphertext]);
  }

  function decrypt(fileBuffer) {
    const key = getKey();
    if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length <= FILE_HEADER.length + IV_LENGTH + TAG_LENGTH) {
      throw new Error("Saved Gmail authorization file is invalid.");
    }
    const header = fileBuffer.subarray(0, FILE_HEADER.length);
    if (!header.equals(FILE_HEADER)) {
      throw new Error("Saved Gmail authorization file header is invalid.");
    }

    const ivStart = FILE_HEADER.length;
    const tagStart = ivStart + IV_LENGTH;
    const dataStart = tagStart + TAG_LENGTH;
    const iv = fileBuffer.subarray(ivStart, tagStart);
    const tag = fileBuffer.subarray(tagStart, dataStart);
    const ciphertext = fileBuffer.subarray(dataStart);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
  }

  async function writeAtomic(buffer) {
    const dir = path.dirname(filePath);
    await fsModule.promises.mkdir(dir, { recursive: true });
    const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fsModule.promises.writeFile(tempFile, buffer, { mode: 0o600 });
    try {
      await fsModule.promises.chmod(tempFile, 0o600);
    } catch {
      // Ignore permission adjustments on platforms that do not support them.
    }
    await fsModule.promises.rename(tempFile, filePath);
    try {
      await fsModule.promises.chmod(filePath, 0o600);
    } catch {
      // Ignore permission adjustments on platforms that do not support them.
    }
  }

  async function save(payload) {
    await writeAtomic(encrypt(payload));
  }

  async function load() {
    try {
      const fileBuffer = await fsModule.promises.readFile(filePath);
      return decrypt(fileBuffer);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async function remove() {
    await fsModule.promises.rm(filePath, { force: true });
  }

  function exists() {
    return fsModule.existsSync(filePath);
  }

  return {
    encrypt,
    decrypt,
    save,
    load,
    remove,
    exists,
    getKey
  };
}

module.exports = {
  createEncryptedAuthStore,
  parseEncryptionKey,
  hashOAuthClient
};
