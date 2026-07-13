export const PUSH_APP_NAME = 'Friends Bingo';

export const pushNotificationMessages = {
  registrationOpen: {
    title: 'ምዝገባ ክፍት ነው',
    body: (gameName: string) =>
      `የ${gameName} ምዝገባ ክፍት ነው። ይቀላቀሉ እና ካርቴላዎችን ይመዝገቡ።`,
  },
  bigGameRegistrationOpen: {
    title: 'የትልቅ ጨዋታ ምዝገባ ክፍት ነው',
    body: (gameName: string) =>
      `የ${gameName} ምዝገባ ክፍት ነው። ካርቴላዎችን አሁን ይዘዙ።`,
  },
  gameStarted: {
    title: (gameName: string) => `${gameName} ጀመረ`,
    body: (gameLabel: string) =>
      `${gameLabel} አሁን በቀጥታ ነው። ይቀላቀሉ እና የተጠሩትን ቁጥሮች ይከተሉ።`,
  },
  bonusGameStarted: {
    title: 'ቦነስ ጨዋታ ጀመረ',
    body: (gameName: string) =>
      `ነጻ ${gameName} አሁን በቀጥታ ነው። ለመጫወት መተግበሪያውን ይክፈቱ።`,
  },
  winnerWindowStarted: {
    title: 'የድል መስኮት ተጀመረ',
    body: 'ትክክለኛ ቢንጎ ተገኝቷል። በቀጥታው ጨዋታ ውስጥ የድል መስኮቱን ይከታተሉ።',
  },
  bigGameTomorrow: {
    title: 'ትልቅ ጨዋታ ነገ',
    body: (prize: string) => `የትልቅ ጨዋታ ሽልምና ${prize} ብር ነገ ይጀመራል።`,
  },
  bigGameToday: {
    title: 'ትልቅ ጨዋታ ዛሬ',
    body: (prize: string) => `የትልቅ ጨዋታ ሽልምና ${prize} ብር ለዛሬ ታድሷል።`,
  },
  gameFinished: {
    title: (gameName: string) => `${gameName} ተጠናቀቀ`,
    body: (gameLabel: string) =>
      `${gameLabel} ተጠናቅቋል። ውጤቱን ለማየት መተግበሪያውን ይክፈቱ።`,
  },
  winnerAnnouncement: {
    title: 'የቢንጎ ድል ተረጋገጠ',
    body: (gameName: string) =>
      `እንኳን ደስ አለዎት! በ${gameName} ውስጥ አሸነፉ።`,
  },
  depositApproved: {
    title: 'ተቀማጭ ጸድቋል',
    body: (amount: string) =>
      `ተቀማጭዎ ተሳክቷል። ${amount} ብር ወደ ቦርሳዎ ተጨመረ።`,
  },
  withdrawalCompleted: {
    title: 'ውጣት ተጠናቀቀ',
    body: (amount: string) => `የ${amount} ብር ውጣትዎ ተጠናቅቋል።`,
  },
  withdrawalRejected: {
    title: 'ውጣት ተቀባይነት አላገኘም',
    body: (amount: string, adminNote?: string | null) => {
      const noteSuffix = adminNote?.trim() ? ` ${adminNote.trim()}` : '';
      return `የ${amount} ብር ውጣትዎ ተቀባይነት አላገኘም።${noteSuffix}`;
    },
  },
  defaultGameName: 'የFriends Bingo ጨዋታ',
} as const;
