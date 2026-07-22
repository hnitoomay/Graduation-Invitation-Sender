const {
  buildAuthUrl,
  extractVerifiedEmailFromIdToken,
  OAUTH_SCOPES,
  GMAIL_SEND_SCOPE,
  getMissingScopes
} = require("../server/googleAuth");

describe("google auth helpers", () => {
  test("requests minimum scopes for identity and gmail send", () => {
    expect(OAUTH_SCOPES).toEqual([
      "openid",
      "email",
      "https://www.googleapis.com/auth/gmail.send"
    ]);
  });

  test("authorization URL requests openid, email, gmail.send, consent, and granted scopes reuse", () => {
    const sessionState = {
      sessionId: "session-1",
      gmail: { state: "" }
    };
    let capturedOptions = null;
    const oauth = {
      generateAuthUrl(options) {
        capturedOptions = options;
        return "https://accounts.google.com/o/oauth2/v2/auth";
      }
    };

    buildAuthUrl(sessionState, oauth);

    expect(capturedOptions.scope).toContain("openid");
    expect(capturedOptions.scope).toContain("email");
    expect(capturedOptions.scope).toContain(GMAIL_SEND_SCOPE);
    expect(capturedOptions.prompt).toBe("consent select_account");
    expect(capturedOptions.include_granted_scopes).toBe(true);
  });

  test("extracts verified email from id token payload", async () => {
    const verifier = {
      async verifyIdToken() {
        return {
          getPayload() {
            return {
              email: "actual-sender@gmail.com",
              email_verified: true
            };
          }
        };
      }
    };

    const result = await extractVerifiedEmailFromIdToken("fake-id-token", verifier);
    expect(result.emailAddress).toBe("actual-sender@gmail.com");
    expect(result.emailVerified).toBe(true);
  });

  test("rejects unverified id token email", async () => {
    const verifier = {
      async verifyIdToken() {
        return {
          getPayload() {
            return {
              email: "actual-sender@gmail.com",
              email_verified: false
            };
          }
        };
      }
    };

    await expect(
      extractVerifiedEmailFromIdToken("fake-id-token", verifier)
    ).rejects.toThrow(/not verified/);
  });

  test("reports gmail.send missing from granted scopes", () => {
    expect(getMissingScopes(["openid", "email"])).toEqual([GMAIL_SEND_SCOPE]);
  });
});
