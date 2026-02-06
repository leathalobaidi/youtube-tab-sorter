# YouTube Tab Sorter

A Chrome extension that sorts your YouTube video tabs by duration — shortest videos on the left, longest on the right.

![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Coming%20Soon-blue)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)
![License](https://img.shields.io/badge/License-MIT-yellow)

## ✨ Features

- **One-Click Sort** — Click the toolbar icon to instantly organize all your YouTube tabs
- **Smart Duration Detection** — Uses multiple methods to accurately detect video length
- **Clean Organization** — YouTube videos sorted by length, other tabs moved to the right

## 🚀 Installation

### From Chrome Web Store (Recommended)
*Coming soon — pending review*

### Manual Installation (Developer Mode)

#### Step 1: Download the extension

1. Go to this page: https://github.com/leathalobaidi/youtube-tab-sorter
2. Click the green **Code** button (near the top right)
3. Click **Download ZIP** from the dropdown menu
4. The file `youtube-tab-sorter-main.zip` will download to your Downloads folder
5. **Unzip the file** — double-click it on Mac, or right-click → Extract All on Windows

You'll now have a folder called `youtube-tab-sorter-main` containing:
```
youtube-tab-sorter-main/
├── background.js
├── content.js
├── manifest.json
├── icons/
├── README.md
└── LICENSE
```

#### Step 2: Install in Chrome

1. Open Chrome and type `chrome://extensions/` in the address bar
2. Turn on **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked** (button appears after enabling Developer mode)
4. Navigate to the `youtube-tab-sorter-main` folder you unzipped
5. Select the **entire folder** (the one containing manifest.json)
6. Click **Select Folder**

Done! You'll see the YouTube Tab Sorter icon in your Chrome toolbar.

## 📖 How to Use

1. Open several YouTube video tabs (any videos you want to watch)
2. Click the **YouTube Tab Sorter** icon in your toolbar
3. Watch your tabs rearrange — shortest video first, longest last!

**Pro tip:** Great for clearing a queue of videos when you only have a few minutes.

## 🛠️ How It Works

The extension uses multiple fallback methods to detect video duration:

1. **Video Element** — Reads duration directly from the HTML5 video player
2. **Time Display** — Parses the duration shown in the player controls
3. **Meta Tags** — Extracts duration from page metadata (ISO 8601 format)
4. **Page Scripts** — Finds `lengthSeconds` in YouTube's embedded data

Tabs are then sorted shortest-to-longest, with non-YouTube tabs moved to the right.

## 🔒 Privacy

This extension:
- ✅ Does NOT collect any personal data
- ✅ Does NOT track your browsing
- ✅ Does NOT send data to external servers
- ✅ Only accesses YouTube tabs to read video duration
- ✅ Requires minimal permissions (tabs + YouTube access only)

## 📁 Project Structure

```
youtube-tab-sorter/
├── manifest.json      # Extension configuration (Manifest V3)
├── background.js      # Service worker - handles sorting logic
├── content.js         # Injected into YouTube pages to read duration
└── icons/
    ├── icon16.png     # Toolbar icon
    ├── icon48.png     # Extension management icon
    └── icon128.png    # Chrome Web Store icon
```

## 🤖 Vibe Coded

This extension was built using **Claude AI** (Anthropic) as a coding assistant. From concept to working extension in one session through conversational AI pair programming.

## ❓ Troubleshooting

**Duration not detected?**
- Make sure the video has loaded (at least partially)
- Refresh the YouTube page and try again
- Live streams may not have a detectable duration

**Tabs not moving?**
- Check that you have YouTube video tabs open (URLs with `/watch?v=`)
- YouTube home page, playlists, and channel pages don't count as videos

## 🤝 Contributing

Found a bug or have a feature request? [Open an issue](https://github.com/leathalobaidi/youtube-tab-sorter/issues)!

## 📄 License

MIT License — feel free to use, modify, and distribute.

---

Made with ☕ and Claude AI
