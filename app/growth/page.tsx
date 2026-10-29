import type { Metadata } from 'next';
import { GrowthDetailPage } from '@/components/growth-detail-page';

export const metadata: Metadata = { title: '성장 상세 — J에게 (To J)' };

export default function GrowthPage() {
  return <GrowthDetailPage />;
}
