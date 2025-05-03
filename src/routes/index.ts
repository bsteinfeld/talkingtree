import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { WatsonxService } from '../services/watsonx';
import { SpeechService } from '../services/speechService';
import { createWriteStream } from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';

const router = Router();
const watsonxService = new WatsonxService();
const speechService = new SpeechService();

// Set FFmpeg path
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

// State tracking for toggleable features
const appState = {
  musicEnabled: false,
  recordingWebcam: false
};

// Directory for webcam recordings
const RECORDINGS_DIR = path.join(__dirname, '..', '..', 'recordings');
// Directory for temporary frames
const FRAMES_DIR = path.join(__dirname, '..', '..', 'frames');

// Create directories if they don't exist
if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}
if (!fs.existsSync(FRAMES_DIR)) {
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
}

// Variables for recording
let recordingFileName: string = '';
let framesDir: string = '';
let recordingFrameCount: number = 0;
let recordingInterval: NodeJS.Timeout | null = null;
let recordingStartTime: number = 0;
let lastFrameTime: number = 0;

// Cache directory for audio files
const CACHE_DIR = path.join(__dirname, '..', '..', 'cache');

// Create cache directory if it doesn't exist
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// API health check endpoint
router.get('/health', (req, res) => {
  res.json({ message: 'TalkingTree API is running' });
});

// Get current state
router.get('/state', (req, res) => {
  res.json({
    success: true,
    state: appState
  });
});

// Start webcam recording
router.post('/webcam/record/start', (req, res) => {
  try {
    if (appState.recordingWebcam) {
      return res.status(400).json({
        success: false,
        message: 'Recording is already in progress'
      });
    }

    // Generate timestamp for this recording
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // Create a unique directory for this recording's frames
    framesDir = path.join(FRAMES_DIR, `recording-${timestamp}`);
    if (!fs.existsSync(framesDir)) {
      fs.mkdirSync(framesDir, { recursive: true });
    }

    // Set the final output file
    recordingFileName = path.join(RECORDINGS_DIR, `webcam-recording-${timestamp}.mp4`);

    // Initialize recording state
    appState.recordingWebcam = true;
    recordingFrameCount = 0;
    recordingStartTime = Date.now();
    lastFrameTime = recordingStartTime;

    // Get the socket.io instance for logging
    const io = req.app.get('socketio');
    if (io) {
      io.emit('button-event', {
        message: `Webcam recording started: ${path.basename(recordingFileName)}`
      });
    }

    // Start a ping interval to show recording status
    if (recordingInterval) {
      clearInterval(recordingInterval);
    }

    recordingInterval = setInterval(() => {
      const io = req.app.get('socketio');
      if (io && appState.recordingWebcam) {
        const elapsedSeconds = Math.floor((Date.now() - recordingStartTime) / 1000);
        io.emit('button-event', {
          message: `Recording in progress: ${recordingFrameCount} frames (${elapsedSeconds}s)`
        });
      }
    }, 5000); // Update every 5 seconds

    res.json({
      success: true,
      message: 'Recording started',
      file: path.basename(recordingFileName)
    });
  } catch (error) {
    console.error('Error starting webcam recording:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start recording'
    });
  }
});

