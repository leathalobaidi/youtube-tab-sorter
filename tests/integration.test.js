"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { createTabEnv, loadBackground } = require("./mock-chrome");
const { watch, other, shorts, ytHome, ytPlaylist, pin } = require("./generators");

async function runSort(spec) {
  const env = createTabEnv(spec);
  const { api, restore } = loadBackground(env.chrome);
  try {
    const res = await api.sortYouTubeTabs();
    return { env, res };
  } finally {
    restore();
  }
}

test("sorts YouTube videos ascending; non-YouTube tabs move right", async () => {
  const { env } = await runSort({
    windows: { 1: [watch(1), other(2), watch(3), watch(4)] },
    durations: { 1: 300, 3: 60, 4: 120 },
  });
  assert.deepEqual(env.order(), [3, 4, 1, 2]);
});

test("unknown-duration YouTube tabs sink to the end of the YouTube group", async () => {
  const { env } = await runSort({
    windows: { 1: [watch(1), watch(2), watch(3)] },
    durations: { 1: 100, 2: -1, 3: 50 },
  });
  assert.deepEqual(env.order(), [3, 1, 2]);
});

test("non-YouTube tabs keep their relative order", async () => {
  const { env } = await runSort({
    windows: { 1: [other(1), watch(2), other(3), watch(4)] },
    durations: { 2: 50, 4: 10 },
  });
  // YT ascending [4,2], then others in original relative order [1,3]
  assert.deepEqual(env.order(), [4, 2, 1, 3]);
});

test("no YouTube video tabs is a clean no-op (no moves)", async () => {
  const { env, res } = await runSort({
    windows: { 1: [other(1), ytHome(2), shorts(3), ytPlaylist(4)] },
  });
  assert.equal(res.sorted, 0);
  assert.equal(env.moveLog.length, 0, "nothing should be moved");
  assert.deepEqual(env.order(), [1, 2, 3, 4]);
});

test("Shorts / home / playlist are not treated as sortable videos", async () => {
  const { env } = await runSort({
    windows: { 1: [watch(1), shorts(2), ytHome(3), watch(4)] },
    durations: { 1: 100, 4: 20 },
  });
  assert.deepEqual(env.order(), [4, 1, 2, 3]);
});

test("pinned tabs are never moved; sorting happens after the pinned strip", async () => {
  const { env } = await runSort({
    windows: { 1: [pin(watch(1)), watch(2), other(3), watch(4)] },
    durations: { 1: 999, 2: 100, 4: 20 }, // tab1 is pinned → excluded from sort
  });
  // Pinned tab1 stays at index 0; unpinned YT [4(20),2(100)] then other [3]
  assert.deepEqual(env.order(), [1, 4, 2, 3]);
  assert.deepEqual(env.pinnedIds(), [1], "pinned set unchanged");
});

test("a tab whose injection fails is treated as unknown; sort still completes", async () => {
  const { env } = await runSort({
    windows: { 1: [watch(1), watch(2), watch(3)] },
    durations: { 1: 100, 3: 50 }, // tab2 has no duration AND fails injection
    executeScriptFails: new Set([2]),
  });
  assert.deepEqual(env.order(), [3, 1, 2]);
});

test("only the current window is reordered; other windows are untouched", async () => {
  const env = createTabEnv({
    currentWindowId: 1,
    windows: {
      1: [watch(1), watch(2)],
      2: [watch(10), other(11)],
    },
    durations: { 1: 100, 2: 20, 10: 5 },
  });
  const { api, restore } = loadBackground(env.chrome);
  try {
    await api.sortYouTubeTabs();
    assert.deepEqual(env.order(1), [2, 1], "current window sorted");
    assert.deepEqual(env.order(2), [10, 11], "other window untouched");
  } finally {
    restore();
  }
});

test("injection runs exactly once per YouTube video tab", async () => {
  const { env } = await runSort({
    windows: { 1: [watch(1), other(2), watch(3), shorts(4), watch(5)] },
    durations: { 1: 30, 3: 10, 5: 20 },
  });
  assert.equal(env.executeCalls, 3, "only the 3 watch tabs are probed");
  assert.deepEqual(env.order(), [3, 5, 1, 2, 4]);
});

test("single-tab window with one video is a stable no-op order", async () => {
  const { env } = await runSort({
    windows: { 1: [watch(1)] },
    durations: { 1: 42 },
  });
  assert.deepEqual(env.order(), [1]);
});
