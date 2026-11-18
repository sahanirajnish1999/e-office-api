import fs from 'node:fs';
import path from 'node:path';
import { appConfig } from '../config/app.config.js';

/**
 * Moves an uploaded file from the root uploads directory into an organized document folder:
 * uploads/uploaded-files/<documentId>/<subfolder>/<filename>
 *
 * @param {string} tempFilePath - Original file path on disk (from multer)
 * @param {string|import('mongoose').Types.ObjectId} documentId - Document ID
 * @param {'files'|'logo'|'replica'} subfolder - Target subfolder
 * @returns {{ destPath: string, filename: string, fileUrl: string } | null}
 */
export const moveToDocumentFolder = (tempFilePath, documentId, subfolder) => {
  if (!tempFilePath || !fs.existsSync(tempFilePath)) {
    return null;
  }

  const baseUploadDir = path.resolve(process.cwd(), appConfig.uploadDir || 'uploads');
  const targetDir = path.join(baseUploadDir, 'uploaded-files', documentId.toString(), subfolder);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const filename = path.basename(tempFilePath);
  const destPath = path.join(targetDir, filename);

  fs.renameSync(tempFilePath, destPath);

  const fileUrl = `/uploads/uploaded-files/${documentId.toString()}/${subfolder}/${filename}`;

  return {
    destPath,
    filename,
    fileUrl,
  };
};

/**
 * Permanently removes the entire document folder:
 * uploads/uploaded-files/<documentId>/
 *
 * @param {string|import('mongoose').Types.ObjectId} documentId
 */
export const removeDocumentFolder = (documentId) => {
  if (!documentId) return;
  const baseUploadDir = path.resolve(process.cwd(), appConfig.uploadDir || 'uploads');
  const docFolder = path.join(baseUploadDir, 'uploaded-files', documentId.toString());

  if (fs.existsSync(docFolder)) {
    try {
      fs.rmSync(docFolder, { recursive: true, force: true });
    } catch (err) {
      console.warn(`Warning deleting document folder ${documentId}:`, err.message);
    }
  }
};
