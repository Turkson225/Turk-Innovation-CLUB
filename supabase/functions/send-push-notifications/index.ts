// GET exposes only the VAPID public key; POST is called only by Supabase Cron
// using the secret API key named push_notification_worker. Do not call POST
// from the website and never store the VAPID private key in Git or the browser.
import { withSupabase } from "npm:@supabase/server@^1";
import {
  buildPushPayload,
  type PushSubscription,
  type VapidKeys,
} from "npm:@block65/webcrypto-web-push@2.0.0";

type PushJob = {
  id: string;
  notification_id: string;
  subscription_id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  kind: string;
  target_type: string;
  claim_token: string;
};

const MAX_BATCH = 12;
const SEND_TIMEOUT_MS = 12_000;
const PUBLIC_CORS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };

function vapidConfig(): VapidKeys | null {
  const publicKey = Deno.env.get("PUSH_VAPID_PUBLIC_KEY")?.trim() ?? "";
  const privateKey = Deno.env.get("PUSH_VAPID_PRIVATE_KEY")?.trim() ?? "";
  const subject = Deno.env.get("PUSH_VAPID_SUBJECT")?.trim()
    || "https://turkson225.github.io/Turk-Innovation-CLUB/";
  if (!/^B[A-Za-z0-9_-]{86}$/.test(publicKey)
      || !/^[A-Za-z0-9_-]{43}$/.test(privateKey)
      || !/^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/[^\s]+)$/.test(subject)) {
    return null;
  }
  return { subject, publicKey, privateKey };
}

function trustedEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !url.pathname) {
      return false;
    }
    const host = url.hostname.toLowerCase();
    return host === "fcm.googleapis.com"
      || host === "updates.push.services.mozilla.com"
      || host === "push.services.mozilla.com"
      || /^(?:[a-z0-9-]+\.)+push\.apple\.com$/.test(host)
      || /^(?:[a-z0-9-]+\.)+notify\.windows\.com$/.test(host);
  } catch {
    return false;
  }
}

function pushData(job: PushJob): string {
  const isDirect = job.kind === "direct_message";
  const inChannel = (job.kind === "reply" || job.kind === "mention")
    && job.target_type === "channel";
  return JSON.stringify({
    id: job.notification_id,
    kind: isDirect || inChannel ? "message" : "notification",
    url: isDirect ? "#messages" : inChannel ? "#channels" : "#notifications",
  });
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : "Delivery error").slice(0, 200);
}

const workerFetch = withSupabase({ auth: "secret:push_notification_worker" },
  async (request, context): Promise<Response> => {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const vapid = vapidConfig();
    if (!vapid) {
      console.error("Push VAPID secrets are not configured");
      return Response.json({ error: "Push sender is not configured" }, { status: 503 });
    }

    const admin = context.supabaseAdmin;
    const { data: jobs, error: claimError } = await admin.rpc("claim_push_jobs", {
      p_limit: MAX_BATCH,
    });
    if (claimError) {
      console.error("Could not claim push jobs:", claimError.message);
      return Response.json({ error: "Could not claim push jobs" }, { status: 500 });
    }

    const totals = { claimed: (jobs ?? []).length, sent: 0, retry: 0, failed: 0,
      gone: 0, skipped: 0, unrecorded: 0 };
    const batch = (jobs ?? []) as PushJob[];
    // Cap concurrent provider calls and keep the Cron invocation below its
    // timeout even if one push service is slow.
    for (let index = 0; index < batch.length; index += 4) {
      await Promise.all(batch.slice(index, index + 4).map(async (job) => {
      let outcome: "sent" | "retry" | "failed" | "gone" = "failed";
      let detail: string | null = null;
      try {
        if (!trustedEndpoint(job.endpoint)) {
          detail = "Unsupported push endpoint host";
        } else {
          // A membership may be suspended, or an alert read, after the claim.
          const [{ data: profile, error: profileError },
            { data: notification, error: noticeError }] = await Promise.all([
            admin.from("profiles").select("membership_status,role")
              .eq("id", job.user_id).single(),
            admin.from("notifications").select("user_id,kind,read_at")
              .eq("id", job.notification_id).single(),
          ]);
          if (profileError || noticeError) throw profileError ?? noticeError;
          if (profile?.membership_status !== "approved"
              || !["member", "teacher", "founder", "admin"].includes(profile.role)
              || notification?.user_id !== job.user_id
              || notification.read_at
              || (notification.kind === "application" && profile.role !== "admin")) {
            detail = "Recipient is no longer eligible or alert has been read";
            totals.skipped++;
          } else {
            const subscription: PushSubscription = {
              endpoint: job.endpoint,
              expirationTime: null,
              keys: { p256dh: job.p256dh, auth: job.auth },
            };
            const payload = await buildPushPayload({
              data: pushData(job), options: { ttl: 60 * 60 },
            }, subscription, vapid);
            const response = await fetch(job.endpoint, {
              ...payload,
              redirect: "error", // Never forward VAPID headers to another host.
              signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
            });
            if (response.ok) outcome = "sent";
            else if (response.status === 404 || response.status === 410) {
              outcome = "gone";
              detail = `Push provider returned ${response.status}`;
            } else if (response.status === 429 || response.status >= 500) {
              outcome = "retry";
              detail = `Push provider returned ${response.status}`;
            } else {
              detail = `Push provider returned ${response.status}`;
            }
          }
        }
      } catch (error) {
        outcome = "retry";
        detail = errorText(error);
        console.error("Push delivery failed:", job.id, detail);
      }

      const { data: recorded, error: finishError } = await admin.rpc("finish_push_job", {
        p_id: job.id,
        p_claim_token: job.claim_token,
        p_outcome: outcome,
        p_error: detail,
      });
      if (finishError || !recorded) {
        console.error("Could not record push result:", job.id,
          finishError?.message ?? "claim no longer owned");
        totals.unrecorded++;
      }
      totals[outcome]++;
      }));
    }
    return Response.json(totals);
  });

export default {
  fetch(request: Request): Promise<Response> | Response {
    if (request.method === "GET") {
      return Response.json({ vapid_public_key: vapidConfig()?.publicKey ?? "" },
        { headers: PUBLIC_CORS });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204,
        headers: { ...PUBLIC_CORS, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
    }
    return workerFetch(request);
  },
};
