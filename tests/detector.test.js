"use strict";

// Tests the injected page detector (detectDurationInPage) against a stubbed
// document, covering each of the four fallback methods + the fallback order.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const bg = require("../background.js");

function withDocument(stub, fn) {
  const saved = global.document;
  global.document = stub;
  try {
    return fn();
  } finally {
    global.document = saved;
  }
}

const emptyAll = () => [];

test("Method 1: HTML5 <video>.duration is used first", () => {
  const d = withDocument(
    { querySelector: (s) => (s === "video" ? { duration: 123.4 } : null), querySelectorAll: emptyAll },
    () => bg.detectDurationInPage()
  );
  assert.equal(d, 123.4);
});

test("Method 2: .ytp-time-duration time display (falls back from no video)", () => {
  const d = withDocument(
    {
      querySelector: (s) => {
        if (s === "video") return { duration: NaN }; // not finite → fall through
        if (s === ".ytp-time-duration") return { textContent: "1:23:45" };
        return null;
      },
      querySelectorAll: emptyAll,
    },
    () => bg.detectDurationInPage()
  );
  assert.equal(d, 5025);
});

test("Method 3: <meta itemprop=duration> ISO-8601", () => {
  const d = withDocument(
    {
      querySelector: (s) => {
        if (s === 'meta[itemprop="duration"]') return { getAttribute: () => "PT2M30S" };
        return null;
      },
      querySelectorAll: emptyAll,
    },
    () => bg.detectDurationInPage()
  );
  assert.equal(d, 150);
});

test("Method 4: lengthSeconds in an embedded script", () => {
  const d = withDocument(
    {
      querySelector: () => null,
      querySelectorAll: (s) =>
        s === "script" ? [{ textContent: 'var x={"lengthSeconds":"754","foo":1};' }] : [],
    },
    () => bg.detectDurationInPage()
  );
  assert.equal(d, 754);
});

test("Detector returns -1 when nothing is detectable (live/unloaded page)", () => {
  const d = withDocument(
    { querySelector: () => null, querySelectorAll: emptyAll },
    () => bg.detectDurationInPage()
  );
  assert.equal(d, -1);
});

test("Fallback order: a present time display wins over a script lengthSeconds", () => {
  const d = withDocument(
    {
      querySelector: (s) => (s === ".ytp-time-duration" ? { textContent: "2:00" } : null),
      querySelectorAll: (s) => (s === "script" ? [{ textContent: '"lengthSeconds":"999"' }] : []),
    },
    () => bg.detectDurationInPage()
  );
  assert.equal(d, 120, "Method 2 takes precedence over Method 4");
});
