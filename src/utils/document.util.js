import mongoose from 'mongoose';
import { Document } from '../models/document.model.js';
import { appConfig } from '../config/app.config.js';

/**
 * Generate sequential file number using pure MongoDB aggregation (Zero JS Loops)
 * Format: "PREFIX/CODE/YEAR/F-001" (e.g., "MOR/CIVIL/2026/F-114")
 * Counter is scoped per department + year (resets each year).
 */
export const generateNextFileNumber = async (departmentId, departmentCode) => {
  const prefix = (appConfig.employeeIdPrefix || process.env.EMPLOYEE_ID_PREFIX || 'MOR').trim().toUpperCase();
  const code = (departmentCode || 'GEN').trim().toUpperCase();
  const year = new Date().getFullYear().toString();
  const regex = `^${prefix}/${code}/${year}/F-\\d+$`;

  // Pure MongoDB aggregation pipeline: calculates maxSeq in database engine, zero JS loops
  const [result] = await Document.aggregate([
    {
      $match: {
        departmentId: new mongoose.Types.ObjectId(departmentId),
        fileNumber: { $regex: regex },
      },
    },
    {
      $project: {
        seq: {
          $toInt: {
            $arrayElemAt: [{ $split: ['$fileNumber', '-'] }, -1],
          },
        },
      },
    },
    {
      $group: { _id: null, maxSeq: { $max: '$seq' } },
    },
  ]);

  const nextSeq = (result?.maxSeq || 0) + 1;
  const padded = String(nextSeq).padStart(3, '0');
  return `${prefix}/${code}/${year}/F-${padded}`;
};

export default { generateNextFileNumber };
