import { Router } from 'express';
import {
  createSticky,
  getStickiesByDocument,
  approveSticky,
  deleteSticky,
} from '../controllers/document.sticky.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { checkPermission } from '../middlewares/permission.middleware.js';

const router = Router();

// All sticky operations require authentication
router.use(authenticateToken);

// 1. Create a sticky note
router.post('/', checkPermission('canUseStickyNotes'), createSticky);

// 2. Get stickies for a document
router.get('/document/:documentId', checkPermission('canViewMyFiles'), getStickiesByDocument);

// 3. Approve a sticky note (internal permission check in controller)
router.patch('/:id/approve', approveSticky);

// 4. Delete a sticky note
router.delete('/:id', checkPermission('canUseStickyNotes'), deleteSticky);

export default router;
