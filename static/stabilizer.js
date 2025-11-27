const CONFIG = {
  canvasWidth: 600,
  canvasHeight: 400,
  cartWidth: 60,
  cartHeight: 20,
  failAngle: 1.4,
  successFrames: 300,
  fps: 60,
  dampingFactor: 0.985,
  cartForceMultiplier: 0.1,
  colors: { pole: "#ff3333", success: "#00ff41", cart: "#555", ground: "#222" },
};

let state = {
  initialized: false,
  running: false,
  gameOver: false,
  success: false,
  sessionToken: null,
  schedule: null,
  poleAngle: 0.05,
  angularVelocity: 0,
  cartX: 300,
  prevCartX: 300,
  mouseX: 0,
  frameCount: 0,
  angleHistory: [],
  currentGravity: 0.5,
  currentLength: 100,
  currentJolt: 0,
};

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const verifyBtn = document.getElementById("verifyBtn");
const clickPrompt = document.getElementById("clickPrompt");

// --- INIT ---
async function initGame() {
  try {
    const res = await fetch("/init_stabilizer");
    const data = await res.json();
    state.sessionToken = data.session_token;
    state.schedule = data.schedule;
    state.initialized = true;
    statusEl.textContent = "REACTOR READY // AWAITING INPUT";
    statusEl.style.color = "#00ffff";
    requestAnimationFrame(gameLoop);
  } catch (e) {
    statusEl.textContent = "SYSTEM ERROR";
  }
}

// --- PHYSICS ---
function updatePhysics() {
  if (!state.running || state.gameOver) return;

  const frame = Math.min(state.frameCount, state.schedule.gravity.length - 1);
  state.currentGravity = state.schedule.gravity[frame];
  state.currentLength = state.schedule.length[frame];
  state.currentJolt = state.schedule.force_jolts[frame];

  const cartAccel = state.cartX - state.prevCartX;
  state.prevCartX = state.cartX;

  const gravityTorque =
    (state.currentGravity / state.currentLength) * Math.sin(state.poleAngle);
  const inertialTorque =
    ((-CONFIG.cartForceMultiplier * cartAccel) / state.currentLength) *
    Math.cos(state.poleAngle);

  state.angularVelocity += gravityTorque + inertialTorque + state.currentJolt;
  state.angularVelocity *= CONFIG.dampingFactor;
  state.poleAngle += state.angularVelocity;

  state.angleHistory.push(state.poleAngle);
  state.frameCount++;

  if (Math.abs(state.poleAngle) > CONFIG.failAngle) endGame(false);
  else if (state.frameCount >= CONFIG.successFrames) endGame(true);
}

// --- INPUT & SENSOR JAMMER ---
function setupInputHandlers() {
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    state.mouseX = e.clientX - rect.left;
  });

  canvas.addEventListener("click", () => {
    // SECURITY FIX: Prevent start if mouse hasn't moved (Basic bot check)
    if (state.mouseX === 0 && state.prevCartX === 300) return;

    if (state.initialized && !state.running && !state.gameOver) {
      startGame();
    }
  });

  verifyBtn.addEventListener("click", verifyHuman);
}

function updateDisplays() {
  const time = (state.frameCount / CONFIG.fps).toFixed(2);
  document.getElementById("timeDisplay").textContent = time + "s";

  const angleDeg = (state.poleAngle * 180) / Math.PI;

  // SECURITY FIX: SENSOR JAMMER
  // Add +/- 1.0 degree jitter to the text display so bots reading DOM get garbage data
  const displayNoise = (Math.random() - 0.5) * 2.0;
  const noisyAngle = (angleDeg + displayNoise).toFixed(1);

  document.getElementById("angleDisplay").textContent = noisyAngle + "°";
}

// --- GAME STATE ---
function startGame() {
  state.cartX = state.mouseX; // Teleport to mouse (Anti-Whiplash)
  state.prevCartX = state.mouseX;
  state.poleAngle = 0.05 * (Math.random() > 0.5 ? 1 : -1);
  state.angularVelocity = 0;
  state.frameCount = 0;
  state.angleHistory = [];
  state.running = true;
  clickPrompt.style.display = "none";
  statusEl.textContent = "STABILIZATION IN PROGRESS...";
}

function endGame(success) {
  state.running = false;
  state.gameOver = true;
  if (success) {
    statusEl.textContent = "STABILIZED. VERIFYING...";
    statusEl.style.color = "#00ff41";
    verifyBtn.className = "visible";
  } else {
    statusEl.textContent = "CRITICAL FAILURE";
    statusEl.style.color = "#ff3333";
    document.getElementById("retryBtn").className = "visible";
  }
}

async function verifyHuman() {
  verifyBtn.className = "";
  statusEl.textContent = "ANALYZING TELEMETRY...";

  const res = await fetch("/verify_stability", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_token: state.sessionToken,
      angle_history: state.angleHistory,
    }),
  });
  const data = await res.json();
  window.showResult(data.verified, data.message, data.stats);
}

// --- RENDER LOOP ---
function render() {
  ctx.fillStyle = CONFIG.colors.ground;
  ctx.fillRect(0, 0, CONFIG.canvasWidth, CONFIG.canvasHeight);

  // Grid
  ctx.strokeStyle = "rgba(0, 255, 255, 0.1)";
  ctx.lineWidth = 1;
  for (let i = 0; i < CONFIG.canvasWidth; i += 40) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 400);
    ctx.stroke();
  }

  // Cart
  if (!state.running) {
    state.cartX = state.mouseX;
    state.prevCartX = state.mouseX;
  } else {
    state.cartX += (state.mouseX - state.cartX) * 0.2;
  } // Smooth input

  ctx.fillStyle = CONFIG.colors.cart;
  ctx.fillRect(state.cartX - 30, 350, 60, 20);

  // Pole
  const len = state.running ? state.currentLength : 100;
  const tipX = state.cartX + Math.sin(state.poleAngle) * len;
  const tipY = 350 - Math.cos(state.poleAngle) * len;

  const danger = Math.abs(state.poleAngle) / CONFIG.failAngle;
  ctx.strokeStyle = danger > 0.5 ? CONFIG.colors.pole : CONFIG.colors.success;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(state.cartX, 350);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  // Tip
  ctx.fillStyle = ctx.strokeStyle;
  ctx.beginPath();
  ctx.arc(tipX, tipY, 6, 0, Math.PI * 2);
  ctx.fill();

  updateDisplays();
}

function gameLoop() {
  updatePhysics();
  render();
  requestAnimationFrame(gameLoop);
}

setupInputHandlers();
initGame();
