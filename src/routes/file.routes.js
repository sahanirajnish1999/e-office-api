import { Router } from 'express';
import { uploadSingleFile, listFiles } from '../controllers/file.controller.js';
import { upload, handleMulterError } from '../middlewares/upload.middleware.js';

const router = Router();

router.post('/upload', upload.single('file'), handleMulterError, uploadSingleFile);
router.get('/', listFiles);

export default router;
