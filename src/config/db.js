const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    console.log('[DB] Attempting to connect to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      connectTimeoutMS: 15000,
      serverSelectionTimeoutMS: 15000,
    });
    console.log('✅ [DB] MongoDB connected');
  } catch (err) {
    console.error('❌ [DB] MongoDB connection error:', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
