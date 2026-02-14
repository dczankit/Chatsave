/**
 * ChatGPT Content Script
 * Auto-captures conversations from chat.openai.com / chatgpt.com
 */

(function () {
    'use strict';

    if (window.__chatSaverChatGPTLoaded) return;
    window.__chatSaverChatGPTLoaded = true;

    console.log('[ChatSaver] ChatGPT content script loaded');

    const SELECTORS = {
        messageGroups: [
            'main [data-message-author-role]',
            'main [data-testid^="conversation-turn"]',
            'main [data-message-id]',
            'main article',
        ],
        userMessageIndicators: [
            '[data-message-author-role="user"]',
            '.agent-turn[data-is-user="true"]',
        ],
        assistantMessageIndicators: [
            '[data-message-author-role="assistant"]',
            '.agent-turn:not([data-is-user="true"])',
            '.markdown',
        ],
        titleSelectors: [
            'nav [aria-current="page"]',
            'nav a[class*="bg-token-sidebar"]',
            'header h1',
            'h1',
            'title',
        ],
        contentSelectors: [
            '[data-message-content]',
            '.markdown',
            '.prose',
            '.whitespace-pre-wrap',
            '.text-message',
            '.min-h-8',
        ],
    };

    let indicator = null;
    let currentConvId = null;
    let observer = null;
    let urlCheckInterval = null;
    let periodicSaveInterval = null;

    function findElement(selectors, parent = document) {
        for (const sel of selectors) {
            try {
                const el = parent.querySelector(sel);
                if (el) return el;
            } catch (err) {
                // Skip invalid selectors.
            }
        }
        return null;
    }

    function findAllElements(selectors, parent = document) {
        for (const sel of selectors) {
            try {
                const elements = parent.querySelectorAll(sel);
                if (elements.length > 0) return Array.from(elements);
            } catch (err) {
                // Skip invalid selectors.
            }
        }
        return [];
    }

    function isConversationPage() {
        const path = window.location.pathname || '';
        if (/^\/(c|g)\/[^/]+/.test(path)) return true;
        if (/^\/chat\/[^/]+/.test(path)) return true;
        return false;
    }

    function getMessageRole(msgEl) {
        const directRole = msgEl.getAttribute('data-message-author-role');
        if (directRole === 'user' || directRole === 'assistant') return directRole;

        const roleCarrier =
            msgEl.closest('[data-message-author-role]') ||
            msgEl.querySelector('[data-message-author-role]');
        const nestedRole = roleCarrier ? roleCarrier.getAttribute('data-message-author-role') : '';
        if (nestedRole === 'user' || nestedRole === 'assistant') return nestedRole;

        for (const sel of SELECTORS.userMessageIndicators) {
            try {
                if (msgEl.matches(sel) || msgEl.querySelector(sel)) return 'user';
            } catch (err) {
                // Ignore selector errors.
            }
        }

        for (const sel of SELECTORS.assistantMessageIndicators) {
            try {
                if (msgEl.matches(sel) || msgEl.querySelector(sel)) return 'assistant';
            } catch (err) {
                // Ignore selector errors.
            }
        }

        return null;
    }

    /**
     * Extract both markdown text AND sanitized HTML from a message element.
     * Returns { text: string, html: string }
     */
    function getMessageContent(msgEl) {
        const contentEl = findElement(SELECTORS.contentSelectors, msgEl);
        const target = contentEl || msgEl;

        // Clone and strip non-content elements
        const clone = target.cloneNode(true);
        clone.querySelectorAll(
            'button, nav, .sr-only, svg, [aria-hidden="true"], script, style, .katex-html'
        ).forEach((el) => el.remove());

        // Get markdown (for export / search / fallback)
        const text = ChatSaverCommon.extractTextContent(clone).trim();

        // Get sanitized HTML (for rendering — preserves structure perfectly)
        const html = sanitizeHTML(clone.innerHTML);

        return { text, html };
    }

    /**
     * Sanitize HTML: keep only safe tags and attributes.
     * This strips ChatGPT's Tailwind classes and keeps structural elements.
     */
    function sanitizeHTML(rawHtml) {
        const temp = document.createElement('div');
        temp.innerHTML = rawHtml;

        const ALLOWED_TAGS = new Set([
            'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'ul', 'ol', 'li',
            'pre', 'code', 'blockquote',
            'table', 'thead', 'tbody', 'tr', 'th', 'td',
            'hr', 'img', 'span', 'div', 'sup', 'sub',
        ]);

        const ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'class', 'target', 'rel']);

        function cleanNode(node) {
            const children = Array.from(node.childNodes);
            for (const child of children) {
                if (child.nodeType === Node.ELEMENT_NODE) {
                    const tag = child.tagName.toLowerCase();
                    if (!ALLOWED_TAGS.has(tag)) {
                        // Replace disallowed tag with its children
                        while (child.firstChild) {
                            node.insertBefore(child.firstChild, child);
                        }
                        node.removeChild(child);
                        continue;
                    }

                    // Strip all attributes except allowed ones
                    const attrs = Array.from(child.attributes);
                    for (const attr of attrs) {
                        if (!ALLOWED_ATTRS.has(attr.name)) {
                            child.removeAttribute(attr.name);
                        }
                    }

                    // For code elements, only keep language class
                    if (tag === 'code') {
                        const langClass = child.className.match(/language-\S+/)?.[0];
                        if (langClass) {
                            child.className = langClass;
                        } else {
                            child.removeAttribute('class');
                        }
                    } else {
                        child.removeAttribute('class');
                    }

                    cleanNode(child);
                }
            }
        }

        cleanNode(temp);
        return temp.innerHTML.trim();
    }

    function getConversationTitle() {
        // 1. Try the active sidebar conversation link (most reliable)
        const sidebarSelectors = [
            'nav [aria-current="page"]',
            'nav a[class*="bg-token-sidebar"]',
            'nav li[class*="bg-token"] a',
            'nav a.bg-token-sidebar-surface-secondary',
            'nav [data-testid*="conversation"] a',
        ];

        for (const sel of sidebarSelectors) {
            try {
                const el = document.querySelector(sel);
                if (!el) continue;
                const text = (el.textContent || '').trim();
                if (text && text.length > 1 && text !== 'ChatGPT') {
                    return text.substring(0, 200);
                }
            } catch (err) { /* skip */ }
        }

        // 2. Try the page <title> tag — strip "ChatGPT - " prefix
        try {
            const pageTitle = document.title || '';
            const cleaned = pageTitle
                .replace(/^ChatGPT\s*[-–—]\s*/i, '')
                .trim();
            if (cleaned && cleaned !== 'ChatGPT' && cleaned.length > 1) {
                return cleaned.substring(0, 200);
            }
        } catch (err) { /* skip */ }

        // 3. Try any h1 on the page
        try {
            const h1 = document.querySelector('main h1, header h1');
            if (h1) {
                const text = (h1.textContent || '').trim();
                if (text && text !== 'ChatGPT') return text.substring(0, 200);
            }
        } catch (err) { /* skip */ }

        return 'Untitled Chat';
    }

    function scrapeConversation() {
        if (!isConversationPage()) return null;

        const messageEls = findAllElements(SELECTORS.messageGroups);
        if (messageEls.length === 0) return null;

        const messages = [];
        let lastRole = null;

        messageEls.forEach((msgEl, index) => {
            let role = getMessageRole(msgEl);
            if (!role) role = lastRole === 'user' ? 'assistant' : 'user';

            const result = getMessageContent(msgEl);
            if (!result || !result.text) return;

            messages.push({
                role,
                content: result.text,        // markdown (for search / export)
                contentHtml: result.html,     // sanitized HTML (for rendering)
                index,
            });
            lastRole = role;
        });

        if (messages.length === 0) return null;

        return {
            id: ChatSaverCommon.generateId('chatgpt', window.location.href),
            source: 'chatgpt',
            title: getConversationTitle(),
            url: window.location.href,
            messages,
        };
    }

    function saveCurrentConversation() {
        const conversation = scrapeConversation();
        if (!conversation || conversation.messages.length === 0) return;

        ChatSaverCommon.sendToBackground('SAVE_CONVERSATION', { conversation })
            .then(() => {
                if (indicator) indicator.flash();
                console.log(
                    `[ChatSaver] Saved ChatGPT conversation: "${conversation.title}" (${conversation.messages.length} msgs)`
                );
            })
            .catch((err) => {
                console.warn('[ChatSaver] Failed to save ChatGPT conversation:', err);
            });
    }

    const debouncedSave = ChatSaverCommon.debounce(saveCurrentConversation, 1800);

    function startObserving() {
        if (observer) observer.disconnect();

        const target = document.querySelector('main') || document.body;
        observer = new MutationObserver((mutations) => {
            let hasNewContent = false;

            for (const mutation of mutations) {
                if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) continue;

                for (const node of mutation.addedNodes) {
                    if (
                        node.nodeType === Node.ELEMENT_NODE &&
                        !node.matches?.('script, style, link, [aria-hidden="true"]')
                    ) {
                        hasNewContent = true;
                        break;
                    }
                }
                if (hasNewContent) break;
            }

            if (hasNewContent) debouncedSave();
        });

        observer.observe(target, {
            childList: true,
            subtree: true,
        });
    }

    function checkUrlChange() {
        const newId = ChatSaverCommon.generateId('chatgpt', window.location.href);
        if (newId === currentConvId) return;

        currentConvId = newId;
        setTimeout(saveCurrentConversation, 2200);
    }

    function init() {
        // Pass the save function to enable manual click-to-save
        indicator = ChatSaverCommon.createSaveIndicator({
            onClick: () => {
                const conversation = scrapeConversation();
                if (!conversation || conversation.messages.length === 0) return false;

                return ChatSaverCommon.sendToBackground('SAVE_CONVERSATION', { conversation })
                    .then(() => {
                        console.log(`[ChatSaver] Manual save: "${conversation.title}" (${conversation.messages.length} msgs)`);
                        return true;
                    })
                    .catch((err) => {
                        console.warn('[ChatSaver] Manual save failed:', err);
                        throw err;
                    });
            }
        });
        startObserving();

        currentConvId = ChatSaverCommon.generateId('chatgpt', window.location.href);
        urlCheckInterval = setInterval(checkUrlChange, 2000);
        periodicSaveInterval = setInterval(saveCurrentConversation, 15000);

        setTimeout(saveCurrentConversation, 2600);
        window.addEventListener('beforeunload', saveCurrentConversation);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') saveCurrentConversation();
        });

        console.log('[ChatSaver] ChatGPT auto-saver initialized');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 2000);
    }
})();
