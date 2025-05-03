import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { WatsonxService } from '../services/watsonx';
import { SpeechService } from '../services/speechService';

const router = Router();
const watsonxService = new WatsonxService();
const speechService = new SpeechService();

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

// Button press endpoint - adds an event to the event log
router.post('/button', (req, res) => {
  try {
    // Get the button data
    const { button, action } = req.body;
    
    // Default message if none provided
    const message = req.body.message || `Button ${button || 'unknown'} ${action || 'pressed'}`;
    
    // Get the socket.io instance
    const io = req.app.get('socketio');
    
    // Emit the button event to all connected clients
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

export default router;