// Background service worker for YouTube Tab Sorter

// Listen for toolbar button click
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await sortYouTubeTabs();
  } catch (error) {
    console.error('Error sorting tabs:', error);
  }
});

async function sortYouTubeTabs() {
  // Get all tabs in the current window
  const tabs = await chrome.tabs.query({ currentWindow: true });

  // Separate YouTube tabs from non-YouTube tabs
  const youtubeTabs = [];
  const otherTabs = [];

  for (const tab of tabs) {
    if (isYouTubeVideoTab(tab.url)) {
      youtubeTabs.push(tab);
    } else {
      otherTabs.push(tab);
    }
  }

  // If no YouTube tabs, nothing to do
  if (youtubeTabs.length === 0) {
    console.log('No YouTube video tabs found');
    return;
  }

  // Get duration for each YouTube tab
  const tabsWithDuration = await Promise.all(
    youtubeTabs.map(async (tab) => {
      const duration = await getVideoDuration(tab.id);
      return { tab, duration };
    })
  );

  // Sort by duration (shortest first, tabs with unknown duration at the end)
  tabsWithDuration.sort((a, b) => {
    // Put unknown durations (-1) at the end
    if (a.duration === -1 && b.duration === -1) return 0;
    if (a.duration === -1) return 1;
    if (b.duration === -1) return -1;
    return a.duration - b.duration;
  });

  // Reorder tabs: YouTube tabs (sorted by duration) first, then other tabs
  let newIndex = 0;

  // Move sorted YouTube tabs to the left
  for (const { tab } of tabsWithDuration) {
    await chrome.tabs.move(tab.id, { index: newIndex });
    newIndex++;
  }

  // Move other tabs to the right
  for (const tab of otherTabs) {
    await chrome.tabs.move(tab.id, { index: newIndex });
    newIndex++;
  }

  console.log(`Sorted ${youtubeTabs.length} YouTube tabs by duration`);
}

function isYouTubeVideoTab(url) {
  if (!url) return false;
  try {
    const urlObj = new URL(url);
    // Check if it's a YouTube watch page (video page)
    return (urlObj.hostname === 'www.youtube.com' || urlObj.hostname === 'youtube.com') &&
           urlObj.pathname === '/watch' &&
           urlObj.searchParams.has('v');
  } catch {
    return false;
  }
}

async function getVideoDuration(tabId) {
  try {
    // Read the content script file
    const contentScript = await fetch(chrome.runtime.getURL('content.js')).then(r => r.text());

    // Execute the content script in the tab
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: executeInPage,
      args: [contentScript]
    });

    if (results && results[0] && typeof results[0].result === 'number') {
      return results[0].result;
    }
  } catch (error) {
    console.error(`Error getting duration for tab ${tabId}:`, error);
  }

  return -1; // Unknown duration
}

// This function runs in the context of the page
function executeInPage(scriptContent) {
  // Try multiple methods to get the video duration

  // Method 1: Get duration from the video element
  const video = document.querySelector('video');
  if (video && video.duration && !isNaN(video.duration) && isFinite(video.duration)) {
    return video.duration;
  }

  // Method 2: Get duration from the time display in the player
  const timeDisplay = document.querySelector('.ytp-time-duration');
  if (timeDisplay) {
    const timeText = timeDisplay.textContent;
    const duration = parseTimeString(timeText);
    if (duration > 0) {
      return duration;
    }
  }

  // Method 3: Try to get from meta tags
  const metaDuration = document.querySelector('meta[itemprop="duration"]');
  if (metaDuration) {
    const isoDuration = metaDuration.getAttribute('content');
    const duration = parseISODuration(isoDuration);
    if (duration > 0) {
      return duration;
    }
  }

  // Method 4: Try ytInitialPlayerResponse from page scripts
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    const text = script.textContent;
    if (text && text.includes('lengthSeconds')) {
      const match = text.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
  }

  // Return -1 if we couldn't find the duration
  return -1;

  // Helper function to parse time string like "1:23:45" or "12:34"
  function parseTimeString(timeStr) {
    if (!timeStr) return -1;
    const parts = timeStr.split(':').map(p => parseInt(p, 10));
    if (parts.some(isNaN)) return -1;

    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return -1;
  }

  // Helper function to parse ISO 8601 duration like "PT1H23M45S"
  function parseISODuration(isoStr) {
    if (!isoStr) return -1;
    const match = isoStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return -1;

    const hours = parseInt(match[1] || 0, 10);
    const minutes = parseInt(match[2] || 0, 10);
    const seconds = parseInt(match[3] || 0, 10);

    return hours * 3600 + minutes * 60 + seconds;
  }
}
