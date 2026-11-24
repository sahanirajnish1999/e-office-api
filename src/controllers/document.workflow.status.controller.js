import mongoose from 'mongoose';
import { DocumentWorkflowStatus, VALID_STATUSES } from '../models/document.workflow.status.model.js';
import { Document } from '../models/document.model.js';
import { Department } from '../models/department.model.js';
import { DocumentForward } from '../models/document.forward.model.js';
import { DocumentPermission } from '../models/document.permission.model.js';
import { getPaginationParams, formatPaginatedResponse } from '../utils/pagination.util.js';
import { isValidObjectId } from '../utils/validator.util.js';

/**
 * Verify whether a user has permission to access a document
 */
export const verifyUserDocumentAccess = async (user, document) => {
  if (!user || !document) return false;

  // 1. Super Admin has unrestricted access to all files
  if (user.role === 'super_admin') {
    return true;
  }

  // 2. Ministry Admin has access to all documents in their ministry
  if (user.role === 'ministry_admin' && user.ministryId) {
    const dept = await Department.findById(document.departmentId);
    if (dept && dept.ministryId?.toString() === user.ministryId.toString()) {
      return true;
    }
    return false;
  }

  const userIdStr = (user.id || user._id)?.toString();
  const userDeptStr = user.departmentId ? user.departmentId.toString() : null;

  // 3. Originating department check
  const isOriginDept = userDeptStr && document.departmentId?.toString() === userDeptStr;
  if (isOriginDept && !document.isDeletedForOriginDept) {
    if (user.role === 'department_admin') {
      return true;
    }
    const docAccess = document.accessControl || document.targetAudience;
    if (['general', 'all_employees', 'department_only'].includes(docAccess)) {
      return true;
    }
    if (docAccess === 'restricted' && user.isAuthorizedOfficer) {
      return true;
    }
  }

  // 3.5. Direct user forward check (requires file to be received)
  if (userIdStr) {
    const userForwardRecord = await DocumentForward.findOne({
      documentId: document._id,
      targetUserId: userIdStr,
      status: 'receive',
      isDeletedForDept: false,
    });
    if (userForwardRecord) {
      return true;
    }
  }

  // 4. Forwarded department check (requires file to be received)
  if (userDeptStr) {
    const forwardedRecord = await DocumentForward.findOne({
      documentId: document._id,
      targetDepartmentId: userDeptStr,
      status: 'receive',
      isDeletedForDept: false,
    });
    if (forwardedRecord) {
      if (user.role === 'department_admin') {
        return true;
      }
      const fwdAccess = forwardedRecord.accessControl || forwardedRecord.targetAudience;
      if (['general', 'all_employees'].includes(fwdAccess)) {
        return true;
      }
      if (fwdAccess === 'restricted' && user.isAuthorizedOfficer) {
        return true;
      }
    }
  }

  // 5. Granular user permission check
  if (userIdStr) {
    const granularPerm = await DocumentPermission.findOne({
      documentId: document._id,
      userId: userIdStr,
    });
    if (granularPerm) {
      return true;
    }
  }

  return false;
};

/**
 * 1. Create / Record Document Status
 * Route: POST /api/document-statuses
 * Rule: Employee can ONLY record status for documents they have permission to access.
 */
