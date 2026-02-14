# Chatsave

The thing is, I don’t have good internet where I live, and it’s really unreliable, and at this point, ChatGPT conversations have kind of become like a personal library for me, and I often want to revisit things, but doing that with my internet connection is really frustrating, thanks to Jio.

So I decided to vibe-code an extension to save my ChatGPT conversations and view them offline.

Basically, it runs in the background and detects when you have ChatGPT opened in your browser, and it records any conversation that you make with ChatGPT and saves it in the browser (you can also save a convo manually), and you can view those saved conversations later using the browser.

I don’t really know anything about web dev except basic HTML and CSS, so I mostly don’t know how it all works, but Claude did the work in case you’re curious.


## Features

- **Auto-save**: Automatically captures ChatGPT conversations as you chat
- **Manual save**: Click the extension icon to save the current conversation
- **Offline viewer**: Browse and search your saved conversations
- **Export**: Export conversations as Markdown files
- **Dark/Light themes**: Toggle between dark and light modes
- **Direct HTML rendering**: Preserves ChatGPT's original formatting perfectly

## Installation

1. Clone this repository or download the ZIP
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `offline-chatsave` folder

## Usage

### Saving Conversations

- **Auto-save**: The extension automatically saves conversations as you chat on ChatGPT
- **Manual save**: Click the white dot that appears to the lower right corner when you open a conversation (works for older chats too)

### Viewing Conversations

1. Click the extension icon
2. Click "Open Viewer"
3. Browse your saved conversations in the sidebar
4. Click any conversation to view it

### Features

- **Search**: Use the search bar to find conversations by title or content
- **Export**: Click the download icon to export a conversation as Markdown
- **Delete**: Click the trash icon to delete a conversation
- **Theme toggle**: Click the sun/moon icon to switch between light and dark modes
- **Fullscreen**: Click the sidebar toggle to hide the sidebar and header for distraction-free reading

## Technical Details

### Architecture

- **Content Scripts**: Scrape conversation data from ChatGPT's DOM
- **Background Service Worker**: Manages storage and message passing
- **Viewer**: Standalone HTML/CSS/JS app for browsing saved conversations

### Storage

Conversations are stored in Chrome's `chrome.storage.local` API with the following structure:

```javascript
{
  id: string,           // Unique conversation ID
  source: 'chatgpt',    // Source platform
  title: string,        // Conversation title
  url: string,          // Original URL
  messages: [{
    role: 'user' | 'assistant',
    content: string,     // Markdown text (for search/export)
    contentHtml: string  // Sanitized HTML (for rendering)
  }],
  savedAt: string,      // ISO timestamp
  updatedAt: string     // ISO timestamp
}
```

### Rendering Pipeline

The extension uses a dual-format approach for optimal rendering:

1. **Scraping**: Extracts both markdown text and sanitized HTML from ChatGPT's DOM
2. **Storage**: Saves both formats (`content` and `contentHtml`)
3. **Rendering**: Uses `contentHtml` directly for pixel-perfect display, falls back to markdown parser for old data

## Development

### Project Structure

```
offline-chatsave/
├── manifest.json          # Extension manifest
├── background.js          # Service worker
├── content/
│   ├── common.js         # Shared utilities
│   └── chatgpt.js        # ChatGPT content script
├── popup/
│   ├── popup.html        # Extension popup
│   ├── popup.css
│   └── popup.js
├── viewer/
│   ├── viewer.html       # Conversation viewer
│   ├── viewer.css
│   └── viewer.js
├── lib/
│   └── hljs/            # Syntax highlighting
└── icons/               # Extension icons
```

### Key Files

- **`content/common.js`**: DOM extraction utilities, markdown conversion
- **`content/chatgpt.js`**: ChatGPT-specific scraping logic
- **`viewer/viewer.js`**: Conversation rendering and UI logic
- **`background.js`**: Storage management and message routing

## Credits

- Syntax highlighting: [highlight.js](https://highlightjs.org/)
- Fonts: [Inter](https://rsms.me/inter/)
