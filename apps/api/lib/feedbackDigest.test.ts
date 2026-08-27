import {
  buildFeedbackAlert,
  buildFeedbackDigest,
  buildReplyMailto,
  type FeedbackDigestRow,
} from "./feedbackDigest";

const ROW = (over: Partial<FeedbackDigestRow> = {}): FeedbackDigestRow => ({
  userEmail: "alice@example.com",
  message: "love the protein filter",
  createdAt: new Date("2026-06-06T14:23:05.000Z"),
  ...over,
});

describe("buildFeedbackDigest", () => {
  it("renders an empty-state message when there are no rows", () => {
    const text = buildFeedbackDigest([]);
    expect(text).toContain("last 24h");
    expect(text).toContain("No new feedback");
  });

  it("includes a count and one entry per row", () => {
    const text = buildFeedbackDigest([
      ROW({ userEmail: "a@x.com", message: "first" }),
      ROW({ userEmail: "b@x.com", message: "second" }),
    ]);
    expect(text).toContain("(2)");
    expect(text).toContain("_a@x.com_");
    expect(text).toContain("> first");
    expect(text).toContain("_b@x.com_");
    expect(text).toContain("> second");
  });

  it("formats the timestamp deterministically in UTC", () => {
    const text = buildFeedbackDigest([ROW()]);
    expect(text).toContain("2026-06-06 14:23 UTC");
  });

  it("collapses whitespace and truncates long messages", () => {
    const text = buildFeedbackDigest([ROW({ message: "a\n\n   b " + "x".repeat(400) })], {
      perItemMaxChars: 20,
    });
    const line = text.split("\n").find((l) => l.startsWith("> "))!;
    expect(line.length).toBeLessThanOrEqual(2 + 20); // "> " + capped body
    expect(line).toContain("…");
    expect(line).not.toContain("\n");
  });

  it("honors a custom window size in the header", () => {
    expect(buildFeedbackDigest([], { windowHours: 48 })).toContain("last 48h");
  });
});

describe("buildFeedbackAlert / reply links", () => {
  it("posts one real-time message with a pre-filled mailto reply", () => {
    const text = buildFeedbackAlert(
      ROW({ userEmail: "bob@x.com", message: "macros for Sweetgreen look off" }),
    );
    expect(text).toContain("*New feedback* from _bob@x.com_");
    expect(text).toContain("> macros for Sweetgreen look off");
    expect(text).toContain("<mailto:bob%40x.com?subject=");
    expect(text).toContain("|Reply>");
    expect(text).toContain("within 24h");
  });

  it("quotes the user's note and asks for a call in the reply body", () => {
    const url = buildReplyMailto("bob@x.com", "the  search   is slow");
    const body = decodeURIComponent(url.split("&body=")[1] ?? "");
    expect(body).toContain("> the search is slow");
    expect(body).toContain("10-minute call");
  });

  it("adds a Reply link to every digest entry", () => {
    const text = buildFeedbackDigest([ROW({ userEmail: "a@x.com" }), ROW({ userEmail: "b@x.com" })]);
    expect(text.match(/\|Reply>/g)).toHaveLength(2);
  });
});
