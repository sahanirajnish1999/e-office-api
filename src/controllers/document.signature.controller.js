import mongoose from 'mongoose';
import { DocumentSignature } from '../models/document.signature.model.js';
import { Document } from '../models/document.model.js';
import { recordDocumentLog } from '../utils/document.logger.js';
import { sendSignatureOtpEmail } from '../utils/mail.util.js';
import { isValidObjectId } from '../utils/validator.util.js';

/**
 * 1. Request Digital Signature (POST /api/documents/:id/signatures/request)
 * Records IP and Device, generates 6-digit OTP, and emails it to the user.
 */
export const requestSignature = async (req, res, next) => {
  try {
    const documentId = req.params.id;
    if (!documentId || !isValidObjectId(documentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID format',
      });
    }

    const document = await Document.findById(documentId);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found',
      });
    }

    // Capture user's current network IP and Device / User-Agent
    const ipAddress =
      req.headers['x-forwarded-for']?.split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      req.ip ||
      '';

    const device = req.headers['user-agent'] || 'Unknown Device';

    // Generate secure 6-digit numeric OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    const signature = await DocumentSignature.create({
      documentId: document._id,
      userId: req.user.id,
      ipAddress,
      device,
      isVerified: false,
      status: 'pending',
      otp,
      otpExpiresAt,
    });

    // Send OTP to user's registered email
    const recipientEmail = req.user.email;
    await sendSignatureOtpEmail(recipientEmail, otp, document.title).catch((err) => {
      console.warn('Failed to send signature OTP email:', err.message);
    });

    await recordDocumentLog({
      fileId: document._id,
      fileNumber: document.fileNumber || '',
      user: req.user,
      action: 'Signature OTP Requested',
      details: `Digital signature requested by ${req.user.name || req.user.email} from IP: ${ipAddress}`,
      req,
    });

    res.status(201).json({
      success: true,
      message: 'Verification OTP has been sent to your registered email address.',
      data: {
        signatureId: signature._id,
        documentId: document._id,
        ipAddress,
        device,
        isVerified: false,
        status: 'pending',
        expiresInMinutes: 10,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 2. Verify Signature OTP (POST /api/documents/:id/signatures/:sigId/verify-otp)
 * Verifies the 6-digit OTP, marks isVerified: true, and sets signedAt timestamp.
 */
export const verifySignatureOtp = async (req, res, next) => {
  try {
    const { id: documentId, sigId } = req.params;
    const { otp } = req.body;

    if (!sigId || !isValidObjectId(sigId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid signature ID format',
      });
    }

    if (!otp || typeof otp !== 'string' || !otp.trim()) {
      return res.status(400).json({
        success: false,
        message: '6-digit OTP is required',
      });
    }

    const signature = await DocumentSignature.findOne({
      _id: sigId,
      documentId,
    });

    if (!signature) {
      return res.status(404).json({
        success: false,
        message: 'Signature record not found for this document',
      });
    }

    if (signature.userId.toString() !== req.user.id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only verify your own signature request',
      });
    }

    if (signature.isVerified) {
      return res.status(400).json({
        success: false,
        message: 'This digital signature has already been verified',
      });
    }

    if (signature.otpExpiresAt && signature.otpExpiresAt < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new signature verification code',
      });
    }

    if (signature.otp !== otp.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP code. Please enter the correct code from your email',
      });
    }

    // Mark verified and set signedAt timestamp
    signature.isVerified = true;
    signature.signedAt = new Date();
    signature.otp = undefined;
    signature.otpExpiresAt = undefined;
    await signature.save();

    await recordDocumentLog({
      fileId: signature.documentId,
      user: req.user,
      action: 'Signature OTP Verified',
      details: `Digital signature verified via OTP by ${req.user.name || req.user.email}. Awaiting administrative approval.`,
      req,
    });

    res.status(200).json({
      success: true,
      message: 'Digital signature verified successfully via OTP. Awaiting admin review and approval.',
      data: signature,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 3. Admin Review Signature (PATCH /api/documents/:id/signatures/:sigId/review)
 * Super Admin or Department Admin approves or rejects the verified signature.
 */
export const reviewSignature = async (req, res, next) => {
  try {
    const { id: documentId, sigId } = req.params;
    const { status, rejectionReason } = req.body;

    if (!sigId || !isValidObjectId(sigId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid signature ID format',
      });
    }

    const validDecisions = ['approve', 'reject'];
    if (!status || !validDecisions.includes(status.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "Status must be either 'approve' or 'reject'",
      });
    }

    const signature = await DocumentSignature.findOne({
      _id: sigId,
      documentId,
    }).populate('userId', 'name email designation departmentId');

    if (!signature) {
      return res.status(404).json({
        success: false,
        message: 'Signature record not found',
      });
    }

    if (!signature.isVerified) {
      return res.status(400).json({
        success: false,
        message: 'Cannot review or approve a signature that has not completed email OTP verification',
      });
    }

    const decision = status.toLowerCase();
    signature.status = decision;
    signature.approvedBy = req.user.id;
    signature.approvedAt = new Date();

    if (decision === 'reject') {
      signature.rejectionReason = (rejectionReason || 'Rejected by reviewing authority').trim();
    } else {
      signature.rejectionReason = '';
    }

    await signature.save();

    await recordDocumentLog({
      fileId: signature.documentId,
      user: req.user,
      action: decision === 'approve' ? 'Signature Approved' : 'Signature Rejected',
      details: `Digital signature for ${signature.userId?.name || signature.userId?.email} marked as '${decision}' by ${req.user.name || req.user.email}${decision === 'reject' ? ` (Reason: ${signature.rejectionReason})` : ''}`,
      req,
    });

    res.status(200).json({
      success: true,
      message: `Digital signature ${decision === 'approve' ? 'approved' : 'rejected'} successfully`,
      data: signature,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 4. List All Signatures for a Document (GET /api/documents/:id/signatures)
 */
export const getDocumentSignatures = async (req, res, next) => {
  try {
    const documentId = req.params.id;
    if (!documentId || !isValidObjectId(documentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid document ID format',
      });
    }

    const signatures = await DocumentSignature.find({ documentId })
      .populate('userId', 'name email designation employeeId departmentId')
      .populate('approvedBy', 'name email designation')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: signatures,
    });
  } catch (error) {
    next(error);
  }
};

export default {
  requestSignature,
  verifySignatureOtp,
  reviewSignature,
  getDocumentSignatures,
};
