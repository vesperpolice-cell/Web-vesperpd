import type { Metadata } from 'next';
import { ProctorPanel } from '@/components/forms/ProctorPanel';
import './proctor.css';

export const metadata: Metadata = {
  title: 'Proctor - VES-PD Police Department',
};

export default function ProctorPage() {
  return <ProctorPanel />;
}
