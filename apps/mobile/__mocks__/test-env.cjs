// Component tests load authenticated storage indirectly through macro storage.
// Give the Supabase client valid inert configuration before module imports.
process.env.EXPO_PUBLIC_SUPABASE_URL ??= 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??= 'unit-test-anon-key';
