"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createTabEnv, loadBackground } = require("./mock-chrome");
const { watch, hugeWindow } = require("./generators");

const isYT = (url) => /youtube\.com\/watch\?v=/.test(url);

function expectedOrder(tabs, durations) {
  const yt = tabs.filter((t) => isYT(t.url));
  const others = tabs.filter((t) => !isYT(t.url));
  const sortedYt = yt
    .map((t) => ({ id: t.id, d: typeof durations[t.id] === "number" ? durations[t.id] : -1 }))
    .sort((a, b) => {
      if (a.d === -1 && b.d === -1) return 0;
      if (a.d === -1) return 1;
      if (b.d === -1) return -1;
      return a.d - b.d;
    })
    .map((x) => x.id);
  return [...sortedYt, ...others.map((t) => t.id)];
}

test("CHAOS: 220-tab window sorts correctly, keeps indices valid, and is quick", async () => {
  const { tabs, durations } = hugeWindow(220);
  const env = createTabEnv({ windows: { 1: tabs }, durations });
  const { api, restore } = loadBackground(env.chrome);
  try {
    const t0 = process.hrtime.bigint();
    await api.sortYouTubeTabs();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;

    assert.deepEqual(env.order(), expectedOrder(tabs, durations));
    const idxs = env.windows[1].map((t) => t.index).sort((a, b) => a - b);
    assert.deepEqual(idxs, idxs.map((_, i) => i), "indices stay contiguous 0..n-1");
    assert.equal(env.order().length, tabs.length, "no tabs lost");
    assert.ok(ms < 3000, `sort should be quick; took ${ms.toFixed(1)}ms`);
  } finally {
    restore();
  }
});

test("CHAOS: all durations unknown → stable, non-crashing order", async () => {
  const env = createTabEnv({ windows: { 1: [watch(1), watch(2), watch(3)] } }); // no durations → all -1
  const { api, restore } = loadBackground(env.chrome);
  try {
    await api.sortYouTubeTabs();
    assert.deepEqual(env.order(), [1, 2, 3]);
  } finally {
    restore();
  }
});

test("CHAOS: executeScript rejects for every tab → all unknown, no crash", async () => {
  const env = createTabEnv({
    windows: { 1: [watch(1), watch(2)] },
    executeScriptFails: new Set([1, 2]),
  });
  const { api, restore } = loadBackground(env.chrome);
  try {
    const res = await api.sortYouTubeTabs();
    assert.equal(res.sorted, 2);
    assert.deepEqual(env.order(), [1, 2]);
  } finally {
    restore();
  }
});

test("CHAOS: a tab closed mid-sort does not abort and loses nothing else", async () => {
  let closed = false;
  const env = createTabEnv({
    windows: { 1: [watch(1), watch(2), watch(3)] },
    durations: { 1: 100, 2: 50, 3: 10 },
    onMove: (_tabId, e) => {
      if (!closed) {
        closed = true;
        e.closeTab(1); // tab 1 vanishes partway through the move loop
      }
    },
  });
  const { api, restore } = loadBackground(env.chrome);
  try {
    await api.sortYouTubeTabs();
    // tab 1 legitimately gone; remaining sorted by duration: 3 (10) then 2 (50)
    assert.deepEqual(env.order(), [3, 2]);
  } finally {
    restore();
  }
});

test("CHAOS: empty window is a clean no-op", async () => {
  const env = createTabEnv({ windows: { 1: [] } });
  const { api, restore } = loadBackground(env.chrome);
  try {
    const res = await api.sortYouTubeTabs();
    assert.equal(res.sorted, 0);
    assert.deepEqual(env.order(), []);
  } finally {
    restore();
  }
});

test("CHAOS: a move REJECTED while the tab stays alive does not let a later tab jump in front", async () => {
  // tab1 (10s) should be first, but its move is rejected (e.g. user dragging it).
  // It stays at index 0; tab2 (50s) must NOT land in front of it.
  const env = createTabEnv({
    windows: { 1: [watch(1), watch(2)] },
    durations: { 1: 10, 2: 50 },
    moveRejects: new Set([1]),
  });
  const { api, restore } = loadBackground(env.chrome);
  try {
    await api.sortYouTubeTabs();
    assert.deepEqual(env.order(), [1, 2], "survivor keeps its slot; no jump-ahead, no lost tab");
  } finally {
    restore();
  }
});

test("CHAOS: a successful sort flashes a count badge; a no-op flashes a distinct marker", async () => {
  const sorted = createTabEnv({ windows: { 1: [watch(1), watch(2)] }, durations: { 1: 30, 2: 10 } });
  let h = loadBackground(sorted.chrome);
  try {
    await h.api.sortYouTubeTabs();
    assert.ok(sorted.badgeLog.includes("2"), "badge shows the sorted count");
  } finally {
    h.restore();
  }

  const noop = createTabEnv({ windows: { 1: [{ id: 9, url: "https://example.com/" }] } });
  h = loadBackground(noop.chrome);
  try {
    await h.api.sortYouTubeTabs();
    assert.ok(noop.badgeLog.includes("–"), "no-op shows a distinct marker, not a count");
  } finally {
    h.restore();
  }
});

test("CHAOS: repeated sorts are idempotent", async () => {
  const env = createTabEnv({
    windows: { 1: [watch(1), watch(2), watch(3)] },
    durations: { 1: 300, 2: 60, 3: 120 },
  });
  const { api, restore } = loadBackground(env.chrome);
  try {
    await api.sortYouTubeTabs();
    const first = env.order();
    await api.sortYouTubeTabs();
    assert.deepEqual(env.order(), first, "second sort keeps the same order");
    assert.deepEqual(first, [2, 3, 1]);
  } finally {
    restore();
  }
});
