import mongoose from 'mongoose';
import { User } from '../models/user.model.js';
import { appConfig } from '../config/app.config.js';

/**
 * Generate sequential user/employee ID using pure MongoDB aggregation (Zero JS Loops)
 * Format: "PREFIX/CODE/001" (e.g., "MOR/HQ/001" for Super Admin, "MOR/ENG/001" for Dept Admin/Employee)
 */
export const generateNextEmployeeId = async (departmentId = null, departmentCode = 'HQ') => {
  const prefix = (appConfig.employeeIdPrefix || process.env.EMPLOYEE_ID_PREFIX || 'MOR').trim().toUpperCase();
  const code = (departmentCode || 'HQ').trim().toUpperCase();

  const matchFilter = {
    employeeId: { $regex: `^${prefix}/${code}/\\d+$` },
  };

  if (departmentId) {
    matchFilter.departmentId = new mongoose.Types.ObjectId(departmentId);
  } else {
    matchFilter.departmentId = null;
  }

  // Pure MongoDB aggregation pipeline: calculates maxSeq in database engine, zero JS loops
  const [result] = await User.aggregate([
    { $match: matchFilter },
    {
      $project: {
        seq: {
          $toInt: {
            $arrayElemAt: [{ $split: ['$employeeId', '/'] }, -1],
          },
        },
      },
    },
    {
      $group: {
        _id: null,
        maxSeq: { $max: '$seq' },
      },
    },
  ]);

  const nextSeq = (result?.maxSeq || 0) + 1;
  const paddedNumber = String(nextSeq).padStart(3, '0');
  return `${prefix}/${code}/${paddedNumber}`;
};

export default {
  generateNextEmployeeId,
};
