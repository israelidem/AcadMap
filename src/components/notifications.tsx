/**
 * Notification centre + browser notifications.
 *
 * Permission is only requested after an explicit user action. The in-app centre
 * is the fallback whenever browser notifications are unavailable or declined.
 * Reminders are evaluated on a slow interval (no polling of any server).
 */

import { useEffect, useRef, useState } from 'react';
import { Bell, BellRing } from 'lucide-react';
import { addDays, todayStr } from '@shared/time';
import { markAllNotificationsRead, pushNotification } from '@/lib/actions';
import { useSession, useUserData } from '@/lib/hooks';
import { Button, Modal } from './ui';

const CHECK_INTERVAL_MS = 60_000;

export function supportsBrowserNotifications(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!supportsBrowserNotifications()) return 'denied';
  return Notification.requestPermission();
}

function showBrowser(title: string, body: string, tag?: string): void {
  if (!supportsBrowserNotifications() || Notification.permission !== 'granted') return;
  try {
    // `tag` lets the browser collapse a repeat of the same item rather than
    // stacking duplicates in the tray.
    new Notification(title, { body, icon: '/favicon.svg', tag });
  } catch {
    // Some browsers block constructing notifications outside a service worker.
  }
}

/**
 * Delivers published announcements to the notification centre.
 *
 * Announcements used to render as a banner on the dashboard, which every
 * student scrolled past. They are now ordinary notifications: they appear in the
 * bell, count as unread, and raise a browser notification when the student has
 * allowed those.
 *
 * `sourceId` makes the write idempotent, so an announcement is delivered once
 * per student rather than on every mount, and stays delivered after a reload.
 */
export function useAnnouncementDelivery(): void {
  const { user, preferences } = useSession();
  const { announcements } = useUserData(user?.id ?? null);

  useEffect(() => {
    if (!user) return;

    for (const announcement of announcements) {
      const added = pushNotification(user.id, {
        title: announcement.title,
        body: announcement.body,
        kind: 'ANNOUNCEMENT',
        sourceId: announcement.id,
      });
      // Only interrupt for something the student has not already been told.
      if (added && preferences.notificationsEnabled) {
        showBrowser(announcement.title, announcement.body, `announcement-${announcement.id}`);
      }
    }
  }, [user, announcements, preferences.notificationsEnabled]);
}


/** Watches sessions, exams and deadlines and raises reminders once each. */
export function useReminders(): void {
  const { user, preferences } = useSession();
  const { sessions, events } = useUserData(user?.id ?? null);
  const raised = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user || !preferences.notificationsEnabled) return;

    const check = () => {
      const now = new Date();
      const today = todayStr();
      const tomorrow = addDays(today, 1);
      const lead = preferences.reminderLeadMinutes;

      type Kind = 'SESSION' | 'MISSED' | 'EXAM' | 'ASSIGNMENT';
      const raise = (key: string, kind: Kind, title: string, body: string) => {
        if (raised.current.has(key)) return;
        raised.current.add(key);
        pushNotification(user.id, { title, body, kind });
        showBrowser(title, body);
      };

      for (const session of sessions) {
        if (session.status !== 'SCHEDULED') continue;
        const start = new Date(`${session.date}T${session.startTime}`);
        const minutesAway = (start.getTime() - now.getTime()) / 60_000;

        if (minutesAway > 0 && minutesAway <= lead) {
          raise(
            `session-soon-${session.id}`,
            'SESSION',
            'Study session starting soon',
            `Your session starts at ${session.startTime}.`,
          );
        } else if (minutesAway < -15) {
          raise(
            `session-missed-${session.id}`,
            'MISSED',
            'Missed study session',
            `The ${session.startTime} session is still marked scheduled. Complete, skip or reschedule it.`,
          );
        }
      }

      for (const event of events) {
        if (event.date !== today && event.date !== tomorrow) continue;
        const when = event.date === today ? 'today' : 'tomorrow';
        const isAssignment = event.type === 'ASSIGNMENT';
        const label = isAssignment ? 'Assignment due' : `${event.type} coming up`;
        raise(
          `event-${event.id}-${event.date}`,
          isAssignment ? 'ASSIGNMENT' : 'EXAM',
          label,
          `${event.title} is ${when}.`,
        );
      }
    };

    check();
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [user, preferences.notificationsEnabled, preferences.reminderLeadMinutes, sessions, events]);
}

export function NotificationBell() {
  const { user } = useSession();
  const { notifications } = useUserData(user?.id ?? null);
  const [open, setOpen] = useState(false);
  const unread = notifications.filter((notification) => !notification.readAt).length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="am-touch relative grid place-items-center rounded-xl text-muted hover:bg-surface-2"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
      >
        {unread > 0 ? <BellRing className="h-5 w-5 text-brand" /> : <Bell className="h-5 w-5" />}
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger" aria-hidden />
        )}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Notifications"
        footer={
          notifications.length > 0 && user ? (
            <Button variant="secondary" onClick={() => markAllNotificationsRead(user.id)}>
              Mark all as read
            </Button>
          ) : null
        }
      >
        {notifications.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing yet. Reminders for study sessions, exams and deadlines will appear here.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {notifications.map((notification) => (
              <li key={notification.id} className="py-3">
                <div className="flex items-start gap-2">
                  {!notification.readAt && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
                  )}
                  <div>
                    <p className="text-sm font-medium">{notification.title}</p>
                    <p className="text-sm text-muted">{notification.body}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {new Date(notification.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}
