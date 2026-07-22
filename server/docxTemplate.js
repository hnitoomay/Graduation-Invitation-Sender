const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const { PROJECT_SAMPLE_FILES, STRATEGY_FIRST_LOGO_CID } = require("../shared/constants");
const { escapeHtml } = require("../shared/utils");

const FOOTER_LINES = [
  "Strategy First International College",
  "Undergraduate Programme",
  "Myaynigone Teaching Cetre(2)",
  "No. 237, Corner of Uwizara Road and Dhamazedi Road, San Chaung Township, Yangon",
  "Strategy First Education Group Limited.",
  "",
  "Contact us",
  "09-450177771, 09-442532546",
  "",
  "Yangon: +959 250 7171 66~68, info@mystrategyfirst.com",
  "Mandalay: +95 9 444 555 616~617, info.mdy@mystrategyfirst.com",
  "",
  "Facebook | LinkedIn | Twitter",
  "www.strategyfirst.edu.mm"
];

function extractTagText(xml, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "g");
  const matches = [];
  let match = regex.exec(xml);
  while (match) {
    matches.push(match[1]);
    match = regex.exec(xml);
  }
  return matches;
}

function xmlToText(xml) {
  return xml
    .replace(/<w:tab\/>/g, " ")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\u00A0/g, " ")
    .trim();
}

function escapeText(value) {
  return escapeHtml(String(value || "")).replace(/\n/g, "<br />");
}

function countParagraphMatches(paragraphs, pattern) {
  return paragraphs.filter((paragraph) => pattern.test(paragraph)).length;
}

function linkifyText(text) {
  const escaped = escapeHtml(text);
  return escaped
    .replace(
      /https:\/\/forms\.gle\/VMxw3iw73XxkWkPQ9/g,
      '<a href="https://forms.gle/VMxw3iw73XxkWkPQ9" style="color:#b21f2d;text-decoration:underline;">https://forms.gle/VMxw3iw73XxkWkPQ9</a>'
    )
    .replace(
      /https:\/\/t\.me\/\+KX0a6pnueCZkZTU9/g,
      '<a href="https://t.me/+KX0a6pnueCZkZTU9" style="color:#b21f2d;text-decoration:underline;">https://t.me/+KX0a6pnueCZkZTU9</a>'
    );
}

function buildBodyParagraphs(paragraphs) {
  const closingIndex = paragraphs.findIndex((paragraph) =>
    /^Yours sincerely,/i.test(paragraph)
  );
  return closingIndex >= 0 ? paragraphs.slice(0, closingIndex + 1) : paragraphs;
}

function renderBodyHtml(paragraphs, { studentName, sessionTime, arrivalTime, sessionLabel, logoSrc }) {
  const htmlParagraphs = [
    '<div style="margin:0 auto;max-width:700px;background:#ffffff;color:#000000;font-family:Arial, Helvetica, sans-serif;font-size:16px;line-height:1.5;">'
  ];

  paragraphs.forEach((paragraph) => {
    if (/^Dear /i.test(paragraph)) {
      htmlParagraphs.push(
        `<p style="margin:0 0 16px 0;">Dear ${escapeHtml(studentName)},</p>`
      );
      return;
    }
    if (/^Congratulations on Your Achievement!/i.test(paragraph)) {
      htmlParagraphs.push(
        '<p style="margin:0 0 16px 0;"><strong>Congratulations on Your Achievement!</strong></p>'
      );
      return;
    }
    if (/^Please find the ceremony details below:/i.test(paragraph)) {
      htmlParagraphs.push(
        `<p style="margin:0 0 16px 0;">${escapeText(paragraph)}</p>`,
        `<p style="margin:0 0 16px 0;"><strong>Venue:</strong> Novotel Yangon Max Hotel<br /><strong>Date:</strong> Sunday, 16 August 2026<br /><strong>Time:</strong> ${escapeHtml(sessionTime)}</p>`,
        `<p style="margin:0 0 16px 0;"><strong>Important:</strong> Graduates attending ${escapeHtml(sessionLabel)} are required to arrive at the venue by <strong>${escapeHtml(arrivalTime)}</strong> for registration.</p>`
      );
      return;
    }
    if (/^Venue:/i.test(paragraph) || /^Important:/i.test(paragraph)) {
      return;
    }
    if (/^Registration$/i.test(paragraph)) {
      htmlParagraphs.push(
        '<p style="margin:24px 0 12px 0;"><strong>Registration</strong></p>'
      );
      return;
    }
    if (/^Graduation Gown Collection$/i.test(paragraph)) {
      htmlParagraphs.push(
        '<p style="margin:24px 0 12px 0;"><strong>Graduation Gown Collection</strong></p>'
      );
      return;
    }
    if (/^Guest Information$/i.test(paragraph)) {
      htmlParagraphs.push(
        '<p style="margin:24px 0 12px 0;"><strong>Guest Information</strong></p>'
      );
      return;
    }
    if (/^Telegram Group$/i.test(paragraph)) {
      htmlParagraphs.push(
        '<p style="margin:24px 0 12px 0;"><strong>Telegram Group</strong></p>'
      );
      return;
    }
    if (/^Students who wish to attend the graduation ceremony/i.test(paragraph)) {
      htmlParagraphs.push(
        `<p style="margin:0 0 16px 0;">Students who wish to attend the graduation ceremony are kindly requested to complete their registration no later than <strong>24 July 2026</strong> via the link below:<br />${linkifyText("https://forms.gle/VMxw3iw73XxkWkPQ9")}</p>`
      );
      return;
    }
    if (/^All announcements and updates regarding the graduation ceremony/i.test(paragraph)) {
      htmlParagraphs.push(
        `<p style="margin:0 0 16px 0;">All announcements and updates regarding the graduation ceremony will be shared through the following Telegram group. Please make sure to join:<br />${linkifyText("https://t.me/+KX0a6pnueCZkZTU9")}</p>`
      );
      return;
    }
    if (/^Yours sincerely,/i.test(paragraph)) {
      htmlParagraphs.push(
        "<p style=\"margin:24px 0 16px 0;\">Yours sincerely,<br />Strategy First Graduation Committee</p>"
      );
      return;
    }
    htmlParagraphs.push(
      `<p style="margin:0 0 16px 0;">${linkifyText(paragraph)}</p>`
    );
  });

  htmlParagraphs.push(
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #d9d9d9;margin-top:24px;padding-top:20px;"><tr><td valign="top" width="120" style="padding:0 16px 0 0;"><img src="' +
      escapeHtml(logoSrc) +
      `" alt="Strategy First International College" width="105" style="display:block;border:0;outline:none;text-decoration:none;width:105px;max-width:105px;height:auto;" /></td><td valign="top" style="font-family:Arial, Helvetica, sans-serif;font-size:13px;line-height:1.5;color:#000000;">` +
      '<p style="margin:0 0 8px 0;color:#b21f2d;"><strong>Strategy First International College</strong><br />Undergraduate Programme</p>' +
      '<p style="margin:0 0 10px 0;">Myaynigone Teaching Cetre(2)<br />No. 237, Corner of Uwizara Road and Dhamazedi Road, San Chaung Township, Yangon<br />Strategy First Education Group Limited.</p>' +
      '<p style="margin:0 0 10px 0;"><strong>Contact us</strong><br />09-450177771, 09-442532546</p>' +
      '<p style="margin:0 0 10px 0;">Yangon: +959 250 7171 66~68, <a href="mailto:info@mystrategyfirst.com" style="color:#b21f2d;text-decoration:underline;">info@mystrategyfirst.com</a><br />Mandalay: +95 9 444 555 616~617, <a href="mailto:info.mdy@mystrategyfirst.com" style="color:#b21f2d;text-decoration:underline;">info.mdy@mystrategyfirst.com</a></p>' +
      '<p style="margin:0 0 10px 0;">Facebook | LinkedIn | Twitter</p>' +
      '<p style="margin:0;"><a href="https://www.strategyfirst.edu.mm/" style="color:#b21f2d;text-decoration:underline;">www.strategyfirst.edu.mm</a></p>' +
      "</td></tr></table></div>"
  );

  return htmlParagraphs.join("");
}

