# Polaris: the plan to done

Started 6 Oct 2026 (the master pipeline in the team's orchestration notes).
Statuses are updated in place as work lands. Companion files:
[`docs/TODO.md`](docs/TODO.md) (the team's checklist),
[`docs/SPONSOR-GAP.md`](docs/SPONSOR-GAP.md),
[`docs/TEST-PLAN-ZERO-MOCK.md`](docs/TEST-PLAN-ZERO-MOCK.md) (every item's
browser verification), [`docs/DEPLOY-LATER.md`](docs/DEPLOY-LATER.md).

**Standing constraints.** Monad testnet is on hold until the team funds the
deployers and says go: on-chain work runs on a local anvil or an anvil fork of
Monad testnet with real contracts and real signed transactions; testnet-only
items are BLOCKED ("awaiting testnet go"). The live hosting stays as it is.
No secrets in git or on hosting. Seven sessions share one 16 GB Mac: own
worktrees, own ports, stop by PID.

## 1. Goals

**Done** means: every flow a judge can reach works for real (no sample data,
no stubbed relayer, no fixture evidence in the running product), is verified
in a real browser with a clean console and network tab, and the submission
says exactly what ran.

**Winning** means scoring on the published weights. Track 02 judges product
quality, technical excellence, Monad integration, track fit and innovation at
20% each; each bounty scores meeting its stated requirement at 40%. So the
priorities are: (1) a flawless consumer path (link → Face ID → pay / Pay in 4 /
send / split → receipt), (2) every sponsor requirement met with real calls,
(3) a ≤ 3 min video and a judge-ready README and kit.

## 2. Phases (critical path marked ★)

| # | Phase | Depends on | Status |
|---|---|---|---|
| P1 ★ | **Zero-mock product path**: remove offline demo data, the dev mock session, the shop's dev mock API, fixture evidence and the mock dollar from what runs | — | DONE (7 Oct) |
| P2 ★ | **Real local stack**: `demo:local` on an anvil fork of Monad testnet with Agora's real AUSD, Chainlink's forwarder, real WebAuthn (virtual authenticator with PRF in automation) | P1 | DONE (7 Oct; CRE via local runners until `cre login`) |
| P3 | **Indexer live**: Envio HyperIndex on the local chain feeding the dashboard, webhooks and CRE candidates | P2 for the fork variant | DONE (local) |
| P4 ★ | **Verification**: `demo:e2e` (incl. receipts, split) green on the real stack; every item of the zero-mock test plan PASS or UNTESTED with its dependency, via Claude in Chrome with console and network clean | P1, P2 | DONE (7 Oct): `demo:e2e` 58/58; browser R2 52 PASS, 0 FAIL, 28 UNTESTED |
| P5 | **Quality loop**: tests, typecheck, lint, contracts, Slither, secret scan, 375 px, a11y basics, failure states; gap grep re-run | P4 | DONE (7 Oct): 33/33 checks, gap grep clean |
| P6 | **Judge package**: README, SUBMISSION.md, DEPLOY-LATER.md, kit | — | DONE (refreshed 7 Oct) |
| P7 | **Awaiting the team**: testnet go (PolarisSplit, real AUSD redeploy), keys (Nansen, Zerion, Envio, `cre login`), the shop's hosting, the Face ID domain, the video, registration | team | BLOCKED |

## 3. Tasks

Each task: objective · acceptance · verify · status.

### P1 Zero-mock product path

- **P1.1 App without the offline demo.** Remove `apps/app/src/lib/data/mock.ts`
  from the product path, the stub relayer (`lib/relayer.ts`), placeholder
  EIP-712 domains (`lib/domains.ts`) and `RELAYER_IS_STUB`. Without
  `NEXT_PUBLIC_POLARIS_API_URL` the app shows an honest "not configured"
  screen. · Acceptance: no import of mock data outside tests; a build without
  the API shows the not-configured state; app tests green. · Verify: grep,
  `pnpm --filter @polaris/app test typecheck lint`, browser. · DONE (6 Oct):
  the offline demo, stub relayer, placeholder domains and "Sample" pills are
  gone; without the API every route shows "Polaris isn't configured on this
  build" and nothing can be signed; `/gallery` is development only; 65 tests
  (incl. `test/zero-mock.test.ts`). Follow-up P1.7.
- **P1.7 Boost and account digits.** `components/accounts.tsx` had invented
  card digits ("0095", "1122") and a Boost balance fixed at 0: read the
  buyer's real collateral from `CollateralVault`, derive the digits. · DONE
  (6 Oct): Boost reads `lockedOf` (hidden without a vault); every face shows
  the account's own digits; 69 app tests
- **P1.8 Add to Boost / take out.** The app could not lock collateral,
  though the relayer supports `lockCollateral`; without Nansen/Zerion keys
  it is the real way to raise a limit. · DONE for Add (6 Oct): one Face ID
  confirm signs an AUSD permit to the vault and relays `lockCollateral`; the
  sheet shows the new Boost and limit read back from the chain; 75 app tests.
  The raise it names is exact (6 Oct): face value for a secured-only
  account, the vault's multiplier otherwise, from the credit API's
  `boostAtFaceValue` (ScoreManager's own rule); no figure while that is unknown.
  Take out: DONE on the local fork (7 Oct, `metropolis/boost-withdraw`);
  testnet WAITS for the team's go. `CollateralVault.withdrawWithSig`: the
  borrower's EIP-712 `Withdraw`, paid to the borrower only, under
  `withdraw`'s own rules (nothing while a plan is open), storage layout kept;
  19 contract tests (630 in all). The relayer's `withdrawCollateral` and the
  policy builder's rule (not applied to Privy); 290 business tests. The
  Boost sheet's Take out, one Face ID, "Taken out." from the chain; 85 app
  tests. `demo:e2e` on the fork: 36 of 36 with the three Take out steps,
  split 22 of 22 (58 of 58; a first run failed one step outside this change,
  the dashboard link's Done going Home within 2.5 s on a loaded machine, and
  passed on the re-run). Testnet's vault predates `withdrawWithSig`: the
  relayer and the app say it isn't available there yet. The redeploy, the
  Privy policy update and what happens to the old vault's locks:
  [`docs/DEPLOY-LATER.md`](docs/DEPLOY-LATER.md) block 2b
- **P1.2 Business without the dev mock session.** Remove
  `POLARIS_DEV_MOCK_SESSION`, `components/auth/mock-auth.tsx`,
  `lib/data/sample.ts`, `chainlink-sample.ts` and the `placeholder` branches
  in `lib/data/insights.ts`; empty states where data is absent. · Acceptance:
  no sample or placeholder data reachable in any build; business tests
  green. · DONE (6 Oct): the mock session, the sample book (also the
  server's sample book for chainless merchants and the "Preview with sample
  data" toggle) and the placeholder panels are gone; honest empty states
  ("No collections run yet", "Indexer not configured", "This server isn't
  connected to Monad yet"); `/gallery` is development only; 279 tests
- **P1.3 Shop without the dev mock API.** Remove `apps/shop/src/lib/dev-polaris`,
  the `route.dev.ts`/`page.dev.tsx` routes, `HALCYON_DEV_MOCK`, the dev
  drawer; without Polaris keys the shop says payments are not configured. ·
  Acceptance: shop pays only through Polaris for Business; tests green. ·
  DONE (6 Oct): the mock API, its routes and `HALCYON_DEV_MOCK` are gone;
  unconfigured → "Payments aren't configured" (checkout page, 503 from
  `/api/checkout`, `/api/health` says why); the build fails if it serves any
  API route beyond the shop's five (`apps/shop/scripts/assert-api-routes.mjs`);
  96 tests. The "Built with Polaris" drawer stays: it shows the real SDK
  calls and webhooks
- **P1.4 Underwriting without fixture evidence in the product.** Missing
  `NANSEN_API_KEY`/`ZERION_API_KEY` → the provider is "not configured", never
  synthesized data; "Raise your limit" says reviews need the named key;
  fixtures stay for unit tests only. Live Etherscan (key present) and public
  RPCs still count. · Acceptance: `packages/underwriting/src/node/client.ts`
  no longer defaults to fixtures; gateway `dataMode` never "fixture" at
  runtime. · DONE (6 Oct): two modes only, live or `not_configured`
  (naming the variable); `UNDERWRITING_MODE=fixture` gone (the gateway
  refuses it); fixtures only via `@polarispay/underwriting/testing`, and
  `no-fixtures-in-product.test.ts` fails if product code reaches them; a
  review a key could finish is `unavailable`, never a line from absent
  evidence; "Raise your limit" names the missing key. Live provider calls are
  UNTESTED until the keys exist (Etherscan's is set)
- **P1.5 Real dollar locally.** The local stack uses Agora's AUSD on a fork
  (see P2.1); MockAUSD stays for unit tests and `AUSD_MODE=mock` only. ·
  DONE (6 Oct, branch `metropolis/fork-stack`): `demo:local` defaults to the
  fork; pool, buyers and the direct-wallet payer hold AUSD drawn from Agora's
  faucet (the faucet server hands out $500 from a reserve of drips, nothing
  minted). MockAUSD remains on `DEMO_CHAIN=hardhat`
- **P1.6 No dev signer in the product path.** Automation signs in through a
  real WebAuthn ceremony (Chrome DevTools virtual authenticator with PRF), so
  Mera's real code derives the account and receipt keys. · DONE (6 Oct,
  `metropolis/fork-stack`): fork mode runs the app without the dev signer;
  `demo:e2e` and `demo:e2e:split` add Chrome's virtual authenticator (ctap2,
  internal, resident key, UV, PRF) per profile, and Mera's ceremony derives
  the account and receipt keys. Chrome binds a virtual authenticator to one
  tab and drops the PRF secret when a credential is copied to another, so
  the app's other tabs (the shop's popup) hand their WebAuthn calls to the
  tab that holds it (`scripts/lib/virtual-authenticator.cjs`). The dev
  signer stays for `DEMO_CHAIN=hardhat`

### P2 Real local stack

- **P2.1 `demo:local` on a fork**: anvil fork of Monad testnet on own ports
  (`--prune-history 300`), `deploy:fork`, pool and buyers funded from Agora's
  faucet, Chainlink's MockKeystoneForwarder (Chainlink's own simulation
  contract) for CRE reports, own ports for every server. · Acceptance: one
  command brings it up; `check:deployment:fork` 63/63. · DONE (6 Oct,
  `metropolis/fork-stack`): `pnpm demo:local` brings it up and refuses to go
  on unless `check:deployment:fork` passes in full (67 of 67 now; the check
  grew since the 63). Report gas is sized from a traced delivery (G14 on the
  fork). `demo:e2e` 23 passed, 0 failed, 5 not run; split 22 of 22 (since
  P4.1's Boost step: 55 of 55, see P4.1)
- **P2.2 CRE on the fork**: the three workflows' code runs against the fork
  (local runner today; `cre workflow simulate` once `cre login` is done:
  BLOCKED on the team). · IN PROGRESS: the local runners run against the
  fork through Chainlink's MockKeystoneForwarder from the recorded
  transmitter (guardian attestations, an underwriting report and
  collections landed with `ReportProcessed` true); `cre workflow simulate`
  still BLOCKED
- **P2.3 Merchant sign-in**: real Privy login on localhost needs the origin
  allowed in Privy and a person for the email code (or Privy test
  credentials enabled by the team). Until then the local merchant session is
  the documented dev path and the item is UNTESTED in the browser. · BLOCKED
  (team: Privy allowed origins / test account)

### P3 Indexer

- **P3.1 Envio on the local chain** (RPC source, no token): entities,
  Activity outbox, DueCandidates, consumers read it. · DONE (6 Oct,
  `pnpm indexer:local`): synced to head, all 26 entities populated, 27/27
  values equal the contracts, all nine webhook kinds in the outbox,
  DueCandidates listed a due loan and subscription; the dashboard path
  (`insights.live.test.ts`), the SDK's webhook validator and a real
  `polaris-collections` run read it. The API's own webhook dispatcher, which
  then sent only from its chain sync, reads the outbox since P3.3
- **P3.3 Dispatcher from the indexer** (optional): when
  `POLARIS_INDEXER_URL` is set, read the `Activity` outbox by cursor. ·
  DONE in code and tests (7 Oct, `metropolis/envio-webhooks`):
  `apps/business/src/server/webhooks/outbox.ts` reads five rows a page from a
  cursor kept in the SQLite store, emits through the chain sync's own
  `emitEvent` under the same event id (so neither source sends an event the
  other sent), checks every event with polarispay-sdk's
  `validateWebhookEvent`, records each delivery's source (dashboard log,
  `GET /api/webhooks`), and falls back to the chain sync alone when the
  indexer doesn't answer (`/api/health` says so). `test/outbox.test.ts`, 16
  tests against a test double of the indexer's GraphQL. Not run against a
  live indexer: `test/outbox.live.test.ts` is written and skipped by default
- **P3.2 Envio on testnet** needs `ENVIO_API_TOKEN` and the testnet go. ·
  BLOCKED

### P4 Verification

- **P4.1 `demo:e2e` green on the fork, Pay in 4 included** (the receipts
  step, written on branch `metropolis/receipts-e2e`; then Pay in 4 without
  provider keys). · DONE (6 Oct, on the fork with passkeys): the four receipt
  steps pass, checking the app's own signed `POST /api/receipts` (base64url
  `enc`/`ct`, no item names). Pay in 4 (branch `metropolis/e2e-boost`): the
  review still opens no line and names the missing keys, then the buyer adds
  $351 to Boost in the app (Credit page, one Face ID on the virtual
  authenticator; the amount computed from the price, `quotePlan` and the
  vault's multiplier as ScoreManager applies it, face value for an account
  not underwritten); `lockedOf` +$351, balance −$351, line $0 → $351 on
  chain; the plan opens against it, the pool pays the merchant $349 in full,
  receipt, popup close, the shop's order paid by webhook, instalment 1
  collected by the CRE collections workflow, the plan on the dashboard. Pay
  now also checked on chain (price less the 0.5% fee to the merchant, the
  buyer at 0 MON). `demo:e2e` 55 passed, 0 failed, 0 not run (33 of its own
  + the split's 22); `demo:e2e:split` 22 of 22 (fork block 68,523,599,
  `DEMO_FAST_PLANS=1`)
- **P4.2 `docs/TEST-PLAN-ZERO-MOCK.md`**: every page, endpoint, contract
  interaction and integration with its expected result. · DONE (written;
  the runs fill it in)
- **P4.3 Browser pass** via Claude in Chrome, console and network clean,
  375 px. · R1 DONE (7 Oct): 44 PASS, 6 FAIL, 22 UNTESTED (each with its
  dependency: the person's Touch ID, Privy origin/test account, `cre login`,
  Nansen/Zerion keys, the testnet go), 8 F flows covered by the automated
  run. FAILs (L3 landing link, A13 email copy without Privy, B4 a failed
  balance read shown as $0, B5 tiles missing fresh payments, B6 clipped row
  menu, B11 375 px overflow and duplicate ticks) are being fixed (P4.4).
  375 px ran in Playwright's Chromium (the Chrome window wouldn't resize)
