import { Router } from 'express';
import {
  createDepartment,
  listDepartments,
  getDepartmentById,
  updateDepartment,
  deleteDepartment,
} from '../controllers/department.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { authorizeRoles } from '../middlewares/role.middleware.js';

const router = Router();

// All department endpoints require authentication
router.use(authenticateToken);

// All department endpoints are restricted strictly to Super Admin
router.post('/', authorizeRoles('super_admin'), createDepartment);
router.put('/:id', authorizeRoles('super_admin'), updateDepartment);
router.delete('/:id', authorizeRoles('super_admin'), deleteDepartment);
router.get('/', authorizeRoles('super_admin'), listDepartments);
router.get('/:id', authorizeRoles('super_admin'), getDepartmentById);

export default router;
