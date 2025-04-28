// Tree Animation using PixiJS
const treeAnimator = (function() {
  // Constants
  const CANVAS_WIDTH = 500;
  const CANVAS_HEIGHT = 600;
  let BLINK_INTERVAL_MIN = 2000; // Min time between blinks in ms
  let BLINK_INTERVAL_MAX = 6000; // Max time between blinks in ms
  const BLINK_DURATION = 150; // Duration of a blink in ms
  const PUPIL_MOVEMENT_RANGE = 20; // Maximum pixel range for pupil movement
  const TALKING_MOUTH_FRAME_RATE = 150; // Mouth animation frame rate in ms
  const EYE_SIZE_MULTIPLIER = 3; // Make eyes 3x larger

  // PixiJS Application
  let app;
  
  // Sprite references
  let treeBody;
  let leftEyelid, rightEyelid;
  let leftPupil, rightPupil;
  let mouth;
  
  // Animation state
  let blinkTimeoutId = null;
  let autoBlinkEnabled = true;
  let isTalking = false;
  let talkingIntervalId = null;
  let mouthVisible = false;
  let assetsLoaded = false;
  let socket = null;
  
  // Magic glimmer state
  let magicEnabled = false;
  let magicParticles = [];
  let magicContainer = null;
  let magicSize = 5; // Default size (1-10)
  let magicSpeed = 5; // Default speed (1-10)
  let magicAmount = 5; // Default amount (1-10)
  
  // Initialize the PixiJS application
  function init() {
    // Create PixiJS Application that fills the screen
    app = new PIXI.Application({
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: 0x00000000, // Transparent background
      antialias: true,
      resizeTo: window // Auto-resize with window
    });
    
    // Add canvas to the DOM
    document.getElementById('treeCanvas').appendChild(app.view);
    
    // Create magic particle container
    magicContainer = new PIXI.Container();
    
    // Connect to socket.io
    setupSocket();
    
    // Load assets manually
    loadAssetsManually();
    
    // Start the animation loop for magic particles
    app.ticker.add(updateMagicParticles);
  }
  
  // Connect to socket.io for tree control
  function setupSocket() {
    try {
      // Get the current page URL to handle connecting from different devices
      const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
      const host = window.location.hostname;
      const port = window.location.port ? `:${window.location.port}` : '';
      const serverUrl = `${protocol}//${host}${port}`;
      
      // Connect with explicit URL and options
      socket = io(serverUrl, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 20000
      });

      // Connection established
      socket.on('connect', () => {
        socket.emit('test-message', { client: 'better-tree', timestamp: Date.now() });
        
        // Set up state listeners once connected
        setupStateListeners();
      });

      // Handle tree control commands
      socket.on('tree-update', (command) => {
        if (command.type === 'eyePosition') {
          // Update eye position (normalize from 0-100 to -1 to 1)
          const xPercent = (command.x / 50) - 1;
          const yPercent = (command.y / 50) - 1;
          movePupils(xPercent, yPercent);
        } 
        else if (command.type === 'blink') {
          // Make the tree blink
          blink();
        }
        else if (command.type === 'closeEyes') {
          // Close the tree's eyes
          closeEyes();
        }
        else if (command.type === 'openEyes') {
          // Open the tree's eyes
          openEyes();
        }
        else if (command.type === 'toggleAutoBlink') {
          // Toggle automatic blinking
          toggleAutoBlink(command.enabled);
          
          // Update blink speed if provided
          if (command.speed !== undefined) {
            setBlinkSpeed(command.speed);
          }
        }
        else if (command.type === 'setBlinkSpeed') {
          // Set the blink speed
          setBlinkSpeed(command.speed);
        }
        else if (command.type === 'toggleMagic') {
          // Toggle magic glimmer effect with optional settings
          if (command.size !== undefined) magicSize = command.size;
          if (command.speed !== undefined) magicSpeed = command.speed;
          if (command.amount !== undefined) magicAmount = command.amount;
          
          toggleMagicGlimmer(command.enabled);
        }
        else if (command.type === 'updateMagicSettings') {
          // Update magic glimmer settings
          if (command.size !== undefined) magicSize = command.size;
          if (command.speed !== undefined) magicSpeed = command.speed;
          if (command.amount !== undefined) magicAmount = command.amount;
          
          // Apply settings if magic is enabled
          if (magicEnabled) {
            // No need to toggle, just let the next particle creation use the new settings
          }
        }
      });
      
      // Direct state request handlers
      socket.on('get-tree-state', () => {
        sendTreeState();
      });
      
      socket.on('get-state', () => {
        sendTreeState();
      });
      
      socket.on('request-state', () => {
        sendTreeState();
      });
      
      // Add a pinger to keep connection alive
      setInterval(() => {
        if (socket && socket.connected) {
          socket.emit('ping', { timestamp: Date.now() });
        }
      }, 30000);
    } catch (error) {
      console.error('Error setting up socket:', error);
    }
  }
  
  // Helper function to send current tree state
  function sendTreeState() {
    if (leftEyelid && rightEyelid) {
      // Get accurate state from the current tree
      const state = {
        eyesClosed: leftEyelid.texture === leftEyelid.closedTexture,
        autoBlinkEnabled: autoBlinkEnabled,
        lookingAround: false, // We don't track this internally 
        magicGlimmerEnabled: magicEnabled,
        eyeX: 50, // Default center position
        eyeY: 50 
      };
      
      socket.emit('tree-state', state);
    } else {
      // Send a basic state with defaults
      socket.emit('tree-state', {
        eyesClosed: false,
        autoBlinkEnabled: true,
        lookingAround: false,
        magicGlimmerEnabled: false,
        eyeX: 50,
        eyeY: 50
      });
    }
  }
  
  // Load all image assets manually since PixiJS v7 loader is different
  function loadAssetsManually() {
    // Create separate textures
    const treeTexture = PIXI.Texture.from('/tree.png');
    const lidsTexture = PIXI.Texture.from('/lids.png');
    const pupilTexture = PIXI.Texture.from('/pupil.png');
    const mouthesTexture = PIXI.Texture.from('/mouthes.png'); // New mouthes sprite sheet
    
    // Wait for all textures to load
    Promise.all([
      new Promise(resolve => {
        if (treeTexture.baseTexture.valid) resolve();
        else treeTexture.baseTexture.once('loaded', resolve);
      }),
      new Promise(resolve => {
        if (lidsTexture.baseTexture.valid) resolve();
        else lidsTexture.baseTexture.once('loaded', resolve);
      }),
      new Promise(resolve => {
        if (pupilTexture.baseTexture.valid) resolve();
        else pupilTexture.baseTexture.once('loaded', resolve);
      }),
      new Promise(resolve => {
        if (mouthesTexture.baseTexture.valid) resolve();
        else mouthesTexture.baseTexture.once('loaded', resolve);
      })
    ]).then(() => {
      const resources = {
        tree: { texture: treeTexture },
        lids: { texture: lidsTexture },
        pupil: { texture: pupilTexture },
        mouthes: { texture: mouthesTexture }
      };
      
      setupTree(resources);
      assetsLoaded = true;
    }).catch(error => {
      console.error('Error loading tree assets:', error);
    });
  }
  
  // Set up the tree with all components
  function setupTree(resources) {
    setupTreeBody(resources.tree.texture);
    setupEyes(resources.lids.texture, resources.pupil.texture);
    setupMouth(resources.mouthes.texture);
    
    // Add magic particle container to the stage
    app.stage.addChild(magicContainer);
    
    // Start automatic blinking
    scheduleNextBlink();
  }
  
  // Create the tree body
  function setupTreeBody(texture) {
    treeBody = new PIXI.Sprite(texture);
    treeBody.anchor.set(0.5);
    treeBody.x = app.screen.width / 2;
    treeBody.y = app.screen.height / 2;
    
    // Scale to fill the screen as much as possible
    const scale = Math.max(
      app.screen.width / treeBody.width * 1.2,
      app.screen.height / treeBody.height * 1.2
    );
    treeBody.scale.set(scale);
    
    app.stage.addChild(treeBody);
    
    // Handle window resizing
    window.addEventListener('resize', () => {
      treeBody.x = app.screen.width / 2;
      treeBody.y = app.screen.height / 2;
      
      // Recalculate scale when window resizes
      const newScale = Math.max(
        app.screen.width / treeBody.texture.width * 1,
        app.screen.height / treeBody.texture.height * 1
      );
      treeBody.scale.set(newScale);
      
      const eyeScale = 1.0; // Scale factor for eyes - 3x larger than original 0.2

      // Recalculate eye and mouth positions
      if (leftEyelid && rightEyelid && leftPupil && rightPupil && mouth) {
        const eyeOffsetX = treeBody.texture.width * 0.2;
        const eyeOffsetY = -treeBody.texture.height * 0.15;
        
        leftEyelid.x = treeBody.x - eyeOffsetX * treeBody.scale.x;
        leftEyelid.y = treeBody.y + eyeOffsetY * treeBody.scale.y;
        // leftEyelid.scale.set(0.6 * treeBody.scale.x);
        leftEyelid.scale.set(eyeScale * treeBody.scale.x);
        
        rightEyelid.x = treeBody.x + eyeOffsetX * treeBody.scale.x;
        rightEyelid.y = treeBody.y + eyeOffsetY * treeBody.scale.y;
        // rightEyelid.scale.set(0.6 * treeBody.scale.x);
        rightEyelid.scale.set(eyeScale * treeBody.scale.x);
        
        leftPupil.x = leftEyelid.x;
        leftPupil.y = leftEyelid.y;
        // leftPupil.scale.set(0.6 * 0.5 * treeBody.scale.x);
        leftPupil.scale.set(eyeScale * 0.8 * treeBody.scale.x);
        
        rightPupil.x = rightEyelid.x;
        rightPupil.y = rightEyelid.y;
        // rightPupil.scale.set(0.6 * 0.5 * treeBody.scale.x);
        rightPupil.scale.set(eyeScale * 0.8 * treeBody.scale.x);
        
        // Update mouth position and scale
        mouth.x = treeBody.x;
        mouth.y = treeBody.y + treeBody.texture.height * 0.2 * treeBody.scale.y + 20;
        // mouth.scale.set(0.3 * treeBody.scale.x);
        mouth.scale.set(0.8 * treeBody.scale.x);
      }
    });
  }
  
  // Create the eyes (eyelids and pupils)
  function setupEyes(lidsTexture, pupilTexture) {
    // Calculate eye positions relative to tree body center
    const eyeOffsetX = treeBody.width * 0.2; // Distance from center
    const eyeOffsetY = -treeBody.height * 0.15; // Above center
    const eyeScale = 0.6; // Scale factor for eyes - 3x larger than original 0.2
    
    // Create a texture for each eyelid state (open/closed) from sprite sheet
    const openLeftEyelidTexture = new PIXI.Texture(
      lidsTexture.baseTexture,
      new PIXI.Rectangle(0, 0, lidsTexture.width / 2, lidsTexture.height / 2)
    );
    
    const closedLeftEyelidTexture = new PIXI.Texture(
      lidsTexture.baseTexture,
      new PIXI.Rectangle(0, lidsTexture.height / 2, lidsTexture.width / 2, lidsTexture.height / 2)
    );
    
    const openRightEyelidTexture = new PIXI.Texture(
      lidsTexture.baseTexture,
      new PIXI.Rectangle(lidsTexture.width / 2, 0, lidsTexture.width / 2, lidsTexture.height / 2)
    );
    
    const closedRightEyelidTexture = new PIXI.Texture(
      lidsTexture.baseTexture,
      new PIXI.Rectangle(lidsTexture.width / 2, lidsTexture.height / 2, lidsTexture.width / 2, lidsTexture.height / 2)
    );
    
    // Create left eyelid
    leftEyelid = new PIXI.Sprite(openLeftEyelidTexture);
    leftEyelid.anchor.set(0.5);
    leftEyelid.x = treeBody.x - eyeOffsetX * treeBody.scale.x;
    leftEyelid.y = treeBody.y + eyeOffsetY * treeBody.scale.y;
    leftEyelid.scale.set(eyeScale * treeBody.scale.x);
    
    // Create right eyelid
    rightEyelid = new PIXI.Sprite(openRightEyelidTexture);
    rightEyelid.anchor.set(0.5);
    rightEyelid.x = treeBody.x + eyeOffsetX * treeBody.scale.x;
    rightEyelid.y = treeBody.y + eyeOffsetY * treeBody.scale.y;
    rightEyelid.scale.set(eyeScale * treeBody.scale.x);
    
    // Save the textures for animation
    leftEyelid.openTexture = openLeftEyelidTexture;
    leftEyelid.closedTexture = closedLeftEyelidTexture;
    rightEyelid.openTexture = openRightEyelidTexture;
    rightEyelid.closedTexture = closedRightEyelidTexture;
    
    // Create pupils - make them proportionally large too
    leftPupil = new PIXI.Sprite(pupilTexture);
    leftPupil.anchor.set(0.5);
    leftPupil.x = leftEyelid.x + leftEyelid.width/15;
    leftPupil.y = leftEyelid.y + leftEyelid.height/15;
    leftPupil.scale.set(eyeScale * 0.8 * treeBody.scale.x);
    
    rightPupil = new PIXI.Sprite(pupilTexture);
    rightPupil.anchor.set(0.5);
    rightPupil.x = rightEyelid.x - rightEyelid.width/15;
    rightPupil.y = rightEyelid.y + rightEyelid.height/15;
    // rightPupil.x = rightEyelid.x;
    // rightPupil.y = rightEyelid.y;
    rightPupil.scale.set(eyeScale * 0.8 * treeBody.scale.x);
    
    // Add to stage in correct order
    app.stage.addChild(leftEyelid);
    app.stage.addChild(rightEyelid);
    app.stage.addChild(leftPupil);
    app.stage.addChild(rightPupil);
  }
  
  // Create the mouth with both open and closed states - SIMPLE VERSION
  function setupMouth(texture) {
    // Create textures for open and closed mouth from the sprite sheet
    const openMouthTexture = new PIXI.Texture(
      texture.baseTexture,
      new PIXI.Rectangle(0, 0, 502, 370) // Top part - open mouth
    );
    
    const closedMouthTexture = new PIXI.Texture(
      texture.baseTexture,
      new PIXI.Rectangle(0, 370, 502, 370) // Bottom part - closed mouth
    );
    
    // Create mouth sprite with closed mouth initially - keep it simple
    mouth = new PIXI.Sprite(closedMouthTexture);
    mouth.anchor.set(0.5);
    mouth.x = treeBody.x;
    mouth.y = treeBody.y + treeBody.height * 0.2 * treeBody.scale.y + 20;
    mouth.scale.set(0.8 * treeBody.scale.x); // Larger scale so it's clearly visible
    
    // Store references to both textures for animation
    mouth.openTexture = openMouthTexture;
    mouth.closedTexture = closedMouthTexture;
    
    // Just a small amount of transparency - no filters
    mouth.alpha = 0.85;
    
    // Add to stage
    app.stage.addChild(mouth);
  }
  
  // Move the pupils based on normalized coordinates (-1 to 1)
  function movePupils(xPercent, yPercent) {
    if (!assetsLoaded || !leftPupil || !rightPupil || !leftEyelid || !rightEyelid) return;
    
    const leftBaseX = leftEyelid.x;
    const leftBaseY = leftEyelid.y;
    const rightBaseX = rightEyelid.x;
    const rightBaseY = rightEyelid.y;

    // Apply movement within range
    leftPupil.x = leftBaseX + xPercent * PUPIL_MOVEMENT_RANGE * treeBody.scale.x + leftEyelid.width/15;
    leftPupil.y = leftBaseY + yPercent * PUPIL_MOVEMENT_RANGE * treeBody.scale.y + leftEyelid.height/15;

    rightPupil.x = rightBaseX + xPercent * PUPIL_MOVEMENT_RANGE * treeBody.scale.x - rightEyelid.width/15;
    rightPupil.y = rightBaseY + yPercent * PUPIL_MOVEMENT_RANGE * treeBody.scale.y + rightEyelid.height/15;
  }
  
  // Set the blink speed (in seconds)
  function setBlinkSpeed(seconds) {
    // Convert seconds to milliseconds
    const speedMs = seconds * 1000;
    
    // Set min and max blink intervals
    // Min = speed/2, Max = speed*1.5
    BLINK_INTERVAL_MIN = speedMs / 2;
    BLINK_INTERVAL_MAX = speedMs * 1.5;
    
    // Reschedule next blink with new timing
    if (autoBlinkEnabled && blinkTimeoutId) {
      clearTimeout(blinkTimeoutId);
      scheduleNextBlink();
    }
  }
  
  // Toggle auto-blink functionality
  function toggleAutoBlink(enabled) {
    autoBlinkEnabled = enabled;
    
    // If we're turning auto-blink off, clear any existing timeout
    if (!autoBlinkEnabled && blinkTimeoutId) {
      clearTimeout(blinkTimeoutId);
      blinkTimeoutId = null;
    }
    
    // If we're turning it on, schedule the next blink
    if (autoBlinkEnabled && !blinkTimeoutId) {
      scheduleNextBlink();
    }
  }
  
  // Schedule the next automatic blink
  function scheduleNextBlink() {
    // Don't schedule if auto-blink is disabled
    if (!autoBlinkEnabled) return;
    
    const nextBlinkDelay = BLINK_INTERVAL_MIN + 
      Math.random() * (BLINK_INTERVAL_MAX - BLINK_INTERVAL_MIN);
    
    blinkTimeoutId = setTimeout(() => {
      // Don't blink if the eyes are closed or auto-blink is disabled
      if (autoBlinkEnabled && 
          leftEyelid && rightEyelid && 
          leftEyelid.texture === leftEyelid.openTexture) {
        blink();
      }
      scheduleNextBlink();
    }, nextBlinkDelay);
  }
  
  // Execute a blink animation
  function blink() {
    if (!assetsLoaded || !leftEyelid || !rightEyelid || !leftPupil || !rightPupil) return;
    
    // Hide pupils first
    leftPupil.visible = false;
    rightPupil.visible = false;
    
    // Close eyes
    leftEyelid.texture = leftEyelid.closedTexture;
    rightEyelid.texture = rightEyelid.closedTexture;
    
    // Open after a short delay
    setTimeout(() => {
      leftEyelid.texture = leftEyelid.openTexture;
      rightEyelid.texture = rightEyelid.openTexture;
      
      // Show pupils again after eyes open
      leftPupil.visible = true;
      rightPupil.visible = true;
    }, BLINK_DURATION);
  }
  
  // Start talking animation
  function startTalking() {
    if (!assetsLoaded || !mouth) return;
    
    // If already talking, clear previous interval
    if (isTalking && talkingIntervalId) {
      clearInterval(talkingIntervalId);
    }
    
    isTalking = true;
    mouthVisible = true;
    
    // Make sure mouth is visible and set to open initially
    mouth.visible = true;
    mouth.texture = mouth.openTexture;
    
    // Starting eye position - look slightly forward
    movePupils(0, 0);
    
    // Start mouth animation
    talkingIntervalId = setInterval(() => {
      // Toggle between open and closed mouth textures
      if (mouthVisible) {
        mouth.texture = mouth.closedTexture;
      } else {
        mouth.texture = mouth.openTexture;
      }
      mouthVisible = !mouthVisible;
      
      // More subtle eye movements with smaller variance
      // Only move eyes every few animation frames
      if (Math.random() < 0.3) {
        const randomX = (Math.random() * 2 - 1) * 0.2; // Much smaller range (-0.2 to 0.2)
        const randomY = (Math.random() * 2 - 1) * 0.1; // Even smaller vertical range 
        movePupils(randomX, randomY);
      }
    }, TALKING_MOUTH_FRAME_RATE);
  }
  
  // Stop talking animation
  function stopTalking() {
    if (!assetsLoaded) return;
    
    // Clear old talking state
    isTalking = false;
    
    // Stop mouth animation
    if (talkingIntervalId) {
      clearInterval(talkingIntervalId);
      talkingIntervalId = null;
    }
    
    // Set mouth to closed state
    if (mouth) {
      mouth.texture = mouth.closedTexture;
      mouthVisible = false;
    }
    
    // Reset pupil position with a small delay to make it look smoother
    setTimeout(() => {
      // Slight forward gaze
      movePupils(0, 0);
    }, 100);
  }
  
  // Toggle magic glimmer effect
  function toggleMagicGlimmer(enabled) {
    magicEnabled = enabled;
    
    try {
      if (magicEnabled) {
        // Create textures if they don't exist yet
        if (!particleTextures) {
          particleTextures = createParticleTextures();
        }
        
        // Add container to stage if not already added
        if (!app.stage.children.includes(magicContainer)) {
          app.stage.addChild(magicContainer);
        }
      } else {
        // Clear all particles
        while (magicContainer.children.length > 0) {
          const particle = magicContainer.children[0];
          magicContainer.removeChild(particle);
        }
        magicParticles = [];
        
        // Remove container from stage
        if (app.stage.children.includes(magicContainer)) {
          app.stage.removeChild(magicContainer);
        }
      }
    } catch (error) {
      console.error('Error in toggleMagicGlimmer:', error);
      // Safety: disable magic if there's an error
      magicEnabled = false;
    }
  }
  
  // Create particle textures once at initialization
  let particleTextures = null;
  
  function createParticleTextures() {
    if (particleTextures) return particleTextures;
    
    particleTextures = {};
    
    // Create circle texture with glow effect (using concentric circles)
    const circleGraphic = new PIXI.Graphics();
    // Outer glow
    circleGraphic.beginFill(0xffff99, 0.3);
    circleGraphic.drawCircle(0, 0, 12);
    circleGraphic.endFill();
    // Middle glow
    circleGraphic.beginFill(0xffff99, 0.6);
    circleGraphic.drawCircle(0, 0, 8);
    circleGraphic.endFill();
    // Core
    circleGraphic.beginFill(0xffff99, 1);
    circleGraphic.drawCircle(0, 0, 5);
    circleGraphic.endFill();
    particleTextures.circle = app.renderer.generateTexture(circleGraphic);
    
    // Create star texture with glow effect
    const starGraphic = new PIXI.Graphics();
    
    // Outer glow
    starGraphic.beginFill(0xffda4d, 0.3);
    const numPoints = 5;
    const outerGlowRadius = 14;
    const innerGlowRadius = outerGlowRadius * 0.4;
    
    // Draw outer glow star
    for (let i = 0; i < numPoints * 2; i++) {
      const radius = i % 2 === 0 ? outerGlowRadius : innerGlowRadius;
      const angle = (i / (numPoints * 2)) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) {
        starGraphic.moveTo(x, y);
      } else {
        starGraphic.lineTo(x, y);
      }
    }
    starGraphic.closePath();
    starGraphic.endFill();
    
    // Middle glow
    starGraphic.beginFill(0xffda4d, 0.6);
    // const middleRadius = 10;
    const middleRadius = 20;
    const middleInnerRadius = middleRadius * 0.4;
    
    // Draw middle star
    for (let i = 0; i < numPoints * 2; i++) {
      const radius = i % 2 === 0 ? middleRadius : middleInnerRadius;
      const angle = (i / (numPoints * 2)) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) {
        starGraphic.moveTo(x, y);
      } else {
        starGraphic.lineTo(x, y);
      }
    }
    starGraphic.closePath();
    starGraphic.endFill();
    
    // Core star
    starGraphic.beginFill(0xffda4d, 1);
    // const coreRadius = 7;
    const coreRadius = 13;
    const coreInnerRadius = coreRadius * 0.4;
    
    // Draw core star
    for (let i = 0; i < numPoints * 2; i++) {
      const radius = i % 2 === 0 ? coreRadius : coreInnerRadius;
      const angle = (i / (numPoints * 2)) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) {
        starGraphic.moveTo(x, y);
      } else {
        starGraphic.lineTo(x, y);
      }
    }
    starGraphic.closePath();
    starGraphic.endFill();
    
    particleTextures.star = app.renderer.generateTexture(starGraphic);
    
    // Create sparkle texture with glow effect
    const sparkleGraphic = new PIXI.Graphics();
    
    // Outer glow
    sparkleGraphic.beginFill(0xffffc5, 0.3);
    const outerSize = 4;
    sparkleGraphic.drawRect(-outerSize * 3, -outerSize * 0.7, outerSize * 6, outerSize * 1.4);
    sparkleGraphic.drawRect(-outerSize * 0.7, -outerSize * 3, outerSize * 1.4, outerSize * 6);
    sparkleGraphic.endFill();
    
    // Middle glow
    sparkleGraphic.beginFill(0xffffc5, 0.6);
    const midSize = 3;
    sparkleGraphic.drawRect(-midSize * 3, -midSize * 0.6, midSize * 6, midSize * 1.2);
    sparkleGraphic.drawRect(-midSize * 0.6, -midSize * 3, midSize * 1.2, midSize * 6);
    sparkleGraphic.endFill();
    
    // Core
    sparkleGraphic.beginFill(0xffffc5, 1);
    const size = 2;
    sparkleGraphic.drawRect(-size * 3, -size * 0.5, size * 6, size);
    sparkleGraphic.drawRect(-size * 0.5, -size * 3, size, size * 6);
    sparkleGraphic.endFill();
    
    particleTextures.sparkle = app.renderer.generateTexture(sparkleGraphic);
    
    return particleTextures;
  }
  
  // Create a new magic particle
  function createMagicParticle() {
    if (!magicEnabled || !treeBody) return;
    
    // Make sure textures are created
    if (!particleTextures) {
      particleTextures = createParticleTextures();
    }
    
    // Choose particle type randomly
    const particleType = Math.floor(Math.random() * 3);
    let texture, tint;
    
    if (particleType === 0) {
      // Glowing circle
      texture = particleTextures.circle;
      tint = 0xffff99;
    } 
    else if (particleType === 1) {
      // Star
      texture = particleTextures.star;
      tint = 0xffda4d;
    }
    else {
      // Sparkle
      texture = particleTextures.sparkle;
      tint = 0xffffc5;
    }
    
    // Create sprite with the appropriate texture
    const particle = new PIXI.Sprite(texture);
    particle.tint = tint;
    
    // Center the sprite
    particle.anchor.set(0.5);
    
    // Set random position around the tree
    const angle = Math.random() * Math.PI * 2;
    const distance = treeBody.width * (0.2 + Math.random() * 0.3);
    
    particle.x = treeBody.x + Math.cos(angle) * distance;
    particle.y = treeBody.y + Math.sin(angle) * distance;
    
    // Set random velocity - scale by magicSpeed (1-10)
    // Normalize speed to a range from 0.5 to 3
    const speedFactor = 0.5 + (magicSpeed / 10) * 2.5;
    particle.vx = (Math.random() - 0.5) * 2 * speedFactor;
    particle.vy = ((Math.random() - 0.5) * 2 - 1) * speedFactor; // Slightly biased upward
    
    // Set particle properties
    particle.alpha = 0.7 + Math.random() * 0.3;
    
    // Scale based on magicSize (1-10)
    // Normalize size to a range from 0.1 to 0.4
    const sizeFactor = 0.1 + (magicSize / 10) * 0.3;
    const baseScale = sizeFactor + Math.random() * (sizeFactor * 0.5);
    particle.scale.set(baseScale);
    
    // Lifespan depends on speed - faster particles live shorter
    particle.lifespan = (50 + Math.random() * 100) * (1 + (10 - magicSpeed) / 10);
    
    // Add rotation for sparkles
    if (particleType === 2) {
      particle.rotation = Math.random() * Math.PI;
      particle.rotationSpeed = (Math.random() - 0.5) * 0.2 * speedFactor;
    }
    
    // Add to container
    magicContainer.addChild(particle);
    
    // Add to array for tracking
    magicParticles.push(particle);
  }
  
  // Update magic particles
  function updateMagicParticles(delta) {
    if (!magicEnabled) return;
    
    try {
      // Create new particles based on magicAmount (1-10)
      // Convert to a probability between 0.05 and 0.8
      const particleChance = 0.05 + (magicAmount / 10) * 0.75;
      
      // Limit the maximum number of particles based on the amount setting
      const maxParticles = 10 + magicAmount * 15; // 25-160 particles
      
      // Only create new particles if we're below the max and random check passes
      if (Math.random() < particleChance && magicParticles.length < maxParticles) {
        createMagicParticle();
        
        // For higher amounts, create multiple particles in a burst
        if (magicAmount > 5 && Math.random() < 0.3) {
          const burstAmount = Math.floor(magicAmount / 3);
          for (let i = 0; i < burstAmount; i++) {
            createMagicParticle();
          }
        }
      }
      
      // Update existing particles
      for (let i = magicParticles.length - 1; i >= 0; i--) {
        const p = magicParticles[i];
        
        // Update position
        p.x += p.vx;
        p.y += p.vy;
        
        // Apply rotation if the particle has rotation speed
        if (p.rotationSpeed) {
          p.rotation += p.rotationSpeed;
        }
        
        // Update scale and alpha
        p.lifespan -= 1;
        p.alpha = Math.max(0, p.lifespan / 100);
        
        // Make particles shimmer/twinkle slightly
        if (Math.random() < 0.1) {
          p.alpha = Math.min(1, p.alpha + 0.1);
        }
        
        // Remove dead particles
        if (p.lifespan <= 0) {
          magicContainer.removeChild(p);
          magicParticles.splice(i, 1);
        }
      }
    } catch (error) {
      console.error('Error in updateMagicParticles:', error);
      // Safety: disable magic if there's an error
      magicEnabled = false;
    }
  }
  
  // Clean up resources when destroying the animation
  function destroy() {
    if (blinkTimeoutId) {
      clearTimeout(blinkTimeoutId);
    }
    
    if (talkingIntervalId) {
      clearInterval(talkingIntervalId);
    }
    
    if (socket) {
      socket.disconnect();
    }
    
    app.destroy(true, { children: true });
  }
  
  // Initialize immediately
  init();
  
  // Close eyes function
  function closeEyes() {
    if (!assetsLoaded || !leftEyelid || !rightEyelid || !leftPupil || !rightPupil) return;
    
    // Hide pupils
    leftPupil.visible = false;
    rightPupil.visible = false;
    
    // Close eyes
    leftEyelid.texture = leftEyelid.closedTexture;
    rightEyelid.texture = rightEyelid.closedTexture;
    
    // If we have an active blink timeout, clear it
    // (no need to auto-blink while eyes are closed)
    if (blinkTimeoutId) {
      clearTimeout(blinkTimeoutId);
      blinkTimeoutId = null;
    }
  }
  
  // Open eyes function
  function openEyes() {
    if (!assetsLoaded || !leftEyelid || !rightEyelid || !leftPupil || !rightPupil) return;
    
    // Show pupils
    leftPupil.visible = true;
    rightPupil.visible = true;
    
    // Open eyes
    leftEyelid.texture = leftEyelid.openTexture;
    rightEyelid.texture = rightEyelid.openTexture;
    
    // If auto-blink is enabled, restart the blink scheduling
    if (autoBlinkEnabled && !blinkTimeoutId) {
      scheduleNextBlink();
    }
  }
  
  // Handle state requests directly
  function handleStateRequest() {
    // Return current state as an object
    return {
      eyesClosed: leftEyelid && leftEyelid.texture === leftEyelid.closedTexture,
      autoBlinkEnabled: autoBlinkEnabled,
      lookingAround: false, // We don't track this internally
      magicGlimmerEnabled: magicEnabled,
      eyeX: 50, // Default center position
      eyeY: 50,
      blinkSpeed: Math.round(BLINK_INTERVAL_MAX / 1500), // Convert back to seconds for UI
      magicSize: magicSize,
      magicSpeed: magicSpeed,
      magicAmount: magicAmount
    };
  }
  
  // Add socket listeners for state requests
  function setupStateListeners() {
    if (!socket || !socket.connected) return;
    
    // Handle state requests
    socket.on('get-tree-state', () => {
      const state = handleStateRequest();
      socket.emit('tree-state', state);
    });
    
    // Also handle alternate event names
    socket.on('get-state', () => {
      const state = handleStateRequest();
      socket.emit('tree-state', state);
    });
    
    socket.on('request-state', () => {
      const state = handleStateRequest();
      socket.emit('tree-state', state);
    });
    
    // Also handle special commands 
    socket.on('tree-update', (command) => {
      if (command.type === 'getState') {
        const state = handleStateRequest();
        socket.emit('tree-state', state);
      }
      else if (command.type === 'initState') {
        // Apply state changes from command
        if (command.autoBlinkEnabled !== undefined) {
          toggleAutoBlink(command.autoBlinkEnabled);
        }
        if (command.eyesClosed !== undefined) {
          if (command.eyesClosed) {
            closeEyes();
          } else {
            openEyes();
          }
        }
        if (command.magicGlimmerEnabled !== undefined) {
          toggleMagicGlimmer(command.magicGlimmerEnabled);
        }
        if (command.eyeX !== undefined && command.eyeY !== undefined) {
          // Convert from 0-100 to -1,1 range
          const x = (command.eyeX / 50) - 1;
          const y = (command.eyeY / 50) - 1;
          movePupils(x, y);
        }
        
        // Then send updated state back
        const state = handleStateRequest();
        socket.emit('tree-state', state);
      }
    });
  }
  
  // Set up state listeners after socket is connected
  setupStateListeners();
  
  // Expose internal state and methods for access from outside
  const _internal = {
    autoBlinkEnabled,
    magicEnabled,
    assetsLoaded
  };
  
  // Public API
  return {
    startTalking,
    stopTalking,
    blink,
    closeEyes,
    openEyes,
    movePupils,
    toggleAutoBlink,
    setBlinkSpeed,
    toggleMagicGlimmer,
    destroy,
    handleStateRequest,
    _internal
  };
})();