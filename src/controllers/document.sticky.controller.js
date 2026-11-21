import mongoose from 'mongoose';
import { DocumentSticky } from '../models/document.sticky.model.js';
import { Document } from '../models/document.model.js';
import { User } from '../models/user.model.js';
import { recordDocumentLog } from '../utils/document.logger.js';
import { isValidObjectId } from '../utils/validator.util.js';
import { getPaginationParams, formatPaginatedResponse } from '../utils/pagination.util.js';

/**
 * 1. Create Sticky Note (Standalone API: POST /api/stickies or POST /api/documents/:id/stickies)
 * Note: userId is ALWAYS derived directly from req.user (not from POST body)
 */
export const createSticky = async (req, res, next) => {
  try {
    const { documentId, note, color, pageNumber } = req.body;

    const targetDocId = documentId || req.params.id;
    if (!targetDocId || !isValidObjectId(targetDocId)) {
      return res.status(400).json({
        success: false,
        message: 'A valid documentId is required',
      });
    }

    if (!note || !note.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Sticky note text is required',
      });
    }

    const document = await Document.findById(targetDocId);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    // Always assign authenticated user as author and owner (ignore any req.body.userId)
    const targetUserId = req.user.id || req.user._id;
    const authorName = req.user.name || req.user.email || 'User';

    const finalPageNumber = parseInt(pageNumber, 10) || 1;

    const sticky = await DocumentSticky.create({
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
      fileNumber: document.fileNumber || '',
      user: req.user,
      action: 'Sticky Note Added',
      details: `Sticky note (${sticky.color}, page ${sticky.pageNumber}) attached by ${authorName}`,
      req,
    });

    res.status(201).json({
      success: true,
      message: 'Sticky note created successfully',
      data: sticky,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 2. Get All Stickies for a Document (GET /api/stickies/document/:documentId or GET /api/documents/:id/stickies)
 */
export const getStickiesByDocument = async (req, res, next) => {
  try {
    const documentId = req.params.documentId || req.params.id || req.query.documentId;
    if (!documentId || !isValidObjectId(documentId)) {
      return res.status(400).json({
        success: false,
        message: 'A valid documentId is required',
      });
    }

    const matchQuery = {
      documentId: new mongoose.Types.ObjectId(documentId),
    };

    if (req.query.pageNumber) {
      matchQuery.pageNumber = parseInt(req.query.pageNumber, 10);
    }
    if (req.query.userId && isValidObjectId(req.query.userId)) {
      matchQuery.userId = new mongoose.Types.ObjectId(req.query.userId);
    }
    if (req.query.status && ['pending', 'approve', 'reject'].includes(req.query.status)) {
      matchQuery.status = req.query.status;
    }

    const { page, pageSize, skip } = getPaginationParams(req.query);

    // Single-roundtrip aggregation pipeline with $facet for pagination + count
    const [result] = await DocumentSticky.aggregate([
      { $match: matchQuery },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
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
            {
              $lookup: {
                from: 'users',
                localField: 'createdBy',
                foreignField: '_id',
                as: 'createdBy',
                pipeline: [{ $project: { _id: 1, name: 1, email: 1 } }],
              },
            },
            {
              $lookup: {
                from: 'users',
                localField: 'approvedBy',
                foreignField: '_id',
                as: 'approvedBy',
                pipeline: [{ $project: { _id: 1, name: 1, email: 1, role: 1 } }],
              },
            },
            {
              $project: {
                _id: 1,
                documentId: 1,
                userId: { $arrayElemAt: ['$userId', 0] },
                createdBy: { $arrayElemAt: ['$createdBy', 0] },
                authorName: 1,
                color: 1,
                note: 1,
                pageNumber: 1,
                status: 1,
                isApproved: 1,
                approvedBy: { $arrayElemAt: ['$approvedBy', 0] },
                approvedByName: 1,
                approvedAt: 1,
                approvalIpAddress: 1,
                rejectionReason: 1,
                createdAt: 1,
                updatedAt: 1,
              },
            },
          ],
        },
      },
    ]);

    const total = result?.metadata?.[0]?.total || 0;
    const stickies = result?.data || [];

    res.status(200).json(
      formatPaginatedResponse({
        total,
        page,
        pageSize,
        data: stickies,
      })
    );
  } catch (error) {
    next(error);
  }
};

