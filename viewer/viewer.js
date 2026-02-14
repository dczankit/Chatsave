/**
 * Chatsave Viewer — ChatGPT only
 * Book typography · Chat bubbles · Light/dark theme · Animations
 * Nested list support · Fullscreen mode
 */

(function () {
    'use strict';

    // ── State ──
    let allConversations = [];
    let filteredConversations = [];
    let currentConversation = null;
    let searchQuery = '';
    let loading = false;

    // ── DOM ──
    const searchInput = document.getElementById('searchInput');
    const conversationList = document.getElementById('conversationList');
    const sidebarStats = document.getElementById('sidebarStats');
    const emptyState = document.getElementById('emptyState');
    const chatContent = document.getElementById('chatContent');
    const chatTitle = document.getElementById('chatTitle');
    const chatDate = document.getElementById('chatDate');
    const chatMsgCount = document.getElementById('chatMsgCount');
    const chatMessages = document.getElementById('chatMessages');
    const chatHeader = document.getElementById('chatHeader');
    const exportBtn = document.getElementById('exportBtn');
    const deleteBtn = document.getElementById('deleteBtn');
    const closeChat = document.getElementById('closeChat');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarReopen = document.getElementById('sidebarReopen');
    const sidebar = document.getElementById('sidebar');
    const themeToggle = document.getElementById('themeToggle');

    /* =============================================
       Theme
       ============================================= */

    function getStoredTheme() {
        try { return localStorage.getItem('chatsave-theme'); } catch { return null; }
    }

    function setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem('chatsave-theme', theme); } catch { }
    }

    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        setTheme(current === 'dark' ? 'light' : 'dark');
    }

    function initTheme() {
        const stored = getStoredTheme();
        if (stored) setTheme(stored);
    }

    /* =============================================
       Sidebar toggle + header hide/show
       ============================================= */

    function toggleSidebar() {
        const isCollapsing = !sidebar.classList.contains('collapsed');
        sidebar.classList.toggle('collapsed');

        // Show/hide reopen button
        if (isCollapsing) {
            sidebarReopen.classList.add('visible');
            chatHeader.classList.add('hidden');
        } else {
            sidebarReopen.classList.remove('visible');
            chatHeader.classList.remove('hidden');
        }
    }

    function reopenSidebar() {
        sidebar.classList.remove('collapsed');
        sidebarReopen.classList.remove('visible');
        chatHeader.classList.remove('hidden');
    }

    /* =============================================
       Background messaging
       ============================================= */

    async function sendMessage(type, data = {}) {
        return new Promise((resolve, reject) => {
            try {
                chrome.runtime.sendMessage({ type, ...data }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (!response) {
                        reject(new Error('No response from background'));
                        return;
                    }
                    if (response.success === false) {
                        reject(new Error(response.error || 'Request failed'));
                        return;
                    }
                    resolve(response);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    async function fetchAllConversations() {
        const response = await sendMessage('GET_ALL_CONVERSATIONS');
        return Array.isArray(response.conversations) ? response.conversations : [];
    }

    async function removeConversation(id) {
        await sendMessage('DELETE_CONVERSATION', { id });
    }

    /* =============================================
       Data loading & filtering
       ============================================= */

    async function loadConversations(options = {}) {
        const preserveSelection = options.preserveSelection !== false;
        const selectedId = preserveSelection && currentConversation ? currentConversation.id : null;

        if (loading) return;
        loading = true;

        try {
            allConversations = await fetchAllConversations();
            allConversations.sort((a, b) =>
                new Date(b.updatedAt || b.savedAt) - new Date(a.updatedAt || a.savedAt)
            );
            applyFilters();
            updateStats();

            if (selectedId) {
                const updated = allConversations.find((c) => c.id === selectedId);
                if (updated) openConversation(updated);
                else clearCurrentConversation();
            }
        } catch (err) {
            console.error('Failed to load conversations:', err);
            conversationList.innerHTML = '<div class="no-conversations">Failed to load conversations</div>';
        } finally {
            loading = false;
        }
    }

    function applyFilters() {
        let results = allConversations.slice();

        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            results = results.filter((conv) => {
                if (conv.title && conv.title.toLowerCase().includes(q)) return true;
                if (conv.messages) {
                    return conv.messages.some(
                        (msg) => msg.content && msg.content.toLowerCase().includes(q)
                    );
                }
                return false;
            });
        }

        filteredConversations = results;
        renderConversationList();
    }

    function updateStats() {
        const total = allConversations.length;
        const totalMsgs = allConversations.reduce(
            (sum, conv) => sum + (conv.messages ? conv.messages.length : 0), 0
        );
        sidebarStats.textContent = `${total} chat${total !== 1 ? 's' : ''} · ${totalMsgs} messages`;
    }

    /* =============================================
       Sidebar list
       ============================================= */

    function renderConversationList() {
        if (filteredConversations.length === 0) {
            conversationList.innerHTML = '<div class="no-conversations">No conversations found</div>';
            return;
        }

        conversationList.innerHTML = filteredConversations.map((conv) => {
            const date = formatDate(conv.updatedAt || conv.savedAt);
            const msgCount = conv.messages ? conv.messages.length : 0;
            const preview = conv.messages && conv.messages[0]
                ? conv.messages[0].content.substring(0, 80)
                : 'No messages';
            const isActive = currentConversation && currentConversation.id === conv.id;

            return `
                <div class="conversation-item ${isActive ? 'active' : ''}" data-id="${conv.id}">
                    <div class="conv-title">${escapeHtml(conv.title || 'Untitled')}</div>
                    <div class="conv-meta">
                        <span class="conv-date">${date}</span>
                        <span class="conv-count">${msgCount} msg${msgCount !== 1 ? 's' : ''}</span>
                    </div>
                    <div class="conv-preview">${escapeHtml(preview)}</div>
                </div>
            `;
        }).join('');

        conversationList.querySelectorAll('.conversation-item').forEach((item) => {
            item.addEventListener('click', () => {
                const id = item.dataset.id;
                const conv = allConversations.find((c) => c.id === id);
                if (conv) openConversation(conv);
            });
        });
    }

    /* =============================================
       Conversation display
       ============================================= */

    function openConversation(conv) {
        currentConversation = conv;

        emptyState.style.display = 'none';
        chatContent.style.display = 'flex';
        chatContent.classList.add('active');

        chatTitle.textContent = conv.title || 'Untitled';
        chatDate.textContent = formatDate(conv.updatedAt || conv.savedAt);
        chatMsgCount.textContent = `${conv.messages ? conv.messages.length : 0} messages`;

        renderMessages(conv.messages || []);

        conversationList.querySelectorAll('.conversation-item').forEach((item) => {
            item.classList.toggle('active', item.dataset.id === conv.id);
        });
    }

    function renderMessages(messages) {
        chatMessages.innerHTML = messages.map((msg, index) => {
            const role = msg.role || (index % 2 === 0 ? 'user' : 'assistant');
            const roleLabel = role === 'user' ? 'You' : 'ChatGPT';

            // Use sanitized HTML from ChatGPT when available; fall back to markdown
            let content;
            if (msg.contentHtml) {
                content = msg.contentHtml;
            } else {
                content = renderMarkdown(msg.content || '');
            }

            return `
                <div class="message ${role}">
                    <div class="message-inner">
                        <div class="message-role">${roleLabel}</div>
                        <div class="message-content">${content}</div>
                    </div>
                </div>
            `;
        }).join('');

        // Wrap bare <pre> blocks with code-block container + copy button
        chatMessages.querySelectorAll('.message-content pre').forEach((pre) => {
            // Skip if already wrapped
            if (pre.parentElement.classList.contains('code-block')) return;

            const codeEl = pre.querySelector('code');
            const lang = codeEl
                ? (codeEl.className.match(/language-(\S+)/)?.[1] || 'code')
                : 'code';

            const wrapper = document.createElement('div');
            wrapper.className = 'code-block';
            wrapper.innerHTML = `
                <div class="code-block-header">
                    <span class="code-lang">${lang}</span>
                    <button class="code-copy-btn">Copy code</button>
                </div>
            `;
            pre.parentNode.insertBefore(wrapper, pre);
            wrapper.appendChild(pre);
        });

        // Syntax highlighting
        chatMessages.querySelectorAll('pre code').forEach((block) => {
            if (typeof hljs !== 'undefined') {
                hljs.highlightElement(block);
            }
        });

        // Copy buttons
        chatMessages.querySelectorAll('.code-copy-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const wrapper = btn.closest('.code-block');
                const code = wrapper ? wrapper.querySelector('code') : null;
                if (code) {
                    navigator.clipboard.writeText(code.textContent).then(() => {
                        btn.textContent = 'Copied!';
                        setTimeout(() => { btn.textContent = 'Copy code'; }, 1500);
                    });
                }
            });
        });

        chatMessages.scrollTop = 0;
    }

    /* =============================================
       Markdown Renderer (with nested list support)
       ============================================= */

    function renderMarkdown(raw) {
        // 1. Extract fenced code blocks
        const codeBlocks = [];
        let text = raw.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
            const idx = codeBlocks.length;
            codeBlocks.push({ language: lang || 'plaintext', code: code.trimEnd() });
            return `\x00CB_${idx}\x00`;
        });

        // 2. Extract inline code
        const inlineCodes = [];
        text = text.replace(/`([^`\n]+)`/g, (_, code) => {
            const idx = inlineCodes.length;
            inlineCodes.push(code);
            return `\x00IC_${idx}\x00`;
        });

        // 3. Block-level parse
        const lines = text.split('\n');
        const blocks = [];
        let i = 0;

        while (i < lines.length) {
            const line = lines[i];

            // Code block placeholder
            const cbMatch = line.match(/^\x00CB_(\d+)\x00$/);
            if (cbMatch) {
                const cb = codeBlocks[parseInt(cbMatch[1])];
                const escaped = escapeHtml(cb.code);
                blocks.push(
                    `<div class="code-block"><div class="code-block-header"><span class="code-lang">${cb.language}</span><button class="code-copy-btn">Copy code</button></div><pre><code class="language-${cb.language}">${escaped}</code></pre></div>`
                );
                i++;
                continue;
            }

            // Headings
            const hMatch = line.match(/^(#{1,4})\s+(.+)$/);
            if (hMatch) {
                const lvl = hMatch[1].length;
                // Map: # → h2, ## → h3, ### → h3, #### → h4
                const tag = lvl === 1 ? 'h2' : lvl <= 3 ? 'h3' : 'h4';
                blocks.push(`<${tag}>${inlineFormat(hMatch[2], inlineCodes)}</${tag}>`);
                i++;
                continue;
            }

            // Horizontal rule
            if (/^---+$/.test(line.trim())) { blocks.push('<hr>'); i++; continue; }

            // Blockquote
            if (line.startsWith('> ')) {
                const qLines = [];
                while (i < lines.length && lines[i].startsWith('> ')) {
                    qLines.push(lines[i].substring(2));
                    i++;
                }
                blocks.push(`<blockquote>${inlineFormat(qLines.join('<br>'), inlineCodes)}</blockquote>`);
                continue;
            }

            // List (unordered or ordered, with nesting)
            if (isListLine(line)) {
                blocks.push(parseList(lines, i, inlineCodes));
                // Advance past the consumed list lines
                while (i < lines.length && isListLine(lines[i])) i++;
                continue;
            }

            // Empty line
            if (line.trim() === '') { i++; continue; }

            // Paragraph
            const paraLines = [];
            while (i < lines.length) {
                const pLine = lines[i];
                if (pLine.trim() === '') break;
                if (/^#{1,4}\s/.test(pLine)) break;
                if (isListLine(pLine)) break;
                if (pLine.startsWith('> ')) break;
                if (/^---+$/.test(pLine.trim())) break;
                if (/^\x00CB_\d+\x00$/.test(pLine)) break;
                paraLines.push(pLine);
                i++;
            }
            if (paraLines.length > 0) {
                blocks.push(`<p>${inlineFormat(paraLines.join('<br>'), inlineCodes)}</p>`);
            }
        }

        return blocks.join('\n');
    }

    /**
     * Check if a line is a list item (optionally indented)
     */
    function isListLine(line) {
        return /^(\s*)[-*]\s+/.test(line) || /^(\s*)\d+\.\s+/.test(line);
    }

    /**
     * Parse a contiguous block of (possibly nested) list lines into HTML.
     * Uses indentation to determine nesting depth.
     */
    function parseList(lines, startIdx, inlineCodes) {
        // Collect all contiguous list lines
        const listLines = [];
        let idx = startIdx;
        while (idx < lines.length && isListLine(lines[idx])) {
            listLines.push(lines[idx]);
            idx++;
        }

        // Parse into a tree structure
        return buildListHTML(listLines, 0, inlineCodes).html;
    }

    /**
     * Recursively build nested list HTML from indented list lines.
     */
    function buildListHTML(listLines, fromIndex, inlineCodes) {
        if (fromIndex >= listLines.length) return { html: '', endIndex: fromIndex };

        // Determine base indentation from first line
        const baseIndent = getIndent(listLines[fromIndex]);
        // Determine list type from first line
        const isOrdered = /^\s*\d+\.\s+/.test(listLines[fromIndex]);
        const tag = isOrdered ? 'ol' : 'ul';

        let html = `<${tag}>`;
        let i = fromIndex;

        while (i < listLines.length) {
            const indent = getIndent(listLines[i]);

            if (indent < baseIndent) {
                // This line belongs to a parent list — stop
                break;
            }

            if (indent === baseIndent) {
                // Same-level item
                const text = listLines[i]
                    .replace(/^\s*[-*]\s+/, '')
                    .replace(/^\s*\d+\.\s+/, '');
                html += `<li>${inlineFormat(text, inlineCodes)}`;

                // Check if next lines are deeper (nested)
                if (i + 1 < listLines.length && getIndent(listLines[i + 1]) > baseIndent) {
                    const nested = buildListHTML(listLines, i + 1, inlineCodes);
                    html += nested.html;
                    i = nested.endIndex;
                } else {
                    i++;
                }
                html += '</li>';
            } else {
                // Deeper indentation but we haven't opened a child yet — edge case
                // Treat as nested list
                const nested = buildListHTML(listLines, i, inlineCodes);
                html += nested.html;
                i = nested.endIndex;
            }
        }

        html += `</${tag}>`;
        return { html, endIndex: i };
    }

    /**
     * Get indentation level (number of leading spaces)
     */
    function getIndent(line) {
        const match = line.match(/^(\s*)/);
        return match ? match[1].length : 0;
    }

    /**
     * Inline formatting: bold, italic, code, links
     */
    function inlineFormat(text, inlineCodes) {
        let html = escapeHtml(text);

        // Restore inline code placeholders
        html = html.replace(/\x00IC_(\d+)\x00/g, (_, idx) => {
            return `<code>${escapeHtml(inlineCodes[parseInt(idx)])}</code>`;
        });

        // Bold then italic
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');

        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

        // Arrows (→)
        html = html.replace(/→/g, '→');

        // Restore <br>
        html = html.replace(/&lt;br&gt;/g, '<br>');

        return html;
    }

    /* =============================================
       Actions
       ============================================= */

    function clearCurrentConversation() {
        currentConversation = null;
        emptyState.style.display = 'flex';
        chatContent.style.display = 'none';
        chatContent.classList.remove('active');
        conversationList.querySelectorAll('.conversation-item').forEach((el) => {
            el.classList.remove('active');
        });
    }

    function exportConversation() {
        if (!currentConversation) return;

        let md = `# ${currentConversation.title || 'Untitled'}\n\n`;
        md += `**Date:** ${formatDate(currentConversation.updatedAt || currentConversation.savedAt)}\n\n---\n\n`;

        (currentConversation.messages || []).forEach((msg) => {
            const role = msg.role === 'user' ? 'You' : 'ChatGPT';
            md += `### ${role}\n\n${msg.content || ''}\n\n`;
        });

        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(currentConversation.title || 'conversation').replace(/[<>:"/\\|?*]/g, '_')}.md`;
        a.click();
        URL.revokeObjectURL(url);
    }

    async function deleteCurrentConversation() {
        if (!currentConversation) return;
        if (!confirm('Delete this conversation? This cannot be undone.')) return;

        try {
            await removeConversation(currentConversation.id);
            clearCurrentConversation();
            await loadConversations({ preserveSelection: false });
        } catch (err) {
            console.error('Failed to delete:', err);
            alert('Failed to delete conversation');
        }
    }

    /* =============================================
       Utilities
       ============================================= */

    function formatDate(dateStr) {
        if (!dateStr) return 'Unknown';
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now - date;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7) return `${days}d ago`;

        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /* =============================================
       Init
       ============================================= */

    function init() {
        initTheme();
        loadConversations();

        // Event listeners
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            applyFilters();
        });

        themeToggle.addEventListener('click', toggleTheme);
        exportBtn.addEventListener('click', exportConversation);
        deleteBtn.addEventListener('click', deleteCurrentConversation);
        closeChat.addEventListener('click', clearCurrentConversation);
        sidebarToggle.addEventListener('click', toggleSidebar);
        sidebarReopen.addEventListener('click', reopenSidebar);

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                searchInput.focus();
            }
            if (e.key === 'Escape' && currentConversation) {
                clearCurrentConversation();
            }
        });

        console.log('[Chatsave] Viewer initialized');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
