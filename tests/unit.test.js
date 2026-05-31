"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

// Pure helpers require no chrome global (the wiring guard skips when chrome is absent).
const bg = require("../background.js");
const {
  isYouTubeVideoTab,
  parseTimeString,
  parseISODuration,
  normalizeDuration,
  durationComparator,
  UNKNOWN_DURATION,
} = bg;

test("isYouTubeVideoTab: only /watch?v= counts as a sortable video", () => {
  // Videos
  assert.equal(isYouTubeVideoTab("https://www.youtube.com/watch?v=abc123"), true);
  assert.equal(isYouTubeVideoTab("https://youtube.com/watch?v=abc"), true);
  assert.equal(isYouTubeVideoTab("https://m.youtube.com/watch?v=abc"), true);
  assert.equal(isYouTubeVideoTab("https://www.youtube.com/watch?v=abc&t=10s&list=PL1"), true);

  // Not videos
  assert.equal(isYouTubeVideoTab("https://www.youtube.com/shorts/xY"), false);
  assert.equal(isYouTubeVideoTab("https://www.youtube.com/"), false);
  assert.equal(isYouTubeVideoTab("https://www.youtube.com/playlist?list=PL1"), false);
  assert.equal(isYouTubeVideoTab("https://www.youtube.com/@channel"), false);
  assert.equal(isYouTubeVideoTab("https://www.youtube.com/results?search_query=x"), false);
  assert.equal(isYouTubeVideoTab("https://www.youtube.com/watch"), false, "no v param");
  assert.equal(isYouTubeVideoTab("https://example.com/watch?v=abc"), false, "wrong host");
  assert.equal(isYouTubeVideoTab("https://youtu.be/abc"), false, "short links not supported (documented)");

  // Malformed / non-http
  assert.equal(isYouTubeVideoTab(""), false);
  assert.equal(isYouTubeVideoTab(null), false);
  assert.equal(isYouTubeVideoTab(undefined), false);
  assert.equal(isYouTubeVideoTab("chrome://extensions/"), false);
  assert.equal(isYouTubeVideoTab("about:blank"), false);
  assert.equal(isYouTubeVideoTab("not a url"), false);
});

test("parseTimeString: H:MM:SS and MM:SS, junk → unknown", () => {
  assert.equal(parseTimeString("1:23:45"), 5025);
  assert.equal(parseTimeString("12:34"), 754);
  assert.equal(parseTimeString("0:45"), 45);
  assert.equal(parseTimeString(" 2:00 "), 120, "trims whitespace");
  assert.equal(parseTimeString(""), UNKNOWN_DURATION);
  assert.equal(parseTimeString("live"), UNKNOWN_DURATION);
  assert.equal(parseTimeString("45"), UNKNOWN_DURATION, "single number is not a time");
  assert.equal(parseTimeString("1:2:3:4"), UNKNOWN_DURATION, "too many parts");
  assert.equal(parseTimeString("a:b"), UNKNOWN_DURATION);
});

test("parseISODuration: ISO-8601, bare PT and garbage → unknown", () => {
  assert.equal(parseISODuration("PT1H23M45S"), 5025);
  assert.equal(parseISODuration("PT45S"), 45);
  assert.equal(parseISODuration("PT2M"), 120);
  assert.equal(parseISODuration("PT1H"), 3600);
  assert.equal(parseISODuration("PT"), UNKNOWN_DURATION, "bare PT must be unknown, not 0");
  assert.equal(parseISODuration("garbage"), UNKNOWN_DURATION);
  assert.equal(parseISODuration("1H2M"), UNKNOWN_DURATION, "missing P");
  assert.equal(parseISODuration(""), UNKNOWN_DURATION);
  assert.equal(parseISODuration(null), UNKNOWN_DURATION);
});

test("normalizeDuration: only finite positive numbers survive", () => {
  assert.equal(normalizeDuration(123), 123);
  assert.equal(normalizeDuration(0), UNKNOWN_DURATION);
  assert.equal(normalizeDuration(-5), UNKNOWN_DURATION);
  assert.equal(normalizeDuration(NaN), UNKNOWN_DURATION);
  assert.equal(normalizeDuration(Infinity), UNKNOWN_DURATION);
  assert.equal(normalizeDuration("100"), UNKNOWN_DURATION, "strings are not durations");
  assert.equal(normalizeDuration(undefined), UNKNOWN_DURATION);
});

test("durationComparator: ascending, unknown last, ties stable", () => {
  const rows = [
    { id: "a", duration: 300 },
    { id: "b", duration: -1 },
    { id: "c", duration: 60 },
    { id: "d", duration: -1 },
    { id: "e", duration: 60 },
  ];
  const sorted = rows.slice().sort(durationComparator).map((r) => r.id);
  // 60s (c, then e — stable), 300s (a), then unknowns (b, then d — stable)
  assert.deepEqual(sorted, ["c", "e", "a", "b", "d"]);
});

test("durationComparator: all-unknown set is a stable no-op", () => {
  const rows = [
    { id: "x", duration: -1 },
    { id: "y", duration: -1 },
    { id: "z", duration: -1 },
  ];
  assert.deepEqual(rows.slice().sort(durationComparator).map((r) => r.id), ["x", "y", "z"]);
});

test("formatRuntime: human-readable queued time", () => {
  assert.equal(bg.formatRuntime(45), "45s");
  assert.equal(bg.formatRuntime(150), "2m");
  assert.equal(bg.formatRuntime(5025), "1h 23m");
  assert.equal(bg.formatRuntime(3600), "1h 0m");
});
