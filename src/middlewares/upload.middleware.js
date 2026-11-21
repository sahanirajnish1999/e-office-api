import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { appConfig } from '../config/app.config.js';

// Ensure upload directory exists
const uploadDir = path.resolve(process.cwd(), appConfig.uploadDir);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  },
});

const FILE_SIZE_LIMIT_MB = 5;

export const upload = multer({
  storage,
  limits: { fileSize: FILE_SIZE_LIMIT_MB * 1024 * 1024 },
});

/**
 * Clean up all files uploaded by Multer for the current request.
 * Safely handles single file (req.file) or multiple files (req.files array or object).
 */
export const cleanupUploadedFiles = (req) => {
  const files = [];

  if (req.file?.path) {
    files.push(req.file.path);
  }

  if (req.files) {
    if (Array.isArray(req.files)) {
      req.files.forEach((f) => f?.path && files.push(f.path));
    } else if (typeof req.files === 'object') {
      Object.values(req.files).forEach((fieldArray) => {
        if (Array.isArray(fieldArray)) {
          fieldArray.forEach((f) => f?.path && files.push(f.path));
        }
      });
    }
  }

  for (const filePath of files) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.warn(`Failed to cleanup temp file ${filePath}:`, err.message);
    }
  }
};

/**
 * Middleware that watches the response lifecycle.
 * If the API response finishes with an error status (>= 400),
 * or if the client connection closes/aborts before finishing (e.g. POST /api/documents - - ms - -),
 * it automatically deletes all temp uploaded files from disk.
 */
export const autoCleanupOnError = (req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode >= 400) {
      cleanupUploadedFiles(req);
    }
  });

  res.on('close', () => {
    if (!res.writableEnded) {
      cleanupUploadedFiles(req);
    }
  });

  next();
};

/**
 * Multer error handler middleware.
 * If Multer encounters an error, it deletes any uploaded files and returns clean JSON.
 */
export const handleMulterError = (err, req, res, next) => {
  // Delete any uploaded files on Multer error
  cleanupUploadedFiles(req);

  if (err instanceof multer.MulterError) {
    const fieldName = err.field || 'file';

    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(413).json({
          success: false,
          message: `File '${fieldName}' exceeds the maximum allowed size of ${FILE_SIZE_LIMIT_MB} MB. Please upload a smaller file.`,
          error: {
            code: 'FILE_TOO_LARGE',
            field: fieldName,
            maxSizeBytes: FILE_SIZE_LIMIT_MB * 1024 * 1024,
            maxSizeMB: FILE_SIZE_LIMIT_MB,
          },
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          success: false,
          message: `Too many files uploaded for field '${fieldName}'. Only 1 file per field is allowed.`,
          error: { code: 'TOO_MANY_FILES', field: fieldName },
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          success: false,
          message: `Unexpected file field '${fieldName}'. Allowed fields: 'file' (document) and 'logo' (optional image).`,
          error: { code: 'UNEXPECTED_FIELD', field: fieldName },
        });
      default:
        return res.status(400).json({
          success: false,
          message: `File upload error: ${err.message}`,
          error: { code: err.code, field: fieldName },
        });
    }
  }

  // Non-Multer errors pass through to the global error handler
  next(err);
};
