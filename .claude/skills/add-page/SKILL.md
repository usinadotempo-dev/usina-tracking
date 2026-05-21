---
name: add-page
description: Add a new lead form page or sales page to this tracking stack. Use when the recipient says "add a lead page", "add a sales page", "create a landing page", "I need another form", "new offer page", or asks to wire up a page for capturing leads or driving a sales-platform checkout. Copies the right starter from examples/, wires it into Cloudflare Pages routing, reads the corresponding recipe in docs/page-types/ and (for sales pages) the target platform's doc in docs/platforms/, and runs a local smoke test.
---

# Skill: add-page

The recipient wants to add a page to their deployed stack. There are
exactly two page types — lead form and sales page — and each has one
canonical recipe. This skill's job is to pick the right recipe, copy it
into the recipient's repo, wire the minimum per-page configuration, and
confirm it works before letting the recipient edit the content.

## Step 1 — Identify the page type

Ask the recipient:

> Is this a **lead form** (capture an email/phone, fire a Lead event) or a
> **sales page** (show an offer, send the buyer to a checkout URL)?

If they're not sure, read them the short version:

- **Lead form** = the visitor gives you their contact details and you get
  nothing else. Example: "free ebook download". Fires a `Lead` event.
- **Sales page** = the visitor clicks a CTA that takes them to a
  sales-platform checkout (Eduzz / Hotmart / Kiwify) where they pay.
  Fires `InitiateCheckout` on click and (later) a `Purchase` event from
  the webhook handler.

If they want both on the same page (capture leads AND sell), pick sales
page — it's the more capable recipe. Hint that you can add a lead form
block inside it afterwards.

## Step 2 — Pick the target path

Ask:

> What URL path should this page live at? E.g. `/black-friday`,
> `/free-guide`, `/offer-2`.

Rules:

- Must not start with `/api/`, `/webhook/`, `/dash`, or `/tracker` —
  those bypass middleware and break attribution. If the recipient
  suggests one of those, explain why and ask for another.
- Should be a short, memorable path that fits in a Meta ad URL.
- Lowercase, dashes between words, no query strings.

The file will live at `<path>/index.html` so the page is served without
a trailing extension.

## Step 3 — Copy the starter

**For a lead form**:
```bash
mkdir -p <path>
cp examples/lead-form-page/index.html <path>/index.html
```

**For a sales page** (ships with an `assets/hero.webp` placeholder
image — copy the whole folder so the hero image comes along):
```bash
mkdir -p <path>
cp -R examples/sales-page/. <path>/
```

## Step 4 — Read the matching recipe

Before editing, read the right docs into context so the edits follow the
established pattern:

- Lead form: read [docs/page-types/lead-form-page.md](../../../docs/page-types/lead-form-page.md).
- Sales page: read [docs/page-types/sales-page.md](../../../docs/page-types/sales-page.md)
  AND the target platform doc:
  - Eduzz → [docs/platforms/eduzz.md](../../../docs/platforms/eduzz.md)
  - Hotmart → [docs/platforms/hotmart.md](../../../docs/platforms/hotmart.md)
  - Kiwify → [docs/platforms/kiwify.md](../../../docs/platforms/kiwify.md)

If the recipient uses a platform NOT in Eduzz/Hotmart/Kiwify, pause and
tell them to run the `add-sales-platform` skill first — then come back
to this one.

## Step 5 — Per-page configuration

**There are no tracking IDs to edit in the page.** Every starter loads the
shared `/track.js`, which resolves the workspace from the request Host and
pulls the Meta Pixel / GA4 / Google Ads IDs from that workspace's config.
The old `YOUR_META_PIXEL_ID` / `G-XXXXXXXXXX` placeholders no longer exist.

Two things this depends on — confirm both before going live:

- **The page's domain must be mapped to the right workspace.** `track.js`
  resolves the workspace by Host; if the domain isn't in `workspace_domains`
  tracking lands on the wrong workspace (or the Usina fallback). Check
  admin → workspace → Domínios.
- **The workspace owns the tracking config**, not the page — Meta Pixel,
  GA4, Google Ads credentials and the event catalog are all set per
  workspace in `/admin`. If they're missing, the page loads but fires
  nothing: fix the workspace, not the page.

**Lead form** — nothing tracking-related to edit. Just the offer content
(`<h1>`, copy). On submit the page calls `USINATRK.track('Lead', { em: email })`.

**Sales page** — edit only the checkout values in the `<script>` block at
the bottom:
- `CHECKOUT_URL` → the sales platform's real checkout URL
- `CHECKOUT_PLATFORM` → `'eduzz'` | `'hotmart'` | `'kiwify'`
- Swap the `assets/hero.webp` placeholder image (same filename, or edit the
  two references — `<link rel="preload">` and `<img src>`).

Do NOT change any other code unless the recipient explicitly asks and you've
re-read the recipe doc. The starter scripts are deliberately minimal.

### Custom events

If the page fires an event beyond the seeded Lead / Schedule / MeetingHeld /
Purchase — e.g. `USINATRK.track('ContactWhatsApp', {...})` — that event name
must exist in the workspace's **event catalog** (admin → workspace → Catálogo
de eventos). Without a catalog entry the event still reaches Meta, but won't
fan out to Google Ads and won't carry a value / funnel position.

