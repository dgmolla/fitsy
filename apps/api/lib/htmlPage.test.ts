import { badLinkPage, htmlPage } from "@/lib/htmlPage";

describe("htmlPage", () => {
  it("renders a standalone HTML document with the title and body", async () => {
    const res = htmlPage("Hello", "<h1>Hi</h1>");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).toContain("<title>Hello</title>");
    expect(html).toContain("<h1>Hi</h1>");
  });

  it("escapes the title", async () => {
    const html = await htmlPage('A <b>"t"</b> & co', "<p>x</p>").text();
    expect(html).toContain("<title>A &lt;b&gt;&quot;t&quot;&lt;/b&gt; &amp; co</title>");
  });

  it("badLinkPage is a 400 that names the link kind", async () => {
    const res = badLinkPage("confirmation link");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("This confirmation link is not valid.");
  });
});
