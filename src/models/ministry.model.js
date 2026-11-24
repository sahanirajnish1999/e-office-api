import mongoose from 'mongoose';

const ministrySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Ministry name is required'],
      unique: true,
      trim: true,
      minlength: [2, 'Ministry name must be at least 2 characters'],
    },
    code: {
      type: String,
      required: [true, 'Ministry code is required'],
      unique: true,
      uppercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    headOfMinistry: {
      type: String,
      trim: true,
      default: '',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Index for fast sorting and querying
ministrySchema.index({ code: 1, name: 1 });
ministrySchema.index({ createdAt: -1 });

export const Ministry = mongoose.model('Ministry', ministrySchema);
export default Ministry;
