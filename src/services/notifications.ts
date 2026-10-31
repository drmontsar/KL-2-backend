import { getNotificationForUser, listenNotifications } from '../db/queries/notifications';
import { errorDiagnostics, logger } from '../logger';

export async function subscribeNotifications(
  userId: string,
  deliver: (notification: unknown) => Promise<void>,
) {
  const subscription = await listenNotifications(userId, (payload) => {
    const send = async () => {
      const { id } = JSON.parse(payload) as { id: string };
      const notification = await getNotificationForUser(id, userId);
      if (notification) await deliver(notification);
    };
    void send().catch((error: Error) =>
      logger.warn(errorDiagnostics(error), 'notification delivery failed'),
    );
  });
  return () => subscription.unlisten();
}
