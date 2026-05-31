// Background service worker for YouTube Tab Sorter.
//
// All logic lives here. The pure helpers (isYouTubeVideoTab, parseTimeString,
// parseISODuration, normalizeDuration, durationComparator) are exported at the
// bottom for Node unit tests. The injected page function `detectDurationInPage`
// is intentionally self-contained — chrome.scripting serializes it away from
// this module scope, so it inlines its own copies of the time parsers (kept in
// lock-step with the exported canonical versions, and covered by tests).

const UNKNOWN_DURATION = -1;

// ── Pure, testable helpers ──────────────────────────────────────────────────

function isYouTubeVideoTab(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const host = u.hostname;
    const isYouTubeHost =
      host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com';
    // Only /watch?v=… is a sortable video. Shorts, home, playlist, channel,
    // search are deliberately NOT treated as videos.
    return isYouTubeHost && u.pathname === '/watch' && u.searchParams.has('v');
  } catch {
    return false;
  }
}

// "1:23:45" → 5025, "12:34" → 754, "" / "live" / junk → UNKNOWN_DURATION.
function parseTimeString(timeStr) {
  if (!timeStr) return UNKNOWN_DURATION;
  const parts = String(timeStr).trim().split(':').map((p) => parseInt(p, 10));
  if (parts.length < 2 || parts.length > 3 || parts.some(Number.isNaN)) return UNKNOWN_DURATION;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1];
}

// "PT1H23M45S" → 5025, "PT45S" → 45; bare "PT" or garbage → UNKNOWN_DURATION.
function parseISODuration(isoStr) {
  if (!isoStr) return UNKNOWN_DURATION;
  const match = String(isoStr).match(/^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match || (!match[1] && !match[2] && !match[3])) return UNKNOWN_DURATION;
  const h = parseInt(match[1] || '0', 10);
  const m = parseInt(match[2] || '0', 10);
  const s = parseInt(match[3] || '0', 10);
  return h * 3600 + m * 60 + s;
}

// Any detected value that isn't a finite positive number becomes UNKNOWN.
function normalizeDuration(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return UNKNOWN_DURATION;
  return value;
}

// Ascending by duration; unknown (-1) last; ties return 0 so the engine's
// stable sort preserves the original (tab) order.
function durationComparator(a, b) {
  const da = a.duration;
  const db = b.duration;
  if (da === UNKNOWN_DURATION && db === UNKNOWN_DURATION) return 0;
  if (da === UNKNOWN_DURATION) return 1;
  if (db === UNKNOWN_DURATION) return -1;
  return da - db;
}

// ── Injected page detector (self-contained; runs in the tab) ─────────────────

function detectDurationInPage() {
  // Method 1: the HTML5 <video> element's .duration.
  const video = document.querySelector('video');
  if (video && video.duration && !Number.isNaN(video.duration) && Number.isFinite(video.duration)) {
    return video.duration;
  }

  // Method 2: the player's time display (H:MM:SS / MM:SS).
  const timeDisplay = document.querySelector('.ytp-time-duration');
  if (timeDisplay) {
    const d = parseTime(timeDisplay.textContent);
    if (d > 0) return d;
  }

  // Method 3: <meta itemprop="duration"> (ISO-8601).
  const metaDuration = document.querySelector('meta[itemprop="duration"]');
  if (metaDuration) {
    const d = parseISO(metaDuration.getAttribute('content'));
    if (d > 0) return d;
  }

  // Method 4: "lengthSeconds":"…" inside the page's embedded scripts.
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    const text = script.textContent;
    if (text && text.includes('lengthSeconds')) {
      const match = text.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
      if (match) return parseInt(match[1], 10);
    }
  }

  return -1;

  // Inlined parsers (canonical copies live in the module scope, tested in Node).
  function parseTime(timeStr) {
    if (!timeStr) return -1;
    const parts = String(timeStr).trim().split(':').map((p) => parseInt(p, 10));
    if (parts.length < 2 || parts.length > 3 || parts.some(Number.isNaN)) return -1;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return parts[0] * 60 + parts[1];
  }
  function parseISO(isoStr) {
    if (!isoStr) return -1;
    const match = String(isoStr).match(/^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
    if (!match || (!match[1] && !match[2] && !match[3])) return -1;
    const h = parseInt(match[1] || '0', 10);
    const m = parseInt(match[2] || '0', 10);
    const s = parseInt(match[3] || '0', 10);
    return h * 3600 + m * 60 + s;
  }
}

