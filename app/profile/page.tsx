import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ProfileClient } from '@/components/profile/ProfileClient';
import { Loading } from '@/components/ui/States';

export const metadata: Metadata = {
  title: 'ประวัติเจ้าหน้าที่ - VES-PD Police Department',
};

export default function ProfilePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loading label="กำลังโหลดข้อมูล..." />
        </div>
      }
    >
      <ProfileClient />
    </Suspense>
  );
}
