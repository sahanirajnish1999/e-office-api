import { Router } from 'express';
import {
  createDepartment,
  listDepartments,
  getDepartmentById,
  updateDepartment,
  deleteDepartment,
  assignMinistryToDepartment,
} from '../controllers/department.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { authorizeRoles } from '../middlewares/role.middleware.js';

const router = Router();

// All department endpoints require authentication
router.use(authenticateToken);

// Super Admin and Ministry Admin endpoints
router.post('/', authorizeRoles('super_admin', 'ministry_admin'), createDepartment);
router.get('/', authorizeRoles('super_admin', 'ministry_admin'), listDepartments);
router.get('/:id', authorizeRoles('super_admin', 'ministry_admin'), getDepartmentById);
router.put('/:id', authorizeRoles('super_admin', 'ministry_admin'), updateDepartment);
router.patch('/:id/ministry', authorizeRoles('super_admin', 'ministry_admin'), assignMinistryToDepartment);

// Super Admin only endpoints
router.delete('/:id', authorizeRoles('super_admin'), deleteDepartment);

export default router;
