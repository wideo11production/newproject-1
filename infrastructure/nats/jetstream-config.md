# NATS JetStream Configuration for Wideo11
# Event Streams for Microservices Communication

# Stream Configuration Template
# Each service creates its own stream for publishing events
# Other services consume from relevant streams as needed

# ============================================================================
# STREAM CONFIGURATIONS
# ============================================================================

# AUTH STREAMS
# Events: user registration, login, password reset, 2FA, session management
STREAM_AUTH_EVENTS={
    name: "AUTH_EVENTS",
    subjects: ["auth.>", "user.auth.>", "session.>"],
    retention: "limits",  # or "workqueue" for FIFO processing
    max_msgs: 1000000,
    max_bytes: 5_000_000_000,  # 5GB
    max_age: "720h",  # 30 days
    max_msgs_per_subject: 10000,
    discard: "old",  # discard old when limits exceeded
    storage: "file",  # or "memory" for transient
    num_replicas: 1,
    allow_rollup_hard: true,
    allow_rollup_hard: true,
    description: "Authentication and authorization events"
}

# USER STREAMS
# Events: profile updates, preferences, activity, social connections
STREAM_USER_EVENTS={
    name: "USER_EVENTS",
    subjects: ["user.>", "profile.>", "social.>", "follow.>"],
    retention: "limits",
    max_msgs: 5000000,
    max_bytes: 10_000_000_000,  # 10GB
    max_age: "8760h",  # 365 days
    max_msgs_per_subject: 50000,
    discard: "old",
    storage: "file",
    num_replicas: 1,
    allow_rollup_hard: true,
    description: "User profile, preferences, and social graph events"
}

# BILLING STREAMS
# Events: payments, subscriptions, invoices, refunds, wallet transactions
STREAM_BILLING_EVENTS={
    name: "BILLING_EVENTS",
    subjects: ["billing.>", "payment.>", "subscription.>", "invoice.>", "wallet.>", "refund.>"],
    retention: "limits",
    max_msgs: 1000000,
    max_bytes: 2_000_000_000,  # 2GB
    max_age: "87600h",  # 10 years (financial records)
    max_msgs_per_subject: 10000,
    discard: "old",
    storage: "file",
    num_replicas: 1,
    allow_rollup_hard: true,
    description: "Financial transactions, billing, and payment events"
}

# EDITOR STREAMS
# Events: project creation, editing, rendering, export, collaboration
STREAM_EDITOR_EVENTS={
    name: "EDITOR_EVENTS",
    subjects: ["editor.>", "project.>", "render.>", "export.>", "collab.>", "timeline.>"],
    retention: "limits",
    max_msgs: 2000000,
    max_bytes: 15_000_000_000,  # 15GB (media metadata)
    max_age: "4380h",  # 6 months
    max_msgs_per_subject: 20000,
    discard: "old",
    storage: "file",
    num_replicas: 1,
    allow_rollup_hard: true,
    description: "Video editor project, editing, and media processing events"
}

# VIDEO STREAMS
# Events: upload, transcoding, streaming, playback, analytics
STREAM_VIDEO_EVENTS={
    name: "VIDEO_EVENTS",
    subjects: ["video.>", "upload.>", "transcode.>", "stream.>", "playback.>", "analytics.>"],
    retention: "limits",
    max_msgs: 5000000,
    max_bytes: 50_000_000_000,  # 50GB (media metadata)
    max_age: "8760h",  # 365 days
    max_msgs_per_subject: 50000,
    discard: "old",
    storage: "file",
    num_replicas: 1,
    allow_rollup_hard: true,
    description: "Video upload, transcoding, streaming, and playback events"
}

# ANALYTICS STREAMS
# Events: metrics, events, funnels, retention, conversion
STREAM_ANALYTICS_EVENTS={
    name: "ANALYTICS_EVENTS",
    subjects: ["analytics.>", "metric.>", "event.>", "funnel.>", "conversion.>", "retention.>"],
    retention: "limits",
    max_msgs: 10000000,
    max_bytes: 100_000_000_000,  # 100GB (analytics data)
    max_age: "87600h",  # 10 years
    max_msgs_per_subject: 100000,
    discard: "old",
    storage: "file",
    num_replicas: 1,
    allow_rollup_hard: true,
    description: "Analytics, metrics, events, and business intelligence data"
}

# NOTIFICATION STREAMS
# Events: email, push, sms, in-app notifications
STREAM_NOTIFICATION_EVENTS={
    name: "NOTIFICATION_EVENTS",
    subjects: ["notification.>", "email.>", "push.>", "sms.>", "inapp.>"],
    retention: "limits",
    max_msgs: 1000000,
    max_bytes: 2_000_000_000,  # 2GB
    max_age: "8760h",  # 365 days
    max_msgs_per_subject: 20000,
    discard: "old",
    storage: "file",
    num_replicas: 1,
    allow_rollup_hard: true,
    description: "Notification delivery and tracking events"
}

