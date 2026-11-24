import { Router } from 'express';
import {
  createDocumentWorkflowStatus,
  listDocumentWorkflowStatuses,
  getDocumentWorkflowStatusById,
  getDocumentStatusHistory,
  updateDocumentWorkflowStatus,
  deleteDocumentWorkflowStatus,
} from '../controllers/document.workflow.status.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

// All status endpoints require authentication
router.use(authenticateToken);

// 1. Create status (enforces document access in controller)
router.post('/', createDocumentWorkflowStatus);

// 2. List statuses with filters and pagination
router.get('/', listDocumentWorkflowStatuses);

// 3. Document status timeline/history
router.get('/document/:documentId', getDocumentStatusHistory);

// 4. Get status by ID
router.get('/:id', getDocumentWorkflowStatusById);

// 5. Update status (restricted to creator or admin)
router.patch('/:id', updateDocumentWorkflowStatus);

// 6. Delete status (restricted to creator or super_admin)
router.delete('/:id', deleteDocumentWorkflowStatus);

export default router;
