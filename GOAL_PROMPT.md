# GOAL PROMPT: Autonomous End-to-End Build, Test & Hardening of the YouTube Tab Sorter Chrome Extension

## ROLE & AUTONOMY GRANT
You are an autonomous senior engineering team operating with full authority to act without asking for input. Do not stop to ask clarifying questions. Where information is missing, make the best professional assumption, log it, and proceed. Your mandate is to deliver a fully functional, production-ready Chrome extension plus a complete self-test report with zero manual input from the user. The user should be able to walk away and return to a working, tested, hardened extension.

If you hit a blocker, do not halt — work around it, document the workaround, and continue. Only surface a final report at the end.

## PRODUCT CONTEXT
The extension is **YouTube Tab Sorter** — a one-click Chrome toolbar tool (Manifest V3, no popup, no options page, no stored settings). When the user clicks the toolbar icon, it reorders the tabs in the **current browser window**:

* Open YouTube **video** tabs (`youtube.com/watch?v=…`) are sorted **by video duration, shortest on the left → longest on the right**.
* YouTube tabs whose duration cannot be determined (live streams, premieres, unloaded pages) are parked at the **end of the YouTube group**.
* All **non-YouTube** tabs are moved to the **right** of the sorted YouTube tabs, preserving their relative order.

The target user is someone who opens a pile of YouTube videos and wants to watch them in length order — e.g. clear the short ones when they only have a few minutes. Duration is detected with four fallback methods, in order:
1. The HTML5 `<video>` element's `.duration`.
2. The player's `.ytp-time-duration` time display (`H:MM:SS` / `MM:SS`).
3. `<meta itemprop="duration">` (ISO-8601, e.g. `PT1H23M45S`).
4. `"lengthSeconds":"…"` inside YouTube's embedded page scripts.

Detection runs via `chrome.scripting.executeScript` injected into each YouTube tab. There is **no account, no import, no local database, no persistence** — the only data are the open tabs and their detected durations. Permissions are minimal: `tabs` + `scripting`, host-scoped to `youtube.com`.

**The whole point of the test is functionality and robustness:** the sort must be correct and deterministic across every combination of tab types, durations, page states, and window contents — with no crashes, no orphaned/lost tabs, and sensible behaviour when a duration cannot be detected.

## MISSION OBJECTIVES (in priority order)
1. Audit the existing codebase and identify what works, what's broken, and what's missing.
2. Repair, complete, and refactor until the extension is fully functional and the sort is provably correct.
3. Build an automated self-testing harness that runs without human input.
4. Run the full test suite, fix every failure, and re-run until green.
5. Run a simulated expert review panel (personas below) and feed their critiques back into the build.
6. Produce a final report with a clear PASS/FAIL matrix and a readiness verdict.

## MULTI-AGENT STRUCTURE
Spin up the following specialised agents. Run them in coordination, hand work between them, and let later agents feed corrections back to earlier ones in a loop.

**Agent 1 — Architect / Auditor** Map the whole extension: `manifest.json` (permissions, host permissions, action, service worker), `background.js` (the `chrome.action.onClicked` handler, `sortYouTubeTabs`, `isYouTubeVideoTab`, `getVideoDuration`, `executeInPage` + its `parseTimeString`/`parseISODuration` helpers), `content.js`, and the icons. Produce a dependency and data-flow map: **click → query current-window tabs → classify YouTube-watch vs other → inject duration detector → collect durations → sort (with −1/unknown handling) → `chrome.tabs.move` reorder.** Flag dead code, missing handlers, broken wiring, and ordering/race hazards in the sequential `tabs.move` loop. *(Known seed finding to verify and resolve: `background.js` `fetch`es `content.js` as text and passes it to `executeInPage` as a `scriptContent` argument that the injected function never uses — `content.js` duplicates the inlined detection logic and is effectively dead wiring. Decide: delete `content.js` and the fetch, or make injection actually use it. Pick one and justify.)*

**Agent 2 — Builder / Repairer** Fix and complete everything Agent 1 flags. Make duration detection and sorting robust against: live streams / premieres (no finite duration), YouTube Shorts (`/shorts/…`) and non-watch pages (home, playlist, channel, search), age-restricted / sign-in-wall / consent-interstitial pages, `NaN`/`Infinity`/`0` durations, discarded/unloaded/sleeping tabs, **pinned** tabs (which must not be shuffled out of the pinned region — `tabs.move` semantics), tab groups, audio-only/muted tabs, multiple windows (only the current window must be touched), a tab being **closed or moved mid-sort**, and very large tab counts (100+). Ensure non-YouTube tabs keep their relative order. Ensure unknown-duration YouTube tabs land deterministically at the end of the YouTube group.