- **P4.4 Fix R1 and run R2.** · IN PROGRESS
### P5 Quality loop

- **P5.1 First gate** on `metropolis/integrate`: 29/29 test, typecheck, lint
  green; contracts 611; Slither triaged ([SLITHER.md](packages/contracts/SLITHER.md));
  secret scan clean. · DONE
- **P5.2 Re-run after P1–P4** and the gap grep. · NOT STARTED

## 4. Gap audit (from the code, 6 Oct)

Grep of `mock|stub|fake|dummy|placeholder|TODO|FIXME|hardcod` over `apps`,
`packages`, `workflows`, `scripts`, excluding tests, fixtures, docs, ABIs and
evidence: 730 lines. The product-path gaps:

| # | Evidence | Impact | Sev | Fix | Task |
|---|---|---|---|---|---|
| G1 | `apps/app/src/lib/data/index.ts:17` `data = apiConfigured() ? liveData : mockData` | A build without the API shows invented balances and activity | P1 | Not-configured state | P1.1 |
| G2 | `apps/app/src/lib/relayer.ts:5,20,111` stub relayer with made-up hashes | Fake success when unconfigured | P0 | Remove | P1.1 |
| G3 | `apps/app/src/lib/domains.ts:57` placeholder EIP-712 domains | Signatures over a fake domain when unconfigured | P1 | Remove | P1.1 |
| G4 | `apps/business/src/components/auth/mock-auth.tsx`, `lib/session.tsx:50` | A fake signed-in merchant in development | P2 | Remove | P1.2 |
| G5 | `apps/business/src/lib/data/sample.ts`, `chainlink-sample.ts`, `insights.ts:95,138,150` (`fakeHash`, placeholder runs/events) | Invented dashboard data in the mock session | P1 | Remove; empty states | P1.2 |
| G6 | `apps/shop/src/lib/dev-polaris/mock.ts`, `app/api/dev-polaris/**` | A mock Polaris API in development | P2 | Remove | P1.3 |
| G7 | `packages/underwriting/src/node/client.ts:52` defaults to `fixture` without a key | Credit lines from synthesized evidence | P0 | Not configured | P1.4 |
| G8 | `apps/gateway/src/server.ts:36` `dataMode: "fixture"` | Same, through the gateway | P1 | Same | P1.4 |
| G9 | `scripts/demo-local.mjs` deploys MockAUSD and the repo's own MockKeystoneForwarder and MockPriceFeed | The local product runs on a mock dollar | P1 | Fork stack (default since 6 Oct; the mocks remain on `DEMO_CHAIN=hardhat`) | P1.5, P2.1 |
| G10 | `apps/app/src/lib/account/dev-signer.ts`, `dev-receipts.ts`; `demo:local` sets `NEXT_PUBLIC_DEV_SIGNER` | Face ID replaced by a dev key in every local run | P1 | Virtual authenticator (done in fork mode, 6 Oct; `DEMO_CHAIN=hardhat` keeps the dev signer) | P1.6 |
| G11 | `scripts/demo-local.mjs:426–431` `POLARIS_LOCAL_SESSION_*` | Merchant sign-in bypasses Privy locally | P2 | Real Privy on localhost (team) | P2.3 |
| G12 | Testnet stablecoin is MockAUSD (`deployments/monad-testnet.json`) | Agora bounty on a labelled mock | P1 | Redeploy on go | P7 |
| G13 | `README.md` Attribution was "TBD" | Rules require attribution | P1 | Done 6 Oct | P6 |
| G15 | `apps/app/src/app/gallery`, `apps/business/src/app/gallery` public in production | Shared components with sample values reachable by judges | P3 | Development only | P1.1, P1.2 |
| G14 | `workflows` CRE report gas estimate undershoots on the fork | A report can land "not processed" | P2 | Measure on testnet (read-only) | P7 |

