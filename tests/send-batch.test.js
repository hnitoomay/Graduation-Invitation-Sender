/* @vitest-environment jsdom */

import { describe, expect, test, vi } from "vitest";
import {
  buildSendOneFormData,
  sendStudentsSequentially
} from "../src/sendBatch";

function makeStudent(index) {
  return {
    id: `student-${index}`,
    studentName: `Student ${index}`,
    sficId: `2022B${String(index).padStart(4, "0")}`,
    email: `student${index}@example.com`,
    sessionKey: index % 2 === 0 ? "B" : "A",
    imageMatch: {
      matchStatus: "ready",
      file: new File(["image"], `2022B${String(index).padStart(4, "0")}_Student ${index}.jpg`, {
        type: "image/jpeg"
      })
    }
  };
}

describe("sequential browser sending", () => {
  test("builds one-image-per-request form data", () => {
    const student = makeStudent(1);
    const formData = buildSendOneFormData(student, "job-123");

    expect(formData.get("studentName")).toBe("Student 1");
    expect(formData.get("jobId")).toBe("job-123");
    expect(formData.get("idempotencyKey")).toBe("job-123:student-1");
    expect(formData.get("invitationImage").name).toBe("2022B0001_Student 1.jpg");
  });

  test("sends students sequentially and retries temporary failures", async () => {
    const first = makeStudent(1);
    const second = makeStudent(2);
    const events = [];
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        async json() {
          return { error: "Too many requests" };
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        async json() {
          return { messageId: "message-1" };
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        async json() {
          return { messageId: "message-2" };
        }
      });
    const wait = vi.fn().mockResolvedValue(undefined);

    await sendStudentsSequentially({
      students: [first, second],
      jobId: "job-1",
      sendRequest,
      wait,
      onProgress: ({ student }) => {
        events.push(`progress:${student.id}`);
      },
      onResult: ({ ok, student }) => {
        events.push(`${ok ? "sent" : "failed"}:${student.id}`);
      }
    });

    expect(sendRequest).toHaveBeenCalledTimes(3);
    expect(sendRequest.mock.calls[0][0].id).toBe("student-1");
    expect(sendRequest.mock.calls[1][0].id).toBe("student-1");
    expect(sendRequest.mock.calls[2][0].id).toBe("student-2");
    expect(events).toEqual([
      "progress:student-1",
      "sent:student-1",
      "progress:student-2",
      "sent:student-2"
    ]);
  });
});
