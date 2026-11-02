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
