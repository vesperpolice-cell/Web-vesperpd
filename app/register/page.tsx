import type { Metadata } from 'next';
import { RegisterForm } from '@/components/forms/RegisterForm';

export const metadata: Metadata = {
  title: 'สมัครตำรวจ - VES-PD Police Department',
};

export default function RegisterPage() {
  return <RegisterForm />;
}
