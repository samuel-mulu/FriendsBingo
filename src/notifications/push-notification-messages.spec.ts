import { pushNotificationMessages } from './push-notification-messages';

describe('push-notification-messages', () => {
  it('uses Amharic copy for game registration pushes', () => {
    expect(pushNotificationMessages.registrationOpen.title).toBe('ምዝገባ ክፍት ነው');
    expect(pushNotificationMessages.registrationOpen.body('Evening Bingo')).toContain(
      'Evening Bingo',
    );
    expect(pushNotificationMessages.bigGameRegistrationOpen.title).toBe(
      'የትልቅ ጨዋታ ምዝገባ ክፍት ነው',
    );
  });

  it('uses Amharic copy for wallet pushes', () => {
    expect(pushNotificationMessages.depositApproved.title).toBe('ተቀማጭ ጸድቋል');
    expect(pushNotificationMessages.depositApproved.body('100')).toContain('100');
    expect(pushNotificationMessages.withdrawalCompleted.title).toBe('ውጣት ተጠናቀቀ');
    expect(pushNotificationMessages.withdrawalRejected.title).toBe(
      'ውጣት ተቀባይነት አላገኘም',
    );
  });

  it('uses Amharic copy for winner pushes', () => {
    expect(pushNotificationMessages.winnerAnnouncement.title).toBe(
      'የቢንጎ ድል ተረጋገጠ',
    );
    expect(
      pushNotificationMessages.winnerAnnouncement.body('500', 'Evening Bingo', 'A1'),
    ).toContain('500');
  });
});
