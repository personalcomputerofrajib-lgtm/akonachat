const jwt = require('jsonwebtoken');
const TokenBlacklist = require('../models/TokenBlacklist');

const auth = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'No token, authorization denied' });

  try {
    // Check if token is blacklisted
    const isBlacklisted = await TokenBlacklist.findOne({ token });
    if (isBlacklisted) {
      return res.status(401).json({ message: 'Token revoked, please log in again' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if account is active/banned
    const User = require('../models/User');
    const user = await User.findById(decoded.userId).select('isActive');
    if (!user || !user.isActive) {
      return res.status(403).json({ message: 'Account is deactivated or banned' });
    }

    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};

module.exports = auth;
