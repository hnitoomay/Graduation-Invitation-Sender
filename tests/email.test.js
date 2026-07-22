const { ROOT_DIR } = require("../server/config");
const { loadDocxTemplate } = require("../server/docxTemplate");
const { buildEmailModel } = require("../shared/email");

async function getTemplate() {
  return loadDocxTemplate(ROOT_DIR);
}

function countOccurrences(value, pattern) {
  return (value.match(pattern) || []).length;
}

describe("email model", () => {
  test("renders required strong headings and gmail-compatible html", async () => {
    const template = await getTemplate();
    const result = buildEmailModel(
      { studentName: "Student A", sessionKey: "A" },
      template
    );

    [
      "Congratulations on Your Achievement!",
      "Venue:",
      "Date:",
      "Time:",
      "Important:",
      "Registration",
      "Graduation Gown Collection",
      "Guest Information",
      "Telegram Group"
    ].forEach((label) => {
      expect(result.html).toContain(`<strong>${label}</strong>`);
    });

    expect(result.html).toContain("font-family:Arial, Helvetica, sans-serif");
    expect(result.html).toContain("max-width:700px");
    expect(result.html).toContain("line-height:1.5");
  });

  test("renders session A details without duplicated ceremony details", async () => {
    const template = await getTemplate();
    const result = buildEmailModel(
      { studentName: "Student A", sessionKey: "A" },
      template
    );

    expect(result.html).toContain("8:00 AM to 10:30 AM (Session A)");
    expect(result.html).toContain("<strong>7:30 AM</strong>");
    expect(countOccurrences(result.html, /<strong>Venue:<\/strong>/g)).toBe(1);
    expect(countOccurrences(result.html, /<strong>Date:<\/strong>/g)).toBe(1);
    expect(countOccurrences(result.html, /<strong>Time:<\/strong>/g)).toBe(1);
  });

  test("renders session B details", async () => {
    const template = await getTemplate();
    const result = buildEmailModel(
      { studentName: "Student B", sessionKey: "B" },
      template
    );

    expect(result.html).toContain("11:00 AM to 1:30 PM (Session B)");
    expect(result.html).toContain("<strong>10:30 AM</strong>");
  });

  test("html contains cid logo, clickable links, and escaped dynamic values", async () => {
    const template = await getTemplate();
    const result = buildEmailModel(
      { studentName: '<img src=x onerror="boom">', sessionKey: "A" },
      template
    );

    expect(result.html).toContain("cid:strategy-first-logo");
    expect(result.html).toContain('href="https://forms.gle/VMxw3iw73XxkWkPQ9"');
    expect(result.html).toContain('href="https://t.me/+KX0a6pnueCZkZTU9"');
    expect(result.html).toContain('href="mailto:info@mystrategyfirst.com"');
    expect(result.html).toContain("&lt;img src=x onerror=&quot;boom&quot;&gt;");
    expect(result.html).not.toContain('<img src=x onerror="boom">');
  });
});