**Agent 3 — QA / Test Engineer** Build an automated test harness with **no human input**. Two layers:
* **Unit tests for the pure logic** — extract and test `isYouTubeVideoTab(url)` (watch vs Shorts vs home vs playlist vs channel vs non-YouTube vs malformed URL), `parseTimeString("1:23:45" / "12:34" / "" / "live")`, `parseISODuration("PT1H23M45S" / "PT45S" / garbage)`, and the **sort comparator** including the −1-to-the-end rule and tie stability.
* **Integration tests** — mock `chrome.tabs.query`/`chrome.tabs.move`/`chrome.scripting.executeScript` to simulate a window of tabs, run `sortYouTubeTabs()`, and assert the **final tab index order**.

Build a **mock data generator** producing realistic tab sets: short/medium/long videos, unknown-duration (−1) videos, live streams, Shorts, non-watch YouTube pages, non-YouTube tabs, pinned tabs, malformed/`chrome://`/`about:blank` URLs, an empty window, a single-tab window, and a huge window (100+ tabs). For each scenario, assert the exact resulting order. Click the toolbar action, exercise every code path, and assert every result.

**Agent 4 — Adversary / Chaos Tester** Actively try to break it: zero YouTube tabs (must be a clean no-op, no error), a single tab, 200+ tabs, **all** durations unknown, a tab closed or moved *during* the `tabs.move` loop, `executeScript` rejecting (restricted page, detached target, no host permission), offline, detection returning `NaN`/`Infinity`, rapid repeated clicks (re-entrancy / double-sort), pinned tabs mixed with unpinned, and multi-window setups (other windows must be untouched). Confirm clear logs / graceful degradation instead of silent failure, lost tabs, or crashes.

**Agent 5 — Reviewer Panel Simulator** Run the persona review (below), translate each persona's feedback into concrete, actionable tickets, and hand them back to Agents 2 and 3.

**Agent 6 — Orchestrator / Reporter** Coordinate the loop, decide when the extension is "done," and write the final report.

## THE FEEDBACK LOOP (run until stable)
```
Audit → Build → Auto-Test → Chaos-Test → Persona Review →
   tickets back to Build → re-test → re-review →
   repeat until: all tests green AND no persona has a blocking objection
```
Do not declare victory after one pass. Iterate until two consecutive full loops produce no new blocking issues.

## FULL TEST MATRIX (every item must end PASS)
**Install & first run**
* Extension loads unpacked with no console/service-worker errors; toolbar icon appears with the correct title/tooltip.
* Clicking the icon triggers a sort (there is **no popup** and **no options page** by design — assert their absence is intentional, not a missing feature).
* With no YouTube tabs open, a click is a clean no-op (no error, no tab movement).

**Tab discovery & duration detection**
* Each of the four detection methods returns the correct seconds for a representative page; the fallback order is honoured.
* Live streams / premieres / unloaded pages → treated as unknown (−1), not crashed on.
* `/watch?v=` is treated as a video; YouTube home, playlist, channel, search, and `/shorts/` are **not** treated as sortable videos (confirm intended Shorts behaviour and document it).
* Malformed or non-HTTP URLs never throw.

**Sorting & ordering**
* YouTube video tabs end up ascending by duration; ties preserve a stable, predictable order.
* Unknown-duration YouTube tabs sit at the end of the YouTube group.
* Non-YouTube tabs are moved to the right of the YouTube group and keep their relative order.
* Pinned tabs are not corrupted; tab indices are valid and contiguous afterwards.
* Only the current window is reordered; other windows are untouched.

**Scale & edge**
* 100+ / 200+ tab windows sort correctly and in reasonable time.
* All-unknown-duration set produces a stable, non-crashing order.
* Single-tab and empty windows behave sensibly.

**Buttons & settings**
* The single toolbar action does exactly what its tooltip says.
* There are no persisted settings; confirm nothing is written to storage and nothing needs to "persist across reload."

**Error handling**
* A tab whose duration injection fails (restricted/unloaded/closed) is assigned unknown duration; the overall sort still completes with no crash and no lost tabs.
* A tab closed or moved mid-sort does not abort the operation.

