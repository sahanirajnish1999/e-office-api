import mongoose from 'mongoose';
import { User } from '../models/user.model.js';
import { Department } from '../models/department.model.js';
import { getPaginationParams, formatPaginatedResponse } from '../utils/pagination.util.js';
import { sendAccountCreatedEmail } from '../utils/mail.util.js';
import { generateNextEmployeeId } from '../utils/user.util.js';
import { isValidEmail, normalizeEmail, isValidPhone, normalizePhone, isValidObjectId } from '../utils/validator.util.js';

export { generateNextEmployeeId };

export const createEmployee = async (req, res, next) => {
  try {
    const {
      name,
      email,
      password,
      departmentId,
      employeeId,
      phone,
      designation,
      isAuthorizedOfficer,
      permissions,
    } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and password are required',
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address (e.g. employee@example.com)',
      });
    }

    if (phone && !isValidPhone(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid 10-digit mobile number',
      });
    }

    // Determine target department
    let targetDeptId = req.user.departmentId;

    // Super admin or Ministry admin can specify a departmentId explicitly
    if (req.user.role === 'super_admin') {
      if (!departmentId) {
        return res.status(400).json({
          success: false,
          message: 'Super Admin must specify a departmentId to assign the employee',
        });
      }
      if (!isValidObjectId(departmentId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid departmentId format',
        });
      }
      targetDeptId = departmentId;
    } else if (req.user.role === 'ministry_admin') {
      if (!departmentId) {
        return res.status(400).json({
          success: false,
          message: 'Ministry Admin must specify a departmentId to assign the employee',
        });
      }
      if (!isValidObjectId(departmentId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid departmentId format',
        });
      }
      targetDeptId = departmentId;
    } else {
      // Department admin must have a department assigned
      if (!targetDeptId) {
        return res.status(403).json({
          success: false,
          message: 'You are not assigned to any department and cannot create employees',
        });
      }
    }

    const dept = await Department.findById(targetDeptId);
    if (!dept) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    // Ministry Admin can only create employees for departments within their ministry
    if (req.user.role === 'ministry_admin') {
      if (!req.user.ministryId || dept.ministryId?.toString() !== req.user.ministryId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You can only create employees for departments within your ministry',
        });
      }
    }

    const normalizedEmail = normalizeEmail(email);

    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'A user with this email already exists',
      });
    }

    // Auto-generate employeeId if not provided (e.g. "MOR/ENG/045")
    let finalEmployeeId = (employeeId || '').trim().toUpperCase();
    if (!finalEmployeeId) {
      finalEmployeeId = await generateNextEmployeeId(dept._id, dept.code);
    }

    const employeeData = {
      name: name.trim(),
      email: normalizedEmail,
      password,
      role: 'employee',
      departmentId: targetDeptId,
      employeeId: finalEmployeeId,
      phone: phone ? normalizePhone(phone) : '',
      designation: designation || 'Staff Employee',
      isAuthorizedOfficer: Boolean(isAuthorizedOfficer),
    };

    if (permissions && typeof permissions === 'object') {
      employeeData.permissions = permissions;
    }

    const employee = await User.create(employeeData);

    // Send account creation email with login credentials
    try {
      await sendAccountCreatedEmail({
        email: employee.email,
        name: employee.name,
        userId: employee._id,
        employeeId: employee.employeeId,
        password,
        role: employee.role,
        departmentName: dept.name,
      });
    } catch (mailError) {
      console.error('Failed to send welcome email to employee:', mailError.message);
    }

    res.status(201).json({
      success: true,
      message: `Employee created successfully for department: ${dept.name}`,
      data: employee,
    });
  } catch (error) {
    next(error);
  }
};

export const listEmployees = async (req, res, next) => {
  try {
    const filter = { role: 'employee' };

    // If department admin, scope search strictly to their department
    if (req.user.role === 'department_admin') {
      filter.departmentId = isValidObjectId(req.user.departmentId)
        ? new mongoose.Types.ObjectId(req.user.departmentId)
        : req.user.departmentId;
    } else if (req.user.role === 'ministry_admin' && req.user.ministryId) {
      const ministryDeptIds = await Department.find({ ministryId: req.user.ministryId }).distinct('_id');
      if (req.query.departmentId) {
        if (!ministryDeptIds.some((id) => id.toString() === req.query.departmentId.toString())) {
          return res.status(200).json(formatPaginatedResponse({ total: 0, page: 1, pageSize: 20, data: [] }));
        }
        filter.departmentId = isValidObjectId(req.query.departmentId)
          ? new mongoose.Types.ObjectId(req.query.departmentId)
          : req.query.departmentId;
      } else {
        filter.departmentId = { $in: ministryDeptIds.map((id) => new mongoose.Types.ObjectId(id)) };
      }
    } else if (req.query.departmentId) {
      // Super admin can filter by department if provided in query
      filter.departmentId = isValidObjectId(req.query.departmentId)
        ? new mongoose.Types.ObjectId(req.query.departmentId)
        : req.query.departmentId;
    }

    const { page, pageSize, skip } = getPaginationParams(req.query);

    // Single-roundtrip aggregation pipeline with $facet & $lookup
    const [result] = await User.aggregate([
      { $match: filter },
      {
        $facet: {
          totalCount: [{ $count: 'total' }],
          paginatedData: [
            { $sort: { createdAt: -1 } },
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
              $addFields: {
                id: '$_id',
                joinedDate: '$createdAt',
                lastActiveTime: '$lastActiveAt',
              },
            },
            {
              $project: {
                password: 0,
                passwordResetToken: 0,
                passwordResetExpires: 0,
                __v: 0,
                createdAt: 0,
              },
            },
          ],
        },
      },
    ]);

    const total = result?.totalCount?.[0]?.total || 0;
    const employees = result?.paginatedData || [];

    res.status(200).json(
      formatPaginatedResponse({
        total,
        page,
        pageSize,
        data: employees,
      })
    );
  } catch (error) {
    next(error);
  }
};
