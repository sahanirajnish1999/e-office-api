import { Router } from 'express';
import {
  createMinistry,
  listMinistries,
  getMinistryById,
  updateMinistry,
  deleteMinistry,
} from '../controllers/ministry.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { authorizeRoles } from '../middlewares/role.middleware.js';

const router = Router();

router.use(authenticateToken);

// 1. Create Ministry (Super Admin only)
router.post('/', authorizeRoles('super_admin'), createMinistry);

// 2. List Ministries (Super Admin and Ministry Admin)
router.get('/', authorizeRoles('super_admin', 'ministry_admin'), listMinistries);

// 3. Get Ministry by ID (Super Admin and Ministry Admin)
router.get('/:id', authorizeRoles('super_admin', 'ministry_admin'), getMinistryById);

// 4. Update Ministry (Super Admin only)
router.put('/:id', authorizeRoles('super_admin'), updateMinistry);

// 5. Delete Ministry (Super Admin only)
router.delete('/:id', authorizeRoles('super_admin'), deleteMinistry);

export default router;
