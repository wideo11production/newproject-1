export const NATS_STREAMS = {
  VIDEO: "VIDEO",
  WALLET: "WALLET",
  ADS: "ADS",
  NOTIFICATION: "NOTIFICATION",
  AUDIT: "AUDIT",
  USER: "USER",
  EDITOR: "EDITOR",
} as const;

export const NATS_SUBJECTS = {
  VIDEO: {
    UPLOADED: "VIDEO.uploaded",
    PROCESSING: "VIDEO.processing",
    COMPLETED: "VIDEO.completed",
    FAILED: "VIDEO.failed",
    THUMBNAIL: "VIDEO.thumbnail",
    SUBTITLE: "VIDEO.subtitle",
    DELETED: "VIDEO.deleted",
    VIEW: "VIDEO.view",
    LIKE: "VIDEO.like",
    SHARE: "VIDEO.share",
  },
  WALLET: {
    TRANSACTION: "WALLET.transaction",
    BALANCE_CHANGE: "WALLET.balance_change",
    WITHDRAWAL: "WALLET.withdrawal",
    ROYALTY: "WALLET.royalty",
    DEPOSIT: "WALLET.deposit",
    REFUND: "WALLET.refund",
  },
  ADS: {
    IMPRESSION: "ADS.impression",
    CLICK: "ADS.click",
    CONVERSION: "ADS.conversion",
    REVENUE: "ADS.revenue",
    CAMPAIGN_START: "ADS.campaign_start",
    CAMPAIGN_END: "ADS.campaign_end",
  },
  NOTIFICATION: {
    PUSH: "NOTIFICATION.push",
    EMAIL: "NOTIFICATION.email",
    IN_APP: "NOTIFICATION.in_app",
    SMS: "NOTIFICATION.sms",
    BROADCAST: "NOTIFICATION.broadcast",
  },
  AUDIT: {
    AUTH_LOGIN: "AUDIT.auth.login",
    AUTH_LOGOUT: "AUDIT.auth.logout",
    AUTH_FAILED: "AUDIT.auth.failed",
    ADMIN_ACTION: "AUDIT.admin.action",
    SECURITY_EVENT: "AUDIT.security.event",
    COMPLIANCE: "AUDIT.compliance",
  },
  USER: {
    CREATED: "USER.created",
    UPDATED: "USER.updated",
    DELETED: "USER.deleted",
    DEVICE_ADDED: "USER.device_added",
    DEVICE_REMOVED: "USER.device_removed",
    SESSION_CREATED: "USER.session_created",
    SESSION_REVOKED: "USER.session_revoked",
    PREFERENCES_CHANGED: "USER.preferences_changed",
  },
  EDITOR: {
    PROJECT_CREATED: "EDITOR.project_created",
    PROJECT_UPDATED: "EDITOR.project_updated",
    PROJECT_DELETED: "EDITOR.project_deleted",
    ASSET_UPLOADED: "EDITOR.asset_uploaded",
    RENDER_STARTED: "EDITOR.render_started",
    RENDER_COMPLETED: "EDITOR.render_completed",
    RENDER_FAILED: "EDITOR.render_failed",
    EXPORT_STARTED: "EDITOR.export_started",
    EXPORT_COMPLETED: "EDITOR.export_completed",
    AUTOSAVE: "EDITOR.autosave",
  },
} as const;

export type NatsStream = (typeof NATS_STREAMS)[keyof typeof NATS_STREAMS];
export type NatsSubject = string;

export const CONSUMER_GROUPS = {
  VIDEO_PROCESSOR: "video-processor",
  THUMBNAIL_GENERATOR: "thumbnail-generator",
  TRANSCODING_WORKER: "transcoding-worker",
  WALLET_PROCESSOR: "wallet-processor",
  ROYALTY_CALCULATOR: "royalty-calculator",
  AD_DELIVERY: "ad-delivery",
  AD_ANALYTICS: "ad-analytics",
  PUSH_SENDER: "push-sender",
  EMAIL_SENDER: "email-sender",
  IN_APP_NOTIFIER: "in-app-notifier",
  AUDIT_LOGGER: "audit-logger",
  SEARCH_INDEXER: "search-indexer",
  RECOMMENDATION_UPDATER: "recommendation-updater",
  EDITOR_SYNC: "editor-sync",
} as const;

export type ConsumerGroup = (typeof CONSUMER_GROUPS)[keyof typeof CONSUMER_GROUPS];