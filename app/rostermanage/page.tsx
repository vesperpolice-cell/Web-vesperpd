import type { Metadata } from 'next';
import { RosterManagePanel } from '@/components/forms/RosterManagePanel';
import './rostermanage.css';

export const metadata: Metadata = {
  title: 'จัดการสถานะ - VES-PD Police Department',
};

export default function RosterManagePage() {
  return <RosterManagePanel />;
}
