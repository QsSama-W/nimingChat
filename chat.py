from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
import random
import base64
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad
import os
import hashlib
import secrets
import time

app = Flask(__name__)
app.secret_key = secrets.token_hex(16)
app.permanent_session_lifetime = 3600

# 默认登录密码(按自己所需修改)
CORRECT_PASSWORD = "chat123"

# 登录限制配置
MAX_ATTEMPTS = 5 # 最大错误尝试次数
LOCK_DURATION = 600 # 锁定时长（秒）
WINDOW_DURATION = 600 # 统计错误次数的时间窗口（秒）

login_attempts = {}

socketio = SocketIO(app, cors_allowed_origins="*")

PUBLIC_ROOM = 'public'
IDENTIFIER = b'QsSama'

rooms = {
    PUBLIC_ROOM: set()
}

user_sids = {}

# 昵称库
poetry_words = [
    "明月", "清风", "松涛", "荷香", "流泉", "晚霞", "孤雁", "残雪",
    "相思", "莫愁", "悠然", "欣然", "浩然", "知远", "念远",
    "客舟", "孤帆", "古寺", "寒窗", "东篱", "西楼", "南浦",
    "听竹", "观云", "望岳", "踏雪", "寻梅", "垂钓", "醉眠"
]

def generate_temp_id():
    word_count = random.randint(1, 2)
    selected = random.sample(poetry_words, word_count)
    temp_id = ''.join(selected)
    return temp_id

def generate_room_key(custom_str):
    hash_obj = hashlib.sha256(custom_str.encode('utf-8'))
    return hash_obj.digest()[:16]

def encrypt_message(message, key):
    try:
        message_bytes = IDENTIFIER + message.encode('utf-8')
        iv = os.urandom(16)
        cipher = AES.new(key, AES.MODE_CBC, iv)
        padded_data = pad(message_bytes, AES.block_size)
        encrypted = cipher.encrypt(padded_data)
        return base64.b64encode(iv + encrypted).decode('utf-8')
    except:
        return ""

def get_client_ip():
    if request.headers.getlist("X-Forwarded-For"):
        return request.headers.getlist("X-Forwarded-For")[0]
    else:
        return request.remote_addr

def check_login_lock(ip):
    now = time.time()
    
    if ip not in login_attempts:
        return {
            'locked': False,
            'remaining_attempts': MAX_ATTEMPTS,
            'remaining_time': 0
        }
    
    attempt_data = login_attempts[ip]
    
    if attempt_data['locked_until'] and now < attempt_data['locked_until']:
        remaining_time = int(attempt_data['locked_until'] - now)
        return {
            'locked': True,
            'remaining_attempts': 0,
            'remaining_time': remaining_time if remaining_time > 0 else 0
        }

    if attempt_data['locked_until'] and now >= attempt_data['locked_until']:
        reset_login_attempts(ip, full_reset=True)
        return {
            'locked': False,
            'remaining_attempts': MAX_ATTEMPTS,
            'remaining_time': 0
        }
    
    if now - attempt_data['first_attempt'] > WINDOW_DURATION:
        reset_login_attempts(ip)
        return {
            'locked': False,
            'remaining_attempts': MAX_ATTEMPTS,
            'remaining_time': 0
        }
    
    remaining = MAX_ATTEMPTS - attempt_data['attempts']
    return {
        'locked': False,
        'remaining_attempts': remaining if remaining > 0 else 0,
        'remaining_time': 0
    }

def record_failed_attempt(ip):
    now = time.time()
    
    if ip not in login_attempts:
        login_attempts[ip] = {
            'attempts': 1,
            'first_attempt': now,
            'locked_until': None
        }
    else:
        if login_attempts[ip]['locked_until'] and now < login_attempts[ip]['locked_until']:
            return
        
        if now - login_attempts[ip]['first_attempt'] > WINDOW_DURATION:
            reset_login_attempts(ip)
        
        login_attempts[ip]['attempts'] += 1
        
        if login_attempts[ip]['attempts'] >= MAX_ATTEMPTS:
            login_attempts[ip]['locked_until'] = now + LOCK_DURATION

