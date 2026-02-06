# YouTube Tab Sorter

A Chrome extension that sorts your YouTube video tabs by video length, placing the shortest videos on the left and longer ones to the right.

## Features

- Click the toolbar button to instantly sort all YouTube tabs by video duration
- Shortest videos move to the left, longest to the right
- Non-YouTube tabs are moved to the right side
- Works on the current browser window

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" using the toggle in the top right corner
3. Click "Load unpacked"
4. Select this `youtube-tab-sorter` folder
5. The extension icon will appear in your toolbar

## Usage

1. Open several YouTube video tabs
2. Click the YouTube Tab Sorter icon in your toolbar
3. Your tabs will be rearranged with the shortest video on the left

## Notes

- The extension only works on YouTube video pages (URLs with `/watch?v=`)
- If a video duration cannot be determined, that tab will be placed at the end of the YouTube tabs
- YouTube channel pages, playlists, and the home page are treated as non-YouTube tabs

## Troubleshooting

If the duration is not detected correctly:
- Make sure the video has loaded (at least partially)
- Refresh the page and try again
- Some live streams may not have a detectable duration
