import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import OpenAI from 'openai';

// Cache directory for audio files
const CACHE_DIR = path.join(__dirname, '..', '..', 'cache');

// Create cache directory if it doesn't exist
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Service for text-to-speech using Microsoft Cognitive Services or OpenAI TTS
 */
export class SpeechService {
  private speechConfig?: sdk.SpeechConfig;
  private openai?: OpenAI;
  private useOpenAI: boolean = false;

  constructor() {
    // Initialize OpenAI if API key is available
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (openaiApiKey) {
      try {
        this.openai = new OpenAI({
          apiKey: openaiApiKey
        });
        this.useOpenAI = true;
        console.log('OpenAI TTS service initialized successfully');
      } catch (error) {
        console.error('Error initializing OpenAI TTS service:', error);
        this.openai = undefined;
        this.useOpenAI = false;
      }
    }

    // Initialize Microsoft Speech configuration if OpenAI not available
    if (!this.useOpenAI) {
      const speechKey = process.env.SPEECH_KEY;
      const speechRegion = process.env.SPEECH_REGION;

      if (!speechKey || !speechRegion) {
        console.warn('Speech SDK not properly configured. Speech functionality will be limited.');
      } else {
        try {
          // Log the key length and region for debugging (don't log the actual key)
          console.log(`Speech key length: ${speechKey.length}, Speech region: ${speechRegion}`);
          
          // Create a clean new speech config
          this.speechConfig = sdk.SpeechConfig.fromSubscription(speechKey, speechRegion);
          
          // Configure the voice for a nature-like, wise tree character
          // Using JennyNeural which has a warm, friendly voice that's good for a tree character
          this.speechConfig.speechSynthesisVoiceName = 'en-US-JennyNeural';
          
          // Set output format to MP3 (which has better browser compatibility)
          this.speechConfig.speechSynthesisOutputFormat = 
            sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;
            
          console.log('Microsoft Speech service initialized successfully');
        } catch (error) {
          console.error('Error initializing Microsoft Speech service:', error);
          this.speechConfig = undefined;
        }
      }
    }
  }

  /**
   * Generate speech from text and return the audio file path
   */
  async textToSpeech(text: string, customHash?: string): Promise<{ success: boolean; audioPath?: string; error?: string }> {
    try {
      // Use provided hash or create one
      const hash = customHash || crypto.createHash('md5').update(text).digest('hex');
      
      // Use MP3 format to ensure compatibility
      const audioFilePath = path.join(CACHE_DIR, `${hash}.mp3`);
      
      // Check if we already have this audio cached
      if (fs.existsSync(audioFilePath)) {
        return {
          success: true,
          audioPath: audioFilePath
        };
      }
      
      // Process with OpenAI if available
      if (this.useOpenAI && this.openai) {
        try {
          console.log(`Generating OpenAI speech for text: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`);
          
          // Tree-specific voice instructions
          const instructions = `Affect: A gentle, wise narrator with a warm and friendly tone, like a magical talking tree with ancient wisdom.
Tone: Magical, warm, and inviting, creating a sense of wonder and peace for listeners.
Pacing: Steady and measured, with slight pauses to emphasize magical moments and wisdom.
Emotion: Wonder, curiosity, and gentle wisdom, with a lighthearted and positive vibe throughout.
Pronunciation: Clear and precise, with a slightly earthy, resonant quality to evoke the sense of an ancient, talking tree.`;

//           const instructions = `Delivery: Exaggerated and theatrical, with dramatic pauses, sudden outbursts, and gleeful cackling.

// Voice: High-energy, eccentric, and slightly unhinged, with a manic enthusiasm that rises and falls unpredictably.

// Tone: Excited, chaotic, and grandiose, as if reveling in the brilliance of a mad experiment.

// Pronunciation: Sharp and expressive, with elongated vowels, sudden inflections, and an emphasis on big words to sound more diabolical.`
          
          // Generate speech using OpenAI
          const response = await this.openai.audio.speech.create({
            model: 'gpt-4o-mini-tts',
            voice: 'ash', // Nova is a warm and natural voice with a slightly resonant quality
            // voice: 'alloy', // Nova is a warm and natural voice with a slightly resonant quality
            input: text,
            instructions,
          });
          
          // Convert the response to a buffer and save it
          const buffer = Buffer.from(await response.arrayBuffer());
          fs.writeFileSync(audioFilePath, buffer);
          
          // Verify the file was created and has content
          if (fs.existsSync(audioFilePath) && fs.statSync(audioFilePath).size > 0) {
            const fileSize = fs.statSync(audioFilePath).size;
            console.log(`Generated OpenAI audio file size: ${fileSize} bytes`);
            return {
              success: true,
              audioPath: audioFilePath
            };
          } else {
            throw new Error('OpenAI speech synthesis succeeded but audio file is missing or empty');
          }
        } catch (openaiError) {
          console.error('OpenAI speech synthesis error:', openaiError);
          // Fall back to Microsoft if OpenAI fails
          if (this.speechConfig) {
            console.log('Falling back to Microsoft Speech Services...');
          } else {
            return {
              success: false,
              error: `OpenAI speech synthesis failed: ${(openaiError as Error).message || 'Unknown error'}`
            };
          }
        }
      }
      
      // Fallback to Microsoft Speech Services if OpenAI isn't available or fails
      if (!this.speechConfig) {
        return {
          success: false,
          error: 'No speech service properly configured'
        };
      }
      
      // Create audio config for file output
      const audioConfig = sdk.AudioConfig.fromAudioFileOutput(audioFilePath);
      
      // Use MP3 format with direct text input to avoid SSML parsing issues
      return new Promise((resolve, reject) => {
        try {
          console.log(`Generating Microsoft speech for text: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`);
          
          // Create a new synthesizer with the config
          const synthesizer = new sdk.SpeechSynthesizer(this.speechConfig!, audioConfig);
          
          synthesizer.speakTextAsync(text, result => {
            if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
              console.log('Microsoft speech synthesis completed successfully');
              synthesizer.close();
              
              // Verify the file was created and has content
              if (fs.existsSync(audioFilePath) && fs.statSync(audioFilePath).size > 0) {
                const fileSize = fs.statSync(audioFilePath).size;
                console.log(`Generated audio file size: ${fileSize} bytes`);
                resolve({
                  success: true,
                  audioPath: audioFilePath
                });
              } else {
                const exists = fs.existsSync(audioFilePath);
                const size = exists ? fs.statSync(audioFilePath).size : 0;
                console.error(`Audio file issue: exists=${exists}, size=${size}`);
                reject({
                  success: false,
                  error: 'Speech synthesis succeeded but audio file is missing or empty'
                });
              }
            } else {
              console.error(`Speech synthesis failed: ${result.errorDetails}`);
              synthesizer.close();
              reject({
                success: false,
                error: `Speech synthesis failed: ${result.errorDetails}`
              });
            }
          }, error => {
            console.error(`Speech synthesis error: ${error}`);
            synthesizer.close();
            reject({
              success: false,
              error: `Speech synthesis error: ${error}`
            });
          });
        } catch (innerError) {
          console.error(`Speech synthesis exception: ${innerError}`);
          reject({
            success: false,
            error: `Speech synthesis exception: ${(innerError as Error).message || 'Unknown error'}`
          });
        }
      });
    } catch (error) {
      return {
        success: false,
        error: `Error in speech synthesis: ${(error as Error).message || 'Unknown error'}`
      };
    }
  }

  /**
   * Check if the speech service is properly configured
   */
  isConfigured(): boolean {
    return this.useOpenAI || !!this.speechConfig;
  }
}
