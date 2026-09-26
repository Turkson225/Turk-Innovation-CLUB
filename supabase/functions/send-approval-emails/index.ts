// Invoked by a Supabase Cron job using a secret API key. Never call this from
// the public website. The database, not a request body, decides who receives mail.
// The migration upgrade_approval_emails.sql provides the two service-only RPCs.
import { withSupabase } from "npm:@supabase/server@^1";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

type ApprovalJob = {
  id: string;
  user_id: string;
  recipient_email: string;
  applicant_name: string;
  application_type: string;
  claim_token: string;
};

const SITE_URL = "https://turkson225.github.io/Turk-Innovation-CLUB/";
const MAX_BATCH = 5;
const SEND_TIMEOUT_MS = 20_000;
const CLOSE_TIMEOUT_MS = 3_000;

const roleContent: Record<string, { title: string; next: string; path: string }> = {
  member: {
    title: "Member",
    next: "Explore practical courses, share your projects and join the club discussions.",
    path: "#home",
  },
  teacher: {
    title: "Teacher",
    next: "Open the Teaching studio to share practical learning materials, lessons and slides.",
    path: "#teaching",
  },
  founder: {
    title: "Founder",
    next: "Visit the Founder room to join planning discussions and upcoming meetings.",
    path: "#founder-room",
  },
  investor: {
    title: "Investor",
    next: "Visit the Investor portal for project updates and your private inquiries.",
    path: "#investor-portal",
  },
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

function emailFor(job: ApprovalJob) {
  const role = roleContent[job.application_type];
  if (!role) throw new Error("Unsupported approved role");

  const name = job.applicant_name.replace(/[\r\n\t]/g, " ").trim().slice(0, 100) || "there";
  const href = SITE_URL + role.path;
  const subject = `Your InnovateX ${role.title.toLowerCase()} account is approved`;
  const text = `Hi ${name},\n\nGood news! The InnovateX Engineering Club administrator approved your ${role.title.toLowerCase()} account. You can now sign in using your email and one-time code.\n\n${role.next}\n\nOpen the club platform: ${href}\n\nWelcome to InnovateX Engineering Club!\n\nIf you did not apply, please reply to this email to let us know.`;
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#eff4f8;font-family:Arial,Helvetica,sans-serif;color:#172b3a">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #d8e5e9;border-radius:18px">
        <tr><td style="padding:28px 32px 12px">
          <p style="margin:0;font-size:13px;font-weight:800;letter-spacing:2px;color:#0b827b">INNOVATEX · ENGINEERING CLUB</p>
          <h1 style="font-size:27px;line-height:1.25;margin:24px 0 12px;color:#153047">Your account is approved</h1>
          <p style="font-size:16px;line-height:1.65;margin:0 0 16px">Hi ${escapeHtml(name)},</p>
          <p style="font-size:16px;line-height:1.65;margin:0 0 16px">Good news! The club administrator approved your <strong>${escapeHtml(role.title.toLowerCase())}</strong> account. You can now sign in using your email and one-time code.</p>
          <p style="font-size:16px;line-height:1.65;margin:0 0 24px">${escapeHtml(role.next)}</p>
          <a href="${href}" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#087e77;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700">Open the club platform</a>
          <p style="font-size:16px;line-height:1.65;margin:26px 0 8px">Welcome to InnovateX Engineering Club!</p>
        </td></tr>
        <tr><td style="padding:18px 32px 28px;color:#587080;font-size:13px;line-height:1.6;border-top:1px solid #e7eef0">
          If you did not apply, please reply to this email to let us know.<br>
          <a href="${SITE_URL}" style="color:#087e77">InnovateX Engineering Club</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, text, html };
}

function configuredSmtp() {
  const username = Deno.env.get("APPROVAL_SMTP_EMAIL")?.trim() ?? "";
  const password = Deno.env.get("APPROVAL_SMTP_APP_PASSWORD")?.replace(/\s/g, "") ?? "";
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(username) || !password) return null;
  return { username, password };
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown delivery error").slice(0, 500);
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("SMTP operation timed out")), milliseconds);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function send(job: ApprovalJob, smtp: NonNullable<ReturnType<typeof configuredSmtp>>) {
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(job.recipient_email)) {
    throw new Error("Invalid destination email");
  }
  const { subject, text, html } = emailFor(job);
  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username: smtp.username, password: smtp.password },
    },
    client: { warning: "error" },
    debug: { log: false, allowUnsecure: false },
  });
  try {
    await withTimeout(client.send({
      from: `InnovateX Engineering Club <${smtp.username}>`,
      to: job.recipient_email,
      subject,
      content: text,
      html,
    }), SEND_TIMEOUT_MS);
  } finally {
    try {
      await withTimeout(client.close(), CLOSE_TIMEOUT_MS);
    } catch (closeError) {
      console.warn("SMTP connection close failed:", errorText(closeError));
    }
  }
}

export default {
  fetch: withSupabase({ auth: "secret:approval_email_worker" }, async (request, context): Promise<Response> => {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const smtp = configuredSmtp();
    if (!smtp) {
      console.error("Approval SMTP secrets are not configured");
      return Response.json({ error: "Email sender is not configured" }, { status: 503 });
    }

    const admin = context.supabaseAdmin;
    const { data: jobs, error: claimError } = await admin.rpc("claim_approval_email_jobs", {
      p_limit: MAX_BATCH,
    });
    if (claimError) {
      console.error("Could not claim approval email jobs:", claimError.message);
      return Response.json({ error: "Could not claim email jobs" }, { status: 500 });
    }

    let sent = 0;
    let failed = 0;
    let unrecorded = 0;
    for (const job of (jobs ?? []) as ApprovalJob[]) {
      let delivered = false;
      try {
        // An account may be suspended between approval and the scheduled send.
        const { data: profile, error: profileError } = await admin
          .from("profiles")
          .select("membership_status,role")
          .eq("id", job.user_id)
          .single();
        if (profileError) throw profileError;
        if (profile?.membership_status !== "approved" || profile.role !== job.application_type) {
          throw new Error("Account is no longer approved in the queued role");
        }

        await send(job, smtp);
        delivered = true;
        const { error } = await admin.rpc("finish_approval_email_job", {
          p_id: job.id,
          p_claim_token: job.claim_token,
          p_success: true,
          p_provider_message_id: null,
          p_error: null,
        });
        if (error) throw error;
        sent++;
      } catch (error) {
        console.error("Approval email job failed:", job.id, errorText(error));
        if (delivered) {
          // SMTP may have delivered the email, so a retry could send a duplicate.
          // This count makes the ambiguous outcome visible in the function logs.
          unrecorded++;
          continue;
        }
        const { error: finishError } = await admin.rpc("finish_approval_email_job", {
          p_id: job.id,
          p_claim_token: job.claim_token,
          p_success: false,
          p_provider_message_id: null,
          p_error: errorText(error),
        });
        if (finishError) {
          console.error("Could not record email failure:", job.id, finishError.message);
          unrecorded++;
        }
        failed++;
      }
    }
    return Response.json({ claimed: (jobs ?? []).length, sent, failed, unrecorded });
  }),
};
