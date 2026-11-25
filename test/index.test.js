import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { generateToken, verifyToken } from '../src/utils/token.util.js';
import { generateRandomToken, hashToken } from '../src/utils/crypto.util.js';
import { User } from '../src/models/user.model.js';
import { Department } from '../src/models/department.model.js';
import { EmailRequest } from '../src/models/email.request.model.js';
import { Document } from '../src/models/document.model.js';
import { DocumentForward } from '../src/models/document.forward.model.js';
import { DocumentReplica } from '../src/models/document.replica.model.js';
import { DocumentLog } from '../src/models/document.log.model.js';
import { DocumentPermission } from '../src/models/document.permission.model.js';
import { DocumentSticky } from '../src/models/document.sticky.model.js';
import { DocumentSignature } from '../src/models/document.signature.model.js';
import { DocumentRemark } from '../src/models/document.remark.model.js';
import { DocumentFile } from '../src/models/document.file.model.js';
import { VirtualStickyNote } from '../src/models/virtual.sticky.model.js';
import { createSticky, getStickiesByDocument, approveSticky } from '../src/controllers/document.sticky.controller.js';
import { getRemarksByDocument } from '../src/controllers/document.remark.controller.js';
import { uploadDocumentFile, getDocumentFiles, reviewDocumentFile, deleteDocumentFile, getDocumentFileCounts } from '../src/controllers/document.file.controller.js';
import { createVirtualSticky, getVirtualStickies, updateVirtualSticky, deleteVirtualSticky } from '../src/controllers/virtual.sticky.controller.js';
import { getPaginationParams, formatPaginatedResponse } from '../src/utils/pagination.util.js';
import { checkPermission } from '../src/middlewares/permission.middleware.js';
import { sendAccountCreatedEmail, sendSignatureOtpEmail } from '../src/utils/mail.util.js';
import { moveToDocumentFolder, removeDocumentFolder } from '../src/utils/file.util.js';
import { listDepartments, updateDepartment, deleteDepartment, getDepartmentById as getDeptById } from '../src/controllers/department.controller.js';
import { listUsers, getUserCounts, updateLastActiveTime, getUserDashboardSummary } from '../src/controllers/user.controller.js';
import { getAllDocumentLogs, getDocumentById, searchAndListDocuments, listDocumentPermissions, getMyDocumentCounts, searchAndListDocumentsAlphabetical, archiveDocument, listArchivedDocuments, forwardDocument, sendDraftForward, resendForward, recallForward, receiveForward, getPendingReceiptForwards } from '../src/controllers/document.controller.js';
import { generateNextEmployeeId, createEmployee, listEmployees } from '../src/controllers/employee.controller.js';
import { listReplicas } from '../src/controllers/document.replica.controller.js';
import { getMyRequests, listAllRequests } from '../src/controllers/email.request.controller.js';
import { createDepartmentAdmin } from '../src/controllers/user.controller.js';
import { Notification } from '../src/models/notification.model.js';
import { NotificationRead } from '../src/models/notification.read.model.js';
import {
  getMyNotifications,
  getNotificationCounts,
  listNotifications,
  createNotification,
  getNotificationById,
  markAsRead,
  markAllAsRead,
  updateNotification,
  deleteNotification,
} from '../src/controllers/notification.controller.js';
import { isValidEmail, normalizeEmail, isValidPhone, normalizePhone, isValidObjectId } from '../src/utils/validator.util.js';
import { generateNextFileNumber } from '../src/utils/document.util.js';
import { Ministry } from '../src/models/ministry.model.js';
import {
  createMinistry,
  listMinistries,
  getMinistryById,
  updateMinistry,
  deleteMinistry,
} from '../src/controllers/ministry.controller.js';
import { assignMinistryToDepartment, createDepartment } from '../src/controllers/department.controller.js';
import { createMinistryAdmin } from '../src/controllers/user.controller.js';
import { checkDocumentAccess } from '../src/middlewares/document.access.middleware.js';
import { DocumentWorkflowStatus, VALID_STATUSES } from '../src/models/document.workflow.status.model.js';
import {
  createDocumentWorkflowStatus,
  listDocumentWorkflowStatuses,
  getDocumentWorkflowStatusById,
  getDocumentStatusHistory,
  updateDocumentWorkflowStatus,
  deleteDocumentWorkflowStatus,
  verifyUserDocumentAccess,
} from '../src/controllers/document.workflow.status.controller.js';

process.env.NODE_ENV = 'test';

