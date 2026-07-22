const fs = require("fs");
const path = require("path");

describe("vercel configuration", () => {
  test("routes api requests before the spa fallback", async () => {
    const vercelJson = JSON.parse(
      await fs.promises.readFile(path.join(__dirname, "..", "vercel.json"), "utf8")
    );

    expect(vercelJson.routes).toEqual([
      {
        src: "^/api(?:/(.*))?$",
        dest: "/api/index.js"
      },
      {
        handle: "filesystem"
      },
      {
        src: "^/(.*)$",
        dest: "/index.html"
      }
    ]);
  });
});
