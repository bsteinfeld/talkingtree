import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
// Workaround for TypeScript issues with socket.io
import SocketIO from 'socket.io';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';
import env from './config/env';

const app = express();
const server = http.createServer(app);

const httpsPort = 3443; // Standard port for HTTPS often differs

let httpsServer;

try {
  // Define paths to the key and certificate files
  // Use path.join for cross-platform compatibility and robustness
  // Assumes certs are in a 'certs' folder *relative to the compiled JS file*
  // Adjust the path ('../certs') if your structure is different
  const keyPath = path.join(__dirname, '../certs/key.pem');
  const certPath = path.join(__dirname, '../certs/cert.pem');

  // Check if files exist before trying to read them
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error('!!! SSL Certificate or Key not found.');
    console.error(`!!! Expected key at: ${keyPath}`);
    console.error(`!!! Expected cert at: ${certPath}`);
    console.error('!!! Please generate them using the OpenSSL command.');
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    // Optionally fall back to HTTP or exit
    throw new Error('Missing SSL certificate files.');
  }

  // Read the key and certificate files
  const options = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };

  // Create the HTTPS server
  httpsServer = https.createServer(options, app);

  

  // Optional: Run HTTP server alongside HTTPS (useful for redirection or testing)
  // const httpServer = http.createServer(app);
  // httpServer.listen(port, () => {
  //   console.log(`   - HTTP Server also running at http://localhost:${port}`);
  // });

} catch (error) {
  console.error('❌ Failed to start HTTPS server:', error);
  // Fallback or exit gracefully
  // Example: Start HTTP only if HTTPS fails
  // console.log('⚠️ Falling back to HTTP only.');
  // const httpServer = http.createServer(app);
  // httpServer.listen(port, () => {
  //    console.log(`   - HTTP Server running at http://localhost:${port}`);
  // });
  process.exit(1); // Exit if HTTPS is essential and failed
}




// @ts-ignore - Ignore TypeScript errors for socket.io
// const io = new SocketIO.Server(server, {
//   cors: {
//     origin: "*", // Allow all origins
//     methods: ["GET", "POST"],
//     credentials: true
//   },
//   transports: ['websocket', 'polling'] // Allow both transport methods
// });

const io = new SocketIO.Server(httpsServer, {
  cors: {
    origin: "*", // Allow all origins
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'] // Allow both transport methods
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'", "*"],
      scriptSrc: ["'self'", "'unsafe-inline'", "*"],
      styleSrc: ["'self'", "'unsafe-inline'", "*"],
      imgSrc: ["'self'", "data:", "blob:", "*"],
      mediaSrc: ["'self'", "data:", "blob:", "*"],
      connectSrc: ["'self'", "ws:", "wss:", "*"],
      workerSrc: ["'self'", "blob:", "*"]
    }
  }
}));

// Enable CORS for all routes with additional options
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Serve audio files from cache directory
app.use('/audio', express.static(path.join(__dirname, '..', 'cache')));

// Socket.IO setup for real-time tree control
// @ts-ignore - Ignore TypeScript errors for socket.io parameters
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  // Handle tree control commands
  // @ts-ignore - Ignore TreeCommand type check
  socket.on('tree-command', (command) => {
    console.log('Tree command received:', command);
    
    // Log the command for debugging
    console.log(`Broadcasting command to all clients: ${JSON.stringify(command)}`);
    
    try {
      // Special handling for speak commands
      if (command.type === 'speak' && command.text) {
        console.log(`Tree speaking command: "${command.text}"`);
        // Convert speak commands to the expected format for the tree clients
        io.emit('speak', { words: command.text });
        // Also send the original command format for backward compatibility
        io.emit('tree-update', command);
      } 
      // Special handling for webcam control commands
      else if (command.type === 'webcam-control') {
        console.log(`Webcam control command: "${command.action}"`);
        // Send webcam control commands to tree clients
        io.emit('tree-update', command);
      }
      // Special handling for webcam refresh
      else if (command.type === 'webcam-refresh') {
        console.log('Webcam refresh command received');
        // Send webcam refresh commands to tree clients
        io.emit('tree-update', command);
      }
      else {
        // Standard command handling for other commands
        io.emit('tree-update', command);
      }
      
      // Send confirmation back to sender
      socket.emit('command-received', { success: true, command: command.type });
    } catch (error) {
      console.error('Error broadcasting command:', error);
      socket.emit('command-received', { success: false, error: 'Failed to broadcast command' });
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
  
  // Handle test messages
  socket.on('test-message', (data) => {
    console.log('Test message received:', data);
    socket.emit('test-response', { received: true, timestamp: Date.now() });
  });
  
  // Handle ping messages to keep connections alive
  socket.on('ping', (data) => {
    socket.emit('pong', { timestamp: Date.now() });
  });
  
  // Handle webcam frames
  socket.on('webcam-frame', (data) => {
    console.log('Webcam frame received, broadcasting to all clients');
    // Broadcast the webcam frame to all connected clients
    io.emit('webcam-frame', data);
  });
  
  // Handle tree status updates
  socket.on('tree-status', (data) => {
    console.log('Tree status update received:', data);
    // Broadcast the status update to all clients
    io.emit('tree-status', data);
  });
});

// Make io available to routes
app.set('socketio', io);

// Routes
app.use('/api', routes);

// Serve index.html for the root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Manual mode endpoint - tree controlled remotely
app.get('/manual', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'manual.html'));
});

// Control panel endpoint
app.get('/control', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'control.html'));
});

// Better tree endpoint with PixiJS animation
app.get('/better', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'better.html'));
});

// Error handling
app.use(errorHandler);

// Start the server
server.listen(env.port, () => {
  console.log(`Server is running on port ${env.port} in ${env.nodeEnv} mode`);
  console.log(`Visit the talking tree at http://localhost:${env.port}`);
});




// --- HTTPS Server Setup ---
try {
  // Start listening on the HTTPS port
  httpsServer.listen(httpsPort, () => {
    console.log(`✅ HTTPS Server listening at:`);
    console.log(`   - https://localhost:${httpsPort}`);
    console.log(`   - https://192.168.1.18:${httpsPort}`); // Use your actual IP
  });

} catch (error) {
  console.error('❌ Failed to start HTTPS server:', error);
  // Fallback or exit gracefully
  // Example: Start HTTP only if HTTPS fails
  // console.log('⚠️ Falling back to HTTP only.');
  // const httpServer = http.createServer(app);
  // httpServer.listen(port, () => {
  //    console.log(`   - HTTP Server running at http://localhost:${port}`);
  // });
  process.exit(1); // Exit if HTTPS is essential and failed
}






// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  // Close server & exit process
  server.close(() => process.exit(1));
});

export default app;