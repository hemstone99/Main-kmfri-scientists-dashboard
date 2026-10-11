import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ShieldCheck,
  Eye,
  EyeOff,
  Lock,
  Mail,
  User,
  Hash,
  UserPlus,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Sun,
  Moon,
  Loader2,
  ArrowLeft,
  RefreshCw,
} from 'lucide-react';
import { DatabaseState, User as UserModel } from '../types/kmfri.ts';
import {
  generateUuid,
  hashPasswordAsync,
  verifyPasswordAsync,
  sanitizeSecurityInput,
  getRoleByName,
  appendAuditLog,
} from '../services/database.ts';
import { KmfriLogo } from './KmfriLogo.tsx';
import heroVesselImage from '../assets/images/kmfri_marine_research_vessel_1791548503334.jpg';

interface AuthGatewayProps {
  db: DatabaseState;
  onUpdateDb: (next: DatabaseState) => void;
  onAuthenticated: (user: UserModel) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

interface PasswordStrengthResult {
  score: number; // 0..4
  label: string;
  colorClass: string;
  barColorClass: string;
  checks: {
    minLength: boolean;
    hasMixedCase: boolean;
    hasNumber: boolean;
    hasSpecial: boolean;
  };
}

function evaluatePasswordStrength(pwd: string): PasswordStrengthResult {
  const checks = {
    minLength: pwd.length >= 8,
    hasMixedCase: /[a-z]/.test(pwd) && /[A-Z]/.test(pwd),
    hasNumber: /\d/.test(pwd),
    hasSpecial: /[^A-Za-z0-9]/.test(pwd),
  };

  const passed = Object.values(checks).filter(Boolean).length;

  if (!pwd) {
    return {
      score: 0,
      label: 'Enter a strong password',
      colorClass: 'text-[#68768A] dark:text-slate-400',
      barColorClass: 'bg-slate-200 dark:bg-slate-800',
      checks,
    };
  }
  if (!checks.minLength || passed <= 1) {
    return {
      score: 1,
      label: 'Weak — minimum 8 characters required',
      colorClass: 'text-red-600 dark:text-red-400',
      barColorClass: 'bg-red-500',
      checks,
    };
  }
  if (passed === 2) {
    return {
      score: 2,
      label: 'Fair — add numbers or symbols',
      colorClass: 'text-amber-600 dark:text-amber-400',
      barColorClass: 'bg-amber-500',
      checks,
    };
  }
  if (passed === 3) {
    return {
      score: 3,
      label: 'Good — strong institutional credential',
      colorClass: 'text-[#3155A4] dark:text-sky-400',
      barColorClass: 'bg-[#3155A4]',
      checks,
    };
  }
  return {
    score: 4,
    label: 'Excellent — high-entropy security standard',
    colorClass: 'text-[#16866B] dark:text-emerald-400',
    barColorClass: 'bg-[#16866B]',
    checks,
  };
}

export const AuthGateway: React.FC<AuthGatewayProps> = ({
  db,
  onUpdateDb,
  onAuthenticated,
  darkMode,
  onToggleDarkMode,
}) => {
  // Enforce backend rule: Initial administrator setup is accessible ONLY when no system administrator exists
  const hasExistingAdmin =
    db.isInitializedAdmin ||
    db.users.some((u) => {
      const sysRole = getRoleByName(db, 'system_admin');
      return u.role_id === sysRole.id;
    }) ||
    db.users.length > 0;

  const needsInitialSetup = !hasExistingAdmin;

  const [mode, setMode] = useState<'login' | 'setup' | 'reset'>(
    needsInitialSetup ? 'setup' : 'login'
  );

  // Regular Login form state (supports Institutional Email OR Staff Number)
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // Initial System Administrator Setup state (overall system controller — no directorate assignment)
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminStaffNo, setAdminStaffNo] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);

  // Field-level inline validation touched states
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [loginCooldownUntil, setLoginCooldownUntil] = useState<number>(0);

  // Password recovery state (3-Step OTP Verification -> Change Password)
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetStep, setResetStep] = useState<'request_otp' | 'verify_otp' | 'change_password'>('request_otp');
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [newResetPassword, setNewResetPassword] = useState('');
  const [confirmResetPassword, setConfirmResetPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetMaskedEmail, setResetMaskedEmail] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const enteredToken = otpDigits.join('');

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Keep mode synchronized if initial setup is already completed
  React.useEffect(() => {
    if (hasExistingAdmin && mode === 'setup') {
      setMode('login');
    } else if (!hasExistingAdmin && mode === 'login') {
      setMode('setup');
    }
  }, [hasExistingAdmin, mode]);

  const adminPasswordStrength = useMemo(
    () => evaluatePasswordStrength(adminPassword),
    [adminPassword]
  );

  const resetPasswordStrength = useMemo(
    () => evaluatePasswordStrength(newResetPassword),
    [newResetPassword]
  );

  const markTouched = (field: string) =>
    setTouched((prev) => ({ ...prev, [field]: true }));

  const handleInitialProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setErrorMsg(null);
    setInfoMsg(null);

    // Security guard: never allow creating a second initial administrator if setup is already complete
    if (hasExistingAdmin) {
      setErrorMsg(
        'Initial System Administrator setup has already been completed. Please sign in with your registered credentials.'
      );
      setMode('login');
      return;
    }

    setTouched({
      adminName: true,
      adminEmail: true,
      adminStaffNo: true,
      adminPassword: true,
    });

    const trimmedName = sanitizeSecurityInput(adminName);
    const trimmedEmail = sanitizeSecurityInput(adminEmail).toLowerCase();
    const trimmedStaffNo = sanitizeSecurityInput(adminStaffNo).toUpperCase();

    if (
      !trimmedName ||
      !trimmedEmail ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail) ||
      !trimmedStaffNo ||
      adminPassword.length < 8
    ) {
      setErrorMsg(
        'Please complete all required fields: full name, valid institutional email, unique staff number, and a password of at least 8 characters.'
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const now = new Date().toISOString();
      const sysAdminRole = getRoleByName(db, 'system_admin');
      const passwordHash = await hashPasswordAsync(adminPassword);

      const sysAdminUser: UserModel = {
        id: generateUuid(),
        full_name: trimmedName,
        email: trimmedEmail,
        phone: '',
        password_hash: passwordHash,
        staff_number: trimmedStaffNo,
        profile_photo: '',
        position: 'Overall System Administrator',
        directorate_id: null,
        research_area_id: null,
        role_id: sysAdminRole.id,
        account_status: 'Active',
        failed_login_attempts: 0,
        last_login: now,
        created_at: now,
        updated_at: now,
      };

      const adminProfile = {
        id: generateUuid(),
        user_id: sysAdminUser.id,
        specialization: 'Institutional Systems Governance & Access Control',
        academic_rank: 'System Administrator',
        qualifications: '',
        biography: '',
        orcid: '',
        phone: '',
        office_location: 'KMFRI Headquarters, Mombasa',
        research_interests: '',
        areas_of_expertise: '',
        years_experience: 0,
        created_at: now,
        updated_at: now,
      };

      let nextState: DatabaseState = {
        ...db,
        isInitializedAdmin: true,
        users: [sysAdminUser],
        researcher_profiles: [adminProfile],
        notifications: [
          {
            id: generateUuid(),
            user_id: sysAdminUser.id,
            title: 'Overall System Administrator Provisioned',
            message:
              'You can now create accounts for the Director General (DG), Heads of the 4 Directorates (OCS, FWS, ARD, SED), Directorate Administrators, and Scientists.',
            type: 'system',
            related_module: 'scientists',
            related_entity_id: null,
            read_at: null,
            created_at: now,
          },
        ],
      };

      nextState = appendAuditLog(
        nextState,
        sysAdminUser,
        'PROVISION_INITIAL_SYSTEM_ADMIN',
        'users',
        sysAdminUser.id,
        null,
        {
          staff_number: sysAdminUser.staff_number,
          email: sysAdminUser.email,
          scope: 'INSTITUTION_WIDE_CONTROLLER',
        }
      );

      setTimeout(() => {
        setIsSubmitting(false);
        onUpdateDb(nextState);
        onAuthenticated(sysAdminUser);
      }, 240);
    } catch (err) {
      console.error('Initial System Administrator provisioning error:', err);
      setIsSubmitting(false);
      setErrorMsg('Failed to provision the initial System Administrator. Please try again.');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setErrorMsg(null);
    setInfoMsg(null);

    setTouched({ identifier: true, password: true });

    if (Date.now() < loginCooldownUntil) {
      const waitSec = Math.ceil((loginCooldownUntil - Date.now()) / 1000);
      setErrorMsg(
        `Brute-Force Protection Active: Please wait ${waitSec}s before attempting another sign-in.`
      );
      return;
    }

    const cleanIdentifier = sanitizeSecurityInput(identifier);
    if (!cleanIdentifier || !password) {
      setErrorMsg('Please enter your institutional email or staff number and password.');
      return;
    }

    setIsSubmitting(true);

    try {
      const normalizedLower = cleanIdentifier.toLowerCase();
      const normalizedUpper = cleanIdentifier.toUpperCase();

      const user = db.users.find(
        (u) =>
          u.email.toLowerCase() === normalizedLower ||
          u.staff_number.toUpperCase() === normalizedUpper
      );

      if (!user) {
        setLoginCooldownUntil(Date.now() + 3000);
        const next = appendAuditLog(
          db,
          null,
          'AUTH_LOGIN_FAILED_UNKNOWN_USER',
          'users',
          cleanIdentifier,
          null,
          { identifier: cleanIdentifier }
        );
        onUpdateDb(next);
        setIsSubmitting(false);
        setErrorMsg('Invalid institutional credentials. Please verify your email/staff number and password.');
        return;
      }

      if (user.account_status !== 'Active') {
        setIsSubmitting(false);
        setErrorMsg(
          `Your account status is currently ${user.account_status}. Please contact the KMFRI System Administrator.`
        );
        return;
      }

      if (user.failed_login_attempts >= 5) {
        setIsSubmitting(false);
        setErrorMsg(
          'Account locked due to 5 consecutive failed sign-in attempts. Use 2FA password recovery or contact the System Administrator.'
        );
        return;
      }

      const isValid = await verifyPasswordAsync(password, user.password_hash);
      if (!isValid) {
        const nextAttempts = user.failed_login_attempts + 1;
        setLoginCooldownUntil(Date.now() + nextAttempts * 2000);
        const updatedUsers = db.users.map((u) =>
          u.id === user.id
            ? {
                ...u,
                failed_login_attempts: nextAttempts,
                account_status:
                  nextAttempts >= 5 ? ('Locked' as const) : u.account_status,
              }
            : u
        );
        const next = appendAuditLog(
          { ...db, users: updatedUsers },
          user,
          'AUTH_LOGIN_FAILED_BAD_PASSWORD',
          'users',
          user.id,
          { failed_attempts: user.failed_login_attempts },
          { failed_attempts: nextAttempts }
        );
        onUpdateDb(next);
        setIsSubmitting(false);
        setErrorMsg(
          `Invalid institutional credentials (${Math.max(0, 5 - nextAttempts)} attempt(s) remaining before automatic account lockout).`
        );
        return;
      }

      const now = new Date().toISOString();
      // Automatically upgrade legacy hash to bcrypt on verified login
      const upgradedHash = user.password_hash.startsWith('$2b$')
        ? user.password_hash
        : await hashPasswordAsync(password);

      const updatedUser: UserModel = {
        ...user,
        password_hash: upgradedHash,
        failed_login_attempts: 0,
        last_login: now,
      };

      const updatedUsers = db.users.map((u) => (u.id === user.id ? updatedUser : u));
      const next = appendAuditLog(
        { ...db, users: updatedUsers, csrfToken: generateUuid() },
        updatedUser,
        'AUTH_LOGIN_SUCCESS',
        'users',
        updatedUser.id,
        null,
        { remember_me: rememberMe, last_login: now }
      );
      setIsSubmitting(false);
      onUpdateDb(next);
      onAuthenticated(updatedUser);
    } catch (err) {
      console.error('Login error:', err);
      setIsSubmitting(false);
      setErrorMsg('An error occurred during login. Please try again.');
    }
  };

  const dispatchOtpToRegisteredUser = async () => {
    const clean = resetIdentifier.trim();
    const target = db.users.find(
      (u) =>
        u.email.toLowerCase() === clean.toLowerCase() ||
        u.staff_number.toUpperCase() === clean.toUpperCase()
    );

    if (!target) {
      setErrorMsg(
        'No registered KMFRI account found matching that institutional email or staff number.'
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const resp = await fetch('/api/auth/send-2fa-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: target.email,
          fullName: target.full_name,
          staffNumber: target.staff_number,
          purpose: 'Forgot Password OTP Verification',
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Failed to send OTP verification email.');
      }

      setResetMaskedEmail(data.maskedEmail || target.email);
      setOtpDigits(['', '', '', '', '', '']);
      setResetStep('verify_otp');
      setResendCooldown(30);
      setInfoMsg(
        data.message ||
          `A 6-digit OTP verification code has been sent to ${target.email}. Please enter it below to verify your identity.`
      );
      const next = appendAuditLog(
        db,
        target,
        'AUTH_FORGOT_PASSWORD_OTP_ISSUED',
        'users',
        target.id,
        null,
        { email: target.email, expires_in_minutes: 10 }
      );
      onUpdateDb(next);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to send OTP email verification code.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestResetToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    await dispatchOtpToRegisteredUser();
  };

  const handleOtpDigitChange = (index: number, value: string) => {
    const numeric = value.replace(/\D/g, '');
    if (!numeric) {
      const next = [...otpDigits];
      next[index] = '';
      setOtpDigits(next);
      return;
    }
    // Support pasting or typing multiple digits
    if (numeric.length > 1) {
      const chars = numeric.slice(0, 6).split('');
      const next = [...otpDigits];
      for (let i = 0; i < 6; i++) {
        next[i] = chars[i] || '';
      }
      setOtpDigits(next);
      const focusIdx = Math.min(5, chars.length - 1);
      otpInputRefs.current[focusIdx]?.focus();
      return;
    }
    const next = [...otpDigits];
    next[index] = numeric;
    setOtpDigits(next);
    if (index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const next = ['', '', '', '', '', ''];
    for (let i = 0; i < pasted.length; i++) {
      next[i] = pasted[i];
    }
    setOtpDigits(next);
    const focusIdx = Math.min(5, pasted.length - 1);
    otpInputRefs.current[focusIdx]?.focus();
  };

  const handleVerifyResetOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setErrorMsg(null);
    setInfoMsg(null);

    const code = enteredToken.trim();
    if (code.length !== 6) {
      setErrorMsg('Please enter all 6 digits of the OTP verification code sent to your email.');
      return;
    }

    const clean = resetIdentifier.trim();
    const target = db.users.find(
      (u) =>
        u.email.toLowerCase() === clean.toLowerCase() ||
        u.staff_number.toUpperCase() === clean.toUpperCase()
    );
    if (!target) {
      setErrorMsg('Registered account could not be found.');
      return;
    }

    setIsSubmitting(true);
    try {
      const resp = await fetch('/api/auth/verify-2fa-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: target.email,
          code,
          consume: false,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.verified) {
        setErrorMsg(data.error || 'Invalid or expired 6-digit OTP verification code.');
        setIsSubmitting(false);
        return;
      }

      setIsSubmitting(false);
      setResetStep('change_password');
      setInfoMsg(
        'OTP verified! You may now set and confirm your new KMFRI account password below.'
      );
    } catch (err) {
      setIsSubmitting(false);
      setErrorMsg(err instanceof Error ? err.message : 'OTP verification failed.');
    }
  };

  const handleCompleteReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setErrorMsg(null);

    if (enteredToken.trim().length !== 6) {
      setErrorMsg('OTP code is missing. Please verify your 6-digit OTP first.');
      setResetStep('verify_otp');
      return;
    }
    if (newResetPassword.length < 8) {
      setErrorMsg('New password must be at least 8 characters long.');
      return;
    }
    if (newResetPassword !== confirmResetPassword) {
      setErrorMsg('New password and confirmation password do not match.');
      return;
    }

    const clean = resetIdentifier.trim();
    const target = db.users.find(
      (u) =>
        u.email.toLowerCase() === clean.toLowerCase() ||
        u.staff_number.toUpperCase() === clean.toUpperCase()
    );
    if (!target) return;

    setIsSubmitting(true);
    try {
      const resp = await fetch('/api/auth/verify-2fa-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: target.email,
          code: enteredToken.trim(),
          consume: true,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.verified) {
        setErrorMsg(data.error || 'Invalid or expired 6-digit OTP verification code.');
        setIsSubmitting(false);
        return;
      }

      const newHash = await hashPasswordAsync(newResetPassword);
      const updatedUsers = db.users.map((u) =>
        u.id === target.id
          ? {
              ...u,
              password_hash: newHash,
              failed_login_attempts: 0,
              account_status: 'Active' as const,
              updated_at: new Date().toISOString(),
            }
          : u
      );
      const next = appendAuditLog(
        { ...db, users: updatedUsers },
        target,
        'AUTH_PASSWORD_RESET_OTP_COMPLETED',
        'users',
        target.id,
        null,
        { status: 'OTP verified via email and password hash updated' }
      );
      onUpdateDb(next);
      setIsSubmitting(false);
      setResetStep('request_otp');
      setOtpDigits(['', '', '', '', '', '']);
      setNewResetPassword('');
      setConfirmResetPassword('');
      setMode('login');
      setIdentifier(target.email);
      setPassword('');
      setInfoMsg(
        'Your OTP was verified and your password has been changed! Please sign in with your new password.'
      );
    } catch (err) {
      setIsSubmitting(false);
      setErrorMsg(err instanceof Error ? err.message : 'Password update failed.');
    }
  };

  // Inline field validation messages
  const adminEmailInvalid =
    touched.adminEmail &&
    (!adminEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail.trim()));
  const adminNameInvalid = touched.adminName && !adminName.trim();
  const adminStaffInvalid = touched.adminStaffNo && !adminStaffNo.trim();
  const adminPwdInvalid = touched.adminPassword && adminPassword.length < 8;

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div className="min-h-screen w-full flex flex-col lg:flex-row bg-[#F6F8FC] dark:bg-[#070E1A] text-[#17243A] dark:text-slate-100 transition-colors duration-300 overflow-x-hidden">
        {/* Left Panel (58% on Desktop, Compact Banner on Mobile/Tablet) — Marine Research Showcase */}
        <section
          aria-label="KMFRI Marine Research Showcase"
          className="kmfri-hero-showcase relative w-full lg:w-[58%] min-h-[240px] sm:min-h-[320px] lg:min-h-screen flex flex-col justify-between p-4 sm:p-8 lg:px-14 lg:py-12 overflow-hidden select-none shrink-0"
        >
          {/* High-Resolution Marine Research Vessel Background with Sharp Rendering & Gentle Zoom */}
          <div className="absolute inset-0 z-0 overflow-hidden bg-[#0A1E3F]">
            <img
              src={heroVesselImage}
              alt="KMFRI Oceanographic Research Vessel conducting hydrographic sampling in Mombasa coastal waters"
              referrerPolicy="no-referrer"
              className="kmfri-hero-image-zoom w-full h-full object-cover object-center brightness-[1.04] contrast-[1.06] saturate-[1.08]"
            />
            {/* Refined Multi-Stop Deep Ocean Blue (#173B75) & Marine Teal (#159A9C) Vignette for Photographic Clarity */}
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgba(7, 20, 42, 0.78) 0%, rgba(14, 35, 71, 0.28) 28%, rgba(14, 35, 71, 0.22) 52%, rgba(10, 29, 59, 0.86) 80%, rgba(6, 17, 36, 0.97) 100%)',
              }}
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  'radial-gradient(circle at 16% 86%, rgba(21, 154, 156, 0.32) 0%, transparent 52%), radial-gradient(circle at 85% 12%, rgba(49, 85, 164, 0.28) 0%, transparent 48%)',
              }}
            />
          </div>

          {/* Decorative Marine Wave Contour Pattern at TOP of the Image (Mirrors the Bottom Wave) */}
          <svg
            className="absolute top-0 left-0 right-0 w-full h-20 sm:h-28 lg:h-36 text-white/[0.07] pointer-events-none z-0"
            viewBox="0 0 1440 160"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M0,64L60,69.3C120,75,240,85,360,80C480,75,600,53,720,48C840,43,960,53,1080,69.3C1200,85,1320,107,1380,117.3L1440,128L1440,0L1380,0C1320,0,1200,0,1080,0C960,0,840,0,720,0C600,0,480,0,360,0C240,0,120,0,60,0L0,0Z"
            />
            <path
              fill="rgba(21, 154, 156, 0.12)"
              d="M0,42L80,53.3C160,64,320,85,480,82.7C640,80,800,53,960,48C1120,43,1280,59,1360,66.7L1440,75L1440,0L0,0Z"
            />
            <path
              fill="none"
              stroke="rgba(21, 154, 156, 0.36)"
              strokeWidth="1.5"
              d="M0,36 Q360,72 720,36 T1440,52"
            />
            <path
              fill="none"
              stroke="rgba(255, 255, 255, 0.14)"
              strokeWidth="1"
              d="M0,58 Q360,22 720,58 T1440,38"
            />
          </svg>

          {/* Decorative Marine Wave Contour Pattern at BOTTOM of the Image */}
          <svg
            className="absolute bottom-0 left-0 right-0 w-full h-20 sm:h-28 lg:h-36 text-white/[0.07] pointer-events-none z-0"
            viewBox="0 0 1440 160"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M0,96L60,90.7C120,85,240,75,360,80C480,85,600,107,720,112C840,117,960,107,1080,90.7C1200,75,1320,53,1380,42.7L1440,32L1440,160L1380,160C1320,160,1200,160,1080,160C960,160,840,160,720,160C600,160,480,160,360,160C240,160,120,160,60,160L0,160Z"
            />
            <path
              fill="rgba(21, 154, 156, 0.12)"
              d="M0,118L80,106.7C160,96,320,75,480,77.3C640,80,800,107,960,112C1120,117,1280,101,1360,93.3L1440,85L1440,160L0,160Z"
            />
            <path
              fill="none"
              stroke="rgba(21, 154, 156, 0.36)"
              strokeWidth="1.5"
              d="M0,124 Q360,88 720,124 T1440,108"
            />
            <path
              fill="none"
              stroke="rgba(255, 255, 255, 0.14)"
              strokeWidth="1"
              d="M0,102 Q360,138 720,102 T1440,122"
            />
          </svg>

          {/* Top Brand Crest — Official KMFRI Logo & Institute Name with Architectural Alignment */}
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 pt-0.5 sm:pt-1">
            <div className="inline-flex items-center bg-white/95 backdrop-blur-md px-3 py-2 sm:px-5 sm:py-3 rounded-xl sm:rounded-2xl shadow-[0_16px_38px_-10px_rgba(7,20,42,0.55)] border border-white/80 max-w-full">
              <KmfriLogo compact={false} showSubtitle={true} variant="light" />
            </div>

            <div className="hidden xl:flex flex-col items-end text-right font-mono text-[11px] text-sky-100/85 tracking-wider">
              <span className="font-semibold text-white/95">REPUBLIC OF KENYA</span>
              <span className="text-teal-300/90">4.0547° S, 39.6836° E · MOMBASA HQ</span>
            </div>
          </div>

          {/* Bottom Editorial Showcase Typography — Framed Above the Lower Wave Contour */}
          <div className="relative z-10 max-w-2xl mt-5 sm:mt-8 lg:mt-auto pb-1 sm:pb-4">
            <div className="border-l-[3px] border-[#159A9C] pl-3.5 sm:pl-6 space-y-1.5 sm:space-y-3">
              <div className="flex items-center gap-2 text-[10px] sm:text-xs font-mono uppercase tracking-[0.16em] sm:tracking-[0.2em] text-teal-300 font-semibold">
                <span>National Marine &amp; Fisheries Research Portal</span>
              </div>

              <h1
                className="text-xl sm:text-3xl lg:text-[2.65rem] font-extrabold text-white font-display leading-[1.14] tracking-tight drop-shadow-[0_4px_20px_rgba(7,20,42,0.65)]"
                style={{ textWrap: 'balance' }}
              >
                Scientists &amp; Research{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-sky-100 to-teal-200">
                  Management System
                </span>
              </h1>

              <p className="text-xs sm:text-[15px] font-medium text-sky-100/95 tracking-wide leading-relaxed">
                Kenya Marine and Fisheries Research Institute &middot; Mombasa Headquarters
              </p>
            </div>

            {/* Subtle Unboxed Institutional Domain Bar */}
            <div className="hidden sm:flex mt-4 pt-3.5 border-t border-white/15 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-sky-200/80 tracking-wide">
              <span>Oceanography &amp; Hydrography</span>
              <span aria-hidden="true" className="text-teal-400">·</span>
              <span>Freshwater &amp; Coastal Ecosystems</span>
              <span aria-hidden="true" className="text-teal-400">·</span>
              <span>Aquaculture &amp; Blue Economy</span>
            </div>
          </div>
        </section>

        {/* Right Panel (42% on Desktop) — Soft Pearl White Authentication Workspace */}
        <main className="w-full lg:w-[42%] flex-1 flex flex-col justify-center items-center p-4 sm:p-8 lg:p-12 bg-[#F6F8FC] dark:bg-[#070E1A]">
          <div className="kmfri-auth-card-enter w-full max-w-[460px] bg-white dark:bg-[#0F172A] border border-slate-200/90 dark:border-slate-800 rounded-[20px] sm:rounded-[22px] p-5 sm:p-8 md:p-9 shadow-[0_20px_50px_-15px_rgba(23,36,58,0.09),0_4px_14px_-4px_rgba(23,36,58,0.04)] dark:shadow-[0_20px_50px_-15px_rgba(0,0,0,0.55)]">
            {/* Card Header: Compact KMFRI Logo + Wordmark & Clean Light/Dark Toggle */}
            <div className="pb-4 sm:pb-5 mb-5 sm:mb-6 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <KmfriLogo compact={true} showSubtitle={true} />
              </div>

              <button
                type="button"
                onClick={onToggleDarkMode}
                aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
                title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-[#F6F8FC] dark:bg-slate-800/80 hover:border-[#3155A4] text-xs font-semibold text-[#17243A] dark:text-slate-200 transition-all duration-200 cursor-pointer shrink-0"
              >
                {darkMode ? (
                  <>
                    <Sun className="w-3.5 h-3.5 text-amber-400" />
                    <span>Light</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5 text-[#173B75]" />
                    <span>Dark</span>
                  </>
                )}
              </button>
            </div>

            {/* Accessible Toast / Alert Notifications */}
            {errorMsg && (
              <div
                role="alert"
                className="mb-5 p-3.5 rounded-xl bg-red-50/90 dark:bg-red-950/50 border border-red-200 dark:border-red-800/80 text-red-800 dark:text-red-200 text-xs flex items-start gap-2.5 leading-relaxed break-words"
              >
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {infoMsg && (
              <div
                role="status"
                className="mb-5 p-3.5 rounded-xl bg-[#16866B]/10 dark:bg-emerald-950/50 border border-[#16866B]/30 dark:border-emerald-800/80 text-[#16866B] dark:text-emerald-200 text-xs flex items-start gap-2.5 leading-relaxed font-medium break-words"
              >
                <CheckCircle2 className="w-4 h-4 text-[#16866B] dark:text-emerald-400 shrink-0 mt-0.5" />
                <span>{infoMsg}</span>
              </div>
            )}

            {/* MODE 1: INITIAL SYSTEM ADMINISTRATOR PROVISIONING (Only when no admin exists) */}
            {mode === 'setup' && !hasExistingAdmin && (
              <div>
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#159A9C] dark:text-teal-400 mb-2">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>Welcome to KMFRI Research Management</span>
                </div>

                <h2 className="text-lg sm:text-[1.35rem] font-extrabold text-[#17243A] dark:text-white font-display tracking-tight mb-2">
                  Provision Initial System Administrator
                </h2>
                <p className="text-xs sm:text-[13px] text-[#68768A] dark:text-slate-400 leading-relaxed mb-5 sm:mb-6">
                  As the overall controller of the KMFRI system, your account has institution-wide
                  authority to create accounts for the Director General (DG), Heads of the 4
                  Directorates (OCS, FWS, ARD, SED), and Scientists.
                </p>

                <form onSubmit={handleInitialProvision} noValidate className="space-y-4">
                  {/* Administrator Full Name */}
                  <div>
                    <label
                      htmlFor="kmfri-admin-name"
                      className="block text-xs font-semibold text-[#17243A] dark:text-slate-200 mb-1.5"
                    >
                      Administrator Full Name <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-[#68768A] dark:text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="kmfri-admin-name"
                        type="text"
                        required
                        autoComplete="name"
                        placeholder="Enter administrator full name"
                        value={adminName}
                        onBlur={() => markTouched('adminName')}
                        onChange={(e) => setAdminName(e.target.value)}
                        className={`kmfri-input-field w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border ${
                          adminNameInvalid
                            ? 'border-red-400 dark:border-red-500 bg-red-50/30 dark:bg-red-950/20'
                            : 'border-slate-200 dark:border-slate-700 bg-[#F6F8FC] dark:bg-slate-800/80'
                        } text-[#17243A] dark:text-white focus:bg-white dark:focus:bg-slate-900`}
                      />
                    </div>
                    {adminNameInvalid && (
                      <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                        Administrator full name is required.
                      </p>
                    )}
                  </div>

                  {/* Institutional Email & Staff Number */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label
                        htmlFor="kmfri-admin-email"
                        className="block text-xs font-semibold text-[#17243A] dark:text-slate-200 mb-1.5"
                      >
                        Institutional Email <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-[#68768A] dark:text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          id="kmfri-admin-email"
                          type="email"
                          required
                          autoComplete="email"
                          placeholder="admin@kmfri.go.ke"
                          value={adminEmail}
                          onBlur={() => markTouched('adminEmail')}
                          onChange={(e) => setAdminEmail(e.target.value)}
                          className={`kmfri-input-field w-full pl-10 pr-3.5 py-2.5 text-sm rounded-xl border ${
                            adminEmailInvalid
                              ? 'border-red-400 dark:border-red-500 bg-red-50/30 dark:bg-red-950/20'
                              : 'border-slate-200 dark:border-slate-700 bg-[#F6F8FC] dark:bg-slate-800/80'
                          } text-[#17243A] dark:text-white focus:bg-white dark:focus:bg-slate-900`}
                        />
                      </div>
                      {adminEmailInvalid && (
                        <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                          Enter a valid email address.
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="kmfri-admin-staffno"
                        className="block text-xs font-semibold text-[#17243A] dark:text-slate-200 mb-1.5"
                      >
                        Staff Number <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <Hash className="w-4 h-4 text-[#68768A] dark:text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          id="kmfri-admin-staffno"
                          type="text"
                          required
                          placeholder="KMFRI/ADM/001"
                          value={adminStaffNo}
                          onBlur={() => markTouched('adminStaffNo')}
                          onChange={(e) => setAdminStaffNo(e.target.value)}
                          className={`kmfri-input-field w-full pl-10 pr-3.5 py-2.5 text-sm font-mono rounded-xl border ${
                            adminStaffInvalid
                              ? 'border-red-400 dark:border-red-500 bg-red-50/30 dark:bg-red-950/20'
                              : 'border-slate-200 dark:border-slate-700 bg-[#F6F8FC] dark:bg-slate-800/80'
                          } text-[#17243A] dark:text-white focus:bg-white dark:focus:bg-slate-900`}
                        />
                      </div>
                      {adminStaffInvalid && (
                        <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                          Unique staff number is required.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Administrator Password + Strength Indicator */}
                  <div>
                    <label
                      htmlFor="kmfri-admin-password"
                      className="block text-xs font-semibold text-[#17243A] dark:text-slate-200 mb-1.5"
                    >
                      Password <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-[#68768A] dark:text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="kmfri-admin-password"
                        type={showAdminPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        autoComplete="new-password"
                        placeholder="Create strong administrator password"
                        value={adminPassword}
                        onBlur={() => markTouched('adminPassword')}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        className={`kmfri-input-field w-full pl-10 pr-11 py-2.5 text-sm rounded-xl border ${
                          adminPwdInvalid
                            ? 'border-red-400 dark:border-red-500 bg-red-50/30 dark:bg-red-950/20'
                            : 'border-slate-200 dark:border-slate-700 bg-[#F6F8FC] dark:bg-slate-800/80'
                        } text-[#17243A] dark:text-white focus:bg-white dark:focus:bg-slate-900`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowAdminPassword(!showAdminPassword)}
                        aria-label={showAdminPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#68768A] hover:text-[#17243A] dark:hover:text-white p-1 cursor-pointer transition-colors"
                      >
                        {showAdminPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>

                    {/* Password Strength Meter & Requirements */}
                    <div className="mt-2.5 space-y-1.5">
                      <div className="grid grid-cols-4 gap-1.5">
                        {[1, 2, 3, 4].map((step) => (
                          <div
                            key={step}
                            className={`h-1.5 rounded-full transition-colors duration-200 ${
                              adminPasswordStrength.score >= step
                                ? adminPasswordStrength.barColorClass
                                : 'bg-slate-200 dark:bg-slate-800'
                            }`}
                          />
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                        <span className={`font-medium ${adminPasswordStrength.colorClass}`}>
                          {adminPasswordStrength.label}
                        </span>
                        <span className="font-mono text-[#68768A] dark:text-slate-400">
                          8+ chars · A-z · 0-9
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="kmfri-primary-gradient-btn w-full h-12 px-4 sm:px-5 text-white text-xs sm:text-sm font-semibold rounded-xl flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed mt-2"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Provisioning Administrator...</span>
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4 shrink-0" />
                        <span>Create System Administrator &amp; Sign In</span>
                      </>
                    )}
                  </button>
                </form>
              </div>
            )}

            {/* MODE 2: REGULAR AUTHENTICATED STAFF SIGN-IN */}
            {mode === 'login' && (
              <div>
                {/* Institutional Welcome Banner */}
                <div className="mb-5 p-4 rounded-2xl bg-gradient-to-r from-[#173B75] via-[#3155A4] to-[#159A9C] text-white shadow-sm flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur-xs border border-white/25 flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-5 h-5 text-teal-200" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base sm:text-[17px] font-extrabold font-display tracking-tight leading-snug">
                      Welcome to KMFRI Research Management
                    </h2>
                    <p className="text-[11px] text-sky-100/90 font-medium truncate">
                      Institutional Staff &amp; Scientist Sign-In
                    </p>
                  </div>
                </div>

                <form onSubmit={handleLogin} noValidate className="space-y-4">
                  <div>
                    <label
                      htmlFor="kmfri-login-identifier"
                      className="block text-xs font-semibold text-[#17243A] dark:text-slate-200 mb-1.5"
                    >
                      Institutional Email or Staff Number <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-[#68768A] dark:text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="kmfri-login-identifier"
                        type="text"
                        required
                        autoComplete="username"
                        placeholder="name@kmfri.go.ke or KMFRI/..."
                        value={identifier}
                        onBlur={() => markTouched('identifier')}
                        onChange={(e) => setIdentifier(e.target.value)}
                        className="kmfri-input-field w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-[#F6F8FC] dark:bg-slate-800/80 text-[#17243A] dark:text-white focus:bg-white dark:focus:bg-slate-900"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5 gap-2">
                      <label
                        htmlFor="kmfri-login-password"
                        className="block text-xs font-semibold text-[#17243A] dark:text-slate-200"
                      >
                        Password <span className="text-red-500">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setMode('reset');
                          setResetStep('request_otp');
                          setResetIdentifier(identifier.trim());
                          setOtpDigits(['', '', '', '', '', '']);
                          setErrorMsg(null);
                          setInfoMsg(null);
                        }}
                        className="text-xs font-semibold text-[#3155A4] dark:text-sky-400 hover:text-[#173B75] hover:underline cursor-pointer transition-colors"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-[#68768A] dark:text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="kmfri-login-password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        autoComplete="current-password"
                        placeholder="Enter your password"
                        value={password}
                        onBlur={() => markTouched('password')}
                        onChange={(e) => setPassword(e.target.value)}
                        className="kmfri-input-field w-full pl-10 pr-11 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-[#F6F8FC] dark:bg-slate-800/80 text-[#17243A] dark:text-white focus:bg-white dark:focus:bg-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#68768A] hover:text-[#17243A] dark:hover:text-white p-1 cursor-pointer transition-colors"
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-0.5">
                    <label className="inline-flex items-center gap-2 text-xs text-[#68768A] dark:text-slate-400 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-[#3155A4] focus:ring-[#3155A4] shrink-0"
                      />
                      <span>Keep me signed in on this workstation</span>
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="kmfri-primary-gradient-btn w-full h-12 px-5 text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed mt-2"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Authenticating...</span>
                      </>
                    ) : (
                      <>
                        <span>Sign In to KMFRI Portal</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>
              </div>
            )}

            {/* MODE 3: 3-STEP FORGOT PASSWORD OTP VERIFICATION & PASSWORD CHANGE */}
            {mode === 'reset' && (
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setResetStep('request_otp');
                    setOtpDigits(['', '', '', '', '', '']);
                    setErrorMsg(null);
                    setInfoMsg(null);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#3155A4] dark:text-sky-400 hover:underline mb-3 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Sign In</span>
                </button>

                {/* Step Progress Indicator */}
                <div className="flex items-center gap-2 mb-4">
                  {[
                    { key: 'request_otp', stepNum: 1, label: 'Account' },
                    { key: 'verify_otp', stepNum: 2, label: 'Verify OTP' },
                    { key: 'change_password', stepNum: 3, label: 'New Password' },
                  ].map((item, idx) => {
                    const currentOrder =
                      resetStep === 'request_otp' ? 1 : resetStep === 'verify_otp' ? 2 : 3;
                    const isCompleted = currentOrder > item.stepNum;
                    const isActive = currentOrder === item.stepNum;
                    return (
                      <React.Fragment key={item.key}>
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center transition-colors ${
                              isCompleted
                                ? 'bg-[#16866B] text-white'
                                : isActive
                                ? 'bg-[#173B75] dark:bg-[#159A9C] text-white ring-2 ring-[#3155A4]/30'
                                : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                            }`}
                          >
                            {isCompleted ? '✓' : item.stepNum}
                          </span>
                          <span
                            className={`text-[11px] font-semibold ${
                              isActive
                                ? 'text-[#17243A] dark:text-white'
                                : 'text-[#68768A] dark:text-slate-400'
                            }`}
                          >
                            {item.label}
                          </span>
                        </div>
                        {idx < 2 && (
                          <div className="flex-1 h-0.5 bg-slate-200 dark:bg-slate-800 rounded-full" />
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>

                <h2 className="text-lg sm:text-xl font-extrabold text-[#17243A] dark:text-white font-display tracking-tight mb-1.5">
                  {resetStep === 'request_otp' && 'Forgot Password — Request Email OTP'}
                  {resetStep === 'verify_otp' && 'Verify 6-Digit Email OTP Code'}
                  {resetStep === 'change_password' && 'Create Your New Password'}
                </h2>
                <p className="text-xs sm:text-[13px] text-[#68768A] dark:text-slate-400 leading-relaxed mb-5">
                  {resetStep === 'request_otp' &&
                    'Enter your registered KMFRI institutional email or staff number. We will send a 6-digit One-Time Password (OTP) to your email for verification.'}
                  {resetStep === 'verify_otp' &&
                    `Enter the 6-digit OTP verification code sent to ${
                      resetMaskedEmail || 'your registered email'
                    } to verify your identity before changing your password.`}
                  {resetStep === 'change_password' &&
                    'Your email OTP has been verified. Choose a strong new password for your KMFRI account below.'}
                </p>

                {/* STEP 1: ENTER REGISTERED EMAIL OR STAFF NUMBER */}
                {resetStep === 'request_otp' && (
                  <form onSubmit={handleRequestResetToken} className="space-y-4">
                    <div>
                      <label
                        htmlFor="kmfri-reset-id"
                        className="block text-xs font-semibold text-[#17243A] dark:text-slate-200 mb-1.5"
                      >
                        Registered Institutional Email or Staff Number{' '}
                        <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-[#68768A] dark:text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          id="kmfri-reset-id"
                          type="text"
                          required
                          placeholder="name@kmfri.go.ke or KMFRI/..."
                          value={resetIdentifier}
                          onChange={(e) => setResetIdentifier(e.target.value)}
                          className="kmfri-input-field w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-[#F6F8FC] dark:bg-slate-800/80 text-[#17243A] dark:text-white focus:bg-white dark:focus:bg-slate-900"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="kmfri-primary-gradient-btn w-full h-12 px-5 text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Sending OTP to Email...</span>
                        </>
                      ) : (
                        <>
                          <span>Send Verification OTP to Email</span>
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </form>
                )}

                {/* STEP 2: VERIFY 6-DIGIT OTP CODE */}
                {resetStep === 'verify_otp' && (
                  <form onSubmit={handleVerifyResetOtp} className="space-y-4">
                    <div className="p-3 rounded-xl bg-sky-50/80 dark:bg-sky-950/30 border border-sky-200/80 dark:border-sky-800/60 text-sky-900 dark:text-sky-200 text-xs flex items-start gap-2.5">
                      <Mail className="w-4 h-4 text-[#3155A4] dark:text-sky-400 shrink-0 mt-0.5" />
                      <span>
                        A 6-digit OTP verification code has been sent to{' '}
                        <strong className="font-mono">{resetMaskedEmail || 'your email'}</strong>.
                        Please check your email inbox (and spam folder) and enter the 6 digits below.
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#17243A] dark:text-slate-200 mb-2">
                        6-Digit Email OTP Verification Code <span className="text-red-500">*</span>
                      </label>
                      <div className="grid grid-cols-6 gap-2 sm:gap-2.5">
                        {otpDigits.map((digit, idx) => (
                          <input
                            key={idx}
                            ref={(el) => {
                              otpInputRefs.current[idx] = el;
                            }}
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            value={digit}
                            onChange={(e) => handleOtpDigitChange(idx, e.target.value)}
                            onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                            onPaste={handleOtpPaste}
                            aria-label={`OTP digit ${idx + 1}`}
                            className="kmfri-input-field w-full h-11 sm:h-12 text-center text-base sm:text-lg font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-[#F6F8FC] dark:bg-slate-800/80 text-[#17243A] dark:text-white focus:bg-white dark:focus:bg-slate-900"
                          />
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setResetStep('request_otp');
                          setErrorMsg(null);
                          setInfoMsg(null);
                        }}
                        className="text-[#68768A] dark:text-slate-400 hover:text-[#17243A] dark:hover:text-white font-medium cursor-pointer"
                      >
                        Change email / staff number
                      </button>

                      <button
                        type="button"
                        disabled={resendCooldown > 0 || isSubmitting}
                        onClick={dispatchOtpToRegisteredUser}
                        className="inline-flex items-center gap-1 font-semibold text-[#3155A4] dark:text-sky-400 hover:underline disabled:opacity-50 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>
                          {resendCooldown > 0
                            ? `Resend OTP in ${resendCooldown}s`
                            : 'Resend OTP Code'}
                        </span>
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmitting || enteredToken.length !== 6}
                      className="kmfri-primary-gradient-btn w-full h-12 px-5 text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Verifying OTP Code...</span>
                        </>
                      ) : (
                        <>
                          <span>Verify OTP &amp; Continue</span>
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </form>
                )}

                {/* STEP 3: CHANGE PASSWORD AFTER OTP VERIFICATION */}
                {resetStep === 'change_password' && (
                  <form onSubmit={handleCompleteReset} className="space-y-4">
                    <div>
                      <label
                        htmlFor="kmfri-reset-newpwd"
                        className="block text-xs font-semibold text-[#17243A] dark:text-slate-200 mb-1.5"
                      >
                        New Password (minimum 8 characters) <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <Lock className="w-4 h-4 text-[#68768A] dark:text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          id="kmfri-reset-newpwd"
                          type={showResetPassword ? 'text' : 'password'}
                          required
                          minLength={8}
                          placeholder="Create new strong password"
                          value={newResetPassword}
                          onChange={(e) => setNewResetPassword(e.target.value)}
                          className="kmfri-input-field w-full pl-10 pr-11 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-[#F6F8FC] dark:bg-slate-800/80 text-[#17243A] dark:text-white focus:bg-white dark:focus:bg-slate-900"
                        />
                        <button
                          type="button"
                          onClick={() => setShowResetPassword(!showResetPassword)}
                          aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#68768A] hover:text-[#17243A] dark:hover:text-white p-1 cursor-pointer"
                        >
                          {showResetPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>

                      <div className="mt-2 space-y-1">
                        <div className="grid grid-cols-4 gap-1.5">
                          {[1, 2, 3, 4].map((step) => (
                            <div
                              key={step}
                              className={`h-1.5 rounded-full transition-colors ${
                                resetPasswordStrength.score >= step
                                  ? resetPasswordStrength.barColorClass
                                  : 'bg-slate-200 dark:bg-slate-800'
                              }`}
                            />
                          ))}
                        </div>
                        <p className={`text-[11px] font-medium ${resetPasswordStrength.colorClass}`}>
                          {resetPasswordStrength.label}
                        </p>
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="kmfri-reset-confirmpwd"
                        className="block text-xs font-semibold text-[#17243A] dark:text-slate-200 mb-1.5"
                      >
                        Confirm New Password <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <KeyRound className="w-4 h-4 text-[#68768A] dark:text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          id="kmfri-reset-confirmpwd"
                          type={showResetPassword ? 'text' : 'password'}
                          required
                          minLength={8}
                          placeholder="Re-enter new password"
                          value={confirmResetPassword}
                          onChange={(e) => setConfirmResetPassword(e.target.value)}
                          className="kmfri-input-field w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-[#F6F8FC] dark:bg-slate-800/80 text-[#17243A] dark:text-white focus:bg-white dark:focus:bg-slate-900"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="kmfri-primary-gradient-btn w-full h-12 px-5 text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Updating Password...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Change Password &amp; Sign In</span>
                        </>
                      )}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>

          {/* Institutional Access & Security Disclaimer Below Login Card */}
          <div
            role="note"
            aria-label="Institutional access disclaimer"
            className="kmfri-auth-card-enter w-full max-w-[460px] mt-4 sm:mt-5 rounded-2xl bg-white/90 dark:bg-[#0F172A]/90 backdrop-blur-md border border-slate-200/90 dark:border-slate-800/90 border-l-4 border-l-[#159A9C] px-4 py-3.5 sm:px-5 sm:py-4 shadow-[0_12px_32px_-12px_rgba(23,36,58,0.08)] dark:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.45)] flex items-start gap-3.5"
          >
            <div className="w-8 h-8 rounded-xl bg-[#173B75]/10 dark:bg-teal-500/15 border border-[#173B75]/20 dark:border-teal-500/30 flex items-center justify-center shrink-0 mt-0.5">
              <Lock className="w-4 h-4 text-[#173B75] dark:text-teal-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xs sm:text-[12.5px] text-[#334155] dark:text-slate-300 leading-relaxed font-medium">
                Access is restricted to authorised KMFRI staff. Sign-in attempts are logged and accounts lock for a while after repeated failures.
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};