# WEBSOCKET STREAMS
# Events: real-time updates, presence, typing indicators
STREAM_WEBSOCKET_EVENTS={
    name: "WEBSOCKET_EVENTS",
    subjects: ["ws.>", "presence.>", "typing.>", "realtime.>"],
    retention: "workqueue",  # FIFO for real-time processing
    max_msgs: 100000,
    max_bytes: 500_000_000,  # 500MB
    max_age: "24h",  # 1 day (ephemeral)
    max_msgs_per_subject: 1000,
    discard: "old",
    storage: "memory",
    num_replicas: 1,
    allow_rollup_hard: true,
    description: "Real-time WebSocket events for live updates"
}

# ============================================================================
# CONSUMER CONFIGURATIONS (EXAMPLES)
# ============================================================================

# Example: Auth service consuming user registration events
CONSUMER_AUTH_USER_REGISTRATION={
    stream_name: "USER_EVENTS",
    durable_name: "auth-user-registration-consumer",
    filter_subject: "user.registered",
    ack_policy: "explicit",
    ack_wait: "30s",
    max_deliver: 5,
    back_off: [
        "1s",
        "2s",
        "5s",
        "10s",
        "30s"
    ],
    max_ack_pending: 5000,
    replay_policy: "instant",
    start_seq: 1,
    description: "Consume user registration events to create auth accounts"
}

# Example: Billing service consuming subscription events
CONSUMER_BILLING_SUBSCRIPTION={
    stream_name: "USER_EVENTS",
    durable_name: "billing-subscription-consumer",
    filter_subject: "user.subscription.*",
    ack_policy: "explicit",
    ack_wait: "30s",
    max_deliver: 5,
    back_off: [
        "1s",
        "2s",
        "5s",
        "10s",
        "30s"
    ],
    max_ack_pending: 5000,
    replay_policy: "instant",
    start_seq: 1,
    description: "Consume user subscription events to update billing"
}

# Example: Editor service consuming project events
CONSUMER_EDITOR_PROJECT={
    stream_name: "USER_EVENTS",
    durable_name: "editor-project-consumer",
    filter_subject: "user.project.*",
    ack_policy: "explicit",
    ack_wait: "30s",
    max_deliver: 5,
    back_off: [
        "1s",
        "2s",
        "5s",
        "10s",
        "30s"
    ],
    max_ack_pending: 5000,
    replay_policy: "instant",
    start_seq: 1,
    description: "Consume user project creation events to initialize editor projects"
}

# ============================================================================
# EVENT SCHEMAS (EXAMPLES)
# ============================================================================

# User Registered Event
EVENT_USER_REGISTERED={
    event_id: "uuid",
    user_id: "uuid",
    email: "string",
    username: "string",
    full_name: "string|null",
    created_at: "timestamp",
    metadata: {
        ip_address: "string|null",
        user_agent: "string|null",
        referrer: "string|null"
    }
}

# Video Upload Started Event
EVENT_VIDEO_UPLOAD_STARTED={
    event_id: "uuid",
    user_id: "uuid",
    video_id: "uuid",
    filename: "string",
    filesize: "integer",
    mime_type: "string",
    upload_started_at: "timestamp",
    upload_url: "string|null",
    metadata: {
        ip_address: "string|null",
        user_agent: "string|null"
    }
}

# Subscription Created Event
EVENT_SUBSCRIPTION_CREATED={
    event_id: "uuid",
    user_id: "uuid",
    subscription_id: "uuid",
    plan_id: "string",
    amount: "decimal",
    currency: "string",
    billing_cycle: "string",
    starts_at: "timestamp",
    ends_at: "timestamp|null",
    metadata: {
        ip_address: "string|null",
        payment_method_id: "string|null"
    }
}

# ============================================================================
# NATS SERVER CONFIGURATION (for reference)
# ============================================================================

# The NATS server in docker-compose.yml already has JetStream enabled:
# command: ["-js", "-m", "8222"]
#
# To add stream configurations via CLI:
# nats stream add AUTH_EVENTS --subjects "auth.>" --retention limits --max-msgs 1000000 --max-bytes 5000000000 --max-age 720h --discard old
#
# To add consumers:
# nats consumer add AUTH_EVENTS auth-user-registration-consumer --filter-subject "user.registered" --ack explicit --ack-wait 30s --max-deliver 5 --back-off 1s,2s,5s,10s,30s --replay instant --start-sequence 1

# ============================================================================
# SERVICE INTEGRATION EXAMPLES
# ============================================================================

# Auth Service -> Publishes to USER_EVENTS when user registers
# User Service -> Consumes from AUTH_EVENTS when user logs in/out
# Billing Service -> Consumes from USER_EVENTS when user subscribes
# Editor Service -> Consumes from USER_EVENTS when user creates project
# Analytics Service -> Consumes from ALL STREAMS for metrics aggregation

# ============================================================================
# MONITORING AND ALERTING
# ============================================================================

# Prometheus metrics to scrape from NATS server:
# - nats_server_connections
# - nats_server_slow_consumers
# - nats_server_mem
# - nats_server_cpu
#
# Alert rules:
# - High memory usage (>80%)
# - Slow consumers detected
# - Message backlog growing
# - Consumer lag increasing