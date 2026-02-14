/**
 * Background Service Worker
 * Handles messages from content scripts and manages IndexedDB storage
 */

// Import the DB module
try {
    importScripts('lib/db.js');
} catch (err) {
    console.error('[ChatSaver BG] Failed to import DB module:', err);
}

const db = globalThis.ChatSaverDB;
if (!db) {
    console.error('[ChatSaver BG] ChatSaverDB is unavailable');
}

/**
 * Listen for messages from content scripts
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return false;

    if (!db) {
        sendResponse({ success: false, error: 'Database is not initialized' });
        return false;
    }

    const handlers = {
        SAVE_CONVERSATION: async () => {
            const result = await handleSaveConversation(message.conversation);
            await updateBadge();
            return { result };
        },
        GET_STATS: async () => {
            const stats = await db.getStats();
            return { stats };
        },
        GET_ALL_CONVERSATIONS: async () => {
            const conversations = await db.getAllConversations();
            return { conversations };
        },
        GET_CONVERSATION: async () => {
            const conversation = await db.getConversation(message.id);
            return { conversation };
        },
        DELETE_CONVERSATION: async () => {
            await db.deleteConversation(message.id);
            await updateBadge();
            return {};
        },
        SEARCH_CONVERSATIONS: async () => {
            const conversations = await db.searchConversations(message.query || '');
            return { conversations };
        },
    };

    const handler = handlers[message.type];
    if (!handler) return false;

    handler()
        .then((data) => sendResponse({ success: true, ...data }))
        .catch((err) => {
            console.error(`[ChatSaver BG] ${message.type} failed:`, err);
            sendResponse({ success: false, error: err && err.message ? err.message : String(err) });
        });

    return true; // Keep the message channel open for async response
});

/**
 * Save a conversation to IndexedDB
 */
async function handleSaveConversation(conversation) {
    if (!conversation || !conversation.id) {
        throw new Error('Invalid conversation data');
    }

    return db.saveConversation(conversation);
}

/**
 * Update the extension badge with total conversation count
 */
async function updateBadge() {
    if (!db) return;

    try {
        const stats = await db.getStats();
        const count = stats.totalConversations;
        const text = count > 0 ? String(count) : '';

        chrome.action.setBadgeText({ text });
        chrome.action.setBadgeBackgroundColor({ color: '#3a3a3a' });
    } catch (err) {
        console.error('[ChatSaver BG] Badge update error:', err);
    }
}

/**
 * On install/startup, update the badge
 */
chrome.runtime.onInstalled.addListener(() => {
    console.log('[ChatSaver] Extension installed');
    updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
    updateBadge();
});
