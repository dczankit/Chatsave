/**
 * Popup Script
 * Shows status and storage stats.
 */

document.addEventListener('DOMContentLoaded', initPopup);

async function initPopup() {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const totalConvos = document.getElementById('totalConvos');
    const totalMsgs = document.getElementById('totalMsgs');
    const sourcesDiv = document.getElementById('sources');
    const openViewerBtn = document.getElementById('openViewer');

    await updateTabStatus(statusDot, statusText);
    await loadStats(totalConvos, totalMsgs, sourcesDiv);

    openViewerBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('viewer/viewer.html') });
        window.close();
    });
}

async function updateTabStatus(statusDot, statusText) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const url = tab && tab.url ? tab.url : '';

        if (url.includes('chat.openai.com') || url.includes('chatgpt.com')) {
            statusDot.classList.add('active');
            statusText.textContent = 'Ready on ChatGPT';
            return;
        }

        statusText.textContent = 'Open ChatGPT to start saving';
    } catch (err) {
        statusText.textContent = 'Open ChatGPT to start saving';
    }
}

async function loadStats(totalConvos, totalMsgs, sourcesDiv) {
    try {
        const response = await sendMessage('GET_STATS');
        if (!response || response.success !== true || !response.stats) {
            throw new Error(response && response.error ? response.error : 'Stats unavailable');
        }

        const stats = response.stats;
        totalConvos.textContent = String(stats.totalConversations || 0);
        totalMsgs.textContent = String(stats.totalMessages || 0);
        renderSources(sourcesDiv, stats.sources || {});
    } catch (err) {
        totalConvos.textContent = '0';
        totalMsgs.textContent = '0';
        renderSources(sourcesDiv, {});
    }
}

function renderSources(sourcesDiv, sources) {
    const entries = Object.entries(sources);
    if (entries.length === 0) {
        sourcesDiv.innerHTML = '<div class="empty-note">No chats saved yet.</div>';
        return;
    }

    sourcesDiv.innerHTML = entries
        .map(([source, count]) => {
            const sourceName = source === 'chatgpt' ? 'ChatGPT' : source === 'claude' ? 'Claude' : source;
            return `
        <div class="source-item">
          <span>${sourceName}</span>
          <span class="source-count">${count}</span>
        </div>
      `;
        })
        .join('');
}

function sendMessage(type, data = {}) {
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendMessage({ type, ...data }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(response);
            });
        } catch (err) {
            reject(err);
        }
    });
}
