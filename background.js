// Background service worker for YouTube Tab Sorter.
//
// All logic lives here. The pure helpers (isYouTubeVideoTab, parseTimeString,
// parseISODuration, normalizeDuration, durationComparator, makeDurationComparator,
// videoIdFromUrl, lengthSecondsForVideoId, planGroupedAssignments) are exported
// at the bottom for Node unit tests. The injected page function
// `detectDurationInPage` is intentionally self-contained — chrome.scripting
// serializes it away from this module scope, so it inlines its own copies of
// the time parsers (kept in lock-step with the exported canonical versions,
// and covered by tests).

const UNKNOWN_DURATION = -1;
const DEFAULT_OPTIONS = { longestFirst: false, allWindows: false };

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

// Direction-aware comparator. Unknown durations sort last either way — a tab
// we can't measure should never lead the strip.
function makeDurationComparator(longestFirst) {
  if (!longestFirst) return durationComparator;
  return (a, b) => {
    const da = a.duration;
    const db = b.duration;
    if (da === UNKNOWN_DURATION && db === UNKNOWN_DURATION) return 0;
    if (da === UNKNOWN_DURATION) return 1;
    if (db === UNKNOWN_DURATION) return -1;
    return db - da;
  };
}

function videoIdFromUrl(url) {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get('v');
  } catch {
    return null;
  }
}

// Extract "lengthSeconds" anchored to a specific videoId inside page/HTML text.
// YouTube pages embed durations for MANY videos (sidebar recommendations in
// ytInitialData, stale player responses left behind by SPA navigation), so a
// bare first-match regex can return another video's length. Anchoring to
// `"videoId":"<id>"` and only matching within the same videoDetails object
// (a bounded window) returns the duration of the requested video or nothing.
function lengthSecondsForVideoId(text, videoId) {
  if (!text || !videoId) return UNKNOWN_DURATION;
  const anchor = '"videoId":"' + videoId + '"';
  let from = 0;
  for (;;) {
    const idx = text.indexOf(anchor, from);
    if (idx === -1) return UNKNOWN_DURATION;
    const m = text.slice(idx, idx + 4000).match(/"lengthSeconds"\s*:\s*"(\d+)"/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > 0) return n; // live streams carry "0" — keep scanning
    }
    from = idx + anchor.length;
  }
}

// ── Injected page detector (self-contained; runs in the tab) ─────────────────

function detectDurationInPage() {
  let videoId = null;
  try {
    videoId = new URLSearchParams(location.search).get('v');
  } catch {
    videoId = null;
  }

  // Method 1: videoId-anchored "lengthSeconds" in the page's embedded scripts.
  // This is the canonical content duration: immune to pre-roll ads (which
  // temporarily swap the <video> element's duration for the AD's), and immune
  // to stale player responses left in the DOM by YouTube's SPA navigation —
  // we only accept a length that sits next to THIS tab's videoId.
  if (videoId) {
    const anchor = '"videoId":"' + videoId + '"';
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent;
      if (!text || text.indexOf(anchor) === -1) continue;
      let from = 0;
      let idx;
      while ((idx = text.indexOf(anchor, from)) !== -1) {
        const m = text.slice(idx, idx + 4000).match(/"lengthSeconds"\s*:\s*"(\d+)"/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > 0) return n;
        }
        from = idx + anchor.length;
      }
    }
  }

  // While an ad is playing, the <video> element and the player's time display
  // describe the AD, not the content video — skip both rather than lie.
  const player = document.querySelector('.html5-video-player');
  const adShowing = !!(player && player.classList && player.classList.contains('ad-showing'));

  // Method 2: the HTML5 <video> element's .duration.
  if (!adShowing) {
    const video = document.querySelector('video');
    if (video && video.duration && !Number.isNaN(video.duration) && Number.isFinite(video.duration)) {
      return video.duration;
    }

    // Method 3: the player's time display (H:MM:SS / MM:SS).
    const timeDisplay = document.querySelector('.ytp-time-duration');
    if (timeDisplay) {
      const d = parseTime(timeDisplay.textContent);
      if (d > 0) return d;
    }
  }

  // Method 4: <meta itemprop="duration"> (ISO-8601).
  const metaDuration = document.querySelector('meta[itemprop="duration"]');
  if (metaDuration) {
    const d = parseISO(metaDuration.getAttribute('content'));
    if (d > 0) return d;
  }

  // Method 5 (legacy last resort, only when the videoId is unknowable):
  // first "lengthSeconds" anywhere. With a known videoId this is skipped —
  // an unanchored first match can be a sidebar recommendation's duration.
  if (!videoId) {
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent;
      if (text && text.includes('lengthSeconds')) {
        const match = text.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
        if (match) return parseInt(match[1], 10);
      }
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

// Durations fetched over the network, cached for the service worker's lifetime.
const durationCache = new Map(); // videoId -> seconds

// Network fallback for tabs we cannot inject into: discarded/unloaded tabs
// (memory saver), error pages, or pages whose DOM yielded nothing. Fetches the
// watch page anonymously and reads the videoId-anchored lengthSeconds.
// Gated on chrome.runtime.id so Node test runs can never touch the network.
async function fetchDurationFallback(videoId) {
  if (!videoId) return UNKNOWN_DURATION;
  if (durationCache.has(videoId)) return durationCache.get(videoId);
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
    return UNKNOWN_DURATION;
  }
  if (typeof fetch !== 'function') return UNKNOWN_DURATION;
  try {
    const resp = await fetch('https://www.youtube.com/watch?v=' + encodeURIComponent(videoId), {
      credentials: 'omit',
    });
    if (!resp.ok) return UNKNOWN_DURATION;
    const html = await resp.text();
    const d = normalizeDuration(lengthSecondsForVideoId(html, videoId));
    if (d !== UNKNOWN_DURATION) durationCache.set(videoId, d);
    return d;
  } catch (error) {
    console.warn('YouTube Tab Sorter: fetch fallback failed for', videoId, (error && error.message) || error);
    return UNKNOWN_DURATION;
  }
}

