/* @vitest-environment jsdom */

import ReactDOM from "react-dom/client";
import { act } from "react";
import { vi } from "vitest";
import App from "../src/App";

vi.mock("../src/api", () => ({
  apiJson: vi.fn()
}));

vi.mock("../src/sendBatch", () => ({
  sendStudentsSequentially: vi.fn()
}));

const { apiJson } = await import("../src/api");

async function renderApp() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  await act(async () => {
    root.render(<App />);
  });
  await act(async () => {
    await Promise.resolve();
  });

  return {
    container,
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  };
}

describe("App UI", () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    window.history.replaceState({}, "", "/");
  });

  test("shows Connect Gmail when disconnected", async () => {
    apiJson.mockImplementation(async (path) => {
      if (path === "/api/auth/status") {
        return {
          connected: false,
          address: "",
          canSend: false,
          error: ""
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const { container, cleanup } = await renderApp();

    try {
      expect(container.textContent).toContain("Gmail sender: Not connected");
      expect(container.textContent).toContain("Connect Gmail");
      expect(container.textContent).toContain(
        "Connect your Gmail sender account before uploading student files."
      );
      expect(container.textContent).not.toContain("student_registry@mystrategyfirst.com");
      expect(container.textContent).not.toContain("Application Login");
      expect(container.textContent).not.toContain("Logout");
    } finally {
      cleanup();
    }
  });

  test("shows connected gmail sender and Disconnect button", async () => {
    apiJson.mockImplementation(async (path) => {
      if (path === "/api/auth/status") {
        return {
          connected: true,
          address: "student_registry@mystrategyfirst.com",
          canSend: true,
          error: ""
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const { container, cleanup } = await renderApp();

    try {
      expect(container.textContent).toContain("student_registry@mystrategyfirst.com");
      expect(container.textContent).toContain("Connected");
      expect(container.textContent).toContain("Disconnect");
      expect(container.textContent).not.toContain("Connect Gmail");
      expect(container.textContent).not.toContain("Clear Uploaded Files");
      expect(container.textContent).not.toContain("Reset Session");
    } finally {
      cleanup();
    }
  });

  test("shows OAuth error feedback from redirect result", async () => {
    window.history.replaceState({}, "", "/?gmail=wrong_account");
    apiJson.mockImplementation(async (path) => {
      if (path === "/api/auth/status") {
        return {
          connected: false,
          address: "",
          canSend: false,
          error: ""
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const { container, cleanup } = await renderApp();

    try {
      expect(container.textContent).toContain(
        "Connected Google account does not match ALLOWED_GMAIL_SENDER."
      );
    } finally {
      cleanup();
    }
  });
});
