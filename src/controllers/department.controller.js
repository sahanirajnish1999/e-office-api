import mongoose from 'mongoose';
import { Department } from '../models/department.model.js';
import { User } from '../models/user.model.js';
import { Document } from '../models/document.model.js';
import { getPaginationParams, formatPaginatedResponse } from '../utils/pagination.util.js';

export const createDepartment = async (req, res, next) => {
  try {
    const { name, code, description } = req.body;

    if (!name || !code) {
      return res.status(400).json({
        success: false,
        message: 'Department name and unique code are required',
      });
    }

    const existing = await Department.findOne({
      $or: [{ name: name.trim() }, { code: code.trim().toUpperCase() }],
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Department with this name or code already exists',
      });
    }

    const department = await Department.create({
      name: name.trim(),
      code: code.trim().toUpperCase(),
      description: description || '',
      createdBy: req.user.id,
    });

    res.status(201).json({
      success: true,
      message: 'Department created successfully',
      data: department,
    });
  } catch (error) {
    next(error);
  }
};

export const listDepartments = async (req, res, next) => {
  try {
    const { page, pageSize, skip } = getPaginationParams(req.query);
    const { search, q, sortBy, sortAlphabetical } = req.query;

    const pipeline = [];

    // 1. Correlate Admin Info
    pipeline.push({
      $lookup: {
        from: 'users',
        let: { deptId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$departmentId', '$$deptId'] },
                  { $eq: ['$role', 'department_admin'] },
                ],
              },
            },
          },
          { $project: { _id: 0, name: 1, designation: 1 } },
          { $limit: 1 },
        ],
        as: 'adminInfo',
      },
    });

    // 2. Correlate Employee Count
    pipeline.push({
      $lookup: {
        from: 'users',
        let: { deptId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$departmentId', '$$deptId'] },
                  { $eq: ['$role', 'employee'] },
                ],
              },
            },
          },
          { $count: 'count' },
        ],
        as: 'employeeCountResult',
      },
    });

    // 3. Correlate File Count
    pipeline.push({
      $lookup: {
        from: 'documents',
        let: { deptId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$departmentId', '$$deptId'] },
            },
          },
          { $count: 'count' },
        ],
        as: 'fileCountResult',
      },
    });

    // 4. Flatten computed fields for search & sort
    pipeline.push({
      $addFields: {
        adminName: { $ifNull: [{ $arrayElemAt: ['$adminInfo.name', 0] }, ''] },
        adminDesignation: { $ifNull: [{ $arrayElemAt: ['$adminInfo.designation', 0] }, ''] },
        employeesCount: { $ifNull: [{ $arrayElemAt: ['$employeeCountResult.count', 0] }, 0] },
        filesCount: { $ifNull: [{ $arrayElemAt: ['$fileCountResult.count', 0] }, 0] },
      },
    });

    // 5. Multi-field Search: Department Name, Code, Admin Name
    const searchText = (search || q || '').trim();
    if (searchText) {
      const regex = new RegExp(searchText, 'i');
      pipeline.push({
        $match: {
          $or: [
            { name: regex },
            { code: regex },
            { adminName: regex },
          ],
        },
      });
    }

    // 6. Dynamic Sorting
    let sortStage = { createdAt: -1 };
    const sortParam = (sortBy || '').toLowerCase();

    if (sortParam === 'name_asc' || sortParam === 'a-z' || sortAlphabetical === 'asc') {
      sortStage = { name: 1 };
    } else if (sortParam === 'name_desc' || sortParam === 'z-a' || sortAlphabetical === 'desc') {
      sortStage = { name: -1 };
    } else if (sortParam === 'highest_files' || sortParam === 'files' || sortParam === 'files_desc') {
      sortStage = { filesCount: -1, createdAt: -1 };
    } else if (sortParam === 'highest_employees' || sortParam === 'employees' || sortParam === 'employees_desc') {
      sortStage = { employeesCount: -1, createdAt: -1 };
    }

    pipeline.push({ $sort: sortStage });

    // 7. Facet for Total Count + Paginated Page Data
    pipeline.push({
      $facet: {
        metadata: [{ $count: 'total' }],
        data: [
          { $skip: skip },
          { $limit: pageSize },
          // Lookup Creator details for the paginated page only
          {
            $lookup: {
              from: 'users',
              localField: 'createdBy',
              foreignField: '_id',
              pipeline: [
                {
                  $project: {
                    _id: 0,
                    id: { $toString: '$_id' },
                    name: 1,
                    email: 1,
                  },
                },
              ],
              as: 'creatorInfo',
            },
          },
          // Final clean projection (id instead of _id)
          {
            $project: {
              _id: 0,
              id: { $toString: '$_id' },
              name: 1,
              code: 1,
              description: 1,
              adminName: 1,
              adminDesignation: 1,
              employeesCount: 1,
              filesCount: 1,
              createdBy: { $ifNull: [{ $arrayElemAt: ['$creatorInfo', 0] }, null] },
              createdAt: 1,
              updatedAt: 1,
            },
          },
        ],
      },
    });

    const [result] = await Department.aggregate(pipeline);

    const total = result?.metadata?.[0]?.total || 0;
    const departments = result?.data || [];

    res.status(200).json(
      formatPaginatedResponse({
        total,
        page,
        pageSize,
        data: departments,
      })
    );
  } catch (error) {
    next(error);
  }
};

export const getDepartmentById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const department = await Department.findById(id).populate('createdBy', 'name email');

    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    // Also get the admin and employees of this department
    const members = await User.find({ departmentId: id }).select('name email role');

    res.status(200).json({
      success: true,
      data: {
        department,
        members,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 4. Update Department
 * Super Admin only
 * Route: PUT /api/departments/:id
 * Only updates the fields provided in req.body
 */
export const updateDepartment = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid department ID format',
      });
    }

    const { name, code, description } = req.body;

    // Check that at least one field is provided to update
    if (name === undefined && code === undefined && description === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least one field to update (name, code, or description)',
      });
    }

    const department = await Department.findById(id);
    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    // Check duplicate name or code if changing
    const duplicateConditions = [];
    if (name && name.trim() !== department.name) {
      duplicateConditions.push({ name: name.trim() });
    }
    if (code && code.trim().toUpperCase() !== department.code) {
      duplicateConditions.push({ code: code.trim().toUpperCase() });
    }

    if (duplicateConditions.length > 0) {
      const existing = await Department.findOne({
        _id: { $ne: id },
        $or: duplicateConditions,
      });

      if (existing) {
        return res.status(409).json({
          success: false,
          message: 'Another department already exists with this name or code',
        });
      }
    }

    // Update only the fields that were sent
    if (name !== undefined) department.name = name.trim();
    if (code !== undefined) department.code = code.trim().toUpperCase();
    if (description !== undefined) department.description = description.trim();

    await department.save();

    res.status(200).json({
      success: true,
      message: 'Department updated successfully',
      data: department,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 5. Delete Department
 * Super Admin only
 * Route: DELETE /api/departments/:id
 * Rule: Only deletes when NO user is assigned to this department
 */
export const deleteDepartment = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid department ID format',
      });
    }

    const department = await Department.findById(id);
    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    // Strictly verify NO users are assigned to this department
    const userCount = await User.countDocuments({ departmentId: id });
    if (userCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete department: ${userCount} user(s) are currently assigned to this department. Please reassign or remove all users before deleting.`,
      });
    }

    await Department.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Department deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
