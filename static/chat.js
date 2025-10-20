const socket = io();
let userInfo = {
    user_id: null,
    room: null,
    is_public: true,
    custom_str: ''
};

let idleTime = 0;
const IDLE_TIMEOUT = 60;
let idleInterval;

const chatContainer = document.getElementById('chat-container');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const customKeyInput = document.getElementById('custom-key');
const joinButton = document.getElementById('join-button');
const roomTypeElement = document.getElementById('room-type');
const onlineCountElement = document.getElementById('online-count');
const myNicknameElement = document.getElementById('my-nickname');
const idleTimerElement = document.getElementById('idle-timer');

function startIdleTimer() {
    idleTime = 0;
    updateIdleTimerDisplay();
    
    idleInterval = setInterval(() => {
        idleTime++;
        updateIdleTimerDisplay();
        
        if (idleTime >= IDLE_TIMEOUT) {
            clearInterval(idleInterval);
            fetch('/api/logout', { method: 'POST' })
                .then(() => window.location.href = '/');
        }
    }, 1000);
}

function updateIdleTimerDisplay() {
    idleTimerElement.textContent = IDLE_TIMEOUT - idleTime;
}

function resetIdleTimer() {
    clearInterval(idleInterval);
    startIdleTimer();
}

document.addEventListener('click', resetIdleTimer);
document.addEventListener('keypress', resetIdleTimer);
document.addEventListener('mousemove', resetIdleTimer);
document.addEventListener('scroll', resetIdleTimer);

joinButton.addEventListener('click', () => {
    joinButton.disabled = true;
    joinButton.textContent = '加入';
    
    resetIdleTimer();
    const customStr = customKeyInput.value.trim();
    if (userInfo.room) {
        socket.emit('leave_room', {
            user_id: userInfo.user_id,
            room: userInfo.room
        });
    }
    socket.emit('join_room', { custom_str: customStr });
    userInfo.custom_str = customStr;
    addNotification(`正在加入${customStr ? '私密' : '公共'}聊天室...`);
    
    setTimeout(() => {
        joinButton.disabled = false;
        joinButton.textContent = '加入';
    }, 2000);
});

socket.on('room_info', (data) => {
    userInfo = { ...userInfo, ...data };
    roomTypeElement.textContent = userInfo.is_public ? '公共聊天室' : '私密聊天室';
    onlineCountElement.textContent = data.online_count;
    myNicknameElement.textContent = data.user_id;
    messageInput.disabled = false;
    sendButton.disabled = false;
    addNotification(`已加入${userInfo.is_public ? '公共' : '私密'}聊天室`);
});

socket.on('user_status', (data) => {
    onlineCountElement.textContent = data.online_count;
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = data.status === 'online' ? 
        `${data.user_id} 加入了聊天室` : '有人离开了聊天室';
    chatContainer.appendChild(notification);
    scrollToBottom();
});

sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
    resetIdleTimer();
    const message = messageInput.value.trim();
    if (message && userInfo.user_id && userInfo.room) {
        const timestamp = new Date().toLocaleTimeString();
        addMessageToUI(message, userInfo.user_id, true, timestamp);
        socket.emit('send_message', {
            user_id: userInfo.user_id,
            room: userInfo.room,
            message: message,
            custom_str: userInfo.custom_str,
            timestamp: timestamp
        });
        messageInput.value = '';
    }
}

socket.on('receive_message', (data) => {
    const key = generateRoomKey(userInfo.custom_str);
    const decrypted = decryptMessage(data.encrypted_message, key);
    addMessageToUI(decrypted, data.user_id, false, data.timestamp);
});

function generateRoomKey(customStr) {
    if (!customStr) customStr = 'public';
    const hash = CryptoJS.SHA256(customStr);
    return CryptoJS.lib.WordArray.create(hash.words.slice(0, 4));
}

function decryptMessage(encryptedData, key) {
    try {
        const decoded = CryptoJS.enc.Base64.parse(encryptedData);
        const iv = CryptoJS.lib.WordArray.create(decoded.words.slice(0, 4), 16);
        const ciphertext = CryptoJS.lib.WordArray.create(decoded.words.slice(4));
        const decrypted = CryptoJS.AES.decrypt(
            { ciphertext: ciphertext },
            key,
            { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
        );
        const plaintext = decrypted.toString(CryptoJS.enc.Utf8);
        if (plaintext.startsWith('QsSama')) {
            return plaintext.substring(6);
        } else {
            return "识别码验证失败，请确认前后端程序版本";
        }
    } catch (e) {
        return "无法解密（可能与当前房间不符）";
    }
}

function addMessageToUI(message, senderId, isMyMessage, timestamp) {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${isMyMessage ? 'my-message' : 'other-message'}`;
    
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = isMyMessage ? `我 (${timestamp})` : `${senderId} (${timestamp})`;
    
    const content = document.createElement('div');
    content.textContent = message;
    
    messageElement.appendChild(meta);
    messageElement.appendChild(content);
    chatContainer.appendChild(messageElement);
    scrollToBottom();
}

function addNotification(text) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = text;
    chatContainer.appendChild(notification);
    scrollToBottom();
}

function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

window.addEventListener('beforeunload', () => {
    if (userInfo.room) {
        socket.emit('leave_room', {
            user_id: userInfo.user_id,
            room: userInfo.room
        });
    }
});

startIdleTimer();
