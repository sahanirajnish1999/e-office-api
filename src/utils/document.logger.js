import { DocumentLog } from '../models/document.log.model.js';
import { Department } from '../models/department.model.js';

/**
 * Record an audit log entry for a document
 */
export const recordDocumentLog = async ({
  fileId,
  documentId,
  fileNumber = '',
  user = {},
  departmentId,
  departmentName,
  action,
  details,
  description,
  ipAddress,
  req,
}) => {
  try {
    const targetFileId = fileId || documentId;
    const clientIp =
      ipAddress ||
      req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
      req?.ip ||
      req?.socket?.remoteAddress ||
      '127.0.0.1';

    let logDetails = details;
    if (logDetails === undefined || logDetails === null) {
      logDetails = description || '';
    } else if (typeof logDetails === 'object') {
      logDetails = description ? `${description} - ${JSON.stringify(logDetails)}` : JSON.stringify(logDetails);
    }

    // Resolve user's department information
    let userDeptId = departmentId || user.departmentId || null;
    let userDeptName = departmentName || user.departmentName || '';

    if (userDeptId && !userDeptName) {
      if (typeof user.departmentId === 'object' && user.departmentId?.name) {
        userDeptName = user.departmentId.name;
        userDeptId = user.departmentId._id;
      } else {
        try {
          const dept = await Department.findById(userDeptId).select('name');
          if (dept) userDeptName = dept.name;
        } catch {}
      }
    }

    return await DocumentLog.create({
      fileId: targetFileId,
      fileNumber,
      userId: user.id || user._id,
      userName: user.name || user.email || 'User',
      userRole: user.role || 'employee',
      departmentId: userDeptId,
      departmentName: userDeptName,
      action: action || 'Activity Logged',
      details: String(logDetails),
      ipAddress: clientIp,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Failed to write document audit log:', error.message);
  }
};
