require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const connectDB = require('./src/config/db');
const setupSocket = require('./src/socket');

const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/users');
const chatRoutes = require('./src/routes/chats');
const mediaRoutes = require('./src/routes/media');
const keyRoutes = require('./src/routes/keys');
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
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Middleware
app.use(cors());
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/keys', keyRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', app: 'AkonaChat' }));

// Socket.IO
setupSocket(io);

// Start
const PORT = process.env.PORT || 9000;
connectDB().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`AkonaChat backend running on port ${PORT}`);
  });
});
