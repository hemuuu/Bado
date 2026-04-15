const WATER_NOTIFICATION_CHANNEL_ID = 'water-mode';
const DAYS_TO_SCHEDULE = 7;
const WATER_SUMMARY_NOTIFICATION_ID = 4999;

function getCapacitor() {
  return window.Capacitor || null;
}

function getLocalNotificationsPlugin() {
  return getCapacitor()?.Plugins?.LocalNotifications || null;
}

function isNativeAndroid() {
  const capacitor = getCapacitor();
  const nativePlatform = typeof capacitor?.isNativePlatform === 'function'
    ? capacitor.isNativePlatform()
    : false;
  return nativePlatform && /Android/i.test(navigator.userAgent);
}

function buildReminderId(dayOffset, slotIndex) {
  return 4000 + dayOffset * 100 + slotIndex;
}

function createReminderDate(baseDate, slot, dayOffset) {
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate() + dayOffset,
    slot.hour,
    slot.minute,
    0,
    0
  );
}

export async function syncNativeWaterReminderSchedule(slots, template = {}) {
  const plugin = getLocalNotificationsPlugin();
  if (!plugin || !isNativeAndroid()) return { scheduled: false, reason: 'plugin-unavailable' };

  const permissionStatus = await plugin.checkPermissions();
  if (permissionStatus.display !== 'granted') {
    const requested = await plugin.requestPermissions();
    if (requested.display !== 'granted') {
      return { scheduled: false, reason: 'permission-denied' };
    }
  }

  await plugin.createChannel?.({
    id: WATER_NOTIFICATION_CHANNEL_ID,
    name: 'Water Mode',
    description: 'Water mode reminders',
    importance: 5,
    visibility: 1
  });

  const pending = await plugin.getPending?.();
  const existingIds = Array.isArray(pending?.notifications)
    ? pending.notifications
        .map((notification) => Number(notification.id))
        .filter((id) => Number.isFinite(id) && id >= 4000 && id < 5000)
    : [];

  if (existingIds.length) {
    await plugin.cancel({ notifications: existingIds.map((id) => ({ id })) });
  }

  const notifications = [];
  const now = new Date();
  for (let dayOffset = 0; dayOffset < DAYS_TO_SCHEDULE; dayOffset++) {
    slots.forEach((slot, slotIndex) => {
      const at = createReminderDate(now, slot, dayOffset);
      if (at.getTime() <= Date.now() + 1000) return;
      notifications.push({
        id: buildReminderId(dayOffset, slotIndex + 1),
        title: template.title || 'Water Mode',
        body: template.message || "hey i am drinking water, i'll be there for 15 minutes .",
        schedule: {
          at,
          allowWhileIdle: true
        },
        smallIcon: 'ic_launcher_foreground',
        channelId: WATER_NOTIFICATION_CHANNEL_ID,
        extra: {
          type: 'water_mode_start',
          slotLabel: slot.label
        }
      });
    });
  }

  if (!notifications.length) {
    return { scheduled: false, reason: 'no-future-slots' };
  }

  await plugin.schedule({ notifications });
  return { scheduled: true, count: notifications.length };
}

export async function showMissedWaterReminderNotification(count, template = {}) {
  if (!count || count < 1) return { shown: false, reason: 'empty-count' };

  const plugin = getLocalNotificationsPlugin();
  const title = template.title || 'Water Mode';
  const body = count === 1
    ? 'You missed 1 water reminder while away.'
    : `You missed ${count} water reminders while away.`;

  if (plugin && isNativeAndroid()) {
    const permissionStatus = await plugin.checkPermissions();
    if (permissionStatus.display !== 'granted') {
      const requested = await plugin.requestPermissions();
      if (requested.display !== 'granted') {
        return { shown: false, reason: 'permission-denied' };
      }
    }

    await plugin.createChannel?.({
      id: WATER_NOTIFICATION_CHANNEL_ID,
      name: 'Water Mode',
      description: 'Water mode reminders',
      importance: 5,
      visibility: 1
    });

    await plugin.schedule({
      notifications: [
        {
          id: WATER_SUMMARY_NOTIFICATION_ID,
          title,
          body,
          schedule: { at: new Date(Date.now() + 1000), allowWhileIdle: true },
          channelId: WATER_NOTIFICATION_CHANNEL_ID,
          smallIcon: 'ic_launcher_foreground',
          extra: {
            type: 'water_mode_missed_summary',
            missedCount: String(count)
          }
        }
      ]
    });
    return { shown: true, mode: 'native' };
  }

  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
    return { shown: true, mode: 'web-notification' };
  }

  console.info('[WaterMode] Missed reminder summary', { count });
  return { shown: false, reason: 'notification-unavailable' };
}
