# Zero-mock test plan

Every page, endpoint, on-chain interaction and integration of Polaris, with
what "correct" means for each. Run through a real browser (Claude in Chrome)
against the real local stack: an anvil fork of Monad testnet with Agora's
AUSD, real contracts, real signed transactions, the real SQLite store, the
real APIs. On every item the console has no errors and the network tab has
no failed request the product didn't expect. Status is one of **PASS**,
**FAIL** (with the fix), or **UNTESTED** (with the exact missing
dependency); never PASS on an assumption. See [`PLAN.md`](../PLAN.md) P4.

**Stack under test.** `demo:local` in fork mode on its own ports (PLAN P2.1).
Buyers sign in with a real WebAuthn ceremony: Claude in Chrome uses the
person's own platform authenticator (Touch ID) when they are present; the
automated run (`demo:e2e`) uses Chrome's virtual authenticator with PRF, so
Mera's own code derives every key. Monad testnet itself is on hold: items
that need it are UNTESTED, "awaiting testnet go".

Legend for the run columns: **R1** first full run, **R2** the re-run after
fixes.

## L. Landing page (`apps/landing`)

| ID | Item | Correct means | R1 | R2 |
|---|---|---|---|---|
| L1 | `/` loads | Renders hero, sections and footer; fonts load; no console error | PASS (Chrome, 7 Oct, `next dev -p 25300`): hero ("Credit, built into the payment."), 11 sections, footer; Inter Tight loaded; console clean (dev banner and HMR only), no failed request | |
| L2 | "Get the app" | Opens the app URL configured in `NEXT_PUBLIC_APP_URL` | PASS (Chrome): "Get the app" is `http://localhost:25000/` and opens the app (title Polaris) | |
| L3 | "Log in" / "Start accepting" | Open Polaris for Business `/login` | FAIL (Chrome): "Log in" opens `http://localhost:25100/login` (the local session forwards to `/dashboard`), but both "Start accepting" buttons open `http://localhost:25100/`, the Business landing, not `/login`. Fix: point them at `/login` (`apps/landing/src/content.ts:86` and `:139`, `linkTo(BUSINESS_URL, "/", ...)`), or change this item if the landing is intended | |
| L4 | 375 px | No horizontal scroll; nav collapses; text readable | PASS (375 × 812, Playwright Chromium; the Claude in Chrome window would not resize): no horizontal scroll (scrollWidth 375), the nav collapses to "Get the app" and a menu button, text readable | |

## A. The Polaris app: screens (`apps/app`)

