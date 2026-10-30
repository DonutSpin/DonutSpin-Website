import { z } from 'zod';
import { compactAmount, parseAmount } from '../../shared/amount.ts';

export interface AmountSchemaOptions {
  min?: number;
  max?: number;
  maxAbs?: number;
  allowNegative?: boolean;
  allowZero?: boolean;
  label?: string;
}

/**
 * Accepts a number or a human amount string such as `100k`, `2.5M`, `5B`
 * or `1T`, then validates the parsed integer. The parsed number is what the
 * route receives.
 */
export function amountSchema(options: AmountSchemaOptions = {}) {
  const { max, maxAbs, allowNegative = false, allowZero = false, label } = options;
  const min = options.min ?? (allowNegative ? -Number.MAX_SAFE_INTEGER : allowZero ? 0 : 1);
  const subject = label ? `${label} amount` : 'amount';

  return z.unknown().transform((raw, ctx): number => {
    const parsed =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? parseAmount(raw, { allowNegative })
          : null;

    if (parsed === null || !Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      ctx.addIssue({
        code: 'custom',
        message: `Enter a valid ${subject}, for example 100k, 2.5M, 5B or 1T.`,
      });
      return z.NEVER;
    }
    if (!allowZero && parsed === 0) {
      ctx.addIssue({ code: 'custom', message: 'Amount cannot be zero.' });
      return z.NEVER;
    }
    if (parsed < min) {
      ctx.addIssue({ code: 'custom', message: `Must be at least ${compactAmount(min)}.` });
      return z.NEVER;
    }
    if (max !== undefined && parsed > max) {
      ctx.addIssue({ code: 'custom', message: `Must be at most ${compactAmount(max)}.` });
      return z.NEVER;
    }
    if (maxAbs !== undefined && Math.abs(parsed) > maxAbs) {
      ctx.addIssue({ code: 'custom', message: `Must be between -${compactAmount(maxAbs)} and ${compactAmount(maxAbs)}.` });
      return z.NEVER;
    }
    return parsed;
  });
}
