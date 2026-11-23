import 'dotenv/config';
import { Bot } from 'grammy';
import {
  TELEGRAM_BOT_COMMANDS_AM,
  TELEGRAM_BOT_COMMANDS_EN,
  TELEGRAM_MENU_BUTTON_TEXT,
} from '../src/telegram/telegram.constants';
import { normalizeHttpsMiniappUrl } from '../src/telegram/telegram-formatting.util';

async function main() {
  console.log('====================================================');
  console.log('🤖 Friends Bingo Backend — Telegram Bot Setup CLI');
  console.log('====================================================\n');

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    console.error('❌ Error: TELEGRAM_BOT_TOKEN is not set in environment or .env file.');
    console.error('   Please add TELEGRAM_BOT_TOKEN to your .env file.');
    process.exit(1);
  }

  const bot = new Bot(token);
  const args = process.argv.slice(2);

  const isInfo = args.includes('--info');
  const isDeleteWebhook = args.includes('--delete-webhook');
  const allowNoSecret = args.includes('--allow-no-secret');
  const webhookIdx = args.indexOf('--webhook');
  const webhookUrlArg =
    webhookIdx !== -1 && args[webhookIdx + 1] ? args[webhookIdx + 1].trim() : undefined;

  try {
    // 1. Authenticate with Telegram
    console.log('📡 Connecting to Telegram Bot API...');
    const me = await bot.api.getMe();
    console.log(`✅ Authenticated as: ${me.first_name} (@${me.username}) [ID: ${me.id}]\n`);

    // 2. Handle --info mode
    if (isInfo) {
      console.log('📋 Current Webhook Info:');
      const webhookInfo = await bot.api.getWebhookInfo();
      console.log(`   • URL: ${webhookInfo.url || '(none — long polling mode)'}`);
      console.log(`   • Has custom certificate: ${webhookInfo.has_custom_certificate}`);
      console.log(`   • Pending updates: ${webhookInfo.pending_update_count}`);
      if (webhookInfo.last_error_date) {
        console.log(
          `   • Last error date: ${new Date(webhookInfo.last_error_date * 1000).toISOString()}`,
        );
        console.log(`   • Last error message: ${webhookInfo.last_error_message}`);
      }
      if (webhookInfo.ip_address) {
        console.log(`   • IP Address: ${webhookInfo.ip_address}`);
      }
      console.log('\n✅ Info retrieved successfully.');
      return;
    }

    // 3. Handle --delete-webhook mode
    if (isDeleteWebhook) {
      console.log('🧹 Removing active webhook for polling development...');
      await bot.api.deleteWebhook({ drop_pending_updates: false });
      console.log('✅ Webhook removed successfully. Long-polling mode is now active.');
      return;
    }

    // 4. Register Commands (English & Amharic)
    console.log('⚙️  Registering bot commands (English)...');
    await bot.api.setMyCommands([...TELEGRAM_BOT_COMMANDS_EN]);
    console.log('   ✅ English commands registered.');

    console.log('⚙️  Registering bot commands (Amharic)...');
    await bot.api.setMyCommands([...TELEGRAM_BOT_COMMANDS_AM], {
      language_code: 'am',
    });
    console.log('   ✅ Amharic commands registered.');

    // 5. Configure Chat Menu Button (Persistent WebApp Launcher)
    const rawMiniappUrl = process.env.TELEGRAM_MINIAPP_URL;
    const miniappUrl = normalizeHttpsMiniappUrl(rawMiniappUrl);

    if (miniappUrl) {
      console.log(`\n📱 Setting Chat Menu Button to: ${miniappUrl}...`);
      await bot.api.setChatMenuButton({
        menu_button: {
          type: 'web_app',
          text: TELEGRAM_MENU_BUTTON_TEXT,
          web_app: {
            url: miniappUrl,
          },
        },
      });
      console.log('   ✅ Chat Menu Button configured successfully.');
    } else {
      console.warn(
        '\n⚠️  Warning: TELEGRAM_MINIAPP_URL is not set or not HTTPS. Skipping Menu Button setup.',
      );
    }

    // 6. Handle Webhook Registration if requested
    if (webhookUrlArg) {
      if (!webhookUrlArg.startsWith('https://')) {
        console.error('❌ Error: Telegram Webhook URL must use HTTPS protocol.');
        process.exit(1);
      }

      const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
      if (!secretToken && !allowNoSecret) {
        console.error(
          '❌ Error: TELEGRAM_WEBHOOK_SECRET is not configured in .env.',
        );
        console.error(
          '   Pass a secret in your environment or use --allow-no-secret for local testing.',
        );
        process.exit(1);
      }

      console.log(`\n🔗 Registering Webhook to: ${webhookUrlArg}...`);
      await bot.api.setWebhook(webhookUrlArg, {
        secret_token: secretToken || undefined,
        drop_pending_updates: false,
        allowed_updates: ['message', 'callback_query'],
      });
      console.log('   ✅ Webhook registered successfully.');
    } else {
      console.log('\n💡 Tip: To register the webhook endpoint, run:');
      console.log('   npm run telegram:setup -- --webhook https://<your-backend-domain>/telegram/webhook');
    }

    console.log('\n====================================================');
    console.log('🎉 Telegram Bot Setup Complete!');
    console.log('====================================================');
  } catch (err: any) {
    console.error('❌ Failed to setup bot:', err?.message || err);
    process.exit(1);
  }
}

main();