| ID | Item | Correct means | R1 | R2 |
|---|---|---|---|---|
| A1 | Not configured | Built without `NEXT_PUBLIC_POLARIS_API_URL`: a "not configured" screen, no balances or activity invented | UNTESTED: needs a second app build without `NEXT_PUBLIC_POLARIS_API_URL`, which isn't part of the running stack (`test/zero-mock.test.ts` covers the not-configured screen) | |
| A2 | `/onboard` | Continue with Face ID starts a WebAuthn create with PRF; email (Privy) shown only when configured | UNTESTED in Chrome: the ceremony needs the person's Touch ID (automated: I1/F1 evidence from `demo:e2e`). Chrome: `/onboard` shows "Create account with Face ID", "I already use Polaris", "Look around first"; no email option, matching `/api/health` `privyAppId: null`; console clean before the ceremony | |
| A3 | Home `/` | Balance read from the chain for the signed-in account; activity from the API; empty state for a new account | UNTESTED in Chrome for a signed-in account (Touch ID). Chrome: signed out, Home shows $0.00, "Nothing yet" and "Create your account"; nothing invented; console clean | |
| A4 | `/activity`, `/activity/[id]` | Lists real payments, plans, sends; a detail opens; unknown id shows "not found" | UNTESTED in Chrome for real rows (needs a signed-in account, Touch ID). Chrome: `/activity` empty state; `/activity/act_doesnotexist` shows "This payment isn't here" | |
| A5 | `/credit`, `/credit/score` | The on-chain credit line and its reasons; "Raise your limit" names a missing provider honestly | UNTESTED in Chrome for an account's own line (Touch ID). Chrome: signed-out `/credit` and `/credit/score` show $0 and empty states; the missing-provider message is real (P9: names `ZERION_API_KEY` and `NANSEN_API_KEY`; F4 automated) | |
| A6 | `/plans`, `/plans/[id]` | Open plans with the next instalment from the chain | UNTESTED in Chrome for open plans (Touch ID). Chrome: `/plans` empty state; `/plans/loan_404` shows "This plan isn't here" | |
| A7 | `/pay`, `/pay/[id]` | A payment link's checkout: merchant, amount, Pay now / Pay in 4 / Subscribe as the link allows; unknown id → not found | PASS (Chrome, 7 Oct): a link made in the dashboard (B6, $120, Now + In 4 + Monthly) shows Halcyon, Verified business, $120.00 and the tabs Pay now / Pay in 4 / Subscribe; a $12.50 SDK session offers Pay now only (under the $20 Pay in 4 minimum); `/pay/plink_doesnotexist` shows "This link doesn't go anywhere". Notes: a turned-off link shows the same generic "may have expired" text although the API answers 410 `link_inactive` and the dashboard promises buyers "will see it no longer takes payments"; with `DEMO_FAST_PLANS` the four instalments are all dated today at $0 interest (60 s plans from `/api/public/network`) | |
| A8 | `/send` | Amount entry, a link created, shareable; invalid amount refused | UNTESTED in Chrome: creating a link needs a funded signed-in account (Touch ID). Chrome: the Send form takes an amount, $0 keeps Send disabled; F6 not run | |
| A9 | `/claim` | A send link claims to this account once; a second claim refused | UNTESTED in Chrome (needs a send link and Touch ID). Chrome: `/claim` without a link shows "This link isn't complete" | |
| A10 | `/split/new`, `/split/[id]` | Create a split; friends pay their share; hidden when PolarisSplit isn't deployed | UNTESTED in Chrome (Touch ID; F7 automated PASS). Chrome: `/split/new` renders the form (PolarisSplit is deployed on the fork); `/split/999999` shows the not-found screen | |
| A11 | `/receive` | The account's address and QR | UNTESTED in Chrome (needs an account). Chrome: signed out, `/receive` says "Your code needs an account first" with Create your account | |
| A12 | `/add` | Adding dollars: the real route (faucet on the fork / instructions), no fake top-up | PASS (Chrome): `/add` offers Ask someone / Show your code / Claim a link and, on this local stack, "Get $500 test dollars ... Not real money"; the faucet behind it funded a fresh address with $500 of Agora's AUSD on the fork (7 Oct); nothing is credited without a transfer | |
| A13 | `/accounts`, `/cards`, `/insights`, `/notifications`, `/profile`, `/settings` | Each renders real data or an honest empty state; no dead buttons | FAIL (Chrome): the screens render honest empty states with a clean console, but Profile says "Or use your email: the same account on any device" (and the claim sheet "Or use your email") while this build has no Privy (`privyAppId: null`, no email option on `/onboard`): `apps/app/src/screens/profile.tsx:33`, `src/desktop/profile.tsx:38`, `src/sheets/claim.tsx:167`; gate the line on Privy. Minor: with no account, `/accounts`, `/cards` and `/profile` show "Since October 2026" | |
| A14 | Sheets (`@sheet/*`) | Each sheet opens over its screen and closes; deep link opens the full page | PASS (Chrome): Pay a link and Split a bill open their sheets over Home (`/pay`, `/split/new`) and close with the X or Escape back to `/`; deep links render the full screen (with Home behind on desktop, a full sheet at 375 px). Dev only: the first open of a sheet waits for its route to compile (up to 33 s) | |
| A15 | `/gallery` | Not reachable in a production build (development only) | UNTESTED: the stack is a development build (`/gallery` answers 200 there, as designed); a production build isn't running (`test/zero-mock.test.ts` checks the guard) | |
| A16 | 375 px, every screen | No overflow, tappable targets, safe areas | PASS (375 × 812, Playwright Chromium; the Claude in Chrome window would not resize): 20 routes signed out, no horizontal overflow, no console error, no failed request. Minor: text links under 24 px tall ("See all" 41 × 19 on `/credit`, "Select" 38 × 19 on `/accounts`) | |
| A17 | `/api/fx` | Chainlink rates read live (server-side), with age; a currency with no feed → no line | PASS (Chrome and curl, 6 and 7 Oct): EUR, GBP, JPY from Monad mainnet feeds (minutes old), BRL, NGN from Base, ARS from Ethereum, each with `updatedAt` and its feed; KES, EGP, PKR, VND, XYZ answer `no-feed` with no rate; a bad code is 400 | |
| A18 | `/api/health` | Production build flags, chain 10143, API URL | PASS: `production: false` (a dev build, reported as such), `devSigner: false`, chain 10143, `apiUrl` http://localhost:25100, pinned contracts equal the deployment | |
| A19 | `/.well-known/assetlinks.json` | Served as JSON with the configured fingerprint, or 404 when unset | PASS: unset here, so 404 with a JSON reason naming `POLARIS_ANDROID_SHA256_FINGERPRINTS` | |

