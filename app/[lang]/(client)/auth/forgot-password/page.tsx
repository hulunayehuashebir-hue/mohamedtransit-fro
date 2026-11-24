'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, KeyRound, LoaderCircle, Mail } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import useAuthStore from '@/modules/auth/auth.store';
import { getAuthErrorMessage, getAuthErrorStatus } from '@/modules/auth/auth-errors';

type ForgotPasswordFormData = { email: string };

const getForgotPasswordSchema = (isAm: boolean) =>
  z.object({
    email: z
      .string()
      .trim()
      .min(1, { message: isAm ? 'እባክዎ ኢሜይል ያስገቡ' : 'Email is required' })
      .email({ message: isAm ? 'ትክክለኛ ኢሜይል ያስገቡ' : 'Enter a valid email address' }),
  });

const getFriendlyErrorMessage = (error: unknown, isAm: boolean): string => {
  const message = getAuthErrorMessage(error) ?? '';

  if (/account\s+does\s+not\s+exist|not\s+found/i.test(message)) {
    return isAm
      ? 'ይህ ኢሜይል በሲስተሙ ውስጥ አልተገኘም፤ እባክዎ ትክክለኛ ኢሜይል ያስገቡ።'
      : 'Account does not exist. Please enter a registered email.';
  }

  if (
    getAuthErrorStatus(error) === 500 ||
    /\b500\b|\bssl\b|\btls\b|\bsmtp\b|\bserver\b|database|\bsql\b|exception/i.test(message)
  ) {
    return isAm
      ? 'የሰርቨር ግንኙነት ችግር አጋጥሟል። እባክዎ ከጥቂት ደቂቃዎች በኋላ እንደገና ይሞክሩ።'
      : 'A server connection issue occurred. Please try again later.';
  }

  if (message) return message;
  return isAm
    ? 'ጥያቄውን ማስኬድ አልተቻለም። እባክዎ እንደገና ይሞክሩ።'
    : "We couldn't complete your request. Please try again.";
};

export default function ForgotPasswordPage() {
  const params = useParams<{ lang?: string }>();
  const lang = params?.lang === 'en' ? 'en' : 'am';
  const isAm = lang === 'am';
  const { forgotPassword, clearError, loading, error: storeError } = useAuthStore();
  const [isSuccess, setIsSuccess] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState('');
  const schema = useMemo(() => getForgotPasswordSchema(isAm), [isAm]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    clearError();
  }, [clearError]);

  const onSubmit = async (data: ForgotPasswordFormData) => {
    clearError();
    setLocalError(null);
    setIsSuccess(false);

    const trimmedEmail = data.email.trim();
    try {
      await forgotPassword({ email: trimmedEmail, lang });
      setSubmittedEmail(trimmedEmail);
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
        <div className="space-y-3 py-2 text-center" role="status" aria-live="polite">
          <div className="inline-flex rounded-full bg-emerald-50 p-3 text-emerald-700">
            <Mail className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2 className="text-sm font-bold text-gray-900">
            {isAm ? 'ኢሜይልዎን ይመልከቱ' : 'Check Your Email'}
          </h2>
          <p className="text-[11px] leading-relaxed text-gray-600">
            {isAm ? (
              <>
                የ 6 አሃዝ የማረጋገጫ ኮድ ወደ ኢሜይልዎ ልከናል፦{' '}
                <strong className="break-all text-gray-800">{submittedEmail}</strong>። ኮዱን
                ያስገቡና ከታች ይቀጥሉ።
              </>
            ) : (
              <>
                We sent a 6-digit verification code to{' '}
                <strong className="break-all text-gray-800">{submittedEmail}</strong>. Check your
                email, then enter the code on the next page.
              </>
            )}
          </p>
          <Link
            href={`/${lang}/auth/reset-password?email=${encodeURIComponent(submittedEmail)}`}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-900 transition hover:bg-blue-100"
          >
            <span>{isAm ? 'ወደ ይለፍ ቃል መቀየሪያ ገጽ ሂድ' : 'Continue to Reset Password'}</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-2 inline-flex rounded-lg bg-blue-50 p-2 text-blue-900 shadow-inner">
            <KeyRound className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 className="mb-1 text-center text-base font-extrabold text-gray-800">
            {isAm ? 'የይለፍ ቃል ማግኛ' : 'Password Recovery'}
          </h2>
          <p className="mb-3 text-center text-[11px] leading-relaxed text-gray-500">
            {isAm
              ? 'የተመዘገቡበትን ኢሜይል ያስገቡ፤ ባለ 6 አሃዝ የማረጋገጫ ኮድ እንልክልዎታለን።'
              : 'Enter your registered email to receive a 6-digit verification code.'}
          </p>

          <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-3 text-left">
            {(displayError || errors.email) && (
              <div
                className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-center text-[11px] font-medium text-red-600"
                role="alert"
              >
                {displayError || errors.email?.message}
              </div>
            )}

            <div>
              <label
                htmlFor="forgot-email"
                className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-500"
              >
                {isAm ? 'ኢሜይል አድራሻ' : 'Email Address'}
              </label>
              <input
                id="forgot-email"
                type="email"
                autoComplete="email"
                disabled={isSubmitting || loading}
                placeholder="name@example.com"
                {...register('email')}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800 outline-none transition focus:bg-white focus:ring-2 focus:ring-blue-600 disabled:opacity-70"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting || loading}
              className="w-full rounded-lg bg-blue-900 px-3 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-900/20 transition hover:bg-blue-800 disabled:opacity-50"
            >
              {isSubmitting || loading ? (
                <span className="inline-flex items-center justify-center">
                  <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  {isAm ? 'ኮድ እየተላከ ነው...' : 'Sending Code...'}
                </span>
              ) : isAm ? (
                'የማረጋገጫ ኮድ ላክ'
              ) : (
                'Send Verification Code'
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
