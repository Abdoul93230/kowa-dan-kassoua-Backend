const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const http = require('http');
const { Server } = require('socket.io');

const connectDB = require('./config/database');
const { connectRedis } = require('./config/redis');
const errorHandler = require('./middleware/errorHandler');

// Load environment variables
dotenv.config();

// Connect to database
connectDB();

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Origines autorisées — liste séparée par des virgules dans FRONTEND_URL
const ALLOWED_ORIGINS = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim());

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(helmet()); // Security headers
app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true
}));
app.use(compression()); // Compress responses
// Journal de chaque requête : utile en dev, coûteux (I/O synchrone) en production
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));
app.use(express.json({ limit: '20mb' })); // Parse JSON - marge pour les avatars encodés
app.use(express.urlencoded({ extended: true, limit: '20mb' })); // Parse URL-encoded

// Make io accessible in routes
app.set('io', io);

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/home', require('./routes/home.routes'));
app.use('/api/products', require('./routes/product.routes'));
app.use('/api/categories', require('./routes/category.routes'));
app.use('/api/favorites', require('./routes/favorite.routes'));
app.use('/api/conversations', require('./routes/conversation.routes'));
app.use('/api/messages', require('./routes/message.routes'));
app.use('/api/reviews', require('./routes/review.routes'));
// TODO: Créer les autres routes
// app.use('/api/users', require('./routes/user.routes'));
// app.use('/api/orders', require('./routes/order.routes'));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Error handler middleware
app.use(errorHandler);

// Configure Socket.io handlers
const setupSocketHandlers = require('./socket/messageHandler');
const socketUtils = setupSocketHandlers(io);

// Make socket utils available globally (optional)
app.set('socketUtils', socketUtils);

// Redis (facultatif, REDIS_URL) : cache partagé + Socket.IO sur plusieurs serveurs.
// Sans Redis, démarrage normal en mode serveur unique.
const enableRedis = async () => {
  const redis = await connectRedis();
  if (!redis) return;
  try {
    const { createAdapter } = require('@socket.io/redis-adapter');
    const pubClient = redis.duplicate();
    const subClient = redis.duplicate();
    pubClient.on('error', () => {});
    subClient.on('error', () => {});
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    console.log('📡 Socket.IO multi-serveurs (adaptateur Redis)');
  } catch (error) {
    console.error('⚠️ Adaptateur Socket.IO Redis non activé:', error.message);
  }
};

// Start server
const PORT = process.env.PORT || 5000;
enableRedis().finally(() => {
  server.listen(PORT, () => {
    console.log(`🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
    console.log(`📡 Socket.IO ready for messaging`);
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.log('UNHANDLED REJECTION! 💥 Shutting down...');
  console.log(err.name, err.message);
  server.close(() => {
    process.exit(1);
  });
});
