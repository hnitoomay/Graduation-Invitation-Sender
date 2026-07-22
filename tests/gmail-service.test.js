const fs = require("fs");
const path = require("path");
const { ROOT_DIR } = require("../server/config");
const { loadDocxTemplate } = require("../server/docxTemplate");
const { getStrategyFirstLogoBuffer } = require("../server/strategyFirstLogo");
const {
  buildMimeMessageSource,
  createGmailService,
  getMissingScopes
} = require("../server/gmailService");

describe("gmail service", () => {
  test("renders session A email details", async () => {
    const template = await loadDocxTemplate(ROOT_DIR);
    const html = template.render({
      studentName: "Student A",
      sessionTime: "8:00 AM to 10:30 AM (Session A)",
      arrivalTime: "7:30 AM",
      sessionLabel: "Session A",
      logoSrc: "cid:strategy-first-logo"
    });

    expect(html).toContain("8:00 AM to 10:30 AM (Session A)");
    expect(html).toContain("<strong>7:30 AM</strong>");
  });

  test("renders session B email details", async () => {
    const template = await loadDocxTemplate(ROOT_DIR);
    const html = template.render({
      studentName: "Student B",
      sessionTime: "11:00 AM to 1:30 PM (Session B)",
      arrivalTime: "10:30 AM",
      sessionLabel: "Session B",
      logoSrc: "cid:strategy-first-logo"
    });

    expect(html).toContain("11:00 AM to 1:30 PM (Session B)");
    expect(html).toContain("<strong>10:30 AM</strong>");
  });

  test("mime message includes CID logo and invitation attachment", async () => {
    const mime = buildMimeMessageSource({
      from: "sender@example.com",
      to: "student@example.com",
      subject: "Subject",
      text: "Text",
      html: '<img src="cid:strategy-first-logo" alt="Strategy First International College" />',
      logoBuffer: getStrategyFirstLogoBuffer(),
      attachmentBuffer: await fs.promises.readFile(
        path.join(ROOT_DIR, "2022B2177_Ou Ou Aung.jpg")
      ),
      attachmentName: "Student A - Graduation Invitation.jpg",
      attachmentMimeType: "image/jpeg"
    });

    expect(mime).toContain('src="cid:strategy-first-logo"');
    expect(mime).toContain("Content-ID: <strategy-first-logo>");
    expect(mime).toContain('Content-Disposition: inline; filename="Picture1.png"');
    expect(mime).toContain(
      'Content-Disposition: attachment; filename="Student A - Graduation Invitation.jpg"'
    );
  });

  test("does not read Picture1.png from the filesystem when generating the gmail message", async () => {
    const originalReadFile = fs.promises.readFile.bind(fs.promises);
    const originalReadFileSync = fs.readFileSync.bind(fs);
    const pictureReadSpy = vi
      .spyOn(fs.promises, "readFile")
      .mockImplementation(async (filePath, ...args) => {
        if (String(filePath).includes("Picture1.png")) {
          throw new Error("Picture1.png should not be read from disk.");
        }
        return originalReadFile(filePath, ...args);
      });
    const readFileSyncSpy = vi
      .spyOn(fs, "readFileSync")
      .mockImplementation((filePath, ...args) => {
        if (String(filePath).includes("Picture1.png")) {
          throw new Error("Picture1.png should not be read from disk.");
        }
        return originalReadFileSync(filePath, ...args);
      });
    const sendSpy = vi.fn().mockResolvedValue({
      data: { id: "gmail-message-embedded-logo" }
    });
    const gmailService = createGmailService(
      {
        ROOT_DIR,
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
        TOKEN_ENCRYPTION_KEY:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        ALLOWED_GMAIL_SENDER: "student_registry@mystrategyfirst.com"
      },
      {
        templateLoader: async () => loadDocxTemplate(ROOT_DIR),
        gmailFactory() {
          return {
            users: {
              messages: {
                send: sendSpy
              }
            }
          };
        }
      }
    );

    const originalNodeEnv = process.env.NODE_ENV;
    delete process.env.VITEST;
    process.env.NODE_ENV = "development";

    try {
      await gmailService.sendInvitation(
        {
          studentName: "Ou Ou Aung",
          recipientEmail: "student@example.com",
          sficId: "2022B2177",
          sessionKey: "A",
          imageFile: {
            originalname: "2022B2177_Ou Ou Aung.jpg",
            mimetype: "image/jpeg",
            size: 1024,
            buffer: Buffer.from("image")
          }
        },
        {
          tokens: {
            refresh_token: "refresh-token"
          },
          verifiedEmail: "student_registry@mystrategyfirst.com",
          grantedScopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"]
        }
      );

      const raw = sendSpy.mock.calls[0][0].requestBody.raw;
      const mime = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
        "utf8"
      );

      expect(mime).toContain('src="cid:strategy-first-logo"');
      expect(mime).toContain("Content-ID: <strategy-first-logo>");
      expect(mime).toContain('Content-Type: image/png; name="Picture1.png"');
      expect(mime).toContain('Content-Disposition: inline; filename="Picture1.png"');
      expect(
        pictureReadSpy.mock.calls.some(([filePath]) => String(filePath).includes("Picture1.png"))
      ).toBe(false);
      expect(
        readFileSyncSpy.mock.calls.some(([filePath]) => String(filePath).includes("Picture1.png"))
      ).toBe(false);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      process.env.VITEST = "true";
      pictureReadSpy.mockRestore();
      readFileSyncSpy.mockRestore();
    }
  });

  test("reports missing gmail.send scope", () => {
    expect(getMissingScopes(["openid", "email"])).toEqual([
      "https://www.googleapis.com/auth/gmail.send"
    ]);
  });

  test("requests exactly gmail.send plus OpenID scopes in the auth URL", async () => {
    const gmailService = createGmailService(
      {
        ROOT_DIR,
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
        TOKEN_ENCRYPTION_KEY:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        ALLOWED_GMAIL_SENDER: "student_registry@mystrategyfirst.com"
      },
      {
        templateLoader: async () => loadDocxTemplate(ROOT_DIR),
        logoBuffer: Buffer.from("logo")
      }
    );

    const url = new URL(
      gmailService.buildAuthUrl("http://localhost:3001/api/auth/google/callback", "state-123")
    );

    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("scope")).toContain("openid");
    expect(url.searchParams.get("scope")).toContain("email");
    expect(url.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/gmail.send");
  });

  test("uses verified OpenID email from the id token during oauth exchange", async () => {
    const { exchangeCodeForTokens } = require("../server/gmailService");
    const { google } = require("googleapis");
    const { OAuth2Client } = require("google-auth-library");

    const getTokenSpy = vi
      .spyOn(google.auth.OAuth2.prototype, "getToken")
      .mockResolvedValue({
        tokens: {
          access_token: "access-token",
          refresh_token: "refresh-token",
          id_token: "id-token",
          scope: undefined
        }
      });
    const tokenInfoSpy = vi
      .spyOn(google.auth.OAuth2.prototype, "getTokenInfo")
      .mockResolvedValue({
        scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"]
      });
    const verifySpy = vi
      .spyOn(OAuth2Client.prototype, "verifyIdToken")
      .mockResolvedValue({
        getPayload() {
          return {
            email: "Student_Registry@mystrategyfirst.com",
            email_verified: true
          };
        }
      });

    try {
      const result = await exchangeCodeForTokens(
        {
          GOOGLE_CLIENT_ID: "client-id",
          GOOGLE_CLIENT_SECRET: "client-secret"
        },
        "code-123",
        "http://localhost:3001/api/auth/google/callback"
      );

      expect(result.emailAddress).toBe("student_registry@mystrategyfirst.com");
      expect(result.grantedScopes).toEqual([
        "openid",
        "email",
        "https://www.googleapis.com/auth/gmail.send"
      ]);
    } finally {
      getTokenSpy.mockRestore();
      tokenInfoSpy.mockRestore();
      verifySpy.mockRestore();
    }
  });

  test("never calls users.getProfile and uses messages.send for sending", async () => {
    const getProfileSpy = vi.fn();
    const sendSpy = vi.fn().mockResolvedValue({
      data: { id: "gmail-message-123" }
    });
    const gmailService = createGmailService(
      {
        ROOT_DIR,
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
        TOKEN_ENCRYPTION_KEY:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        ALLOWED_GMAIL_SENDER: "student_registry@mystrategyfirst.com"
      },
      {
        templateLoader: async () => loadDocxTemplate(ROOT_DIR),
        logoBuffer: Buffer.from("logo"),
        gmailFactory() {
          return {
            users: {
              getProfile: getProfileSpy,
              messages: {
                send: sendSpy
              }
            }
          };
        }
      }
    );

    const originalNodeEnv = process.env.NODE_ENV;
    delete process.env.VITEST;
    process.env.NODE_ENV = "development";

    try {
      const result = await gmailService.sendInvitation(
        {
          studentName: "Ou Ou Aung",
          recipientEmail: "student@example.com",
          sficId: "2022B2177",
          sessionKey: "A",
          imageFile: {
            originalname: "2022B2177_Ou Ou Aung.jpg",
            mimetype: "image/jpeg",
            size: 1024,
            buffer: Buffer.from("image")
          }
        },
        {
          tokens: {
            refresh_token: "refresh-token"
          },
          verifiedEmail: "student_registry@mystrategyfirst.com",
          grantedScopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"]
        }
      );

      expect(result.messageId).toBe("gmail-message-123");
      expect(getProfileSpy).not.toHaveBeenCalled();
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy.mock.calls[0][0]).toEqual({
        userId: "me",
        requestBody: {
          raw: expect.any(String)
        }
      });
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      process.env.VITEST = "true";
    }
  });

  test("automated tests never send real gmail messages", async () => {
    const gmailService = createGmailService(
      {
        ROOT_DIR,
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
        TOKEN_ENCRYPTION_KEY:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        ALLOWED_GMAIL_SENDER: "student_registry@mystrategyfirst.com"
      },
      {
        templateLoader: async () => loadDocxTemplate(ROOT_DIR),
        logoBuffer: Buffer.from("logo")
      }
    );

    const result = await gmailService.sendInvitation(
      {
        studentName: "Ou Ou Aung",
        recipientEmail: "student@example.com",
        sficId: "2022B2177",
        sessionKey: "A",
        imageFile: {
          originalname: "2022B2177_Ou Ou Aung.jpg",
          mimetype: "image/jpeg",
          size: 1024,
          buffer: Buffer.from("image")
        }
      },
      {
        refresh_token: "refresh-token"
      }
    );

    expect(result.messageId).toMatch(/^demo-2022B2177-/);
  });
});
