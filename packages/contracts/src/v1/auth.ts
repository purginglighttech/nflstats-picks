/**
 * v1 authentication contracts.
 *
 * Account-enumeration protection (spec, Security baseline): the register,
 * sign-in, and forgot-password endpoints always return the identical
 * success-shaped response regardless of whether the email has an account.
 * Schemas here describe the wire shapes; the uniformity guarantee is
 * enforced server-side.
 */
import { z } from "zod";
import { ApiOkSchema, EntityIdSchema, IsoDateTimeSchema } from "./common.js";

/**
 * Phase-1 password policy (documented choice, not spec text): minimum 12
 * characters. The spec mandates a memory-hard hash (argon2id) but does not
 * set a length floor; 12 is the documented Phase-1 floor and is enforced
 * identically on register and reset.
 */
export const PasswordSchema = z.string().min(12, "Password must be at least 12 characters.").max(256);
export type Password = z.infer<typeof PasswordSchema>;

export const EmailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);
export type Email = z.infer<typeof EmailSchema>;

export const DisplayNameSchema = z
  .string()
  .trim()
  .min(1, "Display name is required.")
  .max(40, "Display name must be 40 characters or fewer.");
export type DisplayName = z.infer<typeof DisplayNameSchema>;

/** POST /api/v1/auth/register */
export const RegisterRequestSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  display_name: DisplayNameSchema,
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

/** POST /api/v1/auth/signin */
export const SigninRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, "Password is required.").max(256),
});
export type SigninRequest = z.infer<typeof SigninRequestSchema>;

/** POST /api/v1/auth/signin — success payload (session travels in an httpOnly cookie). */
export const SigninResponseSchema = z.object({
  ok: z.literal(true),
  user: z.object({
    id: EntityIdSchema,
    email: EmailSchema,
    display_name: DisplayNameSchema,
    email_verified: z.boolean(),
  }),
});
export type SigninResponse = z.infer<typeof SigninResponseSchema>;

/** GET /api/v1/auth/verify?token= — token is the raw 32-byte random value from the email link. */
export const VerifyEmailQuerySchema = z.object({
  token: z.string().min(32, "Verification token is missing or malformed.").max(128),
});
export type VerifyEmailQuery = z.infer<typeof VerifyEmailQuerySchema>;

/** POST /api/v1/auth/forgot-password */
export const ForgotPasswordRequestSchema = z.object({
  email: EmailSchema,
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

/** POST /api/v1/auth/reset-password */
export const ResetPasswordRequestSchema = z.object({
  token: z.string().min(32, "Reset token is missing or malformed.").max(128),
  new_password: PasswordSchema,
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

/** GET /api/v1/auth/me */
export const AuthMeResponseSchema = z.object({
  user: z.object({
    id: EntityIdSchema,
    email: EmailSchema,
    display_name: DisplayNameSchema,
    email_verified: z.boolean(),
    created_at: IsoDateTimeSchema,
  }),
});
export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;

/** Uniform enumeration-safe success shape for register / signin-failure-safe flows. */
export const AuthUniformOkSchema = ApiOkSchema;
export type AuthUniformOk = z.infer<typeof AuthUniformOkSchema>;
