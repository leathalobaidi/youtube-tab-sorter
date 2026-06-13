"use strict";

// v1.2 features: videoId-anchored duration parsing, ad-state guard,
// network fetch fallback, direction option, tab-group-safe planning.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTabEnv, loadBackground } = require("./mock-chrome.js");
const bg = require("../background.js");

// ── lengthSecondsForVideoId ──────────────────────────────────────────────────

test("lengthSecondsForVideoId: anchored to the requested videoId only", () => {
  const text =
    '{"videoId":"OTHERVIDEO1","title":"sidebar","lengthSeconds":"15"}' +
    '{"videoId":"TARGETVID01","title":"mine","lengthSeconds":"213"}';
  assert.equal(bg.lengthSecondsForVideoId(text, "TARGETVID01"), 213);
});

test("lengthSecondsForVideoId: no anchor → unknown", () => {
  assert.equal(bg.lengthSecondsForVideoId('"lengthSeconds":"99"', "TARGETVID01"), -1);
  assert.equal(bg.lengthSecondsForVideoId("", "TARGETVID01"), -1);
  assert.equal(bg.lengthSecondsForVideoId(null, "TARGETVID01"), -1);
  assert.equal(bg.lengthSecondsForVideoId("text", null), -1);
});

test("lengthSecondsForVideoId: lengthSeconds outside the 4000-char window is not matched", () => {
  const filler = "x".repeat(4100);
  const text = '"videoId":"TARGETVID01"' + filler + '"lengthSeconds":"500"';
  assert.equal(bg.lengthSecondsForVideoId(text, "TARGETVID01"), -1);
});

test("lengthSecondsForVideoId: live stream '0' is skipped; later anchor wins", () => {
  const text =
    '{"videoId":"TARGETVID01","isLive":true,"lengthSeconds":"0"}' +
    '{"videoId":"TARGETVID01","lengthSeconds":"4200"}';
  assert.equal(bg.lengthSecondsForVideoId(text, "TARGETVID01"), 4200);
});

// ── videoIdFromUrl ───────────────────────────────────────────────────────────

test("videoIdFromUrl: extracts v=, null otherwise", () => {
  assert.equal(bg.videoIdFromUrl("https://www.youtube.com/watch?v=abc123XYZ_-"), "abc123XYZ_-");
  assert.equal(bg.videoIdFromUrl("https://www.youtube.com/playlist?list=PL1"), null);
  assert.equal(bg.videoIdFromUrl("not a url"), null);
  assert.equal(bg.videoIdFromUrl(null), null);
});

// ── makeDurationComparator ───────────────────────────────────────────────────

test("makeDurationComparator(false) is the ascending comparator", () => {
  assert.equal(bg.makeDurationComparator(false), bg.durationComparator);
});

test("makeDurationComparator(true): descending, unknown still last, ties stable", () => {
  const cmp = bg.makeDurationComparator(true);
  const rows = [{ duration: 10 }, { duration: -1 }, { duration: 500 }, { duration: 60 }];
  const sorted = rows.slice().sort(cmp);
  assert.deepEqual(sorted.map((r) => r.duration), [500, 60, 10, -1]);
  assert.equal(cmp({ duration: 5 }, { duration: 5 }), 0);
  assert.equal(cmp({ duration: -1 }, { duration: -1 }), 0);
});

// ── detectDurationInPage: ad + contamination regressions ────────────────────

function withPage(documentStub, locationStub, fn) {
  const savedDoc = global.document;
  const savedLoc = global.location;
  global.document = documentStub;
  if (locationStub) global.location = locationStub;
  else delete global.location;
  try {
    return fn();
  } finally {
    global.document = savedDoc;
    if (savedLoc === undefined) delete global.location;
    else global.location = savedLoc;
  }
}

function scriptEls(...texts) {
  return texts.map((t) => ({ textContent: t }));
}

test("detector: anchored lengthSeconds beats ad-tainted <video> and sidebar data", () => {
  // A pre-roll ad is playing: video.duration is the AD's 15s. The first
  // lengthSeconds in the DOM belongs to a sidebar recommendation. The anchored
  // parse must still return the content video's 213s.
  const doc = {
    querySelector: (s) => {
      if (s === "video") return { duration: 15.02 };
      if (s === ".html5-video-player") return { classList: { contains: (c) => c === "ad-showing" } };
      return null;
    },
    querySelectorAll: (s) =>
      s === "script"
        ? scriptEls(
            '{"videoId":"SIDEBARVID1","lengthSeconds":"15"}',
            '{"videoDetails":{"videoId":"TARGETVID01","title":"mine","lengthSeconds":"213"}}'
          )
        : [],
  };
  const d = withPage(doc, { search: "?v=TARGETVID01" }, () => bg.detectDurationInPage());
  assert.equal(d, 213);
});

test("detector: while an ad shows and no anchored data exists, falls to meta (never the ad)", () => {
  const doc = {
    querySelector: (s) => {
      if (s === "video") return { duration: 15.02 }; // the ad
      if (s === ".html5-video-player") return { classList: { contains: (c) => c === "ad-showing" } };
      if (s === ".ytp-time-duration") return { textContent: "0:15" }; // the ad
      if (s === 'meta[itemprop="duration"]') return { getAttribute: () => "PT3M33S" };
      return null;
    },
    querySelectorAll: () => [],
  };
  const d = withPage(doc, { search: "?v=TARGETVID01" }, () => bg.detectDurationInPage());
  assert.equal(d, 213);
});

