# Private shared glow in SPACE direct messages

## Activate and use

1. Apply every statement in `supabase/upgrade_shared_chat_glow.sql` in the existing Supabase project's SQL Editor. It is transactional and rerunnable. Do not copy a partial function. No secret or new Edge Function is required.
2. Refresh SPACE in two approved club accounts. For different accounts on one browser, open the second with `?account=separate`.
3. Open the same one-to-one conversation on both accounts. Choose **Draw together** on one and **Join drawing** on the other.
4. Choose **Draw mode** and draw inside the dashed square. The other person sees the same normalized strokes. Choose **Chat mode** to scroll, select and interact with messages normally. The message composer remains outside the drawing surface.
5. **Sparkle** works with keyboard, touch or mouse. **Clear glow** clears only drawings on both sides. **Done** ends shared drawing. Trails fade after 5.5 seconds (1.4 seconds without continuous fading for reduced motion/data saving). Nothing is added to conversation history.

An invitation is temporary and visible only while the friend has this conversation open; it is not a stored message, push notification or offline invitation. The waiting state explains that the friend must open the chat. Not now suppresses that invitation until a deliberate new one. Both participants must opt in before drawing is exchanged. Another idle tab cannot take over an active drawing session. Backgrounding/leaving the chat or signing out closes that tab's connection and clears private pixels. An abruptly disconnected friend expires after at most 24 seconds without a heartbeat. Returning requires joining again.

## Security and delivery limits

`club_glow_room(uuid)` returns only the caller/peer pair's canonical topic, server minute and remaining lease. Its security-definer functions use an empty search path and fully qualified tables/functions. The caller must be a participant, and both profiles must currently be approved with a member, teacher, founder or administrator role. Investors, pending/rejected/suspended accounts and self-pairs are excluded. No profile field is returned. The anonymous topic helper returns false before looking up profiles; anonymous callers cannot execute the room RPC.

The client joins with `private:true`, Broadcast ACKs and self echo off. It sends only after SUBSCRIBED, over the socket, and never falls back to a public channel or unjoined HTTP broadcast. Fixed protocol fields, exact peer ID, bounded normalized points, colors, session IDs, monotonic sequence numbers, retired-session suppression and a receiver rate cap reject malformed/stale traffic. A failed subscription or delivery ACK pauses drawing and leaves messages available. A successful ACK confirms Realtime acceptance, not proof that a person saw a drawing.

The migration manages only its own policies on the Supabase-owned `realtime.messages` table; it does not alter that table's RLS/grants/ownership or create schema objects there. SELECT authorizes receiving and INSERT authorizes sending Broadcast. Restrictive namespace guards also apply to anonymous access, prevent broad permissive policies from opening `space-glow:` traffic, require the row topic to match its authorized context, and leave unrelated topic policies intact. Do not change the global public-channel switch: the rest of the app retains its existing subscriptions. Supabase separates private and public channels with identical names.

Realtime caches authorization for an established channel. To bound stale authorization, room topics use the current server minute, future/old minutes cannot be newly authorized, and the client conservatively closes before its lease expires and reauthorizes. Lease rotation clears transient strokes and renews the pair handshake. Revocation is not instantaneous: an already-authorized connection may keep its cached permissions, while compliant peers leave that old topic within approximately one minute. This is ephemeral visual collaboration, not a durable or cryptographically signed message system. Broadcast is not end-to-end encrypted.

No drawing rows, uploaded files, localStorage/sessionStorage entries, exported images or offline cached drawings are created by this feature. The supplied React Bits GlowCursor is used as a visual reference; `shared-chat-glow.js` is a buildless Canvas2D implementation, not the full fluid WebGL shader. It adds no external dependency. Existing animated wallpaper is held while sharing and resumes its previous preference afterwards.

## Resource budgets

- No canvas before mutual opt-in; no ambient pointer tracking or local-only hover broadcasting.
- Batches at most every 125 ms, with at most 12 normalized points per packet, at most four queued strokes and 48 pending points per stroke. Old temporary points are coalesced/dropped rather than retried or replayed.
- One on-demand Canvas loop: at most 24 fps / 250,000 pixels on desktop or 18 fps / 120,000 pixels on narrow screens. At most 360 stored trail segments and 32 stroke tails; the loop stops when trails expire. Reduced motion and data saving redraw short static trails only as necessary.
- At most 24 accepted peer packets per second. One private channel only for the currently open DM, one room reauthorization per minute, and an 8-second heartbeat only while inviting or sharing. Idle DM conversations do not send recurring presence traffic. Realtime messages/connections still count toward the project's plan limits; simultaneous-member capacity has not been benchmarked for drawing.

## Verification

Run:

```sh
node scripts/check_shared_chat_glow.mjs
node scripts/check_chat_waves.mjs
SPACE_PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite node scripts/check_shared_glow_database.mjs
```

The dedicated database workflow installs a pinned isolated PostgreSQL engine. Its synthetic identities exercise SQL/RLS twice, all roles and statuses, direct row access, row/context mismatches, malformed/current/expired/future topics, old broad policies, anonymous access, unrelated namespaces and access revocation. Controller tests exercise the real handshake in both directions, consent/decline/Done, sender validation, replay/flood limits, batches, private subscription failures, sign-out races, peer changes, lease rotation, ACK timeout, resource budgets and normal-message preservation. Main frontend checks also cover the surrounding chat/platform features.

Before calling live delivery verified, use a phone and laptop with separate approved accounts:

| Check | Expected result |
| --- | --- |
| Invite without joining | Friend sees Join / Not now; no drawing appears before joining. |
| Draw on each device | Both see each other's trails in the same square proportions. |
| Chat mode | Scroll, select text, open message images, reply, type/send and read receipts continue normally. |
| Color, Sparkle, Clear, Done | Same shared visual outcome; clearing never removes a message; Done ends both views. |
| Leave/background/sign out | Local canvas/connection removed; peer stops sharing after its heartbeat expires. |
| Rotation, reconnect and poor connection | Safe waiting/rejoin/error state; no public fallback or replayed strokes. |
| Unrelated/pending/investor account | Cannot receive/send another pair's private drawing. |
| Reduced motion / data saving | Explicit drawing remains usable with short static trails. |
| Device performance | No overflow or clipped composer; acceptable frame rate while drawing; idle stops rendering. |

Browser preview is unavailable in this environment, so physical-device appearance, actual GPU/Canvas speed and live Supabase two-account delivery have not been verified here. Staging and backup work remain on hold separately.

Primary references: [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization), [Broadcast](https://supabase.com/docs/guides/realtime/broadcast), [public/private channel separation](https://supabase.com/docs/guides/realtime/concepts).
