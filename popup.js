const video = document.getElementById('video');
const statusDisplay = document.getElementById('status');

// 1. Load Face Model ONLY
statusDisplay.innerText = "Loading Face AI...";

Promise.all([
  faceapi.nets.tinyFaceDetector.loadFromUri('./models'),
  faceapi.nets.faceLandmark68TinyNet.loadFromUri('./models')
]).then(startVideo).catch(err => {
    console.error(err);
    statusDisplay.innerText = "Error: AI Failed to Load";
    statusDisplay.style.color = "red";
});

// 2. Start Camera
function startVideo() {
  navigator.mediaDevices.getUserMedia({ video: {} })
    .then(stream => video.srcObject = stream)
    .catch(err => console.error("Camera Error:", err));
}

// 3. The Logic Loop
video.addEventListener('play', () => {
  const canvas = faceapi.createCanvasFromMedia(video);
  document.getElementById('container').append(canvas);
  const displaySize = { width: video.clientWidth, height: video.clientHeight };
  faceapi.matchDimensions(canvas, displaySize);

  // SETTINGS: The Safe Box
  const safeZone = {
    x: displaySize.width * 0.2,
    y: displaySize.height * 0.1,
    width: displaySize.width * 0.6,
    height: displaySize.height * 0.4
  };

  setInterval(async () => {
    const detections = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
                                    .withFaceLandmarks(true);

    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Blue Safe Zone
    context.strokeStyle = "cyan";
    context.lineWidth = 2;
    context.strokeRect(safeZone.x, safeZone.y, safeZone.width, safeZone.height);

    if (detections) {
      const resized = faceapi.resizeResults(detections, displaySize);
      const nose = resized.landmarks.getNose()[3];

      // Check if inside box
      const isInsideX = nose.x > safeZone.x && nose.x < (safeZone.x + safeZone.width);
      const isInsideY = nose.y > safeZone.y && nose.y < (safeZone.y + safeZone.height);

      if (isInsideX && isInsideY) {
        statusDisplay.innerText = "FOCUSED";
        statusDisplay.style.color = "#00ff00";
        // Green Dot
        context.fillStyle = "#00ff00";
        context.beginPath(); context.arc(nose.x, nose.y, 5, 0, 2 * Math.PI); context.fill();
      } else {
        statusDisplay.innerText = "DISTRACTED!";
        statusDisplay.style.color = "orange";
        // Orange Dot
        context.fillStyle = "orange";
        context.beginPath(); context.arc(nose.x, nose.y, 5, 0, 2 * Math.PI); context.fill();
      }
    } else {
      statusDisplay.innerText = "NO FACE FOUND";
      statusDisplay.style.color = "grey";
    }
  }, 100);
});