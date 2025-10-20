const loginForm = document.getElementById('login-form');
const passwordInput = document.getElementById('password');
const errorMessage = document.getElementById('error-message');
const infoMessage = document.getElementById('info-message');
const loginButton = document.getElementById('login-button');
let countdownTimer = null;

window.addEventListener('load', checkLockStatus);

async function checkLockStatus() {
    try {
        const response = await fetch('/api/check-lock');
        const data = await response.json();
        
        if (data.locked) {
            disableLoginElements(true);
            infoMessage.classList.add('visible');
            updateCountdown(data.remaining_time);
        } else {
            disableLoginElements(false);
            infoMessage.classList.remove('visible');
        }
    } catch (error) {
        console.error('检查锁定状态失败:', error);
        disableLoginElements(false);
        infoMessage.classList.remove('visible');
    }
}

function disableLoginElements(isDisabled) {
    loginButton.disabled = isDisabled;
    passwordInput.disabled = isDisabled;
    if (isDisabled) passwordInput.value = '';
}

function updateCountdown(seconds) {
    if (countdownTimer) clearInterval(countdownTimer);
    
    countdownTimer = setInterval(() => {
        if (seconds <= 0) {
            clearInterval(countdownTimer);
            disableLoginElements(false);
            errorMessage.textContent = '';
            infoMessage.classList.remove('visible');
            window.location.reload();
            return;
        }
        
        const minutes = Math.floor(seconds / 60);
        const secs = String(seconds % 60).padStart(2, '0');
        infoMessage.textContent = `请 ${minutes}:${secs} 后再试`;
        seconds--;
    }, 1000);
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = passwordInput.value.trim();
    
    if (!password) {
        errorMessage.textContent = '请输入密码';
        return;
    }
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: password })
        });
        
        const data = await response.json();
        if (data.success) {
            window.location.href = '/chat';
        } else {
            errorMessage.textContent = data.message || '密码错误，请重试';
            
            if (data.remaining_attempts !== undefined && data.remaining_attempts < 5) {
                infoMessage.textContent = `剩余尝试次数: ${data.remaining_attempts}`;
                infoMessage.classList.add('visible');
            } else {
                infoMessage.classList.remove('visible');
            }
            
            passwordInput.value = '';
            
            if (data.locked) {
                disableLoginElements(true);
                infoMessage.classList.add('visible');
                updateCountdown(data.remaining_time);
            }
        }
    } catch (error) {
        errorMessage.textContent = '登录失败，请重试';
        passwordInput.value = '';
        infoMessage.classList.remove('visible');
    }
});

window.addEventListener('beforeunload', () => {
    if (countdownTimer) clearInterval(countdownTimer);
});