def reset_login_attempts(ip, full_reset=False):
    now = time.time()
    if ip in login_attempts:
        login_attempts[ip] = {
            'attempts': 0,
            'first_attempt': now,
            'locked_until': None if full_reset else login_attempts[ip]['locked_until']
        }
    else:
        login_attempts[ip] = {
            'attempts': 0,
            'first_attempt': now,
            'locked_until': None
        }

def login_required(f):
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session or not session['logged_in']:
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return decorated_function

@app.route('/')
def login_page():
    if 'logged_in' in session and session['logged_in']:
        return redirect(url_for('chat_page'))
    return render_template('login.html')

@app.route('/chat')
@login_required
def chat_page():
    return render_template('chat.html')

@app.route('/api/check-lock')
def check_lock():
    ip = get_client_ip()
    status = check_login_lock(ip)
    return jsonify(status)

@app.route('/api/login', methods=['POST'])
def api_login():
    ip = get_client_ip()
    lock_status = check_login_lock(ip)
    
    if lock_status['locked']:
        return jsonify({
            'success': False,
            'message': '密码错误次数过多，已被临时锁定',
            'locked': True,
            'remaining_time': lock_status['remaining_time'],
            'remaining_attempts': 0
        })
    
    data = request.get_json()
    password = data.get('password', '')
    
    if password == CORRECT_PASSWORD:
        reset_login_attempts(ip)
        session['logged_in'] = True
        session.permanent = True
        return jsonify({'success': True})
    else:
        record_failed_attempt(ip)
        new_status = check_login_lock(ip)
        
        return jsonify({
            'success': False,
            'message': '密码错误，请重试',
            'locked': new_status['locked'],
            'remaining_time': new_status['remaining_time'],
            'remaining_attempts': new_status['remaining_attempts']
        })

@app.route('/api/logout', methods=['POST'])
def api_logout():
    session.pop('logged_in', None)
    return jsonify({'success': True})

@socketio.on('connect')
def handle_connect():
    if 'logged_in' not in session or not session['logged_in']:
        emit('login_required')

@socketio.on('join_room')
def handle_join_room(data):
    if 'logged_in' not in session or not session['logged_in']:
        emit('login_required')
        return
    
    user_id = generate_temp_id()
    custom_str = data.get('custom_str', '').strip()
    
    room = generate_room_key(custom_str).hex() if custom_str else PUBLIC_ROOM
    
    join_room(room)
    if room not in rooms:
        rooms[room] = set()
    rooms[room].add(user_id)
    
    user_sids[request.sid] = (user_id, room)
    
    emit('room_info', {
        'user_id': user_id,
        'room': room,
        'is_public': (room == PUBLIC_ROOM),
        'online_count': len(rooms[room])
    })
    
    emit('user_status', {
        'status': 'online',
        'user_id': user_id,
        'online_count': len(rooms[room])
    }, room=room, include_self=False)

@socketio.on('leave_room')
def handle_leave_room(data):
    user_id = data['user_id']
    room = data['room']
    
    if room in rooms and user_id in rooms[room]:
        leave_room(room)
        rooms[room].remove(user_id)
        if request.sid in user_sids:
            del user_sids[request.sid]
        emit('user_status', {
            'status': 'offline',
            'online_count': len(rooms[room])
        }, room=room)
        if room != PUBLIC_ROOM and len(rooms[room]) == 0:
            del rooms[room]

@socketio.on('disconnect')
def handle_disconnect():
    if request.sid in user_sids:
        user_id, room = user_sids[request.sid]
        
        if room in rooms and user_id in rooms[room]:
            rooms[room].remove(user_id)
            emit('user_status', {
                'status': 'offline',
                'online_count': len(rooms[room])
            }, room=room)
            if room != PUBLIC_ROOM and len(rooms[room]) == 0:
                del rooms[room]
        
        del user_sids[request.sid]

@socketio.on('send_message')
def handle_send_message(data):
    if 'logged_in' not in session or not session['logged_in']:
        emit('login_required')
        return
    
    user_id = data['user_id']
    room = data['room']
    message = data['message']
    custom_str = data.get('custom_str', '')
    
    key = generate_room_key(custom_str) if custom_str else generate_room_key(PUBLIC_ROOM)
    
    encrypted_msg = encrypt_message(message, key)
    if encrypted_msg:
        emit('receive_message', {
            'user_id': user_id,
            'encrypted_message': encrypted_msg,
            'timestamp': data['timestamp']
        }, room=room, include_self=False)

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5001)