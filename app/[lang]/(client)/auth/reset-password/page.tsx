'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Lock,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import useAuthStore from '@/modules/auth/auth.store';
import { getAuthErrorMessage, getAuthErrorStatus } from '@/modules/auth/auth-errors';

const getResetPasswordSchema = (isAm: boolean) =>
  z
    .object({
      email: z
        .string()
        .trim()
        .min(1, isAm ? 'እባክዎ ኢሜይል ያስገቡ' : 'Email is required')
        .email(isAm ? 'ትክክለኛ ኢሜይል ያስገቡ' : 'Enter a valid email address'),
      code: z
        .string()
        .trim()
        .min(1, isAm ? 'የማረጋገጫ ኮዱን ያስገቡ' : 'Enter the reset code')
        .regex(
          /^\d{6}$/,
          isAm ? 'ኮዱ በትክክል 6 አሃዝ መሆን አለበት' : 'Enter a valid 6-digit reset code',
        ),
      newPassword: z
        .string()
        .min(6, isAm ? 'የይለፍ ቃል ቢያንስ 6 ፊደላት ሊኖሩት ይገባል' : 'Password must be at least 6 characters'),
      confirmPassword: z
        .string()
        .min(1, isAm ? 'የይለፍ ቃል ማረጋገጫ ያስገቡ' : 'Confirm password is required'),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      message: isAm ? 'የይለፍ ቃሎቹ አይመሳሰሉም' : 'Passwords do not match',
      path: ['confirmPassword'],
    });

type ResetPasswordFormData = z.infer<ReturnType<typeof getResetPasswordSchema>>;

const getFriendlyErrorMessage = (error: unknown, isAm: boolean): string => {
  const message = getAuthErrorMessage(error) ?? '';
  const status = getAuthErrorStatus(error);

  if (
    status === 401 ||
    ((status === 400 || status === undefined) &&
      /invalid|expired|token|reset code|bad request|unauthorized/i.test(message))
  ) {
    return isAm
      ? 'የማስተካከያ ኮዱ ልክ ያልሆነ ወይም ጊዜው ያለፈ ሊሆን ይችላል። እባክዎ አዲስ ኮድ ይጠይቁ።'
      : 'This reset code is invalid or has expired. Please request a new one.';
  }

  if (message) return message;
  return isAm
    ? 'የይለፍ ቃል መቀየር አልተሳካም። እባክዎ እንደገና ይሞክሩ።'
    : 'Password reset failed. Please try again.';
};

