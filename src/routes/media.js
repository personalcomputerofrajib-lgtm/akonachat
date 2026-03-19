const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');

const router = express.Router();

// Ensure uploads directory exists
const fs = require('fs');
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) return cb(null, true);
    cb(new Error('Only images (jpeg, jpg, png) are allowed'));
  },
});

// POST /api/media/upload
router.post('/upload', auth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      // A Multer error occurred when uploading (e.g. file too large)
      return res.status(400).json({ error: err.message });
    } else if (err) {
      // An unknown error occurred (e.g. wrong file type from our fileFilter)
      return res.status(400).json({ error: err.message });
    }

    // Everything went fine
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Handle reverse proxy setups correctly if needed, or fallback carefully.
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const url = `${protocol}://${host}/uploads/${req.file.filename}`;
    
    res.json({ url });
  });
});

module.exports = router;
