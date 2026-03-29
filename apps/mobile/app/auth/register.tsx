import React from 'react';
import { router } from 'expo-router';
import { registerAndStore } from '@/lib/authClient';
import { AuthForm } from '@/components/AuthForm';

export default function RegisterScreen() {
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
    const encodedName = name ? encodeURIComponent(name) : '';
    router.replace(encodedName ? `/onboarding?name=${encodedName}` : '/onboarding');
  }

  return (
    <AuthForm
      mode="register"
      onSubmit={handleSubmit}
      footerText="Already have an account?"
      footerLinkText="Log in"
      onFooterPress={() => router.back()}
    />
  );
}
