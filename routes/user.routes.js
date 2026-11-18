import { Router } from 'express';
import {
  getProfile,
  listUsers,
  getUserCounts,
  updateLastActiveTime,
  createDepartmentAdmin,
  superAdminUpdatePermissions,
  deptAdminUpdatePermissions,
} from '../controllers/user.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { authorizeRoles } from '../middlewares/role.middleware.js';
import { checkPermission } from '../middlewares/permission.middleware.js';

const router = Router();

router.use(authenticateToken);

// Super admin creates department admins
router.post('/department-admins', authorizeRoles('super_admin'), createDepartmentAdmin);

// Super admin: update any user's permissions
router.post('/:userId/permissions', authorizeRoles('super_admin'), superAdminUpdatePermissions);

// Department admin: update own department employee's permissions
router.post('/department/:userId/permissions', authorizeRoles('department_admin'), deptAdminUpdatePermissions);

// Profile and user queries
router.get('/profile', checkPermission('canViewProfile'), getProfile);
router.post('/last-active', updateLastActiveTime);
router.get('/counts', authorizeRoles('super_admin'), getUserCounts);
router.get('/', authorizeRoles('super_admin'), listUsers);

export default router;
