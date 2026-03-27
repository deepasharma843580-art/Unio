// UNIO Hazel AI Engine
const keys = [
    'b5d612ae-6729-46bb-bfff-8be8125ec361',
    'bbfcf834-9cdf-47c9-ae63-7b39171b645c',
    '0f47482e-c576-4b14-bada-e2fbe2f26745'
];

let keyIndex = 0;
const user = JSON.parse(localStorage.getItem('user') || '{}');
const balance = document.getElementById('balance')?.innerText || 'Unknown'; // Get from storage or DOM

function getNextKey() {
    const key = keys[keyIndex];
    keyIndex = (keyIndex + 1) % keys.length; // Round-robin rotation
    return key;
}

async function sendMessage() {
    const input = document.getElementById('user-input');
    const container = document.getElementById('chat-container');
    const text = input.value.trim();
    
    if (!text) return;

    // Add User Message
    addMessage(text, 'user');
    input.value = '';

    // Show Typing
    document.getElementById('typing').style.display = 'block';

    // System Prompt - Hazel's Personality
    const systemPrompt = `You are Hazel, the official AI assistant of UNIO Wallet.
    User Profile: Name: ${user.name}, Mobile: ${user.mobile}, ID: ${user._id}.
    Context: Current Balance is ₹${balance}.
    Rules: 
    1. If user asks about their own profile or balance, tell them.
    2. If user asks about Admin, owner details, database, or sensitive system info, strictly say: "Sorry, I didn't accept this request."
    3. Keep responses professional, helpful, and short. Use Hinglish if the user asks in Hindi.`;

    try {
        const response = await fetch('https://api.sambanova.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getNextKey()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "Meta-Llama-3.1-70B-Instruct",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: text }
                ],
                temperature: 0.7
            })
        });

        const data = await response.json();
        const aiResponse = data.choices[0].message.content;
        
        document.getElementById('typing').style.display = 'none';
        addMessage(aiResponse, 'bot');

    } catch (error) {
        document.getElementById('typing').style.display = 'none';
        addMessage("Sorry, server busy hai. Please try again.", 'bot');
    }
}

function addMessage(text, side) {
    const container = document.getElementById('chat-container');
    const div = document.createElement('div');
    div.className = `msg ${side}`;
    div.innerHTML = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// Enter key support
document.getElementById('user-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

