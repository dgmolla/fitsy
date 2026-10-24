import { z } from 'zod';

export const flagsSchema = z.record(z.string().regex(/^[A-Z][A-Z0-9_]*$/), z.boolean());
