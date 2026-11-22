import mongoose from 'mongoose';
import { User } from '../models/user.model.js';
import { Department } from '../models/department.model.js';
import { Document } from '../models/document.model.js';
import { DocumentForward } from '../models/document.forward.model.js';
import { DocumentPermission } from '../models/document.permission.model.js';
import { Notification } from '../models/notification.model.js';
import { getPaginationParams, formatPaginatedResponse } from '../utils/pagination.util.js';
import { sendAccountCreatedEmail } from '../utils/mail.util.js';
import { generateNextEmployeeId } from '../utils/user.util.js';
import { isValidEmail, normalizeEmail, isValidPhone, normalizePhone, isValidObjectId } from '../utils/validator.util.js';

export const createDepartmentAdmin = async (req, res, next) => {
  try {
    const {
      name,
      email,
      password,
      departmentId,
      employeeId,
      phone,
      designation,
      isAuthorizedOfficer,
      permissions,
    } = req.body;

    if (!name || !email || !password || !departmentId) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, password, and departmentId are required',
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address (e.g. admin@example.com)',
      });
    }

    if (!isValidObjectId(departmentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid departmentId format',
      });
    }

    if (phone && !isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid 10-digit mobile number',
      });
    }

    const normalizedEmail = normalizeEmail(email);

    // Verify department exists
    const department = await Department.findById(departmentId);
    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    // Check if email already registered
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'A user with this email already exists',
      });
    }

    // Auto-generate employeeId if not provided (e.g. "MOR/ENG/001")
    let finalEmployeeId = (employeeId || '').trim().toUpperCase();
    if (!finalEmployeeId) {
      finalEmployeeId = await generateNextEmployeeId(department._id, department.code);
    }

    const adminData = {
      name: name.trim(),
      email: normalizedEmail,
      password,
      role: 'department_admin',
      departmentId,
      employeeId: finalEmployeeId,
      phone: phone ? normalizePhone(phone) : '',
      designation: designation || 'Department Administrator',
      isAuthorizedOfficer: isAuthorizedOfficer !== undefined ? Boolean(isAuthorizedOfficer) : true,
    };

    if (permissions && typeof permissions === 'object') {
      adminData.permissions = permissions;
    }

    const admin = await User.create(adminData);

    // Send account creation email with login credentials
    try {
      await sendAccountCreatedEmail({
        email: admin.email,
        name: admin.name,
        userId: admin._id,
        employeeId: admin.employeeId,
        password,
        role: admin.role,
        departmentName: department.name,
      });
    } catch (mailError) {
      console.error('Failed to send welcome email to department admin:', mailError.message);
    }

    res.status(201).json({
      success: true,
      message: `Department Admin created successfully for ${department.name}`,
      data: admin,
    });
  } catch (error) {
    next(error);
  }
};

export const getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).populate('departmentId', 'name code description');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update Last Active Time for the logged-in user
 * Route: POST /api/users/last-active
 */
