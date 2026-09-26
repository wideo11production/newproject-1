-- Local development ke liye alag-alag databases create karte hain
-- Ye script sirf pehli baar (empty data directory) chalti hai
-- billing-service, dashboard-service aur webhook-receiver ko apna-apna database chahiye

-- Dashboard service database
CREATE DATABASE dashboard;

-- Webhook receiver database
CREATE DATABASE webhook_receiver;

-- Billing service database (ledger, wallet, invoices)
CREATE DATABASE billing_service;

-- Auth service database (users, sessions, devices, PINs, refresh tokens)
CREATE DATABASE auth_service;
