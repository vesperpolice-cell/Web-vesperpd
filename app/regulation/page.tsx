import type { Metadata } from 'next';
import { RegulationView } from '@/components/forms/RegulationView';

export const metadata: Metadata = {
  title: 'ข้อปฏิบัติ - VES-PD Police Department',
};

export default function RegulationPage() {
  return <RegulationView />;
}
