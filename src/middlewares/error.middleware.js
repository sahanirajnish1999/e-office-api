import { cleanupUploadedFiles } from './upload.middleware.js';

export const notFoundHandler = (req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};

export const errorHandler = (err, req, res, next) => {
  cleanupUploadedFiles(req);
  console.error('Unhandled Error:', err);

  // Handle MongoDB duplicate key errors (e.g. unique email or phone)
  if (err?.code === 11000) {
    const duplicateField = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'field';
    return res.status(409).json({
      success: false,
      message: `A user with this ${duplicateField} already exists`,
    });
  }

  // Handle Mongoose schema validation errors
  if (err?.name === 'ValidationError') {
    const firstError = Object.values(err.errors || {})[0];
    return res.status(400).json({
      success: false,
      message: firstError?.message || err.message || 'Validation failed',
    });
  }

  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
};
