/**
 * IndexedDB Storage Layer for Offline Chat Saver
 * Database: OfflineChatSaver
 * Object Store: conversations
 */

const DB_NAME = 'OfflineChatSaver';
const DB_VERSION = 1;
const STORE_NAME = 'conversations';

/**
 * Open (or create/upgrade) the IndexedDB database
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('source', 'source', { unique: false });
        store.createIndex('savedAt', 'savedAt', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
        store.createIndex('title', 'title', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save or update a conversation
 * @param {Object} conversation - { id, source, title, url, messages[], savedAt, updatedAt }
 */
async function saveConversation(conversation) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // Try to get existing conversation first to merge
    const getReq = store.get(conversation.id);

    getReq.onsuccess = () => {
      const existing = getReq.result;
      let toSave;

      if (existing) {
        // Merge: keep earliest savedAt, update messages and updatedAt
        toSave = {
          ...existing,
          title: conversation.title || existing.title,
          messages: conversation.messages,
          updatedAt: new Date().toISOString(),
          url: conversation.url || existing.url,
        };
      } else {
        toSave = {
          ...conversation,
          savedAt: conversation.savedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      const putReq = store.put(toSave);
      putReq.onsuccess = () => resolve(toSave);
      putReq.onerror = () => reject(putReq.error);
    };

    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Get a single conversation by ID
 */
async function getConversation(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Get all conversations, sorted by updatedAt descending
 */
async function getAllConversations() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const results = request.result || [];
      // Sort by updatedAt descending (most recent first)
      results.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      resolve(results);
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Search conversations by query string (searches title and message content)
 */
async function searchConversations(query) {
  const all = await getAllConversations();
  const q = query.toLowerCase().trim();

  if (!q) return all;

  return all.filter((conv) => {
    // Search in title
    if (conv.title && conv.title.toLowerCase().includes(q)) return true;

    // Search in messages
    if (conv.messages) {
      return conv.messages.some(
        (msg) => msg.content && msg.content.toLowerCase().includes(q)
      );
    }

    return false;
  });
}

/**
 * Delete a conversation by ID
 */
async function deleteConversation(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Get statistics about stored data
 */
async function getStats() {
  const all = await getAllConversations();
  const totalMessages = all.reduce(
    (sum, conv) => sum + (conv.messages ? conv.messages.length : 0),
    0
  );

  const sources = {};
  all.forEach((conv) => {
    sources[conv.source] = (sources[conv.source] || 0) + 1;
  });

  return {
    totalConversations: all.length,
    totalMessages,
    sources,
  };
}

// Export for use in service worker (ES module) and content scripts
if (typeof globalThis !== 'undefined') {
  globalThis.ChatSaverDB = {
    openDB,
    saveConversation,
    getConversation,
    getAllConversations,
    searchConversations,
    deleteConversation,
    getStats,
  };
}
