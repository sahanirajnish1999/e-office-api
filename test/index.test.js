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
import { getPaginationParams, formatPaginatedResponse } from '../src/utils/pagination.util.js';
import { checkPermission } from '../src/middlewares/permission.middleware.js';
import { sendAccountCreatedEmail } from '../src/utils/mail.util.js';
import { moveToDocumentFolder, removeDocumentFolder } from '../src/utils/file.util.js';
import { listDepartments, updateDepartment, deleteDepartment } from '../src/controllers/department.controller.js';
import { listUsers, getUserCounts, updateLastActiveTime } from '../src/controllers/user.controller.js';

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
});
