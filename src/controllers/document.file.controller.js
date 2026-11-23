import fs from 'node:fs';
import mongoose from 'mongoose';
import { DocumentFile } from '../models/document.file.model.js';
import { Document } from '../models/document.model.js';
import { moveToDocumentFolder } from '../utils/file.util.js';
import { recordDocumentLog } from '../utils/document.logger.js';
import { getPaginationParams, formatPaginatedResponse } from '../utils/pagination.util.js';

/**
 * Upload and attach a file to a document
 * POST /api/documents/:id/files
 */
export const uploadDocumentFile = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID format',
      });
    }

    const document = await Document.findById(id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Please send a file in the "file" field',
      });
    }

    const pageNumber = req.body.pageNumber ? Math.max(1, parseInt(req.body.pageNumber, 10) || 1) : 1;
    const fileSummary = (req.body.fileSummary || '').trim();

    // Move file to organized document folder: uploads/uploaded-files/<docId>/files/<filename>
    const moved = moveToDocumentFolder(req.file.path, document._id, 'files');
    const finalStoredFilename = moved ? moved.filename : req.file.filename;
    const finalFilePath = moved ? moved.destPath : req.file.path;
    const finalFileUrl = moved ? moved.fileUrl : `/uploads/${req.file.filename}`;

    const newFile = await DocumentFile.create({
      documentId: document._id,
      uploadUserId: req.user._id,
      uploadTime: new Date(),
      originalName: req.file.originalname || '',
      storedFilename: finalStoredFilename,
      filePath: finalFilePath,
      fileUrl: finalFileUrl,
      mimeType: req.file.mimetype || '',
      fileSize: req.file.size || 0,
      pageNumber,
      fileSummary,
      status: 'pending',
    });

    // Re-sum total pages from DocumentFile for this document and update Document
    const [pageAgg] = await DocumentFile.aggregate([
      { $match: { documentId: document._id } },
      { $group: { _id: null, totalPages: { $sum: '$pageNumber' } } },
    ]);
    const totalDocPages = pageAgg?.totalPages || file.pageNumber || 0;
    await Document.findByIdAndUpdate(document._id, { pageNumber: totalDocPages });

    await recordDocumentLog({
      documentId: document._id,
      fileNumber: document.fileNumber,
      user: req.user,
      action: 'File Attached',
      details: `New file '${newFile.originalName}' (page ${newFile.pageNumber}) uploaded by ${req.user.name || req.user.email}`,
      req,
    });

    res.status(201).json({
      success: true,
      message: 'File uploaded and attached to document successfully',
      data: newFile,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List all files for a document with pagination and optional status / page filtering
 * GET /api/documents/:id/files
 */
export const getDocumentFiles = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID format',
      });
    }

    const document = await Document.findById(id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const { page, pageSize, skip } = getPaginationParams(req.query);

    const filter = { documentId: document._id };
    if (req.query.status && ['pending', 'approve', 'reject'].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    if (req.query.pageNumber) {
      const pageNum = parseInt(req.query.pageNumber, 10);
      if (!isNaN(pageNum)) {
        filter.pageNumber = pageNum;
      }
    }

    // Single-roundtrip aggregation pipeline with $facet & $lookup
    const [result] = await DocumentFile.aggregate([
      { $match: filter },
      {
        $facet: {
          totalCount: [{ $count: 'total' }],
          paginatedData: [
            { $sort: { pageNumber: 1, createdAt: -1 } },
            { $skip: skip },
            { $limit: pageSize },
            {
              $lookup: {
                from: 'users',
                localField: 'uploadUserId',
                foreignField: '_id',
                as: 'uploadUserId',
                pipeline: [{ $project: { _id: 1, name: 1, email: 1, role: 1, department: 1 } }],
              },
            },
            { $unwind: { path: '$uploadUserId', preserveNullAndEmptyArrays: true } },
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
    const files = result?.paginatedData || [];

    res.status(200).json(
      formatPaginatedResponse({
        total,
        page,
        pageSize,
        data: files,
      })
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Get a single document file by ID
 * GET /api/documents/:id/files/:fileId
 */
export const getDocumentFileById = async (req, res, next) => {
  try {
    const { id, fileId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(fileId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID or file ID format',
      });
    }

    const file = await DocumentFile.findOne({ _id: fileId, documentId: id })
      .populate('uploadUserId', 'name email role department')
      .populate('approvedBy', 'name email role');

    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'Document file not found',
      });
    }

    res.status(200).json({
      success: true,
      data: file,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Review (approve or reject) a document file
 * PATCH /api/documents/:id/files/:fileId/review
 */
export const reviewDocumentFile = async (req, res, next) => {
  try {
    const { id, fileId } = req.params;
    const { status, rejectionReason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(fileId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID or file ID format',
      });
    }

    if (!status || !['approve', 'reject'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be either "approve" or "reject"',
      });
    }

    if (status === 'reject' && (!rejectionReason || !rejectionReason.trim())) {
      return res.status(400).json({
        success: false,
        message: 'rejectionReason is required when status is reject',
      });
    }

    const document = await Document.findById(id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const file = await DocumentFile.findOne({ _id: fileId, documentId: id });
    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'Document file not found',
      });
    }

    file.status = status;
    file.approvedBy = req.user._id;
    file.approvedAt = new Date();
    file.rejectionReason = status === 'reject' ? (rejectionReason || '').trim() : '';
    await file.save();

    // Re-sum total pages from DocumentFile for this document and update Document
    const [pageAgg] = await DocumentFile.aggregate([
      { $match: { documentId: document._id } },
      { $group: { _id: null, totalPages: { $sum: '$pageNumber' } } },
    ]);
    const totalDocPages = pageAgg?.totalPages || file.pageNumber || 0;
    await Document.findByIdAndUpdate(document._id, { pageNumber: totalDocPages });

    await recordDocumentLog({
      documentId: document._id,
      fileNumber: document.fileNumber,
      user: req.user,
      action: status === 'approve' ? 'File Approved' : 'File Rejected',
      details: `File '${file.originalName}' (ID: ${file._id}) marked as '${status}' by ${req.user.name || req.user.email}${status === 'reject' ? ` (Reason: ${file.rejectionReason})` : ''}`,
      req,
    });

    res.status(200).json({
      success: true,
      message: `File has been ${status === 'approve' ? 'approved' : 'rejected'} successfully`,
      data: file,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a document file
 * DELETE /api/documents/:id/files/:fileId
 */
export const deleteDocumentFile = async (req, res, next) => {
  try {
    const { id, fileId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(fileId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID or file ID format',
      });
    }

    const document = await Document.findById(id);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const file = await DocumentFile.findOne({ _id: fileId, documentId: id });
    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'Document file not found',
      });
    }

    // Permission check: uploader can delete if pending, or admin/super_admin can delete
    const isUploader = file.uploadUserId.toString() === req.user._id.toString();
    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);

    if (!isAdmin && (!isUploader || file.status !== 'pending')) {
      return res.status(403).json({
        success: false,
        message: 'Only the uploader (while pending) or an admin can delete this file',
      });
    }

    // Unlink physical file safely if exists
    if (file.filePath && fs.existsSync(file.filePath)) {
      try {
        fs.unlinkSync(file.filePath);
      } catch (err) {
        console.warn(`Warning unlinking physical file: ${file.filePath}`, err.message);
      }
    }

    await DocumentFile.findByIdAndDelete(file._id);

    // Re-sum total pages from DocumentFile for this document and update Document
    const [pageAgg] = await DocumentFile.aggregate([
      { $match: { documentId: document._id } },
      { $group: { _id: null, totalPages: { $sum: '$pageNumber' } } },
    ]);
    const totalDocPages = pageAgg?.totalPages || 0;
    await Document.findByIdAndUpdate(document._id, { pageNumber: totalDocPages });

    await recordDocumentLog({
      documentId: document._id,
      fileNumber: document.fileNumber,
      user: req.user,
      action: 'File Deleted',
      details: `File '${file.originalName}' (ID: ${file._id}) deleted by ${req.user.name || req.user.email}`,
      req,
    });

    res.status(200).json({
      success: true,
      message: 'Document file deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Super Admin: Get total, approved, pending, and rejected document file counts
 * GET /api/documents/files/counts
 */
export const getDocumentFileCounts = async (req, res, next) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only Super Admin has permission to view document file counts',
      });
    }

    const [result] = await DocumentFile.aggregate([
      {
        $facet: {
          totalFiles:    [{ $count: 'count' }],
          approvedFiles: [{ $match: { status: 'approve'  } }, { $count: 'count' }],
          pendingFiles:  [{ $match: { status: 'pending'  } }, { $count: 'count' }],
          rejectedFiles: [{ $match: { status: 'reject'   } }, { $count: 'count' }],
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalFiles:    result?.totalFiles?.[0]?.count    ?? 0,
        approvedFiles: result?.approvedFiles?.[0]?.count ?? 0,
        pendingFiles:  result?.pendingFiles?.[0]?.count  ?? 0,
        rejectedFiles: result?.rejectedFiles?.[0]?.count ?? 0,
      },
    });
  } catch (error) {
    next(error);
  }
};