// Stop webcam recording
router.post('/webcam/record/stop', (req, res) => {
  try {
    if (!appState.recordingWebcam) {
      return res.status(400).json({
        success: false,
        message: 'No recording is in progress'
      });
    }

    // Stop the status interval
    if (recordingInterval) {
      clearInterval(recordingInterval);
      recordingInterval = null;
    }

    // Update state - set to false to stop capturing new frames
    appState.recordingWebcam = false;

    // Get total recording time
    const totalTime = (Date.now() - recordingStartTime) / 1000;

    // Get the socket.io instance for logging
    const io = req.app.get('socketio');
    if (io) {
      io.emit('button-event', {
        message: `Webcam recording processing: ${recordingFrameCount} frames captured in ${totalTime.toFixed(1)}s`
      });
    }

    // Only process if we have frames
    if (recordingFrameCount > 0) {
      // Process the frames into a video using FFmpeg
      const framesPattern = path.join(framesDir, 'frame-%d.jpg');

      // Calculate framerate based on number of frames and total time
      const framerate = Math.max(1, Math.min(30, Math.round(recordingFrameCount / totalTime)));

      // Create a response promise
      const responsePromise = new Promise((resolve, reject) => {
        // Set up FFmpeg command
        const command = ffmpeg()
          .input(framesPattern)
          .inputFPS(framerate)
          .output(recordingFileName)
          .videoCodec('libx264')
          .outputOptions([
            '-pix_fmt yuv420p', // Improve compatibility
            '-preset medium',   // Balance between speed and quality
            '-crf 23'           // Constant rate factor (lower = better quality)
          ])
          .outputFPS(framerate)
          // Original dimensions will be preserved
          .on('start', (cmdline: string) => {
            console.log('FFmpeg started with command:', cmdline);
            if (io) {
              io.emit('button-event', {
                message: `Processing video at ${framerate} FPS...`
              });
            }
          })
          .on('progress', (progress: { percent?: number; frames?: number; }) => {
            console.log(`FFmpeg progress: ${JSON.stringify(progress)}`);
          })
          .on('error', (err: Error) => {
            console.error('Error during video processing:', err);
            if (io) {
              io.emit('button-event', {
                message: `Error processing video: ${err.message}`
              });
            }
            reject(err);
          })
          .on('end', () => {
            console.log('Video processing finished');
            if (io) {
              io.emit('button-event', {
                message: `Video recording completed: ${path.basename(recordingFileName)}, ${recordingFrameCount} frames @ ${framerate} FPS (${totalTime.toFixed(1)}s)`
              });
            }

            // Clean up the temporary frames
            try {
              const files = fs.readdirSync(framesDir);
              files.forEach(file => {
                fs.unlinkSync(path.join(framesDir, file));
              });
              fs.rmdirSync(framesDir);
              console.log(`Cleaned up temporary frames directory: ${framesDir}`);
            } catch (cleanupError) {
              console.error('Error cleaning up frames:', cleanupError);
            }

            resolve({
              success: true,
              message: 'Recording processed successfully',
              file: path.basename(recordingFileName),
              frameCount: recordingFrameCount,
              duration: totalTime.toFixed(1),
              fps: framerate
            });
          });

        // Run the command
        command.run();
      });

      // Send response to client immediately
      res.json({
        success: true,
        message: 'Recording stopped, processing video...',
        file: path.basename(recordingFileName),
        frameCount: recordingFrameCount,
        processingTime: `Approximately ${(recordingFrameCount / 10).toFixed(0)} seconds`
      });

      // Let FFmpeg run in the background
      responsePromise.catch(err => {
        console.error('Error in FFmpeg processing:', err);
      });
    } else {
      // No frames captured
      res.json({
        success: false,
        message: 'No frames were captured during the recording',
        file: path.basename(recordingFileName),
        frameCount: 0
      });
    }
  } catch (error) {
    console.error('Error stopping webcam recording:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to stop recording'
    });
  }
});

// List all recordings
router.get('/webcam/recordings', (req, res) => {
  try {
    const files = fs.readdirSync(RECORDINGS_DIR)
      .filter(file => file.startsWith('webcam-recording-'))
      .map(file => {
        const filePath = path.join(RECORDINGS_DIR, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          size: stats.size,
          created: stats.birthtime
        };
      })
      .sort((a, b) => b.created.getTime() - a.created.getTime()); // Sort newest first

    res.json({
      success: true,
      recordings: files
    });
  } catch (error) {
    console.error('Error listing recordings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to list recordings'
    });
  }
});