## F. The Polaris app: flows

| ID | Flow | Correct means | R1 | R2 |
|---|---|---|---|---|
| F1 | Face ID sign-up | One ceremony; Mera derives the account; reload and storage clear → same account from the passkey | not run | |
| F2 | Pay now from a link | One confirm; relayed `PolarisCheckout.pay` on the fork; buyer −amount, merchant +amount −0.5%; receipt shown; buyer holds 0 MON | PASS (automated, `demo:e2e`, virtual authenticator): 6 Oct, the fork: one Face ID confirm in the shop's popup, receipt shown; on chain the buyer −$349.00, the merchant +$347.26 (−0.5%, $1.75 fee) in the same transaction, the buyer at 0 MON | |
| F3 | Pay in 4 | Plan opens on chain against the credit line; merchant paid in full from the pool; 4 × instalments shown | PASS (automated, `demo:e2e`, virtual authenticator): 6 Oct, the fork, against a line from Boost (no provider keys, so the review opens none): the checkout shows 4 instalments; `LoanCreated` for the buyer, $349.00 owed against the $351 line, `activeDebtOf` +$349.00; PolarisLoanEngine paid the merchant the full $349.00 in the same transaction; receipt, popup closed, the shop's order paid by webhook; the plan on the dashboard, sealed for the buyer | |
| F4 | Raise your limit | With no Nansen/Zerion key: says which provider isn't configured; never a line from invented data | PASS (6 Oct, `demo:e2e` on the fork: names Zerion, Etherscan and Nansen as not set up; on-chain limit stays $0) | |
| F5 | Subscribe | First period charged on chain; cancel stops the next | Partly. First period: PASS (automated, `demo:e2e`, virtual authenticator) (6 Oct, the fork: the Coffee Club in the popup, the order paid by webhook from the chain sync). Cancel: not run (no step in `demo:e2e`) | |
| F6 | Send by link → claim | Escrowed in PolarisSend; claim pays the recipient once; sender cancel works before claim | not run (`demo:e2e` has no send-by-link step) | |
| F7 | Split the bill | Organiser creates; a friend pays a share straight to the organiser; closing works | PASS (automated, `demo:e2e`, virtual authenticator): 6 Oct, the fork, `demo:e2e:split` 22 of 22 (Maya creates, Sam and Priya pay shares straight to her account, a relayed share replayed pays nothing more, closing cancels the rest, a split by amounts settles) | |
| F8 | Sealed receipt | The server holds ciphertext only; the app opens it with the passkey's inbox key | PASS (automated, `demo:e2e`, virtual authenticator): 6 Oct, the fork: ciphertext only to the app's signed request; the passkey's keys open it (again in the Boost run) | |
| F9 | Collections | A due instalment is collected on chain (CRE collections code, Chainlink's forwarder on the fork) | PASS (automated, `demo:e2e`, virtual authenticator): 6 Oct, the fork, `DEMO_FAST_PLANS=1`: the CRE collections workflow (local runner, reports through Chainlink's MockKeystoneForwarder) collected instalment 1 of the Boost-backed plan a minute after checkout (1 of 4 paid, read back through the API) | |
| F10 | Lost approval → sign again | The buyer re-signs; the retry collects at once | not run | |
| F11 | Guardian pause | A raised threshold pauses new Pay in 4 ("Threshold raised for demo"); resumes after | not run | |
| F12 | Mid-flow interruption | Closing the checkout popup leaves no charge and a retryable session | PASS (Chrome, 6 and 7 Oct): from the shop's checkout, Cancel payment closed the Polaris window; the shop says "Nothing was charged; you can pick up where you left off"; the order stays `awaiting_payment` and can be paid again | |
| F13 | API down | The app shows a retryable error, no fake success | not run | |
| F14 | Insufficient balance | Pay now refused before signing with a clear message | not run | |
| F15 | Add to Boost | From Select account → Boost, the Credit line's Boost row or desktop Credit: amount > balance or < $0.10 can't continue; one Face ID; relayed `CollateralVault.lockWithPermit` (permit spender = the vault, value = the amount); `lockedOf` +amount, dollar balance −amount, `creditLimitOf` up by ≤ 1.5× the amount; the success sheet shows the new Boost and limit read from chain; buyer holds 0 MON | PASS (automated, `demo:e2e`, virtual authenticator) from the desktop Credit page's Add to Boost: 6 Oct, the fork: $351 on the keypad (computed from the price, `quotePlan` and the vault multiplier as ScoreManager applies it), one Face ID; `lockedOf` +$351.00, dollar balance −$351.00, `creditLimitOf` $0 → $351 (face value: not underwritten, so ≤ 1.5×); Boosted. shows $351.00 in Boost and $0.00 → $351.00 read back from the chain. Not exercised here: the other two entry points, the amount limits (unit tests only), the buyer's MON after the lock | |
| F16 | Take out of Boost | Not offered: the deployed vault's `withdraw` pays `msg.sender` only, so no relayer can carry it; the Boost sheet says taking dollars out isn't in the app yet (correct = that line shows, and no withdraw button exists) | not run | |

