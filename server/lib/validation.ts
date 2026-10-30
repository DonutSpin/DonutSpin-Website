import { z, type ZodType } from 'zod';
import { passwordIssues } from './crypto.ts';
import { ApiError } from './core.ts';

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  throw new ApiError(400, 'VALIDATION_ERROR', 'Please check the highlighted fields.', { fields });
}

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters.')
  .max(20, 'Username must be at most 20 characters.')
  .regex(/^[a-zA-Z0-9_]+$/, 'Use letters, numbers, and underscores only.');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Enter a valid email address.')
  .max(254, 'Email is too long.')
  .email('Enter a valid email address.');

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200, 'Use at most 200 characters.')
  .superRefine((value, ctx) => {
    for (const issue of passwordIssues(value)) {
      ctx.addIssue({ code: 'custom', message: issue });
    }
  });

export const ticketCategorySchema = z.string().trim().min(1).max(50);
export const ticketPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export const ticketStatusSchema = z.enum([
  'new',
  'open',
  'in_progress',
  'on_hold',
  'waiting_user',
  'resolved',
  'closed',
  'rejected',
]);

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});
