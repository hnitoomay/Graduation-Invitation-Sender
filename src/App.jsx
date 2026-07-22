import { useEffect, useMemo, useState } from "react";
import { apiFetch, apiJson } from "./api";

function SummaryCard({ label, value }) {
  return (
    <div className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusPill({ value }) {
  return <span className={`status-pill status-${value.toLowerCase()}`}>{value}</span>;
}

function formatBytes(bytes) {
  if (!bytes) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isSingleValidEmail(email) {
  const raw = String(email || "").trim();
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(raw);
}

function isReadyAndUnsent(student, queue) {
  return (
    student.status === "Ready" &&
    isSingleValidEmail(student.email) &&
    student.imageMatch?.matchStatus === "ready" &&
    student.sendState !== "sent" &&
    student.sendState !== "failed" &&
    queue.currentStudentId !== student.id &&
    !queue.pendingIds?.includes(student.id)
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sessionFilter, setSessionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [excelFileName, setExcelFileName] = useState("");

  async function fetchAuthStatus() {
    const data = await apiJson("/api/auth/status");
    setSession((current) =>
      current
        ? {
            ...current,
            gmail: data
          }
        : null
    );
    return data;
  }

  async function fetchSession({ initial = false } = {}) {
    if (initial) {
      setLoading(true);
    }
    const response = await apiFetch("/api/session");
    if (!response.ok) {
      throw new Error(`Session request failed with ${response.status}`);
    }
    const data = await response.json();
    setSession(data);
    if (initial) {
      setLoading(false);
    }
  }

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const gmailResult = searchParams.get("gmail");

    Promise.allSettled([fetchSession({ initial: true }), fetchAuthStatus()]).then((results) => {
      const rejected = results.find((result) => result.status === "rejected");
      if (rejected) {
        setError(rejected.reason.message);
        setLoading(false);
      }
      if (gmailResult) {
        window.history.replaceState({}, "", window.location.pathname);
      }
    });
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      fetchSession().catch(() => {});
    }, 2000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!session?.workbookLoaded) {
      setExcelFileName("");
    }
  }, [session?.workbookLoaded]);

  async function postForm(url, formData) {
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch(url, { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error);
      }
      setSession(data);
      return data;
    } catch (requestError) {
      setError(requestError.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function postJson(url, body) {
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {})
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error);
      }
      setSession(data);
      return data;
    } catch (requestError) {
      setError(requestError.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  const filteredStudents = useMemo(() => {
    if (!session) {
      return [];
    }
    return session.students.filter((student) => {
      const term = search.toLowerCase();
      const matchesSearch =
        !term ||
        student.studentName.toLowerCase().includes(term) ||
        student.sficId.toLowerCase().includes(term) ||
        student.email.toLowerCase().includes(term);
      const matchesSession =
        sessionFilter === "all" || student.sessionKey === sessionFilter;
      const matchesStatus =
        statusFilter === "all" || student.status.toLowerCase() === statusFilter;
      return matchesSearch && matchesSession && matchesStatus;
    });
  }, [session, search, sessionFilter, statusFilter]);

  const isGmailConnected = Boolean(session?.gmail.connected);
  const canSend = Boolean(session?.gmail.connected && session?.gmail.canSend) && !session?.demoMode;
  const uploadsDisabled = !isGmailConnected || busy;
  const isSending = busy || Boolean(session?.queue.currentStudentId);
  const currentStudentName =
    session?.students.find((student) => student.id === session.queue.currentStudentId)?.studentName || "-";
  const gmailPermissionMessage =
    session?.gmail.connected && !session?.gmail.canSend
      ? (session?.gmail.error ||
        "Google connected, but Gmail sending permission was not granted. Disconnect and reconnect, then approve the Gmail sending permission.")
      : "";

  const readyUnsentStudents = session
    ? session.students.filter((student) => isReadyAndUnsent(student, session.queue))
    : [];
  const readyUnsentCount = readyUnsentStudents.length;
  const readySessionACount = readyUnsentStudents.filter((student) => student.sessionKey === "A").length;
  const readySessionBCount = readyUnsentStudents.filter((student) => student.sessionKey === "B").length;
  const blockedCount = session
    ? session.students.filter(
      (student) => student.sendState !== "sent" && !isReadyAndUnsent(student, session.queue)
    ).length
    : 0;
  const totalReadyStates = session
    ? session.students.filter(
      (student) => student.status === "Ready" || session.queue.currentStudentId === student.id
    ).length
    : 0;
  const allReadyInvitationsSent = totalReadyStates === 0 && session?.summary.sentDuringSession > 0;
  const sendButtonLabel =
    readyUnsentCount > 0
      ? `Send All ${readyUnsentCount} Ready Emails`
      : "No Ready Emails to Send";

  if (loading) {
    return <div className="page-shell">Loading session...</div>;
  }

  return (
    <div className="page-shell compact-shell">
      <header className="page-header compact-header">
        <div>
          <p className="eyebrow">Internal Tool</p>
          <h1>Graduation Invitation Sender</h1>
          <p className="subtle">
            Uploads, matches, and send progress are temporary. Gmail remains connected until you disconnect it.
          </p>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="panel compact-panel">
        <div className="gmail-row">
          <div>
            <strong>Gmail sender:</strong>{" "}
            {session.gmail.connected ? session.gmail.address : "Not connected"}
          </div>
          {session.demoMode ? (
            <span className="demo-note">Demo mode - Gmail sending is disabled</span>
          ) : session.gmail.connected ? (
            <div className="gmail-actions">
              <span className="connected-label">Connected</span>
              <button onClick={() => postJson("/api/auth/google/disconnect")} disabled={busy}>
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={async () => {
                const data = await apiJson("/api/auth/google");
                window.location.href = data.url;
              }}
              disabled={busy}
            >
              Connect Gmail
            </button>
          )}
        </div>
        {gmailPermissionMessage ? (
          <div className="error-banner">{gmailPermissionMessage}</div>
        ) : null}
      </section>

      <section className="panel compact-panel">
        <div className="upload-stack">
          {!isGmailConnected ? (
            <div className="warning-banner">
              Connect your Gmail sender account before uploading student files.
            </div>
          ) : null}
          <label className="upload-row">
            <span>Student Excel File</span>
            <input
              type="file"
              accept=".xlsx"
              disabled={uploadsDisabled}
              onChange={(event) => {
                const file = event.target.files[0];
                if (!file || !isGmailConnected) {
                  return;
                }
                setExcelFileName(file.name);
                const formData = new FormData();
                formData.append("workbook", file);
                postForm("/api/upload/workbook", formData);
              }}
            />
          </label>
          <label className="upload-row">
            <span>Invitation Images Folder</span>
            <input
              type="file"
              multiple
              webkitdirectory=""
              directory=""
              disabled={uploadsDisabled}
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                if (!files.length || !isGmailConnected) {
                  return;
                }
                const formData = new FormData();
                const firstPath = files[0].webkitRelativePath || files[0].name;
                const folderName = firstPath.includes("/") ? firstPath.split("/")[0] : "";
                formData.append("imageFolderName", folderName);
                files.forEach((file) => {
                  formData.append("imageFolderFiles", file, file.name);
                  formData.append("imageFolderRelativePaths", file.webkitRelativePath || file.name);
                });
                postForm("/api/upload/images", formData);
              }}
            />
          </label>
          <div className="upload-meta">
            <div>
              <strong>Excel file:</strong> {(excelFileName || session.workbookLoaded) ? (excelFileName || "Uploaded") : "Not uploaded"}
            </div>
            <div>
              <strong>Folder:</strong> {session.folderUpload.folderName || "Not selected"}
            </div>
            <div>
              <strong>Valid images:</strong> {session.folderUpload.validImageCount}
            </div>
            <div>
              <strong>Ignored files:</strong> {session.folderUpload.ignoredFileCount}
            </div>
            <div>
              <strong>Total image size:</strong> {formatBytes(session.folderUpload.totalImageBytes)}
            </div>
          </div>
        </div>
      </section>

      <section className="summary-grid compact-summary">
        <SummaryCard label="Total students" value={session.summary.totalStudents} />
        <SummaryCard label="Session A" value={session.summary.sessionAStudents} />
        <SummaryCard label="Session B" value={session.summary.sessionBStudents} />
        <SummaryCard label="Valid images" value={session.folderUpload.validImageCount} />
        <SummaryCard label="Matched" value={session.summary.successfullyMatched} />
        <SummaryCard label="Missing" value={session.summary.missingImages} />
        <SummaryCard label="Errors" value={session.summary.errors} />
        <SummaryCard label="Sent" value={session.summary.sentDuringSession} />
        <SummaryCard label="Failed" value={session.summary.failedDuringSession} />
      </section>

      <section className="panel compact-panel student-review-card">
        <div className="panel-header">
          <h2>Student Review</h2>
        </div>
        <div className="filters compact-filters">
          <input
            placeholder="Search by name, SFIC ID, or email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)}>
            <option value="all">All sessions</option>
            <option value="A">Session A</option>
            <option value="B">Session B</option>
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="ready">Ready</option>
            <option value="missing">Missing</option>
            <option value="error">Error</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="sending">Sending</option>
          </select>
        </div>
        <div className="student-table-scroll table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student name</th>
                <th>SFIC ID</th>
                <th>Email</th>
                <th>Workbook sheet</th>
                <th>Session</th>
                <th>Matched image</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredStudents.map((student) => (
                <tr key={student.id}>
                  <td>{student.studentName}</td>
                  <td>{student.sficId}</td>
                  <td>
                    <input
                      value={student.email}
                      onChange={(event) => {
                        const email = event.target.value;
                        setSession((current) => ({
                          ...current,
                          students: current.students.map((item) =>
                            item.id === student.id ? { ...item, email } : item
                          )
                        }));
                      }}
                      onBlur={(event) =>
                        postJson(`/api/students/${encodeURIComponent(student.id)}/email`, {
                          email: event.target.value
                        })
                      }
                    />
                  </td>
                  <td>{student.workbookSheet}</td>
                  <td>{student.sessionLabel}</td>
                  <td>{student.imageMatch?.originalName || "-"}</td>
                  <td><StatusPill value={student.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel compact-panel sending-panel">
        <div className="panel-header">
          <h2>Sending Controls</h2>
        </div>
        <div className="sending-layout">
          <div className="stack">
            <div className="batch-box">
              <p>Ready to send: {readyUnsentCount}</p>
              <p>Session A: {readySessionACount}</p>
              <p>Session B: {readySessionBCount}</p>
              <p>Blocked: {blockedCount}</p>
            </div>
            <button
              className="primary-send-button"
              disabled={!canSend || readyUnsentCount === 0 || isSending}
              onClick={async () => {
                const blockedMessage = blockedCount > 0
                  ? `\n\nOnly Ready students will be sent. ${blockedCount} blocked students will not receive an email.`
                  : "";
                const confirmed = window.confirm(
                  `Send ${readyUnsentCount} real invitation emails?\n\nSender:\n${session.gmail.address}\n\nSession A: ${readySessionACount}\nSession B: ${readySessionBCount}\nBlocked: ${blockedCount}${blockedMessage}\n\nEach student will receive a separate email with their matched invitation.\n\nThis action cannot be undone.`
                );
                if (!confirmed) {
                  return;
                }
                await postJson("/api/send/batch");
              }}
            >
              {sendButtonLabel}
            </button>
            {allReadyInvitationsSent ? (
              <p className="success-note">All Ready invitations have been sent.</p>
            ) : null}
            {session.queue.failed > 0 ? (
              <button disabled={!canSend || isSending} onClick={() => postJson("/api/send/retry-failed")}>
                Retry Failed
              </button>
            ) : null}
            {gmailPermissionMessage ? <p className="subtle">{gmailPermissionMessage}</p> : null}
            <a className="button-link" href="/api/report.csv">
              Download Temporary CSV Report
            </a>
          </div>
          <div className="status-card">
            <p>Pending: {session.queue.pending}</p>
            <p>Currently sending: {currentStudentName}</p>
            <p>Sent: {session.queue.sent}</p>
            <p>Failed: {session.queue.failed}</p>
            <p>Remaining: {session.queue.remaining}</p>
          </div>
        </div>
      </section>

      <section className="panel compact-panel">
        <div className="panel-header">
          <h2>Validation Results</h2>
        </div>
        <ul className="issues-list">
          {session.issues.length ? (
            session.issues.map((issue, index) => <li key={`${issue.type}-${index}`}>{issue.message}</li>)
          ) : (
            <li>No current validation issues.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
