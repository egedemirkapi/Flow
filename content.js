let overlay = null;
let permissionModal = null;
let videoStream = null;
let videoElement = null;
let trackingInterval = null;

// --- MESSAGE LISTENER ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "activate_camera") {
    showPermissionModal();
  }
  else if (request.action === "deactivate_camera") {
    stopCamera();
    removeOverlay();
  }
  else if (request.action === "update_overlay") {
    if (request.text === "OFF") removeOverlay();
    else showOverlay(request.text, request.isPaused);
  }
  else if (request.action === "hide_overlay") {
    if (overlay) overlay.style.display = 'none';
  }
  else if (request.action === "show_overlay") {
    if (overlay) overlay.style.display = 'block';
  }
});

// --- PERMISSION MODAL (The Fix) ---
function showPermissionModal() {
  if (permissionModal) return; // Already showing
  
  permissionModal = document.createElement('div');
  permissionModal.id = "focus-permission-modal";
  permissionModal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.85); z-index: 2147483647;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;

  permissionModal.innerHTML = `
    <div style="background:white; padding:30px; border-radius:12px; text-align:center; max-width:400px; box-shadow:0 20px 25px -5px rgba(0,0,0,0.1);">
      <h2 style="margin:0 0 10px 0; color:#111; font-size:20px;">FocusLock Security</h2>
      <p style="color:#666; font-size:14px; line-height:1.5; margin-bottom:20px;">
        To enable the Gaze Guard feature, we need camera access. 
        <br><b>Video data is processed locally and never saved.</b>
      </p>
      <button id="btn-grant-camera" style="
        background:#111; color:white; border:none; padding:12px 24px; 
        font-size:14px; font-weight:600; border-radius:6px; cursor:pointer;
        transition: transform 0.1s;
      ">Enable Camera & Start</button>
      <div style="margin-top:15px; font-size:12px; color:#888; cursor:pointer;" id="btn-skip-camera">
        Skip Camera (Timer Only)
      </div>
    </div>
  `;

  document.body.appendChild(permissionModal);

  document.getElementById('btn-grant-camera').addEventListener('click', async () => {
    await startCamera();
    permissionModal.remove();
    permissionModal = null;
  });

  document.getElementById('btn-skip-camera').addEventListener('click', () => {
    permissionModal.remove();
    permissionModal = null;
    // Tell background we are starting without camera
    chrome.runtime.sendMessage({ action: "user_focused" }); 
  });
}

// --- CAMERA LOGIC ---
async function startCamera() {
  if (videoStream) return; 

  try {
    // THIS works now because it's inside a click event
    videoStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
    
    videoElement = document.createElement('video');
    videoElement.srcObject = videoStream;
    videoElement.play();

    // Start Analysis Loop
    trackingInterval = setInterval(checkDistraction, 1000);
    
    // Notify Background that we are live
    chrome.runtime.sendMessage({ action: "user_focused" });

  } catch (err) {
    alert("Camera access was denied. FocusLock will run in Timer-Only mode.");
    chrome.runtime.sendMessage({ action: "user_focused" });
  }
}

function stopCamera() {
  if (trackingInterval) clearInterval(trackingInterval);
  if (videoStream) {
    videoStream.getTracks().forEach(track => track.stop());
  }
  videoStream = null;
  videoElement = null;
}

// --- DISTRACTION LOGIC ---
function checkDistraction() {
  if (!videoElement || !videoElement.videoWidth) return;

  const canvas = document.createElement('canvas');
  canvas.width = 100; 
  canvas.height = 100;
  const ctx = canvas.getContext('2d');
  
  ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = frame.data;
  
  let totalBrightness = 0;
  for (let i = 0; i < data.length; i += 4) {
    totalBrightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
  }
  const avgBrightness = totalBrightness / (data.length / 4);

  // If dark (covered), trigger distraction
  if (avgBrightness < 10) { 
    chrome.runtime.sendMessage({ action: "user_distracted" });
  } else {
    chrome.runtime.sendMessage({ action: "user_focused" });
  }
}

// --- HUD OVERLAY ---
function createOverlay() {
  const div = document.createElement('div');
  div.id = "focuslock-hud";
  div.style.cssText = `
    position: fixed; bottom: 16px; right: 16px; padding: 8px 12px;
    background: #000; color: #fff; border-radius: 6px; z-index: 2147483646;
    font-family: 'SF Mono', 'Menlo', monospace; font-size: 13px; font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: flex; align-items: center; gap: 8px;
    border: 1px solid #333; pointer-events: none;
  `;
  
  const dot = document.createElement('span');
  dot.id = "focuslock-dot";
  dot.style.cssText = `width: 8px; height: 8px; background: #10b981; border-radius: 50%; display: inline-block;`;
  
  const text = document.createElement('span');
  text.id = "focuslock-text";
  
  div.appendChild(dot);
  div.appendChild(text);
  document.body.appendChild(div);
  return div;
}

function showOverlay(timeText, isWarning) {
  if (!overlay) overlay = createOverlay();
  
  const textEl = document.getElementById('focuslock-text');
  const dotEl = document.getElementById('focuslock-dot');
  const container = document.getElementById('focuslock-hud');
  
  textEl.innerText = timeText;
  
  if (isWarning) {
    dotEl.style.background = "#ef4444";
    dotEl.style.boxShadow = "0 0 8px #ef4444"; 
    container.style.borderColor = "#ef4444";
  } else {
    dotEl.style.background = "#10b981";
    dotEl.style.boxShadow = "none";
    container.style.borderColor = "#333";
  }
}

function removeOverlay() {
  const el = document.getElementById('focuslock-hud');
  if (el) el.remove();
  overlay = null;
  // Also remove modal if it's somehow stuck
  if (permissionModal) { permissionModal.remove(); permissionModal = null; }
}