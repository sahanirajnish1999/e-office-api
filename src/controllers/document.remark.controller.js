import mongoose from 'mongoose';
import { DocumentRemark } from '../models/document.remark.model.js';
import { Document } from '../models/document.model.js';
import { recordDocumentLog } from '../utils/document.logger.js';
import { getPaginationParams, formatPaginatedResponse } from '../utils/pagination.util.js';
import { isValidObjectId } from '../utils/validator.util.js';

/**
 * 1. Create a Remark for a Document (POST /api/documents/:id/remarks)
 */
export const createRemark = async (req, res, next) => {
  try {
    const documentId = req.params.id;
    const { comment } = req.body;

    if (!comment || typeof comment !== 'string' || !comment.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Remark comment text is required',
      });
    }

    const document = req.document || (await Document.findById(documentId));
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const userName = req.user.name || req.user.email;

    const remark = await DocumentRemark.create({
      documentId: document._id,
      userId: req.user.id,
      userName,
      comment: comment.trim(),
    });

    await recordDocumentLog({
      fileId: document._id,
      fileNumber: document.fileNumber || '',
      user: req.user,
      action: 'ADD_REMARK',
      details: `Remark added by ${userName}: "${remark.comment.substring(0, 50)}${remark.comment.length > 50 ? '...' : ''}"`,
      req,
    });

    res.status(201).json({
      success: true,
      message: 'Remark added successfully',
      data: remark,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 2. Get Paginated Remarks for a Document (GET /api/documents/:id/remarks)
 * Handles high volume (500 - 2,000+ remarks) with index-backed pagination and search.
 */
export const getRemarksByDocument = async (req, res, next) => {
  try {
    const documentId = req.params.id;
    if (!documentId || !isValidObjectId(documentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID format',
      });
    }

    const { page, pageSize, skip } = getPaginationParams(req.query);
    const { search, userId } = req.query;

    const query = { documentId };

    if (userId && isValidObjectId(userId)) {
      query.userId = userId;
    }

    if (search && typeof search === 'string' && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { comment: searchRegex },
        { userName: searchRegex },
      ];
    }

    const [total, remarks] = await Promise.all([
      DocumentRemark.countDocuments(query),
      DocumentRemark.find(query)
        .populate('userId', 'name email designation employeeId departmentId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize),
    ]);

    res.status(200).json(
      formatPaginatedResponse({
        total,
        page,
        pageSize,
        data: remarks,
      })
    );
  } catch (error) {
    next(error);
  }
};

/**
 * 3. Update an Existing Remark (PATCH /api/documents/:id/remarks/:remarkId)
 * Author or Admin only.
 */
export const updateRemark = async (req, res, next) => {
  try {
    const { id: documentId, remarkId } = req.params;
    const { comment } = req.body;

    if (!remarkId || !isValidObjectId(remarkId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid remark ID format',
      });
    }

    if (!comment || typeof comment !== 'string' || !comment.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Updated remark comment text is required',
      });
    }

    const remark = await DocumentRemark.findOne({
      _id: remarkId,
      documentId,
    });

    if (!remark) {
      return res.status(404).json({
        success: false,
        message: 'Remark not found for this document',
      });
    }

    const isAuthor = remark.userId.toString() === req.user.id.toString();
    const isAdmin = ['super_admin', 'department_admin'].includes(req.user.role);

    if (!isAuthor && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to edit this remark',
      });
    }

    remark.comment = comment.trim();
    remark.isEdited = true;
    remark.editedAt = new Date();
    await remark.save();

    await recordDocumentLog({
      fileId: remark.documentId,
      user: req.user,
      action: 'UPDATE_REMARK',
      details: `Remark updated by ${req.user.name || req.user.email}`,
      req,
    });

    res.status(200).json({
      success: true,
      message: 'Remark updated successfully',
      data: remark,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 4. Delete a Remark (DELETE /api/documents/:id/remarks/:remarkId)
 * Author or Admin only.
 */
export const deleteRemark = async (req, res, next) => {
  try {
    const { id: documentId, remarkId } = req.params;

    if (!remarkId || !isValidObjectId(remarkId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid remark ID format',
      });
    }

    const remark = await DocumentRemark.findOne({
      _id: remarkId,
      documentId,
    });

    if (!remark) {
      return res.status(404).json({
        success: false,
        message: 'Remark not found for this document',
      });
    }

    const isAuthor = remark.userId.toString() === req.user.id.toString();
    const isAdmin = ['super_admin', 'department_admin'].includes(req.user.role);

    if (!isAuthor && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this remark',
      });
    }

    await DocumentRemark.findByIdAndDelete(remarkId);

    await recordDocumentLog({
      fileId: remark.documentId,
      user: req.user,
      action: 'DELETE_REMARK',
      details: `Remark deleted by ${req.user.name || req.user.email}`,
      req,
    });

    res.status(200).json({
      success: true,
      message: 'Remark deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

export default {
  createRemark,
  getRemarksByDocument,
  updateRemark,
  deleteRemark,
};
