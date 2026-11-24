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
  sendDraftForward,
  resendForward,
  recallForward,
  receiveForward,
  getPendingReceiptForwards,
  updateForwardedPermissions,
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
  getMyDocumentCounts,
  searchAndListDocumentsAlphabetical,
  archiveDocument,
  listArchivedDocuments,
} from '../controllers/document.controller.js';
import {
  createReplica,
  listReplicas,
  reviewReplica,
} from '../controllers/document.replica.controller.js';
import { getStickiesByDocument, approveSticky } from '../controllers/document.sticky.controller.js';
import {
  createRemark,
  getRemarksByDocument,
  updateRemark,
  deleteRemark,
} from '../controllers/document.remark.controller.js';
import {
  uploadDocumentFile,
  getDocumentFiles,
  getDocumentFileById,
  getDocumentFileCounts,
  reviewDocumentFile,
  deleteDocumentFile,
} from '../controllers/document.file.controller.js';
import {
  createVirtualSticky,
  getVirtualStickies,
} from '../controllers/virtual.sticky.controller.js';
import { getUserDashboardSummary } from '../controllers/user.controller.js';
import documentSignatureRoutes from './document.signature.routes.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { authorizeRoles } from '../middlewares/role.middleware.js';
import { checkDocumentAccess } from '../middlewares/document.access.middleware.js';
import { checkPermission } from '../middlewares/permission.middleware.js';
import { upload, handleMulterError, autoCleanupOnError } from '../middlewares/upload.middleware.js';

const router = Router();

// All document operations require authentication
router.use(authenticateToken);

// 1. Upload & List
router.post(
  '/',
  authorizeRoles('super_admin', 'department_admin'),
  checkPermission('canUploadDocuments'),
  upload.fields([
    { name: 'files' },
    { name: 'file', maxCount: 1 },
    { name: 'logo', maxCount: 1 },
  ]),
  handleMulterError,
  autoCleanupOnError,
  createDocument
);
router.get('/', authorizeRoles('super_admin', 'ministry_admin'), searchAndListDocuments);

// 2. Document Details & Logs
router.get('/logs', authorizeRoles('super_admin', 'ministry_admin'), getAllDocumentLogs);
router.get('/files/counts', authorizeRoles('super_admin', 'ministry_admin'), getDocumentFileCounts);
router.get('/my-counts', checkPermission('canViewMyFiles'), getMyDocumentCounts);
router.get('/counts', checkPermission('canViewMyFiles'), getMyDocumentCounts);
router.get('/dashboard-summary', getUserDashboardSummary);
router.get('/alphabetical', checkPermission('canSearchFiles'), searchAndListDocumentsAlphabetical);
router.get('/alphabetical-index', checkPermission('canSearchFiles'), searchAndListDocumentsAlphabetical);
router.get('/archived', checkPermission('canViewMyFiles'), listArchivedDocuments);
router.get('/preserved', checkPermission('canViewMyFiles'), listArchivedDocuments);
router.get('/forward/pending-receipt', getPendingReceiptForwards);
router.get('/:id', checkPermission('canViewMyFiles'), checkDocumentAccess('canView'), getDocumentById);
router.get('/:id/logs', checkPermission('canViewMyFiles'), checkDocumentAccess('canView'), getDocumentLogs);
router.post('/:id/logs', checkPermission('canViewMyFiles'), checkDocumentAccess('canView'), createDocumentLog);

// 3. Permissions Management (Pattern B: Handles 500 - 2,000+ users cleanly)
router.patch(
  '/:id/permissions',
  authorizeRoles('super_admin', 'ministry_admin', 'department_admin'),
  checkDocumentAccess('canView'),
  updatePermissions
);
router.get(
  '/:id/permissions',
  authorizeRoles('super_admin', 'ministry_admin', 'department_admin'),
  checkDocumentAccess('canView'),
  listDocumentPermissions
);
router.post(
  '/:id/permissions/grant',
  authorizeRoles('super_admin', 'ministry_admin', 'department_admin'),
  checkDocumentAccess('canView'),
  grantDocumentPermissions
);
router.delete(
  '/:id/permissions/:userId',
  authorizeRoles('super_admin', 'ministry_admin', 'department_admin'),
  checkDocumentAccess('canView'),
  revokeDocumentPermission
);

