import type { DesktopNotification } from '../terminal/command-parser';

/** Desktop notification event from a PTY */
export type PtyNotificationEvent = {
  /** PTY identifier */
  ptyId: string;
  /** Notification content */
  notification: DesktopNotification;
  /** Optional subtitle for the notification */
  subtitle?: string;
};

/** Forwarder function type for notifications */
export type NotificationForwarder = (event: PtyNotificationEvent) => void;

let notificationForwarder: NotificationForwarder | null = null;

/**
 * Sets the notification forwarder.
 * @param forwarder - Forwarder function or null to disable
 */
export function setNotificationForwarder(forwarder: NotificationForwarder | null): void {
  notificationForwarder = forwarder;
}

/**
 * Forwards a notification event if a forwarder is set.
 * @param event - Notification event to forward
 * @returns true if forwarded, false if no forwarder set
 */
export function forwardNotification(event: PtyNotificationEvent): boolean {
  if (!notificationForwarder) return false;
  notificationForwarder(event);
  return true;
}