The other hits are tooling and tests: deploy and e2e scripts, the contracts'
own `Mock*.sol` for unit tests, `assert-api-routes.mjs` (a build guard),
`provenance.ts` (names Chainlink's MockKeystoneForwarder for what it is).

## 5. Completion

A 44-item checklist, each item 1 (done), 0.5 (built, one step left) or 0.

| Area | Items | Score |
|---|---|---|
| Features (12): Pay now, Pay in 4, Subscribe, Send/claim, Split (testnet ✗), Withdraw/payouts, Receipts (e2e unrun), Dashboard, Links/keys/webhooks, SDK, Shop (not hosted), Android (no real phone) | | 10 |
| Zero-mock product path (6): G1–G3, G4–G5, G6, G7–G8, G9 (fork path exists), G10 | | 0.5 |
| Integrations (8): Privy, CRE (testnet sims), Nansen, Zerion, Envio (local in progress), Chainlink feeds, real AUSD (fork only), Mera on a real device | | 4 |
| Data and auth (3): persisted DB, hosted Privy login, Face ID | | 1.5 |
| Tests (4): unit/type/lint, contracts + Slither, full `demo:e2e`, browser zero-mock pass | | 2.5 |
| Deploy (5): testnet contracts, hosting (3 of 4), PolarisSplit on testnet, Face ID domain, Envio deployed | | 1.75 |
| Submission (6): README/licence/attribution, kit, gap/runbook docs, video, registration, pushed | | 3 |
| **Total** | **44** | **23.25 → 53%** |

**INITIAL: 53%** (6 Oct).

### Final (7 Oct), same 44 items

| Area | Score | What moved |
|---|---|---|
| Features (12) | 10.5 | Receipts now run green end to end; Boost add and take out added on top (not in the original 44) |
| Zero-mock product path (6) | 6 | G1–G11 closed: no offline demo, mock session, sample book, shop mock API, fixture evidence or mock dollar in what runs; the local stack is a fork with Agora's AUSD; e2e signs in through a real WebAuthn ceremony. The dev signer survives only in the legacy `DEMO_CHAIN=hardhat` mode |
| Integrations (8) | 4 | Envio runs locally (0.5); real AUSD on the fork (0.5); Nansen, Zerion, a real-device Face ID still 0 |
| Data and auth (3) | 1.5 | Unchanged: hosted Privy login waits for the allowed domains |
| Tests (4) | 4 | 33/33 checks (contracts 631, business 296, underwriting 285, workflows 216, SDK 157, shop 96, app 88, …); Slither triaged; `demo:e2e` 58/58 on the fork; browser R2 0 FAIL |
| Deploy (5) | 1.75 | Unchanged: testnet on hold |
| Submission (6) | 3.5 | Pushed in part (the integration branch; the last commits wait for the team's OK) |
| **Total** | **31.25 / 44 → 71%** | |

**FINAL: 71%.** What is left is almost all the team's: keys (Nansen, Zerion,
Envio, `cre login`), Privy origins or a test account, the testnet go
(PolarisSplit, real AUSD, the new vault), the shop's hosting and the Face ID
domain, a real-phone run, the video, registration and the final push.
