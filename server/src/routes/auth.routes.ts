import { Router } from 'express';
import {
  completeAccountSetup,
  completeAccountSetupSchema,
  forgotPassword,
  forgotPasswordSchema,
  getProfile,
  getSession,
  googleCallback,
  googleLogin,
  googleRedirect,
  googleSchema,
  login,
  loginSchema,
  logout,
  refresh,
  refreshSchema,
  register,
  registerSchema,
  resetPassword,
  resetPasswordSchema,
  verifyEmail,
  verifyEmailSchema,
} from '../controllers/auth.controller';
import { authenticate, optionalAuthenticate, requireAccountSetupComplete } from '../middleware/auth';
import { authLimiter, refreshLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';

const router = Router();

router.get('/session', optionalAuthenticate, getSession);
router.post('/register', authLimiter, validate(registerSchema), register);
router.post('/login', authLimiter, validate(loginSchema), login);
router.post('/google', authLimiter, validate(googleSchema), googleLogin);
router.get('/google', authLimiter, googleRedirect);
router.get('/google/callback', authLimiter, googleCallback);
router.post('/verify-email', authLimiter, validate(verifyEmailSchema), verifyEmail);
router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', authLimiter, validate(resetPasswordSchema), resetPassword);
router.post('/refresh', refreshLimiter, validate(refreshSchema), refresh);
router.post('/logout', authenticate, logout);
router.get('/profile', authenticate, requireAccountSetupComplete, getProfile);
router.post(
  '/complete-account-setup',
  authenticate,
  validate(completeAccountSetupSchema),
  completeAccountSetup,
);

export default router;
