import React, { useEffect } from 'react';
import { router } from 'expo-router';
import { registerAndStore } from '@/lib/authClient';
import { AuthForm } from '@/components/AuthForm';
import { trackOnboardingScreenView } from '@/lib/analytics';

export default function WelcomeEmailScreen() {
  useEffect(() => {
    trackOnboardingScreenView('email');
  }, []);

  async function handleSubmit({
    name,
    email,
    password,
  }: {
    name?: string;
    email: string;
    password: string;
  }) {
    await registerAndStore(name ?? '', email, password);
    router.replace('/welcome/height');
  }

  return (
    <AuthForm
      mode="register"
      onSubmit={handleSubmit}
      footerText="Already have an account?"
      footerLinkText="Log in"
      onFooterPress={() => router.replace('/auth/login')}
    />
  );
}
