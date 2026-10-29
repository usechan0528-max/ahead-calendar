import type { Metadata } from 'next';
import { AccountProfileSettings } from '@/components/account-profile-settings';

export const metadata: Metadata = { title: '내 프로필 — J에게 (To J)', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default function ProfilePage() {
  return <AccountProfileSettings />;
}
