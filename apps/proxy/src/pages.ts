export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Minimal branded error page. Every interpolated value is HTML-escaped (hostnames are attacker-controlled). */
export function errorPage(status: number, title: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${status} · ${escapeHtml(title)}</title>
<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;background:#050505;color:#fafafa;font:15px/1.5 system-ui,sans-serif}
main{max-width:480px;padding:24px;text-align:center}h1{font-size:44px;margin:0 0 8px;letter-spacing:-.03em}h2{font-size:17px;font-weight:600;margin:0 0 12px}p{color:#a1a1aa;margin:0}small{display:block;margin-top:28px;color:#52525b}</style></head>
<body><main><h1>${status}</h1><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p><small>Powered by Orb</small></main></body></html>`;
}

/** Shown while a sleeping free-plan service starts again; reloads itself until the app answers. */
export function wakingPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="3"><title>Waking up…</title>
<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;background:#050505;color:#fafafa;font:15px/1.5 system-ui,sans-serif}
main{max-width:440px;padding:24px;text-align:center}h2{font-size:20px;margin:18px 0 8px;letter-spacing:-.02em}p{color:#a1a1aa;margin:0}small{display:block;margin-top:28px;color:#52525b}
.o{width:34px;height:34px;margin:0 auto;border-radius:50%;border:3px solid #27272a;border-top-color:#6b82ff;animation:s 0.9s linear infinite}@keyframes s{to{transform:rotate(360deg)}}</style></head>
<body><main><div class="o"></div><h2>Waking this app up</h2><p>It was asleep to save resources. It starts in a few seconds and this page reloads by itself.</p><small>Powered by Orb</small></main></body></html>`;
}