For each row, log: test name, expected, actual, PASS/FAIL, and reproduction steps for any FAIL.

## EXPERT REVIEW PANEL (simulated personas)
Run a review where each persona stress-tests the extension through their own lens, gives blunt feedback, and you convert that feedback into tickets fed back into the loop. Keep each critique concrete and tied to a real part of the product. A persona objection marked "blocking" must be resolved before final sign-off.

* **Steve Jobs** — ruthless on first-run experience and simplicity. One click, zero config is good — but is the result *legible*? After a click, how does the user **know** it worked and what changed? Would obsess over whether silent reordering is delightful or disorienting, and whether a badge / subtle confirmation is warranted. "Why this icon? Why no feedback? Why would a normal person trust their tabs just moved?"
* **Peter Thiel** — asks what makes this defensible and non-obvious. Is "sort tabs by length" a feature or a product? Pushes on the real wedge: **watch-queue triage as a time-management ritual**, not a novelty. What does this do that a human reordering tabs by hand, or YouTube's own "Watch Later", fundamentally cannot?
* **Bill Gates** — drills into edge cases, scale, and correctness. What happens with 200 tabs, pinned tabs, tab groups, multiple windows, and `tabs.move` races? Wants the unglamorous robustness — no lost tabs, no off-by-one indices, no quadratic slowdown — fully covered.
* **Chrome Web Store Reviewer** *(replaces the Letterboxd CEO)* — checks Manifest V3 compliance, **least-privilege permissions** (is the broad `tabs` permission justified, or can `activeTab`/narrower scope work? justify the host permissions), accuracy of the privacy claims in the README ("collects no data / sends nothing to servers"), absence of remote-code execution (the `fetch(chrome.runtime.getURL('content.js'))` is local — confirm it's not flagged as remote code, or remove it), and overall store-listing readiness.
* **Werner Herzog** — interrogates the emotional truth of the experience. A queue of unwatched videos ordered shortest-to-longest: is this mastery over time, or a tidy denial of how much we will never watch? Does imposing order on the backlog feel meaningful, or merely postpone the reckoning? Is there a soul in this little act of triage?
* **Quentin Tarantino** — tests depth as a true power user and queue-hoarder: 200 open tabs, a 10-hour lo-fi livestream beside a 15-second Short, premieres, age-gated obscurities, embeds and odd watch-URL variants (`&t=`, `&list=`, `youtu.be` if ever supported). Does the ordering hold up for the obsessive with an encyclopaedic, chaotic queue?

For each persona, output: their verdict, their top 3 objections, and the specific tickets generated.

## FINAL DELIVERABLES
1. The fully functional, repaired extension.
2. The automated test harness and the mock tab/duration generators.
3. A PASS/FAIL matrix covering the full test list above.
4. A bug log: everything found, with repro steps and the fix applied.
5. The persona review with verdicts, objections, and how each was resolved.
6. A one-paragraph readiness verdict: is this ready for a real first-time user, yes or no, and why.
7. A list of every assumption you made along the way.

## START HERE (precise first step — codebase location)
The extension lives at **https://github.com/leathalobaidi/youtube-tab-sorter** and is cloned locally to **`~/youtube-tab-sorter`**. Layout:
```
~/youtube-tab-sorter/
├── manifest.json   # MV3; permissions: ["tabs","scripting"]; host: youtube.com; action has NO default_popup; service_worker: background.js
├── background.js   # service worker — ALL logic: chrome.action.onClicked → sortYouTubeTabs(); isYouTubeVideoTab(); getVideoDuration(); executeInPage() + parseTimeString()/parseISODuration()
├── content.js      # duration-detection IIFE — currently fetched-as-text and passed to executeInPage but the arg is UNUSED → dead wiring to resolve
├── icons/          # icon16/48/128.png
├── README.md       # feature + privacy claims to verify against behaviour
└── LICENSE         # MIT
```
There is no popup, no options page, no storage, and **no tests yet** — the harness is greenfield. First moves: (1) load the unpacked extension and confirm the click path works; (2) extract the pure functions (`isYouTubeVideoTab`, `parseTimeString`, `parseISODuration`, the sort comparator) so they're unit-testable; (3) stand up a Node test harness that mocks `chrome.tabs` and `chrome.scripting` and asserts final tab order; (4) resolve the `content.js` dead-wiring as the first Builder ticket.

**Begin now. Do not ask for input. Work the loop until the extension is genuinely done.**
