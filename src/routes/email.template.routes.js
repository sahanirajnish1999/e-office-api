import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { authorizeRoles } from '../middlewares/role.middleware.js';
import {
  getTemplateVariablesAndDefaults,
  createEmailTemplate,
  listEmailTemplates,
  getEmailTemplateById,
  updateEmailTemplate,
  activateEmailTemplate,
  previewEmailTemplate,
  sendTestTemplateEmail,
  deleteEmailTemplate,
} from '../controllers/email.template.controller.js';

const router = Router();

const htmlUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 }, // 512 KB max for email HTML templates
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const isHtmlMime =
      file.mimetype === 'text/html' || file.mimetype === 'application/xhtml+xml';
    if (ext === '.html' || ext === '.htm' || isHtmlMime) {
      return cb(null, true);
    }
    const err = new Error('Only .html or .htm template files are allowed');
    err.statusCode = 400;
    return cb(err);
  },
});

router.use(authenticateToken, authorizeRoles('super_admin'));

router.get('/variables', getTemplateVariablesAndDefaults);
router.post('/', htmlUpload.single('templateFile'), createEmailTemplate);
router.get('/', listEmailTemplates);
router.get('/:id', getEmailTemplateById);
router.put('/:id', htmlUpload.single('templateFile'), updateEmailTemplate);
router.patch('/:id/activate', activateEmailTemplate);
router.post('/:id/preview', previewEmailTemplate);
router.post('/:id/send-test', sendTestTemplateEmail);
router.delete('/:id', deleteEmailTemplate);

export default router;
