import { WatsonXAI } from '@ibm-cloud/watsonx-ai';

interface Message {
  role: string;
  content: string;
}

interface AIConfig {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

/**
 * Service for interacting with WatsonX AI
 */
export class WatsonxService {
  private watsonxAIService: WatsonXAI;
  private chatHistory: Message[];
  private projectId: string | undefined;
  private spaceId: string | undefined;
  private serviceUrl: string;

  constructor() {
    this.chatHistory = [];
    this.projectId = process.env.WATSONX_AI_PROJECT_ID;
    this.spaceId = this.projectId ? undefined : process.env.WATSONX_AI_SPACE_ID;
    this.serviceUrl = process.env.WATSONX_AI_SERVICE_URL || 'https://us-south.ml.cloud.ibm.com';

    // Initialize WatsonX AI service
    this.watsonxAIService = WatsonXAI.newInstance({
      version: '2024-05-31',
      serviceUrl: this.serviceUrl,
    });

    // Initialize with system prompt
    this.chatHistory = [
      {
        role: 'system',
        content: 'You are a wise, ancient talking tree with a cheerful personality. Respond to the human in a friendly manner. Keep your responses short and engaging, as you\'re speaking them out loud. Add occasional tree-related puns or references to nature when appropriate.'
      }
    ];

    console.log('WatsonX AI service initialized');
  }

  /**
   * Generate a response using WatsonX Chat
   */
  async generateResponse(prompt: string, config?: AIConfig): Promise<string> {
    try {
      if (!this.projectId && !this.spaceId) {
        throw new Error('WatsonX AI project ID or space ID not configured');
      }

      // Update system prompt if specified
      if (config?.systemPrompt) {
        this.chatHistory[0] = {
          role: 'system',
          content: config.systemPrompt
        };
      }

      // Add the user's message to chat history
      this.chatHistory.push({
        role: 'user',
        content: prompt
      });

      // Keep only the latest 10 messages to prevent context from getting too large
      if (this.chatHistory.length > 10) {
        // Always keep the system message (first one) and remove oldest messages after that
        this.chatHistory = [
          this.chatHistory[0],
          ...this.chatHistory.slice(this.chatHistory.length - 9)
        ];
      }

      console.log('Chat history:', this.chatHistory);

      // Model parameters
      const modelParameters = {
        maxTokens: config?.maxTokens || 200,
        temperature: config?.temperature || 0.7,
      };

      // Generate chat response
      const chatResponse = await this.watsonxAIService.textChat({
        modelId: config?.model || 'mistralai/mistral-large',
        projectId: this.projectId,
        spaceId: this.spaceId,
        messages: this.chatHistory,
        ...modelParameters,
      });

      if (chatResponse.result.choices && chatResponse.result.choices.length > 0) {
        const assistantMessage = chatResponse.result.choices[0].message;
        if (assistantMessage && assistantMessage.content) {
          // Add the assistant's response to chat history
          this.chatHistory.push({
            role: assistantMessage.role || 'assistant',
            content: assistantMessage.content
          });
          console.log('Generated chat response successfully');
          return assistantMessage.content;
        }
      }

      console.error('Unexpected response format:', chatResponse);
      throw new Error('WatsonX AI did not return expected response format');
    } catch (error) {
      console.error('Error generating response with WatsonX AI:', (error as Error)?.message || 'Unknown error');
      
      // Tree-themed error responses
      const errorResponses = [
        "I seem to be having trouble connecting to my wisdom right now. My branches are a bit tangled in thought. Could you try again?",
        "Oh dear, seems my roots can't quite reach the knowledge pool at the moment. But I'm still here and happy to chat!",
        "Looks like there's a bit of digital sap clogging my thinking process. Let me take a moment to recalibrate my leafy thoughts.",
        "My tree brain is experiencing a temporary drought of ideas. Please give me a moment to gather my thoughts from the forest of knowledge.",
        "Even wise old trees like me get stumped sometimes! Let me shake off these digital cobwebs and try again."
      ];
      
      return errorResponses[Math.floor(Math.random() * errorResponses.length)];
    }
  }
}
