import random
import math
import os
import logging
import secrets
from datetime import datetime, timedelta
from flask import Flask, jsonify, request, render_template

try:
    import numpy as np
except ImportError:
    np = None

# Logging Setup
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', secrets.token_hex(32))

# Active sessions storage
active_sessions = {}
SESSION_TIMEOUT = 600  # 10 minutes

# Physics Config
FRAME_COUNT = 300
MIN_SURVIVAL_FRAMES = 150
PERFECT_ANGLE_THRESHOLD = 0.001
MAX_PERFECT_FRAMES = 30

# --- HELPER FUNCTIONS ---
def cleanup_expired_sessions():
    now = datetime.now()
    expired = [token for token, data in active_sessions.items() 
               if now - data.get('created', now) > timedelta(seconds=SESSION_TIMEOUT)]
    for token in expired:
        del active_sessions[token]

def lerp(start, end, t):
    return start + (end - start) * t

def generate_smooth_parameter_schedule(min_val, max_val, frame_count, num_keyframes=5):
    keyframe_positions = sorted([0] + random.sample(range(1, frame_count - 1), num_keyframes - 2) + [frame_count - 1])
    keyframe_values = [random.uniform(min_val, max_val) for _ in range(num_keyframes)]
    schedule = []
    keyframe_idx = 0
    for frame in range(frame_count):
        while keyframe_idx < len(keyframe_positions) - 1 and frame >= keyframe_positions[keyframe_idx + 1]:
            keyframe_idx += 1
        if keyframe_idx >= len(keyframe_positions) - 1:
            schedule.append(keyframe_values[-1])
        else:
            start_frame, end_frame = keyframe_positions[keyframe_idx], keyframe_positions[keyframe_idx + 1]
            t = (frame - start_frame) / (end_frame - start_frame) if end_frame != start_frame else 0
            schedule.append(lerp(keyframe_values[keyframe_idx], keyframe_values[keyframe_idx + 1], t))
    return schedule

def generate_force_jolts(frame_count):
    jolts = [0.0] * frame_count
    jolt_interval = random.randint(70, 100)
    for i in range(0, frame_count, jolt_interval):
        jolt_frame = i + random.randint(0, min(20, frame_count - i - 1))
        if jolt_frame < frame_count:
            jolts[jolt_frame] = random.uniform(-0.004, 0.004)
    return jolts

# --- ROUTES ---

@app.route('/')
def index():
    return render_template('login.html')

@app.route('/captcha')
def captcha():
    return render_template('captcha.html')

@app.route('/init_stabilizer', methods=['GET'])
def init_stabilizer():
    cleanup_expired_sessions()
    session_token = secrets.token_urlsafe(32)
    
    # Generate Chaos
    gravity_schedule = generate_smooth_parameter_schedule(0.08, 0.20, FRAME_COUNT, 6)
    length_schedule = generate_smooth_parameter_schedule(90.0, 120.0, FRAME_COUNT, 4)
    force_jolts = generate_force_jolts(FRAME_COUNT)
    
    active_sessions[session_token] = {
        'created': datetime.now()
    }
    
    return jsonify({
        'success': True,
        'session_token': session_token,
        'schedule': {
            'gravity': gravity_schedule,
            'length': length_schedule,
            'force_jolts': force_jolts
        }
    })

@app.route('/verify_stability', methods=['POST'])
def verify_stability():
    try:
        data = request.get_json()
        if not data or 'angle_history' not in data or 'session_token' not in data:
            return jsonify({'success': False, 'verified': False, 'message': 'SYSTEM ERROR: Missing data.'}), 400
        
        session_token = data['session_token']
        angle_history = data['angle_history']
        
        cleanup_expired_sessions()
        if session_token not in active_sessions:
            return jsonify({'success': False, 'verified': False, 'message': 'SYSTEM ERROR: Invalid session.'}), 403
        
        del active_sessions[session_token]
        
        # 1. Survival Check
        if len(angle_history) < MIN_SURVIVAL_FRAMES:
            return jsonify({'success': True, 'verified': False, 'message': 'STABILIZATION FAILED: Reactor unstable.'})
        
        # 2. Reflex Trap (Anti-PID Logic) - SECURITY PATCH
        immediate_corrections = 0
        significant_frames = 0
        for i in range(1, len(angle_history) - 1):
            current = angle_history[i]
            nxt = angle_history[i+1]
            if abs(current) > 0.02: # Only check significant tilts
                significant_frames += 1
                # Check for instant correction (Frame T error -> Frame T+1 fix)
                if (current > 0 and nxt < current) or (current < 0 and nxt > current):
                    immediate_corrections += 1
        
        if significant_frames > 30:
            reflex_ratio = immediate_corrections / significant_frames
            if reflex_ratio > 0.92: # 92% instant reaction rate is superhuman
                logger.info(f"Bot detected: Reflex ratio {reflex_ratio:.2f}")
                return jsonify({'success': True, 'verified': False, 'message': 'ANOMALY DETECTED: Reflexes exceed biological limits.'})

        # 3. Variance Check (Anti-Static)
        angle_changes = [abs(angle_history[i] - angle_history[i-1]) for i in range(1, len(angle_history))]
        variance = np.var(angle_changes) if np else (sum((x - (sum(angle_changes)/len(angle_changes)))**2 for x in angle_changes) / len(angle_changes))
        
        if variance < 1e-10:
             return jsonify({'success': True, 'verified': False, 'message': 'ANOMALY DETECTED: Input too synthetic.'})

        # Success
        max_angle = max(abs(a) for a in angle_history)
        stability_score = min(100, int(100 * (1 - max_angle / 1.2)))
        
        return jsonify({
            'success': True, 
            'verified': True, 
            'message': 'REACTOR STABILIZED: Human operator confirmed.',
            'stats': {
                'duration': len(angle_history) / 60,
                'max_deviation': math.degrees(max_angle),
                'stability_score': stability_score
            }
        })
        
    except Exception as e:
        logger.error(f"Error: {e}")
        return jsonify({'success': False, 'verified': False, 'message': 'Server Error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=3000, debug=True)