import { Router } from 'express';
import {
  requestSignature,
  verifySignatureOtp,
  reviewSignature,
  getDocumentSignatures,
} from '../controllers/document.signature.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { authorizeRoles } from '../middlewares/role.middleware.js';
import { checkDocumentAccess } from '../middlewares/document.access.middleware.js';

const router = Router({ mergeParams: true });

// All signature operations require authentication
router.use(authenticateToken);

// 1. Request digital signature (records IP/device, generates & emails 6-digit OTP)
router.post('/request', checkDocumentAccess('canView'), requestSignature);

// 2. Verify OTP for digital signature
router.post('/:sigId/verify-otp', checkDocumentAccess('canView'), verifySignatureOtp);

// 3. Admin review: approve or reject verified signature
router.patch(
  '/:sigId/review',
  authorizeRoles('super_admin', 'department_admin'),
  checkDocumentAccess('canView'),
  reviewSignature
);

// 4. List all signatures for this document
router.get('/', checkDocumentAccess('canView'), getDocumentSignatures);

export default router;
