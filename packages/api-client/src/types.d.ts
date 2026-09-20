import { z } from "zod";
export declare const paginationSchema: z.ZodObject<{
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
    total: z.ZodNumber;
    totalPages: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}, {
    total: number;
    totalPages: number;
    page?: number | undefined;
    limit?: number | undefined;
}>;
export declare const apiResponseSchema: <T extends z.ZodTypeAny>(dataSchema: T) => z.ZodObject<{
    success: z.ZodBoolean;
    data: z.ZodOptional<T>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
        details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        code: string;
        message: string;
        details?: Record<string, unknown> | undefined;
    }, {
        code: string;
        message: string;
        details?: Record<string, unknown> | undefined;
    }>>;
    meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, z.objectUtil.addQuestionMarks<z.baseObjectOutputType<{
    success: z.ZodBoolean;
    data: z.ZodOptional<T>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
        details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        code: string;
        message: string;
        details?: Record<string, unknown> | undefined;
    }, {
        code: string;
        message: string;
        details?: Record<string, unknown> | undefined;
    }>>;
    meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}>, any> extends infer T_1 ? { [k in keyof T_1]: T_1[k]; } : never, z.baseObjectInputType<{
    success: z.ZodBoolean;
    data: z.ZodOptional<T>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
        details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        code: string;
        message: string;
        details?: Record<string, unknown> | undefined;
    }, {
        code: string;
        message: string;
        details?: Record<string, unknown> | undefined;
    }>>;
    meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}> extends infer T_2 ? { [k_1 in keyof T_2]: T_2[k_1]; } : never>;
