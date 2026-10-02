import * as bcrypt from 'bcryptjs';
import mongoose, { Document, Model, Schema } from 'mongoose';

/** Legacy values remain readable; canonical roles: superAdmin, admin (college), student. */
export type UserRole =
  | 'superAdmin'
  | 'admin'
  | 'student'
  | 'institutionAdmin'
  | 'recruiter'
  | 'candidate';
export type AuthProvider = 'email' | 'google';

export type TerminationReasonType =
  | 'policy_violation'
  | 'academic'
  | 'misconduct'
  | 'voluntary'
  | 'other';

export interface ITerminationEvent {
  reason: string;
  reasonType?: TerminationReasonType;
  terminatedBy: mongoose.Types.ObjectId;
  terminatedAt: Date;
  notes?: string;
  reactivatedAt?: Date;
  reactivatedBy?: mongoose.Types.ObjectId;
}

export interface IUser extends Document {
  name: string;
  username?: string;
  email: string;
  password?: string;
  level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  role: UserRole;
  authProvider: AuthProvider;
  googleId?: string;
  isEmailVerified: boolean;
  isActive: boolean;
  deactivatedAt?: Date | null;
  authMetadata: {
    lastLoginAt?: Date;
    passwordChangedAt?: Date;
    failedLoginAttempts: number;
    lockUntil?: Date;
  };
  totalSessions: number;
  averageScore: number;
  streak: number;
  phone?: string;
  /** Denormalized institution name (display + legacy queries). Students: home college. Admins: primary label. */
  institution?: string;
  /** Students: home institution. Legacy college admins: single assignment (prefer assignedInstitutionIds). */
  institutionId?: mongoose.Types.ObjectId;
  /** College admins: institutions this account may access (multi-college scope). */
  assignedInstitutionIds?: mongoose.Types.ObjectId[];
  batch?: string;
  branch?: string;
  preferredLanguage: 'English' | 'Telugu' | 'Hindi';
  companySelectorRecentCompanies: string[];
  requiresAccountSetup: boolean;
  terminationHistory: ITerminationEvent[];
  skills: {
    listening: number;
    speaking: number;
    reading: number;
    writing: number;
  };
  profileImageUrl?: string;
  comparePassword(password: string): Promise<boolean>;
}

interface UserModel extends Model<IUser> {}

const terminationEventSchema = new Schema<ITerminationEvent>(
  {
    reason: { type: String, required: true, trim: true, maxlength: 2000 },
    reasonType: {
      type: String,
      enum: ['policy_violation', 'academic', 'misconduct', 'voluntary', 'other'],
      default: 'other',
    },
    terminatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    terminatedAt: { type: Date, required: true, default: Date.now },
    notes: { type: String, trim: true, maxlength: 4000 },
    reactivatedAt: Date,
    reactivatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: true },
);

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    username: { type: String, unique: true, sparse: true, lowercase: true, trim: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    password: { type: String, select: false },
    level: { type: String, enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], default: 'B1' },
    role: {
      type: String,
      enum: [
        'superAdmin',
        'institutionAdmin',
        'student',
        'admin',
        'recruiter',
        'candidate',
      ],
      default: 'student',
      index: true,
    },
    authProvider: { type: String, enum: ['email', 'google'], default: 'email' },
    googleId: { type: String, index: true, sparse: true },
    isEmailVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    deactivatedAt: { type: Date, default: null },
    authMetadata: {
      lastLoginAt: Date,
      passwordChangedAt: Date,
      failedLoginAttempts: { type: Number, default: 0 },
      lockUntil: Date,
    },
    totalSessions: { type: Number, default: 0 },
    averageScore: { type: Number, default: 0 },
    streak: { type: Number, default: 0 },
    phone: { type: String, trim: true, default: '' },
    institution: { type: String, trim: true, default: '', index: true },
    institutionId: { type: Schema.Types.ObjectId, ref: 'Institution', index: true, sparse: true },
    assignedInstitutionIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Institution' }],
      default: [],
      index: true,
    },
    batch: { type: String, trim: true, default: '', index: true },
    branch: { type: String, trim: true, default: '', index: true },
    preferredLanguage: { type: String, enum: ['English', 'Telugu', 'Hindi'], default: 'English' },
    companySelectorRecentCompanies: { type: [String], default: [] },
    requiresAccountSetup: { type: Boolean, default: false, index: true },
    terminationHistory: { type: [terminationEventSchema], default: [] },
    skills: {
      listening: { type: Number, default: 0 },
      speaking: { type: Number, default: 0 },
      reading: { type: Number, default: 0 },
      writing: { type: Number, default: 0 },
    },
    profileImageUrl: String,
  },
  { timestamps: true },
);

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password') || !this.password) {
    return next();
  }

  this.password = await bcrypt.hash(this.password, 12);
  this.authMetadata.passwordChangedAt = new Date();
  next();
});

userSchema.methods.comparePassword = async function comparePassword(password: string) {
  if (!this.password) {
    return false;
  }

  return bcrypt.compare(password, this.password);
};

export const User =
  (mongoose.models.User as UserModel | undefined) ??
  mongoose.model<IUser, UserModel>('User', userSchema);