/**
 * 3. Approve / Review Sticky Note
 * PATCH /api/documents/:id/stickies/:stickyId/approve or PATCH /api/stickies/:id/approve
 */
export const approveSticky = async (req, res, next) => {
  try {
    const stickyId = req.params.stickyId || req.params.id;
    const targetDocId = req.params.id && req.params.stickyId ? req.params.id : null;

    if (!stickyId || !isValidObjectId(stickyId)) {
      return res.status(400).json({
        success: false,
        message: 'A valid sticky note id is required',
      });
    }

    // Permission check:
    // 1. Super Admin: always permitted
    // 2. Department Admin: permitted
    // 3. Employee: permitted only if holding canViewApprovals or canApproveNoting permission
    const isSuperAdmin = req.user.role === 'super_admin';
    const isDeptAdmin = req.user.role === 'department_admin';
    const hasApprovalPerm = Boolean(
      req.user.permissions?.canViewApprovals ||
      req.user.permissions?.canApproveNoting ||
      req.userPermission?.canApproveNoting
    );

    if (!isSuperAdmin && !isDeptAdmin && !hasApprovalPerm) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to approve sticky notes',
      });
    }

    const sticky = await DocumentSticky.findById(stickyId);
    if (!sticky) {
      return res.status(404).json({
        success: false,
        message: 'Sticky note not found',
      });
    }

    if (targetDocId && sticky.documentId.toString() !== targetDocId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Sticky note does not belong to the specified document',
      });
    }

    // Capture approver's network IP address
    const ipAddress =
      req.headers['x-forwarded-for']?.split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      req.ip ||
      '';

    const status = req.body.status || 'approve';
    if (!['approve', 'reject'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be either "approve" or "reject"',
      });
    }

    const rejectionReason = (req.body.rejectionReason || '').trim();
    if (status === 'reject' && !rejectionReason) {
      return res.status(400).json({
        success: false,
        message: 'rejectionReason is required when status is reject',
      });
    }

    sticky.status = status;
    sticky.isApproved = status === 'approve';
    sticky.approvedBy = req.user.id || req.user._id;
    sticky.approvedByName = req.user.name || req.user.email || 'Admin';
    sticky.approvedAt = new Date();
    sticky.approvalIpAddress = ipAddress;
    sticky.rejectionReason = status === 'reject' ? rejectionReason : '';

    await sticky.save();

    await recordDocumentLog({
      fileId: sticky.documentId,
      user: req.user,
      action: status === 'approve' ? 'Sticky Note Approved' : 'Sticky Note Rejected',
      details: `Sticky note (${sticky.color}) ${status === 'approve' ? 'approved' : 'rejected'} by ${sticky.approvedByName} from IP ${ipAddress}${status === 'reject' ? ` (Reason: ${rejectionReason})` : ''}`,
      req,
    });

    res.status(200).json({
      success: true,
      message: `Sticky note ${status === 'approve' ? 'approved' : 'rejected'} successfully`,
      data: sticky,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 4. Delete Sticky Note (DELETE /api/stickies/:id)
 */
export const deleteSticky = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id || !isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid sticky note id',
      });
    }

    const sticky = await DocumentSticky.findById(id);
    if (!sticky) {
      return res.status(404).json({
        success: false,
        message: 'Sticky note not found',
      });
    }

    // Only creator or admin can delete
    const isOwner = sticky.userId?.toString() === req.user.id || sticky.createdBy?.toString() === req.user.id;
    const isAdmin = ['super_admin', 'department_admin'].includes(req.user.role);

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this sticky note',
      });
    }

    await DocumentSticky.findByIdAndDelete(id);

    await recordDocumentLog({
      fileId: sticky.documentId,
      user: req.user,
      action: 'Sticky Note Deleted',
      details: `Sticky note removed by ${req.user.name || req.user.email}`,
      req,
    });

    res.status(200).json({
      success: true,
      message: 'Sticky note deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

export default {
  createSticky,
  getStickiesByDocument,
  approveSticky,
  deleteSticky,
};
