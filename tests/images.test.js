const { parseImageFilename } = require("../shared/images");
const { matchStudentsWithImages } = require("../shared/matching");

describe("image parsing and matching", () => {
  test("parses supplied sample filename 1", () => {
    const parsed = parseImageFilename("2022B2177_Ou Ou Aung.jpg");
    expect(parsed.valid).toBe(true);
    expect(parsed.sficId).toBe("2022B2177");
    expect(parsed.studentName).toBe("Ou Ou Aung");
  });

  test("parses supplied sample filename 2", () => {
    const parsed = parseImageFilename("2022B4575_Yamin Myat.jpg");
    expect(parsed.valid).toBe(true);
    expect(parsed.sficId).toBe("2022B4575");
    expect(parsed.studentName).toBe("Yamin Myat");
  });

  test("detects name mismatch", () => {
    const result = matchStudentsWithImages(
      [
        {
          id: "A::2022B2177",
          studentName: "Ou Ou Aung",
          sficId: "2022B2177",
          email: "student@example.com",
          workbookSheet: "Wolver BA"
        }
      ],
      [{ originalName: "2022B2177_Wrong Name.jpg", filePath: "/tmp/image.jpg" }]
    );
    expect(result.students[0].imageMatch.matchStatus).toBe("name_mismatch");
  });

  test("detects duplicate image", () => {
    const result = matchStudentsWithImages(
      [
        {
          id: "A::2022B2177",
          studentName: "Ou Ou Aung",
          sficId: "2022B2177",
          email: "student@example.com",
          workbookSheet: "Wolver BA"
        }
      ],
      [
        { originalName: "2022B2177_Ou Ou Aung.jpg", filePath: "/tmp/1.jpg" },
        { originalName: "2022B2177_Ou Ou Aung.png", filePath: "/tmp/2.png" }
      ]
    );
    expect(result.students[0].imageMatch.matchStatus).toBe("duplicate_image");
  });

  test("matches by exact sfic id", () => {
    const result = matchStudentsWithImages(
      [
        {
          id: "A::2022B2177",
          studentName: "Ou Ou Aung",
          sficId: "2022B2177",
          email: "student@example.com",
          workbookSheet: "Wolver BA"
        }
      ],
      [{ originalName: "2022B2178_Ou Ou Aung.jpg", filePath: "/tmp/image.jpg" }]
    );
    expect(result.students[0].imageMatch).toBe(null);
    expect(result.issues[0].type).toBe("unknown_sfic_id");
  });
});
