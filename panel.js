// --- DOM ELEMENTS ---
const video = document.getElementById('video');
const timerEl = document.getElementById('timer');
const statusText = document.getElementById('statusText');
const actionButtons = document.getElementById('actionButtons');
const tabListContainer = document.getElementById('tabListContainer');
const btnRefreshTabs = document.getElementById('btnRefreshTabs');
const btnModeUp = document.getElementById('btnModeUp');
const btnModeDown = document.getElementById('btnModeDown');
const minutesInput = document.getElementById('minutesInput');
const timerInputContainer = document.getElementById('timerInputContainer');
const sensorOverlay = document.querySelector('.sensor-overlay');
const btnMinimize = document.getElementById('btnMinimize');
const permissionModal = document.getElementById('permissionModal');
const btnGrantPermission = document.getElementById('btnGrantPermission');
const onboardingModal = document.getElementById('onboardingModal');
const onboardingContent = document.getElementById('onboardingContent');
const camStatus = document.getElementById('camStatus');

// --- STATE ---
let isRunning = false;
let isModelsLoaded = false; // New flag to prevent crashes
let timerMode = 'UP'; 
let totalSeconds = 0; 
let allowedTabIds = new Set();
let isLookingAtScreen = false;
let isTabProductive = false;
let trackingInterval = null;
let isMiniMode = false;
let isPaused = false; 

// --- ONBOARDING CONTENT ---
const onboardingSteps = [
  {
    title: "Welcome to FocusOS",
    text: "The ultimate productivity tool that uses AI to track your attention and keep you in the zone.",
    btn: "Next"
  },
  {
    title: "How it Works",
    text: "Select the tabs you need for work. Our AI monitors your eyes. If you look away or use your phone, the timer stops.",
    btn: "Next"
  },
  {
    title: "Privacy & Security",
    text: "Your camera is used ONLY to detect your head position. No video is recorded. Everything happens locally on this device.",
    btn: "Get Started"
  }
];

// --- INITIALIZATION ---
// 1. Render buttons IMMEDIATELY so they are clickable
renderButtons(); 

async function init() {
  camStatus.innerText = "Loading AI...";
  console.log("FocusOS: Initializing...");

  // Check Onboarding
  const storage = await chrome.storage.local.get(['hasSeenIntro', 'savedSeconds', 'savedMode']);
  if (!storage.hasSeenIntro) {
    showOnboardingStep(0);
  }

  // Restore Timer State
  if (storage.savedSeconds && storage.savedSeconds > 0) {
    totalSeconds = storage.savedSeconds;
    timerMode = storage.savedMode || 'UP';
    timerEl.innerText = formatTime(totalSeconds);
    isPaused = true;
    renderButtons();
  }

  // Load Models
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('./models'),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri('./models')
    ]);
    
    isModelsLoaded = true;
    camStatus.innerText = "Ready";
    console.log("FocusOS: AI Models Loaded Successfully");
  } catch (error) {
    console.error("FocusOS Error:", error);
    camStatus.innerText = "AI Load Failed";
    alert("Error: Could not load AI models. Make sure the 'models' folder is inside the extension folder.");
  }

  loadOpenTabs();
}

// Run Init
init();

// --- BUTTON RENDERER ---
function renderButtons() {
  actionButtons.innerHTML = ''; 

  if (isRunning) {
    const btnStop = document.createElement('button');
    btnStop.className = 'btn-primary';
    btnStop.innerText = 'Stop Session';
    btnStop.style.backgroundColor = '#ef4444';
    btnStop.onclick = stopSession;
    actionButtons.appendChild(btnStop);
  } else if (isPaused && totalSeconds > 0) {
    const group = document.createElement('div');
    group.className = 'button-group';

    const btnResume = document.createElement('button');
    btnResume.className = 'btn-primary btn-resume';
    btnResume.innerText = 'Resume';
    btnResume.onclick = startSession;

    const btnReset = document.createElement('button');
    btnReset.className = 'btn-primary btn-reset';
    btnReset.innerText = 'Reset';
    btnReset.onclick = resetSession;

    group.appendChild(btnResume);
    group.appendChild(btnReset);
    actionButtons.appendChild(group);
  } else {
    const btnStart = document.createElement('button');
    btnStart.className = 'btn-primary';
    btnStart.innerText = 'Start Session';
    // IMPORTANT: Bind the click directly
    btnStart.addEventListener('click', handleStartClick);
    actionButtons.appendChild(btnStart);
  }
}

