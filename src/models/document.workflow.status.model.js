import mongoose from 'mongoose';

const VALID_STATUSES = ['draft', 'back', 'approve', 'sent', 'receive'];

const documentWorkflowStatusSchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: [true, 'Document ID is required'],
      index: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Employee ID is required'],
      index: true,
    },
    status: {
      type: String,
      required: [true, 'Status is required'],
      enum: {
        values: VALID_STATUSES,
        message: 'Status must be one of: draft, back, approve, sent, receive',
      },
      lowercase: true,
      trim: true,
      index: true,
    },
    statusUpdateTime: {
      type: Date,
      default: Date.now,
      index: true,
    },
    remarks: {
      type: String,
      trim: true,
      default: '',
      maxlength: [1000, 'Remarks cannot exceed 1000 characters'],
    },
    isCurrent: {
      type: Boolean,
      default: true,
      index: true,
    },
    isPhysicalFileReceived: {
      type: Boolean,
      default: false,
      index: true,
    },
    physicalFileReceivedTime: {
      type: Date,
      default: null,
      index: true,
    },
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound Indexes for fast querying
documentWorkflowStatusSchema.index({ documentId: 1, isCurrent: 1 });
documentWorkflowStatusSchema.index({ employeeId: 1, statusUpdateTime: -1 });
documentWorkflowStatusSchema.index({ documentId: 1, statusUpdateTime: -1 });

export const DocumentWorkflowStatus = mongoose.model(
  'DocumentWorkflowStatus',
  documentWorkflowStatusSchema
);
export { VALID_STATUSES };
export default DocumentWorkflowStatus;
