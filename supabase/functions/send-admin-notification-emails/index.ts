// Server-only Cron worker. Authorization, recipients and content are never
// accepted from a request body. SMTP credentials are read from function secrets.
import { withSupabase } from "npm:@supabase/server@^1";
import nodemailer from "npm:nodemailer@10.6.0";

type Event = {
  id: string;
  recipient: string;
  code: string;
  category: string;
  severity: string;
  title: string;
  resource: string;
  summary: string;
  recommendation: string;
  route: string;
  first_at: string;
  last_at: string;
  occurrences: number;
  observed_count: number | null;
};
type Fault = { outcome: "retry" | "failed" | "uncertain"; code: string };
type Claim = { id: string; token: string };

const DEFAULT_SITE = "https://turk-innovation-club.ennisturkson98.workers.dev/";
const MAX_BATCH = 2;
const routes = new Set(["admin", "announcements", "chapter-admin", "moderation", "system-health"]);
const severityLabels = { info: "INFO", warning: "WARNING", high: "HIGH" };
const categoryLabels = {
  updates: "Update",
  alerts: "Alert",
  errors: "Error",
  security: "Security",
  service_status: "Service status",
  test: "Test",
};
const safeMail = (address: string) => address.length <= 254 &&
  /^[a-z0-9%_+~-]+(?:\.[a-z0-9%_+~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(address);
const uuid = (id: string) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]!);
}

export function siteUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port) {
    throw new Error("Invalid site address");
  }
  return url;
}

export function messageFor(event: Event, base: URL) {
  const category = Object.hasOwn(categoryLabels, event.category)
    ? categoryLabels[event.category as keyof typeof categoryLabels] : "";
  const severity = Object.hasOwn(severityLabels, event.severity)
    ? severityLabels[event.severity as keyof typeof severityLabels] : "";
  if (!category || !severity || !safeMail(event.recipient) || !uuid(event.id) ||
    !routes.has(event.route) || /[\r\n]/.test(event.title)) throw new Error("Invalid mail event");
  const timestamp = (value: string) => new Date(value).toISOString().slice(0, 19).replace("T", " ") + " UTC";
  const link = new URL(base);
  link.hash = event.route;
  const subject = `[SPACE][${severity}][${category}] ${event.title}`;
  const lines: [string, string][] = [
    ["Affected resource", event.resource],
    ["Recorded", timestamp(event.first_at)],
  ];
  if (event.occurrences > 1) {
    lines.push(["Grouped events", `${event.occurrences} (latest: ${timestamp(event.last_at)})`]);
  }
  if (event.observed_count !== null) lines.push(["Observed count", String(event.observed_count)]);
  lines.push(["Recommended action", event.recommendation], ["Reference", event.id]);
  const text = `${event.title}\n\n${event.summary}\n\n${lines.map(([k, v]) => k + ": " + v).join("\n")}\n\nOpen SPACE: ${link.href}\n\nSPACE administrator notifications · TURK INNOVATION CLUB`;
  const html = `<!doctype html><html lang="en"><body style="font-family:Arial,sans-serif;line-height:1.6;color:#222033"><main style="max-width:560px;margin:auto;padding:24px"><p style="color:#5825af;font-weight:700">SPACE ADMINISTRATION · ${escapeHtml(severity)}</p><h1 style="font-size:23px;line-height:1.3">${escapeHtml(event.title)}</h1><p>${escapeHtml(event.summary)}</p><dl>${lines.map(([k, v]) => `<dt style="font-weight:bold">${escapeHtml(k)}</dt><dd style="margin:0 0 8px">${escapeHtml(v)}</dd>`).join("")}</dl><p><a href="${escapeHtml(link.href)}" style="color:#5825af;font-weight:bold">Open SPACE</a></p><p style="font-size:13px">TURK INNOVATION CLUB</p></main></body></html>`;
  return { to: event.recipient, subject, text, html, messageId: `<space-admin-${event.id}@${base.hostname}>` };
}

