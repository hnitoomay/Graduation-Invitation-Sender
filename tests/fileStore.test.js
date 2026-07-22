const { saveImages, deletePath, getSessionDir } = require("../server/fileStore");

describe("folder image upload handling", () => {
  test("ignores system files and returns folder stats", async () => {
    const sessionId = "folder-test";
    const result = await saveImages(sessionId, [
      {
        originalname: "2022B2177_Ou Ou Aung.jpg",
        webkitRelativePath: "Invitations/2022B2177_Ou Ou Aung.jpg",
        mimetype: "image/jpeg",
        size: 4,
        buffer: Buffer.from([1, 2, 3, 4])
      },
      {
        originalname: ".DS_Store",
        webkitRelativePath: "Invitations/.DS_Store",
        mimetype: "application/octet-stream",
        size: 2,
        buffer: Buffer.from([0, 1])
      },
      {
        originalname: "notes.txt",
        webkitRelativePath: "Invitations/notes.txt",
        mimetype: "text/plain",
        size: 5,
        buffer: Buffer.from("notes")
      }
    ]);

    expect(result.folderSummary.folderName).toBe("Invitations");
    expect(result.folderSummary.validImageCount).toBe(1);
    expect(result.folderSummary.ignoredFileCount).toBe(2);
    expect(result.folderSummary.totalImageBytes).toBe(4);
    expect(result.images[0].originalName).toBe("2022B2177_Ou Ou Aung.jpg");

    await deletePath(getSessionDir(sessionId));
  });
});
