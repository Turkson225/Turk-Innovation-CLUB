// Shared by static HTML generation and the optional dedicated-origin header worker.
export const startupScriptHash='sha256-ljs7+Gi5ZKe8DtLqPX9XY9jMSFvroD3ReR2TyJ+eOME=';
export const offlineScriptHash='sha256-1+M4XtRAJinz7e7OzMqBRJkCk/z97qHtyTuDGEr4Q54=';
export const contentSecurityPolicy=[
  "default-src 'self'",
  `script-src 'self' '${startupScriptHash}' '${offlineScriptHash}' https://accounts.google.com`,
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://www.googleapis.com https://accounts.google.com https://tile.openstreetmap.org https://gibs.earthdata.nasa.gov",
  "frame-src 'self' blob: https://drive.google.com https://docs.google.com https://www.youtube.com https://www.youtube-nocookie.com https://accounts.google.com",
  "worker-src 'self' blob:",
  "media-src 'self' blob: https://*.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests'
].join('; ');

export const securityHeaders={
  'Content-Security-Policy':contentSecurityPolicy+"; frame-ancestors 'none'",
  'X-Frame-Options':'DENY',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=(self), payment=(), usb=()',
  'Strict-Transport-Security':'max-age=31536000; includeSubDomains'
};
