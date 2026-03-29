import React from 'react';
import { router } from 'expo-router';
import { loginAndStore } from '@/lib/authClient';
import { AuthForm } from '@/components/AuthForm';

export default function LoginScreen() {
  async function handleSubmit({ email, password }: { email: string; password: string }) {
    await loginAndStore(email, password);
    router.replace('/(tabs)/search');
  }

  return (
    <AuthForm
      mode="login"
      onSubmit={handleSubmit}
      footerText="Don't have an account?"
      footerLinkText="Create one"
      onFooterPress={() => router.push('/auth/register')}
    />
  );
}
