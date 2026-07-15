const FALLBACK_SITE_URL = 'https://dorofocus.netlify.app';

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const getSiteUrl = (requestUrl) => {
  const envUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || '';
  if (envUrl) return envUrl.replace(/\/+$/, '');
  try {
    return new URL(requestUrl).origin;
  } catch {
    return FALLBACK_SITE_URL;
  }
};

const normalizeSessionId = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9_-]/g, '')
  .slice(0, 64);

const getSessionFromPath = (pathname) => {
  const match = pathname.match(/\/share\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : '';
};

const appendOptionalParam = (params, key, value) => {
  if (value === null || value === undefined || value === '') return;
  params.set(key, String(value));
};

export default async (request) => {
  const url = new URL(request.url);
  const siteUrl = getSiteUrl(request.url);
  const sessionId = normalizeSessionId(url.searchParams.get('session') || getSessionFromPath(url.pathname));

  if (!sessionId) {
    return new Response('Missing spectator session.', { status: 400 });
  }

  const mode = url.searchParams.get('mode') === 'break' ? 'break' : 'work';
  const end = url.searchParams.get('end') || '';
  const endLabel = (url.searchParams.get('endLabel') || '').slice(0, 40);
  const remaining = url.searchParams.get('remaining') || '';
  const appParams = new URLSearchParams({ spectate: sessionId, mode });
  const imageParams = new URLSearchParams({ session: sessionId, mode });

  appendOptionalParam(appParams, 'end', end);
  appendOptionalParam(appParams, 'endLabel', endLabel);
  appendOptionalParam(appParams, 'remaining', remaining);
  appendOptionalParam(imageParams, 'end', end);
  appendOptionalParam(imageParams, 'endLabel', endLabel);
  appendOptionalParam(imageParams, 'remaining', remaining);

  const appUrl = `${siteUrl}/?${appParams.toString()}`;
  const imageUrl = `${siteUrl}/.netlify/functions/spectate-og?${imageParams.toString()}`;
  const titleEnd = endLabel || 'Live timer';
  const modeLabel = mode === 'break' ? 'Break Bank' : 'Focus';
  const title = `${modeLabel} until ${titleEnd}`;
  const description = 'Live Doro timer view with remaining time and estimated end time.';

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Doro">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:url" content="${escapeHtml(url.href)}">
    <meta property="og:image" content="${escapeHtml(imageUrl)}">
    <meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}">
    <meta property="og:image:type" content="image/png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}">
    <meta http-equiv="refresh" content="0; url=${escapeHtml(appUrl)}">
  </head>
  <body style="margin:0;background:#9f7d87;color:#fff;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <main style="min-height:100vh;display:grid;place-items:center;padding:24px;text-align:center;">
      <div>
        <h1 style="margin:0 0 8px;font-size:28px;">Opening Doro timer...</h1>
        <p style="margin:0 0 18px;opacity:.72;">${escapeHtml(title)}</p>
        <a href="${escapeHtml(appUrl)}" style="color:#fff;font-weight:700;">Open live timer</a>
      </div>
    </main>
    <script>window.location.replace(${JSON.stringify(appUrl)});</script>
  </body>
</html>`;

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60',
    },
  });
};