// Get recording status
router.get('/webcam/record/status', (req, res) => {
  try {
    res.json({
      success: true,
      recording: appState.recordingWebcam,
      frameCount: recordingFrameCount,
      elapsedTime: appState.recordingWebcam ? (Date.now() - recordingStartTime) / 1000 : 0,
      currentFile: appState.recordingWebcam ? path.basename(recordingFileName) : null,
      framesDir: appState.recordingWebcam ? path.basename(framesDir) : null
    });
  } catch (error) {
    console.error('Error getting recording status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get recording status'
    });
  }
});

// Button press endpoint - adds an event to the event log
router.post('/button', (req, res) => {
  try {
    // Get the button data
    const { button, action } = req.body;

    // Default message if none provided
    const message = req.body.message || `Button ${button || 'unknown'} ${action || 'pressed'}`;

    // Get the socket.io instance
    const io = req.app.get('socketio');

    // Special handling for music button
    if (button === 'music') {
      // If an action is specified, use that to set the state, otherwise toggle
      if (action === 'on' || action === 'play' || action === 'start') {
        appState.musicEnabled = true;
      } else if (action === 'off' || action === 'stop') {
        appState.musicEnabled = false;
      } else {
        // No specific action, just toggle
        appState.musicEnabled = !appState.musicEnabled;
      }

      const newState = appState.musicEnabled;

      if (io) {
        // Send command to toggle music
        io.emit('tree-update', {
          type: 'toggleMusic',
          enabled: newState
        });

        // Also emit regular button event for logging
        io.emit('button-event', {
          message: `Music ${newState ? 'started' : 'stopped'} via API`
        });

        console.log(`Music ${newState ? 'started' : 'stopped'} via API`);
      }

      return res.status(200).json({
        success: true,
        message: `Music ${newState ? 'started' : 'stopped'}`,
        musicEnabled: newState
      });
    }

    // Standard button event handling for other buttons
    if (io) {
      io.emit('button-event', { message });
      console.log('Button event emitted:', message);
    }

    // Return success response
    res.status(200).json({ success: true, message });
  } catch (error) {
    console.error('Error handling button event:', error);
    res.status(500).json({ success: false, error: 'Failed to process button event' });
  }
});

// Process speech with AI before sending to the tree
router.post('/process-speech', async (req, res) => {
  try {
    const { text, useAI } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    // If AI processing is not requested, return the original text
    if (!useAI) {
      return res.json({ processedText: text });
    }

    // Get AI response
    const aiResponse = await watsonxService.generateResponse(text, {
      systemPrompt: 'You are a wise, ancient talking tree with a cheerful personality. The human has given you some text to say. Rewrite it in your own tree-like personality. Keep your response under 150 characters. Do not add any explanations or clarifications - just output the rewritten text.',
      temperature: 0.7,
      maxTokens: 150
    });

    res.json({ processedText: aiResponse });
  } catch (error) {
    console.error('Error processing speech:', error);
    res.status(500).json({
      error: 'Failed to process text',
      processedText: req.body.text // Fallback to original text
    });
  }
});

// Get AI response from WatsonX
router.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get response from WatsonX
    const response = await watsonxService.generateResponse(message, {
      systemPrompt: 'You are a wise, ancient talking tree with a cheerful personality. Respond to the human in a friendly manner. Keep your responses short and engaging, as you\'re speaking them out loud. Add occasional tree-related puns or references to nature when appropriate.',
      temperature: 0.7,
      maxTokens: 200
    });

    res.json({ response });
  } catch (error) {
    console.error('Error getting AI response:', error);
    res.status(500).json({
      error: 'Failed to generate AI response',
      fallbackResponse: 'I seem to be having trouble connecting to my wisdom right now. Can you try again?'
    });
  }
});