export const createDocumentWorkflowStatus = async (req, res, next) => {
  try {
    const {
      documentId,
      status,
      remarks,
      isPhysicalFileReceived,
      isphysicalfilereceived,
      physicalFileReceivedTime,
      physicalfilereceivedtime,
    } = req.body;

    if (!documentId || !status) {
      return res.status(400).json({
        success: false,
        message: 'documentId and status are required',
      });
    }

    if (!isValidObjectId(documentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID format',
      });
    }

    // Normalize status and support common synonyms
    let normalizedStatus = status.toString().toLowerCase().trim();
    if (normalizedStatus === 'approved') normalizedStatus = 'approve';
    if (normalizedStatus === 'received') normalizedStatus = 'receive';

    if (!VALID_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status '${status}'. Must be one of: ${VALID_STATUSES.join(', ')}`,
      });
    }

    // Determine physical file receipt and timestamp
    const rawPhysical = isPhysicalFileReceived !== undefined ? isPhysicalFileReceived : isphysicalfilereceived;
    const isPhysicalReceived = rawPhysical !== undefined ? (rawPhysical === true || rawPhysical === 'true') : false;

    let receivedTime = null;
    const rawTime = physicalFileReceivedTime || physicalfilereceivedtime;
    if (isPhysicalReceived) {
      receivedTime = rawTime ? new Date(rawTime) : new Date();
    }

    // Find Document
    const document = await Document.findById(documentId);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    // Enforce permission: employee must have access to the document
    const hasAccess = await verifyUserDocumentAccess(req.user, document);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: You do not have permission to access document '${documentId}'`,
      });
    }

    // Mark previous statuses for this document as not current
    await DocumentWorkflowStatus.updateMany(
      { documentId: document._id, isCurrent: true },
      { $set: { isCurrent: false } }
    );

    // Create new workflow status entry
    const newStatus = await DocumentWorkflowStatus.create({
      documentId: document._id,
      employeeId: req.user.id || req.user._id,
      status: normalizedStatus,
      statusUpdateTime: new Date(),
      remarks: remarks ? remarks.toString().trim() : '',
      isCurrent: true,
      isPhysicalFileReceived: isPhysicalReceived,
      physicalFileReceivedTime: receivedTime,
      departmentId: req.user.departmentId || document.departmentId,
    });

    const populated = await DocumentWorkflowStatus.findById(newStatus._id)
      .populate('documentId', 'title fileNumber status departmentId')
      .populate('employeeId', 'name employeeId designation email departmentId')
      .populate('departmentId', 'name code');

    res.status(201).json({
      success: true,
      message: `Document status updated to '${normalizedStatus}' successfully`,
      data: populated,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 2. List Document Workflow Statuses
 * Route: GET /api/document-statuses
 */
export const listDocumentWorkflowStatuses = async (req, res, next) => {
  try {
    const { page, pageSize, skip } = getPaginationParams(req.query);
    const {
      documentId,
      employeeId,
      status,
      isCurrent,
      isPhysicalFileReceived,
      isphysicalfilereceived,
      dateFrom,
      dateTo,
    } = req.query;

    const query = {};

    const rawPhysicalFilter = isPhysicalFileReceived !== undefined ? isPhysicalFileReceived : isphysicalfilereceived;
    if (rawPhysicalFilter !== undefined) {
      query.isPhysicalFileReceived = rawPhysicalFilter === 'true' || rawPhysicalFilter === true;
    }

    // Filter by specific document
    if (documentId) {
      if (!isValidObjectId(documentId)) {
        return res.status(400).json({ success: false, message: 'Invalid document ID format' });
      }
      const document = await Document.findById(documentId);
      if (!document) {
        return res.status(404).json({ success: false, message: 'Document not found' });
      }
      const hasAccess = await verifyUserDocumentAccess(req.user, document);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to view status for this document',
        });
      }
      query.documentId = document._id;
    } else {
      // If no specific document is requested, scope query for non-super admins
      if (req.user.role === 'ministry_admin' && req.user.ministryId) {
        const ministryDeptIds = await Department.find({ ministryId: req.user.ministryId }).distinct('_id');
        const docIds = await Document.find({ departmentId: { $in: ministryDeptIds } }).distinct('_id');
        query.documentId = { $in: docIds };
      } else if (req.user.role === 'department_admin' && req.user.departmentId) {
        const forwardedDocIds = await DocumentForward.find({
          targetDepartmentId: req.user.departmentId,
          isDeletedForDept: false,
        }).distinct('documentId');
        const originDocIds = await Document.find({
          departmentId: req.user.departmentId,
          isDeletedForOriginDept: false,
        }).distinct('_id');
        query.documentId = { $in: [...originDocIds, ...forwardedDocIds] };
      } else if (req.user.role === 'employee') {
        const userId = req.user.id || req.user._id;
        const userDept = req.user.departmentId;

        const [originDocs, forwardedDocIds, permittedDocIds] = await Promise.all([
          userDept
            ? Document.find({
                departmentId: userDept,
                isDeletedForOriginDept: false,
                accessControl: req.user.isAuthorizedOfficer
                  ? { $in: ['general', 'all_employees', 'department_only', 'restricted'] }
                  : { $in: ['general', 'all_employees', 'department_only'] },
              }).distinct('_id')
            : [],
          userDept
            ? DocumentForward.find({
                targetDepartmentId: userDept,
                isDeletedForDept: false,
                accessControl: req.user.isAuthorizedOfficer
                  ? { $in: ['general', 'all_employees', 'restricted'] }
                  : { $in: ['general', 'all_employees'] },
              }).distinct('documentId')
            : [],
          DocumentPermission.find({ userId }).distinct('documentId'),
        ]);

        const allowedDocIds = [
          ...new Set([
            ...originDocs.map((id) => id.toString()),
            ...forwardedDocIds.map((id) => id.toString()),
            ...permittedDocIds.map((id) => id.toString()),
          ]),
        ].map((id) => new mongoose.Types.ObjectId(id));

        query.$or = [{ employeeId: userId }, { documentId: { $in: allowedDocIds } }];
      }
    }

    if (employeeId && isValidObjectId(employeeId)) {
      query.employeeId = employeeId;
    }

    if (status && VALID_STATUSES.includes(status.toLowerCase().trim())) {
      query.status = status.toLowerCase().trim();
    }

    if (isCurrent !== undefined) {
      query.isCurrent = isCurrent === 'true' || isCurrent === true;
    }

    if (dateFrom || dateTo) {
      query.statusUpdateTime = {};
      if (dateFrom) query.statusUpdateTime.$gte = new Date(dateFrom);
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        query.statusUpdateTime.$lte = to;
      }
    }

    const [total, statuses] = await Promise.all([
      DocumentWorkflowStatus.countDocuments(query),
      DocumentWorkflowStatus.find(query)
        .populate('documentId', 'title fileNumber status departmentId')
        .populate('employeeId', 'name employeeId designation email')
        .populate('departmentId', 'name code')
        .sort({ statusUpdateTime: -1 })
        .skip(skip)
        .limit(pageSize),
    ]);

    res.status(200).json(
      formatPaginatedResponse({
        total,
        page,
        pageSize,
        data: statuses,
      })
    );
  } catch (error) {
    next(error);
  }
};