export declare const userSchema: z.ZodObject<{
    id: z.ZodString;
    email: z.ZodString;
    username: z.ZodString;
    displayName: z.ZodNullable<z.ZodString>;
    avatarUrl: z.ZodNullable<z.ZodString>;
    bio: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    isVerified: z.ZodBoolean;
    isActive: z.ZodBoolean;
    role: z.ZodEnum<["user", "creator", "moderator", "admin", "superadmin"]>;
}, "strip", z.ZodTypeAny, {
    role: "user" | "creator" | "moderator" | "admin" | "superadmin";
    id: string;
    email: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    bio: string | null;
    createdAt: string;
    updatedAt: string;
    isVerified: boolean;
    isActive: boolean;
}, {
    role: "user" | "creator" | "moderator" | "admin" | "superadmin";
    id: string;
    email: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    bio: string | null;
    createdAt: string;
    updatedAt: string;
    isVerified: boolean;
    isActive: boolean;
}>;
export declare const videoSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    channelId: z.ZodString;
    channelName: z.ZodString;
    thumbnailUrl: z.ZodString;
    duration: z.ZodNumber;
    status: z.ZodEnum<["processing", "ready", "failed", "private", "deleted"]>;
    visibility: z.ZodEnum<["public", "unlisted", "private"]>;
    views: z.ZodNumber;
    likes: z.ZodNumber;
    dislikes: z.ZodNumber;
    commentsCount: z.ZodNumber;
    tags: z.ZodArray<z.ZodString, "many">;
    qualities: z.ZodArray<z.ZodEnum<["144p", "240p", "360p", "480p", "720p", "1080p", "1440p", "2160p", "4320p"]>, "many">;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    publishedAt: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "processing" | "ready" | "failed" | "private" | "deleted";
    id: string;
    createdAt: string;
    updatedAt: string;
    title: string;
    description: string | null;
    channelId: string;
    channelName: string;
    thumbnailUrl: string;
    duration: number;
    visibility: "private" | "public" | "unlisted";
    views: number;
    likes: number;
    dislikes: number;
    commentsCount: number;
    tags: string[];
    qualities: ("144p" | "240p" | "360p" | "480p" | "720p" | "1080p" | "1440p" | "2160p" | "4320p")[];
    publishedAt: string | null;
}, {
    status: "processing" | "ready" | "failed" | "private" | "deleted";
    id: string;
    createdAt: string;
    updatedAt: string;
    title: string;
    description: string | null;
    channelId: string;
    channelName: string;
    thumbnailUrl: string;
    duration: number;
    visibility: "private" | "public" | "unlisted";
    views: number;
    likes: number;
    dislikes: number;
    commentsCount: number;
    tags: string[];
    qualities: ("144p" | "240p" | "360p" | "480p" | "720p" | "1080p" | "1440p" | "2160p" | "4320p")[];
    publishedAt: string | null;
}>;
export declare const channelSchema: z.ZodObject<{
    id: z.ZodString;
    userId: z.ZodString;
    name: z.ZodString;
    handle: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    avatarUrl: z.ZodNullable<z.ZodString>;
    bannerUrl: z.ZodNullable<z.ZodString>;
    subscribersCount: z.ZodNumber;
    videosCount: z.ZodNumber;
    viewsCount: z.ZodNumber;
    isVerified: z.ZodBoolean;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    avatarUrl: string | null;
    createdAt: string;
    updatedAt: string;
    isVerified: boolean;
    description: string | null;
    userId: string;
    name: string;
    handle: string;
    bannerUrl: string | null;
    subscribersCount: number;
    videosCount: number;
    viewsCount: number;
}, {
    id: string;
    avatarUrl: string | null;
    createdAt: string;
    updatedAt: string;
    isVerified: boolean;
    description: string | null;
    userId: string;
    name: string;
    handle: string;
    bannerUrl: string | null;
    subscribersCount: number;
    videosCount: number;
    viewsCount: number;
}>;
export declare const walletSchema: z.ZodObject<{
    userId: z.ZodString;
    availableBalance: z.ZodNumber;
    pendingBalance: z.ZodNumber;
    heldBalance: z.ZodNumber;
    withdrawableBalance: z.ZodNumber;
    currency: z.ZodDefault<z.ZodString>;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    updatedAt: string;
    userId: string;
    availableBalance: number;
    pendingBalance: number;
    heldBalance: number;
    withdrawableBalance: number;
    currency: string;
}, {
    updatedAt: string;
    userId: string;
    availableBalance: number;
    pendingBalance: number;
    heldBalance: number;
    withdrawableBalance: number;
    currency?: string | undefined;
}>;
export declare const transactionSchema: z.ZodObject<{
    id: z.ZodString;
    userId: z.ZodString;
    type: z.ZodEnum<["deposit", "withdrawal", "royalty", "ad_revenue", "purchase", "refund", "fee"]>;
    amount: z.ZodNumber;
    currency: z.ZodString;
    status: z.ZodEnum<["pending", "completed", "failed", "cancelled", "reversed"]>;
    description: z.ZodNullable<z.ZodString>;
    referenceId: z.ZodNullable<z.ZodString>;
    referenceType: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodString;
    completedAt: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "deposit" | "withdrawal" | "royalty" | "ad_revenue" | "purchase" | "refund" | "fee";
    status: "pending" | "failed" | "completed" | "cancelled" | "reversed";
    id: string;
    createdAt: string;
    description: string | null;
    userId: string;
    currency: string;
    amount: number;
    referenceId: string | null;
    referenceType: string | null;
    completedAt: string | null;
}, {
    type: "deposit" | "withdrawal" | "royalty" | "ad_revenue" | "purchase" | "refund" | "fee";
    status: "pending" | "failed" | "completed" | "cancelled" | "reversed";
    id: string;
    createdAt: string;
    description: string | null;
    userId: string;
    currency: string;
    amount: number;
    referenceId: string | null;
    referenceType: string | null;
    completedAt: string | null;
}>;
export declare const notificationSchema: z.ZodObject<{
    id: z.ZodString;
    userId: z.ZodString;
    type: z.ZodEnum<["video", "comment", "like", "subscription", "system", "wallet", "ads"]>;
    title: z.ZodString;
    message: z.ZodString;
    data: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    isRead: z.ZodBoolean;
    createdAt: z.ZodString;
    readAt: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    data: Record<string, unknown> | null;
    message: string;
    type: "video" | "comment" | "like" | "subscription" | "system" | "wallet" | "ads";
    id: string;
    createdAt: string;
    title: string;
    userId: string;
    isRead: boolean;
    readAt: string | null;
}, {
    data: Record<string, unknown> | null;
    message: string;
    type: "video" | "comment" | "like" | "subscription" | "system" | "wallet" | "ads";
    id: string;
    createdAt: string;
    title: string;
    userId: string;
    isRead: boolean;
    readAt: string | null;
}>;
export declare const pushSubscriptionSchema: z.ZodObject<{
    id: z.ZodString;
    userId: z.ZodString;
    endpoint: z.ZodString;
    p256dh: z.ZodString;
    auth: z.ZodString;
    userAgent: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodString;
    lastUsedAt: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    auth: string;
    id: string;
    createdAt: string;
    userId: string;
    endpoint: string;
    p256dh: string;
    userAgent: string | null;
    lastUsedAt: string | null;
}, {
    auth: string;
    id: string;
    createdAt: string;
    userId: string;
    endpoint: string;
    p256dh: string;
    userAgent: string | null;
    lastUsedAt: string | null;
}>;
export type Pagination = z.infer<typeof paginationSchema>;
export type User = z.infer<typeof userSchema>;
export type Video = z.infer<typeof videoSchema>;
export type Channel = z.infer<typeof channelSchema>;
export type Wallet = z.infer<typeof walletSchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type PushSubscription = z.infer<typeof pushSubscriptionSchema>;
//# sourceMappingURL=types.d.ts.map