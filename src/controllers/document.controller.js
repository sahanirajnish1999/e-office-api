import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { Document } from '../models/document.model.js';
import { Department } from '../models/department.model.js';
import { DocumentLog } from '../models/document.log.model.js';
import { DocumentPermission } from '../models/document.permission.model.js';
import { DocumentForward } from '../models/document.forward.model.js';
import { DocumentSticky } from '../models/document.sticky.model.js';
import { DocumentSignature } from '../models/document.signature.model.js';
import { DocumentRemark } from '../models/document.remark.model.js';
import { DocumentFile } from '../models/document.file.model.js';
import { DocumentReplica } from '../models/document.replica.model.js';
import { VirtualStickyNote } from '../models/virtual.sticky.model.js';
import { User } from '../models/user.model.js';
import { DocumentWorkflowStatus } from '../models/document.workflow.status.model.js';
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
    const uploadedFiles = [];
    if (req.files?.files && Array.isArray(req.files.files)) {
      uploadedFiles.push(...req.files.files);
    }
    if (req.files?.file && Array.isArray(req.files.file)) {
      uploadedFiles.push(...req.files.file);
    } else if (req.file) {
      uploadedFiles.push(req.file);
    }
    const logoFile = req.files?.logo?.[0];

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
      pageNumber,
      filePageNumber,
    } = req.body;

    const finalPageNumber = parseInt(pageNumber || filePageNumber || 1, 10) || 1;
    const finalTitle = (title || fileTitle || '').trim();
    const finalSubject = (subject || fileSubject || '').trim();
    const finalRegistrationDate = registrationDate || fileDate;

    if (!finalTitle || !finalSubject) {
      return res.status(400).json({
        success: false,
        message: 'File title and subject are required fields',
      });
    }

    if (!finalRegistrationDate) {
      return res.status(400).json({
        success: false,
        message: 'registrationDate must be chosen manually (e.g., 2026-11-17)',
      });
    }

    // Validate priority
    const validPriorities = ['routine', 'urgent', 'immediate'];
    const chosenPriority = (priority || filePriority || 'routine').toLowerCase();
    if (!validPriorities.includes(chosenPriority)) {
      return res.status(400).json({
        success: false,
        message: `Invalid priority '${chosenPriority}'. Allowed options: ${validPriorities.join(', ')}`,
      });
    }

    // Validate accessControl
    const validAccessControls = ['general', 'restricted', 'confidential', 'secret'];
    const chosenAccess = (accessControl || targetAudience || 'general').toLowerCase();
    if (!validAccessControls.includes(chosenAccess)) {
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
      return res.status(400).json({
        success: false,
        message: 'A valid departmentId must be specified for this file',
      });
    }

    const dept = await Department.findById(targetDeptId);
    if (!dept) {
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

    // Organize uploaded file(s) in uploads/uploaded-files/<docId>/files/ and store in DocumentFile
    const createdDocumentFiles = [];
    let totalDocPages = 0;

    for (let i = 0; i < uploadedFiles.length; i++) {
      const uFile = uploadedFiles[i];
      const moved = moveToDocumentFolder(uFile.path, docId, 'files');
      const finalStoredFilename = moved ? moved.filename : uFile.filename;
      const finalFilePath = moved ? moved.destPath : uFile.path;
      const finalFileUrl = moved ? moved.fileUrl : `/uploads/${uFile.filename}`;
      const originalName = uFile.originalname || '';
      const mimeType = uFile.mimetype || '';
      const fileSize = uFile.size || 0;
      // Single file takes finalPageNumber; multiple files default to 1 page each unless specified
      const filePages = uploadedFiles.length === 1 ? finalPageNumber : 1;
      totalDocPages += filePages;

      const docFileRecord = await DocumentFile.create({
        documentId: docId,
        uploadUserId: req.user.id || req.user._id,
        uploadTime: new Date(),
        originalName,
        storedFilename: finalStoredFilename,
        filePath: finalFilePath,
        fileUrl: finalFileUrl,
        mimeType,
        fileSize,
        pageNumber: filePages,
        fileSummary: (req.body.fileSummary || '').trim(),
        status: 'approve',
        approvedBy: req.user.id || req.user._id,
        approvedAt: new Date(),
      }).catch((fileErr) => {
        console.warn('Warning creating initial DocumentFile record:', fileErr.message);
        return null;
      });

      if (docFileRecord) {
        createdDocumentFiles.push(docFileRecord);
      }
    }

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

    // Create Main Document (Stays ultra-lightweight: ~1-2 KB, all file details kept in DocumentFile)
    const document = await Document.create({
      _id: docId,
      fileNumber: finalFileNumber,
      title: finalTitle,
      subject: finalSubject,
      priority: chosenPriority,
      accessControl: chosenAccess,
      registrationDate: new Date(finalRegistrationDate),
      highlights: parsedHighlights,
      pageNumber: totalDocPages,
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

    const responseData = document.toObject ? document.toObject() : { ...document._doc };
    responseData.files = createdDocumentFiles;

    res.status(201).json({
      success: true,
      message: 'Document uploaded and created successfully',
      data: responseData,
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
    if (req.user?.role !== 'super_admin' && req.user?.role !== 'ministry_admin') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only Super Admin or Ministry Admin has permission to search and list documents',
      });
    }

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
      if (departmentId && isValidObjectId(departmentId)) {
        query.departmentId = new mongoose.Types.ObjectId(departmentId);
      } else if (departmentId) {
        query.departmentId = departmentId;
      }
    } else if (req.user.role === 'ministry_admin' && req.user.ministryId) {
      const ministryDeptIds = await Department.find({ ministryId: req.user.ministryId }).distinct('_id');
      if (departmentId) {
        if (!ministryDeptIds.some((id) => id.toString() === departmentId.toString())) {
          return res.status(200).json(formatPaginatedResponse({ total: 0, page: 1, pageSize: 20, data: [] }));
        }
        query.departmentId = isValidObjectId(departmentId) ? new mongoose.Types.ObjectId(departmentId) : departmentId;
      } else {
        query.departmentId = { $in: ministryDeptIds.map((id) => new mongoose.Types.ObjectId(id)) };
      }
    } else if (req.user.role === 'department_admin') {
      const targetDeptObjId = isValidObjectId(userDeptId) ? new mongoose.Types.ObjectId(userDeptId) : userDeptId;
      const forwardedDocIds = await DocumentForward.distinct('documentId', {
        targetDepartmentId: targetDeptObjId,
        isDeletedForDept: false,
      });

      query.$or = [
        { departmentId: targetDeptObjId, isDeletedForOriginDept: false },
        { _id: { $in: forwardedDocIds } },
      ];
    } else {
      // Employee scoping
      const userObjId = isValidObjectId(userId) ? new mongoose.Types.ObjectId(userId) : userId;
      const targetDeptObjId = isValidObjectId(userDeptId) ? new mongoose.Types.ObjectId(userDeptId) : userDeptId;

      const userPermittedDocIds = await DocumentPermission.distinct('documentId', {
        userId: userObjId,
      });

      // Check forwarded files accessible to employee
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

      query.$or = [
        {
          departmentId: targetDeptObjId,
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
      const searchConditions = [
        { title: { $regex: searchTerm, $options: 'i' } },
        { subject: { $regex: searchTerm, $options: 'i' } },
        { fileNumber: { $regex: searchTerm, $options: 'i' } },
      ];
      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: searchConditions }];
        delete query.$or;
      } else {
        query.$or = searchConditions;
      }
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
      const accessorObjId = isValidObjectId(accessorId) ? new mongoose.Types.ObjectId(accessorId) : accessorId;
      const accessorPermittedDocIds = await DocumentPermission.distinct('documentId', {
        userId: accessorObjId,
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

    // Optimized Single-Roundtrip Aggregation Pipeline with $facet & $lookup
    const [result] = await Document.aggregate([
      { $match: query },
      {
        $facet: {
          totalCount: [{ $count: 'total' }],
          paginatedData: [
            { $sort: sortOptions },
            { $skip: skip },
            { $limit: pageSize },
            {
              $lookup: {
                from: 'departments',
                localField: 'departmentId',
                foreignField: '_id',
                as: 'departmentId',
                pipeline: [{ $project: { _id: 1, name: 1, code: 1 } }],
              },
            },
            { $unwind: { path: '$departmentId', preserveNullAndEmptyArrays: true } },
            {
              $lookup: {
                from: 'users',
                localField: 'createdBy',
                foreignField: '_id',
                as: 'createdBy',
                pipeline: [{ $project: { _id: 1, name: 1, email: 1 } }],
              },
            },
            { $unwind: { path: '$createdBy', preserveNullAndEmptyArrays: true } },
            {
              $addFields: {
                id: '$_id',
                fileTitle: '$title',
                fileSubject: '$subject',
                filePriority: '$priority',
                fileDate: '$registrationDate',
                targetAudience: '$accessControl',
              },
            },
            {
              $project: {
                __v: 0,
              },
            },
          ],
        },
      },
    ]);

    const total = result?.totalCount?.[0]?.total || 0;
    const documents = result?.paginatedData || [];

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
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID format',
      });
    }

    const currentUserId = req.user.id || req.user._id;

    // Single-roundtrip aggregation pipeline: replaces 15 separate queries with 1 database operation
    const [document] = await Document.aggregate([
      {
        $match: { _id: new mongoose.Types.ObjectId(id) },
      },

      // 1. Join Department
      {
        $lookup: {
          from: 'departments',
          localField: 'departmentId',
          foreignField: '_id',
          as: 'departmentId',
          pipeline: [{ $project: { _id: 1, name: 1, code: 1, description: 1 } }],
        },
      },
      { $unwind: { path: '$departmentId', preserveNullAndEmptyArrays: true } },

      // 2. Join CreatedBy User
      {
        $lookup: {
          from: 'users',
          localField: 'createdBy',
          foreignField: '_id',
          as: 'createdBy',
          pipeline: [{ $project: { _id: 1, name: 1, email: 1 } }],
        },
      },
      { $unwind: { path: '$createdBy', preserveNullAndEmptyArrays: true } },

      // 3. Join Forwarded Departments
      {
        $lookup: {
          from: 'documentforwards',
          let: { docId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$documentId', '$$docId'] },
                    { $eq: ['$isDeletedForDept', false] },
                  ],
                },
              },
            },
            {
              $lookup: {
                from: 'departments',
                localField: 'targetDepartmentId',
                foreignField: '_id',
                as: 'targetDepartmentId',
                pipeline: [{ $project: { _id: 1, name: 1, code: 1 } }],
              },
            },
            { $unwind: { path: '$targetDepartmentId', preserveNullAndEmptyArrays: true } },
            {
              $lookup: {
                from: 'departments',
                localField: 'fromDepartmentId',
                foreignField: '_id',
                as: 'fromDepartmentId',
                pipeline: [{ $project: { _id: 1, name: 1, code: 1 } }],
              },
            },
            { $unwind: { path: '$fromDepartmentId', preserveNullAndEmptyArrays: true } },
            {
              $lookup: {
                from: 'users',
                localField: 'forwardedBy',
                foreignField: '_id',
                as: 'forwardedBy',
                pipeline: [{ $project: { _id: 1, name: 1, email: 1 } }],
              },
            },
            { $unwind: { path: '$forwardedBy', preserveNullAndEmptyArrays: true } },
          ],
          as: 'forwardedDepartments',
        },
      },

      // 4. Join Collaborative Sticky Notes
      {
        $lookup: {
          from: 'documentstickies',
          let: { docId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$documentId', '$$docId'] } } },
            { $sort: { createdAt: -1 } },
            {
              $lookup: {
                from: 'users',
                localField: 'userId',
                foreignField: '_id',
                as: 'userId',
                pipeline: [{ $project: { _id: 1, name: 1, email: 1, role: 1, departmentId: 1 } }],
              },
            },
            { $unwind: { path: '$userId', preserveNullAndEmptyArrays: true } },
            {
              $lookup: {
                from: 'users',
                localField: 'createdBy',
                foreignField: '_id',
                as: 'createdBy',
                pipeline: [{ $project: { _id: 1, name: 1, email: 1 } }],
              },
            },
            { $unwind: { path: '$createdBy', preserveNullAndEmptyArrays: true } },
            {
              $lookup: {
                from: 'users',
                localField: 'approvedBy',
                foreignField: '_id',
                as: 'approvedBy',
                pipeline: [{ $project: { _id: 1, name: 1, email: 1, role: 1 } }],
              },
            },
            { $unwind: { path: '$approvedBy', preserveNullAndEmptyArrays: true } },
          ],
          as: 'stickies',
        },
      },

      // 5. Join Digital Signatures
      {
        $lookup: {
          from: 'documentsignatures',
          let: { docId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$documentId', '$$docId'] } } },
            { $sort: { createdAt: -1 } },
            {
              $lookup: {
                from: 'users',
                localField: 'userId',
                foreignField: '_id',
                as: 'userId',
                pipeline: [{ $project: { _id: 1, name: 1, email: 1, designation: 1, employeeId: 1, departmentId: 1 } }],
              },
            },
            { $unwind: { path: '$userId', preserveNullAndEmptyArrays: true } },
            {
              $lookup: {
                from: 'users',
                localField: 'approvedBy',
                foreignField: '_id',
                as: 'approvedBy',
                pipeline: [{ $project: { _id: 1, name: 1, email: 1, designation: 1 } }],
              },
            },
            { $unwind: { path: '$approvedBy', preserveNullAndEmptyArrays: true } },
          ],
          as: 'signatures',
        },
      },

      // 6. Join Document Remarks
      {
        $lookup: {
          from: 'documentremarks',
          let: { docId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$documentId', '$$docId'] } } },
            { $sort: { createdAt: -1 } },
            {
              $lookup: {
                from: 'users',
                localField: 'userId',
                foreignField: '_id',
                as: 'userId',
                pipeline: [{ $project: { _id: 1, name: 1, email: 1, designation: 1, employeeId: 1, departmentId: 1 } }],
              },
            },
            { $unwind: { path: '$userId', preserveNullAndEmptyArrays: true } },
          ],
          as: 'remarks',
        },
      },

      // 7. Join Attached Files
      {
        $lookup: {
          from: 'documentfiles',
          let: { docId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$documentId', '$$docId'] } } },
            { $sort: { pageNumber: 1, createdAt: -1 } },
            {
              $lookup: {
                from: 'users',
                localField: 'uploadUserId',
                foreignField: '_id',
                as: 'uploadUserId',
                pipeline: [{ $project: { _id: 1, name: 1, email: 1, designation: 1, employeeId: 1, departmentId: 1 } }],
              },
            },
            { $unwind: { path: '$uploadUserId', preserveNullAndEmptyArrays: true } },
            {
              $lookup: {
                from: 'users',
                localField: 'approvedBy',
                foreignField: '_id',
                as: 'approvedBy',
                pipeline: [{ $project: { _id: 1, name: 1, email: 1, designation: 1 } }],
              },
            },
            { $unwind: { path: '$approvedBy', preserveNullAndEmptyArrays: true } },
          ],
          as: 'files',
        },
      },

      // 8. Join Personal Virtual Stickies for Requesting User (Pinned first, then latest date)
      {
        $lookup: {
          from: 'virtualstickynotes',
          let: { docId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$documentId', '$$docId'] },
                    { $eq: ['$userId', new mongoose.Types.ObjectId(currentUserId)] },
                  ],
                },
              },
            },
            { $sort: { isPinned: -1, createdAt: -1 } },
          ],
          as: 'userVirtualStickies',
        },
      },

      // 9. Add Virtual Aliases & clean ID for full backward compatibility
      {
        $addFields: {
          id: '$_id',
          fileTitle: '$title',
          fileSubject: '$subject',
          filePriority: '$priority',
          fileDate: '$registrationDate',
          targetAudience: '$accessControl',
          pageNumber: {
            $cond: {
              if: { $gt: [{ $size: '$files' }, 0] },
              then: { $sum: '$files.pageNumber' },
              else: { $ifNull: ['$pageNumber', 0] },
            },
          },
        },
      },
      {
        $project: {
          __v: 0,
        },
      },
    ]);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    res.status(200).json({
      success: true,
      userPermission: req.userPermission,
      data: document,
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
    const isMinistryAdmin =
      req.user.role === 'ministry_admin' && req.userPermission?.isMinistryAdmin;

    if (!isSuperAdmin && !isOriginAdmin && !isMinistryAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only Super Admin, Ministry Admin, or Originating Department Admin can update main permissions',
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

    const matchDocId = isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : id;

    // Single-roundtrip aggregation pipeline with $facet & $lookup
    const [result] = await DocumentPermission.aggregate([
      { $match: { documentId: matchDocId } },
      {
        $facet: {
          totalCount: [{ $count: 'total' }],
          paginatedData: [
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: pageSize },
            {
              $lookup: {
                from: 'users',
                localField: 'userId',
                foreignField: '_id',
                as: 'userId',
                pipeline: [{ $project: { _id: 1, name: 1, email: 1, role: 1, departmentId: 1 } }],
              },
            },
            { $unwind: { path: '$userId', preserveNullAndEmptyArrays: true } },
            {
              $lookup: {
                from: 'users',
                localField: 'grantedBy',
                foreignField: '_id',
                as: 'grantedBy',
                pipeline: [{ $project: { _id: 1, name: 1, email: 1 } }],
              },
            },
            { $unwind: { path: '$grantedBy', preserveNullAndEmptyArrays: true } },
            {
              $addFields: {
                id: '$_id',
              },
            },
            {
              $project: {
                __v: 0,
              },
            },
          ],
        },
      },
    ]);

    const total = result?.totalCount?.[0]?.total || 0;
    const permissions = result?.paginatedData || [];

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
 * 8. Forward Document to Another Department / Officer
 * Supports multi-stage forward: draft | sent
 */
export const forwardDocument = async (req, res, next) => {
  try {
    const {
      targetDepartmentId,
      targetUserId,
      priority,
      accessControl,
      targetAudience,
      remarks,
      allowedUsers,
      status: requestedStatus,
    } = req.body;
    const document = req.document;

    if (!targetDepartmentId && !targetUserId) {
      return res.status(400).json({
        success: false,
        message: 'Either targetDepartmentId or targetUserId is required to forward document',
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

    let finalTargetDeptId = targetDepartmentId;
    let targetUser = null;

    // If targetUserId is provided, validate user and auto-derive their departmentId
    if (targetUserId) {
      if (!isValidObjectId(targetUserId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid targetUserId format',
        });
      }
      targetUser = await User.findById(targetUserId).populate('departmentId', 'name code');
      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: 'Target user to forward to not found',
        });
      }
      if (!targetUser.departmentId) {
        return res.status(400).json({
          success: false,
          message: `Target user ${targetUser.name} is not assigned to any department`,
        });
      }
      finalTargetDeptId = targetUser.departmentId._id || targetUser.departmentId;

      const existingUserForward = await DocumentForward.findOne({
        documentId: document._id,
        targetUserId,
        status: { $in: ['draft', 'sent', 'resend', 'receive'] },
        isDeletedForDept: false,
      });

      if (existingUserForward) {
        return res.status(409).json({
          success: false,
          message: `Document has already been forwarded to officer ${targetUser.name} (Status: ${existingUserForward.status})`,
        });
      }
    } else if (targetDepartmentId) {
      if (!isValidObjectId(targetDepartmentId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid targetDepartmentId format',
        });
      }
      const existingDeptForward = await DocumentForward.findOne({
        documentId: document._id,
        targetDepartmentId,
        targetUserId: null,
        status: { $in: ['draft', 'sent', 'resend', 'receive'] },
        isDeletedForDept: false,
      });

      if (existingDeptForward) {
        return res.status(409).json({
          success: false,
          message: `Document has already been forwarded to this department (Status: ${existingDeptForward.status})`,
        });
      }
    }

    const targetDept = targetUser?.departmentId?.name
      ? targetUser.departmentId
      : await Department.findById(finalTargetDeptId);
    if (!targetDept) {
      return res.status(404).json({
        success: false,
        message: 'Target department to forward to not found',
      });
    }

    const chosenPriority = (priority || document.priority || 'routine').toLowerCase();
    const chosenAccess = (accessControl || targetAudience || 'general').toLowerCase();
    const initialStatus = requestedStatus === 'draft' ? 'draft' : 'sent';

    const forwardRecord = await DocumentForward.create({
      documentId: document._id,
      fromDepartmentId: document.departmentId,
      targetDepartmentId: finalTargetDeptId,
      targetUserId: targetUserId || null,
      forwardedBy: req.user.id,
      priority: chosenPriority,
      accessControl: chosenAccess,
      remarks: remarks || '',
      status: initialStatus,
      sentAt: initialStatus === 'sent' ? new Date() : null,
      allowedUsers: Array.isArray(allowedUsers) ? allowedUsers : [],
    });

    const targetLabel = targetUser
      ? `officer '${targetUser.name}' (${targetDept.name})`
      : `'${targetDept.name}' department`;

    // Only log if forwarded (sent). Draft forwards are kept silent without audit logs
    if (initialStatus === 'sent') {
      await recordDocumentLog({
        fileId: document._id,
        fileNumber: document.fileNumber || '',
        user: req.user,
        action: 'File Forwarded',
        details: `Document forwarded to ${targetLabel} by ${req.user.name || req.user.email}`,
        req,
      });
    }

    const populated = await DocumentForward.findById(forwardRecord._id)
      .populate('targetDepartmentId', 'name code')
      .populate('targetUserId', 'name employeeId designation email')
      .populate('fromDepartmentId', 'name code');

    res.status(200).json({
      success: true,
      message:
        initialStatus === 'draft'
          ? `Document forward saved as draft for ${targetUser ? targetUser.name : targetDept.name}`
          : targetUser
          ? `Document successfully forwarded to ${targetUser.name} (${targetDept.name})`
          : `Document successfully forwarded to department: ${targetDept.name}`,
      data: populated || forwardRecord,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 8.1 Dispatch Draft Forward
 */
export const sendDraftForward = async (req, res, next) => {
  try {
    const { id, forwardId } = req.params;
    const document = req.document;

    const forwardRecord = await DocumentForward.findOne({
      _id: forwardId,
      documentId: document._id,
      isDeletedForDept: false,
    });

    if (!forwardRecord) {
      return res.status(404).json({
        success: false,
        message: 'Forward record not found',
      });
    }

    const isSuperAdmin = req.user.role === 'super_admin';
    const isSender = forwardRecord.forwardedBy.toString() === req.user.id.toString();
    if (!isSuperAdmin && !isSender) {
      return res.status(403).json({
        success: false,
        message: 'Only the forward creator or Super Admin can dispatch this draft',
      });
    }

    if (forwardRecord.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: `Forward cannot be dispatched because its status is already '${forwardRecord.status}'`,
      });
    }

    forwardRecord.status = 'sent';
    forwardRecord.sentAt = new Date();
    await forwardRecord.save();

    await recordDocumentLog({
      fileId: document._id,
      fileNumber: document.fileNumber || '',
      user: req.user,
      action: 'File Forwarded',
      details: `Draft forward dispatched to target by ${req.user.name || req.user.email}`,
      req,
    });

    const populated = await DocumentForward.findById(forwardRecord._id)
      .populate('targetDepartmentId', 'name code')
      .populate('targetUserId', 'name employeeId designation email')
      .populate('fromDepartmentId', 'name code');

    res.status(200).json({
      success: true,
      message: 'Draft forward dispatched successfully',
      data: populated || forwardRecord,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 8.2 Resend Forwarded Document
 */
export const resendForward = async (req, res, next) => {
  try {
    const { id, forwardId } = req.params;
    const { remarks, priority } = req.body;
    const document = req.document;

    const forwardRecord = await DocumentForward.findOne({
      _id: forwardId,
      documentId: document._id,
      isDeletedForDept: false,
    });

    if (!forwardRecord) {
      return res.status(404).json({
        success: false,
        message: 'Forward record not found',
      });
    }

    const isSuperAdmin = req.user.role === 'super_admin';
    const isSender = forwardRecord.forwardedBy.toString() === req.user.id.toString();
    const isSenderDeptAdmin =
      req.user.role === 'department_admin' &&
      req.user.departmentId?.toString() === forwardRecord.fromDepartmentId.toString();

    if (!isSuperAdmin && !isSender && !isSenderDeptAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to resend this forward',
      });
    }

    if (forwardRecord.status === 'receive') {
      return res.status(400).json({
        success: false,
        message: 'Cannot resend a file that has already been received by recipient',
      });
    }

    if (forwardRecord.status === 'recalled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot resend a recalled forward. Please create a new forward instead.',
      });
    }

    if (forwardRecord.status === 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Forward is currently in draft. Use the send endpoint to dispatch it.',
      });
    }

    forwardRecord.status = 'resend';
    forwardRecord.resendCount = (forwardRecord.resendCount || 0) + 1;
    forwardRecord.lastResentAt = new Date();
    if (remarks) {
      forwardRecord.resendRemarks = remarks;
      forwardRecord.remarks = remarks;
    }
    if (priority) {
      forwardRecord.priority = priority.toLowerCase();
    }
    await forwardRecord.save();

    await recordDocumentLog({
      fileId: document._id,
      fileNumber: document.fileNumber || '',
      user: req.user,
      action: 'File Resent',
      details: `Document re-forwarded (Attempt #${forwardRecord.resendCount}) by ${req.user.name || req.user.email}${remarks ? `. Remarks: ${remarks}` : ''}`,
      req,
    });

    const populated = await DocumentForward.findById(forwardRecord._id)
      .populate('targetDepartmentId', 'name code')
      .populate('targetUserId', 'name employeeId designation email')
      .populate('fromDepartmentId', 'name code');

    res.status(200).json({
      success: true,
      message: `Document forward resent successfully (Attempt #${forwardRecord.resendCount})`,
      data: populated || forwardRecord,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 8.3 Recall Forwarded Document
 */
export const recallForward = async (req, res, next) => {
  try {
    const { id, forwardId } = req.params;
    const { reason, remarks } = req.body;
    const document = req.document;

    const forwardRecord = await DocumentForward.findOne({
      _id: forwardId,
      documentId: document._id,
      isDeletedForDept: false,
    });

    if (!forwardRecord) {
      return res.status(404).json({
        success: false,
        message: 'Forward record not found',
      });
    }

    const isSuperAdmin = req.user.role === 'super_admin';
    const isSender = forwardRecord.forwardedBy.toString() === req.user.id.toString();
    const isSenderDeptAdmin =
      req.user.role === 'department_admin' &&
      req.user.departmentId?.toString() === forwardRecord.fromDepartmentId.toString();

    if (!isSuperAdmin && !isSender && !isSenderDeptAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to recall this forward',
      });
    }

    if (forwardRecord.status === 'receive') {
      return res.status(400).json({
        success: false,
        message: 'Cannot recall a file that has already been received by the recipient',
      });
    }

    if (forwardRecord.status === 'recalled') {
      return res.status(400).json({
        success: false,
        message: 'Forward has already been recalled',
      });
    }

    if (forwardRecord.status === 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Draft forward cannot be recalled. You can edit or delete the draft.',
      });
    }

    const recallNote = reason || remarks || '';
    forwardRecord.status = 'recalled';
    forwardRecord.recalledAt = new Date();
    forwardRecord.recalledBy = req.user.id;
    forwardRecord.recallReason = recallNote;
    await forwardRecord.save();

    await recordDocumentLog({
      fileId: document._id,
      fileNumber: document.fileNumber || '',
      user: req.user,
      action: 'File Recalled',
      details: `Document forward recalled by ${req.user.name || req.user.email}${recallNote ? `. Reason: ${recallNote}` : ''}`,
      req,
    });

    const populated = await DocumentForward.findById(forwardRecord._id)
      .populate('targetDepartmentId', 'name code')
      .populate('targetUserId', 'name employeeId designation email')
      .populate('fromDepartmentId', 'name code');

    res.status(200).json({
      success: true,
      message: 'Document forward recalled successfully',
      data: populated || forwardRecord,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 8.4 Receive Forwarded Document
 * Recipient accepts custody: stamps receivedTime, unlocks permissions, creates workflow status and audit log
 */
export const receiveForward = async (req, res, next) => {
  try {
    const { id, forwardId } = req.params;
    const { remarks, isPhysicalFileReceived } = req.body;

    const document = await Document.findById(id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const forwardRecord = await DocumentForward.findOne({
      _id: forwardId,
      documentId: document._id,
      isDeletedForDept: false,
    });

    if (!forwardRecord) {
      return res.status(404).json({
        success: false,
        message: 'Forward record not found',
      });
    }

    const isSuperAdmin = req.user.role === 'super_admin';
    const isTargetUser =
      forwardRecord.targetUserId &&
      forwardRecord.targetUserId.toString() === req.user.id.toString();
    const isTargetDeptAdmin =
      req.user.role === 'department_admin' &&
      req.user.departmentId?.toString() === forwardRecord.targetDepartmentId.toString();
    const isTargetDeptMember =
      !forwardRecord.targetUserId &&
      req.user.departmentId?.toString() === forwardRecord.targetDepartmentId.toString();

    if (!isSuperAdmin && !isTargetUser && !isTargetDeptAdmin && !isTargetDeptMember) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to receive this forwarded document',
      });
    }

    if (forwardRecord.status === 'receive') {
      return res.status(400).json({
        success: false,
        message: 'This document forward has already been received',
      });
    }

    if (forwardRecord.status === 'recalled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot receive: this document forward was recalled by the sender',
      });
    }

    if (forwardRecord.status === 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Cannot receive: this forward is still in draft and has not been dispatched',
      });
    }

    const now = new Date();
    forwardRecord.status = 'receive';
    forwardRecord.receivedBy = req.user.id;
    forwardRecord.receivedTime = now;

    if (isPhysicalFileReceived === true || isPhysicalFileReceived === 'true') {
      forwardRecord.isPhysicalFileReceived = true;
      forwardRecord.physicalFileReceivedTime = now;
    }

    await forwardRecord.save();

    // 1. Grant DocumentPermission to recipient officer
    const permUserId = forwardRecord.targetUserId || req.user.id;
    await DocumentPermission.findOneAndUpdate(
      { documentId: document._id, userId: permUserId },
      {
        $set: {
          documentId: document._id,
          userId: permUserId,
          departmentId: forwardRecord.targetDepartmentId,
          permissions: {
            canView: true,
            canRemark: true,
            canSuggestChange: true,
            canDownload: true,
          },
          grantedBy: forwardRecord.forwardedBy,
        },
      },
      { upsert: true, new: true }
    );

    // If allowedUsers were attached to the forward, grant them permissions now
    if (forwardRecord.allowedUsers && Array.isArray(forwardRecord.allowedUsers) && forwardRecord.allowedUsers.length > 0) {
      const permDocs = forwardRecord.allowedUsers.map((u) => ({
        documentId: document._id,
        userId: u.userId,
        departmentId: forwardRecord.targetDepartmentId,
        permissions: u.permissions || {
          canView: true,
          canRemark: true,
          canSuggestChange: true,
          canDownload: true,
        },
        grantedBy: forwardRecord.forwardedBy,
      }));
      await DocumentPermission.insertMany(permDocs, { ordered: false }).catch(() => {});
    }

    // 2. Create DocumentWorkflowStatus ONLY now upon receipt
    const workflowStatus = await DocumentWorkflowStatus.create({
      documentId: document._id,
      employeeId: req.user.id,
      departmentId: req.user.departmentId || forwardRecord.targetDepartmentId,
      status: 'receive',
      statusUpdateTime: now,
      remarks: remarks || 'Forwarded file acknowledged and received',
      isPhysicalFileReceived: forwardRecord.isPhysicalFileReceived,
      physicalFileReceivedTime: forwardRecord.physicalFileReceivedTime,
    });

    // 3. Create Audit DocumentLog
    await recordDocumentLog({
      fileId: document._id,
      fileNumber: document.fileNumber || '',
      user: req.user,
      action: 'File Received',
      details: `Document received and custody accepted by ${req.user.name || req.user.email}${forwardRecord.isPhysicalFileReceived ? ' (Physical file received)' : ''}${remarks ? `. Remarks: ${remarks}` : ''}`,
      req,
    });

    const populated = await DocumentForward.findById(forwardRecord._id)
      .populate('targetDepartmentId', 'name code')
      .populate('targetUserId', 'name employeeId designation email')
      .populate('fromDepartmentId', 'name code')
      .populate('receivedBy', 'name employeeId designation email');

    res.status(200).json({
      success: true,
      message: 'Document successfully received and custody accepted',
      data: {
        forward: populated || forwardRecord,
        workflowStatus,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 8.5 Get Pending Receipt Forwards (Incoming Queue)
 */
export const getPendingReceiptForwards = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const userDeptId = req.user.departmentId;

    const query = {
      isDeletedForDept: false,
      status: { $in: ['sent', 'resend'] },
      $or: [
        { targetUserId: userId },
        ...(userDeptId ? [{ targetDepartmentId: userDeptId, targetUserId: null }] : []),
      ],
    };

    const { page, pageSize, skip } = getPaginationParams(req.query);

    const [forwards, total] = await Promise.all([
      DocumentForward.find(query)
        .sort({ sentAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .populate('documentId', 'fileNumber title subject priority registrationDate')
        .populate('fromDepartmentId', 'name code')
        .populate('forwardedBy', 'name employeeId designation email'),
      DocumentForward.countDocuments(query),
    ]);

    const paginatedResponse = formatPaginatedResponse(forwards, total, page, pageSize);

    res.status(200).json({
      success: true,
      data: paginatedResponse,
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
    if (!comment || typeof comment !== 'string' || !comment.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Remark comment text is required',
      });
    }

    const document = req.document;
    const userName = req.user.name || req.user.email;

    const newRemark = await DocumentRemark.create({
      documentId: document._id,
      userId: req.user.id,
      userName,
      comment: comment.trim(),
    });

    await recordDocumentLog({
      fileId: document._id,
      user: req.user,
      action: 'ADD_REMARK',
      description: `Remark added by ${userName}`,
      details: { comment: newRemark.comment },
      req,
    });

    res.status(201).json({
      success: true,
      message: 'Remark added successfully',
      data: newRemark,
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
    const { note, color, pageNumber } = req.body;
    if (!note || !note.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Sticky note text is required',
      });
    }

    const document = req.document;

    // Always use authenticated user's ID and name
    const targetUserId = req.user.id || req.user._id;
    const authorName = req.user.name || req.user.email || 'User';

    const finalPageNumber = parseInt(pageNumber, 10) || 1;

    const newSticky = await DocumentSticky.create({
      documentId: document._id,
      userId: targetUserId,
      createdBy: targetUserId,
      authorName,
      color: color || 'yellow',
      note: note.trim(),
      pageNumber: finalPageNumber,
      status: 'pending',
      isApproved: false,
    });

    await recordDocumentLog({
      fileId: document._id,
      user: req.user,
      action: 'ADD_STICKY',
      description: `Sticky note (${newSticky.color}, page ${newSticky.pageNumber}) attached by ${authorName}`,
      details: { color: newSticky.color, note: newSticky.note, pageNumber: newSticky.pageNumber },
    });

    const allStickies = await DocumentSticky.find({ documentId: document._id }).sort({ createdAt: -1 });

    res.status(201).json({
      success: true,
      message: 'Virtual sticky note added successfully',
      data: allStickies,
      sticky: newSticky,
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

    if (req.user.role !== 'super_admin' && req.user.role !== 'department_admin' && req.user.role !== 'ministry_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only Department Admins, Ministry Admins, or Super Admins can sign and approve document notings',
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
 * 14.1 Archive & Preserve Document (Update Preserved Document)
 * Admin / Creator
 * PATCH /api/documents/:id/archive (alias: /api/documents/:id/preserve)
 */
export const archiveDocument = async (req, res, next) => {
  try {
    const documentId = req.params.id;
    if (!isValidObjectId(documentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID format',
      });
    }

    const document = req.document || (await Document.findById(documentId));
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const currentUserId = req.user.id || req.user._id;
    const isCreator = document.createdBy && document.createdBy.toString() === currentUserId.toString();
    const isSuperAdmin = req.user.role === 'super_admin';
    const isDeptAdmin =
      req.user.role === 'department_admin' &&
      document.departmentId &&
      req.user.departmentId &&
      document.departmentId.toString() === req.user.departmentId.toString();

    if (!isCreator && !isSuperAdmin && !isDeptAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only the document creator, originating Department Admin, or Super Admin can archive this document',
      });
    }

    const { preservedDate, preservationNotes, status } = req.body;

    // Transition status to archived (or update preservation metadata)
    document.status = status || 'archived';
    document.preservedDate = preservedDate ? new Date(preservedDate) : (document.preservedDate || new Date());
    document.preservedBy = currentUserId;
    if (preservationNotes !== undefined) {
      document.preservationNotes = (preservationNotes || '').trim();
    }

    await document.save();

    await recordDocumentLog({
      fileId: document._id,
      fileNumber: document.fileNumber || '',
      user: req.user,
      action: 'DOCUMENT_ARCHIVED',
      details: `Document '${document.title}' (File No: ${document.fileNumber || 'N/A'}) archived and preserved by ${req.user.name || req.user.email}${document.preservationNotes ? ` (Notes: ${document.preservationNotes})` : ''}`,
      req,
    });

    res.status(200).json({
      success: true,
      message: 'Document successfully archived and marked as preserved',
      data: document,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 14.2 List Archived & Preserved Documents (Paginated)
 * GET /api/documents/archived (alias: /api/documents/preserved)
 */
export const listArchivedDocuments = async (req, res, next) => {
  try {
    const {
      search,
      text,
      keyword,
      subject,
      departmentId,
      dateFrom,
      dateTo,
      preservedDateFrom,
      preservedDateTo,
      preservedDate,
      date,
    } = req.query;

    const andConditions = [{ status: 'archived' }];

    // Role-based scoping
    const userId = req.user.id || req.user._id;
    const userDeptId = req.user.departmentId;

    if (req.user.role === 'super_admin') {
      if (departmentId && isValidObjectId(departmentId)) {
        andConditions.push({ departmentId: new mongoose.Types.ObjectId(departmentId) });
      } else if (departmentId) {
        andConditions.push({ departmentId });
      }
    } else if (req.user.role === 'ministry_admin' && req.user.ministryId) {
      const ministryDeptIds = await Department.find({ ministryId: req.user.ministryId }).distinct('_id');
      if (departmentId) {
        if (!ministryDeptIds.some((id) => id.toString() === departmentId.toString())) {
          return res.status(200).json(formatPaginatedResponse({ total: 0, page: 1, pageSize: 20, data: [] }));
        }
        andConditions.push({ departmentId: isValidObjectId(departmentId) ? new mongoose.Types.ObjectId(departmentId) : departmentId });
      } else {
        andConditions.push({ departmentId: { $in: ministryDeptIds.map((id) => new mongoose.Types.ObjectId(id)) } });
      }
    } else if (req.user.role === 'department_admin') {
      const targetDeptObjId = isValidObjectId(userDeptId) ? new mongoose.Types.ObjectId(userDeptId) : userDeptId;
      const forwardedDocIds = await DocumentForward.distinct('documentId', {
        targetDepartmentId: targetDeptObjId,
        isDeletedForDept: false,
      });

      andConditions.push({
        $or: [
          { departmentId: targetDeptObjId, isDeletedForOriginDept: false },
          { _id: { $in: forwardedDocIds } },
          { createdBy: isValidObjectId(userId) ? new mongoose.Types.ObjectId(userId) : userId },
        ],
      });
    } else {
      // Employee scoping
      const userObjId = isValidObjectId(userId) ? new mongoose.Types.ObjectId(userId) : userId;
      const targetDeptObjId = isValidObjectId(userDeptId) ? new mongoose.Types.ObjectId(userDeptId) : userDeptId;

      const [userPermittedDocIds, forwardedDocIds] = await Promise.all([
        DocumentPermission.distinct('documentId', { userId: userObjId }),
        DocumentForward.distinct('documentId', {
          targetDepartmentId: targetDeptObjId,
          isDeletedForDept: false,
        }),
      ]);

      andConditions.push({
        $or: [
          { departmentId: targetDeptObjId, isDeletedForOriginDept: false },
          { _id: { $in: forwardedDocIds } },
          { _id: { $in: userPermittedDocIds } },
          { createdBy: userObjId },
        ],
      });
    }

    // Search filter across title, subject, and fileNumber
    const searchTerm = (search || text || keyword || subject || '').trim();
    if (searchTerm) {
      andConditions.push({
        $or: [
          { title: { $regex: searchTerm, $options: 'i' } },
          { subject: { $regex: searchTerm, $options: 'i' } },
          { fileNumber: { $regex: searchTerm, $options: 'i' } },
        ],
      });
    }

    // Preserved Date filter
    const rawSingleDate = (preservedDate || date || '').trim();
    const rawDateFrom = (preservedDateFrom || dateFrom || '').trim();
    const rawDateTo = (preservedDateTo || dateTo || '').trim();

    if (rawSingleDate) {
      const parsed = new Date(rawSingleDate);
      if (!isNaN(parsed.getTime())) {
        const utcStart = new Date(parsed);
        utcStart.setUTCHours(0, 0, 0, 0);
        const utcEnd = new Date(parsed);
        utcEnd.setUTCHours(23, 59, 59, 999);

        const locStart = new Date(parsed);
        locStart.setHours(0, 0, 0, 0);
        const locEnd = new Date(parsed);
        locEnd.setHours(23, 59, 59, 999);

        const minStart = new Date(Math.min(utcStart.getTime(), locStart.getTime()));
        const maxEnd = new Date(Math.max(utcEnd.getTime(), locEnd.getTime()));

        andConditions.push({
          preservedDate: { $gte: minStart, $lte: maxEnd },
        });
      }
    } else if (rawDateFrom || rawDateTo) {
      const dateCond = {};
      if (rawDateFrom) dateCond.$gte = new Date(rawDateFrom);
      if (rawDateTo) dateCond.$lte = new Date(rawDateTo);
      andConditions.push({ preservedDate: dateCond });
    }

    const finalMatch = andConditions.length > 0 ? { $and: andConditions } : {};
    const { page, pageSize, skip } = getPaginationParams(req.query);

    // Single-roundtrip aggregation pipeline with $facet & $lookup
    const [result] = await Document.aggregate([
      { $match: finalMatch },
      {
        $facet: {
          totalCount: [{ $count: 'total' }],
          paginatedData: [
            { $sort: { preservedDate: -1, createdAt: -1 } },
            { $skip: skip },
            { $limit: pageSize },
            {
              $lookup: {
                from: 'departments',
                localField: 'departmentId',
                foreignField: '_id',
                as: 'department',
                pipeline: [{ $project: { _id: 1, name: 1, code: 1 } }],
              },
            },
            { $unwind: { path: '$department', preserveNullAndEmptyArrays: true } },
            {
              $lookup: {
                from: 'documentfiles',
                localField: '_id',
                foreignField: 'documentId',
                as: 'attachedFiles',
                pipeline: [{ $project: { _id: 1, pageNumber: 1 } }],
              },
            },
            {
              $project: {
                _id: 0,
                fileId: '$_id',
                fileTitle: '$title',
                fileSubjectLine: '$subject',
                departmentName: { $ifNull: ['$department.name', ''] },
                fileNumber: '$fileNumber',
                filePagesNumber: {
                  $cond: {
                    if: { $gt: [{ $size: '$attachedFiles' }, 0] },
                    then: { $sum: '$attachedFiles.pageNumber' },
                    else: { $ifNull: ['$pageNumber', 0] },
                  },
                },
                attachedDocumentNumbers: { $size: '$attachedFiles' },
                preservedDate: '$preservedDate',
              },
            },
          ],
        },
      },
    ]);

    const total = result?.totalCount?.[0]?.total || 0;
    const documents = result?.paginatedData || [];

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

    // Clean up all attached files in DocumentFile collection
    await DocumentFile.deleteMany({ documentId: id });

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

/**
 * Get document and file counts for the current user (Department Admin, Employee, Super Admin)
 * GET /api/documents/my-counts
 * GET /api/documents/counts
 */
export const getMyDocumentCounts = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const userDeptId = req.user.departmentId;
    const userRole = req.user.role;

    const userObjId = isValidObjectId(userId) ? new mongoose.Types.ObjectId(userId) : userId;
    const targetDeptObjId = isValidObjectId(userDeptId) ? new mongoose.Types.ObjectId(userDeptId) : userDeptId;

    let accessConditions = null;

    if (userRole === 'super_admin') {
      // Super Admin has access to all active files
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

    // Single-roundtrip $facet aggregation on Document
    const [docMetrics] = await Document.aggregate([
      { $match: baseMatch },
      {
        $facet: {
          totalAccessibleFiles: [
            { $count: 'count' },
          ],
          totalCreatedFiles: [
            { $match: { createdBy: userObjId } },
            { $count: 'count' },
          ],
          totalUrgentFiles: [
            { $match: { priority: { $in: ['urgent', 'immediate'] } } },
            { $count: 'count' },
          ],
          totalPendingApprovalFiles: canApprove
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
    ]);

    const totalAccessibleFiles = docMetrics?.totalAccessibleFiles?.[0]?.count || 0;
    const totalCreatedFiles = docMetrics?.totalCreatedFiles?.[0]?.count || 0;
    const totalUrgentFiles = docMetrics?.totalUrgentFiles?.[0]?.count || 0;
    const totalPendingApprovalFiles = docMetrics?.totalPendingApprovalFiles?.[0]?.count || 0;

    res.status(200).json({
      success: true,
      message: 'User document counts retrieved successfully',
      data: {
        totalAccessibleFiles,
        totalCreatedFiles,
        totalUrgentFiles,
        totalPendingApprovalFiles,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Search & List Documents with Alphabetical Title Index (A-Z)
 * Projects strictly: fileNumber, fileName, fileSummary, fileDepartment, fileDate, fileStatus
 * GET /api/documents/alphabetical
 */
export const searchAndListDocumentsAlphabetical = async (req, res, next) => {
  try {
    const {
      letter,
      alphabet,
      createdDate,
      createdDateFrom,
      createdDateTo,
      createdAtFrom,
      createdAtTo,
      search,
      text,
      subject,
      accessUserName,
      accessorName,
      userName,
      departmentId,
      priority,
      accessControl,
      fileNumber,
      accessorId,
      dateFrom,
      dateTo,
      sortAlphabetical,
      includeWithdrawn,
    } = req.query;

    const andConditions = [];

    // 1. Base status filter
    if (includeWithdrawn !== 'true') {
      andConditions.push({ status: { $ne: 'withdrawn' } });
    }

    // 2. Role-based scoping
    const userId = req.user.id || req.user._id;
    const userDeptId = req.user.departmentId;

    if (req.user.role === 'super_admin') {
      if (departmentId && isValidObjectId(departmentId)) {
        andConditions.push({ departmentId: new mongoose.Types.ObjectId(departmentId) });
      } else if (departmentId) {
        andConditions.push({ departmentId });
      }
    } else if (req.user.role === 'ministry_admin' && req.user.ministryId) {
      const ministryDeptIds = await Department.find({ ministryId: req.user.ministryId }).distinct('_id');
      if (departmentId) {
        if (!ministryDeptIds.some((id) => id.toString() === departmentId.toString())) {
          return res.status(200).json(formatPaginatedResponse({ total: 0, page: 1, pageSize: 20, data: [] }));
        }
        andConditions.push({ departmentId: isValidObjectId(departmentId) ? new mongoose.Types.ObjectId(departmentId) : departmentId });
      } else {
        andConditions.push({ departmentId: { $in: ministryDeptIds.map((id) => new mongoose.Types.ObjectId(id)) } });
      }
    } else if (req.user.role === 'department_admin') {
      const targetDeptObjId = isValidObjectId(userDeptId) ? new mongoose.Types.ObjectId(userDeptId) : userDeptId;
      const forwardedDocIds = await DocumentForward.distinct('documentId', {
        targetDepartmentId: targetDeptObjId,
        isDeletedForDept: false,
      });

      andConditions.push({
        $or: [
          { departmentId: targetDeptObjId, isDeletedForOriginDept: false },
          { _id: { $in: forwardedDocIds } },
          { createdBy: isValidObjectId(userId) ? new mongoose.Types.ObjectId(userId) : userId },
        ],
      });
    } else {
      // Employee scoping: run lookups in parallel for maximum performance
      const userObjId = isValidObjectId(userId) ? new mongoose.Types.ObjectId(userId) : userId;
      const targetDeptObjId = isValidObjectId(userDeptId) ? new mongoose.Types.ObjectId(userDeptId) : userDeptId;

      const fwdFilter = {
        targetDepartmentId: targetDeptObjId,
        isDeletedForDept: false,
      };
      if (!req.user.isAuthorizedOfficer) {
        fwdFilter.accessControl = { $in: ['general', 'all_employees'] };
      } else {
        fwdFilter.accessControl = { $in: ['general', 'restricted', 'all_employees'] };
      }

      const [userPermittedDocIds, forwardedDocIds] = await Promise.all([
        DocumentPermission.distinct('documentId', { userId: userObjId }),
        DocumentForward.distinct('documentId', fwdFilter),
      ]);

      const originDeptAccessList = ['general', 'all_employees', 'department_only'];
      if (req.user.isAuthorizedOfficer) {
        originDeptAccessList.push('restricted');
      }

      andConditions.push({
        $or: [
          {
            departmentId: targetDeptObjId,
            isDeletedForOriginDept: false,
            accessControl: { $in: originDeptAccessList },
          },
          { _id: { $in: forwardedDocIds } },
          { _id: { $in: userPermittedDocIds } },
          { createdBy: userObjId },
        ],
      });
    }

    // 3. Alphabetical Title Index (A-Z) Initial Letter Filter
    const chosenLetter = (letter || alphabet || '').trim();
    if (chosenLetter) {
      const escapedLetter = chosenLetter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      andConditions.push({ title: { $regex: `^${escapedLetter}`, $options: 'i' } });
    }

    // 4. Search text in subject or title
    const searchKeyword = (search || text || subject || '').trim();
    if (searchKeyword) {
      andConditions.push({
        $or: [
          { title: { $regex: searchKeyword, $options: 'i' } },
          { subject: { $regex: searchKeyword, $options: 'i' } },
        ],
      });
    }

    // 5. File Date Filter: Strictly matched against registrationDate (single day or date range)
    let appliedDateLabel = null;
    const rawSingleDate = (createdDate || req.query.fileDate || req.query.date || '').trim();
    const rawDateFrom = (createdDateFrom || dateFrom || '').trim();
    const rawDateTo = (createdDateTo || dateTo || '').trim();

    if (rawSingleDate) {
      const parsed = new Date(rawSingleDate);
      if (!isNaN(parsed.getTime())) {
        const utcStart = new Date(parsed);
        utcStart.setUTCHours(0, 0, 0, 0);
        const utcEnd = new Date(parsed);
        utcEnd.setUTCHours(23, 59, 59, 999);

        const locStart = new Date(parsed);
        locStart.setHours(0, 0, 0, 0);
        const locEnd = new Date(parsed);
        locEnd.setHours(23, 59, 59, 999);

        const minStart = new Date(Math.min(utcStart.getTime(), locStart.getTime()));
        const maxEnd = new Date(Math.max(utcEnd.getTime(), locEnd.getTime()));

        andConditions.push({
          registrationDate: { $gte: minStart, $lte: maxEnd },
        });
        appliedDateLabel = rawSingleDate;
      }
    } else if (rawDateFrom || rawDateTo) {
      const dateCond = {};
      if (rawDateFrom) {
        const dFrom = new Date(rawDateFrom);
        if (!isNaN(dFrom.getTime())) dateCond.$gte = dFrom;
      }
      if (rawDateTo) {
        const dTo = new Date(rawDateTo);
        if (!isNaN(dTo.getTime())) {
          if (rawDateTo.length === 10) dTo.setHours(23, 59, 59, 999);
          dateCond.$lte = dTo;
        }
      }
      if (Object.keys(dateCond).length > 0) {
        andConditions.push({ registrationDate: dateCond });
      }
    }

    // 6. Search Access Users Name
    const targetUserName = (accessUserName || accessorName || userName || '').trim();
    if (targetUserName) {
      const matchedUsers = await User.find({
        name: { $regex: targetUserName, $options: 'i' },
      }).select('_id');

      const matchedUserIds = matchedUsers.map((u) => u._id);
      if (matchedUserIds.length === 0) {
        andConditions.push({ _id: { $in: [] } });
      } else {
        const permittedDocIds = await DocumentPermission.distinct('documentId', {
          userId: { $in: matchedUserIds },
        });

        andConditions.push({
          $or: [
            { _id: { $in: permittedDocIds } },
            { createdBy: { $in: matchedUserIds } },
          ],
        });
      }
    }

    // 7. Other multi-filters
    if (fileNumber) {
      andConditions.push({ fileNumber: { $regex: fileNumber.trim(), $options: 'i' } });
    }

    if (priority) {
      andConditions.push({ priority: priority.toLowerCase() });
    }

    if (accessControl) {
      andConditions.push({ accessControl: accessControl.toLowerCase() });
    }

    if (accessorId) {
      const accessorObjId = isValidObjectId(accessorId) ? new mongoose.Types.ObjectId(accessorId) : accessorId;
      const accessorPermittedDocIds = await DocumentPermission.distinct('documentId', {
        userId: accessorObjId,
      });
      andConditions.push({ _id: { $in: accessorPermittedDocIds } });
    }

    if (dateFrom || dateTo) {
      const regDateCond = {};
      if (dateFrom) regDateCond.$gte = new Date(dateFrom);
      if (dateTo) regDateCond.$lte = new Date(dateTo);
      andConditions.push({ registrationDate: regDateCond });
    }

    const finalMatch = andConditions.length > 0 ? { $and: andConditions } : {};

    // 8. Sorting: Default to Alphabetical title (asc A-Z)
    let sortOptions = { title: 1 };
    if (sortAlphabetical === 'desc') {
      sortOptions = { title: -1 };
    } else if (sortAlphabetical === 'date_desc') {
      sortOptions = { registrationDate: -1, createdAt: -1 };
    }

    // 9. Pagination
    const { page, pageSize, skip } = getPaginationParams(req.query);

    // 10. Single-Roundtrip Aggregation Pipeline with $facet & $lookup
    const [result] = await Document.aggregate([
      { $match: finalMatch },
      {
        $facet: {
          totalCount: [{ $count: 'total' }],
          paginatedData: [
            { $sort: sortOptions },
            { $skip: skip },
            { $limit: pageSize },
            {
              $lookup: {
                from: 'departments',
                localField: 'departmentId',
                foreignField: '_id',
                as: 'department',
                pipeline: [{ $project: { _id: 1, name: 1, code: 1 } }],
              },
            },
            { $unwind: { path: '$department', preserveNullAndEmptyArrays: true } },
            {
              $project: {
                _id: 0,
                fileId: '$_id',
                fileNumber: '$fileNumber',
                fileName: '$title',
                fileSummary: '$subject',
                fileDepartment: { $ifNull: ['$department.name', 'General'] },
                fileDate: '$registrationDate',
                fileStatus: '$status',
              },
            },
          ],
        },
      },
    ]);

    const total = result?.totalCount?.[0]?.total || 0;
    const documents = result?.paginatedData || [];

    const formatted = formatPaginatedResponse({
      total,
      page,
      pageSize,
      data: documents,
    });

    res.status(200).json({
      ...formatted,
      ...(chosenLetter ? { letter: chosenLetter.toUpperCase() } : {}),
      ...(appliedDateLabel ? { dateApplied: appliedDateLabel, createdDateApplied: appliedDateLabel } : {}),
    });
  } catch (error) {
    next(error);
  }
};
