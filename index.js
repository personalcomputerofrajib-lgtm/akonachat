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

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Middleware
app.use(cors());
app.use(helmet());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chats', chatRoutes);

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
