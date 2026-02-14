/**
 * Claude Content Script
 * Auto-captures conversations from claude.ai
 */

(function () {
    'use strict';

    if (window.__chatSaverClaudeLoaded) return;
    window.__chatSaverClaudeLoaded = true;

    console.log('[ChatSaver] Claude content script loaded');

    let indicator = null;
    let currentConvId = null;
    let observer = null;
    let urlCheckInterval = null;
    let periodicSaveInterval = null;

    function isConversationPage() {
        const path = window.location.pathname || '';
        if (/\/chat\/[a-f0-9-]{8,}/.test(path)) return true;
        if (/\/[a-f0-9]{8}-[a-f0-9]{4}-/.test(path)) return true;
        return false;
    }

    /**
     * Collect ALL message turn elements from the page.
     * Claude uses data-testid="user-human-turn" for user and
     * data-testid="user-turn" for assistant messages.
     * We query BOTH at once so we get them interleaved in DOM order.
     */
    function getMessageElements() {
        // Strategy 1: Combined selector for both human and assistant turns
        const combined = document.querySelectorAll(
            '[data-testid="user-human-turn"], [data-testid="user-turn"]'
        );
        if (combined.length > 0) {
            console.log(`[ChatSaver] Strategy 1: found ${combined.length} turn elements`);
            return Array.from(combined);
        }

        // Strategy 2: Look for turn-like containers by class
        const byClass = document.querySelectorAll(
            'div[class*="turn"], div[class*="Turn"], div[class*="message-row"], div[class*="MessageRow"]'
        );
        if (byClass.length > 0) {
            console.log(`[ChatSaver] Strategy 2: found ${byClass.length} turn elements by class`);
            return Array.from(byClass);
        }

        // Strategy 3: Walk main content and find meaningful blocks
        const main = document.querySelector('main');
        if (main) {
            // Look for the conversation thread — usually a deeply nested scrollable container
            const allDivs = main.querySelectorAll('[data-testid]');
            const turns = [];
            for (const div of allDivs) {
                const tid = div.getAttribute('data-testid') || '';
                if (tid.includes('turn') || tid.includes('human') || tid.includes('message')) {
                    // Don't pick children of elements already in turns
                    const isNested = turns.some(t => t.contains(div));
                    if (!isNested) turns.push(div);
                }
            }
            if (turns.length > 0) {
                console.log(`[ChatSaver] Strategy 3: found ${turns.length} turn elements by data-testid scan`);
                return turns;
            }

            // Strategy 4: Direct children of main's inner container
            const innerContainer = main.querySelector('[class*="thread"], [class*="conversation"], [class*="Thread"]');
            if (innerContainer) {
                const children = Array.from(innerContainer.children).filter(c => {
                    const text = (c.textContent || '').trim();
                    return text.length > 3 && c.offsetHeight > 0 &&
                        !c.matches('nav, header, footer, aside, script, style');
                });
                if (children.length > 0) {
                    console.log(`[ChatSaver] Strategy 4: found ${children.length} elements from thread container`);
                    return children;
                }
            }
        }

        console.log('[ChatSaver] No message elements found');
        return [];
    }

    /**
     * Determine if a turn element is user or assistant.
     */
    function getMessageRole(el) {
        const testId = el.getAttribute('data-testid') || '';

        // Direct match on data-testid
        if (testId === 'user-human-turn' || testId.includes('human')) return 'user';
        if (testId === 'user-turn' || testId.includes('assistant') || testId.includes('response')) return 'assistant';

        // Check ancestors
        if (el.closest('[data-testid="user-human-turn"]') || el.closest('[data-testid*="human"]')) return 'user';
        if (el.closest('[data-testid="user-turn"]') || el.closest('[data-testid*="assistant"]')) return 'assistant';

        // Check class names
        const cls = String(el.className || '');
        if (/human|user/i.test(cls)) return 'user';
        if (/assistant|claude|response|ai/i.test(cls)) return 'assistant';

        // Check for font-claude-message which is assistant-only
        if (el.querySelector('.font-claude-message') || el.classList.contains('font-claude-message')) {
            return 'assistant';
        }

        // Check inner elements
        if (el.querySelector('[data-testid*="human"]')) return 'user';
        if (el.querySelector('[data-testid*="turn"]:not([data-testid*="human"])')) return 'assistant';
        if (el.querySelector('.font-claude-message')) return 'assistant';

        return null;
    }

    /**
     * Extract text content from a message turn element.
     */
    function getMessageContent(msgEl) {
        // Try high-specificity content selectors first
        const contentSelectors = [
            '.font-claude-message',
            '[class*="markdown"]',
            '[class*="Markdown"]',
            '.prose',
            '.whitespace-pre-wrap',
            'div[class*="message-content"]',
            'div[class*="messageContent"]',
        ];

        for (const sel of contentSelectors) {
            try {
                const el = msgEl.querySelector(sel);
                if (el) {
                    const text = ChatSaverCommon.extractTextContent(el).trim();
                    if (text.length > 0) return text;
                }
            } catch (e) { }
        }

        // Fallback: clone, strip chrome, extract text
        const clone = msgEl.cloneNode(true);
        clone.querySelectorAll(
            'button, nav, .sr-only, svg, [aria-hidden], [role="toolbar"], ' +
            '[class*="avatar"], [class*="Avatar"], [class*="icon"], [class*="Icon"], ' +
            '[class*="action"], [class*="Action"], [class*="toolbar"], [class*="Toolbar"]'
        ).forEach(el => el.remove());

        const text = ChatSaverCommon.extractTextContent(clone).trim();
        return text;
    }

    function getConversationTitle() {
        const titleSelectors = [
            '[data-testid="chat-title"]',
            'button[data-testid*="title"]',
            'header [class*="truncate"]',
            'header button span',
            'header h1',
            'header h2',
            'nav button[aria-current]',
        ];

        for (const sel of titleSelectors) {
            try {
                const el = document.querySelector(sel);
                if (!el) continue;
                const text = (el.textContent || '').trim();
                if (text && text !== 'Claude' && text !== 'New chat' && text.length > 1 && text.length < 280) {
                    return text;
                }
            } catch (err) { }
        }

        // Try the page title as fallback
        const pageTitle = document.title || '';
        if (pageTitle && !pageTitle.includes('Claude') && pageTitle.length > 2 && pageTitle.length < 200) {
            return pageTitle;
        }

        return 'Untitled Chat';
    }

    function scrapeConversation() {
        if (!isConversationPage()) {
            console.log('[ChatSaver] Not a conversation page:', window.location.pathname);
            return null;
        }

        const messageEls = getMessageElements();
        if (messageEls.length === 0) return null;

        const messages = [];
        let lastRole = null;

        messageEls.forEach((msgEl, index) => {
            let role = getMessageRole(msgEl);
            if (!role) {
                // Alternate roles as fallback
                role = lastRole === 'user' ? 'assistant' : 'user';
            }

            const content = getMessageContent(msgEl);
            if (!content || content.length < 2) return;

            // Skip duplicates
            if (messages.length > 0 && messages[messages.length - 1].content === content) return;

            messages.push({ role, content, index });
            lastRole = role;
        });

        if (messages.length === 0) {
            console.log('[ChatSaver] No messages extracted');
            return null;
        }

        console.log(`[ChatSaver] Scraped ${messages.length} messages (user: ${messages.filter(m => m.role === 'user').length}, assistant: ${messages.filter(m => m.role === 'assistant').length})`);

        return {
            id: ChatSaverCommon.generateId('claude', window.location.href),
            source: 'claude',
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
                    `[ChatSaver] Saved Claude conversation: "${conversation.title}" (${conversation.messages.length} msgs)`
                );
            })
            .catch((err) => {
                console.warn('[ChatSaver] Failed to save Claude conversation:', err);
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
                    if (node.nodeType === Node.ELEMENT_NODE && !node.matches?.('script, style, link')) {
                        hasNewContent = true;
                        break;
                    }
                }
                if (hasNewContent) break;
            }

            if (hasNewContent) debouncedSave();
        });

        observer.observe(target, { childList: true, subtree: true });
    }

    function checkUrlChange() {
        const newId = ChatSaverCommon.generateId('claude', window.location.href);
        if (newId === currentConvId) return;

        currentConvId = newId;
        setTimeout(saveCurrentConversation, 2200);
    }

    function init() {
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

        currentConvId = ChatSaverCommon.generateId('claude', window.location.href);
        urlCheckInterval = setInterval(checkUrlChange, 2000);
        periodicSaveInterval = setInterval(saveCurrentConversation, 15000);

        setTimeout(saveCurrentConversation, 2600);
        window.addEventListener('beforeunload', saveCurrentConversation);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') saveCurrentConversation();
        });

        console.log('[ChatSaver] Claude auto-saver initialized');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 2000);
    }
})();
