import { Router } from 'express';
import {
  getProfile,
  listUsers,
  getUserCounts,
  updateLastActiveTime,
  createDepartmentAdmin,
  createMinistryAdmin,
  superAdminUpdatePermissions,
  deptAdminUpdatePermissions,
  getUserDashboardSummary,
} from '../controllers/user.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { authorizeRoles } from '../middlewares/role.middleware.js';
import { checkPermission } from '../middlewares/permission.middleware.js';

const router = Router();

router.use(authenticateToken);

// Super admin creates ministry admins
router.post('/ministry-admins', authorizeRoles('super_admin'), createMinistryAdmin);

// Super admin and Ministry Admin create department admins
router.post('/department-admins', authorizeRoles('super_admin', 'ministry_admin'), createDepartmentAdmin);

// Super admin and Ministry Admin: update user's permissions
router.post('/:userId/permissions', authorizeRoles('super_admin', 'ministry_admin'), superAdminUpdatePermissions);

// Department admin: update own department employee's permissions
router.post('/department/:userId/permissions', authorizeRoles('department_admin'), deptAdminUpdatePermissions);

// Profile and user queries
router.get('/profile', checkPermission('canViewProfile'), getProfile);
router.get('/dashboard-summary', getUserDashboardSummary);
router.post('/last-active', updateLastActiveTime);
router.get('/counts', authorizeRoles('super_admin', 'ministry_admin'), getUserCounts);
router.get('/', authorizeRoles('super_admin', 'ministry_admin'), listUsers);

export default router;
