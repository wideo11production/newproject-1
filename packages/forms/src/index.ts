import { useForm, UseFormProps, UseFormReturn, FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ReactNode } from 'react';

export const useFormWithSchema = <T extends z.ZodType<any, any>>(
  schema: T,
  options?: Omit<UseFormProps<z.infer<T>>, 'resolver'>
): UseFormReturn<z.infer<T>> => {
  return useForm<z.infer<T>>({
    resolver: zodResolver(schema),
    ...options,
  });
};

export const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  remember: z.boolean().optional(),
});

export const RegisterSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export const ProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  bio: z.string().max(500, 'Bio must be under 500 characters').optional(),
  website: z.string().url('Invalid URL').optional().or(z.literal('')),
});

export const PaymentSchema = z.object({
  cardNumber: z.string().length(16, 'Card number must be 16 digits'),
  expiry: z.string().regex(/^\d{2}\/\d{2}$/, 'Invalid expiry date'),
  cvv: z.string().length(3, 'CVV must be 3 digits'),
});

export const CommentSchema = z.object({
  content: z.string().min(1, 'Comment cannot be empty').max(1000, 'Comment is too long'),
});

export const SearchSchema = z.object({
  query: z.string().min(2, 'Search query must be at least 2 characters'),
  filters: z.object({
    type: z.enum(['all', 'videos', 'channels', 'users']).default('all'),
    duration: z.enum(['all', 'short', 'medium', 'long']).default('all'),
    sort: z.enum(['relevance', 'views', 'date', 'rating']).default('relevance'),
  }).optional(),
});

export const NotificationPreferencesSchema = z.object({
  email: z.object({
    marketing: z.boolean().default(false),
    notifications: z.boolean().default(true),
    updates: z.boolean().default(true),
  }),
  push: z.object({
    video: z.boolean().default(true),
    comments: z.boolean().default(true),
    live: z.boolean().default(false),
    ads: z.boolean().default(false),
    system: z.boolean().default(true),
  }),
  quietHours: z.object({
    enabled: z.boolean().default(false),
    start: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format').default('22:00'),
    end: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format').default('08:00'),
    timezone: z.string().default('UTC'),
  }),
});

export const SettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('dark'),
  language: z.string().default('en'),
  autoplay: z.boolean().default(true),
  captions: z.boolean().default(false),
  playbackSpeed: z.number().min(0.25).max(2).default(1),
  quality: z.enum(['auto', 'lowest', 'low', 'medium', 'high', 'highest']).default('auto'),
});

export { z };
export { zodResolver };
export type { UseFormProps, UseFormReturn };

export interface FormFieldProps {
  name: string;
  label?: string;
  description?: string;
  disabled?: boolean;
  hideLabel?: boolean;
}

export interface FormSectionProps {
  title?: string;
  description?: string;
  children: ReactNode;
}

export const FormSchema = z;
export const FormResolver = zodResolver;

export interface SubmitHandler<T> {
  (data: T): void | Promise<void>;
}

export const defaultFormOptions = {
  mode: 'onBlur' as const,
  reValidateMode: 'onChange' as const,
};
