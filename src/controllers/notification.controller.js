import mongoose from 'mongoose';
import { Notification } from '../models/notification.model.js';
import { NotificationRead } from '../models/notification.read.model.js';
import { Document } from '../models/document.model.js';
import { User } from '../models/user.model.js';
import { getPaginationParams, formatPaginatedResponse } from '../utils/pagination.util.js';
import { isValidObjectId } from '../utils/validator.util.js';

/**
 * 1. Specific Counts API for Notifications & Broadcast Desk (Super Admin Only)
 * GET /api/notifications/counts
 * Returns: totalNotifications, globalBroadcastNotificationCount, specificUserNotificationCount, selfNotificationCount, unreadTotalCount, readTotalCount
 */
export const getNotificationCounts = async (req, res, next) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only Super Admin has permission to view notification and broadcast desk counts',
      });
    }

    const rawUserId = req.user.id || req.user._id;
    const userId = isValidObjectId(rawUserId) ? new mongoose.Types.ObjectId(rawUserId) : rawUserId;

    // Fetch IDs of notifications already read by this user
    const readNotificationIds = await NotificationRead.distinct('notificationId', { userId });

    const userAccessConditions = [
      { broadcast: 'global' },
      { broadcast: 'self', createdBy: userId },
      { broadcast: 'specific_user', targetUser: userId },
      { createdBy: userId },
    ];

    const [countsResult] = await Notification.aggregate([
      {
        $match: {
          status: { $ne: 'archived' },
          $or: userAccessConditions,
        },
      },
      {
        $facet: {
          total: [{ $count: 'count' }],
          global: [{ $match: { broadcast: 'global' } }, { $count: 'count' }],
          specific: [{ $match: { broadcast: 'specific_user' } }, { $count: 'count' }],
          self: [{ $match: { broadcast: 'self' } }, { $count: 'count' }],
          unread: [
            { $match: { _id: { $nin: readNotificationIds } } },
            { $count: 'count' },
          ],
        },
      },
    ]);

    const totalNotifications = countsResult?.total?.[0]?.count || 0;
    const globalBroadcastNotificationCount = countsResult?.global?.[0]?.count || 0;
    const specificUserNotificationCount = countsResult?.specific?.[0]?.count || 0;
    const selfNotificationCount = countsResult?.self?.[0]?.count || 0;
    const unreadTotalCount = countsResult?.unread?.[0]?.count || 0;
    const readTotalCount = Math.max(0, totalNotifications - unreadTotalCount);

    res.status(200).json({
      success: true,
      data: {
        totalNotifications,
        globalBroadcastNotificationCount,
        specificUserNotificationCount,
        selfNotificationCount,
        unreadTotalCount,
        readTotalCount,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 2. Administrative Paginated List Notifications (Super Admin Only)
 * GET /api/notifications
 */
export const listNotifications = async (req, res, next) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only Super Admin has permission to access the administrative notifications list desk',
      });
    }

    const rawUserId = req.user.id || req.user._id;
    const userId = isValidObjectId(rawUserId) ? new mongoose.Types.ObjectId(rawUserId) : rawUserId;

    const {
      broadcast,
      classification,
      priority,
      status = 'active',
      isRead,
      search,
      dateFrom,
      dateTo,
    } = req.query;

    const matchConditions = {};

    if (status && status !== 'all') {
      matchConditions.status = status;
    }

    if (broadcast) {
      matchConditions.broadcast = broadcast.toLowerCase();
    }

    if (classification) {
      matchConditions.classification = classification;
    }

    if (priority) {
      matchConditions.priority = priority.toLowerCase();
    }

    if (dateFrom || dateTo) {
      matchConditions.notifyDate = {};
      if (dateFrom) matchConditions.notifyDate.$gte = new Date(dateFrom);
      if (dateTo) matchConditions.notifyDate.$lte = new Date(dateTo);
    }

    if (search && typeof search === 'string' && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      matchConditions.$and = matchConditions.$and || [];
      matchConditions.$and.push({
        $or: [
          { title: searchRegex },
          { message: searchRegex },
        ],
      });
    }

    const { page, pageSize, skip } = getPaginationParams(req.query);

    // Dynamic aggregation pipeline joining NotificationRead to determine per-user isRead status
    const pipeline = [
      { $match: matchConditions },
      {
        $lookup: {
          from: 'notificationreads',
          let: { notifId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$notificationId', '$$notifId'] },
                    { $eq: ['$userId', userId] },
                  ],
                },
              },
            },
          ],
          as: 'userReadReceipt',
        },
      },
      {
        $addFields: {
          isRead: { $gt: [{ $size: '$userReadReceipt' }, 0] },
        },
      },
    ];

    // Filter by read/unread if requested
    if (isRead === 'true') {
      pipeline.push({ $match: { isRead: true } });
    } else if (isRead === 'false') {
      pipeline.push({ $match: { isRead: false } });
    }

    pipeline.push({
      $facet: {
        totalCount: [{ $count: 'total' }],
        paginatedData: [
          { $sort: { notifyDate: -1, createdAt: -1 } },
          { $skip: skip },
          { $limit: pageSize },
          {
            $lookup: {
              from: 'users',
              localField: 'createdBy',
              foreignField: '_id',
              as: 'createdBy',
              pipeline: [{ $project: { _id: 1, name: 1, email: 1, role: 1 } }],
            },
          },
          { $unwind: { path: '$createdBy', preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: 'users',
              localField: 'targetUser',
              foreignField: '_id',
              as: 'targetUser',
              pipeline: [{ $project: { _id: 1, name: 1, email: 1, employeeId: 1, designation: 1 } }],
            },
          },
          { $unwind: { path: '$targetUser', preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: 'documents',
              localField: 'fileReferenceId',
              foreignField: '_id',
              as: 'fileReferenceId',
              pipeline: [{ $project: { _id: 1, fileNumber: 1, title: 1, subject: 1 } }],
            },
          },
          { $unwind: { path: '$fileReferenceId', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              userReadReceipt: 0,
              __v: 0,
            },
          },
        ],
      },
    });

    const [result] = await Notification.aggregate(pipeline);
    const total = result?.totalCount?.[0]?.total || 0;
    const notifications = result?.paginatedData || [];

    res.status(200).json(
      formatPaginatedResponse({
        total,
        page,
        pageSize,
        data: notifications,
      })
    );
  } catch (error) {
    next(error);
  }
};