describe('Project Tests', () => {
  it('should generate and verify JWT token', () => {
    const payload = { id: '650c1f1e1f1e1f1e1f1e1f1e', email: 'admin@example.com', role: 'super_admin' };
    const token = generateToken(payload);
    assert.ok(typeof token === 'string');

    const decoded = verifyToken(token);
    assert.strictEqual(decoded.email, payload.email);
    assert.strictEqual(decoded.role, payload.role);
  });

  it('should generate crypto tokens and hash correctly', () => {
    const token = generateRandomToken(32);
    assert.strictEqual(token.length, 64);

    const hashed = hashToken(token);
    assert.strictEqual(hashed.length, 64);
    assert.notStrictEqual(token, hashed);
  });

  it('should validate User model schema definition with new roles and reset fields', () => {
    const paths = Object.keys(User.schema.paths);
    assert.ok(paths.includes('role'));
    assert.ok(paths.includes('departmentId'));
    assert.ok(paths.includes('passwordResetToken'));
    assert.ok(paths.includes('passwordResetExpires'));
    assert.ok(paths.includes('employeeId'));
    assert.ok(paths.includes('phone'));
    assert.ok(paths.includes('designation'));
    assert.ok(paths.includes('isAuthorizedOfficer'));
    assert.ok(paths.includes('isActive'));
    assert.ok(paths.includes('lastActiveAt'));
    assert.ok(paths.includes('permissions.canUploadDocuments'));
    assert.ok(paths.includes('permissions.canCreateFile'));
    assert.ok(paths.includes('permissions.canViewDashboard'));
  });

  it('should allow Super Admin through permission middleware regardless of individual flags', () => {
    const middleware = checkPermission('canUploadDocuments');
    let nextCalled = false;
    const req = {
      user: {
        role: 'super_admin',
        permissions: { canUploadDocuments: false },
      },
    };
    const res = {};
    middleware(req, res, () => {
      nextCalled = true;
    });
    assert.strictEqual(nextCalled, true);
  });

  it('should allow employee with active permission through checkPermission', () => {
    const middleware = checkPermission('canSearchFiles');
    let nextCalled = false;
    const req = {
      user: {
        role: 'employee',
        permissions: { canSearchFiles: true },
      },
    };
    const res = {};
    middleware(req, res, () => {
      nextCalled = true;
    });
    assert.strictEqual(nextCalled, true);
  });

  it('should forbid employee lacking permission with 403 status', () => {
    const middleware = checkPermission('canUploadDocuments');
    let statusCode = null;
    let jsonResponse = null;
    const req = {
      user: {
        role: 'employee',
        permissions: { canUploadDocuments: false },
      },
    };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        jsonResponse = data;
        return this;
      },
    };
    middleware(req, res, () => {});
    assert.strictEqual(statusCode, 403);
    assert.strictEqual(jsonResponse.success, false);
    assert.ok(jsonResponse.message.includes('canUploadDocuments'));
  });

  it('should validate Department model schema definition', () => {
    const paths = Object.keys(Department.schema.paths);
    assert.ok(paths.includes('name'));
    assert.ok(paths.includes('code'));
    assert.ok(paths.includes('createdBy'));
  });

  it('should validate EmailRequest model schema definition', () => {
    const paths = Object.keys(EmailRequest.schema.paths);
    assert.ok(paths.includes('userId'));
    assert.ok(paths.includes('currentEmail'));
    assert.ok(paths.includes('requestedEmail'));
    assert.ok(paths.includes('status'));
  });

  it('should validate Document model schema definition', () => {
    const paths = Object.keys(Document.schema.paths);
    assert.ok(paths.includes('title'));
    assert.ok(paths.includes('fileNumber'));
    assert.ok(paths.includes('registrationDate'));
    assert.ok(paths.includes('priority'));
    assert.ok(paths.includes('accessControl'));
    assert.ok(paths.includes('subject'));
    assert.strictEqual(paths.includes('shelf'), false);
    assert.ok(paths.includes('highlights'));
    assert.ok(paths.includes('logoFileName'));
    assert.ok(paths.includes('logoUrl'));
    assert.ok(paths.includes('logoOriginalName'));
    assert.ok(paths.includes('topHeadline'));
    assert.ok(paths.includes('topSubHeadline'));
    assert.ok(paths.includes('topOtherDetails'));
    assert.ok(paths.includes('footerDetails'));
    assert.ok(paths.includes('isDeletedForOriginDept'));
    assert.ok(paths.includes('pageNumber'));
    assert.ok(paths.includes('preservedDate'));
    assert.ok(paths.includes('preservedBy'));
    assert.ok(paths.includes('preservationNotes'));
    assert.strictEqual(paths.includes('originalName'), false);
    assert.strictEqual(paths.includes('storedFilename'), false);
    assert.strictEqual(paths.includes('filePath'), false);
    assert.strictEqual(paths.includes('fileUrl'), false);
    assert.strictEqual(paths.includes('mimeType'), false);
    assert.strictEqual(paths.includes('fileSize'), false);
    assert.strictEqual(paths.includes('stickies'), false);
    assert.strictEqual(paths.includes('remarks'), false);
  });

  it('should validate DocumentRemark model schema definition and paths', () => {
    const paths = Object.keys(DocumentRemark.schema.paths);
    assert.ok(paths.includes('documentId'));
    assert.ok(paths.includes('userId'));
    assert.ok(paths.includes('userName'));
    assert.ok(paths.includes('comment'));
    assert.ok(paths.includes('isEdited'));
    assert.ok(paths.includes('editedAt'));
    assert.strictEqual(typeof getRemarksByDocument, 'function');
  });

  it('should validate DocumentSticky model schema definition and paths', () => {
    const paths = Object.keys(DocumentSticky.schema.paths);
    assert.ok(paths.includes('documentId'));
    assert.ok(paths.includes('userId'));
    assert.ok(paths.includes('pageNumber'));
    assert.ok(paths.includes('color'));
    assert.ok(paths.includes('note'));
    assert.ok(paths.includes('authorName'));
    assert.ok(paths.includes('status'));
    assert.ok(paths.includes('isApproved'));
    assert.ok(paths.includes('approvedBy'));
    assert.ok(paths.includes('approvedByName'));
    assert.ok(paths.includes('approvedAt'));
    assert.ok(paths.includes('approvalIpAddress'));
    assert.ok(paths.includes('rejectionReason'));

    const statusOptions = DocumentSticky.schema.path('status').enumValues;
    assert.deepStrictEqual(statusOptions, ['pending', 'approve', 'reject']);
    assert.strictEqual(DocumentSticky.schema.path('status').defaultValue, 'pending');
    assert.strictEqual(DocumentSticky.schema.path('isApproved').defaultValue, false);
  });

  it('should validate DocumentForward model schema definition and lifecycle fields', () => {
    const fwdPaths = Object.keys(DocumentForward.schema.paths);
    assert.ok(fwdPaths.includes('documentId'));
    assert.ok(fwdPaths.includes('fromDepartmentId'));
    assert.ok(fwdPaths.includes('targetDepartmentId'));
    assert.ok(fwdPaths.includes('targetUserId'));
    assert.ok(fwdPaths.includes('forwardedBy'));
    assert.ok(fwdPaths.includes('priority'));
    assert.ok(fwdPaths.includes('accessControl'));
    assert.ok(fwdPaths.includes('forwardedAt'));
    assert.ok(fwdPaths.includes('isDeletedForDept'));
    assert.ok(fwdPaths.includes('status'));
    assert.ok(fwdPaths.includes('sentAt'));
    assert.ok(fwdPaths.includes('resendCount'));
    assert.ok(fwdPaths.includes('recalledAt'));
    assert.ok(fwdPaths.includes('recalledBy'));
    assert.ok(fwdPaths.includes('recallReason'));
    assert.ok(fwdPaths.includes('receivedBy'));
    assert.ok(fwdPaths.includes('receivedTime'));
    assert.ok(fwdPaths.includes('isPhysicalFileReceived'));
    assert.ok(fwdPaths.includes('physicalFileReceivedTime'));

    const statusEnum = DocumentForward.schema.path('status').enumValues;
    assert.deepStrictEqual(statusEnum, ['draft', 'sent', 'resend', 'receive', 'recalled']);
    assert.strictEqual(DocumentForward.schema.path('status').defaultValue, 'sent');
  });

  it('should validate DocumentReplica and DocumentLog model schema definitions', () => {
    const replicaPaths = Object.keys(DocumentReplica.schema.paths);
    assert.ok(replicaPaths.includes('parentDocumentId'));
    assert.ok(replicaPaths.includes('proposedChanges'));
    assert.ok(replicaPaths.includes('status'));

    const logPaths = Object.keys(DocumentLog.schema.paths);
    assert.ok(logPaths.includes('fileId'));
    assert.ok(logPaths.includes('fileNumber'));
    assert.ok(logPaths.includes('userName'));
    assert.ok(logPaths.includes('userRole'));
    assert.ok(logPaths.includes('departmentId'));
    assert.ok(logPaths.includes('departmentName'));
    assert.ok(logPaths.includes('action'));
    assert.ok(logPaths.includes('details'));
    assert.ok(logPaths.includes('ipAddress'));
    assert.ok(logPaths.includes('timestamp'));
  });

  it('should format DocumentLog JSON response exposing _id as id without duplicate timestamps', () => {
    const log = new DocumentLog({
      fileId: '650c1f1e1f1e1f1e1f1e1f1e',
      fileNumber: 'IR/CIV/2026/0012',
      userName: 'Vasu Tyagi',
      userRole: 'super_admin',
      departmentId: '650c1f1e1f1e1f1e1f1e9999',
      departmentName: 'Civil Engineering',
      action: 'File Created',
      details: 'Created electronic file IR/CIV/2026/0012',
      ipAddress: '127.0.0.1',
    });

    const json = log.toJSON();
    assert.ok(json.id);
    assert.strictEqual(typeof json.id, 'string');
    assert.strictEqual(json._id, undefined);
    assert.strictEqual(json.createdAt, undefined);
    assert.strictEqual(json.updatedAt, undefined);
    assert.ok(json.timestamp);
    assert.strictEqual(json.fileNumber, 'IR/CIV/2026/0012');
    assert.strictEqual(json.departmentName, 'Civil Engineering');
  });

  it('should validate DocumentPermission model schema definition', () => {
    const permPaths = Object.keys(DocumentPermission.schema.paths);
    assert.ok(permPaths.includes('documentId'));
    assert.ok(permPaths.includes('userId'));
    assert.ok(permPaths.includes('permissions.canView'));
    assert.ok(permPaths.includes('permissions.canRemark'));
    assert.ok(permPaths.includes('permissions.canSuggestChange'));
    assert.ok(permPaths.includes('permissions.canDownload'));
    assert.ok(permPaths.includes('permissions.canHighlightDocuments'));
    assert.ok(permPaths.includes('permissions.canUseStickyNotes'));
    assert.ok(permPaths.includes('permissions.canAddOfficialNoting'));
    assert.ok(permPaths.includes('permissions.canApproveNoting'));
    assert.ok(permPaths.includes('permissions.canWithdrawFile'));
    assert.ok(permPaths.includes('permissions.canDeletePartial'));
    assert.ok(permPaths.includes('grantedBy'));
  });

  it('should parse pagination params and format paginated responses correctly', () => {
    const params = getPaginationParams({ page: '2', pageSize: '15' });
    assert.strictEqual(params.page, 2);
    assert.strictEqual(params.pageSize, 15);
    assert.strictEqual(params.skip, 15);

    const formatted = formatPaginatedResponse({
      total: 45,
      page: params.page,
      pageSize: params.pageSize,
      data: [{ id: 1 }, { id: 2 }],
    });

    assert.strictEqual(formatted.success, true);
    assert.strictEqual(formatted.total, 45);
    assert.strictEqual(formatted.page, 2);
    assert.strictEqual(formatted.pageSize, 15);
    assert.strictEqual(formatted.totalPages, 3);
    assert.strictEqual(formatted.data.length, 2);
  });

  it('should verify sendAccountCreatedEmail utility exists and is a callable function', () => {
    assert.strictEqual(typeof sendAccountCreatedEmail, 'function');
  });

  it('should organize file into document-specific subfolder and remove cleanly', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { appConfig } = await import('../src/config/app.config.js');

    const baseUploadDir = path.resolve(process.cwd(), appConfig.uploadDir || 'uploads');
    if (!fs.existsSync(baseUploadDir)) {
      fs.mkdirSync(baseUploadDir, { recursive: true });
    }

    const testDocId = '650c1f1e1f1e1f1e1f1e9999';
    const tempFile = path.join(baseUploadDir, 'test-dummy-file.txt');
    fs.writeFileSync(tempFile, 'Sample content for file organization test');

    const result = moveToDocumentFolder(tempFile, testDocId, 'files');
    assert.ok(result);
    assert.strictEqual(result.filename, 'test-dummy-file.txt');
    assert.ok(result.destPath.includes(path.join('uploaded-files', testDocId, 'files')));
    assert.strictEqual(result.fileUrl, `/uploads/uploaded-files/${testDocId}/files/test-dummy-file.txt`);
    assert.ok(fs.existsSync(result.destPath));

    // Cleanup via removeDocumentFolder
    removeDocumentFolder(testDocId);
    assert.strictEqual(fs.existsSync(result.destPath), false);
  });

  it('should verify updateDepartment and deleteDepartment controllers exist and validate requests', async () => {
    assert.strictEqual(typeof updateDepartment, 'function');
    assert.strictEqual(typeof deleteDepartment, 'function');

    // Test updateDepartment with invalid ID format
    let resStatus = 0;
    let resJson = null;
    const mockRes = {
      status(code) {
        resStatus = code;
        return {
          json(payload) {
            resJson = payload;
          },
        };
      },
    };

    await updateDepartment({ params: { id: 'invalid-id' }, body: { name: 'Test' } }, mockRes, () => {});
    assert.strictEqual(resStatus, 400);
    assert.strictEqual(resJson.success, false);
    assert.strictEqual(resJson.message, 'Invalid department ID format');

    // Test updateDepartment with empty body (no fields to update)
    await updateDepartment({ params: { id: '650c1f1e1f1e1f1e1f1e1f1e' }, body: {} }, mockRes, () => {});
    assert.strictEqual(resStatus, 400);
    assert.strictEqual(resJson.success, false);
    assert.ok(resJson.message.includes('at least one field'));

    // Test deleteDepartment with invalid ID format
    await deleteDepartment({ params: { id: 'invalid-id' } }, mockRes, () => {});
    assert.strictEqual(resStatus, 400);
    assert.strictEqual(resJson.success, false);
    assert.strictEqual(resJson.message, 'Invalid department ID format');
  });

  it('should verify listUsers and getUserCounts controllers are callable functions', () => {
    assert.strictEqual(typeof listUsers, 'function');
    assert.strictEqual(typeof getUserCounts, 'function');
  });

  it('should verify listUsers handles search, role, admin, and date query parameters', async () => {
    let capturedQuery = null;
    let capturedSort = null;

    // Save original User methods
    const originalCount = User.countDocuments;
    const originalFind = User.find;

    User.countDocuments = async (q) => {
      capturedQuery = q;
      return 1;
    };
    User.find = (q) => {
      capturedQuery = q;
      return {
        populate() {
          return {
            sort(s) {
              capturedSort = s;
              return {
                skip() {
                  return {
                    limit() {
                      return [{ name: 'Test Officer', email: 'test@example.com' }];
                    },
                  };
                },
              };
            },
          };
        },
      };
    };

    let responseData = null;
    const mockRes = {
      status() {
        return {
          json(data) {
            responseData = data;
          },
        };
      },
    };

    // Test text search, onlyAdmins, isAuthorizedOfficer, and date filtering
    await listUsers(
      {
        query: {
          search: 'Engineer',
          onlyAdmins: 'true',
          isAuthorizedOfficer: 'true',
          joinedDateFrom: '2026-11-01',
          joinedDateTo: '2026-11-18',
          sortAlphabetical: 'asc',
        },
      },
      mockRes,
      () => {}
    );

    // Restore original methods
    User.countDocuments = originalCount;
    User.find = originalFind;

    assert.ok(capturedQuery);
    assert.ok(capturedQuery.$or);
    assert.strictEqual(capturedQuery.$or.length, 4);
    assert.deepStrictEqual(capturedQuery.role, { $in: ['super_admin', 'department_admin'] });
    assert.strictEqual(capturedQuery.isAuthorizedOfficer, true);
    assert.ok(capturedQuery.createdAt.$gte instanceof Date);
    assert.ok(capturedQuery.createdAt.$lte instanceof Date);
    assert.deepStrictEqual(capturedSort, { name: 1 });
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.total, 1);
  });

  it('should verify User toJSON exposes joinedDate and lastActiveAt instead of createdAt', () => {
    assert.strictEqual(typeof updateLastActiveTime, 'function');

    const user = new User({
      name: 'Test Officer',
      email: 'officer@example.com',
      password: 'Password123!',
      role: 'employee',
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
    });

    const json = user.toJSON();
    assert.strictEqual(json.createdAt, undefined);
    assert.ok(json.joinedDate);
    assert.ok(json.lastActiveAt);
  });

  it('should verify listDepartments uses aggregation pipeline and returns enriched data with id instead of _id', async () => {
    assert.strictEqual(typeof listDepartments, 'function');

    const originalAggregate = Department.aggregate;
    const mockDeptId = '650c1f1e1f1e1f1e1f1e7777';
    let capturedPipeline = null;

    Department.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [
        {
          metadata: [{ total: 1 }],
          data: [
            {
              id: mockDeptId,
              name: 'Civil Works',
              code: 'CIV',
              description: 'Infrastructure',
              adminName: 'Alice Admin',
              adminDesignation: 'Director',
              employeesCount: 5,
              filesCount: 12,
              createdBy: { id: '650c1f1e1f1e1f1e1f1e0001', name: 'Super Admin', email: 'admin@example.com' },
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        },
      ];
    };

    let response = null;
    const mockRes = {
      status() {
        return {
          json(payload) {
            response = payload;
          },
        };
      },
    };

    await listDepartments(
      {
        query: {
          page: '1',
          pageSize: '10',
          search: 'Civil',
          sortBy: 'highest_files',
        },
        user: { id: '650c1f1e1f1e1f1e1f1e1001', role: 'super_admin' },
      },
      mockRes,
      () => {}
    );

    // Restore original
    Department.aggregate = originalAggregate;

    assert.ok(capturedPipeline);
    assert.ok(capturedPipeline.some((stage) => stage.$match && stage.$match.$or));
    assert.ok(capturedPipeline.some((stage) => stage.$sort && stage.$sort.filesCount === -1));
    assert.ok(capturedPipeline.some((stage) => stage.$facet));
    assert.ok(response);
    assert.strictEqual(response.success, true);
    assert.strictEqual(response.total, 1);
    assert.strictEqual(response.data.length, 1);
    const dept = response.data[0];
    assert.strictEqual(dept.id, mockDeptId);
    assert.strictEqual(dept._id, undefined);
    assert.strictEqual(dept.adminName, 'Alice Admin');
    assert.strictEqual(dept.adminDesignation, 'Director');
    assert.strictEqual(dept.employeesCount, 5);
    assert.strictEqual(dept.filesCount, 12);
  });

  it('should return 403 for non-super_admin on listDepartments and getDepartmentById', async () => {
    let statusCode = null;
    let responseData = null;
    const mockRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      },
    };

    // 1. Employee calling listDepartments -> 403
    await listDepartments(
      {
        query: {},
        user: { id: '650c1f1e1f1e1f1e1f1e3333', role: 'employee' },
      },
      mockRes,
      () => {}
    );
    assert.strictEqual(statusCode, 403);
    assert.strictEqual(responseData.success, false);

    // 2. Department Admin calling listDepartments -> 403
    statusCode = null;
    responseData = null;
    await listDepartments(
      {
        query: {},
        user: { id: '650c1f1e1f1e1f1e1f1e2222', role: 'department_admin' },
      },
      mockRes,
      () => {}
    );
    assert.strictEqual(statusCode, 403);
    assert.strictEqual(responseData.success, false);

    // 3. Employee calling getDepartmentById -> 403
    statusCode = null;
    responseData = null;
    await getDeptById(
      {
        params: { id: '650c1f1e1f1e1f1e1f1e1001' },
        user: { id: '650c1f1e1f1e1f1e1f1e3333', role: 'employee' },
      },
      mockRes,
      () => {}
    );
    assert.strictEqual(statusCode, 403);
    assert.strictEqual(responseData.success, false);

    // 4. Department Admin calling getDepartmentById -> 403
    statusCode = null;
    responseData = null;
    await getDeptById(
      {
        params: { id: '650c1f1e1f1e1f1e1f1e1001' },
        user: { id: '650c1f1e1f1e1f1e1f1e2222', role: 'department_admin' },
      },
      mockRes,
      () => {}
    );
    assert.strictEqual(statusCode, 403);
    assert.strictEqual(responseData.success, false);
  });

  it('should verify getAllDocumentLogs uses aggregation pipeline with employee, department, timeRange, and sort filters', async () => {
    assert.strictEqual(typeof getAllDocumentLogs, 'function');

    const originalAggregate = DocumentLog.aggregate;
    const mockLogId = '650c1f1e1f1e1f1e1f1e8888';
    const mockDeptId = '650c1f1e1f1e1f1e1f1e9999';
    const mockUserId = '650c1f1e1f1e1f1e1f1e1111';
    let capturedPipeline = null;

    DocumentLog.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [
        {
          metadata: [{ total: 1 }],
          data: [
            {
              id: mockLogId,
              fileId: '650c1f1e1f1e1f1e1f1e2222',
              fileNumber: 'IR/CIV/2026/0012',
              userId: mockUserId,
              userName: 'Test Employee',
              userRole: 'employee',
              departmentId: mockDeptId,
              departmentName: 'Civil Engineering',
              action: 'File Created',
              details: 'Created file IR/CIV/2026/0012',
              ipAddress: '127.0.0.1',
              timestamp: new Date(),
            },
          ],
        },
      ];
    };

    let response = null;
    const mockRes = {
      status() {
        return {
          json(payload) {
            response = payload;
          },
        };
      },
    };

    await getAllDocumentLogs(
      {
        query: {
          page: '1',
          pageSize: '10',
          employeeId: mockUserId,
          departmentId: mockDeptId,
          timeRange: '7_days',
          sort: 'oldest',
        },
      },
      mockRes,
      () => {}
    );

    // Restore original
    DocumentLog.aggregate = originalAggregate;

    assert.ok(capturedPipeline);
    const matchStage = capturedPipeline.find((stage) => stage.$match);
    assert.ok(matchStage);
    assert.strictEqual(matchStage.$match.userId.toString(), mockUserId);
    assert.strictEqual(matchStage.$match.departmentId.toString(), mockDeptId);
    assert.ok(matchStage.$match.timestamp.$gte instanceof Date);

    const sortStage = capturedPipeline.find((stage) => stage.$sort);
    assert.ok(sortStage);
    assert.strictEqual(sortStage.$sort.timestamp, 1);

    const facetStage = capturedPipeline.find((stage) => stage.$facet);
    assert.ok(facetStage);

    assert.ok(response);
    assert.strictEqual(response.success, true);
    assert.strictEqual(response.total, 1);
    assert.strictEqual(response.data.length, 1);
    const log = response.data[0];
    assert.strictEqual(log.id, mockLogId);
    assert.strictEqual(log._id, undefined);
    assert.strictEqual(log.departmentName, 'Civil Engineering');
    assert.strictEqual(log.userName, 'Test Employee');
  });

  it('should auto-generate sequential employee ID using zero-loop aggregation pipeline (Option A)', async () => {
    assert.strictEqual(typeof generateNextEmployeeId, 'function');

    const originalAggregate = User.aggregate;
    const mockDeptId = '650c1f1e1f1e1f1e1f1e5555';
    let capturedPipeline = null;

    // Test 1: First employee in department (0 existing -> 001)
    User.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return []; // No previous records
    };

    const firstId = await generateNextEmployeeId(mockDeptId, 'ENG');
    assert.strictEqual(firstId, 'MOR/ENG/001');

    // Verify aggregation pipeline structure
    assert.ok(capturedPipeline);
    const matchStage = capturedPipeline.find((s) => s.$match);
    assert.ok(matchStage);
    assert.strictEqual(matchStage.$match.departmentId.toString(), mockDeptId);
    assert.ok(matchStage.$match.employeeId.$regex);

    const projectStage = capturedPipeline.find((s) => s.$project);
    assert.ok(projectStage && projectStage.$project.seq);

    const groupStage = capturedPipeline.find((s) => s.$group);
    assert.ok(groupStage && groupStage.$group.maxSeq);

    // Test 2: Next employee when 44 exist -> 045
    User.aggregate = async () => {
      return [{ _id: null, maxSeq: 44 }];
    };

    const nextId = await generateNextEmployeeId(mockDeptId, 'ENG');
    assert.strictEqual(nextId, 'MOR/ENG/045');

    // Test 3: Super Admin without department -> HQ code (e.g. MOR/HQ/001)
    User.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [];
    };

    const superAdminId = await generateNextEmployeeId(null, 'HQ');
    assert.strictEqual(superAdminId, 'MOR/HQ/001');
    const saMatch = capturedPipeline.find((s) => s.$match);
    assert.strictEqual(saMatch.$match.departmentId, null);

    // Test 4: Department Admin in Civil -> MOR/CIV/001
    const deptAdminId = await generateNextEmployeeId(mockDeptId, 'CIV');
    assert.strictEqual(deptAdminId, 'MOR/CIV/001');

    // Restore original
    User.aggregate = originalAggregate;
  });

  it('should validate email, phone number, and ObjectId formats using validator utility', () => {
    // Email Validation
    assert.strictEqual(isValidEmail('admin@example.com'), true);
    assert.strictEqual(isValidEmail('officer.dev@mor.gov.in'), true);
    assert.strictEqual(isValidEmail('support+tag@sub.domain.co'), true);
    assert.strictEqual(isValidEmail('invalid-email'), false);
    assert.strictEqual(isValidEmail('user@'), false);
    assert.strictEqual(isValidEmail('@domain.com'), false);
    assert.strictEqual(isValidEmail('user@domain'), false);
    assert.strictEqual(normalizeEmail('  User@Example.COM  '), 'user@example.com');

    // Phone Validation
    assert.strictEqual(isValidPhone('9876543210'), true);
    assert.strictEqual(isValidPhone('+919876543210'), true);
    assert.strictEqual(isValidPhone('+91 98765-43210'), true);
    assert.strictEqual(isValidPhone('+12025550123'), true);
    assert.strictEqual(isValidPhone('12345'), false);
    assert.strictEqual(isValidPhone('abcdefghij'), false);
    assert.strictEqual(isValidPhone('0000000000'), false);
    assert.strictEqual(normalizePhone('+91 98765-43210'), '+919876543210');

    // ObjectId Validation
    assert.strictEqual(isValidObjectId('650c1f1e1f1e1f1e1f1e1f1e'), true);
    assert.strictEqual(isValidObjectId('invalid-id'), false);
    assert.strictEqual(isValidObjectId('123'), false);
    assert.strictEqual(isValidObjectId(''), false);
    assert.strictEqual(isValidObjectId(null), false);
  });

  it('should reject employee creation with invalid email, phone, or departmentId format', async () => {
    let statusCode = null;
    let responseBody = null;

    const mockRes = {
      status(code) {
        statusCode = code;
        return {
          json(data) {
            responseBody = data;
          },
        };
      },
    };

    // 1. Invalid email
    await createEmployee(
      {
        user: { role: 'super_admin' },
        body: {
          name: 'Invalid Email User',
          email: 'not-an-email',
          password: 'Password123!',
          departmentId: '650c1f1e1f1e1f1e1f1e1f1e',
        },
      },
      mockRes,
      () => {}
    );
    assert.strictEqual(statusCode, 400);
    assert.ok(responseBody.message.includes('valid email address'));

    // 2. Invalid phone
    await createEmployee(
      {
        user: { role: 'super_admin' },
        body: {
          name: 'Invalid Phone User',
          email: 'valid.user@example.com',
          password: 'Password123!',
          departmentId: '650c1f1e1f1e1f1e1f1e1f1e',
          phone: '12345',
        },
      },
      mockRes,
      () => {}
    );
    assert.strictEqual(statusCode, 400);
    assert.ok(responseBody.message.includes('valid 10-digit mobile number'));

    // 3. Invalid departmentId (Super Admin)
    await createEmployee(
      {
        user: { role: 'super_admin' },
        body: {
          name: 'Invalid Dept User',
          email: 'valid.user2@example.com',
          password: 'Password123!',
          departmentId: 'invalid-id-123',
        },
      },
      mockRes,
      () => {}
    );
    assert.strictEqual(statusCode, 400);
    assert.strictEqual(responseBody.message, 'Invalid departmentId format');
  });

  it('should validate generateNextFileNumber aggregation pipeline structure', async () => {
    // Verify the aggregation pipeline has the correct 3 stages: $match, $project, $group
    // We mock Document.aggregate to capture and inspect the pipeline
    const originalAggregate = Document.aggregate.bind(Document);
    let capturedPipeline = null;

    Document.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return []; // simulate no existing documents
    };

    const deptId = '650c1f1e1f1e1f1e1f1e1f1e';
    const result = await generateNextFileNumber(deptId, 'CIVIL');

    // Restore original
    Document.aggregate = originalAggregate;

    // Verify 3 pipeline stages
    assert.strictEqual(capturedPipeline.length, 3);

    // Stage 0: $match
    const matchStage = capturedPipeline[0];
    assert.ok(matchStage.$match, '$match stage must exist');
    assert.ok(matchStage.$match.fileNumber.$regex, '$match must filter by fileNumber regex');

    // Stage 1: $project with $toInt + $split
    const projectStage = capturedPipeline[1];
    assert.ok(projectStage.$project, '$project stage must exist');
    assert.ok(projectStage.$project.seq, '$project must extract seq');

    // Stage 2: $group with $max
    const groupStage = capturedPipeline[2];
    assert.ok(groupStage.$group, '$group stage must exist');
    assert.ok(groupStage.$group.maxSeq, '$group must compute maxSeq');

    // No existing docs → result should be F-001
    const year = new Date().getFullYear();
    assert.ok(result.endsWith('/F-001'), `Expected result to end with /F-001 but got: ${result}`);
    assert.ok(result.includes(`/CIVIL/${year}/`), `Expected year ${year} and CIVIL in result: ${result}`);
  });

  it('should generate correct next file number based on existing max sequence', async () => {
    const originalAggregate = Document.aggregate.bind(Document);

    // Simulate existing documents with max sequence F-113
    Document.aggregate = async () => [{ _id: null, maxSeq: 113 }];

    const deptId = '650c1f1e1f1e1f1e1f1e1f1e';
    const result = await generateNextFileNumber(deptId, 'CIVIL');

    Document.aggregate = originalAggregate;

    // Should produce F-114
    assert.ok(result.endsWith('/F-114'), `Expected /F-114 but got: ${result}`);
  });

  it('should validate DocumentSignature model schema definition and paths', () => {
    const paths = Object.keys(DocumentSignature.schema.paths);
    assert.ok(paths.includes('documentId'));
    assert.ok(paths.includes('userId'));
    assert.ok(paths.includes('ipAddress'));
    assert.ok(paths.includes('device'));
    assert.ok(paths.includes('signedAt'));
    assert.ok(paths.includes('isVerified'));
    assert.ok(paths.includes('status'));
    assert.ok(paths.includes('approvedBy'));
    assert.ok(paths.includes('approvedAt'));
    assert.ok(paths.includes('rejectionReason'));
    assert.ok(paths.includes('otp'));
    assert.ok(paths.includes('otpExpiresAt'));

    const statusOptions = DocumentSignature.schema.path('status').enumValues;
    assert.deepStrictEqual(statusOptions, ['pending', 'approve', 'reject']);
  });

  it('should verify sendSignatureOtpEmail utility exists and is a callable function', () => {
    assert.strictEqual(typeof sendSignatureOtpEmail, 'function');
  });

  it('should validate DocumentFile model schema definition, paths, and defaults', () => {
    const paths = Object.keys(DocumentFile.schema.paths);
    assert.ok(paths.includes('documentId'));
    assert.ok(paths.includes('uploadUserId'));
    assert.ok(paths.includes('uploadTime'));
    assert.ok(paths.includes('originalName'));
    assert.ok(paths.includes('storedFilename'));
    assert.ok(paths.includes('filePath'));
    assert.ok(paths.includes('fileUrl'));
    assert.ok(paths.includes('mimeType'));
    assert.ok(paths.includes('fileSize'));
    assert.ok(paths.includes('pageNumber'));
    assert.ok(paths.includes('fileSummary'));
    assert.ok(paths.includes('status'));
    assert.ok(paths.includes('approvedBy'));
    assert.ok(paths.includes('approvedAt'));
    assert.ok(paths.includes('rejectionReason'));

    const statusOptions = DocumentFile.schema.path('status').enumValues;
    assert.deepStrictEqual(statusOptions, ['pending', 'approve', 'reject']);

    // Validate defaults
    assert.strictEqual(DocumentFile.schema.path('status').defaultValue, 'pending');
    assert.strictEqual(DocumentFile.schema.path('pageNumber').defaultValue, 1);
  });

  it('should verify DocumentFile controller methods are defined and callable functions', () => {
    assert.strictEqual(typeof uploadDocumentFile, 'function');
    assert.strictEqual(typeof getDocumentFiles, 'function');
    assert.strictEqual(typeof reviewDocumentFile, 'function');
    assert.strictEqual(typeof deleteDocumentFile, 'function');
    assert.strictEqual(typeof getDocumentFileCounts, 'function');
  });

  it('should verify getDocumentFileCounts uses $facet aggregation and is restricted to Super Admin', async () => {
    const originalAggregate = DocumentFile.aggregate;
    let capturedPipeline = null;

    DocumentFile.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [{ totalFiles: [{ count: 150 }], approvedFiles: [{ count: 80 }], pendingFiles: [{ count: 60 }], rejectedFiles: [{ count: 10 }] }];
    };

    let responseData = null;
    let statusCode = null;
    const req = { user: { id: 'admin-id', role: 'super_admin' } };
    const res = { status(c) { statusCode = c; return this; }, json(d) { responseData = d; return this; } };

    await getDocumentFileCounts(req, res, () => {});
    DocumentFile.aggregate = originalAggregate;

    const facetStage = capturedPipeline.find((s) => s.$facet);
    assert.ok(facetStage, '$facet stage must exist in pipeline');
    assert.ok(facetStage.$facet.totalFiles,    'totalFiles bucket must exist');
    assert.ok(facetStage.$facet.approvedFiles, 'approvedFiles bucket must exist');
    assert.ok(facetStage.$facet.pendingFiles,  'pendingFiles bucket must exist');
    assert.ok(facetStage.$facet.rejectedFiles, 'rejectedFiles bucket must exist');
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.data.totalFiles,    150);
    assert.strictEqual(responseData.data.approvedFiles,  80);
    assert.strictEqual(responseData.data.pendingFiles,   60);
    assert.strictEqual(responseData.data.rejectedFiles,  10);
  });

  it('should return 403 for non-super_admin on getDocumentFileCounts', async () => {
    let statusCode = null;
    let responseData = null;
    const req = { user: { id: 'emp-id', role: 'employee' } };
    const res = { status(c) { statusCode = c; return this; }, json(d) { responseData = d; return this; } };

    await getDocumentFileCounts(req, res, () => {});

    assert.strictEqual(statusCode, 403);
    assert.strictEqual(responseData.success, false);
  });

  it('should validate VirtualStickyNote model schema definition, paths, and defaults', () => {
    const paths = Object.keys(VirtualStickyNote.schema.paths);
    assert.ok(paths.includes('userId'));
    assert.ok(paths.includes('userName'));
    assert.ok(paths.includes('documentId'));
    assert.ok(paths.includes('detailSummary'));
    assert.ok(paths.includes('stickyColor'));
    assert.ok(paths.includes('isPinned'));
    assert.ok(paths.includes('createdAt'));

    // Validate defaults
    assert.strictEqual(VirtualStickyNote.schema.path('stickyColor').defaultValue, 'yellow');
    assert.strictEqual(VirtualStickyNote.schema.path('isPinned').defaultValue, false);
  });

  it('should verify VirtualStickyNote controller methods are defined and callable functions', () => {
    assert.strictEqual(typeof createVirtualSticky, 'function');
    assert.strictEqual(typeof getVirtualStickies, 'function');
    assert.strictEqual(typeof updateVirtualSticky, 'function');
    assert.strictEqual(typeof deleteVirtualSticky, 'function');
  });

  it('should sort virtual sticky notes with pinned items first and newest date second', () => {
    const rawNotes = [
      { id: 1, isPinned: false, createdAt: new Date('2026-11-20T10:00:00Z') },
      { id: 2, isPinned: true,  createdAt: new Date('2026-11-19T10:00:00Z') }, // older, but pinned!
      { id: 3, isPinned: false, createdAt: new Date('2026-11-21T12:00:00Z') }, // newest, unpinned
      { id: 4, isPinned: true,  createdAt: new Date('2026-11-21T09:00:00Z') }, // newer, pinned!
    ];

    // Simulating { isPinned: -1, createdAt: -1 }
    const sorted = [...rawNotes].sort((a, b) => {
      if (a.isPinned !== b.isPinned) {
        return b.isPinned ? 1 : -1;
      }
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    // Pinned notes should come first (id 4, then id 2), followed by unpinned notes by date (id 3, then id 1)
    assert.deepStrictEqual(sorted.map(n => n.id), [4, 2, 3, 1]);
  });

  it('should verify getStickiesByDocument uses aggregation pipeline with $facet and returns paginated response', async () => {
    const originalAggregate = DocumentSticky.aggregate;
    let capturedPipeline = null;

    DocumentSticky.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [
        {
          metadata: [{ total: 1 }],
          data: [
            {
              _id: '673f1b40a92f000000000002',
              documentId: '650c1f1e1f1e1f1e1f1e1f1e',
              note: 'Test note',
              color: 'yellow',
              pageNumber: 1,
            },
          ],
        },
      ];
    };

    const req = {
      params: { documentId: '650c1f1e1f1e1f1e1f1e1f1e' },
      query: { page: '1', pageSize: '10' },
    };
    let responseData = null;
    let statusCode = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      },
    };

    await getStickiesByDocument(req, res, () => {});
    DocumentSticky.aggregate = originalAggregate;

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.total, 1);
    assert.strictEqual(responseData.page, 1);
    assert.strictEqual(responseData.pageSize, 10);
    assert.strictEqual(responseData.totalPages, 1);
    assert.strictEqual(responseData.data.length, 1);

    // Verify pipeline stages: $match, $sort, $facet
    assert.ok(capturedPipeline);
    const facetStage = capturedPipeline.find((s) => s.$facet);
    assert.ok(facetStage);
    assert.ok(facetStage.$facet.metadata);
    assert.ok(facetStage.$facet.data);
  });

  it('should verify getVirtualStickies uses aggregation pipeline with $facet and returns paginated response', async () => {
    const originalAggregate = VirtualStickyNote.aggregate;
    let capturedPipeline = null;

    VirtualStickyNote.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [
        {
          metadata: [{ total: 1 }],
          data: [
            {
              _id: '673f1b40a92f000000000004',
              documentId: '650c1f1e1f1e1f1e1f1e1f1e',
              detailSummary: 'Test personal note',
              stickyColor: 'pink',
              isPinned: true,
            },
          ],
        },
      ];
    };

    const req = {
      user: { id: '650c1f1e1f1e1f1e1f1e9999' },
      params: { id: '650c1f1e1f1e1f1e1f1e1f1e' },
      query: { page: '1', pageSize: '10' },
    };
    let responseData = null;
    let statusCode = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      },
    };

    await getVirtualStickies(req, res, () => {});
    VirtualStickyNote.aggregate = originalAggregate;

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.total, 1);
    assert.strictEqual(responseData.page, 1);
    assert.strictEqual(responseData.pageSize, 10);
    assert.strictEqual(responseData.totalPages, 1);
    assert.strictEqual(responseData.data.length, 1);

    // Verify pipeline stages: $match, $sort, $facet
    assert.ok(capturedPipeline);
    const facetStage = capturedPipeline.find((s) => s.$facet);
    assert.ok(facetStage);
    assert.ok(facetStage.$facet.metadata);
    assert.ok(facetStage.$facet.data);
  });

  it('should ensure createSticky assigns userId strictly from req.user and ignores body.userId', async () => {
    const originalFindById = Document.findById;
    const originalCreate = DocumentSticky.create;
    const originalLogCreate = DocumentLog.create;
    DocumentLog.create = async () => ({});

    let capturedCreateData = null;
    Document.findById = async () => ({ _id: '650c1f1e1f1e1f1e1f1e1f1e', fileNumber: 'MOR/CIVIL/2026/F-001' });
    DocumentSticky.create = async (data) => {
      capturedCreateData = data;
      return { ...data, _id: '650c1f1e1f1e1f1e1f1e9999' };
    };

    const req = {
      user: { id: '650c1f1e1f1e1f1e1f1e1111', name: 'Real User', email: 'real@example.com' },
      body: {
        documentId: '650c1f1e1f1e1f1e1f1e1f1e',
        note: 'Important note',
        color: 'pink',
        pageNumber: 2,
        userId: '650c1f1e1f1e1f1e1f1e9999', // spoofed/passed in body
      },
      headers: {},
    };

    let statusCode = null;
    let responseData = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      },
    };

    await createSticky(req, res, () => {});

    Document.findById = originalFindById;
    DocumentSticky.create = originalCreate;
    DocumentLog.create = originalLogCreate;

    assert.strictEqual(statusCode, 201);
    assert.ok(capturedCreateData);
    assert.strictEqual(capturedCreateData.userId, '650c1f1e1f1e1f1e1f1e1111');
    assert.strictEqual(capturedCreateData.createdBy, '650c1f1e1f1e1f1e1f1e1111');
    assert.strictEqual(capturedCreateData.authorName, 'Real User');
  });

  it('should verify approveSticky checks user permission and records IP address', async () => {
    const originalFindById = DocumentSticky.findById;
    const originalLogCreate = DocumentLog.create;
    DocumentLog.create = async () => ({});

    const mockSticky = {
      _id: '673f1b40a92f000000000002',
      documentId: '650c1f1e1f1e1f1e1f1e1f1e',
      status: 'pending',
      isApproved: false,
      color: 'yellow',
      save: async function () { return this; },
    };
    DocumentSticky.findById = async () => mockSticky;

    // Test 1: Employee lacking permission is forbidden with 403
    const unpermittedReq = {
      user: { id: '650c1f1e1f1e1f1e1f1e2222', role: 'employee', permissions: {} },
      params: { id: '650c1f1e1f1e1f1e1f1e1f1e', stickyId: '673f1b40a92f000000000002' },
      body: { status: 'approve' },
      headers: {},
    };
    let unpermittedStatusCode = null;
    let unpermittedResponse = null;
    const unpermittedRes = {
      status(code) {
        unpermittedStatusCode = code;
        return this;
      },
      json(data) {
        unpermittedResponse = data;
        return this;
      },
    };

    await approveSticky(unpermittedReq, unpermittedRes, () => {});
    assert.strictEqual(unpermittedStatusCode, 403);
    assert.strictEqual(unpermittedResponse.success, false);
    assert.ok(unpermittedResponse.message.includes('permission'));

    // Test 2: Super Admin is allowed and IP address is captured
    const adminReq = {
      user: { id: '650c1f1e1f1e1f1e1f1e3333', role: 'super_admin', name: 'Super Admin' },
      params: { id: '650c1f1e1f1e1f1e1f1e1f1e', stickyId: '673f1b40a92f000000000002' },
      body: { status: 'approve' },
      headers: { 'x-forwarded-for': '203.0.113.195' },
    };
    let adminStatusCode = null;
    let adminResponse = null;
    const adminRes = {
      status(code) {
        adminStatusCode = code;
        return this;
      },
      json(data) {
        adminResponse = data;
        return this;
      },
    };

    await approveSticky(adminReq, adminRes, () => {});
    DocumentSticky.findById = originalFindById;
    DocumentLog.create = originalLogCreate;

    assert.strictEqual(adminStatusCode, 200);
    assert.strictEqual(adminResponse.success, true);
    assert.strictEqual(mockSticky.status, 'approve');
    assert.strictEqual(mockSticky.isApproved, true);
    assert.strictEqual(mockSticky.approvedBy, '650c1f1e1f1e1f1e1f1e3333');
    assert.strictEqual(mockSticky.approvalIpAddress, '203.0.113.195');
  });

  it('should verify getDocumentById uses aggregation pipeline with all lookups and returns identical structure', async () => {
    const originalAggregate = Document.aggregate;
    let capturedPipeline = null;

    const mockDocId = '650c1f1e1f1e1f1e1f1e1f1e';
    const mockAggResult = {
      _id: mockDocId,
      id: mockDocId,
      fileNumber: 'MOR/CIVIL/2026/F-001',
      title: 'Quarterly Infrastructure Review',
      subject: 'Review of projects and budgets',
      priority: 'routine',
      accessControl: 'general',
      registrationDate: new Date('2026-11-20T10:00:00Z'),
      departmentId: { _id: '650c1f1e1f1e1f1e1f1e5555', name: 'Civil Engineering', code: 'CIVIL' },
      createdBy: { _id: '650c1f1e1f1e1f1e1f1e1111', name: 'Admin Officer', email: 'admin@example.com' },
      files: [],
      remarks: [],
      signatures: [],
      stickies: [],
      userVirtualStickies: [],
      forwardedDepartments: [],
      fileTitle: 'Quarterly Infrastructure Review',
      fileSubject: 'Review of projects and budgets',
      filePriority: 'routine',
      fileDate: new Date('2026-11-20T10:00:00Z'),
      targetAudience: 'general',
    };

    Document.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [mockAggResult];
    };

    const req = {
      params: { id: mockDocId },
      user: { id: '650c1f1e1f1e1f1e1f1e1111' },
      userPermission: { canView: true, canRemark: true },
    };

    let statusCode = null;
    let responseData = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      },
    };

    await getDocumentById(req, res, () => {});
    Document.aggregate = originalAggregate;

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.success, true);
    assert.ok(responseData.userPermission);
    assert.strictEqual(responseData.userPermission.canView, true);

    const doc = responseData.data;
    assert.strictEqual(doc.id, mockDocId);
    assert.strictEqual(doc.fileNumber, 'MOR/CIVIL/2026/F-001');
    assert.strictEqual(doc.fileTitle, 'Quarterly Infrastructure Review');
    assert.strictEqual(doc.fileSubject, 'Review of projects and budgets');
    assert.strictEqual(doc.targetAudience, 'general');
    assert.ok(Array.isArray(doc.files));
    assert.ok(Array.isArray(doc.remarks));
    assert.ok(Array.isArray(doc.signatures));
    assert.ok(Array.isArray(doc.stickies));
    assert.ok(Array.isArray(doc.userVirtualStickies));
    assert.ok(Array.isArray(doc.forwardedDepartments));

    // Verify pipeline stages
    assert.ok(capturedPipeline);
    const matchStage = capturedPipeline.find((s) => s.$match);
    assert.ok(matchStage);

    const lookupStages = capturedPipeline.filter((s) => s.$lookup).map((s) => s.$lookup.from);
    assert.ok(lookupStages.includes('departments'));
    assert.ok(lookupStages.includes('users'));
    assert.ok(lookupStages.includes('documentforwards'));
    assert.ok(lookupStages.includes('documentstickies'));
    assert.ok(lookupStages.includes('documentsignatures'));
    assert.ok(lookupStages.includes('documentremarks'));
    assert.ok(lookupStages.includes('documentfiles'));
    assert.ok(lookupStages.includes('virtualstickynotes'));
  });

  it('should verify searchAndListDocuments uses single-roundtrip aggregation pipeline with $facet', async () => {
    const originalAggregate = Document.aggregate;
    let capturedPipeline = null;

    const mockDoc = {
      _id: '650c1f1e1f1e1f1e1f1e1f1e',
      id: '650c1f1e1f1e1f1e1f1e1f1e',
      fileNumber: 'MOR/CIVIL/2026/F-001',
      title: 'Road Construction',
      subject: 'Highway widening',
      priority: 'urgent',
      accessControl: 'department_only',
      fileTitle: 'Road Construction',
      fileSubject: 'Highway widening',
      filePriority: 'urgent',
      targetAudience: 'department_only',
      departmentId: { _id: '650c1f1e1f1e1f1e1f1e1001', name: 'Civil', code: 'CIVIL' },
      createdBy: { _id: '650c1f1e1f1e1f1e1f1e1002', name: 'Engineer', email: 'eng@gov.in' },
    };

    Document.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [
        {
          totalCount: [{ total: 1 }],
          paginatedData: [mockDoc],
        },
      ];
    };

    let responseData = null;
    const req = {
      query: { page: '1', pageSize: '10', search: 'Road' },
      user: { id: '650c1f1e1f1e1f1e1f1e1002', role: 'super_admin' },
    };
    const res = {
      status() { return this; },
      json(data) { responseData = data; return this; },
    };

    await searchAndListDocuments(req, res, () => {});
    Document.aggregate = originalAggregate;

    assert.ok(capturedPipeline);
    const facetStage = capturedPipeline.find((s) => s.$facet);
    assert.ok(facetStage, 'Pipeline must include a $facet stage');
    assert.ok(facetStage.$facet.totalCount, 'Facet must compute totalCount');
    assert.ok(facetStage.$facet.paginatedData, 'Facet must compute paginatedData');

    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.total, 1);
    assert.strictEqual(responseData.page, 1);
    assert.strictEqual(responseData.data.length, 1);
    assert.strictEqual(responseData.data[0].fileTitle, 'Road Construction');
  });

  it('should return 403 for non-super_admin on searchAndListDocuments', async () => {
    let statusCode = null;
    let responseData = null;
    const req = {
      query: { page: '1', pageSize: '10' },
      user: { id: '650c1f1e1f1e1f1e1f1e3333', role: 'employee' },
    };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      },
    };

    await searchAndListDocuments(req, res, () => {});

    assert.strictEqual(statusCode, 403);
    assert.strictEqual(responseData.success, false);
  });

  it('should verify getUserCounts uses $facet aggregation pipeline on User', async () => {
    const originalAggregate = User.aggregate;
    const originalDeptCount = Department.countDocuments;
    let capturedPipeline = null;

    User.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [
        {
          totalUsers: [{ count: 15 }],
          totalEmployees: [{ count: 10 }],
          totalAuthorizedOfficers: [{ count: 3 }],
          totalAdminsExcludingHim: [{ count: 2 }],
        },
      ];
    };
    Department.countDocuments = async () => 5;

    let responseData = null;
    const req = { user: { id: '650c1f1e1f1e1f1e1f1e1001', role: 'super_admin' } };
    const res = {
      status() { return this; },
      json(data) { responseData = data; return this; },
    };

    await getUserCounts(req, res, () => {});
    User.aggregate = originalAggregate;
    Department.countDocuments = originalDeptCount;

    assert.ok(capturedPipeline);
    const facetStage = capturedPipeline.find((s) => s.$facet);
    assert.ok(facetStage);
    assert.ok(facetStage.$facet.totalUsers);
    assert.ok(facetStage.$facet.totalEmployees);
    assert.ok(facetStage.$facet.totalAuthorizedOfficers);
    assert.ok(facetStage.$facet.totalAdminsExcludingHim);

    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.data.totalUsers, 15);
    assert.strictEqual(responseData.data.totalEmployees, 10);
    assert.strictEqual(responseData.data.totalAuthorizedOfficers, 3);
    assert.strictEqual(responseData.data.totalAdminsExcludingHim, 2);
    assert.strictEqual(responseData.data.totalDepartments, 5);
  });

  it('should verify listDocumentPermissions uses $facet aggregation pipeline', async () => {
    const originalAggregate = DocumentPermission.aggregate;
    let capturedPipeline = null;

    DocumentPermission.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [
        {
          totalCount: [{ total: 1 }],
          paginatedData: [
            {
              _id: '650c1f1e1f1e1f1e1f1e1010',
              id: '650c1f1e1f1e1f1e1f1e1010',
              userId: { name: 'Officer', email: 'officer@gov.in' },
            },
          ],
        },
      ];
    };

    let responseData = null;
    const req = {
      params: { id: '650c1f1e1f1e1f1e1f1e1000' },
      query: { page: '1', pageSize: '10' },
    };
    const res = {
      status() { return this; },
      json(data) { responseData = data; return this; },
    };

    await listDocumentPermissions(req, res, () => {});
    DocumentPermission.aggregate = originalAggregate;

    assert.ok(capturedPipeline);
    const facetStage = capturedPipeline.find((s) => s.$facet);
    assert.ok(facetStage);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.total, 1);
  });

  it('should verify getDocumentFiles uses $facet aggregation pipeline', async () => {
    const originalFindById = Document.findById;
    const originalAggregate = DocumentFile.aggregate;
    let capturedPipeline = null;

    Document.findById = async () => ({ _id: '650c1f1e1f1e1f1e1f1e1000' });
    DocumentFile.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [
        {
          totalCount: [{ total: 2 }],
          paginatedData: [
            { _id: '650c1f1e1f1e1f1e1f1e1020', id: '650c1f1e1f1e1f1e1f1e1020', pageNumber: 1 },
          ],
        },
      ];
    };

    let responseData = null;
    const req = {
      params: { id: '650c1f1e1f1e1f1e1f1e1000' },
      query: { page: '1', pageSize: '10' },
    };
    const res = {
      status() { return this; },
      json(data) { responseData = data; return this; },
    };

    await getDocumentFiles(req, res, () => {});
    Document.findById = originalFindById;
    DocumentFile.aggregate = originalAggregate;

    assert.ok(capturedPipeline);
    assert.ok(capturedPipeline.find((s) => s.$facet));
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.total, 2);
  });

  it('should verify getRemarksByDocument uses $facet aggregation pipeline', async () => {
    const originalAggregate = DocumentRemark.aggregate;
    let capturedPipeline = null;

    DocumentRemark.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [
        {
          totalCount: [{ total: 1 }],
          paginatedData: [
            { _id: '650c1f1e1f1e1f1e1f1e1030', id: '650c1f1e1f1e1f1e1f1e1030', comment: 'Approved for action' },
          ],
        },
      ];
    };

    let responseData = null;
    const req = {
      params: { id: '650c1f1e1f1e1f1e1f1e1000' },
      query: { page: '1', pageSize: '10' },
    };
    const res = {
      status() { return this; },
      json(data) { responseData = data; return this; },
    };

    await getRemarksByDocument(req, res, () => {});
    DocumentRemark.aggregate = originalAggregate;

    assert.ok(capturedPipeline);
    assert.ok(capturedPipeline.find((s) => s.$facet));
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.total, 1);
  });

  it('should verify listReplicas uses $facet aggregation pipeline', async () => {
    const originalAggregate = DocumentReplica.aggregate;
    let capturedPipeline = null;

    DocumentReplica.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [
        {
          totalCount: [{ total: 1 }],
          paginatedData: [
            { _id: '650c1f1e1f1e1f1e1f1e1040', id: '650c1f1e1f1e1f1e1f1e1040', title: 'Suggested Draft' },
          ],
        },
      ];
    };

    let responseData = null;
    const req = {
      params: { id: '650c1f1e1f1e1f1e1f1e1000' },
      query: { page: '1', pageSize: '10' },
    };
    const res = {
      status() { return this; },
      json(data) { responseData = data; return this; },
    };

    await listReplicas(req, res, () => {});
    DocumentReplica.aggregate = originalAggregate;

    assert.ok(capturedPipeline);
    assert.ok(capturedPipeline.find((s) => s.$facet));
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.total, 1);
  });

  it('should verify listEmployees uses $facet aggregation pipeline with department lookup', async () => {
    const originalAggregate = User.aggregate;
    let capturedPipeline = null;

    User.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [
        {
          totalCount: [{ total: 1 }],
          paginatedData: [
            {
              _id: '650c1f1e1f1e1f1e1f1e1050',
              id: '650c1f1e1f1e1f1e1f1e1050',
              name: 'John Doe',
              departmentId: { _id: '650c1f1e1f1e1f1e1f1e1001', name: 'Civil', code: 'CIVIL' },
            },
          ],
        },
      ];
    };

    let responseData = null;
    const req = {
      query: { page: '1', pageSize: '10' },
      user: { role: 'super_admin' },
    };
    const res = {
      status() { return this; },
      json(data) { responseData = data; return this; },
    };

    await listEmployees(req, res, () => {});
    User.aggregate = originalAggregate;

    assert.ok(capturedPipeline);
    assert.ok(capturedPipeline.find((s) => s.$facet));
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.total, 1);
  });

  it('should verify getMyRequests and listAllRequests in email controller use $facet aggregation pipeline', async () => {
    const originalAggregate = EmailRequest.aggregate;
    let capturedPipelineMy = null;
    let capturedPipelineAll = null;

    EmailRequest.aggregate = async (pipeline) => {
      if (!capturedPipelineMy) {
        capturedPipelineMy = pipeline;
      } else {
        capturedPipelineAll = pipeline;
      }
      return [
        {
          totalCount: [{ total: 1 }],
          paginatedData: [
            { _id: '650c1f1e1f1e1f1e1f1e1060', id: '650c1f1e1f1e1f1e1f1e1060', requestedEmail: 'new@gov.in' },
          ],
        },
      ];
    };

    let responseDataMy = null;
    const reqMy = {
      query: { page: '1', pageSize: '10' },
      user: { id: '650c1f1e1f1e1f1e1f1e1050' },
    };
    const resMy = {
      status() { return this; },
      json(data) { responseDataMy = data; return this; },
    };

    await getMyRequests(reqMy, resMy, () => {});

    let responseDataAll = null;
    const reqAll = {
      query: { page: '1', pageSize: '10', status: 'pending' },
    };
    const resAll = {
      status() { return this; },
      json(data) { responseDataAll = data; return this; },
    };

    await listAllRequests(reqAll, resAll, () => {});
    EmailRequest.aggregate = originalAggregate;

    assert.ok(capturedPipelineMy);
    assert.ok(capturedPipelineMy.find((s) => s.$facet));
    assert.strictEqual(responseDataMy.success, true);
    assert.strictEqual(responseDataMy.total, 1);

    assert.ok(capturedPipelineAll);
    assert.ok(capturedPipelineAll.find((s) => s.$facet));
    assert.strictEqual(responseDataAll.success, true);
    assert.strictEqual(responseDataAll.total, 1);
  });

  it('should validate Notification model schema definition and paths without virtual aliases', () => {
    const paths = Object.keys(Notification.schema.paths);
    assert.ok(paths.includes('title'));
    assert.ok(paths.includes('message'));
    assert.ok(paths.includes('classification'));
    assert.ok(paths.includes('priority'));
    assert.ok(paths.includes('broadcast'));
    assert.ok(paths.includes('createdBy'));
    assert.ok(paths.includes('targetUser'));
    assert.ok(paths.includes('targetEmployeeId'));
    assert.ok(paths.includes('fileReferenceNumber'));
    assert.ok(paths.includes('fileReferenceId'));
    assert.ok(paths.includes('notifyDate'));
    assert.ok(paths.includes('readCount'));
    assert.ok(paths.includes('unreadCount'));
    assert.ok(paths.includes('status'));

    const virtualKeys = Object.keys(Notification.schema.virtuals);
    // Should not have virtual aliases like task, reminderTitle, etc.
    assert.ok(!virtualKeys.includes('task'));
    assert.ok(!virtualKeys.includes('reminderTitle'));

    // Check classification enum values
    const classificationEnum = Notification.schema.paths.classification.options.enum.values;
    assert.deepStrictEqual(classificationEnum, [
      'System Notice',
      'Workflow Directive',
      'Security & Compliance',
      'Official Reminder',
    ]);
  });

  it('should validate NotificationRead model schema definition and compound unique index', () => {
    const paths = Object.keys(NotificationRead.schema.paths);
    assert.ok(paths.includes('notificationId'));
    assert.ok(paths.includes('userId'));
    assert.ok(paths.includes('readAt'));

    const indexes = NotificationRead.schema.indexes();
    const compoundUniqueIndex = indexes.find(
      (idx) => idx[0].notificationId === 1 && idx[0].userId === 1 && idx[1].unique === true
    );
    assert.ok(compoundUniqueIndex, 'Must define a compound unique index on { notificationId: 1, userId: 1 }');
  });

  it('should verify getNotificationCounts uses aggregation pipeline and returns all required metrics', async () => {
    const originalDistinct = NotificationRead.distinct;
    const originalAggregate = Notification.aggregate;
    let capturedPipeline = null;

    NotificationRead.distinct = async () => ['650c1f1e1f1e1f1e1f1e9999'];
    Notification.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [
        {
          total: [{ count: 45 }],
          global: [{ count: 18 }],
          specific: [{ count: 15 }],
          self: [{ count: 12 }],
          unread: [{ count: 7 }],
        },
      ];
    };

    let responseData = null;
    const req = { user: { id: '650c1f1e1f1e1f1e1f1e1001', role: 'super_admin' } };
    const res = {
      status() { return this; },
      json(data) { responseData = data; return this; },
    };

    await getNotificationCounts(req, res, () => {});
    NotificationRead.distinct = originalDistinct;
    Notification.aggregate = originalAggregate;

    assert.ok(capturedPipeline);
    const facetStage = capturedPipeline.find((s) => s.$facet);
    assert.ok(facetStage);
    assert.ok(facetStage.$facet.total);
    assert.ok(facetStage.$facet.global);
    assert.ok(facetStage.$facet.specific);
    assert.ok(facetStage.$facet.self);
    assert.ok(facetStage.$facet.unread);

    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.data.totalNotifications, 45);
    assert.strictEqual(responseData.data.globalBroadcastNotificationCount, 18);
    assert.strictEqual(responseData.data.specificUserNotificationCount, 15);
    assert.strictEqual(responseData.data.selfNotificationCount, 12);
    assert.strictEqual(responseData.data.unreadTotalCount, 7);
    assert.strictEqual(responseData.data.readTotalCount, 38);
  });

  it('should verify listNotifications uses $facet aggregation pipeline with pagination and filters', async () => {
    const originalAggregate = Notification.aggregate;
    let capturedPipeline = null;

    const mockNotif = {
      _id: '650c1f1e1f1e1f1e1f1e8888',
      title: 'Road Maintenance Directive',
      message: 'Mandatory field inspection by end of week.',
      classification: 'Workflow Directive',
      priority: 'urgent',
      broadcast: 'global',
      isRead: false,
      readCount: 12,
      unreadCount: 40,
    };

    Notification.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [
        {
          totalCount: [{ total: 1 }],
          paginatedData: [mockNotif],
        },
      ];
    };

    let responseData = null;
    const req = {
      query: { page: '1', pageSize: '10', classification: 'Workflow Directive', isRead: 'false' },
      user: { id: '650c1f1e1f1e1f1e1f1e1001', role: 'super_admin' },
    };
    const res = {
      status() { return this; },
      json(data) { responseData = data; return this; },
    };

    await listNotifications(req, res, () => {});
    Notification.aggregate = originalAggregate;

    assert.ok(capturedPipeline);
    assert.ok(capturedPipeline.find((s) => s.$facet));
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.total, 1);
    assert.strictEqual(responseData.data[0].title, 'Road Maintenance Directive');
    assert.strictEqual(responseData.data[0].isRead, false);
  });

  it('should verify createNotification validates input and creates document with correct fields', async () => {
    const originalCreate = Notification.create;
    const originalUserCount = User.countDocuments;
    let capturedDoc = null;

    Notification.create = async (doc) => {
      capturedDoc = doc;
      return { _id: '650c1f1e1f1e1f1e1f1e7777', ...doc };
    };
    User.countDocuments = async () => 25;

    let responseData = null;
    let statusCode = null;
    const req = {
      body: {
        title: 'System Security Patching',
        message: 'Servers will restart at midnight.',
        classification: 'Security & Compliance',
        priority: 'immediate',
        broadcast: 'global',
      },
      user: { id: '650c1f1e1f1e1f1e1f1e1001', role: 'super_admin' },
    };
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { responseData = data; return this; },
    };

    await createNotification(req, res, () => {});
    Notification.create = originalCreate;
    User.countDocuments = originalUserCount;

    assert.strictEqual(statusCode, 201);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(capturedDoc.title, 'System Security Patching');
    assert.strictEqual(capturedDoc.classification, 'Security & Compliance');
    assert.strictEqual(capturedDoc.priority, 'immediate');
    assert.strictEqual(capturedDoc.broadcast, 'global');
    assert.strictEqual(capturedDoc.createdBy, req.user.id);
  });

  it('should allow Super Admin to target a specific user by employeeId', async () => {
    const originalCreate = Notification.create;
    const originalFindOne = User.findOne;
    let capturedDoc = null;

    Notification.create = async (doc) => {
      capturedDoc = doc;
      return { _id: '650c1f1e1f1e1f1e1f1e7777', ...doc };
    };
    User.findOne = () => ({
      select: async () => ({ _id: '650c1f1e1f1e1f1e1f1e2222', employeeId: 'EMP-1001' }),
    });

    let statusCode = null;
    let responseData = null;
    const req = {
      body: {
        title: 'Tender Review Notice',
        message: 'Please review tender before 5 PM.',
        classification: 'Workflow Directive',
        priority: 'urgent',
        broadcast: 'specific_user',
        employeeId: 'EMP-1001',
      },
      user: { id: '650c1f1e1f1e1f1e1f1e1001', role: 'super_admin' },
    };
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { responseData = data; return this; },
    };

    await createNotification(req, res, () => {});
    Notification.create = originalCreate;
    User.findOne = originalFindOne;

    assert.strictEqual(statusCode, 201);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(capturedDoc.broadcast, 'specific_user');
    assert.strictEqual(capturedDoc.targetUser, '650c1f1e1f1e1f1e1f1e2222');
    assert.strictEqual(capturedDoc.targetEmployeeId, 'EMP-1001');
    assert.strictEqual(capturedDoc.unreadCount, 1);
  });

  it('should forbid non-super-admin users from creating global or specific_user notifications', async () => {
    let statusCode = null;
    let responseData = null;

    const req = {
      body: {
        title: 'Unauthorized Global Notice',
        classification: 'System Notice',
        broadcast: 'global',
      },
      user: { id: '650c1f1e1f1e1f1e1f1e3333', role: 'employee' },
    };
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { responseData = data; return this; },
    };

    await createNotification(req, res, () => {});

    assert.strictEqual(statusCode, 403);
    assert.strictEqual(responseData.success, false);
    assert.ok(responseData.message.includes('Only Super Admin has permission'));
  });

  it('should allow createNotification with valid fileReferenceNumber and link document', async () => {
    const originalCreate = Notification.create;
    const originalFindOne = Document.findOne;
    let capturedDoc = null;

    Notification.create = async (doc) => {
      capturedDoc = doc;
      return { _id: '650c1f1e1f1e1f1e1f1e7777', ...doc };
    };
    Document.findOne = () => ({
      select: async () => ({ _id: '650c1f1e1f1e1f1e1f1e9999', fileNumber: 'MOR/CIVIL/2026/F-001' }),
    });

    let statusCode = null;
    let responseData = null;
    const req = {
      body: {
        title: 'Document Action Required',
        classification: 'Official Reminder',
        broadcast: 'self',
        fileReferenceNumber: 'MOR/CIVIL/2026/F-001',
      },
      user: { id: '650c1f1e1f1e1f1e1f1e1001', role: 'employee' },
    };
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { responseData = data; return this; },
    };

    await createNotification(req, res, () => {});
    Notification.create = originalCreate;
    Document.findOne = originalFindOne;

    assert.strictEqual(statusCode, 201);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(capturedDoc.fileReferenceNumber, 'MOR/CIVIL/2026/F-001');
    assert.strictEqual(capturedDoc.fileReferenceId, '650c1f1e1f1e1f1e1f1e9999');
  });

  it('should reject createNotification with non-existent fileReferenceNumber with 404', async () => {
    const originalFindOne = Document.findOne;
    Document.findOne = () => ({
      select: async () => null,
    });

    let statusCode = null;
    let responseData = null;
    const req = {
      body: {
        title: 'Non-existent Doc Reminder',
        classification: 'Official Reminder',
        broadcast: 'self',
        fileReferenceNumber: 'INVALID/FILE/999',
      },
      user: { id: '650c1f1e1f1e1f1e1f1e1001', role: 'employee' },
    };
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { responseData = data; return this; },
    };

    await createNotification(req, res, () => {});
    Document.findOne = originalFindOne;

    assert.strictEqual(statusCode, 404);
    assert.strictEqual(responseData.success, false);
    assert.ok(responseData.message.includes('INVALID/FILE/999'));
  });

  it('should verify markAsRead records receipt in NotificationRead and updates counters', async () => {
    const originalFindById = Notification.findById;
    const originalFindOneAndUpdate = NotificationRead.findOneAndUpdate;
    const originalFindByIdAndUpdate = Notification.findByIdAndUpdate;

    let updatedCounter = false;
    let capturedReceiptQuery = null;

    Notification.findById = async () => ({ _id: '650c1f1e1f1e1f1e1f1e7777', title: 'Task' });
    NotificationRead.findOneAndUpdate = async (filter, update) => {
      capturedReceiptQuery = { filter, update };
      return null; // indicates new insert
    };
    Notification.findByIdAndUpdate = async (id, update) => {
      if (update.$inc && update.$inc.readCount === 1) {
        updatedCounter = true;
      }
      return {};
    };

    let responseData = null;
    const req = {
      params: { id: '650c1f1e1f1e1f1e1f1e7777' },
      user: { id: '650c1f1e1f1e1f1e1f1e1001' },
    };
    const res = {
      status() { return this; },
      json(data) { responseData = data; return this; },
    };

    await markAsRead(req, res, () => {});

    Notification.findById = originalFindById;
    NotificationRead.findOneAndUpdate = originalFindOneAndUpdate;
    Notification.findByIdAndUpdate = originalFindByIdAndUpdate;

    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.data.isRead, true);
    assert.ok(capturedReceiptQuery);
    assert.strictEqual(updatedCounter, true);
  });

  it('should verify getMyNotifications allows regular users to get global & targeted notifications with exact projection', async () => {
    const originalAggregate = Notification.aggregate;
    let capturedPipeline = null;

    const mockItem = {
      _id: '6b01c19d5e55ec413ae0486c',
      title: 'Security Audit Compliance Reminder',
      fileReferenceId: {
        _id: '6b015c6d82396e5d536f770f',
        fileNumber: 'MOR/ENG/2026/F-002',
        title: 'Track Modernization Phase 2',
        subject: 'Sanction of steel rails procurement',
      },
      notifyDate: new Date('2026-11-21T18:00:00.000Z'),
      priority: 'urgent',
      createdBy: {
        _id: '6afc950bd257f238dbc796e0',
        name: 'Alice Dept Admin',
        email: 'alice.admin@example.com',
        role: 'department_admin',
      },
      targetEmployeeId: 'MOR/ENG/045',
      message: 'Please verify two-factor authentication or sign required document before deadline.',
      status: 'active',
      createdAt: new Date('2026-11-21T16:06:53.451Z'),
      updatedAt: new Date('2026-11-21T16:08:13.745Z'),
      isRead: true,
    };

    Notification.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [
        {
          totalCount: [{ total: 1 }],
          paginatedData: [mockItem],
        },
      ];
    };

    let responseData = null;
    const req = {
      query: { page: '1', pageSize: '10' },
      user: { id: '650c1f1e1f1e1f1e1f1e3333', role: 'employee' },
    };
    const res = {
      status() { return this; },
      json(data) { responseData = data; return this; },
    };

    await getMyNotifications(req, res, () => {});
    Notification.aggregate = originalAggregate;

    assert.ok(capturedPipeline);
    const matchStage = capturedPipeline.find((s) => s.$match);
    assert.ok(matchStage);
    assert.strictEqual(matchStage.$match.status, 'active');
    assert.ok(matchStage.$match.$or);

    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.total, 1);
    const notif = responseData.data[0];
    assert.strictEqual(notif._id, '6b01c19d5e55ec413ae0486c');
    assert.strictEqual(notif.title, 'Security Audit Compliance Reminder');
    assert.strictEqual(notif.fileReferenceId.fileNumber, 'MOR/ENG/2026/F-002');
    assert.strictEqual(notif.createdBy.name, 'Alice Dept Admin');
    assert.strictEqual(notif.targetEmployeeId, 'MOR/ENG/045');
    assert.strictEqual(notif.isRead, true);
  });

  it('should forbid non-super-admin from accessing getNotificationCounts and listNotifications', async () => {
    let statusCodeCounts = null;
    let responseDataCounts = null;
    const reqNonAdmin = { user: { id: '650c1f1e1f1e1f1e1f1e3333', role: 'employee' }, query: {} };
    const resCounts = {
      status(code) { statusCodeCounts = code; return this; },
      json(data) { responseDataCounts = data; return this; },
    };

    await getNotificationCounts(reqNonAdmin, resCounts, () => {});
    assert.strictEqual(statusCodeCounts, 403);
    assert.strictEqual(responseDataCounts.success, false);

    let statusCodeList = null;
    let responseDataList = null;
    const resList = {
      status(code) { statusCodeList = code; return this; },
      json(data) { responseDataList = data; return this; },
    };

    await listNotifications(reqNonAdmin, resList, () => {});
    assert.strictEqual(statusCodeList, 403);
    assert.strictEqual(responseDataList.success, false);
  });

  it('should allow Super Admin to update any notification but allow employee to update only self notification', async () => {
    const originalFindById = Notification.findById;

    // 1. Employee trying to edit a global broadcast -> 403
    Notification.findById = async () => ({
      _id: '650c1f1e1f1e1f1e1f1e7777',
      createdBy: '650c1f1e1f1e1f1e1f1e3333',
      broadcast: 'global',
      save: async () => {},
    });

    let statusCode = null;
    let responseData = null;
    const reqEmpGlobal = {
      params: { id: '650c1f1e1f1e1f1e1f1e7777' },
      body: { title: 'Updated' },
      user: { id: '650c1f1e1f1e1f1e1f1e3333', role: 'employee' },
    };
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { responseData = data; return this; },
    };

    await updateNotification(reqEmpGlobal, res, () => {});
    assert.strictEqual(statusCode, 403);
    assert.strictEqual(responseData.success, false);

    // 2. Employee editing their own self reminder -> 200
    let saved = false;
    Notification.findById = async () => ({
      _id: '650c1f1e1f1e1f1e1f1e7777',
      createdBy: '650c1f1e1f1e1f1e1f1e3333',
      broadcast: 'self',
      save: async () => { saved = true; },
    });

    statusCode = null;
    responseData = null;
    const reqEmpSelf = {
      params: { id: '650c1f1e1f1e1f1e1f1e7777' },
      body: { title: 'Updated Self Title' },
      user: { id: '650c1f1e1f1e1f1e1f1e3333', role: 'employee' },
    };

    await updateNotification(reqEmpSelf, res, () => {});
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(saved, true);

    // 3. Super Admin editing any notification -> 200
    saved = false;
    Notification.findById = async () => ({
      _id: '650c1f1e1f1e1f1e1f1e7777',
      createdBy: '650c1f1e1f1e1f1e1f1e9999',
      broadcast: 'global',
      save: async () => { saved = true; },
    });

    const reqSuperAdmin = {
      params: { id: '650c1f1e1f1e1f1e1f1e7777' },
      body: { title: 'Super Admin Override' },
      user: { id: '650c1f1e1f1e1f1e1f1e1001', role: 'super_admin' },
    };

    await updateNotification(reqSuperAdmin, res, () => {});
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(saved, true);

    Notification.findById = originalFindById;
  });

  it('should verify getMyDocumentCounts uses $facet aggregation pipeline for department admin', async () => {
    const origDocAgg = Document.aggregate;
    const origFwdDistinct = DocumentForward.distinct;

    let capturedPipeline = null;
    DocumentForward.distinct = async () => ['650c1f1e1f1e1f1e1f1e0001'];

    Document.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [
        {
          totalAccessibleFiles: [{ count: 20 }],
          totalCreatedFiles: [{ count: 8 }],
          totalUrgentFiles: [{ count: 5 }],
          totalPendingApprovalFiles: [{ count: 6 }],
        },
      ];
    };

    let responseData = null;
    let statusCode = null;
    const req = {
      user: {
        id: '650c1f1e1f1e1f1e1f1e1001',
        departmentId: '650c1f1e1f1e1f1e1f1e2001',
        role: 'department_admin',
      },
    };
    const res = {
      status(c) {
        statusCode = c;
        return this;
      },
      json(d) {
        responseData = d;
        return this;
      },
    };

    await getMyDocumentCounts(req, res, () => {});

    // Restore
    Document.aggregate = origDocAgg;
    DocumentForward.distinct = origFwdDistinct;

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.success, true);
    const facetStage = capturedPipeline.find((s) => s.$facet);
    assert.ok(facetStage, 'Must use $facet in Document aggregation');
    assert.ok(facetStage.$facet.totalAccessibleFiles, 'totalAccessibleFiles bucket exists');
    assert.ok(facetStage.$facet.totalCreatedFiles, 'totalCreatedFiles bucket exists');
    assert.ok(facetStage.$facet.totalUrgentFiles, 'totalUrgentFiles bucket exists');
    assert.ok(facetStage.$facet.totalPendingApprovalFiles, 'totalPendingApprovalFiles bucket exists');

    const pendingPipeline = facetStage.$facet.totalPendingApprovalFiles;
    assert.ok(pendingPipeline.some((st) => st.$lookup), '$lookup stage exists for pending files');

    assert.deepStrictEqual(responseData.data, {
      totalAccessibleFiles: 20,
      totalCreatedFiles: 8,
      totalUrgentFiles: 5,
      totalPendingApprovalFiles: 6,
    });
  });

  it('should verify getMyDocumentCounts returns zero pending approval files for employee without approval rights', async () => {
    const origDocAgg = Document.aggregate;
    const origPermDistinct = DocumentPermission.distinct;
    const origFwdDistinct = DocumentForward.distinct;

    DocumentPermission.distinct = async () => [];
    DocumentForward.distinct = async () => [];

    Document.aggregate = async () => [
      {
        totalAccessibleFiles: [{ count: 12 }],
        totalCreatedFiles: [{ count: 4 }],
        totalUrgentFiles: [{ count: 2 }],
        totalPendingApprovalFiles: [],
      },
    ];

    let responseData = null;
    let statusCode = null;
    const req = {
      user: {
        id: '650c1f1e1f1e1f1e1f1e3333',
        departmentId: '650c1f1e1f1e1f1e1f1e2001',
        role: 'employee',
        permissions: { canViewApprovals: false },
      },
    };
    const res = {
      status(c) {
        statusCode = c;
        return this;
      },
      json(d) {
        responseData = d;
        return this;
      },
    };

    await getMyDocumentCounts(req, res, () => {});

    Document.aggregate = origDocAgg;
    DocumentPermission.distinct = origPermDistinct;
    DocumentForward.distinct = origFwdDistinct;

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.success, true);
    assert.deepStrictEqual(responseData.data, {
      totalAccessibleFiles: 12,
      totalCreatedFiles: 4,
      totalUrgentFiles: 2,
      totalPendingApprovalFiles: 0,
    });
  });

  it('should verify getUserDashboardSummary uses aggregation pipelines and returns user summary counts', async () => {
    const origDocAgg = Document.aggregate;
    const origNotifAgg = Notification.aggregate;
    const origFwdDistinct = DocumentForward.distinct;

    DocumentForward.distinct = async () => ['650c1f1e1f1e1f1e1f1e0001'];

    let capturedDocPipeline = null;
    let capturedNotifPipeline = null;

    Document.aggregate = async (pipeline) => {
      capturedDocPipeline = pipeline;
      return [
        {
          totalFileAccessCount: [{ count: 25 }],
          pendingFiles: [{ count: 7 }],
        },
      ];
    };

    Notification.aggregate = async (pipeline) => {
      capturedNotifPipeline = pipeline;
      return [{ count: 4 }];
    };

    let responseData = null;
    let statusCode = null;
    const req = {
      user: {
        id: '650c1f1e1f1e1f1e1f1e1001',
        departmentId: '650c1f1e1f1e1f1e1f1e2001',
        role: 'department_admin',
      },
    };
    const res = {
      status(c) {
        statusCode = c;
        return this;
      },
      json(d) {
        responseData = d;
        return this;
      },
    };

    await getUserDashboardSummary(req, res, () => {});

    // Restore
    Document.aggregate = origDocAgg;
    Notification.aggregate = origNotifAgg;
    DocumentForward.distinct = origFwdDistinct;

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.success, true);
    assert.deepStrictEqual(responseData.data, {
      totalFileAccessCount: 25,
      pendingFiles: 7,
      totalSelfNotificationCount: 4,
    });

    const facetStage = capturedDocPipeline.find((s) => s.$facet);
    assert.ok(facetStage, 'Must use $facet in Document aggregation');
    assert.ok(facetStage.$facet.totalFileAccessCount, 'totalFileAccessCount bucket exists');
    assert.ok(facetStage.$facet.pendingFiles, 'pendingFiles bucket exists');
    assert.ok(capturedNotifPipeline.find((s) => s.$match?.broadcast === 'self'), 'Must filter self notifications');
  });

  it('should verify getUserDashboardSummary returns zero pending files for employee without approval rights', async () => {
    const origDocAgg = Document.aggregate;
    const origNotifAgg = Notification.aggregate;
    const origPermDistinct = DocumentPermission.distinct;
    const origFwdDistinct = DocumentForward.distinct;

    DocumentPermission.distinct = async () => [];
    DocumentForward.distinct = async () => [];

    Document.aggregate = async () => [
      {
        totalFileAccessCount: [{ count: 10 }],
        pendingFiles: [],
      },
    ];

    Notification.aggregate = async () => [{ count: 2 }];

    let responseData = null;
    let statusCode = null;
    const req = {
      user: {
        id: '650c1f1e1f1e1f1e1f1e3333',
        departmentId: '650c1f1e1f1e1f1e1f1e2001',
        role: 'employee',
        permissions: { canViewApprovals: false },
      },
    };
    const res = {
      status(c) {
        statusCode = c;
        return this;
      },
      json(d) {
        responseData = d;
        return this;
      },
    };

    await getUserDashboardSummary(req, res, () => {});

    Document.aggregate = origDocAgg;
    Notification.aggregate = origNotifAgg;
    DocumentPermission.distinct = origPermDistinct;
    DocumentForward.distinct = origFwdDistinct;

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.success, true);
    assert.deepStrictEqual(responseData.data, {
      totalFileAccessCount: 10,
      pendingFiles: 0,
      totalSelfNotificationCount: 2,
    });
  });

  it('should verify searchAndListDocumentsAlphabetical uses $facet aggregation, filters by initial letter, and projects strictly fileId + 6 fields', async () => {
    const origDocAgg = Document.aggregate;
    let capturedPipeline = null;

    Document.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [
        {
          totalCount: [{ total: 2 }],
          paginatedData: [
            {
              fileId: '650c1f1e1f1e1f1e1f1e0001',
              fileNumber: 'MOR/ENG/2026/F-001',
              fileName: 'Annual Budget Allocation',
              fileSummary: 'Review of annual engineering allocation',
              fileDepartment: 'Engineering',
              fileDate: '2026-11-20T10:00:00.000Z',
              fileStatus: 'active',
            },
            {
              fileId: '650c1f1e1f1e1f1e1f1e0004',
              fileNumber: 'MOR/ENG/2026/F-004',
              fileName: 'Automated Signaling Proposal',
              fileSummary: 'Modernization proposal for signaling',
              fileDepartment: 'Engineering',
              fileDate: '2026-11-21T09:30:00.000Z',
              fileStatus: 'active',
            },
          ],
        },
      ];
    };

    let responseData = null;
    let statusCode = null;
    const req = {
      query: { letter: 'A', page: '1', pageSize: '10' },
      user: { id: '650c1f1e1f1e1f1e1f1e1001', role: 'super_admin' },
    };
    const res = {
      status(c) {
        statusCode = c;
        return this;
      },
      json(d) {
        responseData = d;
        return this;
      },
    };

    await searchAndListDocumentsAlphabetical(req, res, () => {});

    Document.aggregate = origDocAgg;

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.letter, 'A');
    assert.strictEqual(responseData.total, 2);
    assert.strictEqual(responseData.page, 1);
    assert.strictEqual(responseData.pageSize, 10);
    assert.strictEqual(responseData.totalPages, 1);
    assert.strictEqual(responseData.data.length, 2);

    // Verify projected fields contain fileId + specified keys
    const item = responseData.data[0];
    const expectedKeys = ['fileId', 'fileNumber', 'fileName', 'fileSummary', 'fileDepartment', 'fileDate', 'fileStatus'];
    assert.deepStrictEqual(Object.keys(item).sort(), expectedKeys.sort());

    // Verify pipeline stages
    const matchStage = capturedPipeline.find((s) => s.$match);
    assert.ok(matchStage, '$match stage must exist');

    const facetStage = capturedPipeline.find((s) => s.$facet);
    assert.ok(facetStage, '$facet stage must exist');
    assert.ok(facetStage.$facet.totalCount, 'totalCount bucket exists');
    assert.ok(facetStage.$facet.paginatedData, 'paginatedData bucket exists');

    const projectStage = facetStage.$facet.paginatedData.find((s) => s.$project);
    assert.ok(projectStage, '$project stage must exist in paginatedData');
    assert.strictEqual(projectStage.$project._id, 0);
    assert.strictEqual(projectStage.$project.fileId, '$_id');
    assert.strictEqual(projectStage.$project.fileNumber, '$fileNumber');
    assert.strictEqual(projectStage.$project.fileName, '$title');
    assert.strictEqual(projectStage.$project.fileSummary, '$subject');
    assert.strictEqual(projectStage.$project.fileDate, '$registrationDate');
    assert.strictEqual(projectStage.$project.fileStatus, '$status');
  });

  it('should verify searchAndListDocumentsAlphabetical handles single day createdDate, search text, and access user name filters', async () => {
    const origDocAgg = Document.aggregate;
    const origUserFind = User.find;
    const origPermDistinct = DocumentPermission.distinct;

    let capturedPipeline = null;

    User.find = () => ({
      select: async () => [{ _id: '650c1f1e1f1e1f1e1f1e9999' }],
    });

    DocumentPermission.distinct = async () => ['650c1f1e1f1e1f1e1f1e0001'];

    Document.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [
        {
          totalCount: [{ total: 1 }],
          paginatedData: [
            {
              fileId: '650c1f1e1f1e1f1e1f1e0001',
              fileNumber: 'MOR/ENG/2026/F-001',
              fileName: 'Track Maintenance',
              fileSummary: 'Procurement of track rails',
              fileDepartment: 'Engineering',
              fileDate: '2026-11-20T10:00:00.000Z',
              fileStatus: 'active',
            },
          ],
        },
      ];
    };

    let responseData = null;
    let statusCode = null;
    const req = {
      query: {
        createdDate: '1 august 2027',
        search: 'Rails',
        accessUserName: 'Alice',
      },
      user: { id: '650c1f1e1f1e1f1e1f1e1001', role: 'super_admin' },
    };
    const res = {
      status(c) {
        statusCode = c;
        return this;
      },
      json(d) {
        responseData = d;
        return this;
      },
    };

    await searchAndListDocumentsAlphabetical(req, res, () => {});

    Document.aggregate = origDocAgg;
    User.find = origUserFind;
    DocumentPermission.distinct = origPermDistinct;

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.createdDateApplied, '1 august 2027');

    const matchStage = capturedPipeline.find((s) => s.$match);
    assert.ok(matchStage, '$match stage must exist');
    const andArray = matchStage.$match.$and;
    assert.ok(Array.isArray(andArray), '$and conditions array must exist');

    // 1. Verify single-day date range matching strictly on registrationDate
    const regCond = andArray.find((c) => c.registrationDate);
    assert.ok(regCond, 'Date range condition strictly on registrationDate must exist');
    assert.ok(regCond.registrationDate.$gte instanceof Date);
    assert.ok(regCond.registrationDate.$lte instanceof Date);

    // 2. Verify search text across title OR subject
    const textCond = andArray.find((c) => c.$or && c.$or.some((o) => o.title && o.title.$regex === 'Rails'));
    assert.ok(textCond, 'Search text condition on title and subject must exist');

    // 3. Verify access user name condition
    const accessCond = andArray.find((c) => c.$or && c.$or.some((o) => o._id && o._id.$in));
    assert.ok(accessCond, 'Access user name filter must match permitted docs and createdBy');
  });

  it('should verify document model separates file storage into DocumentFile and sums total pages', async () => {
    // 1. Verify Document model does not carry physical file properties
    const docPaths = Object.keys(Document.schema.paths);
    ['originalName', 'storedFilename', 'filePath', 'fileUrl', 'mimeType', 'fileSize'].forEach((field) => {
      assert.strictEqual(docPaths.includes(field), false, `Document must not contain ${field}`);
    });
    assert.ok(docPaths.includes('pageNumber'), 'Document must retain pageNumber for total pages');

    // 2. Verify DocumentFile schema retains physical file attributes
    const filePaths = Object.keys(DocumentFile.schema.paths);
    ['originalName', 'storedFilename', 'filePath', 'fileUrl', 'mimeType', 'fileSize', 'pageNumber'].forEach((field) => {
      assert.ok(filePaths.includes(field), `DocumentFile must contain ${field}`);
    });

    // 3. Mock aggregation pipeline for total pages calculation
    const testDocId = new mongoose.Types.ObjectId();
    const origAggregate = DocumentFile.aggregate;
    DocumentFile.aggregate = async (pipeline) => {
      assert.strictEqual(pipeline[0].$match.documentId.toString(), testDocId.toString());
      assert.strictEqual(pipeline[1].$group.totalPages.$sum, '$pageNumber');
      return [{ _id: null, totalPages: 18 }];
    };

    const [pageAgg] = await DocumentFile.aggregate([
      { $match: { documentId: testDocId } },
      { $group: { _id: null, totalPages: { $sum: '$pageNumber' } } },
    ]);

    DocumentFile.aggregate = origAggregate;
    assert.strictEqual(pageAgg.totalPages, 18);
  });

  it('should verify archiveDocument marks document as archived and records preservedDate and preservedBy', async () => {
    const testDocId = new mongoose.Types.ObjectId();
    const testUserId = new mongoose.Types.ObjectId();

    const mockDoc = {
      _id: testDocId,
      title: 'Audit Report 2026',
      fileNumber: 'MOR/AUD/2026/F-01',
      createdBy: testUserId,
      status: 'active',
      preservedDate: null,
      preservedBy: null,
      preservationNotes: '',
      async save() {
        return this;
      },
    };

    const origFindById = Document.findById;
    const origLogCreate = DocumentLog.create;
    Document.findById = async () => mockDoc;
    DocumentLog.create = async () => ({});

    let statusCode = null;
    let responseData = null;

    const req = {
      params: { id: testDocId.toString() },
      body: {
        preservedDate: '2026-11-23',
        preservationNotes: 'Preserved for 10-year official audit record retention',
      },
      user: { id: testUserId.toString(), role: 'department_admin', name: 'Admin User' },
    };
    const res = {
      status(c) {
        statusCode = c;
        return this;
      },
      json(d) {
        responseData = d;
        return this;
      },
    };

    await archiveDocument(req, res, () => {});

    Document.findById = origFindById;
    DocumentLog.create = origLogCreate;

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(mockDoc.status, 'archived');
    assert.ok(mockDoc.preservedDate instanceof Date);
    assert.strictEqual(mockDoc.preservedBy.toString(), testUserId.toString());
    assert.strictEqual(mockDoc.preservationNotes, 'Preserved for 10-year official audit record retention');
  });

  it('should verify listArchivedDocuments uses $facet aggregation and projects strictly the 7 specified fields', async () => {
    let capturedPipeline = null;
    const origAggregate = Document.aggregate;

    Document.aggregate = async (pipeline) => {
      capturedPipeline = pipeline;
      return [
        {
          totalCount: [{ total: 1 }],
          paginatedData: [
            {
              fileId: '650c1f1e1f1e1f1e1f1e1020',
              fileTitle: 'Track Modernization Phase 2',
              fileSubjectLine: 'Sanction of steel rails procurement',
              departmentName: 'Civil Engineering',
              fileNumber: 'MOR/CIVIL/2026/F-114',
              filePagesNumber: 12,
              attachedDocumentNumbers: 3,
              preservedDate: new Date('2026-11-23T12:00:00.000Z'),
            },
          ],
        },
      ];
    };

    let statusCode = null;
    let responseData = null;

    const req = {
      query: { page: '1', pageSize: '10', search: 'Track' },
      user: { id: '650c1f1e1f1e1f1e1f1e1001', role: 'super_admin' },
    };
    const res = {
      status(c) {
        statusCode = c;
        return this;
      },
      json(d) {
        responseData = d;
        return this;
      },
    };

    await listArchivedDocuments(req, res, () => {});

    Document.aggregate = origAggregate;

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.total, 1);
    assert.strictEqual(responseData.data.length, 1);

    const doc = responseData.data[0];
    assert.strictEqual(doc.fileTitle, 'Track Modernization Phase 2');
    assert.strictEqual(doc.fileSubjectLine, 'Sanction of steel rails procurement');
    assert.strictEqual(doc.departmentName, 'Civil Engineering');
    assert.strictEqual(doc.fileNumber, 'MOR/CIVIL/2026/F-114');
    assert.strictEqual(doc.filePagesNumber, 12);
    assert.strictEqual(doc.attachedDocumentNumbers, 3);
    assert.ok(doc.preservedDate);

    // Verify pipeline stages
    const matchStage = capturedPipeline.find((s) => s.$match);
    assert.ok(matchStage, '$match stage must exist');
    assert.strictEqual(matchStage.$match.$and[0].status, 'archived');

    const facetStage = capturedPipeline.find((s) => s.$facet);
    assert.ok(facetStage, '$facet stage must exist');
    const projectStage = facetStage.$facet.paginatedData.find((s) => s.$project);
    assert.ok(projectStage, '$project stage must exist');
    assert.strictEqual(projectStage.$project._id, 0);
    assert.strictEqual(projectStage.$project.fileTitle, '$title');
    assert.strictEqual(projectStage.$project.fileSubjectLine, '$subject');
    assert.strictEqual(projectStage.$project.fileNumber, '$fileNumber');
  });

  it('should validate Ministry model schema definition, indexes, and relations', () => {
    assert.ok(Ministry.schema.paths.name, 'Ministry must have name field');
    assert.strictEqual(Ministry.schema.paths.name.instance, 'String');
    assert.ok(Ministry.schema.paths.code, 'Ministry must have code field');
    assert.strictEqual(Ministry.schema.paths.code.instance, 'String');
    assert.ok(Ministry.schema.paths.description, 'Ministry must have description field');
    assert.ok(Ministry.schema.paths.headOfMinistry, 'Ministry must have headOfMinistry field');
    assert.ok(Ministry.schema.paths.createdBy, 'Ministry must have createdBy field');

    // Verify Department model has ministryId
    assert.ok(Department.schema.paths.ministryId, 'Department must have ministryId');
    assert.strictEqual(Department.schema.paths.ministryId.options.ref, 'Ministry');

    // Verify User model has ministry_admin role and ministryId
    assert.ok(User.schema.paths.role.enumValues.includes('ministry_admin'), 'User roles must include ministry_admin');
    assert.ok(User.schema.paths.ministryId, 'User must have ministryId');
    assert.strictEqual(User.schema.paths.ministryId.options.ref, 'Ministry');
  });

  it('should verify Ministry controllers: create, list, get, update, and delete', async () => {
    assert.strictEqual(typeof createMinistry, 'function');
    assert.strictEqual(typeof listMinistries, 'function');
    assert.strictEqual(typeof getMinistryById, 'function');
    assert.strictEqual(typeof updateMinistry, 'function');
    assert.strictEqual(typeof deleteMinistry, 'function');

    let statusCode = 0;
    let responseData = null;
    const mockRes = {
      status(c) {
        statusCode = c;
        return this;
      },
      json(d) {
        responseData = d;
        return this;
      },
    };

    // 1. createMinistry: validation error on missing name/code
    await createMinistry({ body: { name: '' }, user: { id: '650c1f1e1f1e1f1e1f1e1001' } }, mockRes, () => {});
    assert.strictEqual(statusCode, 400);
    assert.strictEqual(responseData.success, false);

    // 2. createMinistry: successful creation
    const origFindOne = Ministry.findOne;
    const origCreate = Ministry.create;
    Ministry.findOne = async () => null;
    Ministry.create = async (doc) => ({ _id: '650c1f1e1f1e1f1e1f1e2001', ...doc });

    await createMinistry(
      {
        body: { name: 'Ministry of Railways', code: 'MOR', description: 'Rail transport' },
        user: { id: '650c1f1e1f1e1f1e1f1e1001' },
      },
      mockRes,
      () => {}
    );
    assert.strictEqual(statusCode, 201);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.data.code, 'MOR');

    Ministry.findOne = origFindOne;
    Ministry.create = origCreate;

    // 3. deleteMinistry: rejects when departments belong to it
    const origDeptCount = Department.countDocuments;
    const origMinistryFindId = Ministry.findById;
    Department.countDocuments = async () => 3;
    Ministry.findById = async () => ({ _id: '650c1f1e1f1e1f1e1f1e2001', name: 'MOR' });

    await deleteMinistry({ params: { id: '650c1f1e1f1e1f1e1f1e2001' } }, mockRes, () => {});
    assert.strictEqual(statusCode, 400);
    assert.strictEqual(responseData.success, false);
    assert.ok(responseData.message.includes('department(s)'));

    Department.countDocuments = origDeptCount;
    Ministry.findById = origMinistryFindId;
  });

  it('should verify assignMinistryToDepartment assigns ministryId correctly', async () => {
    assert.strictEqual(typeof assignMinistryToDepartment, 'function');

    let statusCode = 0;
    let responseData = null;
    const mockRes = {
      status(c) {
        statusCode = c;
        return this;
      },
      json(d) {
        responseData = d;
        return this;
      },
    };

    const origDeptFind = Department.findById;
    const origMinistryFind = Ministry.findById;

    const fakeDept = {
      _id: '650c1f1e1f1e1f1e1f1e3001',
      name: 'Civil Engineering',
      ministryId: null,
      save: async function () { return this; },
    };

    Department.findById = (id) => ({
      ...fakeDept,
      populate: async () => ({ ...fakeDept, ministryId: { name: 'Ministry of Railways' } }),
      save: async () => fakeDept,
    });
    Ministry.findById = async () => ({ _id: '650c1f1e1f1e1f1e1f1e2001', name: 'Ministry of Railways' });

    await assignMinistryToDepartment(
      {
        params: { id: '650c1f1e1f1e1f1e1f1e3001' },
        body: { ministryId: '650c1f1e1f1e1f1e1f1e2001' },
        user: { role: 'super_admin' },
      },
      mockRes,
      () => {}
    );

    Department.findById = origDeptFind;
    Ministry.findById = origMinistryFind;

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.success, true);
    assert.ok(responseData.message.includes('assigned under ministry'));
  });

  it('should verify createMinistryAdmin creates user with ministry_admin role and ministryId', async () => {
    assert.strictEqual(typeof createMinistryAdmin, 'function');

    let statusCode = 0;
    let responseData = null;
    const mockRes = {
      status(c) {
        statusCode = c;
        return this;
      },
      json(d) {
        responseData = d;
        return this;
      },
    };

    const origMinistryFind = Ministry.findById;
    const origUserFindOne = User.findOne;
    const origUserCreate = User.create;
    const origUserFindById = User.findById;

    Ministry.findById = async () => ({ _id: '650c1f1e1f1e1f1e1f1e2001', name: 'Ministry of Railways' });
    User.findOne = async () => null;
    User.create = async (doc) => ({ _id: '650c1f1e1f1e1f1e1f1e4001', ...doc });
    User.findById = () => ({
      populate: async () => ({
        _id: '650c1f1e1f1e1f1e1f1e4001',
        name: 'Ministry Admin User',
        email: 'min.admin@example.com',
        role: 'ministry_admin',
        ministryId: { name: 'Ministry of Railways', code: 'MOR' },
      }),
    });

    await createMinistryAdmin(
      {
        body: {
          name: 'Ministry Admin User',
          email: 'min.admin@example.com',
          password: 'Password123!',
          ministryId: '650c1f1e1f1e1f1e1f1e2001',
        },
        user: { role: 'super_admin' },
      },
      mockRes,
      () => {}
    );

    Ministry.findById = origMinistryFind;
    User.findOne = origUserFindOne;
    User.create = origUserCreate;
    User.findById = origUserFindById;
    User.findOne = origUserFindOne;

    assert.strictEqual(statusCode, 201);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.data.role, 'ministry_admin');
    assert.strictEqual(responseData.data.ministryId.code, 'MOR');
  });

  it('should verify Ministry Admin scoping for department, employee, and document access', async () => {
    let statusCode = 0;
    let responseData = null;
    const mockRes = {
      status(c) {
        statusCode = c;
        return this;
      },
      json(d) {
        responseData = d;
        return this;
      },
    };

    // 1. Ministry Admin creating department automatically gets user's ministryId
    const origDeptFindOne = Department.findOne;
    const origDeptCreate = Department.create;
    const origMinistryFind = Ministry.findById;

    Department.findOne = async () => null;
    let createdDeptData = null;
    Department.create = async (doc) => {
      createdDeptData = doc;
      return { _id: '650c1f1e1f1e1f1e1f1e3002', ...doc };
    };
    Ministry.findById = async () => ({ _id: '650c1f1e1f1e1f1e1f1e2001', name: 'MOR' });

    await createDepartment(
      {
        body: { name: 'Signal Engineering', code: 'SIG' },
        user: { id: '650c1f1e1f1e1f1e1f1e4001', role: 'ministry_admin', ministryId: '650c1f1e1f1e1f1e1f1e2001' },
      },
      mockRes,
      () => {}
    );

    Department.findOne = origDeptFindOne;
    Department.create = origDeptCreate;
    Ministry.findById = origMinistryFind;

    assert.strictEqual(statusCode, 201);
    assert.strictEqual(createdDeptData.ministryId, '650c1f1e1f1e1f1e1f1e2001');

    // 2. Ministry Admin creating employee: rejects if department belongs to another ministry
    const origDeptFindById = Department.findById;
    Department.findById = async (id) => ({
      _id: id,
      name: 'External Dept',
      ministryId: '650c1f1e1f1e1f1e1f1e9999', // different ministry
    });

    await createEmployee(
      {
        body: {
          name: 'Staff One',
          email: 'staff@example.com',
          password: 'Password123!',
          departmentId: '650c1f1e1f1e1f1e1f1e3003',
        },
        user: { role: 'ministry_admin', ministryId: '650c1f1e1f1e1f1e1f1e2001' },
      },
      mockRes,
      () => {}
    );
    assert.strictEqual(statusCode, 403);
    assert.ok(responseData.message.includes('within your ministry'));

    // 3. checkDocumentAccess allows Ministry Admin for document in their ministry
    const origDocFindById = Document.findById;
    Document.findById = async () => ({
      _id: '650c1f1e1f1e1f1e1f1e5001',
      title: 'Railway Signal Policy',
      departmentId: '650c1f1e1f1e1f1e1f1e3001',
    });
    Department.findById = async () => ({
      _id: '650c1f1e1f1e1f1e1f1e3001',
      ministryId: '650c1f1e1f1e1f1e1f1e2001',
    });

    let nextCalled = false;
    const mockReq = {
      params: { id: '650c1f1e1f1e1f1e1f1e5001' },
      user: { id: '650c1f1e1f1e1f1e1f1e4001', role: 'ministry_admin', ministryId: '650c1f1e1f1e1f1e1f1e2001' },
    };

    const middleware = checkDocumentAccess('canView');
    await middleware(mockReq, mockRes, () => {
      nextCalled = true;
    });

    Document.findById = origDocFindById;
    Department.findById = origDeptFindById;

    assert.strictEqual(nextCalled, true);
    assert.ok(mockReq.document);
    assert.strictEqual(mockReq.userPermission.isMinistryAdmin, true);
    assert.strictEqual(mockReq.userPermission.canView, true);
  });

  it('should validate DocumentWorkflowStatus model schema definition, enums, and indexes', () => {
    assert.ok(DocumentWorkflowStatus.schema.paths.documentId, 'Must have documentId');
    assert.strictEqual(DocumentWorkflowStatus.schema.paths.documentId.options.ref, 'Document');
    assert.ok(DocumentWorkflowStatus.schema.paths.employeeId, 'Must have employeeId');
    assert.strictEqual(DocumentWorkflowStatus.schema.paths.employeeId.options.ref, 'User');
    assert.ok(DocumentWorkflowStatus.schema.paths.status, 'Must have status');
    assert.deepStrictEqual(
      DocumentWorkflowStatus.schema.paths.status.enumValues,
      ['draft', 'back', 'approve', 'sent', 'receive']
    );
    assert.ok(DocumentWorkflowStatus.schema.paths.statusUpdateTime, 'Must have statusUpdateTime');
    assert.ok(DocumentWorkflowStatus.schema.paths.isCurrent, 'Must have isCurrent');
    assert.strictEqual(DocumentWorkflowStatus.schema.paths.isCurrent.defaultValue, true);
    assert.ok(DocumentWorkflowStatus.schema.paths.isPhysicalFileReceived, 'Must have isPhysicalFileReceived');
    assert.strictEqual(DocumentWorkflowStatus.schema.paths.isPhysicalFileReceived.defaultValue, false);
    assert.ok(DocumentWorkflowStatus.schema.paths.physicalFileReceivedTime, 'Must have physicalFileReceivedTime');
    assert.ok(DocumentWorkflowStatus.schema.paths.remarks, 'Must have remarks');
    assert.ok(DocumentWorkflowStatus.schema.paths.departmentId, 'Must have departmentId');
  });

  it('should verify createDocumentWorkflowStatus enforces document access and creates record', async () => {
    assert.strictEqual(typeof createDocumentWorkflowStatus, 'function');

    let statusCode = 0;
    let responseData = null;
    const mockRes = {
      status(c) {
        statusCode = c;
        return this;
      },
      json(d) {
        responseData = d;
        return this;
      },
    };

    const origFwdFindOne = DocumentForward.findOne;
    const origPermFindOne = DocumentPermission.findOne;
    DocumentForward.findOne = async () => null;
    DocumentPermission.findOne = async () => null;

    // 1. Validation error on missing documentId or status
    await createDocumentWorkflowStatus({ body: {} }, mockRes, () => {});
    assert.strictEqual(statusCode, 400);
    assert.strictEqual(responseData.success, false);

    // 2. Validation error on invalid status
    await createDocumentWorkflowStatus(
      { body: { documentId: '650c1f1e1f1e1f1e1f1e5001', status: 'invalid_status' } },
      mockRes,
      () => {}
    );
    assert.strictEqual(statusCode, 400);
    assert.ok(responseData.message.includes('Invalid status'));

    // 3. Document not found
    const origDocFindById = Document.findById;
    Document.findById = async () => null;
    await createDocumentWorkflowStatus(
      { body: { documentId: '650c1f1e1f1e1f1e1f1e5001', status: 'draft' } },
      mockRes,
      () => {}
    );
    assert.strictEqual(statusCode, 404);

    // 4. Employee lacks permission to access document -> 403 Forbidden
    Document.findById = async () => ({
      _id: '650c1f1e1f1e1f1e1f1e5001',
      title: 'Confidential Finance Audit',
      departmentId: '650c1f1e1f1e1f1e1f1e9999',
      accessControl: 'department_only',
    });

    await createDocumentWorkflowStatus(
      {
        body: { documentId: '650c1f1e1f1e1f1e1f1e5001', status: 'sent' },
        user: { id: '650c1f1e1f1e1f1e1f1e4001', role: 'employee', departmentId: '650c1f1e1f1e1f1e1f1e3001' },
      },
      mockRes,
      () => {}
    );
    assert.strictEqual(statusCode, 403);
    assert.strictEqual(responseData.success, false);
    assert.ok(responseData.message.includes('permission to access'));

    // 5. Authorized employee creates status successfully -> 201 Created
    Document.findById = async () => ({
      _id: '650c1f1e1f1e1f1e1f1e5001',
      title: 'Civil Track Modernization',
      departmentId: '650c1f1e1f1e1f1e1f1e3001',
      accessControl: 'general',
    });

    const origStatusUpdateMany = DocumentWorkflowStatus.updateMany;
    const origStatusCreate = DocumentWorkflowStatus.create;
    const origStatusFindById = DocumentWorkflowStatus.findById;

    let createdStatusDoc = null;
    DocumentWorkflowStatus.updateMany = async () => ({ modifiedCount: 1 });
    DocumentWorkflowStatus.create = async (doc) => {
      createdStatusDoc = doc;
      return { _id: '650c1f1e1f1e1f1e1f1e6001', ...doc };
    };
    DocumentWorkflowStatus.findById = () => ({
      populate() {
        return {
          populate() {
            return {
              populate: async () => ({
                _id: '650c1f1e1f1e1f1e1f1e6001',
                documentId: { _id: '650c1f1e1f1e1f1e1f1e5001', title: 'Civil Track Modernization', fileNumber: 'MOR/CIVIL/F-101' },
                employeeId: { _id: '650c1f1e1f1e1f1e1f1e4001', name: 'Test Officer', employeeId: 'MOR/001' },
                status: 'receive',
                remarks: 'Physical file received at desk',
                isPhysicalFileReceived: true,
                physicalFileReceivedTime: createdStatusDoc?.physicalFileReceivedTime,
                isCurrent: true,
              }),
            };
          },
        };
      },
    });

    await createDocumentWorkflowStatus(
      {
        body: {
          documentId: '650c1f1e1f1e1f1e1f1e5001',
          status: 'receive',
          remarks: 'Physical file received at desk',
          isPhysicalFileReceived: true,
        },
        user: { id: '650c1f1e1f1e1f1e1f1e4001', role: 'employee', departmentId: '650c1f1e1f1e1f1e1f1e3001' },
      },
      mockRes,
      () => {}
    );

    Document.findById = origDocFindById;
    DocumentForward.findOne = origFwdFindOne;
    DocumentPermission.findOne = origPermFindOne;
    DocumentWorkflowStatus.updateMany = origStatusUpdateMany;
    DocumentWorkflowStatus.create = origStatusCreate;
    DocumentWorkflowStatus.findById = origStatusFindById;

    assert.strictEqual(statusCode, 201);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.data.status, 'receive');
    assert.strictEqual(responseData.data.isCurrent, true);
    assert.strictEqual(createdStatusDoc.isPhysicalFileReceived, true);
    assert.ok(createdStatusDoc.physicalFileReceivedTime instanceof Date);
  });

  it('should verify DocumentWorkflowStatus controllers: list, getById, history, update, and delete', async () => {
    assert.strictEqual(typeof listDocumentWorkflowStatuses, 'function');
    assert.strictEqual(typeof getDocumentWorkflowStatusById, 'function');
    assert.strictEqual(typeof getDocumentStatusHistory, 'function');
    assert.strictEqual(typeof updateDocumentWorkflowStatus, 'function');
    assert.strictEqual(typeof deleteDocumentWorkflowStatus, 'function');

    let statusCode = 0;
    let responseData = null;
    const mockRes = {
      status(c) {
        statusCode = c;
        return this;
      },
      json(d) {
        responseData = d;
        return this;
      },
    };

    // 1. listDocumentWorkflowStatuses for Super Admin
    const origCount = DocumentWorkflowStatus.countDocuments;
    const origFind = DocumentWorkflowStatus.find;
    const origFindById = DocumentWorkflowStatus.findById;

    DocumentWorkflowStatus.countDocuments = async () => 1;
    DocumentWorkflowStatus.find = () => ({
      populate() {
        return {
          populate() {
            return {
              populate() {
                return {
                  sort() {
                    return {
                      skip() {
                        return {
                          limit: async () => [
                            {
                              _id: '650c1f1e1f1e1f1e1f1e6001',
                              status: 'approve',
                              isCurrent: true,
                            },
                          ],
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    });

    await listDocumentWorkflowStatuses(
      {
        query: { page: '1', pageSize: '10' },
        user: { role: 'super_admin' },
      },
      mockRes,
      () => {}
    );

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.total, 1);

    // 2. getDocumentStatusHistory
    const origDocFindById = Document.findById;
    Document.findById = async () => ({
      _id: '650c1f1e1f1e1f1e1f1e5001',
      title: 'Civil Track Modernization',
      fileNumber: 'MOR/CIVIL/F-101',
      departmentId: '650c1f1e1f1e1f1e1f1e3001',
      accessControl: 'general',
    });

    DocumentWorkflowStatus.find = () => ({
      populate() {
        return {
          populate() {
            return {
              sort: async () => [
                { _id: '650c1f1e1f1e1f1e1f1e6002', status: 'approve', isCurrent: true },
                { _id: '650c1f1e1f1e1f1e1f1e6001', status: 'sent', isCurrent: false },
              ],
            };
          },
        };
      },
    });

    await getDocumentStatusHistory(
      {
        params: { documentId: '650c1f1e1f1e1f1e1f1e5001' },
        user: { role: 'super_admin' },
      },
      mockRes,
      () => {}
    );

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.data.totalHistory, 2);
    assert.strictEqual(responseData.data.document.currentStatus, 'approve');

    // 3. updateDocumentWorkflowStatus
    const fakeStatus = {
      _id: '650c1f1e1f1e1f1e1f1e6001',
      employeeId: '650c1f1e1f1e1f1e1f1e4001',
      status: 'sent',
      remarks: 'Initial remarks',
      save: async function () { return this; },
      populate() {
        return {
          populate() {
            return {
              populate: async () => ({
                ...fakeStatus,
                status: 'receive',
                remarks: 'Received at desk',
                isPhysicalFileReceived: fakeStatus.isPhysicalFileReceived,
                physicalFileReceivedTime: fakeStatus.physicalFileReceivedTime,
              }),
            };
          },
        };
      },
    };

    DocumentWorkflowStatus.findById = () => fakeStatus;

    await updateDocumentWorkflowStatus(
      {
        params: { id: '650c1f1e1f1e1f1e1f1e6001' },
        body: { status: 'receive', remarks: 'Received at desk', isPhysicalFileReceived: true },
        user: { id: '650c1f1e1f1e1f1e1f1e4001', role: 'employee' },
      },
      mockRes,
      () => {}
    );

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(fakeStatus.isPhysicalFileReceived, true);
    assert.ok(fakeStatus.physicalFileReceivedTime instanceof Date);
    assert.strictEqual(responseData.success, true);

    // 4. deleteDocumentWorkflowStatus
    const origFindByIdAndDelete = DocumentWorkflowStatus.findByIdAndDelete;
    DocumentWorkflowStatus.findById = async () => ({
      _id: '650c1f1e1f1e1f1e1f1e6001',
      employeeId: '650c1f1e1f1e1f1e1f1e4001',
      isCurrent: true,
      documentId: '650c1f1e1f1e1f1e1f1e5001',
    });
    DocumentWorkflowStatus.findByIdAndDelete = async () => ({ _id: '650c1f1e1f1e1f1e1f1e6001' });
    DocumentWorkflowStatus.findOne = () => ({
      sort: async () => null,
    });

    await deleteDocumentWorkflowStatus(
      {
        params: { id: '650c1f1e1f1e1f1e1f1e6001' },
        user: { id: '650c1f1e1f1e1f1e1f1e4001', role: 'employee' },
      },
      mockRes,
      () => {}
    );

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.success, true);

    DocumentWorkflowStatus.countDocuments = origCount;
    DocumentWorkflowStatus.find = origFind;
    DocumentWorkflowStatus.findById = origFindById;
    DocumentWorkflowStatus.findByIdAndDelete = origFindByIdAndDelete;
    Document.findById = origDocFindById;
  });

  it('should verify forwardDocument supports targetUserId, auto-sets targetDepartmentId, and auto-grants permission', async () => {
    assert.strictEqual(typeof forwardDocument, 'function');

    let statusCode = 0;
    let responseData = null;
    const mockRes = {
      status(c) {
        statusCode = c;
        return this;
      },
      json(d) {
        responseData = d;
        return this;
      },
    };

    const mockDocument = {
      _id: '650c1f1e1f1e1f1e1f1e5001',
      title: 'Track Modernization Phase 2',
      departmentId: '650c1f1e1f1e1f1e1f1e3001',
      fileNumber: 'MOR/CIVIL/F-101',
    };

    // 1. Rejects when neither targetDepartmentId nor targetUserId is provided
    await forwardDocument(
      {
        body: {},
        document: mockDocument,
        user: { id: '650c1f1e1f1e1f1e1f1e1001', role: 'super_admin' },
      },
      mockRes,
      () => {}
    );
    assert.strictEqual(statusCode, 400);
    assert.ok(responseData.message.includes('Either targetDepartmentId or targetUserId is required'));

    // 2. Forwarding with targetUserId auto-derives targetDepartmentId and grants permission
    const origUserFindById = User.findById;
    const origUserFindOne = User.findOne;
    const origFwdFindOne = DocumentForward.findOne;
    const origFwdCreate = DocumentForward.create;
    const origFwdFindById = DocumentForward.findById;
    const origPermFindOneAndUpdate = DocumentPermission.findOneAndUpdate;
    const origLogCreate = DocumentLog.create;
    const origNotifCreateGlobal = Notification.create;
    DocumentLog.create = async () => ({});
    Notification.create = async () => ({});
    User.findOne = async () => null;

    const mockFinanceUser = {
      _id: '650c1f1e1f1e1f1e1f1e4002',
      name: 'Finance Officer',
      employeeId: 'EMP-FIN-001',
      departmentId: { _id: '650c1f1e1f1e1f1e1f1e3002', name: 'Finance', code: 'FIN' },
    };
    User.findById = () => ({
      ...mockFinanceUser,
      populate: async function () { return mockFinanceUser; },
    });

    DocumentForward.findOne = async () => null;
    let createdForwardDoc = null;
    DocumentForward.create = async (doc) => {
      createdForwardDoc = doc;
      return { _id: '650c1f1e1f1e1f1e1f1e7001', ...doc };
    };

    let grantedPerm = null;
    DocumentPermission.findOneAndUpdate = async (filter, update) => {
      grantedPerm = update.$set;
      return grantedPerm;
    };

    DocumentForward.findById = () => ({
      populate() {
        return {
          populate() {
            return {
              populate: async () => ({
                _id: '650c1f1e1f1e1f1e1f1e7001',
                documentId: mockDocument._id,
                targetUserId: { _id: '650c1f1e1f1e1f1e1f1e4002', name: 'Finance Officer' },
                targetDepartmentId: { _id: '650c1f1e1f1e1f1e1f1e3002', name: 'Finance' },
              }),
            };
          },
        };
      },
    });

    await forwardDocument(
      {
        body: {
          targetUserId: '650c1f1e1f1e1f1e1f1e4002',
          priority: 'urgent',
          remarks: 'Review finance concurrence',
        },
        document: mockDocument,
        user: { id: '650c1f1e1f1e1f1e1f1e1001', role: 'super_admin' },
      },
      mockRes,
      () => {}
    );

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(createdForwardDoc.targetUserId, '650c1f1e1f1e1f1e1f1e4002');
    assert.strictEqual(createdForwardDoc.targetDepartmentId.toString(), '650c1f1e1f1e1f1e1f1e3002');
    assert.strictEqual(createdForwardDoc.status, 'sent');
    assert.strictEqual(grantedPerm, null, 'Permission must NOT be granted before receive');

    // 3. Forwarding with only targetDepartmentId
    const origDeptFindById = Department.findById;
    Department.findById = async () => ({
      _id: '650c1f1e1f1e1f1e1f1e3003',
      name: 'Electrical',
      code: 'ELEC',
    });

    await forwardDocument(
      {
        body: {
          targetDepartmentId: '650c1f1e1f1e1f1e1f1e3003',
          remarks: 'Department wide forward',
        },
        document: mockDocument,
        user: { id: '650c1f1e1f1e1f1e1f1e1001', role: 'super_admin' },
      },
      mockRes,
      () => {}
    );

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(createdForwardDoc.targetUserId, null);
    assert.strictEqual(createdForwardDoc.targetDepartmentId, '650c1f1e1f1e1f1e1f1e3003');

    User.findById = origUserFindById;
    User.findOne = origUserFindOne;
    Department.findById = origDeptFindById;
    DocumentForward.findOne = origFwdFindOne;
    DocumentForward.create = origFwdCreate;
    DocumentForward.findById = origFwdFindById;
    DocumentPermission.findOneAndUpdate = origPermFindOneAndUpdate;
    DocumentLog.create = origLogCreate;
    Notification.create = origNotifCreateGlobal;
  });

  it('should verify forward lifecycle: draft (no log), send, resend, recall, receive (with receivedTime) and no permissions until received', async () => {
    let statusCode = 0;
    let responseData = null;
    const mockRes = {
      status(c) {
        statusCode = c;
        return this;
      },
      json(d) {
        responseData = d;
        return this;
      },
    };

    const mockDocument = {
      _id: '650c1f1e1f1e1f1e1f1e5002',
      title: 'Solar Power Plant Proposal',
      departmentId: '650c1f1e1f1e1f1e1f1e3001',
      fileNumber: 'MOR/ELEC/2026/F-501',
    };

    const origDocFindById = Document.findById;
    const origFwdFindOne = DocumentForward.findOne;
    const origFwdCreate = DocumentForward.create;
    const origFwdFindById = DocumentForward.findById;
    const origUserFindById = User.findById;
    const origUserFindOne = User.findOne;
    const origDeptFindById = Department.findById;
    const origPermFindOneAndUpdate = DocumentPermission.findOneAndUpdate;
    const origLogCreate = DocumentLog.create;
    const origWorkflowCreate = DocumentWorkflowStatus.create;
    const origNotifCreate = Notification.create;
    const origNotifUpdateMany = Notification.updateMany;

    let capturedNotifications = [];
    Notification.create = async (notif) => {
      capturedNotifications.push(notif);
      return { _id: '650c1f1e1f1e1f1e1f1e9501', ...notif };
    };

    let capturedDismissed = [];
    Notification.updateMany = async (filter, update) => {
      capturedDismissed.push({ filter, update });
      return { modifiedCount: 1 };
    };

    let capturedLogs = [];
    DocumentLog.create = async (log) => {
      capturedLogs.push(log);
      return log;
    };

    let capturedPerms = [];
    DocumentPermission.findOneAndUpdate = async (filter, update) => {
      capturedPerms.push(update.$set);
      return update.$set;
    };

    let capturedWorkflowStatuses = [];
    DocumentWorkflowStatus.create = async (statusDoc) => {
      capturedWorkflowStatuses.push(statusDoc);
      return { _id: '650c1f1e1f1e1f1e1f1e9001', ...statusDoc };
    };

    const mockTechUser = {
      _id: '650c1f1e1f1e1f1e1f1e4003',
      name: 'Technical Officer',
      email: 'tech@gov.in',
      employeeId: 'EMP-TECH-002',
      departmentId: { _id: '650c1f1e1f1e1f1e1f1e3005', name: 'Technical', code: 'TECH' },
    };
    User.findById = () => ({
      ...mockTechUser,
      populate: async function () { return mockTechUser; },
    });
    User.findOne = async () => null;

    Department.findById = async (id) => ({
      _id: id,
      name: 'Technical',
      code: 'TECH',
    });

    Document.findById = async () => mockDocument;

    // --- STEP 1: Draft Forward ---
    // Must NOT create DocumentPermission, must NOT create DocumentLog (no draft log), must NOT create DocumentWorkflowStatus
    let storedForward = null;
    DocumentForward.create = async (doc) => {
      storedForward = {
        _id: '650c1f1e1f1e1f1e1f1e8001',
        ...doc,
        save: async function () {
          return this;
        },
      };
      return storedForward;
    };

    DocumentForward.findOne = async () => null;
    DocumentForward.findById = () => ({
      populate() {
        return {
          populate() {
            return {
              populate: async () => storedForward,
            };
          },
        };
      },
    });

    await forwardDocument(
      {
        body: {
          targetUserId: '650c1f1e1f1e1f1e1f1e4003',
          priority: 'urgent',
          remarks: 'Draft forward for solar plant',
          status: 'draft',
        },
        document: mockDocument,
        user: { id: '650c1f1e1f1e1f1e1f1e1001', role: 'department_admin', name: 'Civil Admin' },
      },
      mockRes,
      () => {}
    );

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(storedForward.status, 'draft');
    assert.strictEqual(capturedPerms.length, 0, 'No permissions should be granted for draft');
    assert.strictEqual(capturedLogs.length, 0, 'No draft log should be created');
    assert.strictEqual(capturedWorkflowStatuses.length, 0, 'No workflow status should be created for draft');
    assert.strictEqual(capturedNotifications.length, 0, 'No notification should be sent for draft');

    // --- STEP 2: Dispatch Draft Forward (Send) ---
    DocumentForward.findOne = async () => storedForward;
    await sendDraftForward(
      {
        params: { id: mockDocument._id, forwardId: storedForward._id },
        document: mockDocument,
        user: { id: '650c1f1e1f1e1f1e1f1e1001', role: 'department_admin', name: 'Civil Admin' },
      },
      mockRes,
      () => {}
    );

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(storedForward.status, 'sent');
    assert.ok(storedForward.sentAt instanceof Date, 'sentAt must be recorded');
    assert.strictEqual(capturedPerms.length, 0, 'Still no permissions granted before receive');
    assert.strictEqual(capturedLogs.length, 1, 'File Forwarded log must be created on send');
    assert.strictEqual(capturedLogs[0].action, 'File Forwarded');
    assert.strictEqual(capturedWorkflowStatuses.length, 0, 'Still no workflow status before receive');
    assert.strictEqual(capturedNotifications.length, 1, 'Notification must be sent to recipient on forward');
    assert.ok(capturedNotifications[0].title.includes('File Forwarded'));
    assert.strictEqual(capturedNotifications[0].targetUser, '650c1f1e1f1e1f1e1f1e4003');

    // --- STEP 3: Resend Forward ---
    await resendForward(
      {
        params: { id: mockDocument._id, forwardId: storedForward._id },
        body: { remarks: 'Gentle reminder to review urgently', priority: 'immediate' },
        document: mockDocument,
        user: { id: '650c1f1e1f1e1f1e1f1e1001', role: 'department_admin', name: 'Civil Admin' },
      },
      mockRes,
      () => {}
    );

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(storedForward.status, 'resend');
    assert.strictEqual(storedForward.resendCount, 1);
    assert.strictEqual(storedForward.priority, 'immediate');
    assert.strictEqual(capturedLogs.length, 2, 'File Resent log must be created');
    assert.strictEqual(capturedLogs[1].action, 'File Resent');
    assert.strictEqual(capturedWorkflowStatuses.length, 0, 'Still no workflow status on resend');
    assert.strictEqual(capturedNotifications.length, 2, 'Reminder notification must be sent on resend');
    assert.ok(capturedNotifications[1].title.includes('File Forward Reminder'));

    // --- STEP 4: Recall Forward ---
    await recallForward(
      {
        params: { id: mockDocument._id, forwardId: storedForward._id },
        body: { reason: 'Incorrect estimate sheet attached' },
        document: mockDocument,
        user: { id: '650c1f1e1f1e1f1e1f1e1001', role: 'department_admin', name: 'Civil Admin' },
      },
      mockRes,
      () => {}
    );

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(storedForward.status, 'recalled');
    assert.ok(storedForward.recalledAt instanceof Date);
    assert.strictEqual(storedForward.recallReason, 'Incorrect estimate sheet attached');
    assert.strictEqual(capturedLogs.length, 3, 'File Recalled log must be created');
    assert.strictEqual(capturedLogs[2].action, 'File Recalled');
    assert.strictEqual(capturedDismissed.length, 1, 'Notifications must be dismissed on recall');
    assert.strictEqual(capturedDismissed[0].update.$set.status, 'dismissed');

    // --- STEP 5: Cannot Receive a Recalled Forward ---
    await receiveForward(
      {
        params: { id: mockDocument._id, forwardId: storedForward._id },
        body: {},
        user: { id: '650c1f1e1f1e1f1e1f1e4003', role: 'employee', name: 'Technical Officer' },
      },
      mockRes,
      () => {}
    );

    assert.strictEqual(statusCode, 400);
    assert.ok(responseData.message.includes('Cannot receive: this document forward was recalled'));

    // --- STEP 6: Active Forward Received by Recipient ---
    // Simulate active in-transit forward
    storedForward.status = 'sent';
    storedForward.recalledAt = null;

    DocumentForward.findById = () => ({
      populate() {
        return {
          populate() {
            return {
              populate() {
                return {
                  populate: async () => storedForward,
                };
              },
            };
          },
        };
      },
    });

    await receiveForward(
      {
        params: { id: mockDocument._id, forwardId: storedForward._id },
        body: {
          remarks: 'Received and file accepted for inspection',
          isPhysicalFileReceived: true,
        },
        user: {
          id: '650c1f1e1f1e1f1e1f1e4003',
          role: 'employee',
          name: 'Technical Officer',
          departmentId: '650c1f1e1f1e1f1e1f1e3005',
        },
      },
      mockRes,
      () => {}
    );

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(storedForward.status, 'receive');
    assert.ok(storedForward.receivedTime instanceof Date, 'receivedTime must be set');
    assert.strictEqual(storedForward.receivedBy, '650c1f1e1f1e1f1e1f1e4003');
    assert.strictEqual(storedForward.isPhysicalFileReceived, true);
    assert.ok(storedForward.physicalFileReceivedTime instanceof Date);

    // Permission MUST be granted now
    assert.strictEqual(capturedPerms.length, 1, 'Permission must be granted upon receive');
    assert.strictEqual(capturedPerms[0].userId, '650c1f1e1f1e1f1e1f1e4003');
    assert.strictEqual(capturedPerms[0].permissions.canView, true);

    // Workflow status MUST be created now
    assert.strictEqual(capturedWorkflowStatuses.length, 1, 'DocumentWorkflowStatus created on receive');
    assert.strictEqual(capturedWorkflowStatuses[0].status, 'receive');
    assert.strictEqual(capturedWorkflowStatuses[0].isPhysicalFileReceived, true);

    // DocumentLog MUST record 'File Received'
    assert.strictEqual(capturedLogs.length, 4);
    assert.strictEqual(capturedLogs[3].action, 'File Received');

    // --- STEP 7: Cannot Recall after Receive ---
    await recallForward(
      {
        params: { id: mockDocument._id, forwardId: storedForward._id },
        body: { reason: 'Try to recall after receive' },
        document: mockDocument,
        user: { id: '650c1f1e1f1e1f1e1f1e1001', role: 'department_admin', name: 'Civil Admin' },
      },
      mockRes,
      () => {}
    );

    assert.strictEqual(statusCode, 400);
    assert.ok(responseData.message.includes('Cannot recall a file that has already been received'));

    // Restore original stubs
    Document.findById = origDocFindById;
    DocumentForward.findOne = origFwdFindOne;
    DocumentForward.create = origFwdCreate;
    DocumentForward.findById = origFwdFindById;
    User.findById = origUserFindById;
    User.findOne = origUserFindOne;
    Department.findById = origDeptFindById;
    DocumentPermission.findOneAndUpdate = origPermFindOneAndUpdate;
    DocumentLog.create = origLogCreate;
    DocumentWorkflowStatus.create = origWorkflowCreate;
    Notification.create = origNotifCreate;
    Notification.updateMany = origNotifUpdateMany;
  });
});

describe('Email Template System & HTML Security Sanitizer', () => {
  it('blocks malicious HTML tags, inline event handlers, JS URIs, and obfuscated entities', async () => {
    const { validateAndSanitizeEmailHtml } = await import('../src/utils/html.sanitizer.util.js');

    const scriptRes = validateAndSanitizeEmailHtml('<div>Hello</div><script>alert(1)</script>');
    assert.strictEqual(scriptRes.valid, false);
    assert.ok(scriptRes.violations.some((v) => v.includes('<script>')));

    const onClickRes = validateAndSanitizeEmailHtml('<a href="https://example.com" onclick="steal()">Click</a>');
    assert.strictEqual(onClickRes.valid, false);
    assert.ok(onClickRes.violations.some((v) => v.includes('onclick')));

    const jsUriRes = validateAndSanitizeEmailHtml('<a href="javascript:alert(1)">Link</a>');
    assert.strictEqual(jsUriRes.valid, false);

    const entityBypassRes = validateAndSanitizeEmailHtml('<a href="&#x6a;avascript:alert(1)">Link</a>');
    assert.strictEqual(entityBypassRes.valid, false);

    const iframeRes = validateAndSanitizeEmailHtml('<iframe src="https://evil.com"></iframe>');
    assert.strictEqual(iframeRes.valid, false);

    const cssExprRes = validateAndSanitizeEmailHtml('<div style="width: expression(alert(1))">Hi</div>');
    assert.strictEqual(cssExprRes.valid, false);

    const safeHtml =
      '<div style="font-family: Arial;"><img src="{{organization-logo-image}}" alt="Logo" /><h2>Hello {{username}}</h2><p>IP: [ip address]</p></div>';
    const safeRes = validateAndSanitizeEmailHtml(safeHtml);
    assert.strictEqual(safeRes.valid, true);
    assert.strictEqual(safeRes.violations.length, 0);
  });

  it('renders both {{...}} and [...] placeholders and escapes injected HTML values', async () => {
    const { renderTemplateString, extractPlaceholders } = await import(
      '../src/utils/email.template.util.js'
    );

    const tpl =
      '<p>User: {{username}}, Email: [email], IP: {{ip address}}, Sender: [[sender-user-name]], Logo: {{organization-logo-image}}, Date: {{current-date}}</p>';
    const keys = extractPlaceholders(tpl);
    assert.ok(keys.includes('username'));
    assert.ok(keys.includes('email'));
    assert.ok(keys.includes('ip-address'));
    assert.ok(keys.includes('sender-user-name'));
    assert.ok(keys.includes('organization-logo-image'));
    assert.ok(keys.includes('current-date'));

    const rendered = renderTemplateString(tpl, {
      username: '<script>xss</script>',
      email: 'ankit@example.com',
      'ip address': '10.0.0.5',
      'sender-user-name': 'Super Admin',
      'organization-logo-image': 'https://example.com/logo.png',
    });

    assert.ok(rendered.includes('&lt;script&gt;xss&lt;/script&gt;'));
    assert.ok(rendered.includes('ankit@example.com'));
    assert.ok(rendered.includes('10.0.0.5'));
    assert.ok(rendered.includes('Super Admin'));
    assert.ok(rendered.includes('https://example.com/logo.png'));
  });

  it('allows Super Admin to create, preview, activate, and delete HTML email templates while rejecting JS', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { EmailTemplate } = await import('../src/models/email.template.model.js');
    const {
      createEmailTemplate,
      previewEmailTemplate,
      activateEmailTemplate,
      deleteEmailTemplate,
    } = await import('../src/controllers/email.template.controller.js');

    const origCreate = EmailTemplate.create;
    const origUpdateMany = EmailTemplate.updateMany;
    const origFindById = EmailTemplate.findById;
    const origFindByIdAndDelete = EmailTemplate.findByIdAndDelete;

    let savedDoc = null;
    EmailTemplate.updateMany = async () => ({ modifiedCount: 0 });
    EmailTemplate.create = async (data) => {
      savedDoc = {
        ...data,
        _id: '650c1f1e1f1e1f1e1f1e9901',
        save: async () => savedDoc,
      };
      return savedDoc;
    };
    EmailTemplate.findById = async () => savedDoc;
    EmailTemplate.findByIdAndDelete = async () => savedDoc;

    let statusCode = 0;
    let responseData = null;
    const mockRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      },
    };

    // 1. Reject template containing <script>
    await createEmailTemplate(
      {
        body: {
          name: 'Malicious Template',
          eventKey: 'account_created',
          subject: 'Hello {{username}}',
          html: '<div>Hi {{username}}</div><script>fetch("http://evil")</script>',
        },
        user: { _id: '650c1f1e1f1e1f1e1f1e0001', name: 'Super Admin' },
      },
      mockRes,
      () => {}
    );
    assert.strictEqual(statusCode, 400);
    assert.strictEqual(responseData.success, false);
    assert.ok(responseData.violations.length > 0);

    // 2. Create clean template
    await createEmailTemplate(
      {
        body: {
          name: 'Clean Welcome Template',
          eventKey: 'account_created',
          subject: 'Welcome {{username}}',
          html: '<div><img src="{{organization-logo-image}}" /><h1>Welcome {{username}}</h1><p>Email: [email] | IP: {{ip address}}</p></div>',
        },
        user: { _id: '650c1f1e1f1e1f1e1f1e0001', name: 'Super Admin' },
      },
      mockRes,
      () => {}
    );
    assert.strictEqual(statusCode, 201);
    assert.strictEqual(responseData.success, true);
    assert.ok(fs.existsSync(path.resolve(process.cwd(), savedDoc.htmlFilePath)));

    // 3. Preview template
    await previewEmailTemplate(
      {
        params: { id: savedDoc._id },
        body: { variables: { username: 'Ankit', email: 'ankit@gov.in' } },
        ip: '192.168.1.10',
        user: { name: 'Super Admin' },
      },
      mockRes,
      () => {}
    );
    assert.strictEqual(statusCode, 200);
    assert.ok(responseData.data.html.includes('Welcome Ankit'));
    assert.ok(responseData.data.html.includes('192.168.1.10'));

    // 4. Activate template
    await activateEmailTemplate(
      {
        params: { id: savedDoc._id },
        user: { _id: '650c1f1e1f1e1f1e1f1e0001' },
      },
      mockRes,
      () => {}
    );
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(savedDoc.isActive, true);

    // 5. Delete template and verify file removal
    const fileToCheck = path.resolve(process.cwd(), savedDoc.htmlFilePath);
    await deleteEmailTemplate({ params: { id: savedDoc._id } }, mockRes, () => {});
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(fs.existsSync(fileToCheck), false);

    EmailTemplate.create = origCreate;
    EmailTemplate.updateMany = origUpdateMany;
    EmailTemplate.findById = origFindById;
    EmailTemplate.findByIdAndDelete = origFindByIdAndDelete;
  });

  it('sends emails using default .html template files when no custom DB template is active', async () => {
    const { sendAccountCreatedEmail, sendPasswordResetEmail } = await import(
      '../src/utils/mail.util.js'
    );

    const accResult = await sendAccountCreatedEmail({
      email: 'testuser@example.com',
      name: 'Test User',
      employeeId: 'MOR/ENG/999',
      password: 'Password123!',
      role: 'employee',
      departmentName: 'Engineering',
      ipAddress: '127.0.0.1',
      senderUserName: 'Super Admin',
    });
    assert.ok(accResult.messageId.startsWith('mock-test-message-id-'));

    const resetResult = await sendPasswordResetEmail(
      'testuser@example.com',
      'token-xyz',
      'localhost:3000',
      { ipAddress: '127.0.0.1' }
    );
    assert.ok(resetResult.messageId.startsWith('mock-test-message-id-'));
  });
});