test("detector: stale SPA player response for another video is ignored; live <video> wins", () => {
  const doc = {
    querySelector: (s) => {
      if (s === "video") return { duration: 100.5 };
      if (s === ".html5-video-player") return { classList: { contains: () => false } };
      return null;
    },
    querySelectorAll: (s) =>
      s === "script" ? scriptEls('{"videoId":"OLDVIDEO123","lengthSeconds":"999"}') : [],
  };
  const d = withPage(doc, { search: "?v=TARGETVID01" }, () => bg.detectDurationInPage());
  assert.equal(d, 100.5);
});

test("detector: unanchored first-match only applies when videoId is unknowable", () => {
  const doc = {
    querySelector: () => null,
    querySelectorAll: (s) => (s === "script" ? scriptEls('{"lengthSeconds":"777"}') : []),
  };
  // No location at all (legacy/Node) → legacy scan allowed.
  const d = withPage(doc, null, () => bg.detectDurationInPage());
  assert.equal(d, 777);
  // Known videoId with no anchored entry → -1, never a foreign first match.
  const d2 = withPage(doc, { search: "?v=TARGETVID01" }, () => bg.detectDurationInPage());
  assert.equal(d2, -1);
});

// ── fetchDurationFallback ────────────────────────────────────────────────────

function withFetch(stub, fn) {
  const saved = global.fetch;
  global.fetch = stub;
  return Promise.resolve(fn()).finally(() => {
    global.fetch = saved;
  });
}

test("fetchDurationFallback: parses the anchored duration from the watch page", async () => {
  const h = loadBackground({ runtime: { id: "test-ext" } });
  try {
    let calls = 0;
    await withFetch(async (url) => {
      calls++;
      assert.match(url, /watch\?v=TARGETVID01/);
      return {
        ok: true,
        text: async () => '{"videoDetails":{"videoId":"TARGETVID01","lengthSeconds":"321"}}',
      };
    }, async () => {
      assert.equal(await h.api.fetchDurationFallback("TARGETVID01"), 321);
      // Cached: second call must not refetch.
      assert.equal(await h.api.fetchDurationFallback("TARGETVID01"), 321);
      assert.equal(calls, 1);
    });
  } finally {
    h.restore();
  }
});

test("fetchDurationFallback: HTTP error and network error → unknown", async () => {
  const h = loadBackground({ runtime: { id: "test-ext" } });
  try {
    await withFetch(async () => ({ ok: false, text: async () => "" }), async () => {
      assert.equal(await h.api.fetchDurationFallback("VIDAAAAAAA1"), -1);
    });
    await withFetch(async () => { throw new Error("offline"); }, async () => {
      assert.equal(await h.api.fetchDurationFallback("VIDBBBBBBB1"), -1);
    });
  } finally {
    h.restore();
  }
});

test("fetchDurationFallback: never fetches without chrome.runtime.id (Node tests)", async () => {
  const h = loadBackground({ runtime: {} });
  try {
    let calls = 0;
    await withFetch(async () => { calls++; return { ok: true, text: async () => "" }; }, async () => {
      assert.equal(await h.api.fetchDurationFallback("VIDCCCCCCC1"), -1);
      assert.equal(calls, 0);
    });
  } finally {
    h.restore();
  }
});

// ── planGroupedAssignments ───────────────────────────────────────────────────

const yt = (id) => `https://www.youtube.com/watch?v=vid${id}aaaaaa`;

test("planGroupedAssignments: sorts inside each group; slots never cross groups", () => {
  const tabs = [
    { id: 2, index: 1, url: yt(2), groupId: 5 },
    { id: 3, index: 2, url: yt(3), groupId: 5 },
    { id: 4, index: 3, url: "https://example.com/", groupId: -1 },
    { id: 5, index: 4, url: yt(5), groupId: -1 },
  ];
  const durations = new Map([[2, 300], [3, 100], [5, 50]]);
  const plan = bg.planGroupedAssignments(tabs, durations, bg.durationComparator);
  assert.deepEqual(plan, [
    { tabId: 3, index: 1 }, // group 5 internally sorted: 100s before 300s
    { tabId: 2, index: 2 },
    { tabId: 5, index: 3 }, // ungrouped slots: YouTube tab first…
    { tabId: 4, index: 4 }, // …then the non-YouTube tab
  ]);
});

test("planGroupedAssignments: unknown duration sorts last within its group", () => {
  const tabs = [
    { id: 1, index: 0, url: yt(1), groupId: 9 },
    { id: 2, index: 1, url: yt(2), groupId: 9 },
    { id: 3, index: 2, url: yt(3), groupId: 9 },
  ];
  const durations = new Map([[1, -1], [2, 60], [3, 30]]);
  const plan = bg.planGroupedAssignments(tabs, durations, bg.durationComparator);
  assert.deepEqual(plan.map((p) => p.tabId), [3, 2, 1]);
});

// ── Integration: grouped window through the chrome mock ─────────────────────

test("integration: tab groups keep their span; tabs sort within them", async () => {
  const env = createTabEnv({
    windows: {
      1: [
        { id: 1, url: "https://news.example/", pinned: true },
        { id: 2, url: yt(2), groupId: 5 },
        { id: 3, url: yt(3), groupId: 5 },
        { id: 4, url: "https://example.com/" },
        { id: 5, url: yt(5) },
      ],
    },
    durations: { 2: 300, 3: 100, 5: 50 },
  });
  const h = loadBackground(env.chrome);
  try {
    const res = await h.api.sortYouTubeTabs();
    assert.equal(res.sorted, 3);
    // pinned stays; group block (slots 1-2) internally sorted; ungrouped
    // slots (3-4) get the YouTube tab first, then the other tab.
    assert.deepEqual(env.order(), [1, 3, 2, 5, 4]);
    const grouped = env.windows[1].filter((t) => t.groupId === 5).map((t) => t.index).sort();
    assert.deepEqual(grouped, [1, 2], "group span disturbed");
  } finally {
    h.restore();
  }
});
