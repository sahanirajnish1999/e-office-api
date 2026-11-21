import { Router } from 'express';
import {
  createVirtualSticky,
  getVirtualStickies,
  getVirtualStickyById,
  updateVirtualSticky,
  deleteVirtualSticky,
} from '../controllers/virtual.sticky.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

// All virtual sticky note operations require authentication
router.use(authenticateToken);

// 1. Create personal virtual note
router.post('/', createVirtualSticky);

// 2. Get list of personal virtual notes (optional ?documentId=...)
router.get('/', getVirtualStickies);

// 3. Get single personal virtual note
router.get('/:noteId', getVirtualStickyById);

// 4. Update personal virtual note
router.patch('/:noteId', updateVirtualSticky);

// 5. Delete personal virtual note
router.delete('/:noteId', deleteVirtualSticky);

export default router;
