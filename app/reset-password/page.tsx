'use client';

import React, { Suspense, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Lock, LoaderCircle } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import useAuthStore from '@/modules/auth/auth.store';

const adminResetPasswordSchema = z
  .object({
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string().min(1, 'Confirm password is required'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type AdminResetPasswordFormData = z.infer<typeof adminResetPasswordSchema>;

function AdminResetPasswordForm() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const lang = (params.lang as 'am' | 'en') || 'en';
  const isAm = lang === 'am';
  const userId = (params.id as string) || '';
  const token = searchParams.get('token') || searchParams.get('activation_token') || userId || '';

  const { resetPassword, loading, error: storeError } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AdminResetPasswordFormData>({
    resolver: zodResolver(adminResetPasswordSchema),
  });

  const onSubmit = async (data: AdminResetPasswordFormData) => {
    setLocalError(null);

    if (!token) {
      setLocalError('Invalid or missing user identifier/token');
      return;
    }

    try {
      await resetPassword({
        token,
        newPassword: data.password,
        confirmPassword: data.confirmPassword,
      } as any);

      setIsSuccess(true);
      setTimeout(() => {
        router.push(`/${lang}/admin/users`);
      }, 3000);
    } catch (error: unknown) {
      setLocalError(error instanceof Error ? error.message : 'Password reset failed.');
    }
  };

  return (
    <div className="mx-auto w-full max-w-xl overflow-hidden rounded-3xl border border-white/30 bg-white/95 shadow-2xl backdrop-blur-xl">
      <div className="border-b border-slate-100 bg-gradient-to-br from-blue-950 to-indigo-900 px-6 py-7 text-center text-white sm:px-10">
        <div className="mx-auto mb-3 inline-flex rounded-2xl border border-white/20 bg-white/10 p-3 shadow-inner">
          <KeyRound className="h-7 w-7" />
        </div>
        <h1 className="text-xl font-extrabold">
          {isAm ? 'የተጠቃሚ ይለፍ ቃል መቀየሪያ' : 'Reset User Password'}
        </h1>
        <p className="mt-1 text-xs text-blue-100">
          User ID / Target: <span className="font-semibold">{userId || 'N/A'}</span>
        </p>
      </div>

      {isSuccess ? (
        <div className="space-y-4 px-6 py-10 text-center sm:px-10">
          <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
          <h3 className="text-base font-bold text-gray-800">Password Updated</h3>
          <p className="text-xs font-semibold text-slate-700">
            Password has been reset successfully. Redirecting...
          </p>
          <div className="pt-2">
            <Link
              href={`/${lang}/admin/dashboard`}
              className="inline-block rounded-xl bg-blue-900 px-5 py-2 text-xs font-bold text-white hover:bg-blue-800 transition"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 p-6 sm:p-8">
          {(localError || storeError) && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-center text-xs font-medium text-red-600">
              {localError || storeError}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                New Password
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <Lock className="h-4 w-4" />
                </span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  {...register('password')}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-9 text-xs text-slate-800 outline-none transition focus:bg-white focus:ring-2 focus:ring-blue-600"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1 text-[10px] text-red-500">{errors.password.message}</p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Confirm New Password
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <Lock className="h-4 w-4" />
                </span>
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  {...register('confirmPassword')}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-9 text-xs text-slate-800 outline-none transition focus:bg-white focus:ring-2 focus:ring-blue-600"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="mt-1 text-[10px] text-red-500">{errors.confirmPassword.message}</p>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || loading}
            className="w-full rounded-xl bg-blue-900 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-900/20 transition hover:bg-blue-800 disabled:opacity-50"
          >
            {isSubmitting || loading ? (
              <span className="inline-flex items-center justify-center">
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                Updating Password...
              </span>
            ) : (
              'Reset Password'
            )}
          </button>

          <div className="border-t border-slate-100 pt-4 text-center">
            <Link
              href={`/${lang}/admin/dashboard`}
              className="inline-flex items-center text-xs font-semibold text-blue-600 transition hover:text-blue-800"
            >
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Back to Dashboard
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}

export default function AdminResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-xl rounded-3xl bg-white/90 p-8 text-center text-xs text-slate-500 shadow-2xl">
          Loading reset form...
        </div>
      }
    >
      <AdminResetPasswordForm />
    </Suspense>
  );
}