// Accepts a full tab object (preferred — enables the discarded-tab fast path
// and the URL-based fetch fallback) or a bare tabId for backward compatibility.
async function getVideoDuration(tabOrId) {
  const tab = typeof tabOrId === 'number' ? { id: tabOrId } : tabOrId || {};
  const skipInjection = tab.discarded === true || tab.status === 'unloaded' || tab.frozen === true;
  if (!skipInjection) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: detectDurationInPage,
      });
      if (results && results[0] && typeof results[0].result === 'number') {
        const d = normalizeDuration(results[0].result);
        if (d !== UNKNOWN_DURATION) return d;
      }
    } catch (error) {
      // Restricted page, detached target, missing host permission, closed tab…
      console.warn(
        `YouTube Tab Sorter: duration detection failed for tab ${tab.id}:`,
        (error && error.message) || error
      );
    }
  }
  return fetchDurationFallback(videoIdFromUrl(tab.url));
}

async function getOptions() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      const stored = await chrome.storage.sync.get({ sortOptions: DEFAULT_OPTIONS });
      return { ...DEFAULT_OPTIONS, ...(stored && stored.sortOptions) };
    }
  } catch {
    /* storage unavailable — use defaults */
  }
  return { ...DEFAULT_OPTIONS };
}

// Group-aware planning: tabs only ever swap places INSIDE their own tab group
// (or inside the ungrouped slots), so sorting never rips a tab out of its
// group or splits a group block. Pure and exported for unit tests.
// unpinnedTabs: [{id, index, url, groupId?}], durationsById: Map<id, seconds>.
// Returns [{tabId, index}] sorted by target index.
function planGroupedAssignments(unpinnedTabs, durationsById, comparator) {
  const byGroup = new Map();
  for (const tab of unpinnedTabs) {
    const gid = typeof tab.groupId === 'number' && tab.groupId !== -1 ? tab.groupId : 'ungrouped';
    if (!byGroup.has(gid)) byGroup.set(gid, []);
    byGroup.get(gid).push(tab);
  }
  const assignments = [];
  for (const tabs of byGroup.values()) {
    const slots = tabs.map((t) => t.index).sort((a, b) => a - b);
    const youtube = [];
    const others = [];
    for (const t of tabs) (isYouTubeVideoTab(t.url) ? youtube : others).push(t);
    const withDuration = youtube.map((tab) => ({
      tab,
      duration: durationsById.has(tab.id) ? durationsById.get(tab.id) : UNKNOWN_DURATION,
    }));
    withDuration.sort(comparator);
    const ordered = [...withDuration.map((x) => x.tab), ...others];
    ordered.forEach((tab, i) => assignments.push({ tabId: tab.id, index: slots[i] }));
  }
  return assignments.sort((a, b) => a.index - b.index);
}

