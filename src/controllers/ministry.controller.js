import mongoose from 'mongoose';
import { Ministry } from '../models/ministry.model.js';
import { Department } from '../models/department.model.js';
import { Document } from '../models/document.model.js';
import { User } from '../models/user.model.js';
import { getPaginationParams, formatPaginatedResponse } from '../utils/pagination.util.js';
import { isValidObjectId } from '../utils/validator.util.js';

/**
 * 1. Create Ministry
 * Super Admin only
 * Route: POST /api/ministries
 */
export const createMinistry = async (req, res, next) => {
  try {
    const { name, code, description, headOfMinistry } = req.body;

    if (!name || !code) {
      return res.status(400).json({
        success: false,
        message: 'Ministry name and unique code are required',
      });
    }

    const existing = await Ministry.findOne({
      $or: [{ name: name.trim() }, { code: code.trim().toUpperCase() }],
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Ministry with this name or code already exists',
      });
    }

    const ministry = await Ministry.create({
      name: name.trim(),
      code: code.trim().toUpperCase(),
      description: (description || '').trim(),
      headOfMinistry: (headOfMinistry || '').trim(),
      createdBy: req.user.id || req.user._id,
    });

    res.status(201).json({
      success: true,
      message: 'Ministry created successfully',
      data: ministry,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 2. List Ministries
 * Super Admin or Ministry Admin
 * Route: GET /api/ministries
 */
export const listMinistries = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user?.role === 'super_admin';
    const isMinistryAdmin = req.user?.role === 'ministry_admin';

    if (!isSuperAdmin && !isMinistryAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Access restricted to Super Admin or Ministry Admin',
      });
    }

    const { page, pageSize, skip } = getPaginationParams(req.query);
    const { search, q } = req.query;

    const matchQuery = {};
    if (isMinistryAdmin && req.user.ministryId) {
      matchQuery._id = new mongoose.Types.ObjectId(req.user.ministryId);
    }

    const searchText = (search || q || '').trim();
    if (searchText) {
      const regex = new RegExp(searchText, 'i');
      matchQuery.$or = [{ name: regex }, { code: regex }];
    }

    // Single-roundtrip aggregation pipeline with $facet
    const [result] = await Ministry.aggregate([
      { $match: matchQuery },
      {
        $facet: {
          totalCount: [{ $count: 'total' }],
          paginatedData: [
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: pageSize },
            // Correlate Departments under this Ministry
            {
              $lookup: {
                from: 'departments',
                localField: '_id',
                foreignField: 'ministryId',
                as: 'departments',
                pipeline: [{ $project: { _id: 1, name: 1, code: 1 } }],
              },
            },
            // Correlate Ministry Admin User
            {
              $lookup: {
                from: 'users',
                localField: '_id',
                foreignField: 'ministryId',
                as: 'adminUser',
                pipeline: [
                  { $match: { role: 'ministry_admin' } },
                  { $project: { _id: 1, name: 1, email: 1, designation: 1 } },
                  { $limit: 1 },
                ],
              },
            },
            {
              $project: {
                _id: 0,
                id: { $toString: '$_id' },
                name: 1,
                code: 1,
                description: 1,
                headOfMinistry: 1,
                departmentsCount: { $size: '$departments' },
                departments: '$departments',
                admin: { $ifNull: [{ $arrayElemAt: ['$adminUser', 0] }, null] },
                createdAt: 1,
                updatedAt: 1,
              },
            },
          ],
        },
      },
    ]);

    const total = result?.totalCount?.[0]?.total || 0;
    const ministries = result?.paginatedData || [];

    res.status(200).json(
      formatPaginatedResponse({
        total,
        page,
        pageSize,
        data: ministries,
      })
    );
  } catch (error) {
    next(error);
  }
};

/**
 * 3. Get Ministry By ID
 * Super Admin or Ministry Admin (of this ministry)
 * Route: GET /api/ministries/:id
 */
export const getMinistryById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ministry ID format',
      });
    }

    const isSuperAdmin = req.user?.role === 'super_admin';
    const isMinistryAdmin =
      req.user?.role === 'ministry_admin' &&
      req.user.ministryId &&
      req.user.ministryId.toString() === id.toString();

    if (!isSuperAdmin && !isMinistryAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to view details of this ministry',
      });
    }

    const ministry = await Ministry.findById(id).populate('createdBy', 'name email');
    if (!ministry) {
      return res.status(404).json({
        success: false,
        message: 'Ministry not found',
      });
    }

    // Correlate departments under this ministry
    const departments = await Department.find({ ministryId: id }).select('name code description createdAt');

    // Correlate ministry admin users
    const admins = await User.find({ ministryId: id, role: 'ministry_admin' }).select('name email designation phone');

    res.status(200).json({
      success: true,
      data: {
        ministry,
        departmentsCount: departments.length,
        departments,
        admins,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 4. Update Ministry
 * Super Admin only
 * Route: PUT /api/ministries/:id
 */
export const updateMinistry = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ministry ID format',
      });
    }

    const { name, code, description, headOfMinistry } = req.body;

    if (name === undefined && code === undefined && description === undefined && headOfMinistry === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least one field to update',
      });
    }

    const ministry = await Ministry.findById(id);
    if (!ministry) {
      return res.status(404).json({
        success: false,
        message: 'Ministry not found',
      });
    }

    // Check duplicate name or code if changing
    const duplicateConditions = [];
    if (name && name.trim() !== ministry.name) {
      duplicateConditions.push({ name: name.trim() });
    }
    if (code && code.trim().toUpperCase() !== ministry.code) {
      duplicateConditions.push({ code: code.trim().toUpperCase() });
    }

    if (duplicateConditions.length > 0) {
      const existing = await Ministry.findOne({
        _id: { $ne: id },
        $or: duplicateConditions,
      });

      if (existing) {
        return res.status(409).json({
          success: false,
          message: 'Another ministry already exists with this name or code',
        });
      }
    }

    if (name !== undefined) ministry.name = name.trim();
    if (code !== undefined) ministry.code = code.trim().toUpperCase();
    if (description !== undefined) ministry.description = description.trim();
    if (headOfMinistry !== undefined) ministry.headOfMinistry = headOfMinistry.trim();

    await ministry.save();

    res.status(200).json({
      success: true,
      message: 'Ministry updated successfully',
      data: ministry,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 5. Delete Ministry
 * Super Admin only
 * Route: DELETE /api/ministries/:id
 * Rule: Only deletes when NO department is assigned to this ministry
 */
export const deleteMinistry = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ministry ID format',
      });
    }

    const ministry = await Ministry.findById(id);
    if (!ministry) {
      return res.status(404).json({
        success: false,
        message: 'Ministry not found',
      });
    }

    // Verify NO departments are assigned to this ministry
    const deptCount = await Department.countDocuments({ ministryId: id });
    if (deptCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete ministry: ${deptCount} department(s) are currently assigned under this ministry. Please reassign or detach departments first.`,
      });
    }

    await Ministry.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Ministry deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
