/** Stateful external API fixture for the real sign-in and completion components. */
export function installAccountProfile(userId: string, initialTarget: { calories: number; proteinG: number; carbsG: number; fatG: number; source: string }) {
  function response(body: unknown) { return { ok: true, status: 200, json: async () => body } as Response; }
  let target = initialTarget;
  global.fetch = jest.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith('/api/auth/login')) return Promise.resolve(response({
      token: 'test-token', refreshToken: 'refresh', user: { id: userId }, isNewUser: false,
    }));
    if (String(url).includes('/api/user/profile')) {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        if (body.macroTarget) target = body.macroTarget;
        return Promise.resolve(response({}));
      }
      return Promise.resolve(response({
        user: { birthday: null, heightCm: null, weightKg: null, sex: null, activityLevel: null, goal: null },
        macroTarget: target,
      }));
    }
    return Promise.resolve(response({ active: true, status: 'active', expiresAt: null }));
  });
  return () => target;
}