export const updateLastActiveTime = async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { lastActiveAt: new Date() },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Last active time updated successfully',
      data: {
        userId: user._id,
        lastActiveAt: user.lastActiveAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

const VALID_PERMISSIONS = [
  'canViewDashboard', 'canViewMyFiles', 'canCreateFile', 'canUploadDocuments',
  'canCreateReplica', 'canHighlightDocuments', 'canAddRemarks', 'canViewReceivedFiles',
  'canSearchFiles', 'canAccessWorkspace', 'canUseStickyNotes', 'canAddOfficialNoting',
  'canApproveNoting', 'canUseSpellingSynonyms', 'canManageReminders', 'canViewNotifications',
  'canWithdrawFile', 'canDeletePartial', 'canDeletePermanent', 'canViewApprovals', 'canViewProfile',
];

// Super Admin: update permissions of ANY user
export const superAdminUpdatePermissions = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const updates = req.body;

    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ success: false, message: 'Request body must be a permissions object' });
    }

    // Filter only valid permission keys
    const invalidKeys = Object.keys(updates).filter((k) => !VALID_PERMISSIONS.includes(k));
    if (invalidKeys.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid permission keys: ${invalidKeys.join(', ')}`,
        validKeys: VALID_PERMISSIONS,
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Build dot-notation update for nested permissions
    const permissionUpdate = {};
    for (const [key, value] of Object.entries(updates)) {
      if (typeof value !== 'boolean') {
        return res.status(400).json({ success: false, message: `Permission value for '${key}' must be a boolean` });
      }
      permissionUpdate[`permissions.${key}`] = value;
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: permissionUpdate },
      { new: true, runValidators: true }
    ).populate('departmentId', 'name code');

    res.status(200).json({
      success: true,
      message: 'User permissions updated successfully',
      data: updatedUser,
    });
  } catch (error) {
    next(error);
  }
};

// Department Admin: update permissions of employees in their own department only
export const deptAdminUpdatePermissions = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const updates = req.body;
    const adminDeptId = req.user.departmentId?.toString();

    if (!adminDeptId) {
      return res.status(403).json({ success: false, message: 'Department admin is not assigned to any department' });
    }

    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ success: false, message: 'Request body must be a permissions object' });
    }

    // Filter only valid permission keys
    const invalidKeys = Object.keys(updates).filter((k) => !VALID_PERMISSIONS.includes(k));
    if (invalidKeys.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid permission keys: ${invalidKeys.join(', ')}`,
        validKeys: VALID_PERMISSIONS,
      });
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Dept admin can only update employees in their own department
    if (targetUser.departmentId?.toString() !== adminDeptId) {
      return res.status(403).json({ success: false, message: 'You can only update permissions for users in your own department' });
    }

    // Dept admin cannot update another admin or super admin
    if (targetUser.role !== 'employee') {
      return res.status(403).json({ success: false, message: 'You can only update permissions for employees' });
    }

    // Build dot-notation update for nested permissions
    const permissionUpdate = {};
    for (const [key, value] of Object.entries(updates)) {
      if (typeof value !== 'boolean') {
        return res.status(400).json({ success: false, message: `Permission value for '${key}' must be a boolean` });
      }
      permissionUpdate[`permissions.${key}`] = value;
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: permissionUpdate },
      { new: true, runValidators: true }
    ).populate('departmentId', 'name code');

    res.status(200).json({
      success: true,
      message: 'Employee permissions updated successfully',
      data: updatedUser,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get Total Summary Counts (Super Admin)
 * Route: GET /api/users/counts
 */
export const getUserCounts = async (req, res, next) => {
  try {
    const currentUserId = req.user?.id || req.user?._id;
    const currentAdminId = currentUserId && isValidObjectId(currentUserId)
      ? new mongoose.Types.ObjectId(currentUserId)
      : currentUserId;

    // Single-roundtrip aggregation pipeline with $facet: consolidates 4 user count queries into 1
    const [userCountsResult, totalDepartments] = await Promise.all([
      User.aggregate([
        {
          $facet: {
            totalUsers: [{ $count: 'count' }],
            totalEmployees: [
              { $match: { role: 'employee' } },
              { $count: 'count' },
            ],
            totalAuthorizedOfficers: [
              { $match: { isAuthorizedOfficer: true } },
              { $count: 'count' },
            ],
            totalAdminsExcludingHim: [
              {
                $match: {
                  _id: { $ne: currentAdminId },
                  role: { $in: ['super_admin', 'department_admin'] },
                },
              },
              { $count: 'count' },
            ],
          },
        },
      ]),
      Department.countDocuments(),
    ]);

    const stats = userCountsResult?.[0] || {};
    const totalUsers = stats.totalUsers?.[0]?.count || 0;
    const totalEmployees = stats.totalEmployees?.[0]?.count || 0;
    const totalAuthorizedOfficers = stats.totalAuthorizedOfficers?.[0]?.count || 0;
    const totalAdminsExcludingHim = stats.totalAdminsExcludingHim?.[0]?.count || 0;

    res.status(200).json({
      success: true,
      data: {
        totalUsers,
        totalEmployees,
        totalAuthorizedOfficers,
        totalAdminsExcludingHim,
        totalDepartments,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const listUsers = async (req, res, next) => {
  try {
    const { page, pageSize, skip } = getPaginationParams(req.query);
    const {
      search,
      q,
      departmentId,
      role,
      isAuthorizedOfficer,
      onlyAdmins,
      adminOnly,
      onlyEmployees,
      employeesOnly,
      dateFrom,
      joinedDateFrom,
      dateTo,
      joinedDateTo,
      sortAlphabetical,
    } = req.query;

    const query = {};

    // 1. Text Search across name, employee ID, email, designation
    const searchText = (search || q || '').trim();
    if (searchText) {
      const regex = new RegExp(searchText, 'i');
      query.$or = [
        { name: regex },
        { employeeId: regex },
        { email: regex },
        { designation: regex },
      ];
    }

    // 2. Department Filter
    if (departmentId && mongoose.Types.ObjectId.isValid(departmentId)) {
      query.departmentId = departmentId;
    }

    // 3. Admin / Employee / Specific Role Filter
    if (onlyAdmins === 'true' || adminOnly === 'true') {
      query.role = { $in: ['super_admin', 'department_admin'] };
    } else if (onlyEmployees === 'true' || employeesOnly === 'true') {
      query.role = 'employee';
    } else if (role && ['super_admin', 'department_admin', 'employee'].includes(role.toLowerCase())) {
      query.role = role.toLowerCase();
    }

    // 4. Authorized Officer Filter
    if (isAuthorizedOfficer !== undefined) {
      if (isAuthorizedOfficer === 'true' || isAuthorizedOfficer === true) {
        query.isAuthorizedOfficer = true;
      } else if (isAuthorizedOfficer === 'false' || isAuthorizedOfficer === false) {
        query.isAuthorizedOfficer = false;
      }
    }

    // 5. Joined Date Filter (uses user.createdAt)
    const from = dateFrom || joinedDateFrom;
    const to = dateTo || joinedDateTo;
    if (from || to) {
      query.createdAt = {};
      if (from) {
        query.createdAt.$gte = new Date(from);
      }
      if (to) {
        const endDate = new Date(to);
        endDate.setHours(23, 59, 59, 999);
        query.createdAt.$lte = endDate;
      }
    }

    // 6. Sorting
    let sort = { createdAt: -1 };
    if (sortAlphabetical === 'asc') {
      sort = { name: 1 };
    } else if (sortAlphabetical === 'desc') {
      sort = { name: -1 };
    }

    const [total, users] = await Promise.all([
      User.countDocuments(query),
      User.find(query)
        .populate('departmentId', 'name code')
        .sort(sort)
        .skip(skip)
        .limit(pageSize),
    ]);

    res.status(200).json(
      formatPaginatedResponse({
        total,
        page,
        pageSize,
        data: users,
      })
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Get dashboard overview summary counts for current user:
 * total file access count, pending files, total self notification count
 * GET /api/users/dashboard-summary
 */
export const getUserDashboardSummary = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const userDeptId = req.user.departmentId;
    const userRole = req.user.role;

    const userObjId = isValidObjectId(userId) ? new mongoose.Types.ObjectId(userId) : userId;
    const targetDeptObjId = isValidObjectId(userDeptId) ? new mongoose.Types.ObjectId(userDeptId) : userDeptId;

    let accessConditions = null;

    if (userRole === 'super_admin') {
      accessConditions = null;
    } else if (userRole === 'department_admin') {
      const forwardedDocIds = await DocumentForward.distinct('documentId', {
        targetDepartmentId: targetDeptObjId,
        isDeletedForDept: false,
      });

      accessConditions = [
        { departmentId: targetDeptObjId, isDeletedForOriginDept: false },
        { _id: { $in: forwardedDocIds } },
        { createdBy: userObjId },
      ];
    } else {
      // Employee scoping
      const userPermittedDocIds = await DocumentPermission.distinct('documentId', {
        userId: userObjId,
      });

      const fwdFilter = {
        targetDepartmentId: targetDeptObjId,
        isDeletedForDept: false,
      };
      if (!req.user.isAuthorizedOfficer) {
        fwdFilter.accessControl = { $in: ['general', 'all_employees'] };
      } else {
        fwdFilter.accessControl = { $in: ['general', 'restricted', 'all_employees'] };
      }
      const forwardedDocIds = await DocumentForward.distinct('documentId', fwdFilter);

      const originDeptAccessList = ['general', 'all_employees', 'department_only'];
      if (req.user.isAuthorizedOfficer) {
        originDeptAccessList.push('restricted');
      }

      accessConditions = [
        {
          departmentId: targetDeptObjId,
          isDeletedForOriginDept: false,
          accessControl: { $in: originDeptAccessList },
        },
        { _id: { $in: forwardedDocIds } },
        { _id: { $in: userPermittedDocIds } },
        { createdBy: userObjId },
      ];
    }

    const baseMatch = {
      status: { $ne: 'withdrawn' },
      ...(accessConditions ? { $or: accessConditions } : {}),
    };

    const canApprove =
      userRole === 'super_admin' ||
      userRole === 'department_admin' ||
      Boolean(req.user.permissions?.canViewApprovals);

    // Run Document pipeline and Notification pipeline concurrently
    const [docMetricsResult, notifMetricsResult] = await Promise.all([
      Document.aggregate([
        { $match: baseMatch },
        {
          $facet: {
            totalFileAccessCount: [
              { $count: 'count' },
            ],
            pendingFiles: canApprove
              ? [
                  {
                    $lookup: {
                      from: 'documentfiles',
                      localField: '_id',
                      foreignField: 'documentId',
                      as: 'attachedFiles',
                    },
                  },
                  { $unwind: '$attachedFiles' },
                  { $match: { 'attachedFiles.status': 'pending' } },
                  { $count: 'count' },
                ]
              : [{ $match: { _id: null } }, { $count: 'count' }],
          },
        },
      ]),
      Notification.aggregate([
        {
          $match: {
            broadcast: 'self',
            createdBy: userObjId,
            status: { $ne: 'archived' },
          },
        },
        { $count: 'count' },
      ]),
    ]);

    const docMetrics = docMetricsResult?.[0];
    const totalFileAccessCount = docMetrics?.totalFileAccessCount?.[0]?.count || 0;
    const pendingFiles = docMetrics?.pendingFiles?.[0]?.count || 0;
    const totalSelfNotificationCount = notifMetricsResult?.[0]?.count || 0;

    res.status(200).json({
      success: true,
      message: 'User summary counts retrieved successfully',
      data: {
        totalFileAccessCount,
        pendingFiles,
        totalSelfNotificationCount,
      },
    });
  } catch (error) {
    next(error);
  }
};
