import type { Metadata } from 'next';
import { PoliceHub } from '@/components/police/PoliceHub';

export const metadata: Metadata = {
  title: 'ศูนย์รวมระบบตำรวจ - VES-PD Police Department',
};

export default function PolicePage() {
  return <PoliceHub />;
}
