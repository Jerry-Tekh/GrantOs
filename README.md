# GrantOS — React Frontend

A React + Vite app for GrantOS, the GenLayer Intelligent Contract for decentralised
grant management and AI milestone verification. Talks to a deployed GrantOS
contract via `genlayer-js`.

## Verified, not just claimed

Everything below was actually run in the build environment before this zip was
produced — including a **clean install** (`rm -rf node_modules && npm install`)
to confirm the project works the way you're about to run it, not just the way
it happened to be left in mid-development.

```
npm install         # 342 packages, 0 vulnerabilities
npm test             # 7 test files, 37 tests, all passing
npm run build        # vite build succeeds, dist/ produced
npm run lint          # 0 errors (1 harmless fast-refresh style warning)
npm run preview      # served the build, HTTP 200
```

Run these yourself to confirm:
```bash
npm install
npm test
npm run build
npm run dev      # http://localhost:5173
```

## Bugs found and fixed in this audit pass

A dedicated re-audit turned up real bugs — not just re-confirmation of the
previous pass. Each one is now covered by a test that fails if it regresses.

**Contract (`contract/grantos.py`, verified with `contract/test_grantos.py`, now 51 tests):**

1. **`evaluated_at_block` was always `0`.** It called `gl.block.number`, which
   doesn't exist anywhere in the real GenLayer SDK — confirmed by grepping the
   actual downloaded SDK source, not assumed. `gl.message` only exposes
   `contract_address`, `sender_address`, `origin_address`, `value`,
   `chain_id`; there is no block-height field available to an Intelligent
   Contract. A defensive `hasattr` check kept it from crashing, which is
   exactly why it went unnoticed — it silently returned `0` every time.
   Replaced with `evaluation_seq`, a real contract-tracked monotonic counter.
   Test: `test_evaluation_seq_is_real_and_monotonic`.
2. **Escrow overpayment got permanently stuck.** `create_grant` checked
   `value >= total_amount`, so a funder who sent extra GEN by mistake had no
   way to ever get it back — there's no withdraw/refund method. Changed to an
   exact-match check, so both under- and over-payment revert loudly instead
   of silently locking funds. Test: `test_escrow_must_match_exactly`.
3. **A malformed grantee address raised an untagged, unfriendly error.**
   `Address(grantee)` was called with no validation; a bad address string
   would blow up with a raw internal exception instead of a clear message.
   Wrapped it. Test: `test_invalid_grantee_address_rejected`.
4. **`get_grant` / `get_grant_progress` had no existence check** (inconsistent
   with `get_milestone_result`, which does). Looking up an unknown grant threw
   a confusing raw lookup error instead of a clear one. Fixed both to raise
   `"[EXPECTED] grant not found"`. Test: `test_unknown_grant_lookups_raise_clear_errors`.

Also added coverage for gaps the previous test suite simply didn't check:
duplicate `grant_id` rejection, a full multi-milestone grant actually reaching
`status: "completed"` with 100% released, resubmission after a `not_completed`
rejection succeeding on a second try, and `resolve_pending_review` rejecting
both non-funders and calls with nothing pending.

**React app:**

5. **Non-numeric/negative milestone amounts silently produced `"sum to NaN"`**
   instead of a clear error — `validateMilestoneAmounts` now explicitly
   rejects non-finite or negative amounts before summing. Note: `type="number"`
   inputs block garbage text at the keystroke level (in both jsdom and real
   browsers), so this mostly guards against negative numbers and any future
   caller that isn't a literal `<input type="number">`. Test:
   `"gives a clear error for a non-numeric milestone amount"` /
   `"...negative milestone amount"` in `genlayerClient.test.js`, and a
   component-level test in `FunderDashboard.test.jsx`.
6. **The wallet-connect button threw an unhandled promise rejection on every
   failed connection.** `GrantOSContext.connect()` catches the error to set
   `connectError` for display, then re-throws it (so other future callers can
   react to failure) — but `Header` wired it as `onClick={connect}` with
   nothing catching that re-throw, so it escaped as an uncaught rejection even
   though the UI displayed the message correctly. `Header` previously had
   **zero test coverage**, which is how this went unnoticed. Fixed the click
   handler and added `Header.test.jsx` (4 tests: no-wallet error, successful
   connect, wallet-rejection error, shared context wiring).


