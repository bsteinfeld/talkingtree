// Tree Animation using PixiJS
export const treeAnimator = (function() {
  // Constants
  const CANVAS_WIDTH = 500;
  const CANVAS_HEIGHT = 600;
  const BLINK_INTERVAL_MIN = 2000; // Min time between blinks in ms
  const BLINK_INTERVAL_MAX = 6000; // Max time between blinks in ms
  const BLINK_DURATION = 150; // Duration of a blink in ms
  const PUPIL_MOVEMENT_RANGE = 20; // Maximum pixel range for pupil movement
  const TALKING_MOUTH_FRAME_RATE = 150; // Mouth animation frame rate in ms

  // PixiJS Application
  let app;
  
  // Sprite references
  let treeBody;
  let leftEyelid, rightEyelid;
  let leftPupil, rightPupil;
  let mouth;
  
  // Animation state
  let blinkTimeoutId = null;
  let isTalking = false;
  let talkingIntervalId = null;
  let mouthVisible = false;
  let assetsLoaded = false;
  
  // Initialize the PixiJS application
  function init() {
    // Create PixiJS Application
    app = new PIXI.Application({
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      backgroundColor: 0x00000000, // Transparent background
      antialias: true
    });
    
    // Add canvas to the DOM
    document.getElementById('treeCanvas').appendChild(app.view);
    
    // Load assets
    loadAssets();
  }
  
  // Load all image assets
  function loadAssets() {
    // Use PixiJS v7 style loader
    const loader = PIXI.Loader.shared;
    loader.add('tree', '/tree.png')
          .add('lids', '/lids.png')
          .add('pupil', '/pupil.png')
          .add('mouth', '/mouth.png');
    
    loader.load((loader, resources) => {
      setupTree(resources);
      assetsLoaded = true;
    });
  }
  
  // Set up the tree with all components
  function setupTree(resources) {
    setupTreeBody(resources.tree.texture);
    setupEyes(resources.lids.texture, resources.pupil.texture);
    setupMouth(resources.mouth.texture);
    
    // Start automatic blinking
    scheduleNextBlink();
    
    // Set up mouse movement tracking for eye movement
    setupEyeTracking();
  }
  
  // Create the tree body
  function setupTreeBody(texture) {
    treeBody = new PIXI.Sprite(texture);
    treeBody.anchor.set(0.5);
    treeBody.x = CANVAS_WIDTH / 2;
    treeBody.y = CANVAS_HEIGHT / 2;
    
    // Scale to fit canvas nicely
    const scale = Math.min(
      CANVAS_WIDTH / treeBody.width * 0.9,
      CANVAS_HEIGHT / treeBody.height * 0.9
    );
    treeBody.scale.set(scale);
    
    app.stage.addChild(treeBody);
  }
  
  // Create the eyes (eyelids and pupils)
  function setupEyes(lidsTexture, pupilTexture) {
    // Calculate eye positions relative to tree body center
    const eyeOffsetX = treeBody.width * 0.2; // Distance from center
    const eyeOffsetY = -treeBody.height * 0.15; // Above center
    const eyeScale = 0.2; // Scale factor for eyes
    
    // Create a texture for each eyelid state (open/closed) from sprite sheet
    const openEyelidTexture = new PIXI.Texture(
      lidsTexture.baseTexture,
      new PIXI.Rectangle(0, 0, lidsTexture.width / 2, lidsTexture.height / 2)
    );
    
    const closedEyelidTexture = new PIXI.Texture(
      lidsTexture.baseTexture,
      new PIXI.Rectangle(0, lidsTexture.height / 2, lidsTexture.width / 2, lidsTexture.height / 2)
    );
    
    // Create left eyelid
    leftEyelid = new PIXI.Sprite(openEyelidTexture);
    leftEyelid.anchor.set(0.5);
    leftEyelid.x = treeBody.x - eyeOffsetX * treeBody.scale.x;
    leftEyelid.y = treeBody.y + eyeOffsetY * treeBody.scale.y;
    leftEyelid.scale.set(eyeScale * treeBody.scale.x);
    
    // Create right eyelid
    rightEyelid = new PIXI.Sprite(openEyelidTexture);
    rightEyelid.anchor.set(0.5);
    rightEyelid.x = treeBody.x + eyeOffsetX * treeBody.scale.x;
    rightEyelid.y = treeBody.y + eyeOffsetY * treeBody.scale.y;
    rightEyelid.scale.set(eyeScale * treeBody.scale.x);
    
    // Save the textures for animation
    leftEyelid.openTexture = openEyelidTexture;
    leftEyelid.closedTexture = closedEyelidTexture;
    rightEyelid.openTexture = openEyelidTexture;
    rightEyelid.closedTexture = closedEyelidTexture;
    
    // Create pupils
    leftPupil = new PIXI.Sprite(pupilTexture);
    leftPupil.anchor.set(0.5);
    leftPupil.x = leftEyelid.x;
    leftPupil.y = leftEyelid.y;
    leftPupil.scale.set(eyeScale * 0.5 * treeBody.scale.x);
    
    rightPupil = new PIXI.Sprite(pupilTexture);
    rightPupil.anchor.set(0.5);
    rightPupil.x = rightEyelid.x;
    rightPupil.y = rightEyelid.y;
    rightPupil.scale.set(eyeScale * 0.5 * treeBody.scale.x);
    
    // Add to stage in correct order
    app.stage.addChild(leftEyelid);
    app.stage.addChild(rightEyelid);
    app.stage.addChild(leftPupil);
    app.stage.addChild(rightPupil);
  }
  
  // Create the mouth
  function setupMouth(texture) {
    mouth = new PIXI.Sprite(texture);
    mouth.anchor.set(0.5);
    mouth.x = treeBody.x;
    mouth.y = treeBody.y + treeBody.height * 0.2 * treeBody.scale.y;
    mouth.scale.set(0.3 * treeBody.scale.x);
    mouth.visible = false; // Initially hidden
    
    app.stage.addChild(mouth);
  }
  
  // Set up eye tracking to follow mouse movement
  function setupEyeTracking() {
    window.addEventListener('mousemove', (e) => {
      if (isTalking) return; // Don't track mouse during talking animation
      
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      
      // Calculate mouse position relative to window center
      const mouseXPercent = (e.clientX / windowWidth) * 2 - 1; // -1 to 1
      const mouseYPercent = (e.clientY / windowHeight) * 2 - 1; // -1 to 1
      
      // Apply movement to pupils (limited range)
      movePupils(mouseXPercent, mouseYPercent);
    });
  }
  
  // Move the pupils based on normalized coordinates (-1 to 1)
  function movePupils(xPercent, yPercent) {
    if (!assetsLoaded || !leftPupil || !rightPupil) return;
    
    const leftBaseX = leftEyelid.x;
    const leftBaseY = leftEyelid.y;
    const rightBaseX = rightEyelid.x;
    const rightBaseY = rightEyelid.y;
    
    // Apply movement within range
    leftPupil.x = leftBaseX + xPercent * PUPIL_MOVEMENT_RANGE * treeBody.scale.x;
    leftPupil.y = leftBaseY + yPercent * PUPIL_MOVEMENT_RANGE * treeBody.scale.y;
    
    rightPupil.x = rightBaseX + xPercent * PUPIL_MOVEMENT_RANGE * treeBody.scale.x;
    rightPupil.y = rightBaseY + yPercent * PUPIL_MOVEMENT_RANGE * treeBody.scale.y;
  }
  
  // Schedule the next automatic blink
  function scheduleNextBlink() {
    const nextBlinkDelay = BLINK_INTERVAL_MIN + 
      Math.random() * (BLINK_INTERVAL_MAX - BLINK_INTERVAL_MIN);
    
    blinkTimeoutId = setTimeout(() => {
      blink();
      scheduleNextBlink();
    }, nextBlinkDelay);
  }
  
  // Execute a blink animation
  function blink() {
    if (!assetsLoaded || !leftEyelid || !rightEyelid) return;
    
    // Close eyes
    leftEyelid.texture = leftEyelid.closedTexture;
    rightEyelid.texture = rightEyelid.closedTexture;
    
    // Open after a short delay
    setTimeout(() => {
      leftEyelid.texture = leftEyelid.openTexture;
      rightEyelid.texture = rightEyelid.openTexture;
    }, BLINK_DURATION);
  }
  
  // Start talking animation
  function startTalking() {
    if (!assetsLoaded) return;
    
    isTalking = true;
    
    // Show mouth
    mouth.visible = true;
    mouthVisible = true;
    
    // Start mouth animation
    talkingIntervalId = setInterval(() => {
      // Toggle mouth visibility for talking effect
      mouthVisible = !mouthVisible;
      mouth.visible = mouthVisible;
      
      // Random pupil movement during talking
      const randomX = (Math.random() * 2 - 1) * 0.5; // Smaller range for talking (-0.5 to 0.5)
      const randomY = (Math.random() * 2 - 1) * 0.3; // Even smaller vertical range
      movePupils(randomX, randomY);
      
    }, TALKING_MOUTH_FRAME_RATE);
  }
  
  // Stop talking animation
  function stopTalking() {
    if (!assetsLoaded) return;
    
    isTalking = false;
    
    // Stop mouth animation
    if (talkingIntervalId) {
      clearInterval(talkingIntervalId);
      talkingIntervalId = null;
    }
    
    // Hide mouth
    if (mouth) mouth.visible = false;
    
    // Reset pupil position
    movePupils(0, 0);
  }
  
  // Clean up resources when destroying the animation
  function destroy() {
    if (blinkTimeoutId) {
      clearTimeout(blinkTimeoutId);
    }
    
    if (talkingIntervalId) {
      clearInterval(talkingIntervalId);
    }
    
    app.destroy(true, { children: true });
  }
  
  // Initialize immediately
  init();
  
  // Public API
  return {
    startTalking,
    stopTalking,
    blink,
    movePupils,
    destroy
  };
})();