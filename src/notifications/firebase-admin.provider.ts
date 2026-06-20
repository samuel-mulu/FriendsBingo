import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, cert, getApps, initializeApp } from 'firebase-admin/app';

export const FIREBASE_ADMIN_APP = Symbol('FIREBASE_ADMIN_APP');

export const firebaseAdminProvider: Provider = {
  provide: FIREBASE_ADMIN_APP,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): App => {
    const projectId = configService.getOrThrow<string>('FIREBASE_PROJECT_ID');
    const nodeEnv = configService.get<string>('NODE_ENV');
    const existingApp = getApps().find((app) => app.name === '[DEFAULT]');
    if (existingApp) {
      return existingApp;
    }

    if (nodeEnv === 'test') {
      return initializeApp({ projectId });
    }

    const clientEmail = configService.getOrThrow<string>(
      'FIREBASE_CLIENT_EMAIL',
    );
    const privateKey = configService
      .getOrThrow<string>('FIREBASE_PRIVATE_KEY')
      .replace(/\\n/g, '\n');

    return initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      projectId,
    });
  },
};
