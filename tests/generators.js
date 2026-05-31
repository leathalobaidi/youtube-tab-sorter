"use strict";

// Deterministic mock tab + duration generators. No randomness / Date.now so
// fixtures are reproducible.

let auto = 0;
const nextId = () => ++auto;
function resetIds() { auto = 0; }

const watch = (id, v) => ({ id, url: `https://www.youtube.com/watch?v=${v || "vid" + id}` });
const watchWithExtras = (id, v) => ({ id, url: `https://www.youtube.com/watch?v=${v}&t=42s&list=PLabc` });
const shorts = (id) => ({ id, url: `https://www.youtube.com/shorts/short${id}` });
const ytHome = (id) => ({ id, url: "https://www.youtube.com/" });
const ytPlaylist = (id) => ({ id, url: "https://www.youtube.com/playlist?list=PLxyz" });
const ytChannel = (id) => ({ id, url: "https://www.youtube.com/@someChannel" });
const mobileWatch = (id, v) => ({ id, url: `https://m.youtube.com/watch?v=${v || "m" + id}` });
const other = (id, url) => ({ id, url: url || `https://example.com/page${id}` });
const chromePage = (id) => ({ id, url: "chrome://extensions/" });
const blank = (id) => ({ id, url: "about:blank" });
const pin = (spec) => ({ ...spec, pinned: true });

// A large mixed window of n YouTube watch tabs with assorted durations + some noise.
function hugeWindow(n) {
  resetIds();
  const tabs = [];
  const durations = {};
  for (let i = 0; i < n; i++) {
    const id = nextId();
    if (i % 7 === 0) {
      // every 7th is a non-YouTube tab
      tabs.push(other(id));
    } else {
      tabs.push(watch(id, "v" + id));
      // pseudo-shuffled but deterministic durations; every 11th is unknown
      durations[id] = i % 11 === 0 ? -1 : ((i * 37) % 600) + 1;
    }
  }
  return { tabs, durations };
}

module.exports = {
  nextId,
  resetIds,
  watch,
  watchWithExtras,
  shorts,
  ytHome,
  ytPlaylist,
  ytChannel,
  mobileWatch,
  other,
  chromePage,
  blank,
  pin,
  hugeWindow,
};
