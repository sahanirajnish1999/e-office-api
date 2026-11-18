import { Document } from '../models/document.model.js';
import { DocumentForward } from '../models/document.forward.model.js';
import { DocumentPermission } from '../models/document.permission.model.js';

export const checkDocumentAccess = (requiredPermission = 'canView') => {
  return async (req, res, next) => {
    try {
      const { id } = req.params;
      const document = await Document.findById(id);

      if (!document) {
        return res.status(404).json({
          success: false,
          message: 'Document not found',
        });
      }

      // Super admin has unrestricted access to all files
      if (req.user.role === 'super_admin') {
        req.document = document;
        req.userPermission = {
          canView: true,
          canRemark: true,
          canSuggestChange: true,
          canDownload: true,
          isSuperAdmin: true,
        };
        return next();
      }

      const userIdStr = req.user.id.toString();
      const userDeptStr = req.user.departmentId ? req.user.departmentId.toString() : null;

      // Check if employee removed this file from their personal view
      const isHidden = document.hiddenForUsers.some(
        (h) => h.userId.toString() === userIdStr
      );
      if (isHidden) {
        return res.status(404).json({
          success: false,
          message: 'Document not found or has been removed from your personal access',
        });
      }

      let hasAccess = false;
      let userPermission = {
        canView: false,
        canRemark: false,
        canSuggestChange: false,
        canDownload: false,
      };

      // 1. Check Originating Department Access
      const isOriginDept = userDeptStr && document.departmentId.toString() === userDeptStr;
      if (isOriginDept && !document.isDeletedForOriginDept) {
        if (req.user.role === 'department_admin') {
          hasAccess = true;
          userPermission = {
            canView: true,
            canRemark: true,
            canSuggestChange: true,
            canDownload: true,
            isDeptAdmin: true,
          };
        } else {
          // Employee access level evaluation
          const docAccess = document.accessControl || document.targetAudience;
          if (docAccess === 'general' || docAccess === 'all_employees' || docAccess === 'department_only') {
            hasAccess = true;
            userPermission = {
              canView: true,
              canRemark: true,
              canSuggestChange: true,
              canDownload: true,
            };
          } else if (docAccess === 'restricted' && req.user.isAuthorizedOfficer) {
            hasAccess = true;
            userPermission = {
              canView: true,
              canRemark: true,
              canSuggestChange: true,
              canDownload: true,
            };
          }
        }
      }

      // 2. Check Forwarded Departments Access via DocumentForward collection (O(1) indexed lookup)
      if (!hasAccess && userDeptStr) {
        const forwardedRecord = await DocumentForward.findOne({
          documentId: document._id,
          targetDepartmentId: userDeptStr,
          isDeletedForDept: false,
        });

        if (forwardedRecord) {
          if (req.user.role === 'department_admin') {
            hasAccess = true;
            userPermission = {
              canView: true,
              canRemark: true,
              canSuggestChange: true,
              canDownload: true,
              isForwardedDeptAdmin: true,
            };
          } else {
            const fwdAccess = forwardedRecord.accessControl || forwardedRecord.targetAudience;
            if (fwdAccess === 'general' || fwdAccess === 'all_employees') {
              hasAccess = true;
              userPermission = {
                canView: true,
                canRemark: true,
                canSuggestChange: true,
                canDownload: true,
              };
            } else if (fwdAccess === 'restricted' && req.user.isAuthorizedOfficer) {
              hasAccess = true;
              userPermission = {
                canView: true,
                canRemark: true,
                canSuggestChange: true,
                canDownload: true,
              };
            }
          }
        }
      }

      // 3. Check Individual User Permission via DocumentPermission Collection (Pattern B: O(1) indexed lookup)
      if (!hasAccess) {
        const specificPermission = await DocumentPermission.findOne({
          documentId: document._id,
          userId: req.user.id,
        });

        if (specificPermission) {
          hasAccess = true;
          userPermission = { ...specificPermission.permissions };
        }
      }

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to access this document',
        });
      }

      // Check specific permission if requested (e.g., canRemark, canSuggestChange)
      if (requiredPermission && !userPermission[requiredPermission] && req.user.role !== 'department_admin') {
        return res.status(403).json({
          success: false,
          message: `Forbidden: You do not have '${requiredPermission}' permission on this document`,
        });
      }

      req.document = document;
      req.userPermission = userPermission;
      next();
    } catch (error) {
      next(error);
    }
  };
};

export default checkDocumentAccess;
