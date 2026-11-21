import mongoose from 'mongoose';
import { VirtualStickyNote } from '../models/virtual.sticky.model.js';
import { Document } from '../models/document.model.js';
import { isValidObjectId } from '../utils/validator.util.js';
import { getPaginationParams, formatPaginatedResponse } from '../utils/pagination.util.js';

/**
 * 1. Create a personal virtual sticky note
 * POST /api/documents/:id/virtual-stickies or POST /api/virtual-stickies
 */
export const createVirtualSticky = async (req, res, next) => {
  try {
    const targetDocId = req.params.id || req.body.documentId;
    const { detailSummary, stickyColor, isPinned } = req.body;

    if (!targetDocId || !isValidObjectId(targetDocId)) {
      return res.status(400).json({
        success: false,
        message: 'A valid documentId is required',
      });
    }

    if (!detailSummary || !detailSummary.trim()) {
      return res.status(400).json({
        success: false,
        message: 'detail summary is required',
      });
    }

    const document = await Document.findById(targetDocId);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    const currentUserId = req.user.id || req.user._id;
    const currentUserName = req.user.name || req.user.email || 'User';

    const newNote = await VirtualStickyNote.create({
      userId: currentUserId,
      userName: currentUserName,
      documentId: document._id,
      detailSummary: detailSummary.trim(),
      stickyColor: stickyColor ? stickyColor.trim() : 'yellow',
      isPinned: Boolean(isPinned),
      createdAt: new Date(),
    });

    res.status(201).json({
      success: true,
      message: 'Virtual sticky note created successfully',
      data: newNote,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 2. Get list of personal virtual sticky notes for a document
 * GET /api/documents/:id/virtual-stickies or GET /api/virtual-stickies
 * Sorted by isPinned descending first, then latest createdAt descending
 */
export const getVirtualStickies = async (req, res, next) => {
  try {
    const targetDocId = req.params.id || req.params.documentId || req.query.documentId;
    const currentUserId = req.user.id || req.user._id;

    const matchQuery = {
      userId: new mongoose.Types.ObjectId(currentUserId),
    };

    if (targetDocId) {
      if (!isValidObjectId(targetDocId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid documentId format',
        });
      }
      matchQuery.documentId = new mongoose.Types.ObjectId(targetDocId);
    }

    if (req.query.isPinned !== undefined) {
      matchQuery.isPinned = req.query.isPinned === 'true';
    }

    const { page, pageSize, skip } = getPaginationParams(req.query);

    // Single-roundtrip aggregation pipeline with $facet
    const [result] = await VirtualStickyNote.aggregate([
      { $match: matchQuery },
      { $sort: { isPinned: -1, createdAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $skip: skip },
            { $limit: pageSize },
            {
              $project: {
                _id: 1,
                userId: 1,
                userName: 1,
                documentId: 1,
                detailSummary: 1,
                stickyColor: 1,
                isPinned: 1,
                createdAt: 1,
                updatedAt: 1,
              },
            },
          ],
        },
      },
    ]);

    const total = result?.metadata?.[0]?.total || 0;
    const notes = result?.data || [];

    res.status(200).json(
      formatPaginatedResponse({
        total,
        page,
        pageSize,
        data: notes,
      })
    );
  } catch (error) {
    next(error);
  }
};

/**
 * 3. Get single virtual sticky note by ID
 * GET /api/virtual-stickies/:noteId
 */
export const getVirtualStickyById = async (req, res, next) => {
  try {
    const { noteId } = req.params;

    if (!isValidObjectId(noteId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid virtual sticky note ID format',
      });
    }

    const currentUserId = req.user.id || req.user._id;
    const note = await VirtualStickyNote.findOne({
      _id: noteId,
      userId: currentUserId,
    });

    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Virtual sticky note not found or access denied',
      });
    }

    res.status(200).json({
      success: true,
      data: note,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 4. Update a personal virtual sticky note
 * PATCH /api/virtual-stickies/:noteId
 */
export const updateVirtualSticky = async (req, res, next) => {
  try {
    const { noteId } = req.params;
    const { detailSummary, stickyColor, isPinned } = req.body;

    if (!isValidObjectId(noteId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid virtual sticky note ID format',
      });
    }

    const currentUserId = req.user.id || req.user._id;
    const note = await VirtualStickyNote.findOne({
      _id: noteId,
      userId: currentUserId,
    });

    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Virtual sticky note not found or access denied',
      });
    }

    if (detailSummary !== undefined) {
      if (!detailSummary.trim()) {
        return res.status(400).json({
          success: false,
          message: 'detail summary cannot be empty',
        });
      }
      note.detailSummary = detailSummary.trim();
    }

    if (stickyColor !== undefined) {
      note.stickyColor = stickyColor.trim() || 'yellow';
    }

    if (isPinned !== undefined) {
      note.isPinned = Boolean(isPinned);
    }

    await note.save();

    res.status(200).json({
      success: true,
      message: 'Virtual sticky note updated successfully',
      data: note,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 5. Delete a personal virtual sticky note
 * DELETE /api/virtual-stickies/:noteId
 */
export const deleteVirtualSticky = async (req, res, next) => {
  try {
    const { noteId } = req.params;

    if (!isValidObjectId(noteId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid virtual sticky note ID format',
      });
    }

    const currentUserId = req.user.id || req.user._id;
    const note = await VirtualStickyNote.findOneAndDelete({
      _id: noteId,
      userId: currentUserId,
    });

    if (!note) {
      return res.status(404).json({
        success: false,
        message: 'Virtual sticky note not found or access denied',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Virtual sticky note deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
