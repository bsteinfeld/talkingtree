# Talking Tree

An interactive talking tree web application built with Express, TypeScript, WebSockets, and AI services.

## Features

- Interactive animated tree with facial animations
- Text-to-speech using OpenAI's TTS API (with Microsoft Speech Services fallback)
- AI-powered responses using WatsonX AI
- Real-time control through WebSockets
- Responsive web design
- Auto-fallback to browser speech synthesis

## Getting Started

### Prerequisites

- Node.js (v14+)
- npm or yarn
- OpenAI API key (for text-to-speech)
- Microsoft Cognitive Services API key (optional, for fallback speech)
- IBM WatsonX AI access (for AI responses)

### Installation

1. Clone the repository
   ```
   git clone https://github.com/ameliasapps/talkingtree.git
   cd talkingtree
   ```

2. Install dependencies
   ```
   npm install
   ```

3. Create a `.env` file from the example
   ```
   cp .env.example .env
   ```

4. Edit the `.env` file and add your API keys

5. Build the project
   ```
   npm run build
   ```

6. Start the server
   ```
   npm start
   ```

7. Visit `http://localhost:3000` in your browser

## Development

```
npm run dev
```

This starts the application in development mode with hot reloading.

## Usage

The application has three main pages:

1. **Main Page (`/`)**: Interactive tree that responds to your text input
2. **Control Panel (`/control`)**: Control the tree's eye movements and speech
3. **Manual Mode (`/manual`)**: Display-only mode that can be controlled remotely

## Project Structure

```
talkingtree/
├── src/                 # Source files
│   ├── config/          # Configuration 
│   ├── middleware/      # Express middleware
│   ├── routes/          # API routes
│   ├── services/        # Service integrations (speech, AI)
│   └── public/          # Static web files
├── dist/                # Compiled JavaScript
├── cache/               # Audio file cache
└── logs/                # Application logs
```

## Environment Variables

- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment (development/production)
- `OPENAI_API_KEY`: OpenAI API key for text-to-speech
- `SPEECH_KEY`: Microsoft Speech Services API key (fallback)
- `SPEECH_REGION`: Microsoft Speech Services region (fallback)
- `WATSONX_AI_PROJECT_ID`: IBM WatsonX AI project ID
- `WATSONX_AI_SPACE_ID`: IBM WatsonX AI space ID (alternative to project ID)
- `WATSONX_AI_SERVICE_URL`: IBM WatsonX AI service URL

## License

This project is licensed under the MIT License - see the LICENSE file for details.