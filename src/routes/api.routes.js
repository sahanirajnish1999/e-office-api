import { Router } from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import ministryRoutes from './ministry.routes.js';
import departmentRoutes from './department.routes.js';
import employeeRoutes from './employee.routes.js';
import emailRequestRoutes from './email.request.routes.js';
import documentRoutes from './document.routes.js';
import mailRoutes from './mail.routes.js';
import documentStickyRoutes from './document.sticky.routes.js';
import virtualStickyRoutes from './virtual.sticky.routes.js';
import notificationRoutes from './notification.routes.js';
import documentWorkflowStatusRoutes from './document.workflow.status.routes.js';
import emailTemplateRoutes from './email.template.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/ministries', ministryRoutes);
router.use('/departments', departmentRoutes);
router.use('/employees', employeeRoutes);
router.use('/email-requests', emailRequestRoutes);
router.use('/documents', documentRoutes);
router.use('/document-statuses', documentWorkflowStatusRoutes);
router.use('/stickies', documentStickyRoutes);
router.use('/virtual-stickies', virtualStickyRoutes);
router.use('/notifications', notificationRoutes);
router.use('/mail', mailRoutes);
router.use('/email-templates', emailTemplateRoutes);

export default router;
