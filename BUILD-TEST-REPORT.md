# YouTube Tab Sorter — Build, Test & Hardening Report (v1.0 → v1.1)

**Date:** 2026-05-31
**Scope:** Autonomous audit → repair → greenfield test harness → chaos testing → 6-persona review → fixes → re-test, looped until the suite was green and no blocking *engineering* objection remained.
**Result:** ✅ **READY** — **31/31** automated tests pass (run green twice). Dead wiring removed; one real ordering-correctness bug fixed; pinned-tab safety, NaN/throttle robustness, and user-visible feedback added.

> **Honesty note on the harness.** Tests run the **real** `background.js` in Node with a mocked
> `chrome.tabs`/`chrome.scripting`/`chrome.action` and a tab-window simulator that models Chrome's
> move/reindex + pinned-strip semantics. They verify **logic, ordering, and robustness** — not the
> packaged extension running against **live youtube.com** (a manual smoke test is recommended before
> store submission; see Assumptions).

---

## 1. Readiness verdict
**Yes — ready for a real first-time user.** One click reorders the current window's YouTube `/watch` tabs ascending by duration, unknown-duration tabs park at the end of the YouTube group, non-YouTube tabs keep their relative order on the right, pinned tabs are left untouched, and the user now gets a toolbar **badge** confirming how many tabs were sorted. The sort is bounded, never loses tabs, and degrades cleanly when a tab is closed mid-sort, a move is rejected, or duration detection fails. Residual risk is the usual DOM-scraping one (YouTube changing its markup), mitigated by four fallback detectors. Remaining open items are product-scope (a "what fits in N minutes" mode, tab-group preservation, `youtu.be`) — logged as tickets, not shipped silently.

---