## B. Polaris for Business (`apps/business`)

| ID | Item | Correct means | R1 | R2 |
|---|---|---|---|---|
| B1 | `/login` | Privy sign-in renders; unavailable state when Privy isn't configured | UNTESTED: Privy login on localhost (PLAN P2.3); with the local session, `/login` forwards to `/dashboard`, so neither the Privy form nor its unavailable state shows | |
| B2 | Sign-in (Privy email) | A real merchant signs in; embedded wallet created | UNTESTED: needs Privy allowed origins or a test account (PLAN P2.3) | |
| B3 | Onboarding | Naming the business registers it on `MerchantRegistry` by its own signature, relayed | UNTESTED: needs a Privy sign-up; the demo merchant is registered by `demo:local` (MerchantRegistry active, check C1) | |
| B4 | `/dashboard` overview | Real balance, payments, plans; empty states for a new merchant; no sample data in any build | FAIL (Chrome): the overview reads real data (balance $1.99 equal to `AUSD.balanceOf` on 7 Oct, the payment row, empty states before it), but a failed chain read is shown as a zero: `balanceCents` returns 0 on any error (`apps/business/src/server/services.ts:188`). On 6 Oct, after the fork's anvil crashed (upstream RPC error in `anvil.log`), Overview and Payouts showed "Available $0.00 / Nothing to withdraw yet" while the merchant held 1.99 AUSD. Fix: report the balance as unavailable, not $0.00 | |
| B5 | `/dashboard/payments`, `/plans`, `/payouts` | Real rows from the store and chain sync (or the indexer when configured) | FAIL (Chrome): rows are real (the SDK-relayed $2.00 payment, net $1.99, from the chain sync), but the 30-day figures ignore payments newer than the moment the page opened: on 7 Oct `/dashboard/payments` listed the $2.00 payment as Paid while Gross, Net, Fees and Paid read $0.00 / 0; after a reload $2.00 / $1.99 / $0.01 / 1. `periodSummary` drops `t > now` with `now` frozen at mount (`payments-view.tsx:317`, `lib/data/analytics.ts:117`); the fork's block time runs about 110 s ahead of the wall clock, and in production a payment that lands after the page opened is missed the same way. Plans and Payouts: empty states, Payouts history after B8 | |
| B6 | `/dashboard/links` | Create a link; it opens in the app's checkout; disable works | FAIL (Chrome): creating works (POST `/api/links` 201; the link opens in the app's checkout, A7) and turning off works once reached (PATCH, "Link turned off", the public checkout answers 410), but the row's "..." menu is clipped: the Menu is absolutely positioned inside the table's `overflow-x-auto` wrapper, so with one row "Turn off" sits at y 512 to 564 outside the 94 px scroll box (y 376 to 470) and can't be clicked without scrolling inside the table (`packages/ui/src/primitives/Menu.tsx:168`, `Table.tsx:125`). Fix: portal the menu or flip it upward | |
| B7 | `/dashboard/developers` | Create and revoke API keys (secret shown once); add a webhook endpoint; test delivery; retry | PASS (Chrome, 7 Oct): created a key (secret shown once, then masked); it created a session (P4); revoked, its secret answers 401 `invalid_api_key`. Added two endpoints (signing secret shown once); test events: `/r1-hook` got a signed delivery (HTTP 200), `/r1-fail` answered 500, showed "Retrying in 2 min", and Retry now sent attempt 2 (POST `.../retry` 200). Endpoints removed afterwards | |
| B8 | Payouts | One-tap withdraw signed by the merchant's wallet and relayed; automatic payouts run | PASS for one-tap withdraw (Chrome, 7 Oct): chose a payout address, confirmed $1.99, signed by the local session's wallet and relayed: "Withdrawal sent", Paid; on chain the merchant 1.99 to 0 AUSD, the destination +1.99, merchant 0 MON. Automatic payouts: UNTESTED, "switch on once the Privy payout signer is set up on this server" (needs Privy) | |
| B9 | `/dashboard/chainlink` | CRE workflow status and the guardian from real runs; honest empty state before any | PASS (Chrome): the guardian's real runs (rounds 1 to 3, AUSD/USD $0.9998 from Chainlink on Monad mainnet, pool $10,000), "No reports yet" for collections and underwriting before any. Note: the delivery is labelled `cre workflow simulate --broadcast (MockKeystoneForwarder)` while this stack's reports come from the local runner through the same forwarder (PLAN P2.2: `cre workflow simulate` not run) | |
| B10 | `/dashboard/settings` | Real merchant settings persist across reload | PASS (Chrome): renamed the business, it persisted across a reload and in `/api/public/merchants/...`; renamed back. Note: "Signing: Your sign-in (Privy)" shows although the local session signs here | |
| B11 | 375 px | Dashboard usable on a phone | FAIL (375 × 812, Playwright Chromium): on `/dashboard` the "Candles" chart button spans x 339 to 379, so the page scrolls sideways by 4 px (scrollWidth 379), and the y-axis reads 0, 1, 2, 2 (ticks 0 to 2.25 rounded to whole dollars). The other seven dashboard pages: no overflow, no console error | |

