import webPush from "web-push";
import { config } from "../config.js";

export type PushMessage = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type PushSender = {
  send(subscription: PushMessage, payload: string): Promise<void>;
};

type PushConfiguration = { configured: boolean; state: "online" | "not_configured" | "error"; message: string; publicKey?: string };

let configuration: PushConfiguration;
if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY && config.VAPID_SUBJECT) {
  try {
    webPush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);
    configuration = { configured: true, state: "online", message: "Web Push is geconfigureerd.", publicKey: config.VAPID_PUBLIC_KEY };
  } catch {
    configuration = { configured: false, state: "error", message: "De Web Push-configuratie is ongeldig." };
  }
} else {
  const partiallyConfigured = Boolean(config.VAPID_PUBLIC_KEY || config.VAPID_PRIVATE_KEY);
  configuration = partiallyConfigured
    ? { configured: false, state: "error", message: "De Web Push-configuratie is onvolledig." }
    : { configured: false, state: "not_configured", message: "Web Push is nog niet geconfigureerd." };
}

export const pushConfiguration = configuration;

export const webPushSender: PushSender = {
  async send(subscription, payload) {
    await webPush.sendNotification(subscription, payload, { TTL: 60, urgency: "high" });
  }
};

export function pushFailure(error: unknown): { category: string; expired: boolean; temporary: boolean; safeMessage: string } {
  const statusCode = typeof error === "object" && error !== null && "statusCode" in error
    ? (error as { statusCode?: unknown }).statusCode : undefined;
  if (statusCode === 404 || statusCode === 410) {
    return { category: "SUBSCRIPTION_GONE", expired: true, temporary: false, safeMessage: "Pushabonnement is verlopen." };
  }
  if (statusCode === 408 || statusCode === 429 || (typeof statusCode === "number" && statusCode >= 500)) {
    return { category: "TEMPORARY_PROVIDER_ERROR", expired: false, temporary: true, safeMessage: "Pushprovider tijdelijk niet bereikbaar." };
  }
  return { category: "PROVIDER_ERROR", expired: false, temporary: false, safeMessage: "Pushmelding kon niet worden afgeleverd." };
}