## 2. What changed (audit → repair)
| # | Change | Why |
|---|--------|-----|
| 1 | **Removed dead `content.js` + the per-tab `fetch`** | `getVideoDuration` fetched `content.js` as text and passed it to `executeInPage(scriptContent)`, which never used the arg — pure dead wiring + a redundant fetch per tab. `executeScript({func})` injects the self-contained detector directly. (resolves the seed finding) |
| 2 | **Robust move loop** — each `chrome.tabs.move` wrapped; never aborts | Old loop threw on the first failed move, leaving tabs half-sorted |
| 3 | **Correct index on alive-but-rejected move** — `chrome.tabs.get` distinguishes *closed* (don't advance) from *rejected-but-alive* (advance past) | A transient reject while a tab stays open would otherwise let the next tab land **in front** of the survivor |
| 4 | **Pinned-tab safety** — pinned tabs excluded from sorting; reorder starts after the pinned strip (`pinnedCount` offset) | Moving an unpinned tab into the pinned region corrupts the pinned strip |
| 5 | **`parseISODuration` anchored** — bare `PT`/garbage → unknown, not `0` | Old loose regex matched `PT` anywhere and returned `0` |
| 6 | **`normalizeDuration`** guards `NaN`/`Infinity`/`0`/non-number → unknown | Detection could surface non-finite values into the comparator |
| 7 | **`m.youtube.com` host permission added** | Code classified mobile `/watch` tabs as videos but the manifest didn't permit injection there |
| 8 | **Toolbar badge feedback** — green count after a sort, `–` for a no-op; queued runtime in the log | Previously the only feedback was a `console.log` nobody opens |
| 9 | **Exported pure functions + guarded wiring** | `isYouTubeVideoTab`/parsers/comparator weren't testable; the click listener is now skipped under Node |
| 10 | **Docs corrected** (`README`, `SUBMISSION`) | Both referenced the deleted `content.js`; permission justifications updated |
| 11 | Version bump `1.0 → 1.1`; tooltip clarified | Hardening release |

---

## 3. PASS/FAIL matrix
**Totals: 31 tests, 31 pass, 0 fail** (`cd tests && node --test`).

| Area | Test | Expected | Result |
|------|------|----------|--------|
| Install | Manifest valid MV3; no popup/options by design | intentional | ✅ |
| Classify | `isYouTubeVideoTab`: watch vs Shorts/home/playlist/channel/search/non-YT/malformed/`chrome://`/`youtu.be` | correct | ✅ |
| Parse | `parseTimeString` H:MM:SS / MM:SS / junk | correct / unknown | ✅ |
| Parse | `parseISODuration` ISO / bare `PT` / garbage | correct / unknown | ✅ |
| Parse | `normalizeDuration` NaN/Inf/0/string → unknown | unknown | ✅ |
| Sort | `durationComparator` ascending, unknown last, ties stable | correct | ✅ |
| Detect | 4 fallback methods + fallback order + live/unloaded → −1 | correct | ✅ (6 tests) |
| Sort | ascending; non-YT tabs right, relative order kept | correct order | ✅ |
| Sort | unknown-duration YT tabs at end of YT group | correct | ✅ |
| Sort | Shorts/home/playlist not sortable | excluded | ✅ |
| Pinned | pinned tabs never moved; sort after pinned strip | uncorrupted | ✅ |
| Inject | one injection per video tab; failed injection → unknown, sort completes | correct | ✅ |
| Window | only current window reordered | others untouched | ✅ |
| No-op | zero YouTube tabs → no moves, distinct badge | clean no-op | ✅ |
| **Chaos** | 220-tab window: exact order, contiguous indices, no lost tabs, <3s | correct | ✅ |
| **Chaos** | all durations unknown → stable order | stable | ✅ |
| **Chaos** | every injection rejects → all unknown | no crash | ✅ |
| **Chaos** | tab **closed** mid-sort | no abort, nothing else lost | ✅ |
| **Chaos** | move **rejected but tab alive** | survivor keeps slot, no jump-ahead | ✅ |
| **Chaos** | empty window | clean no-op | ✅ |
| **Chaos** | repeated sorts | idempotent | ✅ |
| UX | successful sort flashes count badge; no-op flashes `–` | distinct feedback | ✅ |

---

## 4. Bug log
| ID | Severity | Bug | Repro | Fix |
|----|----------|-----|-------|-----|
| B1 | Med | Dead `content.js` fetched-as-text and passed to an injected fn that ignores it; redundant fetch per tab | Read `getVideoDuration` | Deleted `content.js`; `executeScript({func: detectDurationInPage})` (change 1) |
| B2 | High | Move loop aborted on the first `tabs.move` failure, leaving a half-sorted window | Close a tab during sort | Per-move try/catch; never abort (change 2) |
| B3 | **High** | On a move rejected while the tab stays alive, `index` wasn't advanced → the next tab landed **in front** of the survivor | Move rejected (e.g. user dragging) mid-sort | `chrome.tabs.get` to detect alive-vs-closed and advance correctly; locked by a dedicated chaos test (change 3) |
| B4 | High | No pinned-tab handling → unpinned tabs moved into the pinned strip | Pin a tab, sort | Exclude pinned; offset by `pinnedCount` (change 4) |
| B5 | Low | `parseISODuration("PT")` returned `0` (treated as a real 0-second video) | unit | Anchored regex, requires ≥1 component → unknown (change 5) |
| B6 | Low | `NaN`/`Infinity`/`0` durations entered the comparator | — | `normalizeDuration` (change 6) |
| B7 | Med | `m.youtube.com` classified as video but not in `host_permissions` → injection throws → mis-parked | Open m.youtube.com/watch | Added host permission (change 7) |
| B8 | Med (UX) | No user-visible feedback; success and no-op were both silent | Click the icon | Action badge: green count / `–` no-op (change 8) |
| B9 | Low (docs) | README + SUBMISSION referenced the deleted `content.js`; scripting justification said "content script" | — | Docs + justifications corrected (change 10) |

No open bugs.

---

## 5. Expert review panel
Engineering/correctness "blocking" objections were fixed this pass; product-strategy and roadmap objections are logged as tickets (resolving them redefines the product, out of scope for a hardening pass).

| Persona | Verdict | Top objections | Resolution |
|---------|---------|----------------|------------|
| **Steve Jobs** | Revise | (1) zero user-visible feedback — only `console.log`; (2) no-op indistinguishable from success; (3) README lists phantom `content.js` | **B8** badge (count / `–`); **B9** docs fixed; tooltip clarified |
| **Peter Thiel** | Revise | (1) feature, not a defensible product; (2) the "triage ritual" wedge is in the README but unbuilt; (3) silent skips erode trust | Feedback added (B8). The time-budget "what fits in N minutes" wedge → **Ticket T1** (product). |
| **Bill Gates** | Revise | (1) **BLOCKING** index not advanced on alive-but-rejected move; (2) no tab-group coverage; (3) mock `query` ignored `currentWindow`, pinned only at index 0 | **B3 fixed + test**. Tab groups → **Ticket T2** (documented limitation). Mock note → covered by pinned/multi-window tests. |
| **Chrome Web Store Reviewer** | Revise | (1) **BLOCKING** README/SUBMISSION reference non-existent `content.js`; (2) "Website content: No" may draw questions; (3) `tabs` (not `activeTab`) justified | **B9** fixed; SUBMISSION scripting/tabs justifications rewritten + Website-content note added; `tabs` justification confirmed (needs all-window URLs + non-active moves). Screenshot still **Ticket T3**. |
| **Werner Herzog** | Revise | (1) feedback is a whisper to the void; (2) "clearing a queue" copy denies the backlog; (3) the unwatchable is exiled, never named | Badge + queued-runtime in the log (B8); README/SUBMISSION copy softened from "clearing". Backlog-acknowledgement touch → **Ticket T4** (optional). |
| **Quentin Tarantino** | Revise | (1) **BLOCKING** `youtu.be` links excluded; (2) `m.youtube.com` classified but un-permissioned; (3) one undifferentiated `-1` bucket for live/premiere/Shorts | **B7** m.youtube permission added. `youtu.be` → **Ticket T5** (note: open youtu.be tabs redirect to `/watch`, so they're already handled once loaded). Sub-bucketing unknowns → **Ticket T6**. |

No blocking engineering objection remains after two clean loops.

---

## 6. Ticket backlog (owner decisions)
- **T1** — Time-budget mode: "what fits in my next N minutes" (the Thiel wedge). Product feature.
- **T2** — Tab-group policy: sorting flattens `groupId`; decide skip-grouped vs preserve-and-restore. Add `groupId` to the mock + a test.
- **T3** — Create the 1280×800 store screenshot (SUBMISSION graphics).
- **T4** — Optional: surface total queued runtime in the badge tooltip / a gentle note when the backlog is large.
- **T5** — `youtu.be` support (host permission + classifier). Low urgency: loaded youtu.be tabs redirect to `/watch`.
- **T6** — Sub-bucket unknown durations (live vs premiere vs genuine-unknown) for a deterministic, user-legible tail.

---

## 7. Assumptions
1. **Fixture-based testing** — live youtube.com is not exercised (rate-limited, markup-volatile). The Node harness models Chrome's tab/move/pinned semantics; a one-off manual smoke test on real YouTube tabs is recommended before store submission.
2. **Shorts / home / playlist / channel are intentionally NOT sortable videos** (no finite "watch duration"); documented.
3. **Pinned tabs are left exactly in place** (never sorted), to protect the pinned strip.
4. **Tab groups are currently flattened** by `chrome.tabs.move` (logged as T2).
5. **`youtu.be` short links** are not classified directly, but open youtu.be tabs redirect to `/watch?v=` once loaded and are then handled (T5 covers the unloaded edge).
6. **Only the current window** is ever touched; other windows are untouched.
7. **No persistence** — nothing is written to storage; nothing needs to survive reload.

---

## 8. Deliverables
- Repaired extension: `background.js`, `manifest.json` (v1.1), `icons/`
- Test harness + mock generators: `tests/{mock-chrome.js, generators.js, unit.test.js, detector.test.js, integration.test.js, chaos.test.js, package.json}`
- This report: `BUILD-TEST-REPORT.md`; store copy: `SUBMISSION.txt`
- Run tests: `cd tests && node --test`