/**
 * 3. User Notification Feed (Global Broadcasts + Notifications Targeted to Him)
 * Accessible to all authenticated users (Employees, Dept Admins, etc.)
 * GET /api/notifications/my
 */
export const getMyNotifications = async (req, res, next) => {
  try {
    const rawUserId = req.user.id || req.user._id;
    const userId = isValidObjectId(rawUserId) ? new mongoose.Types.ObjectId(rawUserId) : rawUserId;

    const {
      priority,
      classification,
      isRead,
      search,
      dateFrom,
      dateTo,
    } = req.query;

    const matchConditions = {
      status: 'active',
      $or: [
        { broadcast: 'global' },
        { broadcast: 'specific_user', targetUser: userId },
      ],
    };

    if (priority) {
      matchConditions.priority = priority.toLowerCase();
    }

    if (classification) {
      matchConditions.classification = classification;
    }

    if (dateFrom || dateTo) {
      matchConditions.notifyDate = {};
      if (dateFrom) matchConditions.notifyDate.$gte = new Date(dateFrom);
      if (dateTo) matchConditions.notifyDate.$lte = new Date(dateTo);
    }

    if (search && typeof search === 'string' && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      matchConditions.$and = matchConditions.$and || [];
      matchConditions.$and.push({
        $or: [
          { title: searchRegex },
          { message: searchRegex },
        ],
      });
    }

    const { page, pageSize, skip } = getPaginationParams(req.query);

    const pipeline = [
      { $match: matchConditions },
      {
        $lookup: {
          from: 'notificationreads',
          let: { notifId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$notificationId', '$$notifId'] },
                    { $eq: ['$userId', userId] },
                  ],
                },
              },
            },
          ],
          as: 'userReadReceipt',
        },
      },
      {
        $addFields: {
          isRead: { $gt: [{ $size: '$userReadReceipt' }, 0] },
        },
      },
    ];

    if (isRead === 'true') {
      pipeline.push({ $match: { isRead: true } });
    } else if (isRead === 'false') {
      pipeline.push({ $match: { isRead: false } });
    }

    pipeline.push({
      $facet: {
        totalCount: [{ $count: 'total' }],
        paginatedData: [
          { $sort: { notifyDate: -1, createdAt: -1 } },
          { $skip: skip },
          { $limit: pageSize },
          {
            $lookup: {
              from: 'documents',
              localField: 'fileReferenceId',
              foreignField: '_id',
              as: 'fileReferenceId',
              pipeline: [{ $project: { _id: 1, fileNumber: 1, title: 1, subject: 1 } }],
            },
          },
          { $unwind: { path: '$fileReferenceId', preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: 'users',
              localField: 'createdBy',
              foreignField: '_id',
              as: 'createdBy',
              pipeline: [{ $project: { _id: 1, name: 1, email: 1, role: 1 } }],
            },
          },
          { $unwind: { path: '$createdBy', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 1,
              title: 1,
              fileReferenceId: 1,
              notifyDate: 1,
              priority: 1,
              createdBy: 1,
              targetEmployeeId: 1,
              message: 1,
              status: 1,
              createdAt: 1,
              updatedAt: 1,
              isRead: 1,
            },
          },
        ],
      },
    });

    const [result] = await Notification.aggregate(pipeline);
    const total = result?.totalCount?.[0]?.total || 0;
    const notifications = result?.paginatedData || [];

    res.status(200).json(
      formatPaginatedResponse({
        total,
        page,
        pageSize,
        data: notifications,
      })
    );
  } catch (error) {
    next(error);
  }
};

