import type { Prisma } from "@prisma/client";

export type AprilSnapshot = Prisma.MenuItemGetPayload<{ include: { macroEstimates: true } }>;
export interface AprilJournal { before: AprilSnapshot; after: AprilSnapshot }
