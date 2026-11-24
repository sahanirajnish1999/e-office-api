import mongoose from 'mongoose';
import { Department } from '../models/department.model.js';
import { Ministry } from '../models/ministry.model.js';
import { User } from '../models/user.model.js';
import { Document } from '../models/document.model.js';
import { getPaginationParams, formatPaginatedResponse } from '../utils/pagination.util.js';
import { isValidObjectId } from '../utils/validator.util.js';

export const createDepartment = async (req, res, next) => {
  try {
    const { name, code, description, ministryId } = req.body;

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

    let targetMinistryId = ministryId;
    if (req.user?.role === 'ministry_admin' && req.user.ministryId) {
      targetMinistryId = req.user.ministryId;
    }

    if (targetMinistryId) {
      if (!isValidObjectId(targetMinistryId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid ministryId format',
        });
      }
      const ministry = await Ministry.findById(targetMinistryId);
      if (!ministry) {
        return res.status(404).json({
          success: false,
          message: 'Specified ministry does not exist',
        });
      }
    }

    const department = await Department.create({
      name: name.trim(),
      code: code.trim().toUpperCase(),
      description: description || '',
      ministryId: targetMinistryId || null,
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
    const isSuperAdmin = req.user?.role === 'super_admin';
    const isMinistryAdmin = req.user?.role === 'ministry_admin';

    if (!isSuperAdmin && !isMinistryAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only Super Admin or Ministry Admin has permission to list departments',
      });
    }

    const { page, pageSize, skip } = getPaginationParams(req.query);
    const { search, q, sortBy, sortAlphabetical, ministryId } = req.query;

    const pipeline = [];

    // Filter by Ministry for Ministry Admin or if ministryId is supplied
    if (isMinistryAdmin && req.user.ministryId) {
      pipeline.push({ $match: { ministryId: new mongoose.Types.ObjectId(req.user.ministryId) } });
    } else if (ministryId && isValidObjectId(ministryId)) {
      pipeline.push({ $match: { ministryId: new mongoose.Types.ObjectId(ministryId) } });
    }

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
          // Lookup Ministry details for the paginated page only
          {
            $lookup: {
              from: 'ministries',
              localField: 'ministryId',
              foreignField: '_id',
              pipeline: [
                {
                  $project: {
                    _id: 0,
                    id: { $toString: '$_id' },
                    name: 1,
                    code: 1,
                  },
                },
              ],
              as: 'ministryInfo',
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
              ministryId: { $ifNull: [{ $toString: '$ministryId' }, null] },
              ministryName: { $ifNull: [{ $arrayElemAt: ['$ministryInfo.name', 0] }, ''] },
              ministryCode: { $ifNull: [{ $arrayElemAt: ['$ministryInfo.code', 0] }, ''] },
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
    const isSuperAdmin = req.user?.role === 'super_admin';
    const isMinistryAdmin = req.user?.role === 'ministry_admin';

    if (!isSuperAdmin && !isMinistryAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only Super Admin or Ministry Admin has permission to view department details',
      });
    }

    const { id } = req.params;
    const department = await Department.findById(id)
      .populate('createdBy', 'name email')
      .populate('ministryId', 'name code description');

    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    // Ministry Admin can only view departments under their assigned ministry
    if (isMinistryAdmin && department.ministryId) {
      const deptMinId = department.ministryId._id ? department.ministryId._id.toString() : department.ministryId.toString();
      if (deptMinId !== req.user.ministryId?.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to view departments of other ministries',
        });
      }
    } else if (isMinistryAdmin && !department.ministryId) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to view departments not under your ministry',
      });
    }

    // Also get the admin and employees of this department
    const members = await User.find({ departmentId: id }).select('name email role designation employeeId');

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
 * Super Admin or Ministry Admin (for departments under their ministry)
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

    const isSuperAdmin = req.user?.role === 'super_admin';
    const isMinistryAdmin = req.user?.role === 'ministry_admin';

    if (req.user && !isSuperAdmin && !isMinistryAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only Super Admin or Ministry Admin can update department details',
      });
    }

    const { name, code, description, ministryId } = req.body;

    // Check that at least one field is provided to update
    if (name === undefined && code === undefined && description === undefined && ministryId === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least one field to update (name, code, description, or ministryId)',
      });
    }

    const department = await Department.findById(id);
    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    // Ministry Admin can only update departments under their own ministry
    if (isMinistryAdmin) {
      if (department.ministryId?.toString() !== req.user.ministryId?.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You can only update departments belonging to your assigned ministry',
        });
      }
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
    if (ministryId !== undefined && isSuperAdmin) {
      department.ministryId = ministryId && isValidObjectId(ministryId) ? ministryId : null;
    }

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
 * 4.1 Assign or Transfer Department to Ministry
 * Super Admin or Ministry Admin
 * Route: PATCH /api/departments/:id/ministry
 */
export const assignMinistryToDepartment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { ministryId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid department ID format',
      });
    }

    const isSuperAdmin = req.user?.role === 'super_admin';
    const isMinistryAdmin = req.user?.role === 'ministry_admin';

    if (req.user && !isSuperAdmin && !isMinistryAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only Super Admin or Ministry Admin can assign department to ministry',
      });
    }

    const department = await Department.findById(id);
    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    let targetMinistryId = ministryId;
    if (isMinistryAdmin) {
      targetMinistryId = req.user.ministryId;
    }

    if (targetMinistryId) {
      if (!isValidObjectId(targetMinistryId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid ministryId format',
        });
      }
      const ministry = await Ministry.findById(targetMinistryId);
      if (!ministry) {
        return res.status(404).json({
          success: false,
          message: 'Ministry not found',
        });
      }
      department.ministryId = targetMinistryId;
    } else {
      department.ministryId = null;
    }

    await department.save();

    const populated = await Department.findById(id).populate('ministryId', 'name code description');

    res.status(200).json({
      success: true,
      message: targetMinistryId
        ? `Department successfully assigned under ministry '${populated.ministryId?.name || ''}'`
        : 'Department successfully detached from ministry',
      data: populated,
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
