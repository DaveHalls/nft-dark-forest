'use client';

import { useState, useCallback } from 'react';

export interface NotificationData {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export function useNotification() {
  const [notifications, setNotifications] = useState<NotificationData[]>([]);

  const showNotification = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now().toString();
    setNotifications(prev => [...prev, { id, message, type }]);
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const success = useCallback((message: string) => {
    showNotification(message, 'success');
  }, [showNotification]);

  const error = useCallback((message: string) => {
    showNotification(message, 'error');
  }, [showNotification]);

  const info = useCallback((message: string) => {
    showNotification(message, 'info');
  }, [showNotification]);

  return {
    notifications,
    showNotification,
    removeNotification,
    success,
    error,
    info,
  };
}