// --- SESSION CONTROL ---
function handleStartClick() {
  console.log("FocusOS: Start button clicked");

  if (!isModelsLoaded) {
    alert("Please wait, AI models are still loading...");
    return;
  }

  if (allowedTabIds.size === 0) {
    alert("Select at least one tab to work on.");
    return;
  }
  
  // Set Timer for Count Down mode
  if (timerMode === 'DOWN' && totalSeconds === 0) {
    const inputVal = parseInt(minutesInput.value);
    const minutes = (isNaN(inputVal) || inputVal < 1) ? 25 : inputVal;
    totalSeconds = minutes * 60;
    timerEl.innerText = formatTime(totalSeconds);
  }

  permissionModal.style.display = 'flex';
}

btnGrantPermission.addEventListener('click', () => {
  permissionModal.style.display = 'none';
  startSession();
});

function startSession() {
  console.log("FocusOS: Starting Session...");
  timerInputContainer.classList.add('hidden');
  timerEl.style.display = 'block';

  navigator.mediaDevices.getUserMedia({ video: {} })
    .then(stream => {
      video.srcObject = stream;
      isRunning = true;
      isPaused = false;
      renderButtons(); 
      startTrackingLoop();
      console.log("FocusOS: Camera Active");
    })
    .catch(err => {
      console.error(err);
      alert("Camera access denied. Please allow camera access to use FocusOS.");
    });
}

function stopSession() {
  isRunning = false;
  isPaused = true;
  
  const stream = video.srcObject;
  if (stream) stream.getTracks().forEach(track => track.stop());
  video.srcObject = null;
  
  if (trackingInterval) clearInterval(trackingInterval);
  updateStatus("PAUSED", "");
  renderButtons(); 
}

function resetSession() {
  isRunning = false;
  isPaused = false;
  totalSeconds = 0;
  timerEl.innerText = "00:00:00";
  chrome.storage.local.set({ savedSeconds: 0 });
  updateStatus("RESET", "");
  renderButtons();
  if (timerMode === 'DOWN') {
    timerInputContainer.classList.remove('hidden');
    timerEl.style.display = 'none';
  }
}

// --- TRACKING LOOP ---
function startTrackingLoop() {
  if (trackingInterval) clearInterval(trackingInterval);
  
  trackingInterval = setInterval(async () => {
    if (!isRunning) return;

    const tab = await getCurrentTab();
    isTabProductive = tab && allowedTabIds.has(tab.id);
    let isFocused = isLookingAtScreen && isTabProductive;

    if (isFocused) {
      updateStatus("FOCUSED", "status-active");
      
      if (timerMode === 'UP') {
        totalSeconds++;
      } else {
        if (totalSeconds > 0) {
          totalSeconds--;
        } else {
          finishSession();
          return;
        }
      }
    } else {
      if (!isTabProductive) updateStatus("WRONG TAB", "status-error");
      else updateStatus("DISTRACTED", "status-error");
    }

    timerEl.innerText = formatTime(totalSeconds);
    chrome.storage.local.set({ savedSeconds: totalSeconds, savedMode: timerMode });
  }, 1000);
}

