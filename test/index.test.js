import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
import { uploadDocumentFile, getDocumentFiles, reviewDocumentFile, deleteDocumentFile } from '../src/controllers/document.file.controller.js';
import { createVirtualSticky, getVirtualStickies, updateVirtualSticky, deleteVirtualSticky } from '../src/controllers/virtual.sticky.controller.js';
import { getPaginationParams, formatPaginatedResponse } from '../src/utils/pagination.util.js';
import { checkPermission } from '../src/middlewares/permission.middleware.js';
import { sendAccountCreatedEmail, sendSignatureOtpEmail } from '../src/utils/mail.util.js';
import { moveToDocumentFolder, removeDocumentFolder } from '../src/utils/file.util.js';
import { listDepartments, updateDepartment, deleteDepartment } from '../src/controllers/department.controller.js';
import { listUsers, getUserCounts, updateLastActiveTime } from '../src/controllers/user.controller.js';
import { getAllDocumentLogs } from '../src/controllers/document.controller.js';
import { generateNextEmployeeId, createEmployee } from '../src/controllers/employee.controller.js';
import { createDepartmentAdmin } from '../src/controllers/user.controller.js';
import { isValidEmail, normalizeEmail, isValidPhone, normalizePhone, isValidObjectId } from '../src/utils/validator.util.js';
import { generateNextFileNumber } from '../src/utils/document.util.js';

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

  it('should validate DocumentForward model schema definition', () => {
    const fwdPaths = Object.keys(DocumentForward.schema.paths);
    assert.ok(fwdPaths.includes('documentId'));
    assert.ok(fwdPaths.includes('fromDepartmentId'));
    assert.ok(fwdPaths.includes('targetDepartmentId'));
    assert.ok(fwdPaths.includes('forwardedBy'));
    assert.ok(fwdPaths.includes('priority'));
    assert.ok(fwdPaths.includes('accessControl'));
    assert.ok(fwdPaths.includes('forwardedAt'));
    assert.ok(fwdPaths.includes('isDeletedForDept'));
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
});