// ── Orchestration ────────────────────────────────────────────────────────────

async function getVideoDuration(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: detectDurationInPage,
    });
    if (results && results[0] && typeof results[0].result === 'number') {
      return normalizeDuration(results[0].result);
    }
  } catch (error) {
    // Restricted page, detached target, missing host permission, closed tab…
    console.warn(
      `YouTube Tab Sorter: duration detection failed for tab ${tabId}:`,
      (error && error.message) || error
    );
  }
  return UNKNOWN_DURATION;
}

async function sortYouTubeTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });

  // Pinned tabs stay exactly where they are — moving them would unpin them or
  // disturb the pinned strip. We only ever reorder the unpinned region.
  const pinnedCount = tabs.filter((t) => t.pinned).length;
  const unpinned = tabs.filter((t) => !t.pinned);

  const youtubeTabs = [];
  const otherTabs = [];
  for (const tab of unpinned) {
    if (isYouTubeVideoTab(tab.url)) youtubeTabs.push(tab);
    else otherTabs.push(tab);
  }

  if (youtubeTabs.length === 0) {
    console.log('YouTube Tab Sorter: no YouTube video tabs to sort');
    flashBadge('–', '#9e9e9e'); // distinguish "nothing to do" from a successful sort
    return { sorted: 0 };
  }

  const tabsWithDuration = await Promise.all(
    youtubeTabs.map(async (tab) => ({ tab, duration: await getVideoDuration(tab.id) }))
  );
  tabsWithDuration.sort(durationComparator);

  // Final unpinned order: sorted YouTube tabs, then other tabs (relative order
  // preserved). The unpinned region begins right after the pinned strip.
  const ordered = [...tabsWithDuration.map((x) => x.tab), ...otherTabs];
  let index = pinnedCount;
  for (const tab of ordered) {
    try {
      await chrome.tabs.move(tab.id, { index });
      index++;
    } catch (error) {
      // The move failed. Two cases:
      //  • the tab was CLOSED mid-sort → it vacated its slot, so the next tab
      //    should take this same index (do NOT advance).
      //  • the move was transiently REJECTED but the tab is still alive (e.g.
      //    user is dragging it) → it kept its slot, so advance past it,
      //    otherwise the next tab would land in front of the survivor.
      let stillOpen = false;
      try {
        stillOpen = !!(chrome.tabs.get && (await chrome.tabs.get(tab.id)));
      } catch {
        stillOpen = false;
      }
      if (stillOpen) index++;
      console.warn(
        `YouTube Tab Sorter: could not move tab ${tab.id}:`,
        (error && error.message) || error
      );
    }
  }

  const totalKnown = tabsWithDuration.reduce((s, x) => (x.duration > 0 ? s + x.duration : s), 0);
  console.log(
    `YouTube Tab Sorter: sorted ${youtubeTabs.length} YouTube tab(s) by duration` +
      (totalKnown > 0 ? ` · ${formatRuntime(totalKnown)} queued` : '')
  );
  flashBadge(String(youtubeTabs.length), '#2e7d32'); // green: "sorted N"
  return { sorted: youtubeTabs.length };
}

// Brief toolbar-badge confirmation so the user sees the click did something.
// No-op outside the extension (tests without chrome.action).
function flashBadge(text, color) {
  if (typeof chrome === 'undefined' || !chrome.action || !chrome.action.setBadgeText) return;
  try {
    chrome.action.setBadgeText({ text });
    if (chrome.action.setBadgeBackgroundColor) chrome.action.setBadgeBackgroundColor({ color });
    if (typeof setTimeout === 'function') {
      const t = setTimeout(() => {
        try {
          chrome.action.setBadgeText({ text: '' });
        } catch {}
      }, 4000);
      if (t && typeof t.unref === 'function') t.unref(); // don't hold a test process open
    }
  } catch {}
}

function formatRuntime(seconds) {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

// ── Wiring (skipped in Node tests where chrome.action is absent) ──────────────

if (typeof chrome !== 'undefined' && chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener(async () => {
    try {
      await sortYouTubeTabs();
    } catch (error) {
      console.error('YouTube Tab Sorter: sort failed:', error);
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    UNKNOWN_DURATION,
    isYouTubeVideoTab,
    parseTimeString,
    parseISODuration,
    normalizeDuration,
    durationComparator,
    getVideoDuration,
    sortYouTubeTabs,
    detectDurationInPage,
    formatRuntime,
  };
}
