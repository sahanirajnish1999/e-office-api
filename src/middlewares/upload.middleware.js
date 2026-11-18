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
 * Multer error handler middleware.
 * Place immediately after upload.fields() / upload.single() in the route chain
 * to return clean, user-friendly JSON responses for upload errors.
 */
export const handleMulterError = (err, req, res, next) => {
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
