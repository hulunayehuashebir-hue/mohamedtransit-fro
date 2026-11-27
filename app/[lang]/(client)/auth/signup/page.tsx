"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Check, CheckCircle2, FileImage, Lock, Mail, MapPin, ShieldCheck, Upload, User } from "lucide-react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button, Input } from "antd";
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/style.css";

import useAuthStore from "@/modules/auth/auth.store";
import { SignupRequestError } from "@/modules/auth/auth.endpoint";
import { registerCustomer } from "@/modules/customer/customer.endpoint";
import {
  deleteTokensClient,
  getTokenClient,
} from "@/modules/utils/token/client-token.storage";

const signupSchema = z.object({
  firstName: z.string().min(2, "ስም ቢያንስ 2 ፊደላት ሊኖሩት ይገባል / First name is too short"),
  lastName: z.string().min(2, "የአባት ስም ቢያንስ 2 ፊደላት ሊኖሩት ይገባል / Last name is too short"),
  username: z.string().min(3, "የመጠቀሚያ ስም ቢያንስ 3 ፊደላት ሊኖሩት ይገባል / Username is too short"),
  email: z.string().email("ትክክለኛ ኢሜይል ያስገቡ / Invalid email address"),
  phonenumber: z.string().min(9, "ትክክለኛ ስልክ ቁጥር ያስገቡ / Invalid phone number"),
  businessName: z.string().trim().min(1, "Business name is required"),
  tinNumber: z.string().trim().min(1, "TIN is required"),
  businessLicense: z.string().trim().min(1, "Business license is required"),
  businessAddress: z.string().trim().min(1, "Business address is required"),
  city: z.string().trim().min(1, "City is required"),
  state: z.string().trim().min(1, "State / region is required"),
  postalCode: z.string().trim().min(1, "Postal code is required"),
  businessType: z.string().trim().min(1, "Business type is required"),
  importLicense: z.string().trim().min(1, "Import license is required"),
  importLicenseExpiry: z.string().optional(),
  password: z.string().min(8, "የይለፍ ቃል ቢያንስ 8 ፊደላት ሊኖሩት ይገባል / Password must be at least 8 characters"),
  confirmpassword: z.string(),
}).refine((data) => data.password === data.confirmpassword, {
  message: "የይለፍ ቃሎቹ አይመሳሰሉም / Passwords don't match",
  path: ["confirmpassword"],
});

type SignupFormData = z.infer<typeof signupSchema>;
type FieldIcon = typeof User;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getBackendErrorMessage = (error: unknown): string => {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (isRecord(error)) {
    const response = isRecord(error.response) ? error.response : undefined;
    const data = isRecord(response?.data) ? response.data : undefined;
    if (data) {
      const errors = data.errors;
      if (Array.isArray(errors)) {
        const firstError = errors.find((item) => typeof item === "string" && item.trim());
        if (typeof firstError === "string") return firstError.trim();
        const firstErrorRecord = errors.find(isRecord);
        if (firstErrorRecord) {
          const message = firstErrorRecord.message;
          if (typeof message === "string" && message.trim()) return message.trim();
        }
      } else if (isRecord(errors)) {
        for (const fieldErrors of Object.values(errors)) {
          if (Array.isArray(fieldErrors)) {
            const message = fieldErrors.find(
              (item): item is string => typeof item === "string" && Boolean(item.trim()),
            );
            if (message) return message.trim();
          }
        }
      }

      const message = [data.message, data.detail, data.error, data.title].find(
        (value): value is string => typeof value === "string" && Boolean(value.trim()),
      );
      if (message) return message.trim();
    }
  }

  return error instanceof Error ? error.message.trim() : "";
};

function Label({ children, optional = false }: { children: React.ReactNode; optional?: boolean }) {
  return <span className="mb-2 flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600">{children}{!optional && <span className="text-cyan-600">*</span>}</span>;
}

function ErrorText({ message }: { message?: string }) {
  return message ? <p className="mt-1.5 text-[11px] font-medium text-rose-600">{message}</p> : null;
}