// 4. Department / User Forwarding & Custody Lifecycle
router.post(
  '/:id/forward',
  authorizeRoles('super_admin', 'ministry_admin', 'department_admin'),
  checkDocumentAccess('canView'),
  forwardDocument
);
router.post(
  '/:id/forward/:forwardId/send',
  authorizeRoles('super_admin', 'ministry_admin', 'department_admin'),
  checkDocumentAccess('canView'),
  sendDraftForward
);
router.post(
  '/:id/forward/:forwardId/resend',
  authorizeRoles('super_admin', 'ministry_admin', 'department_admin'),
  checkDocumentAccess('canView'),
  resendForward
);
router.post(
  '/:id/forward/:forwardId/recall',
  authorizeRoles('super_admin', 'ministry_admin', 'department_admin'),
  checkDocumentAccess('canView'),
  recallForward
);
router.post(
  '/:id/forward/:forwardId/receive',
  receiveForward
);
router.patch(
  '/:id/forwarded-permissions/:departmentId',
  authorizeRoles('super_admin', 'ministry_admin', 'department_admin'),
  checkDocumentAccess('canView'),
  updateForwardedPermissions
);

// 5. Interactive Collaboration: Remarks, Stickies & Notings
router.post('/:id/remarks', checkPermission('canAddRemarks'), checkDocumentAccess('canRemark'), createRemark);
router.get('/:id/remarks', checkPermission('canViewMyFiles'), checkDocumentAccess('canView'), getRemarksByDocument);
router.patch('/:id/remarks/:remarkId', checkPermission('canAddRemarks'), checkDocumentAccess('canRemark'), updateRemark);
router.delete('/:id/remarks/:remarkId', checkPermission('canAddRemarks'), checkDocumentAccess('canRemark'), deleteRemark);
router.post('/:id/stickies', checkPermission('canUseStickyNotes'), checkDocumentAccess('canView'), addSticky);
router.get('/:id/stickies', checkPermission('canViewMyFiles'), checkDocumentAccess('canView'), getStickiesByDocument);
router.patch('/:id/stickies/:stickyId/approve', checkDocumentAccess('canView'), approveSticky);
router.post('/:id/notings', checkPermission('canAddOfficialNoting'), checkDocumentAccess('canView'), addNoting);
router.patch(
  '/:id/notings/:notingId/approve',
  authorizeRoles('super_admin', 'ministry_admin', 'department_admin'),
  checkPermission('canApproveNoting'),
  checkDocumentAccess('canView'),
  approveNoting
);

// 5.5 Digital Signatures (OTP email verification & Admin review)
router.use('/:id/signatures', documentSignatureRoutes);

// 5.6 Attached Document Files
router.post(
  '/:id/files',
  checkPermission('canUploadDocuments'),
  checkDocumentAccess('canView'),
  upload.single('file'),
  handleMulterError,
  autoCleanupOnError,
  uploadDocumentFile
);
router.get('/:id/files', checkPermission('canViewMyFiles'), checkDocumentAccess('canView'), getDocumentFiles);
router.get('/:id/files/:fileId', checkPermission('canViewMyFiles'), checkDocumentAccess('canView'), getDocumentFileById);
router.patch(
  '/:id/files/:fileId/review',
  authorizeRoles('super_admin', 'ministry_admin', 'department_admin'),
  checkPermission('canViewApprovals'),
  checkDocumentAccess('canView'),
  reviewDocumentFile
);
router.delete('/:id/files/:fileId', checkDocumentAccess('canView'), deleteDocumentFile);

// 5.7 Personal Virtual Sticky Notes
router.post('/:id/virtual-stickies', checkDocumentAccess('canView'), createVirtualSticky);
router.get('/:id/virtual-stickies', checkDocumentAccess('canView'), getVirtualStickies);

// 6. Replicas / Suggested Changes
router.post(
  '/:id/replicas',
  checkPermission('canCreateReplica'),
  checkDocumentAccess('canSuggestChange'),
  upload.single('file'),
  handleMulterError,
  autoCleanupOnError,
  createReplica
);
router.get('/:id/replicas', checkPermission('canViewMyFiles'), checkDocumentAccess('canView'), listReplicas);
router.patch(
  '/replicas/:replicaId/review',
  authorizeRoles('super_admin', 'ministry_admin', 'department_admin'),
  checkPermission('canViewApprovals'),
  reviewReplica
);

// 7. Deletions, Retention & Withdrawals
router.patch('/:id/withdraw', checkPermission('canWithdrawFile'), checkDocumentAccess('canView'), withdrawFile);
router.patch('/:id/archive', checkDocumentAccess('canView'), archiveDocument);
router.patch('/:id/preserve', checkDocumentAccess('canView'), archiveDocument);
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