// --- STRICT FACE & PHONE DETECTION ---
video.addEventListener('play', () => {
  const canvas = faceapi.createCanvasFromMedia(video);
  
  setInterval(async () => {
    if (!isRunning) return;

    // Use TinyFaceDetector with higher threshold to filter bad detections
    const detections = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.5 })).withFaceLandmarks(true);

    if (detections) {
      const landmarks = detections.landmarks;
      const nose = landmarks.getNose()[3];
      const leftEye = landmarks.getLeftEye()[0];
      const rightEye = landmarks.getRightEye()[3];
      const mouth = landmarks.getMouth()[0];
      const jaw = landmarks.getJawOutline()[8];
      
      // 1. PHONE BLOCK CHECK (Face Integrity)
      const eyeToNose = nose.y - ((leftEye.y + rightEye.y) / 2);
      const noseToMouth = mouth.y - nose.y;
      
      // If the mouth is blocked or landmark is squashed (phone in front of face)
      const integrityRatio = noseToMouth / eyeToNose;
      const isFaceClear = integrityRatio > 0.45; 

      // 2. LOOKING DOWN CHECK
      const verticalRatio = eyeToNose / (jaw.y - nose.y);
      const isNotLookingDown = verticalRatio > 0.30;

      // 3. TURNING CHECK (Yaw)
      const leftJaw = landmarks.getJawOutline()[0];
      const rightJaw = landmarks.getJawOutline()[16];
      const distLeft = Math.abs(nose.x - leftJaw.x);
      const totalW = distLeft + Math.abs(nose.x - rightJaw.x);
      const yaw = distLeft / totalW;
      const isFacingForward = (yaw > 0.38 && yaw < 0.62);

      if (isFaceClear && isNotLookingDown && isFacingForward) {
        isLookingAtScreen = true;
      } else {
        isLookingAtScreen = false;
      }
    } else {
      isLookingAtScreen = false;
    }
  }, 300);
});

// --- ONBOARDING LOGIC ---
function showOnboardingStep(index) {
  onboardingModal.style.display = 'flex';
  const step = onboardingSteps[index];
  
  let dots = '';
  onboardingSteps.forEach((_, i) => {
    dots += `<div class="step-dot ${i === index ? 'active' : ''}"></div>`;
  });

  onboardingContent.innerHTML = `
    <h3>${step.title}</h3>
    <div class="step-indicator">${dots}</div>
    <p>${step.text}</p>
    <button class="btn-primary" id="btnOnboardingNext">${step.btn}</button>
  `;

  document.getElementById('btnOnboardingNext').onclick = () => {
    if (index < onboardingSteps.length - 1) {
      showOnboardingStep(index + 1);
    } else {
      onboardingModal.style.display = 'none';
      chrome.storage.local.set({ hasSeenIntro: true });
    }
  };
}

// --- HELPERS ---
async function getCurrentTab() {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function updateStatus(text, className) {
  statusText.innerText = text;
  sensorOverlay.className = `sensor-overlay ${className}`;
}

function formatTime(sec) {
  const h = Math.floor(sec / 3600).toString().padStart(2, '0');
  const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function finishSession() {
  stopSession();
  updateStatus("DONE", "status-active");
  chrome.storage.local.set({ savedSeconds: 0 });
}

btnMinimize.addEventListener('click', () => {
  isMiniMode = !isMiniMode;
  if (isMiniMode) {
    document.body.classList.add('mini-mode');
    btnMinimize.innerText = "+";
  } else {
    document.body.classList.remove('mini-mode');
    btnMinimize.innerText = "-";
  }
});

async function loadOpenTabs() {
  tabListContainer.innerHTML = ''; 
  const tabs = await chrome.tabs.query({ currentWindow: true });
  tabs.forEach(tab => {
    if (!tab.url || tab.url.startsWith('chrome://')) return;
    const div = document.createElement('div');
    div.className = 'tab-item';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = tab.id;
    if (allowedTabIds.has(tab.id)) checkbox.checked = true;
    checkbox.addEventListener('change', (e) => {
      if (e.target.checked) allowedTabIds.add(tab.id);
      else allowedTabIds.delete(tab.id);
    });
    const name = document.createElement('div');
    name.className = 'tab-name';
    name.innerText = tab.title;
    div.appendChild(checkbox);
    div.appendChild(name);
    tabListContainer.appendChild(div);
  });
}
btnRefreshTabs.addEventListener('click', loadOpenTabs);

btnModeUp.addEventListener('click', () => {
  timerMode = 'UP';
  btnModeUp.classList.add('active');
  btnModeDown.classList.remove('active');
  timerInputContainer.classList.add('hidden');
  timerEl.style.display = 'block';
  timerEl.innerText = formatTime(totalSeconds);
});

btnModeDown.addEventListener('click', () => {
  timerMode = 'DOWN';
  btnModeDown.classList.add('active');
  btnModeUp.classList.remove('active');
  timerInputContainer.classList.remove('hidden');
  timerEl.style.display = 'none';
});