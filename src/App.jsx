import { useEffect, useMemo, useState } from "react";
import { apiJson } from "./api";
import {
  parseWorkbookFile,
  matchStudentsWithImages,
  deriveStudentStatus,
  isSingleValidEmail,
  createInitialQueue,
  resetStudentSending,
  createFolderSummary,
  createCsvReport
} from "./browserData";
import { sendStudentsSequentially } from "./sendBatch";

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

export default function App() {
  const [loading, setLoading] = useState(true);
  const [gmailStatus, setGmailStatus] = useState({
    connected: false,
    address: "",
    canSend: false,
    error: ""
  });
  const [students, setStudents] = useState([]);
  const [imageFiles, setImageFiles] = useState([]);
  const [workbookErrors, setWorkbookErrors] = useState([]);
  const [issues, setIssues] = useState([]);
  const [folderUpload, setFolderUpload] = useState({
    folderName: "",
    validImageCount: 0,
    ignoredFileCount: 0,
    totalImageBytes: 0
  });
  const [queue, setQueue] = useState(createInitialQueue());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sessionFilter, setSessionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [excelFileName, setExcelFileName] = useState("");

  async function fetchGmailStatus() {
    const result = await apiJson("/api/auth/status");
    setGmailStatus(result);
    return result;
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmailResult = params.get("gmail");

    fetchGmailStatus()
      .then((status) => {
        if (gmailResult === "wrong_account") {
          setError("Connected Google account does not match ALLOWED_GMAIL_SENDER.");
        } else if (gmailResult === "missing_permission") {
          setError("Google connected, but Gmail sending permission was not granted.");
        } else if (gmailResult === "error") {
          setError(status.error || "Google connection failed.");
        }
      })
      .catch((requestError) => {
        setError(requestError.message);
      })
      .finally(() => {
        if (gmailResult) {
          window.history.replaceState({}, "", window.location.pathname);
        }
        setLoading(false);
      });
  }, []);

  const studentsWithStatus = useMemo(
    () =>
      students.map((student) => {
        const state = deriveStudentStatus(student, queue);
        return {
          ...student,
          status: state.status,
          statusReason: state.reason,
          selectable: state.selectable
        };
      }),
    [students, queue]
  );

  const filteredStudents = useMemo(() => {
    return studentsWithStatus.filter((student) => {
      const term = search.toLowerCase();
      const matchesSearch =
        !term ||
        student.studentName.toLowerCase().includes(term) ||
        student.sficId.toLowerCase().includes(term) ||
        student.email.toLowerCase().includes(term);
      const matchesSession = sessionFilter === "all" || student.sessionKey === sessionFilter;
      const matchesStatus =
        statusFilter === "all" || student.status.toLowerCase() === statusFilter;
      return matchesSearch && matchesSession && matchesStatus;
    });
  }, [search, sessionFilter, statusFilter, studentsWithStatus]);

  const summary = useMemo(() => {
    return {
      totalStudents: studentsWithStatus.length,
      sessionAStudents: studentsWithStatus.filter((student) => student.sessionKey === "A").length,
      sessionBStudents: studentsWithStatus.filter((student) => student.sessionKey === "B").length,
      successfullyMatched: studentsWithStatus.filter(
        (student) => student.imageMatch?.matchStatus === "ready"
      ).length,
      missingImages: studentsWithStatus.filter((student) => !student.imageMatch).length,
      errors:
        studentsWithStatus.filter((student) => student.status === "Error").length +
        workbookErrors.length +
        issues.length,
      sentDuringSession: studentsWithStatus.filter((student) => student.sendState === "sent").length,
      failedDuringSession: studentsWithStatus.filter((student) => student.sendState === "failed").length
    };
  }, [issues.length, studentsWithStatus, workbookErrors.length]);

  const readyUnsentStudents = useMemo(
    () =>
      studentsWithStatus.filter(
        (student) =>
          student.status === "Ready" &&
          isSingleValidEmail(student.email) &&
          student.imageMatch?.matchStatus === "ready" &&
          student.sendState !== "sent" &&
          student.sendState !== "failed" &&
          queue.currentStudentId !== student.id
      ),
    [queue.currentStudentId, studentsWithStatus]
  );

  const readyUnsentCount = readyUnsentStudents.length;
  const readySessionACount = readyUnsentStudents.filter((student) => student.sessionKey === "A").length;
  const readySessionBCount = readyUnsentStudents.filter((student) => student.sessionKey === "B").length;
  const blockedCount = studentsWithStatus.filter(
    (student) => student.sendState !== "sent" && student.status !== "Ready"
  ).length;
  const currentStudentName =
    studentsWithStatus.find((student) => student.id === queue.currentStudentId)?.studentName || "-";
  const allReadyInvitationsSent =
    studentsWithStatus.filter(
      (student) => student.status === "Ready" || queue.currentStudentId === student.id
    ).length === 0 && summary.sentDuringSession > 0;

  async function handleConnectGmail() {
    setBusy(true);
    setError("");
    setGmailStatus({
      connected: false,
      address: "",
      canSend: false,
      error: ""
    });
    try {
      const result = await apiJson("/api/auth/google");
      window.location.href = result.url;
    } catch (requestError) {
      setError(requestError.message);
      setBusy(false);
    }
  }

  async function handleDisconnectGmail() {
    setBusy(true);
    setError("");
    try {
      const result = await apiJson("/api/auth/google/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      setGmailStatus(result);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleWorkbookSelection(file) {
    if (!file) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const parsed = await parseWorkbookFile(file);
      const resetStudents = resetStudentSending(parsed.students);
      const matched = matchStudentsWithImages(resetStudents, imageFiles);
      setStudents(matched.students);
      setWorkbookErrors(parsed.errors);
      setIssues(matched.issues);
      setExcelFileName(file.name);
      setQueue(createInitialQueue());
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleImageSelection(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const matched = matchStudentsWithImages(resetStudentSending(studentsWithStatus), files);
      setStudents(matched.students);
      setImageFiles(files);
      setIssues(matched.issues);
      setFolderUpload(createFolderSummary(files));
      setQueue(createInitialQueue());
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function runSequentialSend(targetStudents) {
    if (!targetStudents.length) {
      return;
    }

    const jobId = window.crypto.randomUUID();
    setBusy(true);
    setError("");
    setQueue({
      pending: targetStudents.length,
      pendingIds: targetStudents.map((student) => student.id),
      currentStudentId: "",
      sent: 0,
      failed: 0,
      remaining: targetStudents.length
    });

    try {
      await sendStudentsSequentially({
        students: targetStudents,
        jobId,
        onProgress: ({ student, pendingIds }) => {
          setQueue((current) => ({
            ...current,
            currentStudentId: student.id,
            pending: pendingIds.length,
            pendingIds,
            remaining: pendingIds.length + 1
          }));
        },
        onResult: ({ ok, student, data, status, pendingIds }) => {
          setStudents((current) =>
            current.map((item) =>
              item.id === student.id
                ? {
                    ...item,
                    sendState: ok ? "sent" : "failed",
                    sendError: ok ? "" : (data.error || `Send failed with ${status}.`),
                    gmailMessageId: ok ? data.messageId : "",
                    lastAttemptAt: new Date().toISOString()
                  }
                : item
            )
          );
          setQueue((current) => ({
            ...current,
            currentStudentId: "",
            sent: ok ? current.sent + 1 : current.sent,
            failed: ok ? current.failed : current.failed + 1,
            remaining: pendingIds.length
          }));
        }
      });
    } finally {
      setQueue((current) => ({
        ...current,
        pending: 0,
        pendingIds: [],
        currentStudentId: "",
        remaining: 0
      }));
      setBusy(false);
    }
  }

  async function handleSendAll() {
    const blockedMessage =
      blockedCount > 0
        ? `\n\nOnly Ready students will be sent. ${blockedCount} blocked students will not receive an email.`
        : "";
    const confirmed = window.confirm(
      `Send ${readyUnsentCount} real invitation emails?\n\nSender:\n${gmailStatus.address}\n\nSession A: ${readySessionACount}\nSession B: ${readySessionBCount}\nBlocked: ${blockedCount}${blockedMessage}\n\nEach student will receive a separate email with their matched invitation.\n\nThis action cannot be undone.`
    );
    if (!confirmed) {
      return;
    }
    await runSequentialSend(readyUnsentStudents);
  }

  async function handleRetryFailed() {
    const failedStudents = studentsWithStatus.filter((student) => student.sendState === "failed");
    const resetFailed = studentsWithStatus.map((student) =>
      student.sendState === "failed"
        ? {
            ...student,
            sendState: "not_sent",
            sendError: "",
            gmailMessageId: ""
          }
        : student
    );
    setStudents(resetFailed);
    await runSequentialSend(
      failedStudents.map((student) => ({
        ...student,
        sendState: "not_sent",
        sendError: "",
        gmailMessageId: ""
      }))
    );
  }

  function downloadCsvReport() {
    const blob = new Blob([createCsvReport(studentsWithStatus, queue)], {
      type: "text/csv;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "graduation-session-report.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <div className="page-shell">Loading application...</div>;
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
            {gmailStatus.connected ? gmailStatus.address : "Not connected"}
          </div>
          {gmailStatus.connected ? (
            <div className="gmail-actions">
              <span className="connected-label">Connected</span>
              <button onClick={handleDisconnectGmail} disabled={busy}>
                Disconnect
              </button>
            </div>
          ) : (
            <button onClick={handleConnectGmail} disabled={busy}>
              Connect Gmail
            </button>
          )}
        </div>
        {gmailStatus.error ? (
          <div className="error-banner">{gmailStatus.error}</div>
        ) : null}
      </section>

      <section className="panel compact-panel">
        <div className="upload-stack">
          {!gmailStatus.connected ? (
            <div className="warning-banner">
              Connect your Gmail sender account before uploading student files.
            </div>
          ) : null}
          <label className="upload-row">
            <span>Student Excel File</span>
            <input
              type="file"
              accept=".xlsx"
              disabled={busy || !gmailStatus.connected}
              onChange={(event) => handleWorkbookSelection(event.target.files?.[0])}
            />
          </label>
          <label className="upload-row">
            <span>Invitation Images Folder</span>
            <input
              type="file"
              multiple
              webkitdirectory=""
              directory=""
              disabled={busy || !gmailStatus.connected}
              onChange={(event) => handleImageSelection(event.target.files)}
            />
          </label>
          <div className="upload-meta">
            <div>
              <strong>Excel file:</strong> {excelFileName || "Not uploaded"}
            </div>
            <div>
              <strong>Folder:</strong> {folderUpload.folderName || "Not selected"}
            </div>
            <div>
              <strong>Valid images:</strong> {folderUpload.validImageCount}
            </div>
            <div>
              <strong>Ignored files:</strong> {folderUpload.ignoredFileCount}
            </div>
            <div>
              <strong>Total image size:</strong> {formatBytes(folderUpload.totalImageBytes)}
            </div>
          </div>
        </div>
      </section>

      <section className="summary-grid compact-summary">
        <SummaryCard label="Total students" value={summary.totalStudents} />
        <SummaryCard label="Session A" value={summary.sessionAStudents} />
        <SummaryCard label="Session B" value={summary.sessionBStudents} />
        <SummaryCard label="Valid images" value={folderUpload.validImageCount} />
        <SummaryCard label="Matched" value={summary.successfullyMatched} />
        <SummaryCard label="Missing" value={summary.missingImages} />
        <SummaryCard label="Errors" value={summary.errors} />
        <SummaryCard label="Sent" value={summary.sentDuringSession} />
        <SummaryCard label="Failed" value={summary.failedDuringSession} />
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
                        const nextEmail = event.target.value;
                        setStudents((current) =>
                          current.map((item) =>
                            item.id === student.id
                              ? {
                                  ...item,
                                  email: nextEmail,
                                  emailRaw: nextEmail,
                                  hasMultipleEmails: false
                                }
                              : item
                          )
                        );
                      }}
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
              disabled={!gmailStatus.canSend || readyUnsentCount === 0 || busy}
              onClick={handleSendAll}
            >
              {readyUnsentCount > 0
                ? `Send All ${readyUnsentCount} Ready Emails`
                : "No Ready Emails to Send"}
            </button>
            {allReadyInvitationsSent ? (
              <p className="success-note">All Ready invitations have been sent.</p>
            ) : null}
            {summary.failedDuringSession > 0 ? (
              <button disabled={!gmailStatus.canSend || busy} onClick={handleRetryFailed}>
                Retry Failed
              </button>
            ) : null}
            <button className="button-link" onClick={downloadCsvReport}>
              Download Temporary CSV Report
            </button>
          </div>
          <div className="status-card">
            <p>Pending: {queue.pending}</p>
            <p>Currently sending: {currentStudentName}</p>
            <p>Sent: {queue.sent}</p>
            <p>Failed: {queue.failed}</p>
            <p>Remaining: {queue.remaining}</p>
          </div>
        </div>
      </section>

      <section className="panel compact-panel">
        <div className="panel-header">
          <h2>Validation Results</h2>
        </div>
        <ul className="issues-list">
          {[...workbookErrors, ...issues].length ? (
            [...workbookErrors, ...issues].map((issue, index) => (
              <li key={`${issue.type}-${index}`}>{issue.message}</li>
            ))
          ) : (
            <li>No current validation issues.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
