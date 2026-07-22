const fs = require("fs");
const path = require("path");

describe("vercel configuration", () => {
  test("routes api requests before the spa fallback", async () => {
    const vercelJson = JSON.parse(
      await fs.promises.readFile(path.join(__dirname, "..", "vercel.json"), "utf8")
    );

    expect(vercelJson.rewrites).toEqual([
      {
        source: "/api",
        destination: "/api"
      },
      {
        source: "/api/:path*",
        destination: "/api/:path*"
      },
      {
        source: "/((?!api(?:/|$)).*)",
        destination: "/index.html"
      }
    ]);
  });
});
