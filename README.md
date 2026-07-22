# Graduation Invitation Sender

Temporary single-page web application for parsing a graduation workbook, matching invitation images, previewing personalized emails, and sending one Gmail message per student without permanent storage.

## Stack

- React with Vite
- Express on Node.js
- Plain JavaScript
- Plain CSS
- In-memory session state only

## Session model

- Browser authentication uses an HTTP-only session cookie with no persistent expiration date.
- Server-side session data lives only in memory and expires automatically after two hours by default.
- Gmail OAuth tokens, parsed students, image matches, queue state, and send history are never written to a database.
- Temporary uploaded files are stored under `tmp/` only for the active session and are deleted on reset, expiration, and server shutdown when practical.

## Environment setup

Copy `.env.example` to `.env` and set:

```bash
PORT=3001
FRONTEND_URL=http://localhost:5173
SESSION_SECRET=replace-with-a-random-secret
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3001/api/auth/google/callback
DEMO_MODE=true
SESSION_TTL_MS=7200000
```

`DEMO_MODE=true` is the default development mode. In demo mode:

- workbook parsing works
- image matching works
- email previews work
- Gmail connect is simulated
- sends are simulated
- no real Gmail message is sent

## Google Cloud OAuth configuration

When you switch to live mode with `DEMO_MODE=false`, configure Google Cloud as follows:

1. Create or use a Google Cloud project.
2. Enable the Gmail API.
3. Configure the OAuth consent screen.
4. Create an OAuth 2.0 Client ID of type `Web application`.
5. Add this authorized redirect URI exactly:

```text
http://localhost:3001/api/auth/google/callback
```

6. Add this authorized JavaScript origin:

```text
http://localhost:3001
```

7. Put the client ID and client secret into `.env`.

The server requests only the minimum Gmail scope needed for sending:

```text
https://www.googleapis.com/auth/gmail.send
```

## Run

Install dependencies if needed:

```bash
npm install
```

Start both servers:

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

Production build:

```bash
npm run build
```

## Workflow

1. Upload the Excel workbook.
2. Upload invitation images or a ZIP.
3. Review matching and validation.
4. Connect Gmail.
5. Preview the generated email for any student.
6. Send a test email if needed.
7. Send a batch of up to 100 students.
8. Download the temporary CSV report if needed.
9. Reset the session to clear all temporary state.

## Tests

Run:

```bash
npm test
```
