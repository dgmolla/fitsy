// ─── Mock global fetch before importing ───────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { sendWelcomeEmail } from "./emailService";

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  mockFetch.mockReset();
  process.env = {
    ...ORIGINAL_ENV,
    RESEND_API_KEY: "re_test_key",
    APP_URL: "https://test.fitsy.app",
  };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

// ─── sendWelcomeEmail ─────────────────────────────────────────────────────────

describe("sendWelcomeEmail", () => {
  it("sends an email via Resend API when API key is present", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await sendWelcomeEmail("alice@example.com", "Alice");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(options.method).toBe("POST");
    expect(options.headers["Authorization"]).toBe("Bearer re_test_key");

    const body = JSON.parse(options.body);
    expect(body.to).toBe("alice@example.com");
    expect(body.from).toBe("Fitsy <hello@fitsy.app>");
    expect(body.html).toContain("Hi Alice,");
    expect(body.text).toContain("Hi Alice,");
    expect(body.html).toContain("/setup-macros");
  });

  it("uses generic greeting when name is not provided", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await sendWelcomeEmail("bob@example.com");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.html).toContain("Hi there,");
    expect(body.text).toContain("Hi there,");
  });

  it("silently skips when RESEND_API_KEY is absent", async () => {
    delete process.env["RESEND_API_KEY"];

    await sendWelcomeEmail("nobody@example.com");

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("logs error when Resend API returns non-ok response", async () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      text: jest.fn().mockResolvedValue("Invalid email"),
    });

    await sendWelcomeEmail("bad@example.com");

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Resend API error 422"),
    );
    consoleSpy.mockRestore();
  });

  it("handles fetch text() failure gracefully on error response", async () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: jest.fn().mockRejectedValue(new Error("body read failed")),
    });

    await sendWelcomeEmail("bad@example.com");

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Resend API error 500"),
    );
    consoleSpy.mockRestore();
  });
});