### Lead form: optionally collect phone and/or name

The starter is **email-only by default** — `USINATRK.track('Lead', { em: email })`
on submit. Lowest friction.

Ask whether the recipient wants to also collect phone and/or name (both boost
Meta Advanced Matching at the cost of a longer form):

- **Email + phone** (WhatsApp funnels): add `<input type="tel" id="phone">`,
  read it on submit, and pass `{ em: email, ph: phone }`.
- **Email + phone + name**: also add `<input type="text" id="name">`, split
  the value on whitespace, and pass
  `{ em: email, fn: firstName, ln: lastName, ph: phone }`.

Keep the key names exact: `em`, `fn`, `ln`, `ph`. Never invent new keys.

### Sales page: edit the offer content

The recipient will want to edit the headline, subhead, price display and
bullet points — marked with placeholder copy in the starter. Let them do it;
don't do it for them unless they ask.

## Step 6 — Deploy and verify

Deploy by committing and pushing to the GitHub repo wired up during
`deploy-stack` — Cloudflare Pages auto-builds on every push to `main`:

```bash
git add <path>/
git commit -m "Add <page-type> at /<path>"
git push
```

Cloudflare's dashboard → Pages project → **Deployments** shows the
build; give it ~1-2 minutes to turn green. If the recipient hasn't set
up the git+Pages connection yet, stop and run `deploy-stack` first.

Then run the smoke test that matches the page type.

### Lead form smoke test

1. Open `https://<pages-domain>/<path>?utm_source=test_claude` in a browser.
2. DevTools → Network: confirm `/track.js` loaded (200). DevTools →
   Application → Cookies: confirm `_krob_sid` is set.
3. Submit the form with a test email (`claude-test@example.com` is fine).
4. DevTools → Network: `/tracker` should return 200 with `{"ok": true}`.
5. Query D1:
   ```
   wrangler d1 execute <db-name> --remote --command \
     "SELECT event_name, raw_email, timestamp FROM event_log WHERE raw_email = 'claude-test@example.com' ORDER BY id DESC LIMIT 1"
   ```
6. Open `https://<pages-domain>/dash?key=<DASH_KEY>`, go to the Leads
   tab, confirm the test row shows `utm_source = test_claude`.

If any step fails, go to [docs/data-flow.md](../../../docs/data-flow.md)
Hop 1 and walk forward until you find the break.

### Sales page smoke test

1. Open `https://<pages-domain>/<path>?utm_source=test_claude` in a browser.
2. Cookies check: `_krob_sid` and `_fbp` should be set.
3. DevTools → Network: `/checkout-session` should return 200 on page
   load.
4. Query D1 to confirm the row:
   ```
   wrangler d1 execute <db-name> --remote --command \
     "SELECT trk, utm_source, fbp FROM checkout_sessions ORDER BY created_at DESC LIMIT 1"
   ```
5. Click the **price-card CTA specifically** — the button with
   `id="checkout-btn"` inside the `.price-card` block. The hero and
   final-section CTAs are scroll-to-`#preco` anchors and intentionally
   do NOT fire `InitiateCheckout` or rewrite the URL; only the price
   card is wired to the checkout flow. The destination URL after the
   click should contain `?<paramName>=<uuid>` where `<paramName>`
   matches the platform (`trk` for Eduzz, `xcod` for Hotmart, `sck`
   for Kiwify) and `<uuid>` matches the `trk` value from step 4.
6. Tell the recipient to run one real test purchase (ideally via a
   100%-off coupon) to confirm the webhook chain. After the purchase,
   re-query:
   ```
   wrangler d1 execute <db-name> --remote --command \
     "SELECT trk, transaction_id, utm_source, meta_response_ok, ga4_response_ok FROM purchase_log ORDER BY created_at DESC LIMIT 1"
   ```
   Confirm `utm_source = test_claude` and `meta_response_ok = 1`.

## Step 7 — Tell the recipient what to do next

After the smoke test passes:

- **The page is live**. They can edit the copy/content directly in the
  `.html` file and redeploy with `git add . && git commit -m "..." && git push`
  — Cloudflare auto-redeploys on every push to `main`.
- **Ad URLs should always include UTMs.** A Meta ad without
  `?utm_source=facebook&utm_medium=paid&utm_campaign=…` will land in
  the dashboard as "(empty)" — the middleware captures what's in the
  URL, nothing more.
- **If they want a second lead form on the same page** or a second
  sales platform, tell them to call this skill again or (for a new
  platform) run `add-sales-platform`.

## When to stop and ask

Stop and ask the recipient if:

- They want features the starter doesn't support (quiz flows, multi-step
  forms, A/B variants, country redirects). Don't pattern-match and
  write them yourself — ask what exactly they need.
- The chosen path conflicts with an existing file.
- The smoke test fails at a step you can't explain with the Data Flow
  doc. Don't guess — surface the D1 row and the browser network trace
  to the recipient and walk them through triaging together.