// Text-to-speech endpoint - no AI processing, just speaks the text as provided
router.get('/speak', async (req, res) => {
  try {
    const userMessage = req.query.words?.toString();

    // If no message is provided, use default greeting
    if (!userMessage) {
      const defaultText = 'Hello, I\'m a talking tree';
      return handleTTS(defaultText, res);
    }

    // Create a unique hash for this message to be used as a filename in static serving
    const hash = crypto.createHash('md5').update(userMessage).digest('hex');
    const audioFileName = `${hash}.wav`;
    const audioFilePath = path.join(CACHE_DIR, audioFileName);

    // Check if we already have this audio cached
    if (fs.existsSync(audioFilePath)) {
      // Serve the static file from /audio/ URL
      res.set('X-Using-Cache', 'true');
      // Redirect to the static audio file
      return res.redirect(`/audio/${audioFileName}`);
    }

    // If not cached, generate the speech
    return handleTTS(userMessage, res, hash);
  } catch (error) {
    console.error('Error in speak endpoint:', error);
    res.status(500).json({ error: 'Failed to process speech request' });
  }
});

// Helper function to handle TTS generation
async function handleTTS(text: string, res: any, hash?: string) {
  try {
    // Use the Microsoft Speech Service to generate speech
    const result = await speechService.textToSpeech(text, hash);

    if (!result.success) {
      console.warn('Speech synthesis failed:', result.error);
      return res.status(200).json({
        error: 'Speech synthesis failed: ' + result.error,
        useBrowserSpeech: true,
        text: text
      });
    }

    // If synthesis was successful, we should have an audio file path
    if (result.audioPath) {
      try {
        // Check if file exists and has content
        if (!fs.existsSync(result.audioPath)) {
          throw new Error('Generated audio file does not exist');
        }

        const stat = fs.statSync(result.audioPath);
        console.log(`Audio file size: ${stat.size} bytes`);

        if (stat.size === 0) {
          throw new Error('Generated audio file is empty');
        }

        // Check file extension to determine content type
        const fileExt = path.extname(result.audioPath).toLowerCase();
        const contentType = fileExt === '.mp3' ? 'audio/mp3' : 'audio/wav';

        // Read the file directly
        const audioBuffer = fs.readFileSync(result.audioPath);

        // Set appropriate headers
        res.set('Content-Type', contentType);
        res.set('Content-Length', audioBuffer.length.toString());
        res.set('Cache-Control', 'public, max-age=3600');
        res.set('Accept-Ranges', 'bytes');

        console.log(`Sending audio file: ${path.basename(result.audioPath)}, size: ${audioBuffer.length} bytes, type: ${contentType}`);

        return res.send(audioBuffer);
      } catch (fileError) {
        console.error('Error reading audio file:', fileError);
        return res.status(200).json({
          error: 'Failed to read audio file',
          useBrowserSpeech: true,
          text: text
        });
      }
    } else {
      return res.status(200).json({
        error: 'Speech service did not return an audio file path',
        useBrowserSpeech: true,
        text: text
      });
    }
  } catch (error) {
    console.error('Error generating speech:', error);
    return res.status(200).json({
      error: 'Failed to generate speech',
      useBrowserSpeech: true,
      text: text
    });
  }
}

// Helper functions for webcam recording
export function isRecordingActive(): boolean {
  return appState.recordingWebcam;
}

export function saveWebcamFrame(frameBuffer: Buffer): void {
  if (appState.recordingWebcam && framesDir) {
    try {
      // Save the frame as a JPEG image in the frames directory
      const frameNumber = recordingFrameCount + 1; // 1-based frame numbering
      const frameFile = path.join(framesDir, `frame-${frameNumber}.jpg`);

      // Write the frame to a file
      fs.writeFileSync(frameFile, frameBuffer);

      // Update frame count and timestamp
      recordingFrameCount = frameNumber;
      lastFrameTime = Date.now();
    } catch (error) {
      console.error('Error saving webcam frame:', error);
    }
  }
}

// Function to handle audio data during recording
export function saveAudioData(audioBase64: string): void {
  // Currently not used - we'll process audio in a future update
  console.log('Received audio data chunk');
}

export default router;