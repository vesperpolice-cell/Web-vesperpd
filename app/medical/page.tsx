import type { Metadata } from 'next';
import { MedicalForm } from '@/components/forms/MedicalForm';

export const metadata: Metadata = {
  title: 'สมัครแพทย์ - VES-PD Medical Department',
};

export default function MedicalPage() {
  return <MedicalForm />;
}
