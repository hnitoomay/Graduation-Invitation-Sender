import { apiFetch } from "./api";
import { defaultSubjectFor } from "./browserData";

export function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status < 600);
}

export function buildSendOneFormData(student, jobId) {
  const formData = new FormData();
  formData.append("studentName", student.studentName);
  formData.append("recipientEmail", student.email);
  formData.append("sficId", student.sficId);
  formData.append("sessionKey", student.sessionKey);
  formData.append("subject", defaultSubjectFor(student.studentName));
  formData.append("jobId", jobId);
  formData.append("idempotencyKey", `${jobId}:${student.id}`);
  formData.append("invitationImage", student.imageMatch.file, student.imageMatch.file.name);
  return formData;
}

export async function sendOneStudent(student, jobId) {
  return apiFetch("/api/send-one", {
    method: "POST",
    body: buildSendOneFormData(student, jobId)
  });
}

export async function sendStudentsSequentially({
  students,
  jobId,
  sendRequest = sendOneStudent,
  wait = sleep,
  onProgress,
  onResult
}) {
  for (let index = 0; index < students.length; index += 1) {
    const student = students[index];
    const pendingIds = students.slice(index + 1).map((item) => item.id);

    if (onProgress) {
      onProgress({
        student,
        pendingIds,
        index,
        total: students.length
      });
    }

    let attempt = 0;
    let completed = false;
    while (!completed) {
      try {
        const response = await sendRequest(student, jobId);
        const data = await response.json();
        if (response.ok) {
          completed = true;
          if (onResult) {
            onResult({
              ok: true,
              student,
              data,
              pendingIds
            });
          }
        } else if (isRetryableStatus(response.status) && attempt < 3) {
          attempt += 1;
          await wait(1000 * 2 ** (attempt - 1));
        } else {
          completed = true;
          if (onResult) {
            onResult({
              ok: false,
              student,
              data,
              status: response.status,
              pendingIds
            });
          }
        }
      } catch (error) {
        if (attempt < 3) {
          attempt += 1;
          await wait(1000 * 2 ** (attempt - 1));
        } else {
          completed = true;
          if (onResult) {
            onResult({
              ok: false,
              student,
              data: { error: error.message || "Network error." },
              status: 503,
              pendingIds
            });
          }
        }
      }
    }

    if (index < students.length - 1) {
      await wait(1000);
    }
  }
}