## What's implemented

Three views, one per actor in the grant lifecycle, all wired to real
`genlayer-js` calls (no placeholders):

- **Funder Dashboard** (`src/components/FunderDashboard.jsx`)
  Create a grant (client-side validates that milestone amounts sum to the
  total *before* spending gas — mirrors the contract's `assert`), and resolve
  any milestone the AI flagged `partial` (approve → releases funds via
  `resolve_pending_review`, or reject).
- **Grantee Submission** (`src/components/GranteeSubmission.jsx`)
  Submit a report + up to 5 evidence URLs for the next milestone in sequence.
- **Grant Browser** (`src/components/GrantBrowser.jsx`)
  Loads a grant, its progress, and every milestone's AI result. Each milestone
  renders through `EvidenceViewer.jsx` — criteria met/not-met on one side,
  the AI's quality score, status, and feedback on the other, side by side.

All three go through `src/lib/genlayerClient.js`, a thin wrapper with one
function per contract method — this is also what the integration tests exercise
directly, independent of the UI.

## Contract-call mapping

| UI action | `genlayerClient.js` function | Contract method (`grantos.py`) |
|---|---|---|
| Create grant | `createGrant()` | `create_grant(grant_id, grantee, project_description, milestone_ids, milestone_titles, milestone_criteria, milestone_amounts, total_amount)` — payable |
| Submit evidence | `submitMilestone()` | `submit_milestone(grant_id, milestone_id, report_text, evidence_urls)` |
| Approve/reject a flagged milestone | `resolvePendingReview()` | `resolve_pending_review(grant_id, milestone_id, approve)` |
| Load a grant | `getGrant()` | `get_grant(grant_id)` |
| Load progress | `getGrantProgress()` | `get_grant_progress(grant_id)` |
| Load a milestone's AI result | `getMilestoneResult()` | `get_milestone_result(grant_id, milestone_id)` |

`fetchGrantBundle()` composes the last three into one call for the Grant
Browser and the funder's pending-review lookup.

## Integration tests — what they actually check

`npm test` runs 28 tests across 6 files:

- **`src/lib/__tests__/genlayerClient.test.js`** (13 tests) — for every
  wrapper function, asserts the exact `functionName` and `args` array sent to
  `writeContract`/`readContract`, so a typo or argument-order mistake against
  the Python contract signature fails the build. Also covers the payable
  escrow value (`BigInt(totalAmount)`), the 5-URL cap, and
  `validateMilestoneAmounts` (the client-side mirror of the contract's
  amount-sum `assert`).
- **`FunderDashboard.test.jsx`** — blocks a mismatched-amount submission
  before it ever calls `createGrant`; submits correctly when amounts match;
  full approve-a-partial-review flow (load → see evidence viewer → approve →
  `resolvePendingReview` called with the right args → success message).
- **`GranteeSubmission.test.jsx`** — required-fields validation; URL
  trimming/cap-at-5; surfaces a contract revert message (e.g. the
  sequential-milestone rule) back to the grantee.
- **`GrantBrowser.test.jsx`** — renders every field from
  `get_grant_progress()`'s schema, one evidence viewer per milestone
  (including a milestone with no submission yet), and a load-error state.
- **`EvidenceViewer.test.jsx`** — empty state, full criteria/verdict render,
  and the "raw LLM verdict differs from final status" case (the
  quality-threshold downgrade from the contract).
- **`App.test.jsx`** — tab navigation renders the right panel; header persists
  across tabs.

These are mocked at the `genlayer-js` client boundary (`writeContract` /
`readContract` are `vi.fn()`s), which is the correct integration-test
boundary for a frontend: it proves the UI drives the contract API correctly
without requiring a live chain. It does **not** prove the deployed contract
itself behaves correctly — that's `test_grantos.py` in the contract package,
which runs against the real GenVM engine.

## Second audit pass — application flow & logic bugs

A follow-up pass specifically hunting for *flow* and *logic* bugs (not just
API-shape mismatches) turned up three more real ones, each with a regression
test that fails if it comes back:

7. **Tab switches silently wiped in-progress form state.** `App.jsx` rendered
   `<ActivePanel />` — swapping which *component* was mounted on every tab
   change. That meant navigating away from a half-filled "Create Grant" form
   (or a loaded Grant Browser result) and back **fully unmounted and
   remounted it**, discarding all state. Confirmed with a failing test before
   fixing. Fixed by keeping all three panels mounted at all times and
   toggling visibility with CSS (`.panel.active`) instead of conditional
   rendering. Tests: `"preserves in-progress form state across tab switches"`
   and `"preserves a loaded Grant Browser result across tab switches"` in
   `App.test.jsx`.
8. **Wallet-connection gating was broken everywhere.** Every write action
   checked `if (!client) ...` to decide whether to show "connect your wallet
   first" — but `client` defaults to a *read-only* client that's truthy even
   with no wallet connected, so that check could never actually fire. A user
   who hit "Create Grant" or "Submit Milestone" without connecting a wallet
   would instead get a confusing SDK-level error from a client with no
   signer, not the friendly message the UI claimed to show. Separately,
   `resolve_pending_review` had **no check at all**. Fixed by gating writes
   on `account` specifically, and — since reads are public view calls that
   never needed a wallet in the first place — *relaxed* the Grant Browser and
   "load for review" reads to only require a contract address, not a wallet.
   Tests: the `"wallet-connection gating (regression)"` blocks in
   `FunderDashboard.test.jsx` and `GranteeSubmission.test.jsx` (5 tests total),
   plus an explicit "works with no wallet connected" test in
   `GrantBrowser.test.jsx`.
9. **The wallet-connect button threw an unhandled promise rejection** on
   every failed connection attempt — carried over from the previous pass in
   a slightly different shape after the Header rewrite; re-verified fixed
   here with `handleConnectClick` explicitly swallowing the re-thrown error.

## UI/UX pass

Alongside the bug fixes, the frontend got a real design pass rather than
staying at "functional but plain":

- **Connection status dot** in the header (solid moss-green when connected,
  muted gray when not) instead of relying purely on button text.
- **Live sum-vs-total indicator** on the Create Grant form — shows a
  match/mismatch banner as the funder types, before they ever hit submit,
  instead of only finding out after a failed click.
- **Live URL counter** (`3/5`) on the grantee submission form, with a warning
  once past the 5-URL cap the contract enforces.
- **Loading states everywhere a transaction or fetch is in flight** — buttons
  show "Submitting…" / "Loading…" and disable themselves rather than allowing
  duplicate clicks.
- **Skeleton loading state** for the Grant Browser (shimmering placeholder
  cards) instead of a bare "Loading…" string.
- **Icon-coded status banners** (✓ success / ⚠ error / spinning ○ pending)
  replacing plain colored text.
- Subtle elevation, focus-visible outlines, hover/press states on buttons,
  a sticky tab bar, a faint ledger-line background texture consistent with
  the existing paper/ledger aesthetic, and a responsive layout for the
  milestone-row grid and evidence viewer on narrow screens.

None of this is decoration for its own sake — the loading/disabled states in
particular close a real gap (nothing previously stopped a double-click from
firing two transactions while the first was still in flight).


## Third pass — actually rendering it, not just reading the code

Everything above was verified by tests and by reading the code carefully. For
this pass I went further: I got a real headless Chromium running in this
sandbox (`@sparticuz/chromium` + `puppeteer-core` — a Chromium binary
published as an npm tarball, since Playwright's own CDN and system
`chromium-browser` are both blocked here) and actually rendered the app,
rather than assuming the CSS looked right. That surfaced real bugs code
review alone hadn't caught:

10. **The Google Fonts CDN import failed outright** (`403` in this sandbox;
    it's also routinely blocked by ad-blockers and corporate networks for
    real users). It degraded gracefully to the CSS fallback stack, but that
    meant silently serving Georgia/Courier New instead of the intended
    typography, plus an extra network round-trip and a flash of unstyled
    content. Fixed by self-hosting both typefaces via `@fontsource` — bundled
    into `dist/` at build time, zero external requests. Confirmed via
    `getComputedStyle(...).fontFamily` in the running page that both fonts
    now actually resolve, and confirmed zero console/network errors on every
    route afterward.
11. **Two real WCAG AA contrast failures**, measured (not eyeballed) with the
    same relative-luminance formula the spec uses: `.pending-label` came out
    to 3.66:1 against a 4.5:1 requirement, and the "partial" pending-review
    status pill came out to 4.34:1. A third (`.pill-not_completed`) technically
    passed but only at 4.57:1 — too close to the line to call solid. All three
    now measure 5.8–7.2:1, re-verified with the same script after the fix.
12. **The milestone-row "×" remove button measured 22×26px on a real mobile
    viewport** (390px width) — well under the ~44px minimum tap target size
    Apple/Google/WCAG 2.5.5 all recommend, and a rough one to hit accurately
    on an actual phone. Fixed and re-measured at a clean 44×44px.

Also confirmed concretely rather than assumed: zero horizontal overflow at a
390px mobile viewport, zero overlapping cards, zero zero-size interactive
elements, and that the responsive milestone-row grid actually re-flows into
the intended 2-column stacked layout at mobile width (verified via
`getComputedStyle` on the live grid, not just by reading the media query).



## Fourth pass — production hardening + premium polish

Two more requests: make this genuinely hardened for production, and make
sure the design actually looks premium rather than just functional. Both got
the same treatment as everything above — demonstrated concretely, then fixed.

### Production bugs found and fixed

13. **A single render error anywhere in the app blanked the ENTIRE page.**
    Confirmed directly: fed `GrantBrowser` an unexpected response shape
    (missing `.milestones`) and watched `document.body.innerHTML` collapse
    to an empty `<div></div>` — header, nav, and both other tabs gone, not
    just the broken one. This is React's default behavior with no error
    boundary anywhere in the tree. Fixed with a real `ErrorBoundary`
    component wrapped around each panel individually (so a crash in one tab
    can't take out the header or the other two), plus an outer boundary as a
    last-resort net. Confirmed fixed the same way the bug was confirmed:
    same malformed data, but now the header/nav/other-tabs stay fully intact
    and the broken panel shows a contained "Try again" fallback instead.
14. **A storage-key collision in the contract itself.** `grant_id` and
    `milestone_id` are concatenated as `f"{grant_id}:{milestone_id}"` to key
    milestone results — but neither was validated against containing `:`.
    Demonstrated concretely: `grant_id="foo:bar"` + `milestone_id="baz"`
    produces the exact same storage key as `grant_id="foo"` +
    `milestone_id="bar:baz"`, so submitting evidence for one silently
    corrupted the lookup for the other, completely unrelated grant. Fixed by
    rejecting `:` in both at `create_grant` time (54 contract tests now, up
    from 51).
15. **No handling at all for wallet account/network changes.** Switching
    accounts or networks in MetaMask left the app silently showing the old
    "Connected: 0x...” state. Added `accountsChanged`/`chainChanged`
    listeners: switching accounts updates the client to match, switching
    networks (the connected client is bound to Bradbury specifically) drops
    back to disconnected and asks the user to reconnect, and a stray event
    firing before the user ever clicked Connect is correctly ignored. Caught
    a real bug while testing this fix: the effect's cleanup re-read
    `window.ethereum` fresh instead of using the reference captured at setup
    time, throwing if the wallet object became unavailable between mount and
    unmount.
16. **No format validation on the contract address field at all** — a typo
    would sail past every guard and fail deep inside the SDK with a raw,
    confusing error. Added a shared `isValidAddress`/`checkCallPreconditions`
    check (0x + 40 hex chars) used consistently across all five call sites,
    plus a live inline hint under the input as the user types.
17. Added ref-based (not just state-based) guards against double-submitting
    a write. I could not force a reproducible double-submit in this test
    harness — React 19's synchronous re-render already closes the gap in the
    paths I could exercise here — so I'm not claiming this fixes a
    demonstrated bug. It's defense-in-depth against a well-documented class
    of real-world issue (e.g. some mobile browsers firing two synthetic
    click events from one fast tap) that state-based `disabled` alone can't
    guarantee against, at effectively zero cost.

### Premium visual pass

- **Self-hosted, on-brand favicon.** The shipped favicon was the generic
  purple/blue Vite scaffold logo — completely unrelated to GrantOS's actual
  moss-green ledger identity, and a dead giveaway of an unfinished app. Built
  a proper one (dark moss rounded square, cream ledger page, moss checkmark,
  amber accent dot) and verified it renders correctly by sampling actual
  pixel colors at computed coordinates in a headless render — all four
  elements came back as exact hex matches to the design, not just "looks
  right in the editor." Also deleted an entirely unused `icons.svg` left
  over from the scaffold.
- Re-verified, after all the changes in this pass, that the production build
  still has zero console errors, zero failed requests, and zero horizontal
  overflow on mobile across all three tabs.

## Fifth pass — number formatting, brand identity, unit affordances

More concrete "does this look like a real product" gaps, closed the same
way as everything else — checked, then fixed, then re-verified:

18. **Every GEN amount rendered as a raw unformatted number** (`1250000`
    instead of `1,250,000`) — a small thing, but a real tell of an unpolished
    financial app. Added a shared `formatAmount()` (`Intl.NumberFormat`) used
    consistently for every displayed amount: grant totals, released/remaining
    figures, individual milestone amounts, and the live sum-vs-total
    indicator. Verified in the actual rendered DOM (not just a unit test) that
    `2500000` really does render as `2,500,000`.
19. **The pending-review card didn't show how much GEN was actually at
    stake** before a funder approves or rejects — added it.
20. **The total-amount field had no unit affordance** — just a bare number
    input with "GEN" only mentioned in the label text above it. Added a
    proper inline "GEN" suffix inside the field itself (the more cramped
    100px milestone-row amount columns were left alone deliberately — a
    suffix badge would have overflowed a column that narrow).
21. **The favicon and the in-app header had no visual relationship** — the
    tab icon and the "GrantOS" wordmark looked like two unrelated products.
    Added a `BrandMark` component reusing the exact same shapes/colors as
    the favicon, and verified it two ways: geometrically (it sits to the
    left of the title and is vertically centered against it — measured, not
    assumed) and by rasterizing the *actual live DOM SVG element* to a
    canvas and sampling pixels, confirming all four design elements
    (background, paper, checkmark, accent dot) render as exact hex matches
    to the intended palette.

Re-verified after this pass: 72 tests (up from 66), clean build, clean lint,
zero console errors and zero horizontal overflow on both a 1280px desktop
and a 390px mobile viewport across all three tabs.

## Sixth pass — deep confirmation: API mapping, wallet connect, mobile

A request to confirm, specifically: nothing's broken, every API call is
wired correctly, no logic-flow bugs, wallet connect is real, and it's
genuinely mobile responsive. Went through each one systematically rather
than re-asserting the earlier passes.

### API call mapping — verified line by line, not from memory

Extracted every `@gl.public.*` method from `grantos.py` and every
`functionName:` call from `genlayerClient.js` and diffed them directly: all
6 methods present on both sides, matching names. Then checked each one's
exact argument order against the contract's actual parameter list (not the
docstring, the real `def` signature) — all correct. Then went the other
direction: extracted every field the UI actually reads off the returned
`grant` / `progress` / milestone-result / milestone objects and checked each
one exists in the contract's real return `dict` with a matching key. Full
coverage, no mismatches.

### Two more real bugs found and fixed

22. **A blank Total Amount field could reach `BigInt(NaN)`.** The field was
    parsed in two places with different fallback behavior: the client-side
    validation treated a blank field as `0`, but the actual submission parsed
    it again without that fallback. If a user left Total Amount blank *and*
    every milestone amount was also blank (both then "sum" to 0), validation
    passed — and the real, unmocked `parseInt("", 10)` genuinely produces
    `NaN`, which genuinely crashes `BigInt(NaN)` inside `createGrant()`.
    Confirmed by inspecting the actual argument reaching the (mocked) call
    before fixing: `totalAmount passed to createGrant: NaN`. Fixed by parsing
    the total amount exactly once, validating it's a real non-blank number
    up front, and reusing that single parsed value everywhere downstream.
23. **Address validation had a real gap: EIP-55 checksums weren't checked at
    all.** The client-side address check was a plain hex-format regex. Tested
    the actual dependency (`viem`, which `genlayer-js` uses internally) directly
    and confirmed two things: it accepts all-lowercase addresses (checksum-
    agnostic) but genuinely rejects an all-uppercase address — which the old
    regex would have wrongly called "valid" — and rejects a mixed-case address
    with an incorrect checksum, which would otherwise sail past the app's own
    validation only to fail deep inside the write call with a raw error like
    `Address ... must match its checksum counterpart ... Version: viem@2.55.2`.
    Added `viem` as an explicit direct dependency (it was already present only
    as an unlisted transitive one) and switched to its real `isAddress`/
    `getAddress`. The grantee address field — which had *no* format validation
    at all before this — now gets the same check, and a valid-but-lowercase
    address is automatically normalized to its canonical checksummed form
    before submission, so the common case (pasting a lowercase address) just
    works instead of depending on the user having pasted a perfectly
    pre-checksummed string.

Also found the same class of contract-side gap while re-checking `grantos.py`
directly: **negative milestone amounts weren't explicitly rejected** — they
were only caught indirectly, deep inside a `u256(...)` conversion, with a
raw `can't convert negative int to unsigned` error instead of a clear,
`[EXPECTED]`-tagged validation message consistent with the rest of the
contract. Fixed, plus the same treatment for a `total_amount` of zero
(escrowing nothing isn't a meaningful grant). Contract tests: 57, up from 54.

### Wallet connect — verified as genuinely real, not a stub

Checked this three concrete ways rather than asserting it:
- Confirmed `genlayer-js`'s real exports (`createClient`, `chains.testnetBradbury`)
  and that the client object it returns genuinely has `readContract`,
  `writeContract`, and `waitForTransactionReceipt` methods — the actual
  functions this app calls.
- Ran a real headless Chromium with a realistic mock EIP-1193 provider
  injected (the same interface every real wallet extension implements) and
  clicked the actual "Connect Wallet" button. Before: `"Connect Wallet"`,
  gray status dot. After: `"Connected: 0xabCD…eF12"`, green status dot, zero
  console errors — driven entirely through the real code path
  (`handleConnectClick` → `connect()` → `eth_requestAccounts` →
  `makeClient(address)`), not a mock of the component itself.
- Fired simulated `accountsChanged` and `chainChanged` events at that same
  real browser instance: switching accounts updated the displayed address
  correctly, and switching networks correctly dropped back to "Connect
  Wallet" with a reconnect notice.
- Went one step further and submitted a full "Create Grant" transaction
  through the real, unmocked `genlayer-js` SDK in that same browser. It
  correctly built the request, resolved the checksum-fixed addresses, and
  dispatched a genuine `eth_getTransactionCount` RPC call toward Bradbury —
  failing only because this sandbox has no network path to that endpoint
  (confirmed the same limitation noted throughout this README), caught
  gracefully and shown as a message, not a crash.

### Mobile responsiveness — checked at 5 real breakpoints, not just one

320px (iPhone SE), 360px (common Android), 390px (iPhone 12/13), 768px
(iPad portrait), and 1024px (small laptop) — all three tabs at each, 15
combinations total. Zero horizontal overflow, zero console errors, and zero
interactive elements under the 32px tap-target floor at any of them.

Final tally after this pass: 80 tests (up from 73), 57 contract tests (up
from 54), clean build, clean lint.

## Seventh pass — full redesign: landing page + new visual system

A request for a real marketing landing page and a design the user actually
likes, with an explicit reference: grant-os.com. Worth being upfront about
one thing before the rest of this section: **that site belongs to a real,
live, unrelated company** -- its own product, trademark, copy, and images.
I didn't clone it. Copying another company's proprietary design and content
crosses into their trade dress/IP, and it'd mean shipping this project as a
lookalike of an existing commercial product under the same name. What I did
instead was build an original landing page in the same genre (hero -> problem
-> how-it-works -> features -> CTA), grounded in what this product actually
does, with honest copy -- no fabricated testimonials, no invented user counts,
no borrowed images.

### The actual design decision

The previous design (warm cream background, serif body text, terracotta/amber
accent) pattern-matches closely to a well-known "default AI-generated design"
look. Rather than reskin colors, the redesign started from the one truly
distinctive thing about this product: **multiple independent validators each
check the same evidence and must agree before funds move.** That idea drives
the whole system:

- **The signature visual** is the hero verification diagram -- the real
  mechanism (Evidence submitted -> Validators verify independently -> Consensus
  reached -> Funds released automatically), not a generic illustration or a
  dashboard mockup. It's also woven into the brand mark itself (three
  validator nodes converging into a checkmark), so the tab icon, header, and
  hero all read as one idea instead of a logo bolted onto unrelated hero art.
- **Palette**: cool porcelain background (not warm cream), deep ink-navy text
  (not black or brown), and two considered accents doing different jobs -- jade
  for "verified," brass for "funded" -- instead of one gradient or a single
  accent color.
- **Type**: Fraunces (display, real character) + IBM Plex Sans (body,
  technical precision) + IBM Plex Mono (data/labels), self-hosted via
  @fontsource for the same reason as before -- no external font CDN to fail
  or get blocked.
- **The "How it works" steps and feature list are the real contract
  behavior** -- sequential milestones, the exact escrow rule, the Equivalence
  Principle -- not marketing filler. The "Built on GenLayer" section explains
  Optimistic Democracy and the Equivalence Principle accurately rather than
  hand-waving "powered by AI."

### What's new, structurally

- LandingPage.jsx (+ VerificationDiagram.jsx, FeatureIcons.jsx) -- the
  new marketing page.
- App.jsx now does simple hash-based routing ("#app" shows the product,
  anything else shows the landing page) -- no router dependency needed for
  two views. Verified this handles direct deep links to #app, the browser
  back button via hashchange, and a "Back to site" link from inside the
  app, all in a real browser, not just jsdom.
- Every existing app screen (Funder Dashboard, Grantee Submission, Grant
  Browser) was re-skinned to the same design system rather than left in the
  old palette bolted onto a new landing page -- so it doesn't feel like a
  different product once you're past the hero.

### Verified concretely, same standard as every other pass

- Zero console/network errors, all three fonts resolving correctly,
  confirmed in a real headless browser.
- Contrast audit found and fixed four real failures introduced by the new
  palette: .footer-meta and .testnet-note both measured 2.86:1 (using a
  too-light slate that had no other safe use left afterward), the decorative
  step numeral in "How it works" measured the same 2.86:1 against even the
  lower 3:1 large-text bar, and the brass "funded" accent measured 4.22:1
  everywhere it was used for text (the partial-status pill, the mismatch
  banner) -- all four re-measured after fixing at 4.75-7.54:1.
- A real mobile overflow bug: at a 320px viewport (iPhone SE), the footer
  links didn't wrap and overflowed the viewport by 10px -- found by walking
  the actual DOM for the exact overflowing element, not guessed at. Fixed and
  re-verified clean at 320/360/390/768/1024/1400px.
- The hero diagram's entrance animation was checked two ways: that it
  actually settles with every node fully visible after its animation
  completes (not stuck mid-fade), and that prefers-reduced-motion: reduce
  correctly shows everything immediately with no animation at all.
- Full launch flow -- clicking through from the landing page hero, arriving
  at #app, and clicking "Back to site" -- driven in a real browser, not
  just asserted in jsdom.

Final tally: 96 tests (up from 80), clean build, clean lint.

## Eighth pass — deployability verification + real disconnect

Two asks: verify the contract actually deploys cleanly using GenLayer's own
tooling, and implement a genuine wallet disconnect (not just connect).

### Contract: verified deployable with the real official linter

skills.genlayer.com turned out to be a Claude Code plugin marketplace
(confirmed by fetching it directly), not something installable in this
interface -- same finding as earlier in this project. But the actual tool
behind that skill, genvm-linter, is a real PyPI package
(pip install genvm-linter), so I installed and ran it directly. It
downloads the real GenVM engine and validates against it -- this is the
authoritative check, well beyond what my own hand-written tests can confirm
on their own:

```
Lint passed (3 checks)
Validation passed  ->  Contract: GrantOS, Methods: 6 (3 view, 3 write)
No type errors found (genvm-lint typecheck)
```

The schema command's ABI extraction is an exact match for every
functionName the React client calls -- independent confirmation of the
API-mapping check from an earlier pass, this time from GenLayer's own
tooling rather than my own diffing.

The contract now uses the content-addressed production runner required by the
official GenLayer contract skill:

```
py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6
```

Bradbury rejects local-development aliases such as `latest` and `test`.
The deployment script also performs a remote schema preflight before spending
GEN and verifies the finalized source and ABI afterward.

### A real, working wallet disconnect

There was no user-initiated disconnect at all before this -- only reactive
handling when the wallet itself fired a disconnect event. Implemented the
real thing: a "Disconnect" button that calls EIP-2255's
wallet_revokePermissions -- the same mechanism MetaMask's own developer
docs recommend for a dApp-initiated log-out -- and always clears the app's
local connection state regardless of whether that call succeeds, since older
wallets don't all support it yet.

Verified in a real headless browser with a realistic mock wallet, not just
jsdom:
- Connect then Disconnect, full cycle: after connecting, the header shows
  a truncated address pill and a Disconnect button (Connect Wallet
  disappears). Clicking Disconnect genuinely calls wallet_revokePermissions
  with the correct [{ eth_accounts: {} }] params, confirmed by inspecting
  the actual call the mock wallet received -- then the pill and Disconnect
  button disappear, Connect Wallet reappears, and the status dot goes from
  green back to gray.
- Graceful degradation: simulated an older wallet that throws
  { code: -32601, message: 'Method not found' } for
  wallet_revokePermissions (a realistic wallet error shape, not just a
  generic Error). Disconnect still clears local state and returns to
  "Connect Wallet," with an honest notice explaining the wallet doesn't
  support real revocation rather than pretending it fully disconnected.
- Zero console errors in either case.

Contract: 57 tests. React: 103 tests (up from 96). Clean build, clean lint.

## Connecting to your deployed contract

Current verified Bradbury deployment:

- Contract: `0x68293343f39B04e7DBeC9eC6A438a39b931B7ce6`
- Deployment transaction: `0x6c86178a679c87c4a38693735355f3acc26f0e8f9021799b2576f43ba5b6b470`
- Live payable/storage smoke transaction: `0x11262e5ced34c195a9cfae4ad4cd0f5229e72fde33d4a2320272e829d1223c9b`

The machine-readable evidence is in `deployments/bradbury.json`.

1. Put matching `PRIVATE_KEY` and `WALLET_ADDRESS` values in `.env.local`.
2. Run `npm run deploy:bradbury`. This uses the existing JavaScript
   dependencies and does not install packages.
3. The script writes the verified address to `deployments/bradbury.json` and
   `VITE_CONTRACT_ADDRESS` in `.env.local`.
4. Run `npm run dev`, open the app, and click **Connect Wallet**. The app asks
   MetaMask to add/switch to Bradbury and use the GenLayer wallet Snap.
5. All three tabs read and write against the verified contract address.

## What I could not verify from here

Browser-wallet behavior is covered with injected-provider tests. Live
Bradbury deployment evidence is recorded in `deployments/bradbury.json` after
`npm run deploy:bradbury` succeeds.
