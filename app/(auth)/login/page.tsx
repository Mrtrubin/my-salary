"use client";

/**
 * 登录 / 注册页：React Hook Form + Zod 校验。
 * 登录：用户名 + 密码，经 auth-login Edge Function 验证（支持中文等 UTF-8 用户名）。
 * 注册：用户名 + 密码 + 选填邮箱 / 姓名，经 auth-register Edge Function 创建账号。
 * 认证逻辑统一经 lib/api/auth.ts，页面不直接引用 supabase 客户端。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField, Input } from "@/components/ui/input";
import { Logo } from "@/components/logo";
import { USERNAME_PATTERN, LOGIN_USERNAME_PATTERN, signInWithPassword, signUpWithUsername, signOut } from "@/lib/api/auth";
import { getCurrentProfile } from "@/lib/api/data";
import { keys } from "@/lib/api/hooks";
import { writeCachedProfile } from "@/lib/api/profile-cache";
import { ApiError, ApiErrorCode } from "@/lib/api/contracts/errors";

const loginSchema = z.object({
  username: z
    .string()
    .min(1, "请输入用户名")
    .max(32, "用户名最多 32 位")
    .regex(LOGIN_USERNAME_PATTERN, "用户名为 1-32 位非空白字符"),
  password: z.string().min(1, "请输入密码"),
});

const registerSchema = z.object({
  username: z
    .string()
    .min(3, "用户名至少 3 位")
    .max(32, "用户名最多 32 位")
    .regex(USERNAME_PATTERN, "仅支持小写字母、数字、下划线和连字符"),
  password: z.string().min(6, "密码至少 6 位").max(64, "密码最多 64 位"),
  confirmPassword: z.string().min(1, "请再次输入密码"),
  email: z.string().email("邮箱格式不正确").or(z.literal("")).optional(),
  name: z.string().max(32, "姓名最多 32 位").optional(),
}).refine((values) => values.password === values.confirmPassword, {
  message: "两次输入的密码不一致",
  path: ["confirmPassword"],
});

type LoginForm = z.infer<typeof loginSchema>;
type RegisterForm = z.infer<typeof registerSchema>;

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loginForm = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });
  const registerForm = useForm<RegisterForm>({ resolver: zodResolver(registerSchema) });

  const onLogin = async (values: LoginForm) => {
    setSubmitError(null);
    try {
      await signInWithPassword({
        username: values.username,
        password: values.password,
      });      const profile = await getCurrentProfile();
      if (!profile) {
        await signOut();
        setSubmitError("账号尚未关联成员资料，请联系管理员");
        return;
      }
      if (profile.status === "disabled") {
        await signOut();
        setSubmitError("账号已停用，请联系管理员");
        return;
      }
      queryClient.clear();
      queryClient.setQueryData(keys.profile, profile);
      writeCachedProfile(profile);
      router.push(profile.system_role === "admin" ? "/admin" : "/user/dashboard");
    } catch (error) {
      if (error instanceof ApiError && error.code === ApiErrorCode.UNAUTHENTICATED) {
        setSubmitError("用户名或密码错误，请重试");
      } else if (error instanceof ApiError && error.code === ApiErrorCode.FORBIDDEN) {
        setSubmitError(error.message || "账号已停用，请联系管理员");
      } else if (error instanceof ApiError && error.code === ApiErrorCode.INVALID_INPUT) {
        setSubmitError(error.message || "输入不合法");
      } else {
        setSubmitError("登录失败，请稍后再试");
      }
    }
  };

  const onRegister = async (values: RegisterForm) => {
    setSubmitError(null);
    try {
      await signUpWithUsername({
        username: values.username,
        password: values.password,
        email: values.email || undefined,
        name: values.name || undefined,
      });
      // 注册成功后直接登录
      await signInWithPassword({
        username: values.username,
        password: values.password,
      });
      const profile = await getCurrentProfile();
      if (!profile) {
        await signOut();
        setSubmitError("注册成功，但账号资料异常，请重新登录");
        return;
      }
      queryClient.clear();
      queryClient.setQueryData(keys.profile, profile);
      writeCachedProfile(profile);
      router.push(profile.system_role === "admin" ? "/admin" : "/user/dashboard");
    } catch (error) {
      if (error instanceof ApiError && error.code === ApiErrorCode.INVALID_INPUT) {
        setSubmitError(error.message);
      } else {
        setSubmitError("注册失败，请稍后再试");
      }
    }
  };

  const switchMode = (next: "login" | "register") => {
    setSubmitError(null);
    loginForm.clearErrors();
    registerForm.clearErrors();
    setMode(next);
  };

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo
            size={80}
            rounded="rounded-2xl"
            priority
            className="mx-auto mb-4"
          />
          <p className="text-sm font-medium tracking-widest text-indigo-600">
            MY SALARY
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
            SALARY财务管理系统
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {mode === "login" ? "请使用用户名登录" : "创建新账号"}
          </p>
        </div>

        <Card className="px-6 py-6">
          {mode === "login" ? (
            <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4" noValidate>
              <FormField label="用户名" error={loginForm.formState.errors.username?.message}>
                <Input
                  type="text"
                  placeholder="用户名"
                  autoComplete="username"
                  {...loginForm.register("username")}
                />
              </FormField>
              <FormField label="密码" error={loginForm.formState.errors.password?.message}>
                <Input
                  type="password"
                  placeholder="密码"
                  autoComplete="current-password"
                  {...loginForm.register("password")}
                />
              </FormField>
              {submitError && (
                <p className="text-sm text-red-600" role="alert">
                  {submitError}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={loginForm.formState.isSubmitting}>
                {loginForm.formState.isSubmitting ? "登录中…" : "登 录"}
              </Button>
            </form>
          ) : (
            <form onSubmit={registerForm.handleSubmit(onRegister)} className="space-y-4" noValidate>
              <FormField label="用户名" error={registerForm.formState.errors.username?.message} hint="3-32 位小写字母、数字、下划线或连字符">
                <Input
                  type="text"
                  placeholder="用户名"
                  autoComplete="username"
                  {...registerForm.register("username")}
                />
              </FormField>
              <FormField label="密码" error={registerForm.formState.errors.password?.message} hint="至少 6 位">
                <Input
                  type="password"
                  placeholder="至少 6 位"
                  autoComplete="new-password"
                  {...registerForm.register("password")}
                />
              </FormField>
              <FormField label="确认密码" error={registerForm.formState.errors.confirmPassword?.message}>
                <Input
                  type="password"
                  placeholder="再次输入密码"
                  autoComplete="new-password"
                  {...registerForm.register("confirmPassword")}
                />
              </FormField>
              <FormField label="邮箱（选填）" error={registerForm.formState.errors.email?.message} hint="用于接收通知，可留空">
                <Input
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  {...registerForm.register("email")}
                />
              </FormField>
              <FormField label="姓名（选填）" error={registerForm.formState.errors.name?.message}>
                <Input
                  type="text"
                  placeholder="真实姓名（可选）"
                  autoComplete="name"
                  {...registerForm.register("name")}
                />
              </FormField>
              {submitError && (
                <p className="text-sm text-red-600" role="alert">
                  {submitError}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={registerForm.formState.isSubmitting}>
                {registerForm.formState.isSubmitting ? "注册中…" : "注 册"}
              </Button>
            </form>
          )}
        </Card>

        <div className="mt-4 text-center">
          {mode === "login" ? (
            <button
              type="button"
              className="text-sm text-indigo-600 hover:underline"
              onClick={() => switchMode("register")}
            >
              还没有账号？立即注册
            </button>
          ) : (
            <button
              type="button"
              className="text-sm text-indigo-600 hover:underline"
              onClick={() => switchMode("login")}
            >
              已有账号？返回登录
            </button>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          登录即代表同意平台数据安全与薪酬保密规范
        </p>
      </div>
    </main>
  );
}