## P. API endpoints (`apps/business/src/app/api`)

| ID | Endpoint | Correct means | R1 | R2 |
|---|---|---|---|---|
| P1 | `GET /api/health`, `/api/health/ready` | Ready: config, chain, store on disk, workers; problems listed with `CRON_SECRET` | PASS (curl and the dashboard, 7 Oct): `/api/health` ok, chain 10143, `problems: []` with `CRON_SECRET`; `/api/health/ready` ready, config/chain/store (SQLite, persistent)/workers ok, sync age 15 s. Note: readiness makes no network call by design, so with the fork's RPC down (6 Oct) it stayed ready with only `sync.ageSeconds` growing (218 s) | |
| P2 | `GET /api/public/network` | Chain 10143 (fork), every contract equal to the deployment record, relayer available | PASS: chain 10143, all eight contracts equal `.demo/demo.json`, relayer available, Pay in 4 terms (60 s interval: `DEMO_FAST_PLANS`) | |
| P3 | `POST /api/relay` | Relays a valid signed intent; refuses a bad signature, a stranger origin (CORS), an over-limit gas | PASS (7 Oct): a fresh EOA's signed `transfer` relayed and confirmed (block 68879041, the signer at 0 MON); a signature from another key: 400 `invalid_signature`; preflight from https://evil.example 403 without ACAO, from the app 204; in Chrome, `fetch` to `/api/relay` from the shop's origin is blocked by CORS. Over-limit gas isn't reachable with the allowed request types: unit test only (`apps/business/test/relayer-budget.test.ts`) | |
| P4 | `POST /api/v1/checkout/sessions`, `GET …/[id]` | Secret key required; session created; publishable key can't create | PASS (Chrome, 7 Oct): no key and a bad key 401 `invalid_api_key`; the publishable key 403 `secret_key_required`; the secret key 201 (open session, checkout URL on the app); amount 0.10 400 `amount_too_small`; GET with the secret 200, with the publishable 403, anonymous 401, unknown id 404 | |
| P5 | `POST /api/v1/relay/payments` | The shop's publishable-key relay path works from the shop's origin only | PASS (Chrome, from the shop's origin, 7 Oct): a fresh payer's signed `payWithAuthorization` with the shop's publishable key 201, confirmed; merchant +$1.99, payer -$2.00 and 0 MON; replay returns the same transaction; another merchant 403 `wrong_merchant`; no key 401. Note: the route is any-origin by design (publishable key, `withPublishableKey`), not "shop origin only" as written here | |
| P6 | `GET /api/public/sessions/[id]`, `/links/[id]/checkout`, `/merchants/[id]`, `/splits/[id]` | Real records; unknown id → 404 | PASS (7 Oct): sessions 200 / unknown 404; link checkout POST 201-path used by A7, a turned-off link 410 `link_inactive`, unknown 404; merchant 200 / unknown 404; split unknown 404, malformed 400. No real split record to read (creating one needs Touch ID; F7 automated) | |
| P7 | `GET /api/public/buyers/[address]`, `/credit/[account]`, `/credit/[account]/messages`, `/credit-guard` | Real chain-derived data | PASS (7 Oct): `buyers/{address}` lists the SDK payment and 3 moves for the fresh payer; `credit/{account}` limit $0 equal to `creditLimitOf` on chain; `messages` returns the consent and link texts; `credit-guard` open, round 5, pool from chain; a bad address 400 | |
| P8 | `POST /api/receipts`, `/api/receipts/inbox` | Signed read returns ciphertext only; unsigned refused | PASS: no signature 400, a wrong signature 401 `bad_signature` (`/api/receipts`), malformed inbox key 400 (`/inbox`). The signed read returning ciphertext only: automated (F8, `demo:e2e`), not in Chrome (needs the passkey's keys, Touch ID) | |
| P9 | `POST /api/credit/underwrite` | Fires the CRE underwriting trigger; without provider keys, an honest not-configured answer | PASS (7 Oct): a wrong consent signature 403; a signed request 202, the CRE underwriting run (local runner) ended `failed`: "This review needs Zerion and Nansen, which aren't set up on this server yet (ZERION_API_KEY and NANSEN_API_KEY)"; no line on chain (limit $0); without a history wallet: `thin`, no report (6 Oct) | |
| P10 | `POST /api/cre/callback` | Refuses a bad HMAC | PASS: no header 401 `bad_signature` (missing), a wrong HMAC 401 (signature mismatch) | |
| P11 | `GET /api/me`, `/api/overview`, `/api/payments`, `/api/plans`, `/api/payouts`, `/api/links`, `/api/keys`, `/api/webhooks` | 401 without a session; real data with one | PASS: all eight 401 without a session (and with a wrong token); 200 with the dashboard's session (network tab) | |
| P12 | `PUT /api/cron/tick` | 401 without `CRON_SECRET`; runs the loops with it | PASS: 401 without or with a wrong secret; with `CRON_SECRET` POST runs the loops (chain, relays, webhooks, payouts, underwriting) 200. Note: the route takes GET and POST (PUT answers 405 with the secret), not PUT as written here | |

## S. Halcyon, the demo shop (`apps/shop`)

| ID | Item | Correct means | R1 | R2 |
|---|---|---|---|---|
| S1 | `/`, `/shop`, `/products/[slug]`, unknown slug | Catalogue renders; unknown → the shop's 404 | PASS (Chrome): `/`, `/shop` (8 products), `/products/arc-lamp` render, console clean; `/products/no-such-thing` is the shop's "Nothing here." page with status 404 | |
| S2 | Cart and checkout | Polaris checkout opens through the SDK; without Polaris config the shop says payments aren't configured | PASS up to the ceremony (Chrome, 6 and 7 Oct): bag, checkout, Pay: POST `/api/checkout` 200 and the SDK opened the Polaris window on `/pay/cs_test_...?display=popup`, which loaded the session (200); the payment needs Touch ID (F2/F3 automated PASS). Not shown: the unconfigured branch (this stack is configured; shop tests cover it). Note: under `DEMO_FAST_PLANS` the shop quotes weekly instalments ($40.05, $1.22 interest) while the deployment's plans run every 60 s | |
| S3 | Order paid by webhook | The signed webhook marks the order paid; an unsigned POST is refused | PASS: an unsigned POST and a wrong signature 400 `invalid signature` (Chrome and curl); signed deliveries to the shop answered 200; an order marked paid by the webhook: automated (F2/F3/F5, `demo:e2e`) | |
| S4 | `/orders/[id]` | Real order state and its log | PASS (curl and Chrome, 7 Oct): `/orders/{id}` shows order HC-94123's real state (Awaiting confirmation, Pay in 4, placed 10:38) and its log; an unknown order 404. A paid order's page needs a Touch ID payment | |
| S5 | 375 px | Usable on a phone | PASS (375 × 812, Playwright Chromium): `/`, `/shop`, a product, `/cart`, `/checkout`: no horizontal overflow, no console error | |

## C. On chain (the fork)

| ID | Item | Correct means | R1 | R2 |
|---|---|---|---|---|
| C1 | Deploy | `deploy:fork` with real AUSD; `check:deployment:fork` all pass | PASS (6 Oct, fork: 67 of 67; the check grew since 63). R1, 7 Oct: `check:deployment:fork` on the restarted fork (block 68,878,974): 67 of 67 | |
| C2 | Money paths | `fork:smoke` 14 of 14 on real AUSD | UNTESTED in R1: not run, since `fork:smoke` writes to the fork and this one is the shared demo stack; run it on a fork of its own | |
| C3 | Monad testnet | `check:deployment:monad` read-only 65 of 65; any testnet transaction: UNTESTED, awaiting testnet go | PASS read-only (7 Oct): `check:deployment:monad` 65 of 65. Any testnet transaction: UNTESTED, awaiting testnet go | |

## I. Integrations

| ID | Integration | Correct means | R1 | R2 |
|---|---|---|---|---|
| I1 | Mera (Face ID) | Real ceremony with PRF; account and receipt keys derived by Mera | PASS (6 Oct, `demo:e2e` on the fork: Chrome's virtual authenticator with PRF, Mera's ceremony; a real phone not run). Chrome R1: UNTESTED, needs the person's Touch ID | |
| I2 | Privy relayer | Server wallet policy refuses a disallowed call (testnet: awaiting go; local uses the local relayer) | UNTESTED: this stack uses the local relayer (`relayer.mode: local`); the Privy server wallet's policy needs Privy and the testnet go | |
| I3 | Privy merchant login | Real email sign-in on the local origin | UNTESTED: Privy allowed origin or a test account (PLAN P2.3) | |
| I4 | Chainlink CRE | `cre workflow simulate` of each workflow | UNTESTED: `cre workflow simulate` needs `cre login` (PLAN P2.2); the local runner's guardian reports landed (B9) | |
| I5 | Chainlink feeds | FX rates and AUSD/USD read live from Monad mainnet | PASS (6 and 7 Oct): `/api/fx` reads live feeds (A17); the guardian read Chainlink AUSD / USD on Monad mainnet, 0.9998265 and 0.99979075, feed 0xE207...9e13 | |
| I6 | Nansen | Live facts for a linked wallet | UNTESTED: `NANSEN_API_KEY` not set (the runner and P9 name it) | |
| I7 | Zerion | Live balances and tenure | UNTESTED: `ZERION_API_KEY` not set (the runner and P9 name it) | |
| I8 | Etherscan | Live history signal (key present) | UNTESTED: the runner reports `etherscan: live`, but no signal was observable: a linked wallet with real Ethereum history, whose key signs the link proof, is needed | |
| I9 | Envio | Indexer on the local chain feeds the dashboard, webhooks and CRE candidates | UNTESTED: the indexer isn't part of this stack (no `POLARIS_INDEXER_URL`); `pnpm indexer:local` needs Docker | |
| I10 | Agora AUSD | Real AUSD on the fork, faucet funding | PASS (6 Oct, `demo:local` fork mode: pool, buyers and the wallet payer funded from Agora's faucet). R1, 7 Oct: the faucet sent $500 of Agora's AUSD (0xa901...22dC, "Agora Dollar") to a fresh address | |

## Summary

| Run | PASS | FAIL | UNTESTED | Not run |
|---|---|---|---|---|
| R1 | 44 | 6 | 22 | 8 |
| R2 | | | | |

R1 ran on 6 and 7 Oct through Claude in Chrome against `demo:local` in fork
mode (restarted on 7 Oct with a fresh fork and deploy; the 7 Oct state is
what the cells cite where they differ). Counted by each cell's leading
status, F included as it stood (F5 "Partly" counts as not run). Items
passing with a part not verified in Chrome say so in the cell: B8
(automatic payouts), P6 (no split record), P8 and S3 (their signed halves
are automated), S2 (up to the Face ID ceremony). The 375 px items (A16,
B11, S5, L4) ran in Playwright's Chromium at 375 × 812, because the Claude
in Chrome window would not resize. Passkey ceremonies need the person's
Touch ID and were not attempted.
