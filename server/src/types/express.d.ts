import { IUser, UserRole } from '../models/User';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      sessionId?: string;
      userRole?: UserRole;
      user?: IUser;
    }
  }
}

export {};
