import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { Document } from '../models/document.model.js';
import { Department } from '../models/department.model.js';
import { DocumentLog } from '../models/document.log.model.js';
import { DocumentPermission } from '../models/document.permission.model.js';
import { DocumentForward } from '../models/document.forward.model.js';
import { recordDocumentLog } from '../utils/document.logger.js';
import { getPaginationParams, formatPaginatedResponse } from '../utils/pagination.util.js';
import { moveToDocumentFolder, removeDocumentFolder } from '../utils/file.util.js';
import { isValidObjectId } from '../utils/validator.util.js';
import { generateNextFileNumber } from '../utils/document.util.js';

/**
 * 1. Upload & Create Document
 * Admin / Super Admin
 */
export const createDocument = async (req, res, next) => {
  try {
    const mainFile = req.files?.file?.[0] || req.file;
    const logoFile = req.files?.logo?.[0];

    if (!mainFile) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Please upload a file with the key "file"',
      });
    }

    const cleanupTempFiles = () => {
      try {
        if (mainFile?.path && fs.existsSync(mainFile.path)) fs.unlinkSync(mainFile.path);
        if (logoFile?.path && fs.existsSync(logoFile.path)) fs.unlinkSync(logoFile.path);
      } catch {}
    };

    const {
      fileNumber,
      title,
      fileTitle,
      subject,
      fileSubject,
      priority,
      filePriority,
      accessControl,
      targetAudience,
      registrationDate,
      fileDate,
      highlights,
      departmentId,
      allowedUsers,
      topHeadline,
      topSubHeadline,
      topOtherDetails,
      footerDetails,
      logoFileName,
    } = req.body;

    const finalTitle = (title || fileTitle || '').trim();
    const finalSubject = (subject || fileSubject || '').trim();
    const finalRegistrationDate = registrationDate || fileDate;

    if (!finalTitle || !finalSubject) {
      cleanupTempFiles();
      return res.status(400).json({
        success: false,
        message: 'File title and subject are required fields',
      });
    }

    if (!finalRegistrationDate) {
      cleanupTempFiles();
      return res.status(400).json({
        success: false,
        message: 'registrationDate must be chosen manually (e.g., 2026-11-17)',
      });
    }

    // Validate priority
    const validPriorities = ['routine', 'urgent', 'immediate'];
    const chosenPriority = (priority || filePriority || 'routine').toLowerCase();
    if (!validPriorities.includes(chosenPriority)) {
      cleanupTempFiles();
      return res.status(400).json({
        success: false,
        message: `Invalid priority '${chosenPriority}'. Allowed options: ${validPriorities.join(', ')}`,
      });
    }

    // Validate accessControl
    const validAccessControls = ['general', 'restricted', 'confidential', 'secret'];
    const chosenAccess = (accessControl || targetAudience || 'general').toLowerCase();
    if (!validAccessControls.includes(chosenAccess)) {
      cleanupTempFiles();
      return res.status(400).json({
        success: false,
        message: `Invalid accessControl '${chosenAccess}'. Allowed options: ${validAccessControls.join(', ')}`,
      });
    }

    // Determine target department (resolved early so dept.code is available for file number generation)
    let targetDeptId = departmentId;
    if (req.user.role === 'department_admin') {
      targetDeptId = req.user.departmentId;
    }

    if (!targetDeptId || !isValidObjectId(targetDeptId)) {
      cleanupTempFiles();
      return res.status(400).json({
        success: false,
        message: 'A valid departmentId must be specified for this file',
      });
    }

    const dept = await Department.findById(targetDeptId);
    if (!dept) {
      cleanupTempFiles();
      return res.status(404).json({
        success: false,
        message: 'Target department does not exist',
      });
    }

    // Auto-generate fileNumber if not provided by caller
    let finalFileNumber = (fileNumber || '').trim().toUpperCase();
    if (!finalFileNumber) {
      finalFileNumber = await generateNextFileNumber(targetDeptId, dept.code);
    }

    // Check if fileNumber already exists (guards both manual and auto-generated values)
    const existingFile = await Document.findOne({ fileNumber: finalFileNumber });
    if (existingFile) {
      cleanupTempFiles();
      return res.status(409).json({
        success: false,
        message: `A document with file number '${finalFileNumber}' already exists`,
      });
    }

    // Parse highlights if sent as JSON string or comma-separated string
    let parsedHighlights = [];
    if (highlights) {
      if (typeof highlights === 'string') {
        try {
          parsedHighlights = JSON.parse(highlights);
        } catch {
          parsedHighlights = highlights.split(',').map((h) => h.trim());
        }
      } else if (Array.isArray(highlights)) {
        parsedHighlights = highlights;
      }
    }

    // Parse allowedUsers if sent as string
    let parsedAllowedUsers = [];
    if (allowedUsers) {
      if (typeof allowedUsers === 'string') {
        try {
          parsedAllowedUsers = JSON.parse(allowedUsers);
        } catch {
          parsedAllowedUsers = [];
        }
      } else if (Array.isArray(allowedUsers)) {
        parsedAllowedUsers = allowedUsers;
      }
    }

    // Pre-generate document ObjectId to organize files in dedicated folders
    const docId = new mongoose.Types.ObjectId();

    // Organize main file in uploads/uploaded-files/<docId>/files/
    const movedMain = moveToDocumentFolder(mainFile.path, docId, 'files');
    const finalFilePath = movedMain ? movedMain.destPath : mainFile.path;
    const finalStoredFilename = movedMain ? movedMain.filename : mainFile.filename;
    const fileUrl = movedMain ? movedMain.fileUrl : `/uploads/${mainFile.filename}`;

    // Organize logo in uploads/uploaded-files/<docId>/logo/ if uploaded
    let logoUrl = '';
    let finalLogoFileName = (logoFileName || '').trim();
    let logoOriginalName = '';

    if (logoFile) {
      const movedLogo = moveToDocumentFolder(logoFile.path, docId, 'logo');
      logoUrl = movedLogo ? movedLogo.fileUrl : `/uploads/${logoFile.filename}`;
      finalLogoFileName = movedLogo ? movedLogo.filename : logoFile.filename;
      logoOriginalName = logoFile.originalname;
    }

    // Create Main Document (Stays ultra-lightweight: ~1-2 KB)
    const document = await Document.create({
      _id: docId,
      fileNumber: finalFileNumber,
      title: finalTitle,
      subject: finalSubject,
      priority: chosenPriority,
      accessControl: chosenAccess,
      registrationDate: new Date(finalRegistrationDate),
      highlights: parsedHighlights,
      originalName: mainFile.originalname,
      storedFilename: finalStoredFilename,
      filePath: finalFilePath,
      fileUrl,
      mimeType: mainFile.mimetype,
      fileSize: mainFile.size,
      logoFileName: finalLogoFileName,
      logoUrl,
      logoOriginalName,
      topHeadline: (topHeadline || '').trim(),
      topSubHeadline: (topSubHeadline || '').trim(),
      topOtherDetails: (topOtherDetails || '').trim(),
      footerDetails: (footerDetails || '').trim(),
      departmentId: targetDeptId,
      createdBy: req.user.id,
    });

    // Automatically grant creator full owner file access permissions
    const permissionDocs = [
      {
        documentId: document._id,
        userId: req.user.id,
        departmentId: targetDeptId,
        permissions: {
          canView: true,
          canRemark: true,
          canSuggestChange: true,
          canDownload: true,
          canHighlightDocuments: true,
          canUseStickyNotes: true,
          canAddOfficialNoting: true,
          canApproveNoting: true,
          canWithdrawFile: true,
          canDeletePartial: true,
        },
        grantedBy: req.user.id,
      },
    ];

    // Bulk insert file access permissions for any additional specified users
    if (parsedAllowedUsers.length > 0) {
      for (const u of parsedAllowedUsers) {
        if (u.userId && u.userId.toString() !== req.user.id.toString()) {
          permissionDocs.push({
            documentId: document._id,
            userId: u.userId,
            departmentId: targetDeptId,
            permissions: {
              canView: u.permissions?.canView !== undefined ? Boolean(u.permissions.canView) : true,
              canRemark: u.permissions?.canRemark !== undefined ? Boolean(u.permissions.canRemark) : true,
              canSuggestChange: u.permissions?.canSuggestChange !== undefined ? Boolean(u.permissions.canSuggestChange) : true,
              canDownload: u.permissions?.canDownload !== undefined ? Boolean(u.permissions.canDownload) : true,
              canHighlightDocuments: u.permissions?.canHighlightDocuments !== undefined ? Boolean(u.permissions.canHighlightDocuments) : true,
              canUseStickyNotes: u.permissions?.canUseStickyNotes !== undefined ? Boolean(u.permissions.canUseStickyNotes) : true,
              canAddOfficialNoting: Boolean(u.permissions?.canAddOfficialNoting),
              canApproveNoting: Boolean(u.permissions?.canApproveNoting),
              canWithdrawFile: Boolean(u.permissions?.canWithdrawFile),
              canDeletePartial: Boolean(u.permissions?.canDeletePartial),
            },
            grantedBy: req.user.id,
          });
        }
      }
    }

    await DocumentPermission.insertMany(permissionDocs, { ordered: false }).catch((err) => {
      console.warn('Some duplicate permission grants skipped:', err.message);
    });

    // Record audit log
    await recordDocumentLog({
      fileId: document._id,
      fileNumber: document.fileNumber || fileNumber || '',
      user: req.user,
      action: 'File Created',
      details: `Created electronic file ${document.fileNumber || document.title}: ${document.subject || ''}`,
      req,
    });

    res.status(201).json({
      success: true,
      message: 'Document uploaded and created successfully',
      data: document,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 2. Search & List Documents
 * Filter by Department, Date, Subject, Accessor, Shelf, Alphabetical (A-Z)
 */
export const searchAndListDocuments = async (req, res, next) => {
  try {
    const {
      departmentId,
      search,
      subject,
      priority,
      accessControl,
      fileNumber,
      accessorId,
      dateFrom,
      dateTo,
      sortAlphabetical,
      includeWithdrawn,
    } = req.query;

    const query = {};

    // 1. Base status filter
    if (includeWithdrawn !== 'true') {
      query.status = { $ne: 'withdrawn' };
    }

    // 2. Role-based scoping
    const userId = req.user.id;
    const userDeptId = req.user.departmentId;

    if (req.user.role === 'super_admin') {
      if (departmentId) {
        query.departmentId = departmentId;
      }
    } else if (req.user.role === 'department_admin') {
      const forwardedDocIds = await DocumentForward.distinct('documentId', {
        targetDepartmentId: userDeptId,
        isDeletedForDept: false,
      });

      query.$or = [
        { departmentId: userDeptId, isDeletedForOriginDept: false },
        { _id: { $in: forwardedDocIds } },
      ];
    } else {
      // Employee scoping
      const userPermittedDocIds = await DocumentPermission.distinct('documentId', {
        userId,
      });

      // Check forwarded files accessible to employee
      const fwdFilter = {
        targetDepartmentId: userDeptId,
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

      query.$or = [
        {
          departmentId: userDeptId,
          isDeletedForOriginDept: false,
          accessControl: { $in: originDeptAccessList },
        },
        { _id: { $in: forwardedDocIds } },
        { _id: { $in: userPermittedDocIds } },
      ];
    }

    // 3. Search text / title / subject / fileNumber
    if (search || subject) {
      const searchTerm = search || subject;
      query.$or = query.$or || [];
      query.$or.push(
        { title: { $regex: searchTerm, $options: 'i' } },
        { subject: { $regex: searchTerm, $options: 'i' } },
        { fileNumber: { $regex: searchTerm, $options: 'i' } }
      );
    }

    if (fileNumber) {
      query.fileNumber = { $regex: fileNumber.trim(), $options: 'i' };
    }

    if (priority) {
      query.priority = priority.toLowerCase();
    }

    if (accessControl) {
      query.accessControl = accessControl.toLowerCase();
    }

    // 4. Accessor filter (Find files permitted to a specific user)
    if (accessorId) {
      const accessorPermittedDocIds = await DocumentPermission.distinct('documentId', {
        userId: accessorId,
      });
      query._id = { $in: accessorPermittedDocIds };
    }

    // 6. Date range filter (Registration Date)
    if (dateFrom || dateTo) {
      query.registrationDate = {};
      if (dateFrom) query.registrationDate.$gte = new Date(dateFrom);
      if (dateTo) query.registrationDate.$lte = new Date(dateTo);
    }

    // 7. Sorting
    let sortOptions = { registrationDate: -1, createdAt: -1 };
    if (sortAlphabetical === 'true' || sortAlphabetical === 'asc') {
      sortOptions = { title: 1 };
    } else if (sortAlphabetical === 'desc') {
      sortOptions = { title: -1 };
    }

    // 8. Pagination
    const { page, pageSize, skip } = getPaginationParams(req.query);

    const [total, documents] = await Promise.all([
      Document.countDocuments(query),
      Document.find(query)
        .populate('departmentId', 'name code')
        .populate('createdBy', 'name email')
        .sort(sortOptions)
        .skip(skip)
        .limit(pageSize),
    ]);

    res.status(200).json(
      formatPaginatedResponse({
        total,
        page,
        pageSize,
        data: documents,
      })
    );
  } catch (error) {
    next(error);
  }
};

/**
 * 3. Get Document Details
 */
export const getDocumentById = async (req, res, next) => {
  try {
    const document = await Document.findById(req.params.id)
      .populate('departmentId', 'name code description')
      .populate('createdBy', 'name email');

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const forwards = await DocumentForward.find({
      documentId: document._id,
      isDeletedForDept: false,
    })
      .populate('targetDepartmentId', 'name code')
      .populate('fromDepartmentId', 'name code')
      .populate('forwardedBy', 'name email');

    res.status(200).json({
      success: true,
      userPermission: req.userPermission,
      data: {
        ...document.toObject(),
        forwardedDepartments: forwards,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 4. Update Access Control & Target Audience
 * Admin / Super Admin
 */
export const updatePermissions = async (req, res, next) => {
  try {
    const { targetAudience, allowedUsers } = req.body;
    const document = req.document;

    const isSuperAdmin = req.user.role === 'super_admin';
    const isOriginAdmin =
      req.user.role === 'department_admin' &&
      req.user.departmentId?.toString() === document.departmentId.toString();

    if (!isSuperAdmin && !isOriginAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only Super Admin or Originating Department Admin can update main permissions',
      });
    }

    if (targetAudience) document.targetAudience = targetAudience;
    await document.save();

    // If allowedUsers list is provided, bulk upsert into DocumentPermission
    if (allowedUsers && Array.isArray(allowedUsers)) {
      const bulkOps = allowedUsers.map((u) => ({
        updateOne: {
          filter: { documentId: document._id, userId: u.userId },
          update: {
            $set: {
              permissions: u.permissions || {
                canView: true,
                canRemark: true,
                canSuggestChange: true,
                canDownload: true,
              },
              departmentId: document.departmentId,
              grantedBy: req.user.id,
              grantedAt: new Date(),
            },
          },
          upsert: true,
        },
      }));

      if (bulkOps.length > 0) {
        await DocumentPermission.bulkWrite(bulkOps);
      }
    }

    await recordDocumentLog({
      documentId: document._id,
      user: req.user,
      action: 'UPDATE_PERMISSIONS',
      description: `Access control permissions updated by ${req.user.name || req.user.email}`,
      details: { targetAudience, updatedUsersCount: allowedUsers?.length || 0 },
    });

    res.status(200).json({
      success: true,
      message: 'Document permissions updated successfully',
      data: document,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 5. List Permissions for a Document (Paginated, handles 500 - 2,000+ users easily)
 */
export const listDocumentPermissions = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { page, pageSize, skip } = getPaginationParams(req.query);

    const filter = { documentId: id };

    const [total, permissions] = await Promise.all([
      DocumentPermission.countDocuments(filter),
      DocumentPermission.find(filter)
        .populate('userId', 'name email role departmentId')
        .populate('grantedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize),
    ]);

    res.status(200).json(
      formatPaginatedResponse({
        total,
        page,
        pageSize,
        data: permissions,
      })
    );
  } catch (error) {
    next(error);
  }
};

/**
 * 6. Bulk Grant Document Permissions to Specific Users
 */
export const grantDocumentPermissions = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { allowedUsers } = req.body;

    if (!allowedUsers || !Array.isArray(allowedUsers) || allowedUsers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'allowedUsers array is required with at least one user',
      });
    }

    const invalidUser = allowedUsers.find((u) => !isValidObjectId(u.userId));
    if (invalidUser) {
      return res.status(400).json({
        success: false,
        message: `Invalid userId format: ${invalidUser.userId}`,
      });
    }

    const document = req.document;

    const bulkOps = allowedUsers.map((u) => ({
      updateOne: {
        filter: { documentId: document._id, userId: u.userId },
        update: {
          $set: {
            permissions: u.permissions || {
              canView: true,
              canRemark: true,
              canSuggestChange: true,
              canDownload: true,
            },
            departmentId: document.departmentId,
            grantedBy: req.user.id,
            grantedAt: new Date(),
          },
        },
        upsert: true,
      },
    }));

    await DocumentPermission.bulkWrite(bulkOps);

    await recordDocumentLog({
      documentId: document._id,
      user: req.user,
      action: 'UPDATE_PERMISSIONS',
      description: `Permissions granted to ${allowedUsers.length} user(s) by ${req.user.name || req.user.email}`,
      details: { grantedCount: allowedUsers.length },
    });

    res.status(200).json({
      success: true,
      message: `Permissions successfully granted to ${allowedUsers.length} user(s)`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 7. Revoke Document Permission for a Specific User
 */
export const revokeDocumentPermission = async (req, res, next) => {
  try {
    const { id, userId } = req.params;
    const document = req.document;

    const deleted = await DocumentPermission.findOneAndDelete({
      documentId: document._id,
      userId,
    });

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Permission record not found for this user',
      });
    }

    await recordDocumentLog({
      documentId: document._id,
      user: req.user,
      action: 'UPDATE_PERMISSIONS',
      description: `Access permission revoked for user ${userId} by ${req.user.name || req.user.email}`,
      details: { revokedUserId: userId },
    });

    res.status(200).json({
      success: true,
      message: 'User permission revoked successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 8. Forward Document to Another Department
 */
export const forwardDocument = async (req, res, next) => {
  try {
    const {
      targetDepartmentId,
      priority,
      accessControl,
      targetAudience,
      remarks,
      allowedUsers,
    } = req.body;
    const document = req.document;

    if (!targetDepartmentId || !isValidObjectId(targetDepartmentId)) {
      return res.status(400).json({
        success: false,
        message: 'A valid targetDepartmentId is required to forward document',
      });
    }

    if (allowedUsers && Array.isArray(allowedUsers)) {
      const invalidUser = allowedUsers.find((u) => !isValidObjectId(u.userId));
      if (invalidUser) {
        return res.status(400).json({
          success: false,
          message: `Invalid userId format in allowedUsers: ${invalidUser.userId}`,
        });
      }
    }

    const targetDept = await Department.findById(targetDepartmentId);
    if (!targetDept) {
      return res.status(404).json({
        success: false,
        message: 'Target department to forward to not found',
      });
    }

    const existingForward = await DocumentForward.findOne({
      documentId: document._id,
      targetDepartmentId,
      isDeletedForDept: false,
    });

    if (existingForward) {
      return res.status(409).json({
        success: false,
        message: `Document has already been forwarded to ${targetDept.name}`,
      });
    }

    const chosenPriority = (priority || document.priority || 'routine').toLowerCase();
    const chosenAccess = (accessControl || targetAudience || 'general').toLowerCase();

    const forwardRecord = await DocumentForward.create({
      documentId: document._id,
      fromDepartmentId: document.departmentId,
      targetDepartmentId,
      forwardedBy: req.user.id,
      priority: chosenPriority,
      accessControl: chosenAccess,
      remarks: remarks || '',
    });

    // If allowedUsers passed for forwarded department, store into DocumentPermission
    if (allowedUsers && Array.isArray(allowedUsers) && allowedUsers.length > 0) {
      const permDocs = allowedUsers.map((u) => ({
        documentId: document._id,
        userId: u.userId,
        departmentId: targetDepartmentId,
        permissions: u.permissions || {
          canView: true,
          canRemark: true,
          canSuggestChange: true,
          canDownload: true,
        },
        grantedBy: req.user.id,
      }));
      await DocumentPermission.insertMany(permDocs, { ordered: false }).catch(() => {});
    }

    await recordDocumentLog({
      fileId: document._id,
      fileNumber: document.fileNumber || '',
      user: req.user,
      action: 'File Forwarded',
      details: `Document forwarded to '${targetDept.name}' by ${req.user.name || req.user.email}`,
      req,
    });

    res.status(200).json({
      success: true,
      message: `Document successfully forwarded to department: ${targetDept.name}`,
      data: forwardRecord,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 9. Update Forwarded Department Permissions
 * Managed by Recipient Department Admin or Super Admin
 */
export const updateForwardedPermissions = async (req, res, next) => {
  try {
    const { departmentId } = req.params;
    const { accessControl, targetAudience, priority, remarks, allowedUsers } = req.body;
    const document = req.document;

    const isSuperAdmin = req.user.role === 'super_admin';
    const isTargetDeptAdmin =
      req.user.role === 'department_admin' &&
      req.user.departmentId?.toString() === departmentId.toString();

    if (!isSuperAdmin && !isTargetDeptAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only the recipient Department Admin or Super Admin can manage permissions for this department',
      });
    }

    const updateData = {};
    const chosenAccess = accessControl || targetAudience;
    if (chosenAccess) updateData.accessControl = chosenAccess.toLowerCase();
    if (priority) updateData.priority = priority.toLowerCase();
    if (remarks !== undefined) updateData.remarks = remarks;

    const forwardRecord = await DocumentForward.findOneAndUpdate(
      { documentId: document._id, targetDepartmentId: departmentId, isDeletedForDept: false },
      { $set: updateData },
      { new: true }
    );

    if (!forwardRecord) {
      return res.status(404).json({
        success: false,
        message: 'This document is not currently forwarded to this department',
      });
    }

    // Update specific permissions in DocumentPermission collection
    if (allowedUsers && Array.isArray(allowedUsers)) {
      const bulkOps = allowedUsers.map((u) => ({
        updateOne: {
          filter: { documentId: document._id, userId: u.userId },
          update: {
            $set: {
              permissions: u.permissions || {
                canView: true,
                canRemark: true,
                canSuggestChange: true,
                canDownload: true,
              },
              departmentId,
              grantedBy: req.user.id,
              grantedAt: new Date(),
            },
          },
          upsert: true,
        },
      }));
      if (bulkOps.length > 0) {
        await DocumentPermission.bulkWrite(bulkOps);
      }
    }

    await recordDocumentLog({
      fileId: document._id,
      fileNumber: document.fileNumber || '',
      user: req.user,
      action: 'Forwarded Permissions Updated',
      details: `Permissions for forwarded department updated by ${req.user.name || req.user.email}`,
      req,
    });

    res.status(200).json({
      success: true,
      message: 'Forwarded department permissions updated successfully',
      data: forwardRecord,
    });
  } catch (error) {
    next(error);
  }
};
;

/**
 * 10. Add Remarks from Accessor
 */
export const addRemark = async (req, res, next) => {
  try {
    const { comment } = req.body;
    if (!comment) {
      return res.status(400).json({
        success: false,
        message: 'Remark comment text is required',
      });
    }

    const document = req.document;
    const newRemark = {
      userId: req.user.id,
      userName: req.user.name || req.user.email,
      comment: comment.trim(),
      createdAt: new Date(),
    };

    document.remarks.push(newRemark);
    await document.save();

    await recordDocumentLog({
      documentId: document._id,
      user: req.user,
      action: 'ADD_REMARK',
      description: `Remark added by ${newRemark.userName}`,
      details: { comment: newRemark.comment },
    });

    res.status(201).json({
      success: true,
      message: 'Remark added successfully',
      data: document.remarks,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 11. Add Virtual Sticky Note (Colorful)
 */
export const addSticky = async (req, res, next) => {
  try {
    const { note, color } = req.body;
    if (!note) {
      return res.status(400).json({
        success: false,
        message: 'Sticky note text is required',
      });
    }

    const document = req.document;
    const newSticky = {
      color: color || 'yellow',
      note: note.trim(),
      createdBy: req.user.id,
      authorName: req.user.name || req.user.email,
      createdAt: new Date(),
    };

    document.stickies.push(newSticky);
    await document.save();

    await recordDocumentLog({
      documentId: document._id,
      user: req.user,
      action: 'ADD_STICKY',
      description: `Sticky note (${newSticky.color}) attached by ${newSticky.authorName}`,
      details: { color: newSticky.color, note: newSticky.note },
    });

    res.status(201).json({
      success: true,
      message: 'Virtual sticky note added successfully',
      data: document.stickies,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 12. Add Official Document Noting
 */
export const addNoting = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({
        success: false,
        message: 'Noting content text is required',
      });
    }

    const document = req.document;
    const newNoting = {
      text: text.trim(),
      author: req.user.id,
      authorName: req.user.name || req.user.email,
      isApproved: false,
      createdAt: new Date(),
    };

    document.notings.push(newNoting);
    await document.save();

    await recordDocumentLog({
      documentId: document._id,
      user: req.user,
      action: 'ADD_NOTING',
      description: `Official noting drafted by ${newNoting.authorName}`,
      details: { text: newNoting.text },
    });

    res.status(201).json({
      success: true,
      message: 'Document noting added. Awaiting authorized signature/approval.',
      data: document.notings,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 13. Approve Official Document Noting
 * Admin / Super Admin
 */
export const approveNoting = async (req, res, next) => {
  try {
    const { notingId } = req.params;
    const document = req.document;

    if (req.user.role !== 'super_admin' && req.user.role !== 'department_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only Department Admins or Super Admins can sign and approve document notings',
      });
    }

    const noting = document.notings.id(notingId);
    if (!noting) {
      return res.status(404).json({
        success: false,
        message: 'Document noting not found',
      });
    }

    noting.isApproved = true;
    noting.approvedBy = req.user.id;
    noting.approvedByName = req.user.name || req.user.email;
    noting.approvedAt = new Date();

    await document.save();

    await recordDocumentLog({
      documentId: document._id,
      user: req.user,
      action: 'APPROVE_NOTING',
      description: `Official noting approved and signed by ${noting.approvedByName}`,
      details: { notingId },
    });

    res.status(200).json({
      success: true,
      message: 'Document noting approved and signed successfully',
      data: noting,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 14. Withdraw File
 */
export const withdrawFile = async (req, res, next) => {
  try {
    const document = req.document;
    const isCreator = document.createdBy.toString() === req.user.id.toString();
    const isSuperAdmin = req.user.role === 'super_admin';

    if (!isCreator && !isSuperAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only the document creator or Super Admin can withdraw this file',
      });
    }

    document.status = 'withdrawn';
    await document.save();

    await recordDocumentLog({
      documentId: document._id,
      user: req.user,
      action: 'WITHDRAW_FILE',
      description: `Document withdrawn by ${req.user.name || req.user.email}`,
    });

    res.status(200).json({
      success: true,
      message: 'Document successfully marked as withdrawn',
      data: document,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 15. Employee Self-Delete (Remove Access from Personal View)
 */
export const employeeSelfDelete = async (req, res, next) => {
  try {
    const document = req.document;
    const userId = req.user.id;

    await DocumentPermission.findOneAndDelete({
      documentId: document._id,
      userId,
    });

    await recordDocumentLog({
      documentId: document._id,
      user: req.user,
      action: 'EMPLOYEE_REMOVED_ACCESS',
      description: `Employee ${req.user.name || req.user.email} removed this document from their personal access`,
    });

    res.status(200).json({
      success: true,
      message: 'Document permission removed from your personal access.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 16. Department Admin Delete (Delete from Department Only)
 */
export const departmentDelete = async (req, res, next) => {
  try {
    if (req.user.role !== 'department_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only Department Admins or Super Admins can remove a file from department access',
      });
    }

    const document = req.document;
    const userDeptId = req.user.departmentId?.toString();

    if (document.departmentId.toString() === userDeptId) {
      document.isDeletedForOriginDept = true;
      document.originDeptDeletedAt = new Date();
      document.originDeptDeletedBy = req.user.id;
      await document.save();
    } else {
      const forwardedRecord = await DocumentForward.findOneAndUpdate(
        { documentId: document._id, targetDepartmentId: userDeptId, isDeletedForDept: false },
        { isDeletedForDept: true, deletedAt: new Date(), deletedBy: req.user.id },
        { new: true }
      );

      if (!forwardedRecord && req.user.role !== 'super_admin') {
        return res.status(403).json({
          success: false,
          message: 'You can only delete files for your assigned department',
        });
      }
    }

    await recordDocumentLog({
      fileId: document._id,
      fileNumber: document.fileNumber || '',
      user: req.user,
      action: 'File Deleted For Department',
      details: `File access deleted for department by ${req.user.name || req.user.email}. Super Admin retains global access.`,
      req,
    });

    res.status(200).json({
      success: true,
      message: 'File removed from department view. Super Admin retains global access and full audit logs.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 17. Permanent Hard Delete (Super Admin strictly)
 */
export const permanentDelete = async (req, res, next) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Strictly Super Admin only: Permanent file deletion requires super_admin role',
      });
    }

    const { id } = req.params;
    const document = await Document.findById(id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    // Clean up organized physical document folder (files, logo, replicas)
    removeDocumentFolder(document._id);

    // Fallback: Try deleting physical file from legacy disk location
    if (document.filePath && fs.existsSync(document.filePath)) {
      try {
        fs.unlinkSync(document.filePath);
      } catch (err) {
        console.warn('Physical file deletion warning:', err.message);
      }
    }

    // Fallback: Try deleting physical logo file from legacy disk location
    if (document.logoFileName) {
      const logoPath = path.resolve(process.cwd(), 'uploads', document.logoFileName);
      if (fs.existsSync(logoPath)) {
        try {
          fs.unlinkSync(logoPath);
        } catch (err) {
          console.warn('Physical logo deletion warning:', err.message);
        }
      }
    }

    // Clean up all permissions in DocumentPermission collection
    await DocumentPermission.deleteMany({ documentId: id });

    // Clean up all forwards in DocumentForward collection
    await DocumentForward.deleteMany({ documentId: id });

    // Log the permanent deletion action before removing the document
    await recordDocumentLog({
      fileId: document._id,
      fileNumber: document.fileNumber || '',
      user: req.user,
      action: 'PERMANENT_DELETE',
      details: `Document '${document.title}' was permanently deleted and purged by Super Admin ${req.user.name || req.user.email}`,
      req,
    });

    await Document.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Document and all associated permissions permanently deleted from database and storage',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 18. Get Document Activity Logs (Role-Based Aggregation Pipeline)
 * - super_admin: views all logs for the file
 * - department_admin: views only logs created by users of their department
 * - employee: views only their own logs
 */
export const getDocumentLogs = async (req, res, next) => {
  try {
    const { page, pageSize, skip } = getPaginationParams(req.query);
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID format',
      });
    }

    const pipeline = [];

    // Stage 1: Match the specific document/file
    pipeline.push({
      $match: { fileId: new mongoose.Types.ObjectId(id) },
    });

    // Stage 2: Role-based isolation
    if (req.user.role === 'employee') {
      // Employees ONLY see logs performed by themselves
      pipeline.push({
        $match: { userId: new mongoose.Types.ObjectId(req.user.id || req.user._id) },
      });
    } else if (req.user.role === 'department_admin') {
      // Department Admins ONLY see logs by users in their own department
      const deptId = req.user.departmentId?.toString();
      if (!deptId) {
        return res.status(200).json(
          formatPaginatedResponse({
            total: 0,
            page,
            pageSize,
            data: [],
          })
        );
      }

      pipeline.push(
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'userDetails',
          },
        },
        {
          $unwind: '$userDetails',
        },
        {
          $match: {
            'userDetails.departmentId': new mongoose.Types.ObjectId(deptId),
          },
        }
      );
    }
    // Super Admin: Bypasses user filtering completely — sees ALL logs

    // Stage 3: Facet for single-query pagination + field projection (_id -> id)
    pipeline.push({
      $facet: {
        metadata: [{ $count: 'total' }],
        data: [
          { $sort: { timestamp: -1 } },
          { $skip: skip },
          { $limit: pageSize },
          {
            $project: {
              id: '$_id',
              _id: 0,
              fileId: 1,
              fileNumber: 1,
              userId: 1,
              userName: 1,
              userRole: 1,
              departmentId: 1,
              departmentName: 1,
              action: 1,
              details: 1,
              ipAddress: 1,
              timestamp: 1,
            },
          },
        ],
      },
    });

    const [result] = await DocumentLog.aggregate(pipeline);

    const total = result?.metadata?.[0]?.total || 0;
    const logs = result?.data || [];

    res.status(200).json(
      formatPaginatedResponse({
        total,
        page,
        pageSize,
        data: logs,
      })
    );
  } catch (error) {
    next(error);
  }
};

/**
 * 19. Create Document Activity Log Entry
 */
export const createDocumentLog = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action, details, fileNumber } = req.body;

    if (!action) {
      return res.status(400).json({
        success: false,
        message: 'Action is required',
      });
    }

    const document = req.document || (await Document.findById(id));
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const log = await recordDocumentLog({
      fileId: document._id,
      fileNumber: fileNumber || document.fileNumber || '',
      user: req.user,
      action,
      details: details || '',
      req,
    });

    res.status(201).json({
      success: true,
      message: 'Document activity log created successfully',
      data: log,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 20. Get All Document Activity Logs (Global, Super Admin only)
 * Filters: employeeId/userId, employeeName/userName, onlyEmployees, departmentId, departmentName, fileNumber, action
 * Time Ranges: all_time (default), today, 7_days, specific_month (month=YYYY-MM), custom (startDate, endDate, dateFrom, dateTo)
 * Sorting: newest (timestamp: -1, default), oldest (timestamp: 1)
 */
export const getAllDocumentLogs = async (req, res, next) => {
  try {
    const { page, pageSize, skip } = getPaginationParams(req.query);
    const {
      employeeId,
      userId,
      employeeName,
      userName,
      onlyEmployees,
      departmentId,
      departmentName,
      fileNumber,
      action,
      sort,
      sortBy,
      timeRange,
      month,
      startDate,
      endDate,
      dateFrom,
      dateTo,
    } = req.query;

    const query = {};

    // 1. Employee / User filters
    const targetUserId = employeeId || userId;
    if (targetUserId && mongoose.Types.ObjectId.isValid(targetUserId)) {
      query.userId = new mongoose.Types.ObjectId(targetUserId);
    }

    const targetUserName = (employeeName || userName || '').trim();
    if (targetUserName) {
      query.userName = new RegExp(targetUserName, 'i');
    }

    if (onlyEmployees === 'true' || onlyEmployees === true) {
      query.userRole = 'employee';
    }

    // 2. Department filters
    if (departmentId && mongoose.Types.ObjectId.isValid(departmentId)) {
      query.departmentId = new mongoose.Types.ObjectId(departmentId);
    }

    if (departmentName && departmentName.trim()) {
      query.departmentName = new RegExp(departmentName.trim(), 'i');
    }

    // 3. File Number & Action filters
    if (fileNumber && fileNumber.trim()) {
      query.fileNumber = new RegExp(fileNumber.trim(), 'i');
    }

    if (action && action.trim()) {
      query.action = new RegExp(action.trim(), 'i');
    }

    // 4. Time Range Filter: all_time | today | 7_days | specific_month | custom
    const appliedRange = (timeRange || '').toLowerCase();
    const now = new Date();

    if (appliedRange === 'today') {
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      query.timestamp = { $gte: startOfToday, $lte: endOfToday };
    } else if (appliedRange === '7_days' || appliedRange === '7days') {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      query.timestamp = { $gte: sevenDaysAgo };
    } else if (appliedRange === 'specific_month' && month) {
      const [yearStr, monthStr] = month.split('-');
      const y = parseInt(yearStr, 10);
      const m = parseInt(monthStr, 10) - 1;
      const startOfMonth = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
      const endOfMonth = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
      query.timestamp = { $gte: startOfMonth, $lte: endOfMonth };
    } else if (appliedRange === 'custom' || startDate || dateFrom) {
      const from = startDate || dateFrom;
      const to = endDate || dateTo;
      query.timestamp = {};
      if (from) {
        const s = new Date(from);
        s.setHours(0, 0, 0, 0);
        query.timestamp.$gte = s;
      }
      if (to) {
        const e = new Date(to);
        e.setHours(23, 59, 59, 999);
        query.timestamp.$lte = e;
      }
    }

    // 5. Sorting: newest (timestamp: -1) vs oldest (timestamp: 1)
    const sortParam = (sort || sortBy || '').toLowerCase();
    const sortOrder = sortParam === 'oldest' || sortParam === 'asc' ? 1 : -1;

    // 6. Single aggregation with $facet for pagination + count in 1 round trip
    const [result] = await DocumentLog.aggregate([
      { $match: query },
      { $sort: { timestamp: sortOrder } },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $skip: skip },
            { $limit: pageSize },
            {
              $project: {
                id: '$_id',
                _id: 0,
                fileId: 1,
                fileNumber: 1,
                userId: 1,
                userName: 1,
                userRole: 1,
                departmentId: 1,
                departmentName: 1,
                action: 1,
                details: 1,
                ipAddress: 1,
                timestamp: 1,
              },
            },
          ],
        },
      },
    ]);

    const total = result?.metadata?.[0]?.total || 0;
    const logs = result?.data || [];

    const formatted = formatPaginatedResponse({
      total,
      page,
      pageSize,
      data: logs,
    });

    res.status(200).json({
      ...formatted,
      timeRangeApplied: appliedRange || 'all_time',
      sortOrder: sortOrder === 1 ? 'oldest' : 'newest',
    });
  } catch (error) {
    next(error);
  }
};