/**
 * 3. Get Document Status Details by ID
 * Route: GET /api/document-statuses/:id
 */
export const getDocumentWorkflowStatusById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid status ID format' });
    }

    const statusRecord = await DocumentWorkflowStatus.findById(id)
      .populate('documentId', 'title fileNumber status departmentId accessControl targetAudience isDeletedForOriginDept')
      .populate('employeeId', 'name employeeId designation email departmentId')
      .populate('departmentId', 'name code');

    if (!statusRecord) {
      return res.status(404).json({ success: false, message: 'Document workflow status record not found' });
    }

    // Verify document access
    const hasAccess = await verifyUserDocumentAccess(req.user, statusRecord.documentId);
    if (!hasAccess && statusRecord.employeeId?._id?.toString() !== (req.user.id || req.user._id)?.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to view status for this document',
      });
    }

    res.status(200).json({
      success: true,
      data: statusRecord,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 4. Get Status Timeline for a Document
 * Route: GET /api/document-statuses/document/:documentId
 */
export const getDocumentStatusHistory = async (req, res, next) => {
  try {
    const { documentId } = req.params;

    if (!isValidObjectId(documentId)) {
      return res.status(400).json({ success: false, message: 'Invalid document ID format' });
    }

    const document = await Document.findById(documentId);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const hasAccess = await verifyUserDocumentAccess(req.user, document);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to view this document history',
      });
    }

    const history = await DocumentWorkflowStatus.find({ documentId: document._id })
      .populate('employeeId', 'name employeeId designation email')
      .populate('departmentId', 'name code')
      .sort({ statusUpdateTime: -1 });

    res.status(200).json({
      success: true,
      data: {
        document: {
          _id: document._id,
          title: document.title,
          fileNumber: document.fileNumber,
          currentStatus: history.find((h) => h.isCurrent)?.status || 'draft',
        },
        totalHistory: history.length,
        history,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 5. Update Status Record
 * Route: PATCH /api/document-statuses/:id
 */
export const updateDocumentWorkflowStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      status,
      remarks,
      isPhysicalFileReceived,
      isphysicalfilereceived,
      physicalFileReceivedTime,
      physicalfilereceivedtime,
    } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid status ID format' });
    }

    const statusRecord = await DocumentWorkflowStatus.findById(id);
    if (!statusRecord) {
      return res.status(404).json({ success: false, message: 'Status record not found' });
    }

    const currentUserId = (req.user.id || req.user._id)?.toString();
    const isOwner = statusRecord.employeeId?.toString() === currentUserId;
    const isSuperAdmin = req.user.role === 'super_admin';

    if (!isOwner && !isSuperAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only update your own status records',
      });
    }

    if (status !== undefined) {
      let normalized = status.toString().toLowerCase().trim();
      if (normalized === 'approved') normalized = 'approve';
      if (normalized === 'received') normalized = 'receive';
      if (!VALID_STATUSES.includes(normalized)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status '${status}'. Must be one of: ${VALID_STATUSES.join(', ')}`,
        });
      }
      statusRecord.status = normalized;
      statusRecord.statusUpdateTime = new Date();
    }

    if (remarks !== undefined) {
      statusRecord.remarks = remarks.toString().trim();
    }

    // Handle isPhysicalFileReceived & physicalFileReceivedTime
    const rawPhysical = isPhysicalFileReceived !== undefined ? isPhysicalFileReceived : isphysicalfilereceived;
    if (rawPhysical !== undefined) {
      const boolVal = rawPhysical === true || rawPhysical === 'true';
      statusRecord.isPhysicalFileReceived = boolVal;
      if (boolVal) {
        const rawTime = physicalFileReceivedTime || physicalfilereceivedtime;
        statusRecord.physicalFileReceivedTime = rawTime ? new Date(rawTime) : (statusRecord.physicalFileReceivedTime || new Date());
      } else {
        statusRecord.physicalFileReceivedTime = null;
      }
    } else {
      const rawTime = physicalFileReceivedTime || physicalfilereceivedtime;
      if (rawTime !== undefined) {
        statusRecord.physicalFileReceivedTime = rawTime ? new Date(rawTime) : null;
        if (statusRecord.physicalFileReceivedTime) {
          statusRecord.isPhysicalFileReceived = true;
        }
      }
    }

    await statusRecord.save();

    const populated = await DocumentWorkflowStatus.findById(id)
      .populate('documentId', 'title fileNumber status')
      .populate('employeeId', 'name employeeId designation email')
      .populate('departmentId', 'name code');

    res.status(200).json({
      success: true,
      message: 'Document status record updated successfully',
      data: populated,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 6. Delete Status Record
 * Route: DELETE /api/document-statuses/:id
 */
export const deleteDocumentWorkflowStatus = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid status ID format' });
    }

    const statusRecord = await DocumentWorkflowStatus.findById(id);
    if (!statusRecord) {
      return res.status(404).json({ success: false, message: 'Status record not found' });
    }

    const currentUserId = (req.user.id || req.user._id)?.toString();
    const isOwner = statusRecord.employeeId?.toString() === currentUserId;
    const isSuperAdmin = req.user.role === 'super_admin';

    if (!isOwner && !isSuperAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only delete your own status records',
      });
    }

    const wasCurrent = statusRecord.isCurrent;
    const docId = statusRecord.documentId;

    await DocumentWorkflowStatus.findByIdAndDelete(id);

    // If deleted record was marked isCurrent, promote the latest remaining one
    if (wasCurrent) {
      const latestRemaining = await DocumentWorkflowStatus.findOne({ documentId: docId })
        .sort({ statusUpdateTime: -1 });
      if (latestRemaining) {
        latestRemaining.isCurrent = true;
        await latestRemaining.save();
      }
    }

    res.status(200).json({
      success: true,
      message: 'Document status record deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
