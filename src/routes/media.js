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
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp|gif|mpeg|mp3/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    console.log(`[Media] Uploading: ${file.originalname}, Mimetype: ${file.mimetype}`);
    
    if (extname && mimetype) return cb(null, true);
    cb(new Error(`File type not supported. Both extension and mimetype must match JPEG, PNG, WEBP, GIF or MP3.`));
  },
});

const AuditLog = require('../models/AuditLog');

const verifyMagicBytes = (filePath) => {
  try {
    const buffer = Buffer.alloc(8);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, 8, 0);
    fs.closeSync(fd);

    const hex = buffer.toString('hex').toUpperCase();
    
    // JPEG: FF D8 FF
    if (hex.startsWith('FFD8FF')) return true;
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (hex.startsWith('89504E470D0A1A0A')) return true;
    // GIF: 47 49 46 38
    if (hex.startsWith('47494638')) return true;
    // WEBP: RIFF .... WEBP
    if (hex.startsWith('52494646') && hex.includes('57454250', 8)) return true;
    // MP3: ID3 (49 44 33) or Frame Sync (FF FB / FF F3)
    if (hex.startsWith('494433') || hex.startsWith('FFFB') || hex.startsWith('FFF3')) return true;

    return false;
  } catch (e) {
    return false;
  }
};

// GET /api/media/download/:filename
router.get('/download/:filename', auth, (req, res) => {
  const fileName = req.params.filename;
  const filePath = path.join(uploadDir, fileName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.sendFile(filePath);
});

// POST /api/media/upload
router.post('/upload', auth, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // MAGIC BYTE VERIFICATION
    if (!verifyMagicBytes(req.file.path)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Malicious or invalid file content detected.' });
    }

    // AUDIT LOG
    await AuditLog.create({
      userId: req.user.userId,
      action: 'FILE_UPLOAD',
      details: { filename: req.file.originalname, size: req.file.size },
      ip: req.ip,
      userAgent: req.headers['user-agent']
    }).catch(e => console.error('Audit Log failed:', e.message));

    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const url = `${protocol}://${host}/api/media/download/${req.file.filename}`;
    
    res.json({ url });
  });
});

module.exports = router;