function renderBodyText({ studentName, sessionTime, arrivalTime, sessionLabel }) {
  return [
    `Dear ${studentName},`,
    "",
    "Congratulations on Your Achievement!",
    "",
    "Greetings from Strategy First International College.",
    "",
    "We are delighted to formally invite you to attend The Graduation Ceremony 2026, proudly organised by Strategy First International College.",
    "",
    "Please find the ceremony details below:",
    `Venue: Novotel Yangon Max Hotel`,
    `Date: Sunday, 16 August 2026`,
    `Time: ${sessionTime}`,
    "",
    `Important: Graduates attending ${sessionLabel} are required to arrive at the venue by ${arrivalTime} for registration.`,
    "",
    "Registration",
    "Students who wish to attend the graduation ceremony are kindly requested to complete their registration no later than 24 July 2026 via the link below:",
    "https://forms.gle/VMxw3iw73XxkWkPQ9",
    "",
    "Graduation Gown Collection",
    "Graduation gowns will be available for collection at Panchan Tower Campus from 1 August to 10 August 2026.",
    "",
    "Guest Information",
    "This year, The Graduation Ceremony 2026 will be free of charge for both graduates and guests.",
    "Each graduate will be entitled to invite up to two guests only.",
    "",
    "Telegram Group",
    "All announcements and updates regarding the graduation ceremony will be shared through the following Telegram group. Please make sure to join:",
    "https://t.me/+KX0a6pnueCZkZTU9",
    "",
    "We look forward to celebrating this remarkable milestone with you.",
    "",
    "Yours sincerely,",
    "Strategy First Graduation Committee",
    "",
    ...FOOTER_LINES
  ].join("\n");
}

async function loadDocxTemplate(rootDir) {
  const templatePath = path.join(rootDir, PROJECT_SAMPLE_FILES.docx);
  const buffer = await fs.promises.readFile(templatePath);
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml").async("string");

  const paragraphs = extractTagText(documentXml, "w:p")
    .map(xmlToText)
    .filter(Boolean);
  const bodyParagraphs = buildBodyParagraphs(paragraphs);

  if (countParagraphMatches(bodyParagraphs, /^Venue:/i) !== 1) {
    throw new Error("Expected exactly one Venue block in the email template.");
  }
  if (countParagraphMatches(bodyParagraphs, /^Important:/i) !== 1) {
    throw new Error("Expected exactly one Important block in the email template.");
  }

  return {
    sourcePath: templatePath,
    paragraphs,
    render({ studentName, sessionTime, arrivalTime, sessionLabel, logoSrc }) {
      return renderBodyHtml(bodyParagraphs, {
        studentName,
        sessionTime,
        arrivalTime,
        sessionLabel,
        logoSrc: logoSrc || `cid:${STRATEGY_FIRST_LOGO_CID}`
      });
    },
    renderText({ studentName, sessionTime, arrivalTime, sessionLabel }) {
      return renderBodyText({
        studentName,
        sessionTime,
        arrivalTime,
        sessionLabel
      });
    }
  };
}

module.exports = {
  FOOTER_LINES,
  loadDocxTemplate
};
