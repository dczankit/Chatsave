/**
 * Common utilities shared by ChatGPT and Claude content scripts
 */

const ChatSaverCommon = (() => {
    /**
     * Recursively extract text content from a DOM element,
     * preserving code blocks, formatting, and nested lists.
     *
     * @param {Element} element - DOM element to extract from
     * @param {Object}  ctx     - internal context for recursion
     * @param {boolean} ctx.inline - suppress block-level newlines (inside <li> text)
     * @param {number}  ctx.indent - current list nesting depth (0 = top-level)
     */
    function extractTextContent(element, ctx) {
        if (!element) return '';
        const inline = ctx && ctx.inline;
        const indent = (ctx && ctx.indent) || 0;

        let result = '';
        const children = element.childNodes;

        for (const child of children) {
            if (child.nodeType === Node.TEXT_NODE) {
                result += child.textContent;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const tag = child.tagName.toLowerCase();

                // --- Skip non-content elements ---
                if (tag === 'svg' || tag === 'button' || tag === 'nav' || tag === 'style' || tag === 'script') {
                    continue;
                }

                // --- Code blocks / inline code ---
                if (tag === 'pre') {
                    const codeEl = child.querySelector('code') || child;
                    const lang = extractCodeLanguage(codeEl);
                    const codeText = codeEl.textContent || '';
                    result += '\n```' + lang + '\n' + codeText.trim() + '\n```\n';
                    continue;
                }
                if (tag === 'code') {
                    result += '`' + child.textContent + '`';
                    continue;
                }

                // --- Line break ---
                if (tag === 'br') {
                    result += inline ? ' ' : '\n';
                    continue;
                }

                // --- Paragraph ---
                if (tag === 'p') {
                    if (inline) {
                        const inner = extractTextContent(child, { inline: true, indent });
                        if (result.length > 0 && !result.endsWith(' ')) result += ' ';
                        result += inner;
                    } else {
                        result += '\n' + extractTextContent(child, { indent }) + '\n';
                    }
                    continue;
                }

                // --- Div ---
                if (tag === 'div') {
                    if (inline) {
                        result += extractTextContent(child, { inline: true, indent });
                    } else {
                        result += extractTextContent(child, { indent });
                    }
                    continue;
                }

                // --- Lists (with nesting support) ---
                if (tag === 'ul' || tag === 'ol') {
                    result += processListElement(child, indent);
                    continue;
                }
                // Standalone <li> (shouldn't hit often — handled by processListElement)
                if (tag === 'li') {
                    result += processListItem(child, indent, '-');
                    continue;
                }

                // --- Inline formatting ---
                if (tag === 'strong' || tag === 'b') {
                    result += '**' + extractTextContent(child, ctx) + '**';
                    continue;
                }
                if (tag === 'em' || tag === 'i') {
                    result += '*' + extractTextContent(child, ctx) + '*';
                    continue;
                }

                // --- Headings ---
                if (/^h[1-6]$/.test(tag)) {
                    const level = parseInt(tag[1]);
                    const text = extractTextContent(child, { inline: true }).trim();
                    result += '\n\n' + '#'.repeat(level) + ' ' + text + '\n\n';
                    continue;
                }

                // --- Links ---
                if (tag === 'a') {
                    const href = child.getAttribute('href') || '';
                    const text = extractTextContent(child, ctx);
                    if (href && !href.startsWith('javascript:')) {
                        result += '[' + text + '](' + href + ')';
                    } else {
                        result += text;
                    }
                    continue;
                }

                // --- Blockquote ---
                if (tag === 'blockquote') {
                    const inner = extractTextContent(child).trim();
                    const lines = inner.split('\n');
                    result += '\n' + lines.map((l) => '> ' + l).join('\n') + '\n';
                    continue;
                }

                // --- Table ---
                if (tag === 'table') {
                    result += '\n' + extractTableContent(child) + '\n';
                    continue;
                }

                // --- Image ---
                if (tag === 'img') {
                    const alt = child.getAttribute('alt') || 'image';
                    const src = child.getAttribute('src') || '';
                    result += '![' + alt + '](' + src + ')';
                    continue;
                }

                // --- Horizontal rule ---
                if (tag === 'hr') {
                    result += '\n\n---\n\n';
                    continue;
                }

                // --- Fallback: recurse ---
                result += extractTextContent(child, ctx);
            }
        }

        return inline ? result : cleanMarkdown(result);
    }

    /**
     * Process a <ul> or <ol> element into markdown with proper indentation.
     */
    function processListElement(listEl, indent) {
        const tag = listEl.tagName.toLowerCase();
        const isOrdered = tag === 'ol';
        const items = listEl.querySelectorAll(':scope > li');
        let result = '\n';

        items.forEach((item, i) => {
            const marker = isOrdered ? (i + 1) + '.' : '-';
            result += processListItem(item, indent, marker);
        });

        return result;
    }

    /**
     * Process a single <li>: extract inline text content,
     * then recursively process any nested <ul>/<ol> with increased indent.
     */
    function processListItem(li, indent, marker) {
        const prefix = '  '.repeat(indent);
        let textParts = '';
        let nestedLists = '';

        for (const child of li.childNodes) {
            if (child.nodeType === Node.ELEMENT_NODE) {
                const tag = child.tagName.toLowerCase();
                // Nested list → process as sub-list with deeper indent
                if (tag === 'ul' || tag === 'ol') {
                    nestedLists += processListElement(child, indent + 1);
                    continue;
                }
            }
            // Everything else is inline text content of this list item
            textParts += extractTextContent(child, { inline: true, indent });
        }

        return prefix + marker + ' ' + textParts.trim() + '\n' + nestedLists;
    }

    /**
     * Post-process markdown: collapse excessive blank lines, trim edges
     */
    function cleanMarkdown(text) {
        return text
            .replace(/\n{3,}/g, '\n\n')   // collapse 3+ newlines to 2
            .replace(/^\n+/, '')            // trim leading newlines
            .replace(/\n+$/, '');           // trim trailing newlines
    }

    /**
     * Extract language from a code element's class (e.g., "language-python")
     */
    function extractCodeLanguage(codeEl) {
        const classes = codeEl.className || '';
        const match = classes.match(/language-(\w+)/);
        return match ? match[1] : '';
    }

    /**
     * Extract table content as markdown
     */
    function extractTableContent(table) {
        const rows = table.querySelectorAll('tr');
        if (rows.length === 0) return '';

        let md = '';
        rows.forEach((row, i) => {
            const cells = row.querySelectorAll('th, td');
            const cellTexts = Array.from(cells).map((c) => c.textContent.trim());
            md += '| ' + cellTexts.join(' | ') + ' |\n';
            if (i === 0) {
                md += '| ' + cellTexts.map(() => '---').join(' | ') + ' |\n';
            }
        });

        return md;
    }

    /**
     * Debounce a function
     */
    function debounce(fn, ms) {
        let timer;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), ms);
        };
    }

    /**
     * Generate a stable conversation ID from the source and URL
     */
    function generateId(source, url) {
        // Extract conversation ID from URL if possible
        let pathParts = [];
        try {
            const urlObj = new URL(url);
            pathParts = urlObj.pathname.split('/').filter(Boolean);
        } catch (err) {
            pathParts = [];
        }

        if (source === 'chatgpt') {
            // URLs like /c/abc123 or /g/abc123
            const chatId = pathParts.find((p) => p.length > 8 && p !== 'c' && p !== 'g' && p !== 'chat');
            if (chatId) return 'chatgpt_' + chatId;
        }

        if (source === 'claude') {
            // URLs like /chat/abc123
            const chatId = pathParts.find((p) => p.length > 8 && p !== 'chat' && p !== 'new');
            if (chatId) return 'claude_' + chatId;
        }

        // Fallback: hash the URL
        let hash = 0;
        const str = source + '_' + url;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return source + '_' + Math.abs(hash).toString(36);
    }

    /**
     * Send a message to the background service worker
     */
    function sendToBackground(type, data) {
        const payload = { type, ...data };

        function sendOnce() {
            return new Promise((resolve, reject) => {
                try {
                    chrome.runtime.sendMessage(payload, (response) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                            return;
                        }

                        if (!response) {
                            reject(new Error('No response from background service worker'));
                            return;
                        }

                        if (response.success === false) {
                            reject(new Error(response.error || 'Background operation failed'));
                            return;
                        }

                        resolve(response);
                    });
                } catch (e) {
                    reject(e);
                }
            });
        }

        return sendOnce().catch((err) => {
            const message = (err && err.message) ? err.message : String(err);
            const shouldRetry =
                message.includes('Could not establish connection') ||
                message.includes('Receiving end does not exist');

            if (!shouldRetry) {
                console.warn('[ChatSaver] sendMessage error:', message);
                throw err;
            }

            return new Promise((resolve) => setTimeout(resolve, 250)).then(sendOnce);
        });
    }

    /**
     * Create and manage the save indicator dot
     */
    function createSaveIndicator(options = {}) {
        const onClick = options && typeof options.onClick === 'function' ? options.onClick : null;
        const dot = document.createElement('div');
        dot.id = 'chatsaver-indicator';
        dot.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #f0f0f0;
      z-index: 999999;
      transition: all 0.3s ease;
      opacity: 0.8;
      cursor: pointer;
      box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.55);
    `;
        dot.title = onClick
            ? 'Offline Chat Saver: Click to save now'
            : 'Offline Chat Saver: Active';
        document.body.appendChild(dot);

        let resetTimer = null;
        let clickBusy = false;

        function scheduleReset() {
            clearTimeout(resetTimer);
            resetTimer = setTimeout(() => {
                dot.style.transform = 'scale(1)';
                dot.style.opacity = '0.8';
                dot.style.background = '#f0f0f0';
                dot.title = onClick
                    ? 'Offline Chat Saver: Click to save now'
                    : 'Offline Chat Saver: Active';
            }, 900);
        }

        async function doManualSave() {
            if (!onClick || clickBusy) return false;

            clickBusy = true;
            clearTimeout(resetTimer);
            dot.style.transform = 'scale(1.3)';
            dot.style.opacity = '1';
            dot.title = 'Offline Chat Saver: Saving...';

            try {
                const result = await onClick();
                if (result === false) {
                    dot.style.background = '#7a7a7a';
                    dot.title = 'Offline Chat Saver: No conversation to save';
                    scheduleReset();
                    return false;
                }

                dot.style.background = '#ffffff';
                dot.title = 'Offline Chat Saver: Saved';
                scheduleReset();
                return true;
            } catch (err) {
                dot.style.background = '#9b4b4b';
                dot.title = 'Offline Chat Saver: Save failed';
                scheduleReset();
                return false;
            } finally {
                clickBusy = false;
            }
        }

        // Bind click event for manual save if handler provided
        if (onClick) {
            dot.addEventListener('click', () => {
                doManualSave();
            });
        }

        return {
            flash() {
                clearTimeout(resetTimer);
                dot.style.transform = 'scale(1.5)';
                dot.style.opacity = '1';
                dot.style.background = '#ffffff';
                setTimeout(() => {
                    dot.style.transform = 'scale(1)';
                    dot.style.opacity = '0.8';
                    dot.style.background = '#f0f0f0';
                }, 400);
            },
            manualSave: doManualSave,
            setInactive() {
                dot.style.background = '#666';
                dot.title = 'Offline Chat Saver: Inactive';
            },
            setActive() {
                dot.style.background = '#f0f0f0';
                dot.title = 'Offline Chat Saver: Active';
            },
            remove() {
                dot.remove();
            },
        };
    }

    /**
     * Wait for an element to appear in the DOM
     */
    function waitForElement(selector, timeout = 15000) {
        return new Promise((resolve, reject) => {
            const el = document.querySelector(selector);
            if (el) return resolve(el);

            const observer = new MutationObserver((mutations, obs) => {
                const el = document.querySelector(selector);
                if (el) {
                    obs.disconnect();
                    resolve(el);
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });

            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Timeout waiting for ${selector}`));
            }, timeout);
        });
    }

    return {
        extractTextContent,
        debounce,
        generateId,
        sendToBackground,
        createSaveIndicator,
        waitForElement,
    };
})();
