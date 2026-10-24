/**
 * Minimal branded HTML pages for email-link landings (unsubscribe, waitlist
 * confirmation). Inline CSS only: these pages are opened from mail clients
 * and must render with no app bundle.
 *
 * `title` is escaped. `body` is trusted, caller-built markup (like
 * brandEmailShell in emailTemplates.ts): never interpolate request data
 * into it unescaped.
 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const BRAND_GREEN = "#1B3A26";
const BG = "#FDFBF7";

export function htmlPage(title: string, body: string, status = 200): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{background:${BG};color:#222;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:24px}
  .card{max-width:440px;width:100%;background:#fff;border:1px solid #e5e1d8;border-radius:16px;padding:40px 36px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.06)}
  h1{font-size:22px;font-weight:700;color:${BRAND_GREEN};margin-bottom:12px}
  p{font-size:15px;line-height:1.6;color:#555;margin-bottom:20px}
  button,.btn{display:inline-block;background:${BRAND_GREEN};color:#fff;border:none;border-radius:8px;padding:12px 28px;font-size:15px;font-weight:600;cursor:pointer;width:100%;text-decoration:none}
  button:hover,.btn:hover{background:#254d35}
  .note{font-size:13px;color:#999;margin-top:16px}
</style>
</head>
<body>
<div class="card">${body}</div>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** 400 page for a missing or tampered signed link. */
export function badLinkPage(what = "link"): Response {
  return htmlPage(
    `Invalid ${what}`,
    `<h1>This ${what} is not valid.</h1><p>It may have been copied incompletely. Please use the link from the original email.</p>`,
    400,
  );
}
