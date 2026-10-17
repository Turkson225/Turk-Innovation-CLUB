# SPACE Map and Avatar Studio

## Activate

Run **all** of `supabase/upgrade_space_map_avatars.sql` in the existing Supabase project's **SQL Editor → New query → Run**, after the existing profile privacy migration. Refresh SPACE. This is separate from the shared-chat-glow migration. No new secret, bucket, Edge Function, global Realtime setting or GPS service key is needed.

Use **Community → Avatar studio / SPACE Map**, **Accounts**, the Members header, or **More** on phones. A link from your own profile opens the wardrobe. The existing profile photo and member ID remain available. Missing database setup allows outfit previews, with saving/sharing disabled and a direct migration link. Optional background avatar loading does not block sign-in.

## Dress your character

The avatar artwork is original, illustrated SVG made from fixed local parts, with no external avatar account, image-generation service or photo processing. The editor has four tabs, keyboard arrow navigation, immediate previews, 24 outfit presets in club/casual/lab/sports/formal collections, Surprise outfit, reset, and eight named saved-look slots. Loading a saved look previews it; Save avatar applies it. Saving into an occupied look slot replaces that slot.

The revised renderer uses softly shaded, semi-realistic illustrated faces, eyelids and irises, textured hair, natural body proportions, layered clothing and detailed hands/footwear. **Full look / Face detail** changes only the studio preview; it does not save a draft or add an avatar preference. Portraits are square and omit off-frame limbs. Fixed local SVG materials require no network request, 3D runtime, animation loop or external face service. All existing numeric settings and saved looks render in the new style automatically; no additional SQL migration is needed for this artwork upgrade. Paint IDs are deterministic per style so different avatars in the same page cannot borrow one another's colors.

Choices include eight skin tones, twelve hairstyles, eight hair colors, four eye styles, four expressions, four facial-hair choices, four glasses choices, six headwear options, twelve tops, five bottoms, five footwear styles, twelve clothing colors, six accessories, four poses and eight backdrops. Lab coats, hard hats, safety vests, overalls, laptops, robots, tools, club T-shirts and formal wear keep it connected to the club. Presets change clothing and preserve personal appearance choices.

Check **Use on my profile and in chats** and/or **Use on my member ID**, then save. Other members receive only approved, visible profiles' opted-in avatar settings in batches of at most 24. Private profile avatars remain owner-only through that route. The original photo is preserved and remains accessible through the existing profile-photo controls. The personal ID paints the chosen avatar through a private data SVG image; its existing canvas/3D cleanup still applies. Map sharing explicitly includes the saved illustrated avatar, regardless of the profile-thumbnail preference.

Avatar settings contain only a fixed version and 17 bounded numeric choices. SQL and client validation reject unrecognized fields and values; no arbitrary URLs, SVG, scripts or styling are accepted. Saved-look labels are escaped as text. Raw avatar tables are not directly readable/writable by authenticated accounts; owner RPCs provide settings/looks, and a separate visibility-filtered batch RPC provides profile thumbnails. None of these settings includes location, email, application answers or original photos.

## Share location deliberately

Opening SPACE Map does **not** request GPS or publish a position. The map initially shows a Ghana overview and fits authorized positions/club places when available. Pan, zoom, use All / People / Places, Show all, My shared position, or the accessible list. Tapping a character shows its name, precision and update time, plus Message / View profile when permitted. Updated time is a position timestamp, not online presence. No demonstration members or invented locations are seeded.

Choose up to 50 approved members, choose **Approximate · ~1 km grid** or **Precise**, select 15 minutes / one hour / two hours, then press **Start sharing** and grant browser location permission. Approximate is the default; coordinates are rounded to two decimal degrees before uploading and rounded again on the server. This is a roughly kilometre-sized grid, not city-only anonymity; the displayed circle is at least 1,600 metres and can be larger with a poor GPS fix. Precise accuracy depends on the device. A location is user/device supplied, not independently verified.

Only selected, currently approved club accounts can retrieve the position. Platform administrators and founders have no override. Investors and unapproved accounts cannot use the feature. A private-profile member can deliberately share a position/avatar with selected members; the map still labels them Private member and does not reveal their hidden profile name or open that profile. Direct messages retain their normal access rules. Location sharing does not send invitations, automatic DMs, push notices or proximity alerts.

Updates run only while **SPACE Map is open and visible**. Watch uploads are coalesced to no more than one every 15 seconds, with a server-side 10-second update throttle. Leaving, hiding, refreshing or signing out clears this tab's watch, pending points and map DOM. **The last uploaded position can remain shared until its chosen expiry or Stop sharing.** Returning displays the sharing state but requires **Resume updates on this device** to restart GPS. Browsing/refreshing the map never silently restarts a watcher.

