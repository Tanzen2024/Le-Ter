import type { UserId } from '../../domain/users/user';
import type {
  AppNotification,
  TournamentRepository,
} from '../../repositories/tournament.repository';

const NOTIFICATIONS_LIMIT = 50;

/**
 * Notifications dans l'application (D-054) : écrites par les services dans la transaction
 * de l'événement, lues ici. Pas de push (FCM, T-02) : la source reste PostgreSQL. Un joueur
 * ne lit et ne marque que les siennes (identité issue du JWT).
 */
export class NotificationService {
  constructor(
    private readonly repository: Pick<
      TournamentRepository,
      'listNotifications' | 'markNotificationRead'
    >,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async list(userId: UserId): Promise<{ notifications: AppNotification[]; unread: number }> {
    // Notifications différées (D-117) : seulement celles déjà visibles sur l'horloge du serveur.
    const notifications = await this.repository.listNotifications(
      userId,
      NOTIFICATIONS_LIMIT,
      this.clock(),
    );
    return { notifications, unread: notifications.filter((n) => !n.readAt).length };
  }

  /** false : notification inconnue ou appartenant à un autre joueur. */
  markRead(userId: UserId, notificationId: string): Promise<boolean> {
    return this.repository.markNotificationRead(userId, notificationId, this.clock());
  }
}
