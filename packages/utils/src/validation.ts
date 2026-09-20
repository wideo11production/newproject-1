import { z } from "zod";

export const emailSchema = z.string().email("Invalid email address").max(254);
export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(128, "Password must be at most 128 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character");

export const pinSchema = z
  .string()
  .length(6, "PIN must be exactly 6 digits")
  .regex(/^\d{6}$/, "PIN must contain only digits");

export const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(30, "Username must be at most 30 characters")
  .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores")
  .refine((val: string) => !val.startsWith("_"), "Username cannot start with underscore")
  .refine((val: string) => !val.endsWith("_"), "Username cannot end with underscore");

export const urlSchema = z.string().url("Invalid URL").max(2048);
export const slugSchema = z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "Invalid slug");

export const videoTitleSchema = z.string().min(1, "Title is required").max(100, "Title too long");
export const videoDescriptionSchema = z.string().max(5000, "Description too long").optional();
export const videoTagsSchema = z.array(z.string().min(1).max(30)).max(15, "Max 15 tags");

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sort: z.string().optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export const dateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const idParamSchema = z.object({
  id: z.string().uuid("Invalid ID format"),
});

export const uuidSchema = z.string().uuid("Invalid UUID format");
export const cuidSchema = z.string().cuid("Invalid CUID format");

export function createEnumSchema<T extends string>(values: [T, ...T[]], message = "Invalid value") {
  return z.enum(values, { errorMap: () => ({ message }) });
}

export function optionalString(maxLength?: number) {
  let schema = z.string();
  if (maxLength) schema = schema.max(maxLength);
  return schema.optional();
}

export function requiredString(minLength = 1, maxLength?: number) {
  let schema = z.string().min(minLength);
  if (maxLength) schema = schema.max(maxLength);
  return schema;
}

export const jsonSchema = z.record(z.unknown());
export const timestampSchema = z.string().datetime();
export const isoDateSchema = z.string().date();

export const fileUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  mimetype: z.string().min(1).max(100),
  size: z.number().int().positive(),
  checksum: z.string().optional(),
});

export const coordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const ipAddressSchema = z.string().ip({ version: "v4" }).or(z.string().ip({ version: "v6" }));
export const userAgentSchema = z.string().max(500);
export const refererSchema = z.string().url().optional().nullable();

export type Email = z.infer<typeof emailSchema>;
export type Password = z.infer<typeof passwordSchema>;
export type PIN = z.infer<typeof pinSchema>;
export type Username = z.infer<typeof usernameSchema>;
export type PaginationParams = z.infer<typeof paginationSchema>;
export type DateRange = z.infer<typeof dateRangeSchema>;