**Stop sharing · Ghost mode** deletes the account's sharing row and recipients. Old watch callbacks cannot recreate it: updates require the current owner and exact session token, and never extend expiry. Replacing a sharing session creates a new token and replaces all recipients atomically. Polls detect another tab's changed/removed session without automatically starting GPS. If a start request is still in flight when you leave, a successful late reply is stopped by its specific token when the same account is still available. If a write times out, Refresh checks the actual server state; a timeout does not prove a write failed.

The server filters expiry and approval on every map read. Displayed positions also have a local expiry timer using the server clock offset. Already delivered positions cannot be recalled from another person's memory or screenshots; active map views refresh about every 15 seconds and clear their list on a query error. An account's explicit stop can take that polling interval to disappear from another already-open view. Closing/locking the browser is not a reliable background GPS mechanism; no background tracking is implemented.

Only one latest point per account is stored; there is no trail/history table. Expired rows immediately become unreadable through RPCs and are physically removed, with cascading recipient removal, in bounded batches on subsequent map requests. No new Cron job is required. If nobody uses the map, expired database rows may remain until the next map request; expiry does not depend on that cleanup. Project/database operators retain their usual privileged Supabase access; platform role permissions do not remove a database owner's access.

## Club places and map provider

Approved platform administrators can add/edit/delete workshop, event and meetup pins. Fill coordinates or use **Pick this place on the map**; an optional event time hides the pin a day after its start. A dated pin is a location note, not a separate calendar event, RSVP or attendance record. Venue data is visible to approved club accounts. Existing event/calendar workflows remain unchanged.

Leaflet **1.9.4** is vendored locally, loaded only when the map opens, with its BSD 2-Clause license and accompanying CSS/images in `vendor/leaflet/`. Release JS/CSS hashes were checked against the official download page. No native app, geocoding service, new frontend framework or map SDK account is added.

The default basemap is `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, with visible attribution, a valid browser referrer, normal HTTP caching, modest tile buffer, and no bulk/offline prefetch. The service worker ignores cross-origin requests and does not cache private map/avatar data or these modules. Map names, avatar choices, member IDs and exact coordinate payloads are not sent to the tile server; the requested tile area can reveal the viewed region. Tile failures keep the authorized people/places list available, with an explicit Refresh retry.

OpenStreetMap's donated tile service is best effort, not a guaranteed production hosting plan. Before substantial traffic, select a suitable tile provider or self-hosted service. The existing public config can optionally set `mapTiles: {url: 'https://provider.example/{z}/{x}/{y}.png', attribution: 'Required provider attribution'}`. Provider keys in browser config must be publishable/restricted keys. Changing a tile provider does not change location permissions. No live tile capacity or simultaneous-member throughput benchmark has been performed for this feature.

## Verification and acceptance

Automated checks:

```sh
node scripts/check_space_map_avatars.mjs
SPACE_PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite node scripts/check_space_map_database.mjs
```

The dedicated database workflow installs pinned PGlite 0.3.14. Tests use 2,000 synthetic profile records, all roles/statuses, no raw-table access, recipient searches beyond 1,000 total rows, private-profile behavior, server-side rounding, expiry, stale tokens, update throttling, complete point pages beyond 100, antimeridian bounds, cross-account wardrobe isolation and administrator-only venue mutations. UI tests run actual controller code with browser/GPS/Leaflet doubles, covering consent, no automatic GPS, changing accounts, late requests, timeouts, visibility, watch ID zero, expiry, other-tab stop, tile retry, safe labels, outfits, saved looks, ID imagery and packaging. All 24 original SVG outfit presets were parsed/rasterized and visually inspected as artwork.

Browser preview is unavailable in this environment. The tests do not prove actual device GPS, phone layout, Leaflet rendering or frame rate. After applying the migration, complete this real-device check:

| Action | Expected result |
| --- | --- |
| Open map in two separate approved accounts | No permission prompt or member location until explicit sharing. |
| A selects B, starts approximate sharing | Only B and A see A's rounded location and saved character; an unselected admin sees neither. |
| Grant/deny GPS; change precise/duration | Clear permission/result state; selected mode and expiry respected. |
| Stop sharing in A's other tab | GPS pauses and B's view removes the point on its next refresh. |
| Background/lock/leave map | Updates pause; reopening requires Resume; existing expiry remains. |
| Wait for expiry | Point disappears; an old watcher cannot resurrect it. |
| Save, reload, change or delete a look | Choices persist only for that account; profile and ID respect opt-in flags. |
| Pin/edit/delete a venue as admin | Approved members see its changes; member/teacher/founder cannot mutate it. |
| Small phone, landscape, dark theme, keyboard, poor network | Controls, map attribution, forms and lists remain usable; no page overflow. |

References: [Leaflet distribution](https://leafletjs.com/download.html), [Leaflet reference](https://leafletjs.com/reference.html), [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/), [browser geolocation](https://www.w3.org/TR/geolocation/), [Supabase request cancellation](https://supabase.com/docs/reference/javascript/using-modifiers-abortsignal).