async function sortWindowTabs(queryInfo, opts) {
  const tabs = await chrome.tabs.query(queryInfo);

  // Pinned tabs stay exactly where they are — moving them would unpin them or
  // disturb the pinned strip. We only ever reorder the unpinned region.
  const pinnedCount = tabs.filter((t) => t.pinned).length;
  const unpinned = tabs.filter((t) => !t.pinned);
  const comparator = makeDurationComparator(opts.longestFirst);

  const youtubeTabs = [];
  const otherTabs = [];
  for (const tab of unpinned) {
    if (isYouTubeVideoTab(tab.url)) youtubeTabs.push(tab);
    else otherTabs.push(tab);
  }

  if (youtubeTabs.length === 0) return { sorted: 0, totalKnown: 0 };

  const durationsById = new Map();
  await Promise.all(
    youtubeTabs.map(async (tab) => durationsById.set(tab.id, await getVideoDuration(tab)))
  );

  const hasGroups = unpinned.some((t) => typeof t.groupId === 'number' && t.groupId !== -1);

  if (!hasGroups) {
    const tabsWithDuration = youtubeTabs.map((tab) => ({ tab, duration: durationsById.get(tab.id) }));
    tabsWithDuration.sort(comparator);

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
  } else {
    // Tab groups present: reorder strictly within each group block and within
    // the ungrouped slots. Group spans and memberships are never disturbed.
    const assignments = planGroupedAssignments(unpinned, durationsById, comparator);
    let indexShift = 0; // a tab closed mid-sort vacates a slot for everything after it
    for (const a of assignments) {
      try {
        await chrome.tabs.move(a.tabId, { index: a.index - indexShift });
      } catch (error) {
        let stillOpen = false;
        try {
          stillOpen = !!(chrome.tabs.get && (await chrome.tabs.get(a.tabId)));
        } catch {
          stillOpen = false;
        }
        if (!stillOpen) indexShift++;
        console.warn(
          `YouTube Tab Sorter: could not move tab ${a.tabId}:`,
          (error && error.message) || error
        );
      }
    }
  }

  let totalKnown = 0;
  for (const d of durationsById.values()) if (d > 0) totalKnown += d;
  return { sorted: youtubeTabs.length, totalKnown };
}

async function sortYouTubeTabs() {
  const opts = await getOptions();

  const queries = [];
  if (opts.allWindows && typeof chrome !== 'undefined' && chrome.windows && chrome.windows.getAll) {
    const wins = await chrome.windows.getAll({ windowTypes: ['normal'] });
    for (const w of wins) queries.push({ windowId: w.id });
  }
  if (queries.length === 0) queries.push({ currentWindow: true });

  let sorted = 0;
  let totalKnown = 0;
  for (const q of queries) {
    const res = await sortWindowTabs(q, opts);
    sorted += res.sorted;
    totalKnown += res.totalKnown;
  }

  if (sorted === 0) {
    console.log('YouTube Tab Sorter: no YouTube video tabs to sort');
    flashBadge('–', '#9e9e9e'); // distinguish "nothing to do" from a successful sort
    return { sorted: 0 };
  }

  console.log(
    `YouTube Tab Sorter: sorted ${sorted} YouTube tab(s) by duration` +
      (opts.longestFirst ? ' (longest first)' : '') +
      (totalKnown > 0 ? ` · ${formatRuntime(totalKnown)} queued` : '')
  );
  flashBadge(String(sorted), '#2e7d32'); // green: "sorted N"
  return { sorted };
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

// ── Wiring (skipped in Node tests where the relevant APIs are absent) ────────

if (typeof chrome !== 'undefined' && chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener(async () => {
    try {
      await sortYouTubeTabs();
    } catch (error) {
      console.error('YouTube Tab Sorter: sort failed:', error);
    }
  });
}

if (typeof chrome !== 'undefined' && chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'sort-tabs') return;
    try {
      await sortYouTubeTabs();
    } catch (error) {
      console.error('YouTube Tab Sorter: sort failed:', error);
    }
  });
}

// Right-click options on the toolbar button: sort direction and window scope.
if (
  typeof chrome !== 'undefined' &&
  chrome.contextMenus &&
  chrome.runtime &&
  chrome.runtime.onInstalled
) {
  chrome.runtime.onInstalled.addListener(() => {
    getOptions().then((opts) => {
      chrome.contextMenus.create(
        {
          id: 'longest-first',
          title: 'Sort longest → shortest',
          type: 'checkbox',
          checked: opts.longestFirst,
          contexts: ['action'],
        },
        () => void chrome.runtime.lastError
      );
      chrome.contextMenus.create(
        {
          id: 'all-windows',
          title: 'Sort every window',
          type: 'checkbox',
          checked: opts.allWindows,
          contexts: ['action'],
        },
        () => void chrome.runtime.lastError
      );
    });
  });

  chrome.contextMenus.onClicked.addListener(async (info) => {
    const opts = await getOptions();
    if (info.menuItemId === 'longest-first') opts.longestFirst = info.checked === true;
    else if (info.menuItemId === 'all-windows') opts.allWindows = info.checked === true;
    else return;
    try {
      await chrome.storage.sync.set({ sortOptions: opts });
    } catch (error) {
      console.warn('YouTube Tab Sorter: could not persist options:', error);
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    UNKNOWN_DURATION,
    DEFAULT_OPTIONS,
    isYouTubeVideoTab,
    parseTimeString,
    parseISODuration,
    normalizeDuration,
    durationComparator,
    makeDurationComparator,
    videoIdFromUrl,
    lengthSecondsForVideoId,
    planGroupedAssignments,
    getVideoDuration,
    fetchDurationFallback,
    getOptions,
    sortYouTubeTabs,
    detectDurationInPage,
    formatRuntime,
  };
}