export default function SignUpPage() {
  const params = useParams();
  const router = useRouter();
  const lang = (params.lang as "am" | "en") || "en";
  const isAm = lang === "am";
  const { signUp, login, loading, error: storeError } = useAuthStore();
  const [localError, setLocalError] = useState<string | null>(null);
  const [accountConflict, setAccountConflict] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [accountCreated, setAccountCreated] = useState(false);

  const { control, handleSubmit, formState: { errors } } = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      username: "",
      email: "",
      phonenumber: "",
      businessName: "",
      tinNumber: "",
      businessLicense: "",
      businessAddress: "",
      city: "",
      state: "",
      postalCode: "",
      businessType: "",
      importLicense: "",
      importLicenseExpiry: "",
      password: "",
      confirmpassword: "",
    },
  });

  const onSubmit = async (data: SignupFormData) => {
    setLocalError(null);
    setAccountConflict(false);
    try {
      if (!accountCreated) {
        const accountPayload = new FormData();
        accountPayload.set("FirstName", data.firstName);
        accountPayload.set("LastName", data.lastName);
        accountPayload.set("Username", data.username);
        accountPayload.set("Email", data.email);
        accountPayload.set("Phone", data.phonenumber);
        accountPayload.set("Password", data.password);
        accountPayload.set("IsSuperAdmin", "false");
        accountPayload.set("role", "Customer");
        if (selectedFile) accountPayload.set("ProfileFile", selectedFile);

        await signUp(accountPayload);
        setAccountCreated(true);
      }

      let registeredUser: Awaited<ReturnType<typeof login>>;
      try {
        deleteTokensClient();
        registeredUser = await login({ username: data.username, password: data.password });
      } catch {
        throw new Error(
          isAm
            ? "አካውንቱ ተፈጥሯል፣ ግን በራስ-ሰር መግባት አልተቻለም። እባክዎ ይግቡ።"
            : "Your account was created, but automatic sign-in failed. Please sign in.",
        );
      }
      const accessToken = getTokenClient();
      if (!accessToken) {
        throw new Error(
          isAm
            ? "አካውንቱ ተፈጥሯል፣ ግን የመግቢያ ቶከን አልተገኘም። እባክዎ ይግቡ።"
            : "Your account was created, but sign-in credentials were unavailable. Please sign in.",
        );
      }

      const rawUserId = registeredUser.userId ?? registeredUser.id;
      const numericUserId =
        typeof rawUserId === "number"
          ? rawUserId
          : typeof rawUserId === "string" && /^[1-9]\d*$/.test(rawUserId)
            ? Number(rawUserId)
            : undefined;
      const userId =
        numericUserId !== undefined && Number.isSafeInteger(numericUserId) && numericUserId > 0
          ? numericUserId
          : undefined;

      try {
        await registerCustomer({
          role: "Customer",
          businessName: data.businessName,
          tinNumber: data.tinNumber,
          businessLicense: data.businessLicense,
          businessAddress: data.businessAddress,
          city: data.city,
          state: data.state,
          postalCode: data.postalCode,
          contactPerson: `${data.firstName} ${data.lastName}`.trim(),
          contactPhone: data.phonenumber,
          contactEmail: data.email,
          businessType: data.businessType,
          importLicense: data.importLicense,
          ...(data.importLicenseExpiry ? { importLicenseExpiry: data.importLicenseExpiry } : {}),
          ...(userId !== undefined ? { userId } : {}),
        }, accessToken);
      } catch (error: unknown) {
        if (/already registered|customer (?:profile )?already exists/i.test(getBackendErrorMessage(error))) {
          router.push(`/${lang}/customer/dashboard`);
          return;
        }
        throw error;
      }
      router.push(`/${lang}/customer/dashboard`);
    } catch (error: unknown) {
      if (error instanceof SignupRequestError) {
        const isAccountConflict = error.code === "ACCOUNT_ALREADY_EXISTS";
        setAccountConflict(isAccountConflict);
        setLocalError(
          isAccountConflict
            ? isAm
              ? "በዚህ ኢሜይል ወይም የተጠቃሚ ስም አካውንት አስቀድሞ አለ።"
              : "An account with this email or username already exists."
            : isAm
              ? "ምዝገባው አሁን ለጊዜው አይገኝም። እባክዎ ቆይተው እንደገና ይሞክሩ።"
              : "Signup is temporarily unavailable. Please try again later.",
        );
        return;
      }

      const errorMessage = getBackendErrorMessage(error);
      const hasServerFailure =
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof error.response === "object" &&
        error.response !== null &&
        "status" in error.response &&
        typeof error.response.status === "number" &&
        error.response.status >= 500;
      const containsTechnicalDetails =
        /smtp|5\.\d\.\d|username and password not accepted|stack trace/i.test(errorMessage);
      setLocalError(
        hasServerFailure || containsTechnicalDetails
          ? isAm
            ? "ምዝገባው አሁን ለጊዜው አይገኝም። እባክዎ ቆይተው እንደገና ይሞክሩ።"
            : "Signup is temporarily unavailable. Please try again later."
          : errorMessage || (isAm ? "ምዝገባው አልተሳካም።" : "Registration failed."),
      );
    }
  };

  const inputClass = "!h-11 !rounded-lg !border-slate-200 !bg-slate-50/70 !px-3.5 !text-sm !text-slate-900 !placeholder:text-slate-400 hover:!border-cyan-500 focus:!border-cyan-500 focus:!shadow-[0_0_0_3px_rgba(6,182,212,0.12)]";
  const iconClass = "h-4 w-4 text-slate-400";
  const input = (name: keyof SignupFormData, Icon: FieldIcon, placeholder: string, type = "text") => (
    <Controller name={name} control={control} render={({ field }) => <Input {...field} type={type} prefix={<Icon className={`${iconClass} mr-1`} />} placeholder={placeholder} className={inputClass} />} />
  );

  return (
    <div className="w-full overflow-hidden rounded-[26px] border border-slate-200/80 bg-white shadow-[0_24px_70px_rgba(15,42,68,0.18)] lg:grid lg:grid-cols-[0.82fr_1.18fr]">
      <aside className="relative hidden min-h-[720px] overflow-hidden bg-[#0b2942] lg:block">
        <Image src="/login_image.png" alt="Transit operations" fill priority className="object-cover opacity-35" sizes="45vw" />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(7,35,59,0.96),rgba(10,67,91,0.84),rgba(6,112,127,0.72))]" />
        <div className="relative flex h-full flex-col justify-between p-10 text-white xl:p-12">
          <div>
            <div className="mb-16 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10"><ShieldCheck className="h-5 w-5 text-cyan-200" /></div><div><p className="text-sm font-bold tracking-wide">Transit Portal</p><p className="text-[10px] uppercase tracking-[0.2em] text-cyan-100/70">Secure access</p></div></div>
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">{isAm ? "ወደ መድረኩ ይቀላቀሉ" : "Join the portal"}</p>
            <h1 className="max-w-sm text-4xl font-bold leading-[1.08] tracking-tight xl:text-5xl">{isAm ? "የንግድ ጉዞዎን ከዚህ ይጀምሩ" : "Move your trade forward."}</h1>
            <p className="mt-6 max-w-sm text-sm leading-7 text-slate-200/80">{isAm ? "የእቃ ማስመጣት እና የመጓጓዣ አገልግሎቶችን በአንድ የተደራጀ መድረክ ያስተዳድሩ።" : "Create a secure account to manage import services, documents, and transit requests in one place."}</p>
          </div>
          <div className="space-y-3 border-t border-white/15 pt-6 text-sm text-slate-200/85">{[isAm ? "የተጠበቀ የተጠቃሚ መረጃ" : "Protected account information", isAm ? "የተደራጀ የአገልግሎት መዳረሻ" : "Organized service access", isAm ? "የሚታይ የጥያቄ ሂደት" : "Clear request progress"].map((item) => <div key={item} className="flex items-center gap-3"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-400/15 text-cyan-200"><Check className="h-3 w-3" /></span>{item}</div>)}</div>
        </div>
      </aside>

      <section className="px-5 py-7 sm:px-10 sm:py-10 lg:px-12 xl:px-16">
        <div className="mb-8 flex justify-end"><Link href={`/${lang}/auth/login`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition hover:text-cyan-700"><ArrowLeft className="h-3.5 w-3.5" />{isAm ? "ወደ መግቢያ" : "Back to sign in"}</Link></div>
        <div className="mb-8 max-w-xl"><div className="mb-4 inline-flex items-center gap-2 rounded-full bg-cyan-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-700"><span className="h-1.5 w-1.5 rounded-full bg-cyan-500" />{isAm ? "የተጠቃሚ ምዝገባ" : "Account registration"}</div><h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{isAm ? "አዲስ አካውንት ይፍጠሩ" : "Create your account"}</h2><p className="mt-3 text-sm leading-6 text-slate-500">{isAm ? "የእርስዎን መረጃ ያስገቡ።" : "Set up your secure profile. It only takes a few minutes to get started."}</p></div>
        {(localError || storeError) && (
          <div className="mb-6">
            <Alert
              title={localError || storeError}
              description={
                accountConflict ? (
                  isAm ? (
                    <>አስቀድሞ አካውንት ካለዎት <Link href={`/${lang}/auth/login`} className="font-semibold underline">ይግቡ</Link>።</>
                  ) : (
                    <>Already have an account? <Link href={`/${lang}/auth/login`} className="font-semibold underline">Sign in</Link>.</>
                  )
                ) : undefined
              }
              type="error"
              showIcon
              closable
            />
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-7">
          <section><div className="mb-4 flex items-center gap-3"><span className="text-xs font-bold tracking-[0.16em] text-slate-400">01</span><h3 className="text-sm font-bold text-slate-800">{isAm ? "የግል መረጃ" : "Personal information"}</h3><span className="h-px flex-1 bg-slate-100" /></div><div className="grid gap-4 sm:grid-cols-2"><div><Label>{isAm ? "ስም" : "First name"}</Label>{input("firstName", User, isAm ? "ስምዎን ያስገቡ" : "Your first name")}<ErrorText message={errors.firstName?.message} /></div><div><Label>{isAm ? "የአባት ስም" : "Last name"}</Label>{input("lastName", User, isAm ? "የአባት ስም" : "Your last name")}<ErrorText message={errors.lastName?.message} /></div></div></section>
          <section><div className="mb-4 flex items-center gap-3"><span className="text-xs font-bold tracking-[0.16em] text-slate-400">02</span><h3 className="text-sm font-bold text-slate-800">{isAm ? "የመገኛ መረጃ" : "Contact details"}</h3><span className="h-px flex-1 bg-slate-100" /></div><div className="space-y-4"><div><Label>{isAm ? "ኢሜይል አድራሻ" : "Email address"}</Label>{input("email", Mail, "name@example.com", "email")}<ErrorText message={errors.email?.message} /></div><div className="grid gap-4 sm:grid-cols-2"><div><Label>{isAm ? "የመጠቃሚያ ስም" : "Username"}</Label>{input("username", User, "Choose a username")}<ErrorText message={errors.username?.message} /></div><div className="min-w-0"><Label>{isAm ? "ስልክ ቁጥር" : "Phone number"}</Label><Controller name="phonenumber" control={control} render={({ field }) => <PhoneInput country="et" value={field.value} onChange={field.onChange} placeholder="+251 9 12 34 56 78" inputProps={{ name: field.name, required: true, autoComplete: "tel", "aria-label": "Phone number" }} containerStyle={{ width: "100%" }} inputStyle={{ width: "100%", height: "44px", paddingLeft: "58px", paddingRight: "12px", borderRadius: "8px", border: "1px solid #e2e8f0", backgroundColor: "#f8fafc", color: "#0f172a", fontSize: "14px", lineHeight: "44px" }} buttonStyle={{ width: "48px", border: "1px solid #e2e8f0", borderRight: "0", borderRadius: "8px 0 0 8px", backgroundColor: "#f8fafc" }} dropdownClass="!z-50" />} /><ErrorText message={errors.phonenumber?.message} /></div></div></div></section>
          <section><div className="mb-4 flex items-center gap-3"><span className="text-xs font-bold tracking-[0.16em] text-slate-400">03</span><h3 className="text-sm font-bold text-slate-800">{isAm ? "የንግድ መረጃ" : "Business information"}</h3><span className="h-px flex-1 bg-slate-100" /></div><div className="grid gap-4 sm:grid-cols-2">
            {([
              ["businessName", "Business name"],
              ["tinNumber", "TIN"],
              ["businessLicense", "Business license"],
              ["businessAddress", "Business address"],
              ["city", "City"],
              ["state", "State / region"],
              ["postalCode", "Postal code"],
              ["businessType", "Business type"],
              ["importLicense", "Import license"],
              ["importLicenseExpiry", "Import license expiry"],
            ] as const).map(([name, label]) => (
              <div key={name}><Label>{label}</Label>{name === "importLicenseExpiry" ? <Controller name={name} control={control} render={({ field }) => <Input {...field} type="date" className={inputClass} />} /> : input(name, name === "businessAddress" ? MapPin : User, label)}<ErrorText message={errors[name]?.message} /></div>
            ))}
          </div></section>
          <section><div className="mb-4 flex items-center gap-3"><span className="text-xs font-bold tracking-[0.16em] text-slate-400">04</span><h3 className="text-sm font-bold text-slate-800">{isAm ? "የደህንነት መረጃ" : "Account security"}</h3><span className="h-px flex-1 bg-slate-100" /></div><div className="grid gap-4 sm:grid-cols-2"><div><Label>{isAm ? "የይለፍ ቃል" : "Password"}</Label><Controller name="password" control={control} render={({ field }) => <Input.Password {...field} prefix={<Lock className="h-4 w-4 text-slate-400" />} placeholder="At least 8 characters" className={inputClass} />} /><ErrorText message={errors.password?.message} /></div><div><Label>{isAm ? "የይለፍ ቃል ያረጋግጡ" : "Confirm password"}</Label><Controller name="confirmpassword" control={control} render={({ field }) => <Input.Password {...field} prefix={<Lock className="h-4 w-4 text-slate-400" />} placeholder="Repeat your password" className={inputClass} />} /><ErrorText message={errors.confirmpassword?.message} /></div></div></section>
          <section><div className="mb-4 flex items-center gap-3"><span className="text-xs font-bold tracking-[0.16em] text-slate-400">04</span><h3 className="text-sm font-bold text-slate-800">{isAm ? "የመለያ ፎቶ" : "Profile photo"}<span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-slate-400">({isAm ? "አማራጭ" : "optional"})</span></h3><span className="h-px flex-1 bg-slate-100" /></div><label className="group flex cursor-pointer items-center gap-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4 transition hover:border-cyan-500 hover:bg-cyan-50/40"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white text-slate-400 shadow-sm ring-1 ring-slate-200 group-hover:text-cyan-600"><FileImage className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-700">{selectedFile ? selectedFile.name : (isAm ? "ፎቶ ይምረጡ" : "Choose a profile photo")}</span><span className="mt-1 block text-xs text-slate-400">PNG, JPG or WEBP · max 5MB</span></span>{selectedFile ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <Upload className="h-5 w-5 text-slate-400 group-hover:text-cyan-600" />}<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => setSelectedFile(event.target.files?.[0] || null)} /></label></section>
          <div className="border-t border-slate-100 pt-6"><Button type="primary" htmlType="submit" loading={loading} block className="!h-12 !rounded-lg !border-0 !bg-[#0b2942] !text-sm !font-bold !shadow-[0_10px_22px_rgba(11,41,66,0.18)] hover:!bg-cyan-700">{loading ? (isAm ? "እየተመዘገበ ነው..." : "Creating your account...") : (isAm ? "አካውንት ይፍጠሩ" : "Create account")}</Button><p className="mt-4 flex items-center justify-center gap-2 text-center text-[11px] text-slate-400"><ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />{isAm ? "መረጃዎ በደህንነት ይጠበቃል" : "Your information is protected and encrypted"}</p></div>
        </form>
      </section>
    </div>
  );
}
