// Content script to extract video duration from YouTube pages
(function() {
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

  // Method 4: Try ytInitialPlayerResponse
  if (typeof ytInitialPlayerResponse !== 'undefined' && ytInitialPlayerResponse?.videoDetails?.lengthSeconds) {
    return parseInt(ytInitialPlayerResponse.videoDetails.lengthSeconds, 10);
  }

  // Return -1 if we couldn't find the duration
  return -1;

  // Helper function to parse time string like "1:23:45" or "12:34"
  function parseTimeString(timeStr) {
    if (!timeStr) return -1;
    const parts = timeStr.split(':').map(p => parseInt(p, 10));
    if (parts.some(isNaN)) return -1;

    if (parts.length === 3) {
      // Hours:Minutes:Seconds
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      // Minutes:Seconds
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
})();
