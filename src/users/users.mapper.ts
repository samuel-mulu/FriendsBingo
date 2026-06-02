import { serializeWallet } from '../wallet/wallet.mapper';
import { UserProfile, UserProfileWithWallet } from './users.select';

export function serializeUser(user: UserProfile) {
  return user;
}

export function serializeUserWithWallet(user: UserProfileWithWallet) {
  return {
    ...user,
    wallet: user.wallet ? serializeWallet(user.wallet) : null,
  };
}
