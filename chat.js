// --- Theme Logic ---
const themeToggle = document.getElementById('themeToggle');
const htmlEl = document.documentElement;

if (localStorage.getItem('theme') === 'dark' || 
   (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    htmlEl.classList.add('dark');
} else {
    htmlEl.classList.remove('dark');
}

themeToggle?.addEventListener('click', () => {
    htmlEl.classList.toggle('dark');
    localStorage.setItem('theme', htmlEl.classList.contains('dark') ? 'dark' : 'light');
});

// --- Chat Logic ---
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const chatMessages = document.getElementById('chat-messages');
const sendBtn = document.getElementById('send-btn');
const stopBtn = document.getElementById('stop-btn');

let controller = null;

if (chatForm) {
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = userInput.value.trim();
        if (!text) return;

        addMessage(text, 'user');
        userInput.value = '';
        userInput.style.height = 'auto';

        setLoading(true);

        controller = new AbortController();
        const signal = controller.signal;

        try {
            const loadingId = addLoadingBubble();

            // Updated URL to point to localhost or your domain
            const response = await fetch("http://localhost:8080/ask", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ "question": text }),
                signal: signal
            });

            if (!response.ok) throw new Error(`Server Error: ${response.status}`);

            const data = await response.json();

            removeMessage(loadingId);

            if (data.answer) {
                // Pass request_id to the typewriter function
                await typeWriterEffect(data.answer, data.sources || [], data.request_id);
            } else {
                addMessage("Received empty response from server.", 'error');
            }

        } catch (error) {
            removeLoadingBubbleIfAny();
            if (error.name === 'AbortError') {
                addMessage("Generation stopped by user.", 'system');
            } else {
                addMessage("Error connecting to AI: " + error.message, 'error');
            }
        } finally {
            setLoading(false);
            controller = null;
        }
    });

    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            chatForm.dispatchEvent(new Event('submit', { cancelable: true }));
        }
    });
}

stopBtn.addEventListener('click', () => {
    if (controller) controller.abort();
});

// --- Feedback Function ---
async function sendFeedback(requestId, rating, btnElement) {
    if (!requestId) return;
    
    // UI Feedback immediately
    const parent = btnElement.parentElement;
    parent.innerHTML = `<span class="text-xs text-gray-500 italic">Thanks for feedback!</span>`;

    try {
        await fetch("http://localhost:8080/feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                request_id: requestId, 
                rating: rating 
            })
        });
    } catch (e) {
        console.error("Failed to send feedback", e);
    }
}

// --- Helper Functions ---

function addMessage(text, type) {
    const div = document.createElement('div');
    div.className = `flex flex-col animate-fade-in ${type === 'user' ? 'items-end' : 'items-start'}`;
    
    let bubbleClass = '';
    if (type === 'user') {
        bubbleClass = 'bg-indigo-600 text-white rounded-br-none';
    } else if (type === 'error' || type === 'system') {
        bubbleClass = 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm border border-red-200 dark:border-red-800';
    } else {
        bubbleClass = 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-tl-none';
    }

    div.innerHTML = `
        <div class="${bubbleClass} px-4 py-3 rounded-2xl shadow-sm max-w-[85%] break-words prose dark:prose-invert">
            ${escapeHtml(text)}
        </div>
    `;
    
    chatMessages.appendChild(div);
    scrollToBottom();
}

async function typeWriterEffect(fullText, sources, requestId) {
    const div = document.createElement('div');
    div.className = `flex flex-col items-start animate-fade-in`;
    
    const bubble = document.createElement('div');
    bubble.className = 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-4 py-3 rounded-2xl rounded-tl-none shadow-sm max-w-[95%] md:max-w-[85%] prose dark:prose-invert';
    div.appendChild(bubble);
    chatMessages.appendChild(div);
    scrollToBottom();

    // Sanitize and Render Markdown
    const rawHtml = DOMPurify.sanitize(marked.parse(fullText));
    let cleanedHtml = rawHtml.replace(/<p>[\s\S]*?\[\[CRITICAL UPDATE.*?\]\][\s\S]*?<\/p>/gi, '');
    bubble.innerHTML = cleanedHtml;

    // Append Sources
    if (sources && sources.length > 0) {
        const sourceContainer = document.createElement('div');
        sourceContainer.className = "mt-3 pt-3 border-t border-gray-300 dark:border-gray-600 text-xs";
        let sourceHtml = '<p class="font-bold text-gray-500 dark:text-gray-400 mb-1">SOURCES:</p><ul class="space-y-1">';
        
        sources.forEach((src, index) => {
            const displayUrl = src.length > 40 ? src.substring(0, 37) + '...' : src;
            sourceHtml += `<li><span class="text-gray-400 mr-1">[${index+1}]</span> <a href="${src}" target="_blank" class="text-indigo-600 dark:text-indigo-400 hover:underline">${displayUrl}</a></li>`;
        });
        sourceHtml += '</ul>';
        bubble.insertAdjacentHTML('beforeend', sourceHtml);
    }
    
    // Append Feedback Buttons
    if (requestId) {
        const feedbackHtml = `
            <div class="mt-2 flex items-center gap-3 pt-2">
                <button onclick="sendFeedback('${requestId}', 'up', this)" class="opacity-50 hover:opacity-100 transition-opacity text-gray-500 hover:text-green-600" title="Good answer">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                </button>
                <button onclick="sendFeedback('${requestId}', 'down', this)" class="opacity-50 hover:opacity-100 transition-opacity text-gray-500 hover:text-red-600" title="Bad answer">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path></svg>
                </button>
            </div>
        `;
        bubble.insertAdjacentHTML('beforeend', feedbackHtml);
    }
    
    scrollToBottom();
}

function addLoadingBubble() {
    const id = 'loading-' + Date.now();
    const div = document.createElement('div');
    div.id = id;
    div.className = `flex flex-col items-start animate-fade-in`;
    div.innerHTML = `
        <div class="bg-gray-100 dark:bg-gray-700 px-4 py-4 rounded-2xl rounded-tl-none shadow-sm">
            <div class="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
            </div>
        </div>
    `;
    chatMessages.appendChild(div);
    scrollToBottom();
    return id;
}

function removeMessage(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function removeLoadingBubbleIfAny() {
    const bubbles = document.querySelectorAll("[id^='loading-']");
    bubbles.forEach(b => b.remove());
}

function setLoading(isLoading) {
    if (isLoading) {
        sendBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
        userInput.disabled = true;
    } else {
        sendBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
        userInput.disabled = false;
        userInput.focus();
    }
}

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(text) {
    if (!text) return text;
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
