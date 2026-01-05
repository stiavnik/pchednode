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

let controller = null; // AbortController for stopping requests

if (chatForm) {
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault(); // STOP PAGE RELOAD
        const text = userInput.value.trim();
        if (!text) return;

        // 1. Add User Message
        addMessage(text, 'user');
        userInput.value = '';
        userInput.style.height = 'auto'; // Reset height

        // 2. Set Loading State
        setLoading(true);

        // 3. Prepare Fetch with AbortController
        controller = new AbortController();
        const signal = controller.signal;

        try {
            // Add a temporary loading bubble
            const loadingId = addLoadingBubble();

            const response = await fetch("https://pchedai.pchednode.com/ask", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ "question": text }),
                signal: signal
            });

            if (!response.ok) throw new Error(`Server Error: ${response.status}`);

            const data = await response.json();

            // Remove loading bubble
            removeMessage(loadingId);

            // 4. Display AI Response
            if (data.answer) {
                await typeWriterEffect(data.answer, data.sources || []);
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

    // Handle Enter key to submit (Shift+Enter for new line)
    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            // Dispatch a cancelable submit event
            chatForm.dispatchEvent(new Event('submit', { cancelable: true }));
        }
    });
}

stopBtn.addEventListener('click', () => {
    if (controller) {
        controller.abort();
    }
});

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

// Function specifically for the AI response to support Markdown and Sources
async function typeWriterEffect(fullText, sources) {
    const div = document.createElement('div');
    div.className = `flex flex-col items-start animate-fade-in`;
    
    // Create the container
    const bubble = document.createElement('div');
    bubble.className = 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-4 py-3 rounded-2xl rounded-tl-none shadow-sm max-w-[95%] md:max-w-[85%] prose dark:prose-invert';
    div.appendChild(bubble);
    chatMessages.appendChild(div);
    scrollToBottom();

    // Parse Markdown safely
    // Note: marked.parse is correct for v4+
    const rawHtml = DOMPurify.sanitize(marked.parse(fullText));
	// Remove leaked CRITICAL UPDATE blocks client-side as safety net
	let cleanedHtml = rawHtml.replace(/<p>[\s\S]*?\[\[CRITICAL UPDATE.*?\]\][\s\S]*?<\/p>/gi, '');
	cleanedHtml = cleanedHtml.replace(/<ul>[\s\S]*?Airdrop 2 Claim Date[\s\S]*?<\/ul>/gi, ''); // if bullet list leaked
	bubble.innerHTML = cleanedHtml;

    // Append Sources if available
    if (sources && sources.length > 0) {
        const sourceContainer = document.createElement('div');
        sourceContainer.className = "mt-3 pt-3 border-t border-gray-300 dark:border-gray-600 text-xs";
        let sourceHtml = '<p class="font-bold text-gray-500 dark:text-gray-400 mb-1">SOURCES:</p><ul class="space-y-1">';
        
        sources.forEach((src, index) => {
            // Truncate long URLs for display
            const displayUrl = src.length > 40 ? src.substring(0, 37) + '...' : src;
            sourceHtml += `<li><span class="text-gray-400 mr-1">[${index+1}]</span> <a href="${src}" target="_blank" class="text-indigo-600 dark:text-indigo-400 hover:underline">${displayUrl}</a></li>`;
        });
        sourceHtml += '</ul>';
        bubble.insertAdjacentHTML('beforeend', sourceHtml);
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