function ResetPasswordForm() {
  const params = useParams<{ lang?: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const lang = params?.lang === 'en' ? 'en' : 'am';
  const isAm = lang === 'am';
  const codeFromUrl = searchParams.get('code') || '';
  const emailFromUrl = searchParams.get('email') || '';
  const { resetPassword, clearError, loading, error: storeError } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const schema = useMemo(() => getResetPasswordSchema(isAm), [isAm]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: emailFromUrl,
      code: codeFromUrl,
    },
  });

  useEffect(() => {
    clearError();
  }, [clearError]);

  useEffect(() => {
    if (!isSuccess) return;

    const timeoutId = window.setTimeout(() => {
      router.push(`/${lang}/auth/login`);
    }, 2000);

    return () => window.clearTimeout(timeoutId);
  }, [isSuccess, lang, router]);

  const onSubmit = async (data: ResetPasswordFormData) => {
    clearError();
    setLocalError(null);
    try {
      await resetPassword({
        email: data.email.trim(),
        code: data.code.trim(),
        token: data.code.trim(),
        newPassword: data.newPassword,
      });
      setIsSuccess(true);
    } catch (error: unknown) {
      setLocalError(getFriendlyErrorMessage(error, isAm));
    }
  };

  const displayError =
    localError || (storeError ? getFriendlyErrorMessage(storeError, isAm) : null);

  return (
    <div className="mx-auto w-full max-w-[380px] rounded-2xl border border-white/30 bg-white/90 p-5 text-center shadow-2xl backdrop-blur-xl">
      {isSuccess ? (
        <div className="space-y-3 py-2" role="status" aria-live="polite">
          <div className="inline-flex rounded-full bg-emerald-50 p-3 text-emerald-700">
            <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-sm font-bold text-gray-900">
            {isAm ? 'የይለፍ ቃልዎ ተቀይሯል' : 'Password Reset Successful'}
          </h1>
          <p className="text-[11px] leading-relaxed text-gray-600">
            {isAm
              ? 'አዲሱን የይለፍ ቃልዎን ተጠቅመው አሁን መግባት ይችላሉ።'
              : 'Your password has been updated. You can now sign in with your new password.'}
          </p>
          <Link
            href={`/${lang}/auth/login`}
            className="inline-flex w-full items-center justify-center rounded-lg bg-blue-900 px-3 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-900/20 transition hover:bg-blue-800"
          >
            {isAm ? 'ወደ መግቢያ ገጽ ሂድ' : 'Go to Login'}
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-2 inline-flex rounded-lg bg-blue-50 p-2 text-blue-900 shadow-inner">
            <KeyRound className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="mb-1 text-center text-base font-extrabold text-gray-800">
            {isAm ? 'የይለፍ ቃል ቀይር' : 'Reset Your Password'}
          </h1>
          <p className="mb-3 text-center text-[11px] leading-relaxed text-gray-500">
            {isAm
              ? 'የኢሜይልዎን እና የማስተካከያ ኮድዎን በመጠቀም አዲስ የይለፍ ቃል ያዘጋጁ።'
              : 'Enter your email and reset code, then choose a new password.'}
          </p>

          <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-3 text-left">
            {(displayError || Object.keys(errors).length > 0) && (
              <div
                className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-center text-[11px] font-medium text-red-600"
                role="alert"
              >
                {displayError ||
                  errors.email?.message ||
                  errors.code?.message ||
                  errors.newPassword?.message ||
                  errors.confirmPassword?.message}
              </div>
            )}

            <div>
              <label
                htmlFor="reset-email"
                className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-500"
              >
                {isAm ? 'ኢሜይል አድራሻ' : 'Email Address'}
              </label>
              <input
                id="reset-email"
                type="email"
                autoComplete="email"
                {...register('email')}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800 outline-none transition focus:bg-white focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="reset-code"
                className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-500"
              >
                {isAm ? 'ባለ 6 አሃዝ የማረጋገጫ ኮድ' : '6-Digit Reset Code'}
              </label>
              <input
                id="reset-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                placeholder="482915"
                {...register('code')}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-center font-mono text-sm tracking-widest text-gray-800 outline-none transition focus:bg-white focus:ring-2 focus:ring-blue-600"
              />
              {codeFromUrl && (
                <p className="mt-1 text-[10px] text-gray-500">
                  {isAm
                    ? 'ኮዱ ከኢሜይልዎ ተሞልቷል፤ ባለ 6 አሃዝ መሆኑን ያረጋግጡ።'
                    : 'Code filled from your email; confirm it has 6 digits.'}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="new-password"
                className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-500"
              >
                {isAm ? 'አዲስ የይለፍ ቃል' : 'New Password'}
              </label>
              <div className="relative">
                <Lock
                  className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                  aria-hidden="true"
                />
                <input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  {...register('newPassword')}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-10 text-xs text-gray-800 outline-none transition focus:bg-white focus:ring-2 focus:ring-blue-600"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={
                    showPassword
                      ? isAm
                        ? 'የይለፍ ቃሉን ደብቅ'
                        : 'Hide password'
                      : isAm
                        ? 'የይለፍ ቃሉን አሳይ'
                        : 'Show password'
                  }
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="confirm-password"
                className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-500"
              >
                {isAm ? 'የይለፍ ቃል ማረጋገጫ' : 'Confirm New Password'}
              </label>
              <div className="relative">
                <Lock
                  className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                  aria-hidden="true"
                />
                <input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  {...register('confirmPassword')}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-10 text-xs text-gray-800 outline-none transition focus:bg-white focus:ring-2 focus:ring-blue-600"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((visible) => !visible)}
                  aria-label={
                    showConfirmPassword
                      ? isAm
                        ? 'የይለፍ ቃሉን ደብቅ'
                        : 'Hide password'
                      : isAm
                        ? 'የይለፍ ቃሉን አሳይ'
                        : 'Show password'
                  }
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || loading}
              className="w-full rounded-lg bg-blue-900 px-3 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-900/20 transition hover:bg-blue-800 disabled:opacity-50"
            >
              {isSubmitting || loading ? (
                <span className="inline-flex items-center justify-center">
                  <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  {isAm ? 'እየተቀየረ ነው...' : 'Updating Password...'}
                </span>
              ) : isAm ? (
                'የይለፍ ቃል ቀይር'
              ) : (
                'Reset Password'
              )}
            </button>
          </form>
        </>
      )}

      <div className="mt-4 border-t border-gray-100 pt-3 text-center">
        <Link
          href={`/${lang}/auth/login`}
          className="inline-flex items-center text-[11px] font-semibold text-blue-600 transition hover:text-blue-800"
        >
          <ArrowLeft className="mr-1 h-3 w-3" aria-hidden="true" />
          {isAm ? 'ወደ መግቢያ ገጽ ተመለስ' : 'Back to Login'}
        </Link>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-[380px] rounded-2xl border border-white/30 bg-white/90 p-5 text-center text-xs text-slate-500 shadow-2xl backdrop-blur-xl">
          Loading password reset form...
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
