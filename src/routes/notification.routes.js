import { Router } from 'express';
import {
  getMyNotifications,
  getNotificationCounts,
  listNotifications,
  createNotification,
  getNotificationById,
  markAsRead,
  markAllAsRead,
  updateNotification,
  deleteNotification,
} from '../controllers/notification.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { checkPermission } from '../middlewares/permission.middleware.js';

const router = Router();

// All notification operations require authentication
router.use(authenticateToken);

// 1. User Notification Feed (Global Broadcasts + Notifications Targeted to Him)
router.get('/my', checkPermission('canViewNotifications'), getMyNotifications);

// 2. Specific Counts API: total, global, specific user, self, unread (Admin Desk Only)
router.get('/counts', checkPermission('canViewNotifications'), getNotificationCounts);

// 3. Mark all notifications as read (All Users)
router.patch('/mark-all-read', checkPermission('canViewNotifications'), markAllAsRead);

// 4. Administrative Paginated List of Notifications (Admin Desk Only)
router.get('/', checkPermission('canViewNotifications'), listNotifications);

// 5. Create notification / broadcast / reminder
router.post('/', checkPermission('canManageReminders'), createNotification);

// 6. Get notification details by ID
router.get('/:id', checkPermission('canViewNotifications'), getNotificationById);

// 7. Mark single notification as read
router.patch('/:id/read', checkPermission('canViewNotifications'), markAsRead);

// 8. Update notification (Super Admin can edit any; other users can edit own self notifications)
router.patch('/:id', checkPermission('canManageReminders'), updateNotification);

// 9. Delete / dismiss notification (Super Admin can delete any; other users can delete own self notifications)
router.delete('/:id', checkPermission('canManageReminders'), deleteNotification);

export default router;
