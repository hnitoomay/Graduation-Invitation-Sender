# Graduation Invitation Sender

React/Vite frontend plus Express backend for parsing the graduation workbook in the browser, matching invitation images locally, and sending one Gmail message per student through Google OAuth.

## Current Architecture

- React + Vite frontend
- Express backend
- Google OAuth scopes:
  - `openid`
  - `email`
  - `https://www.googleapis.com/auth/gmail.send`
- Gmail OAuth token bundle stored only in an encrypted HttpOnly cookie
- Excel data, image files, matches, send progress, and CSV report kept only in browser memory
- One student and one invitation image per `/api/send-one` request
- No database
- No Vercel Blob, KV, Redis, or persistent filesystem storage
- No local token files

Refreshing the page clears:

- parsed workbook data
- selected images
- matches
- send progress
- temporary report data

Refreshing or reopening the browser keeps Gmail connected as long as the encrypted cookie remains.

## Environment Variables

Copy `.env.example` to `.env` locally and set:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
TOKEN_ENCRYPTION_KEY=
ALLOWED_GMAIL_SENDER=
APP_URL=
```

Notes:

- `APP_URL` is the backend application URL.
- Local development typically uses `APP_URL=http://localhost:3001`.
- Production should use your deployed Vercel URL, for example `https://your-project.vercel.app`.
- `TOKEN_ENCRYPTION_KEY` must decode to exactly 32 bytes. A 64-character hex value works well.
- Never commit `.env`.

Generate a suitable encryption key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Google Cloud OAuth Setup

1. Enable the Gmail API in your Google Cloud project.
2. Configure the OAuth consent screen.
3. Create an OAuth client for a web application.
4. Add the local redirect URI:

```text
http://localhost:3001/api/auth/google/callback
```

5. Add the production redirect URI:

```text
https://your-project.vercel.app/api/auth/google/callback
```

6. Set `ALLOWED_GMAIL_SENDER` to the exact Gmail or Google Workspace sender address that is allowed to connect.

If the connected Google account email does not exactly match `ALLOWED_GMAIL_SENDER`, the backend rejects the connection and discards the returned tokens.

## Local Development

Install dependencies:

```bash
npm install
```

Run the backend and frontend:

```bash
npm run dev
```

Frontend:

```text
http://localhost:5173
```

Backend:

```text
http://localhost:3001
```

## Vercel Deployment

This repository is deployable as one Vercel project.

### GitHub setup

1. Initialize Git if needed.
2. Confirm `.env` is ignored.
3. Commit the project.
4. Push it to GitHub.

### Vercel import

1. In Vercel, choose `Add New -> Project`.
2. Import the GitHub repository.
3. Add these environment variables in `Project -> Settings -> Environment Variables`:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `TOKEN_ENCRYPTION_KEY`
   - `ALLOWED_GMAIL_SENDER`
   - `APP_URL`
4. Set `APP_URL` to the deployed production URL.
5. Deploy.

The repository already includes:

- `server/app.js` for Express app creation
- `server/index.js` for local `app.listen()`
- `api/index.js` and `api/[...path].js` exporting the Express app for Vercel Functions
- `vercel.json` routing `/api` and `/api/:path*` before the SPA fallback

### Final Vercel routing

- `api/index.js` handles `/api`
- `api/[...path].js` handles `/api/*`
- `vercel.json` keeps API routing ahead of the frontend fallback
- all non-API routes rewrite to `dist/index.html`
- the frontend calls same-origin API paths such as `/api/auth/status` and `/api/auth/google`

### Production checks

After deployment, verify:

```text
https://your-project.vercel.app/api/health
https://your-project.vercel.app/api/auth/status
```

Both endpoints should return JSON, not an HTML 404 page.

## Gmail Connection Behavior

- The UI shows `Connect Gmail` when there is no valid encrypted Gmail cookie.
- After successful OAuth, the backend stores the token bundle in an encrypted HttpOnly cookie.
- The cookie uses:
  - `httpOnly: true`
  - `sameSite: "lax"`
  - `secure: true` in production
  - long expiration
- `Disconnect` clears the cookie.
- Clearing browser cookies may require reconnecting, which is expected.

## Security Model

- Gmail OAuth tokens are never exposed to React code.
- Tokens are never stored in local files, a database, localStorage, or Blob storage.
- Dynamic email values are sanitized.
- Send requests require a connected Gmail cookie.
- Email-sending POST requests require same-origin validation.
- Tests do not send real Gmail messages.

## Production Build

```bash
npm run build
```

## Test

```bash
npm test
```
