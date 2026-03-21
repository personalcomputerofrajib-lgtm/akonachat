require('dotenv').config();

// ✅ VALIDATE ENVIRONMENT VARIABLES
const requiredEnvVars = [
  'MONGO_URI',
  'JWT_SECRET',
  'GOOGLE_CLIENT_ID'
  // REDIS_URL is optional as it has a default
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('❌ FATAL: Missing required environment variables:');
  missingEnvVars.forEach(varName => {
    console.error(`   - ${varName}`);
  });
  console.error('\nPlease add these variables to your .env file');
  process.exit(1);
}

console.log('✅ All required environment variables are set');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const connectDB = require('./src/config/db');
const setupSocket = require('./src/socket');

const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/users');
const chatRoutes = require('./src/routes/chats');
const mediaRoutes = require('./src/routes/media');
const keyRoutes = require('./src/routes/keys');
const engagementRoutes = require('./src/routes/engagement');
const momentRoutes = require('./src/routes/moments');
const path = require('path');
const cron = require('node-cron');
const fs = require('fs');

// Cleanup Job: Deletes files in /uploads older than 7 days
cron.schedule('0 0 * * *', () => {
  const uploadDir = path.join(__dirname, 'uploads');
  const now = Date.now();
  const weekInMs = 7 * 24 * 60 * 60 * 1000;

  fs.readdir(uploadDir, (err, files) => {
    if (err) return console.error('[Cleanup] Error:', err);
    
    files.forEach(file => {
      const filePath = path.join(uploadDir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        if (now - stats.mtimeMs > weekInMs) {
          fs.unlink(filePath, (err) => {
            if (!err) console.log(`[Cleanup] Deleted: ${file}`);
          });
        }
      });
    });
  });
});

const app = express();
const server = http.createServer(app);

// ✅ SECURITY CONFIG
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000', 'http://localhost:5173'];

const io = new Server(server, {
  cors: { 
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'] 
  },
});

// Global Rate Limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: 'Too many requests from this IP, please try again after 15 minutes',
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://lh3.googleusercontent.com/", process.env.ALLOWED_ORIGINS || "*"],
      connectSrc: ["'self'", "https://accounts.google.com"],
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json({ limit: '10kb' })); // Limit body size to prevent DoS
app.use(mongoSanitize()); // Prevent NoSQL injection
app.use('/api/', apiLimiter); // Apply rate limiter to all api routes

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/keys', keyRoutes);
app.use('/api/engagement', engagementRoutes);
app.use('/api/moments', momentRoutes);

// Serving Static Assets (Banners, Sticker Icons)
app.use('/static', express.static(path.join(__dirname, 'static')));

// Healthcheck
app.get('/api/health', (req, res) => {
  const mongoose = require('mongoose');
  const dbStatus = mongoose.connection.readyState === 1 ? 'up' : 'down';
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date(),
    checks: {
      database: dbStatus,
    }
  });
});

// Socket.IO
setupSocket(io);

// Start
const PORT = process.env.PORT || 9000;
connectDB().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`AkonaChat backend running on port ${PORT}`);
  });
});
