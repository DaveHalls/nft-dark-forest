'use client';

import Notification from './Notification';
import { useNotificationContext } from '@/contexts/NotificationContext';

export default function NotificationContainer() {
  const { notifications, removeNotification } = useNotificationContext();

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {notifications.map((notification) => (
        <Notification
          key={notification.id}
          message={notification.message}
          type={notification.type}
          onClose={() => removeNotification(notification.id)}
        />
      ))}
    </div>
  );
}

