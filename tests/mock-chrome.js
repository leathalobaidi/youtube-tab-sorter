"use strict";

// In-memory Chrome simulator for the YouTube Tab Sorter background worker.
// Models tabs.query / tabs.move (with Chrome's pinned-strip + reindex semantics)
// and scripting.executeScript, so integration tests can assert the exact final
// tab order produced by sortYouTubeTabs().

const path = require("path");
const BACKGROUND = path.join(__dirname, "..", "background.js");

/**
 * spec:
 *   windows:            { [windowId]: [ {id, url, pinned?} ... ] }  (initial order)
 *   currentWindowId:    number (default 1)
 *   durations:          { [tabId]: number }  (what executeScript "detects"; default -1)
 *   executeScriptFails: Set<tabId>           (tabs whose injection rejects)
 *   onMove:             (tabId, env) => void (hook to mutate the window mid-sort)
 */
function createTabEnv(spec) {
  const currentWindowId = spec.currentWindowId != null ? spec.currentWindowId : 1;
  const windows = {};
  for (const [wid, list] of Object.entries(spec.windows)) {
    windows[wid] = list.map((t, i) => ({
      id: t.id,
      url: t.url,
      pinned: !!t.pinned,
      groupId: t.groupId != null ? t.groupId : -1,
      windowId: Number(wid),
      index: i,
    }));
  }
  const durations = spec.durations || {};
  const failTabs = spec.executeScriptFails || new Set();
  const rejectMoves = spec.moveRejects || new Set(); // tabs whose move() rejects but stay alive
  const moveLog = [];
  const badgeLog = [];
  let executeCalls = 0;

  const reindex = (wid) => windows[wid].forEach((t, i) => (t.index = i));
  function findTab(id) {
    for (const wid of Object.keys(windows)) {
      const idx = windows[wid].findIndex((t) => t.id === id);
      if (idx !== -1) return { wid, idx, tab: windows[wid][idx] };
    }
    return null;
  }

  const env = {
    moveLog,
    badgeLog,
    order(wid = currentWindowId) {
      return windows[wid].slice().sort((a, b) => a.index - b.index).map((t) => t.id);
    },
    urls(wid = currentWindowId) {
      return windows[wid].slice().sort((a, b) => a.index - b.index).map((t) => t.url);
    },
    pinnedIds(wid = currentWindowId) {
      return windows[wid].filter((t) => t.pinned).sort((a, b) => a.index - b.index).map((t) => t.id);
    },
    get executeCalls() {
      return executeCalls;
    },
    closeTab(id) {
      const f = findTab(id);
      if (f) {
        windows[f.wid].splice(f.idx, 1);
        reindex(f.wid);
      }
    },
    windows,
  };

  const chrome = {
    action: {
      onClicked: { addListener() {} },
      setBadgeText: (o) => badgeLog.push(o && o.text),
      setBadgeBackgroundColor() {},
      setTitle() {},
    },
    runtime: { getURL: (p) => `chrome-extension://test/${p}` },
    tabs: {
      async query(q) {
        const wid = q && q.currentWindow ? currentWindowId : currentWindowId;
        return windows[wid].slice().sort((a, b) => a.index - b.index).map((t) => ({ ...t }));
      },
      async get(tabId) {
        const f = findTab(tabId);
        if (!f) throw new Error(`No tab with id ${tabId}`);
        return { ...f.tab };
      },
      async move(tabId, { index }) {
        if (spec.onMove) spec.onMove(tabId, env);
        if (rejectMoves.has(tabId)) {
          // Transient rejection: the tab is NOT removed — it stays where it is.
          moveLog.push({ tabId, index, rejected: true });
          throw new Error(`Tabs cannot be moved right now (tab ${tabId})`);
        }
        const found = findTab(tabId);
        if (!found) throw new Error(`No tab with id ${tabId}`);
        const arr = windows[found.wid];
        arr.splice(found.idx, 1);
        const pinnedCount = arr.filter((t) => t.pinned).length;
        let target = index;
        // Chrome won't move an unpinned tab into the pinned strip.
        if (!found.tab.pinned) target = Math.max(target, pinnedCount);
        target = Math.max(0, Math.min(target, arr.length));
        arr.splice(target, 0, found.tab);
        reindex(found.wid);
        moveLog.push({ tabId, index });
        return { ...found.tab };
      },
    },
    scripting: {
      async executeScript({ target }) {
        executeCalls++;
        const id = target.tabId;
        if (failTabs.has(id)) throw new Error(`Cannot access contents of tab ${id}`);
        const d = durations[id];
        return [{ result: typeof d === "number" ? d : -1 }];
      },
    },
  };

  env.chrome = chrome;
  return env;
}

/** Load background.js fresh with a given chrome global; restore on teardown. */
function loadBackground(chrome) {
  delete require.cache[require.resolve(BACKGROUND)];
  const saved = global.chrome;
  global.chrome = chrome;
  const api = require(BACKGROUND);
  return {
    api,
    restore() {
      global.chrome = saved;
      delete require.cache[require.resolve(BACKGROUND)];
    },
  };
}

module.exports = { createTabEnv, loadBackground, BACKGROUND };