export function smtpFailure(error: unknown): Fault {
  const e = (error && typeof error === "object" ? error : {}) as Record<string, unknown>;
  const status = Number(e.responseCode);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return { outcome: "retry", code: "smtp_temporary" };
  }
  if ((Number.isInteger(status) && status >= 500 && status < 600) || e.code === "EAUTH") {
    return { outcome: "failed", code: e.code === "EAUTH" ? "sender_rejected" : "smtp_rejected" };
  }
  // After DATA, a disconnect or timeout can occur after acceptance.
  if (typeof e.command === "string" && /^(?:CONN|EHLO|HELO|STARTTLS|AUTH(?: .*)?|MAIL FROM|RCPT TO)$/.test(e.command)) {
    return { outcome: "retry", code: "transport_before_message" };
  }
  return { outcome: "uncertain", code: e.code === "ETIMEDOUT" || e.name === "AbortError" ? "smtp_timeout" : "confirmation_missing" };
}

function configuration() {
  const customEmail = Deno.env.get("ADMIN_SMTP_EMAIL")?.trim() ?? "";
  const customPassword = Deno.env.get("ADMIN_SMTP_APP_PASSWORD")?.replace(/\s/g, "") ?? "";
  const usesCustom = Boolean(customEmail || customPassword);
  const username = usesCustom ? customEmail : Deno.env.get("APPROVAL_SMTP_EMAIL")?.trim() ?? "";
  const password = usesCustom ? customPassword : Deno.env.get("APPROVAL_SMTP_APP_PASSWORD")?.replace(/\s/g, "") ?? "";
  if (!safeMail(username) || !password) return null;
  try { return { username, password, base: siteUrl(Deno.env.get("ADMIN_MAIL_SITE_URL")?.trim() || DEFAULT_SITE) }; }
  catch { return null; }
}

export default {
  fetch: withSupabase({ auth: "secret:admin_notification_worker" }, async (request, context): Promise<Response> => {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });

    const smtp = configuration();
    const admin = context.supabaseAdmin;
    const poll = await admin.rpc("space_admin_mail_poll", { p_sender_ready: !!smtp });
    if (poll.error) {
      console.error("Administrator email monitor could not record a poll");
      return Response.json({ error: "Monitor request failed" }, { status: 500 });
    }
    if (!smtp) {
      console.warn("Administrator email sender configuration is missing or invalid");
      return Response.json({ error: "Sender configuration not ready" }, { status: 503 });
    }
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: smtp.username, pass: smtp.password },
      connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 16000,
      disableUrlAccess: true, disableFileAccess: true,
      logger: false, debug: false,
    });

    let sent = 0, attention = 0;
    try {
      for (let n = 0; n < MAX_BATCH; n++) {
        const { data, error } = await admin.rpc("space_admin_mail_claim");
        if (error) {
          console.error("Administrator email claim failed");
          return Response.json({ error: "Queue could not be read" }, { status: 500 });
        }
        const claim = data as Claim | null;
        if (!claim) break;
        const args = { p_id: claim.id, p_token: claim.token };
        const started = await admin.rpc("space_admin_mail_start", args);
        if (started.error) {
          console.error("Administrator email dispatch could not start", claim.id);
          attention++;
          continue;
        }
        if (!started.data) continue;
        let result: { outcome: string; code: string | null };
        let mail: ReturnType<typeof messageFor> | undefined;
        try { mail = messageFor(started.data as Event, smtp.base); } catch { /* Fixed validation code below. */ }
        if (!mail) result = { outcome: "failed", code: "invalid_message" };
        else {
          const timeout = AbortSignal.timeout(22_000);
          try {
            const receipt = await transport.sendMail({
              ...mail, from: { name: "SPACE Administration", address: smtp.username },
              signal: timeout,
            });
            result = receipt.accepted.length === 1
              ? { outcome: "sent", code: null } : { outcome: "uncertain", code: "confirmation_missing" };
          } catch (error) {
            result = smtpFailure(error);
          }
        }
        const saved = await admin.rpc("space_admin_mail_finish", {
          ...args, p_outcome: result.outcome, p_code: result.code,
        });
        if (saved.error || saved.data !== true) {
          // Do not send again when acceptance could not be written back.
          console.error("Administrator email outcome not recorded", claim.id);
          attention++;
        } else if (result.outcome === "sent") sent++;
        else {
          console.warn("Administrator email delivery outcome", claim.id, result.outcome, result.code);
          attention++;
        }
      }
      return Response.json({ sent, attention });
    } finally {
      transport.close();
    }
  }),
};
