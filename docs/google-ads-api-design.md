# Usina Tracking — Google Ads API Tool Design Document

**Company:** Usina do Tempo (performance-marketing agency, Brazil)
**Website:** https://lp.usinadotempo.com.br · https://usinadotempo.com.br
**Manager (MCC) account:** 196-120-9260
**API contact:** suporte@usinadotempo.com.br
**Document version:** 1.0 — 2026-05-16

## 1. Purpose

Usina Tracking is an **internal, in-house** server-side tracking tool used
only by Usina do Tempo's own staff. Its single Google Ads API use case is
**uploading click conversions** (offline/enhanced click conversions keyed by
`gclid`) so that Google Ads Smart Bidding optimizes on real conversions that
client-side browser tags miss due to ad blockers and browser tracking
prevention (Safari ITP, Firefox ETP).

The tool does **not** create, modify, pause, or budget campaigns, ad groups,
ads, keywords, or bids. It performs **conversion upload** and, optionally,
**read-only reporting** for conversion diagnostics. It is not a product
distributed or sold to third-party advertisers; clients never authenticate
to or operate the tool.

## 2. Accounts in scope

- Usina do Tempo's own Google Ads account (lead generation for the agency).
- Client Google Ads accounts managed under Usina's MCC (196-120-9260).
- Occasionally, an independent client account not under the MCC, accessed
  only via that client's own explicit OAuth authorization.

## 3. Architecture overview

```
Visitor clicks Google Ad (gclid in URL)
   → Cloudflare Pages edge captures gclid + first-party identifiers
   → stored in the agency's own database (Cloudflare D1) with the lead/sale
   → when the conversion is confirmed (form submit / booking / purchase),
     a Cloudflare Pages Function calls the Google Ads API
     ConversionUploadService:uploadClickConversions with the stored gclid
```

- **Hosting:** Cloudflare Pages + Pages Functions (serverless, edge).
- **Datastore:** Cloudflare D1 (the agency's own database).
- **No browser exposure of API credentials:** all Google Ads API calls are
  server-side from the Cloudflare Function; the developer token, OAuth
  client secret and refresh token are stored as encrypted environment
  secrets, never shipped to the browser.

## 4. Google Ads API usage

- **API version:** Google Ads API v21 (REST).
- **Primary service:** `ConversionUploadService.uploadClickConversions`
  - Payload: `conversionAction`, `conversionDateTime`, `conversionValue`,
    `currencyCode`, `orderId`, `gclid` (or `wbraid`/`gbraid`), optional
    hashed email for enhanced conversions for leads.
  - `partialFailure: true`, `validateOnly: false`.
  - Endpoint: `POST https://googleads.googleapis.com/v21/customers/{customerId}:uploadClickConversions`
- **Optional, read-only:** `GoogleAdsService.search` to read conversion
  action resource names / verify uploads. No mutate operations on
  campaigns, budgets, ads, or bidding.
- **Headers:** `developer-token` (Usina MCC), `login-customer-id` (MCC),
  `Authorization: Bearer <OAuth access token>`.

## 5. Authentication model

- Single OAuth 2.0 client (Google Cloud project owned by Usina do Tempo),
  scope `https://www.googleapis.com/auth/adwords`.
- One refresh token belonging to the MCC manager user; the API acts on
  child (client) accounts via `login-customer-id` = MCC and
  `customer-id` = the specific managed account.
- Independent client accounts (outside the MCC) are only accessed with that
  client's own OAuth grant.
- Developer token: Usina's MCC token. Credentials are platform-level and
  stored once (encrypted), not per client.

## 6. Volume

Low: estimated hundreds to a few thousand conversion uploads per month
across all managed accounts, batched per conversion event. No bulk
campaign reads, no high-frequency polling.

## 7. Access & operation

The tool is operated exclusively by Usina do Tempo internal staff
(employees and contractors). Advertisers/clients do not have access to the
API tool or its credentials. The tool is custom-built in-house for the
agency's own operations and is not resold or redistributed.

## 8. Compliance & data handling

- Personally identifiable data used for enhanced conversions (email) is
  SHA-256 hashed before transmission to Google, per Google Ads API
  requirements.
- Conversions are uploaded only with valid Google click identifiers
  captured first-party on the agency's own landing pages.
- Required Google disclosures/consent are handled on the landing pages.
- API credentials are stored encrypted; access is restricted to the
  serverless runtime.
