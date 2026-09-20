import { z } from "zod";

export const paginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export const apiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.record(z.unknown()).optional(),
      })
      .optional(),
    meta: z.record(z.unknown()).optional(),
  });

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  username: z.string().min(3).max(30),
  displayName: z.string().max(100).nullable(),
  avatarUrl: z.string().url().nullable(),
  bio: z.string().max(500).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  isVerified: z.boolean(),
  isActive: z.boolean(),
  role: z.enum(["user", "creator", "moderator", "admin", "superadmin"]),
});

export const videoSchema = z.object({
  id: z.string().uuid(),
  title: z.string().max(100),
  description: z.string().max(5000).nullable(),
  channelId: z.string().uuid(),
  channelName: z.string(),
  thumbnailUrl: z.string().url(),
  duration: z.number().int().positive(),
  status: z.enum(["processing", "ready", "failed", "private", "deleted"]),
  visibility: z.enum(["public", "unlisted", "private"]),
  views: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative(),
  dislikes: z.number().int().nonnegative(),
  commentsCount: z.number().int().nonnegative(),
  tags: z.array(z.string()),
  qualities: z.array(z.enum(["144p", "240p", "360p", "480p", "720p", "1080p", "1440p", "2160p", "4320p"])),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable(),
});

export const channelSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string().max(100),
  handle: z.string().max(30),
  description: z.string().max(1000).nullable(),
  avatarUrl: z.string().url().nullable(),
  bannerUrl: z.string().url().nullable(),
  subscribersCount: z.number().int().nonnegative(),
  videosCount: z.number().int().nonnegative(),
  viewsCount: z.number().int().nonnegative(),
  isVerified: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const walletSchema = z.object({
  userId: z.string().uuid(),
  availableBalance: z.number(),
  pendingBalance: z.number(),
  heldBalance: z.number(),
  withdrawableBalance: z.number(),
  currency: z.string().default("INR"),
  updatedAt: z.string().datetime(),
});

export const transactionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: z.enum(["deposit", "withdrawal", "royalty", "ad_revenue", "purchase", "refund", "fee"]),
  amount: z.number(),
  currency: z.string(),
  status: z.enum(["pending", "completed", "failed", "cancelled", "reversed"]),
  description: z.string().nullable(),
  referenceId: z.string().nullable(),
  referenceType: z.string().nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

export const notificationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: z.enum(["video", "comment", "like", "subscription", "system", "wallet", "ads"]),
  title: z.string(),
  message: z.string(),
  data: z.record(z.unknown()).nullable(),
  isRead: z.boolean(),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
});

export const pushSubscriptionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  endpoint: z.string().url(),
  p256dh: z.string(),
  auth: z.string(),
  userAgent: z.string().nullable(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
});

export type Pagination = z.infer<typeof paginationSchema>;
export type User = z.infer<typeof userSchema>;
export type Video = z.infer<typeof videoSchema>;
export type Channel = z.infer<typeof channelSchema>;
export type Wallet = z.infer<typeof walletSchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type PushSubscription = z.infer<typeof pushSubscriptionSchema>;