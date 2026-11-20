import { Router } from 'express';
import {
  createDocument,
  searchAndListDocuments,
  getDocumentById,
  updatePermissions,
  listDocumentPermissions,
  grantDocumentPermissions,
  revokeDocumentPermission,
  forwardDocument,
  updateForwardedPermissions,
  addRemark,
  addSticky,
  addNoting,
  approveNoting,
  withdrawFile,
  employeeSelfDelete,
  departmentDelete,
  permanentDelete,
  getDocumentLogs,
  getAllDocumentLogs,
  createDocumentLog,
} from '../controllers/document.controller.js';
import {
  createReplica,
  listReplicas,
  reviewReplica,
} from '../controllers/document.replica.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { authorizeRoles } from '../middlewares/role.middleware.js';
import { checkDocumentAccess } from '../middlewares/document.access.middleware.js';
import { checkPermission } from '../middlewares/permission.middleware.js';
import { upload, handleMulterError } from '../middlewares/upload.middleware.js';

const router = Router();

// All document operations require authentication
router.use(authenticateToken);

// 1. Upload & List
router.post(
  '/',
  authorizeRoles('super_admin', 'department_admin'),
  checkPermission('canUploadDocuments'),
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'logo', maxCount: 1 },
  ]),
  handleMulterError,
  createDocument
);
router.get('/', checkPermission('canSearchFiles'), searchAndListDocuments);

// 2. Document Details & Logs
router.get('/logs', authorizeRoles('super_admin'), getAllDocumentLogs);
router.get('/:id', checkPermission('canViewMyFiles'), checkDocumentAccess('canView'), getDocumentById);
router.get('/:id/logs', checkPermission('canViewMyFiles'), checkDocumentAccess('canView'), getDocumentLogs);
router.post('/:id/logs', checkPermission('canViewMyFiles'), checkDocumentAccess('canView'), createDocumentLog);

// 3. Permissions Management (Pattern B: Handles 500 - 2,000+ users cleanly)
router.patch(
  '/:id/permissions',
  authorizeRoles('super_admin', 'department_admin'),
  checkDocumentAccess('canView'),
  updatePermissions
);
router.get(
  '/:id/permissions',
  authorizeRoles('super_admin', 'department_admin'),
  checkDocumentAccess('canView'),
  listDocumentPermissions
);
router.post(
  '/:id/permissions/grant',
  authorizeRoles('super_admin', 'department_admin'),
  checkDocumentAccess('canView'),
  grantDocumentPermissions
);
router.delete(
  '/:id/permissions/:userId',
  authorizeRoles('super_admin', 'department_admin'),
  checkDocumentAccess('canView'),
  revokeDocumentPermission
);

// 4. Department Forwarding
router.post(
  '/:id/forward',
  authorizeRoles('super_admin', 'department_admin'),
  checkDocumentAccess('canView'),
  forwardDocument
);
router.patch(
  '/:id/forwarded-permissions/:departmentId',
  authorizeRoles('super_admin', 'department_admin'),
  checkDocumentAccess('canView'),
  updateForwardedPermissions
);

// 5. Interactive Collaboration: Remarks, Stickies & Notings
router.post('/:id/remarks', checkPermission('canAddRemarks'), checkDocumentAccess('canRemark'), addRemark);
router.post('/:id/stickies', checkPermission('canUseStickyNotes'), checkDocumentAccess('canView'), addSticky);
router.post('/:id/notings', checkPermission('canAddOfficialNoting'), checkDocumentAccess('canView'), addNoting);
router.patch(
  '/:id/notings/:notingId/approve',
  authorizeRoles('super_admin', 'department_admin'),
  checkPermission('canApproveNoting'),
  checkDocumentAccess('canView'),
  approveNoting
);

// 6. Replicas / Suggested Changes
router.post(
  '/:id/replicas',
  checkPermission('canCreateReplica'),
  checkDocumentAccess('canSuggestChange'),
  upload.single('file'),
  handleMulterError,
  createReplica
);
router.get('/:id/replicas', checkPermission('canViewMyFiles'), checkDocumentAccess('canView'), listReplicas);
router.patch(
  '/replicas/:replicaId/review',
  authorizeRoles('super_admin', 'department_admin'),
  checkPermission('canViewApprovals'),
  reviewReplica
);

// 7. Deletions & Withdrawals
router.patch('/:id/withdraw', checkPermission('canWithdrawFile'), checkDocumentAccess('canView'), withdrawFile);
router.delete('/:id/my-access', checkPermission('canDeletePartial'), checkDocumentAccess('canView'), employeeSelfDelete);
router.delete(
  '/:id/department',
  authorizeRoles('super_admin', 'department_admin'),
  checkPermission('canDeletePartial'),
  checkDocumentAccess('canView'),
  departmentDelete
);
router.delete('/:id/permanent', authorizeRoles('super_admin'), checkPermission('canDeletePermanent'), permanentDelete);

export default router;