/**
 * 4. Create Notification / Reminder / Broadcast
 * Super Admin: can create 'global', 'specific_user', or 'self'
 * Other roles: can strictly create 'self' only
 * POST /api/notifications
 */
export const createNotification = async (req, res, next) => {
  try {
    const {
      title,
      message,
      classification,
      priority,
      broadcast = 'self',
      notifyDate,
      fileReferenceNumber,
      fileReferenceId,
      employeeId,
      targetUser,
      userId,
    } = req.body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Reminder title / task is required',
      });
    }

    const validClassifications = [
      'System Notice',
      'Workflow Directive',
      'Security & Compliance',
      'Official Reminder',
    ];
    if (!classification || !validClassifications.includes(classification)) {
      return res.status(400).json({
        success: false,
        message: `Classification must be one of: ${validClassifications.join(', ')}`,
      });
    }

    const validBroadcasts = ['self', 'global', 'specific_user'];
    const chosenBroadcast = (broadcast || 'self').toLowerCase();
    if (!validBroadcasts.includes(chosenBroadcast)) {
      return res.status(400).json({
        success: false,
        message: 'Broadcast must be one of: self, global, specific_user',
      });
    }

    // Role-based permission check: Super Admin can create global or specific_user; others only self
    const isSuperAdmin = req.user?.role === 'super_admin';
    if (!isSuperAdmin && (chosenBroadcast === 'global' || chosenBroadcast === 'specific_user')) {
      return res.status(403).json({
        success: false,
        message: 'Only Super Admin has permission to broadcast global or specific user notifications. Other users can only create self reminders.',
      });
    }

    // Verify file reference (fileReferenceNumber takes precedence)
    let verifiedFileNumber = '';
    let verifiedFileRef = null;

    if (fileReferenceNumber && typeof fileReferenceNumber === 'string' && fileReferenceNumber.trim()) {
      const docExists = await Document.findOne({
        fileNumber: fileReferenceNumber.trim(),
      }).select('_id fileNumber');

      if (!docExists) {
        return res.status(404).json({
          success: false,
          message: `Referenced document with file number "${fileReferenceNumber.trim()}" not found`,
        });
      }
      verifiedFileNumber = docExists.fileNumber;
      verifiedFileRef = docExists._id;
    } else if (fileReferenceId) {
      if (!isValidObjectId(fileReferenceId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid fileReferenceId format',
        });
      }
      const docExists = await Document.findById(fileReferenceId).select('_id fileNumber');
      if (!docExists) {
        return res.status(404).json({
          success: false,
          message: 'Referenced document not found',
        });
      }
      verifiedFileRef = docExists._id;
      verifiedFileNumber = docExists.fileNumber || '';
    }

    // Resolve Single Target User when broadcast is 'specific_user'
    let resolvedTargetUserId = null;
    let resolvedEmployeeId = '';

    if (chosenBroadcast === 'specific_user') {
      let matchedUser = null;

      if (employeeId && typeof employeeId === 'string' && employeeId.trim()) {
        matchedUser = await User.findOne({ employeeId: employeeId.trim() }).select('_id employeeId');
      } else if (targetUser || userId) {
        const idToLookup = targetUser || userId;
        if (isValidObjectId(idToLookup)) {
          matchedUser = await User.findById(idToLookup).select('_id employeeId');
        }
      }

      if (!matchedUser) {
        return res.status(404).json({
          success: false,
          message: 'Target user not found. Please provide a valid employeeId or targetUser ID.',
        });
      }

      resolvedTargetUserId = matchedUser._id;
      resolvedEmployeeId = matchedUser.employeeId || '';
    }

    // Calculate initial unread count
    let initialUnreadCount = 0;
    if (chosenBroadcast === 'self' || chosenBroadcast === 'specific_user') {
      initialUnreadCount = 1;
    } else if (chosenBroadcast === 'global') {
      initialUnreadCount = await User.countDocuments();
    }

    const notification = await Notification.create({
      title: title.trim(),
      message: (message || '').trim(),
      classification,
      priority: (priority || 'routine').toLowerCase(),
      broadcast: chosenBroadcast,
      createdBy: req.user.id || req.user._id,
      targetUser: resolvedTargetUserId,
      targetEmployeeId: resolvedEmployeeId,
      fileReferenceNumber: verifiedFileNumber,
      fileReferenceId: verifiedFileRef,
      notifyDate: notifyDate ? new Date(notifyDate) : new Date(),
      readCount: 0,
      unreadCount: initialUnreadCount,
      status: 'active',
    });

    res.status(201).json({
      success: true,
      message: 'Notification / broadcast created successfully',
      data: notification,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 5. Get Notification Details by ID (Super Admin, Creator, or Target Recipient)
 * GET /api/notifications/:id
 */
export const getNotificationById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID format',
      });
    }

    const notification = await Notification.findById(id)
      .populate('createdBy', 'name email role')
      .populate('targetUser', 'name email employeeId designation')
      .populate('fileReferenceId', 'fileNumber title subject');

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found',
      });
    }

    const currentUserId = (req.user.id || req.user._id)?.toString();
    const isSuperAdmin = req.user.role === 'super_admin';
    const isCreator = notification.createdBy?._id?.toString() === currentUserId;
    const isTarget = notification.targetUser?._id?.toString() === currentUserId;
    const isGlobal = notification.broadcast === 'global';

    if (!isSuperAdmin && !isCreator && !isTarget && !isGlobal) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this notification',
      });
    }

    const userId = req.user.id || req.user._id;
    const readReceipt = await NotificationRead.findOne({
      notificationId: id,
      userId,
    });

    const notifObj = notification.toJSON();
    notifObj.isRead = !!readReceipt;
    if (readReceipt) {
      notifObj.readAt = readReceipt.readAt;
    }

    res.status(200).json({
      success: true,
      data: notifObj,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 6. Mark Single Notification as Read
 * PATCH /api/notifications/:id/read
 */
export const markAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID format',
      });
    }

    const notification = await Notification.findById(id);
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found',
      });
    }

    const userId = req.user.id || req.user._id;

    // Insert read receipt if not already recorded
    const existingReceipt = await NotificationRead.findOneAndUpdate(
      { notificationId: id, userId },
      { $setOnInsert: { notificationId: id, userId, readAt: new Date() } },
      { upsert: true, new: false }
    );

    // If receipt was inserted for the first time, atomically update counts
    if (!existingReceipt) {
      await Notification.findByIdAndUpdate(id, {
        $inc: { readCount: 1, unreadCount: -1 },
      });
    }

    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      data: {
        notificationId: id,
        isRead: true,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 7. Mark All Unread Notifications as Read
 * PATCH /api/notifications/mark-all-read
 */
export const markAllAsRead = async (req, res, next) => {
  try {
    const rawUserId = req.user.id || req.user._id;
    const userId = isValidObjectId(rawUserId) ? new mongoose.Types.ObjectId(rawUserId) : rawUserId;

    // Fetch IDs of notifications already read
    const readIds = await NotificationRead.distinct('notificationId', { userId });

    // Find all active notifications accessible to user that are unread
    const unreadNotifications = await Notification.find({
      _id: { $nin: readIds },
      status: { $ne: 'archived' },
      $or: [
        { broadcast: 'global' },
        { broadcast: 'self', createdBy: userId },
        { broadcast: 'specific_user', targetUser: userId },
        { createdBy: userId },
      ],
    }).select('_id');

    if (unreadNotifications.length > 0) {
      const docsToInsert = unreadNotifications.map((n) => ({
        notificationId: n._id,
        userId,
        readAt: new Date(),
      }));

      // Insert read receipts in bulk, ignoring duplicates if any
      await NotificationRead.insertMany(docsToInsert, { ordered: false }).catch(() => {});

      // Atomically update read and unread counts on these notifications
      const unreadIds = unreadNotifications.map((n) => n._id);
      await Notification.updateMany(
        { _id: { $in: unreadIds } },
        { $inc: { readCount: 1, unreadCount: -1 } }
      );
    }

    res.status(200).json({
      success: true,
      message: `Marked ${unreadNotifications.length} notifications as read`,
      data: {
        markedCount: unreadNotifications.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 8. Update Notification
 * Super Admin can edit any notification.
 * Other users can ONLY edit their own self-created notifications.
 * PATCH /api/notifications/:id
 */
export const updateNotification = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, message, priority, classification, notifyDate, status, fileReferenceNumber } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID format',
      });
    }

    const notification = await Notification.findById(id);
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found',
      });
    }

    const currentUserId = (req.user.id || req.user._id)?.toString();
    const isSuperAdmin = req.user.role === 'super_admin';
    const isCreator = notification.createdBy?.toString() === currentUserId;
    const isSelfNotification = notification.broadcast === 'self';

    if (!isSuperAdmin) {
      if (!isCreator || !isSelfNotification) {
        return res.status(403).json({
          success: false,
          message: 'Only Super Admin can edit all notifications. Other users can only edit their own self notifications.',
        });
      }
    }

    if (title && title.trim()) notification.title = title.trim();
    if (message !== undefined) notification.message = message.trim();
    if (priority) notification.priority = priority.toLowerCase();
    if (classification) notification.classification = classification;
    if (notifyDate) notification.notifyDate = new Date(notifyDate);
    if (status) notification.status = status;

    if (fileReferenceNumber !== undefined) {
      if (fileReferenceNumber && typeof fileReferenceNumber === 'string' && fileReferenceNumber.trim()) {
        const doc = await Document.findOne({ fileNumber: fileReferenceNumber.trim() }).select('_id fileNumber');
        if (!doc) {
          return res.status(404).json({
            success: false,
            message: `Referenced document with file number "${fileReferenceNumber.trim()}" not found`,
          });
        }
        notification.fileReferenceNumber = doc.fileNumber;
        notification.fileReferenceId = doc._id;
      } else {
        notification.fileReferenceNumber = '';
        notification.fileReferenceId = null;
      }
    }

    await notification.save();

    res.status(200).json({
      success: true,
      message: 'Notification updated successfully',
      data: notification,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 9. Delete / Dismiss Notification
 * Super Admin can delete any notification.
 * Other users can ONLY delete their own self-created notifications.
 * DELETE /api/notifications/:id
 */
export const deleteNotification = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID format',
      });
    }

    const notification = await Notification.findById(id);
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found',
      });
    }

    const currentUserId = (req.user.id || req.user._id)?.toString();
    const isSuperAdmin = req.user.role === 'super_admin';
    const isCreator = notification.createdBy?.toString() === currentUserId;
    const isSelfNotification = notification.broadcast === 'self';

    if (!isSuperAdmin) {
      if (!isCreator || !isSelfNotification) {
        return res.status(403).json({
          success: false,
          message: 'Only Super Admin can delete all notifications. Other users can only delete their own self notifications.',
        });
      }
    }

    await Notification.findByIdAndDelete(id);
    await NotificationRead.deleteMany({ notificationId: id });

    res.status(200).json({
      success: true,
      message: 'Notification deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
