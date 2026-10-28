import { Prisma } from "@prisma/client";
import { GOAL_MATCH_TOLERANCE, MACRO_DIMENSIONS, activeTarget, type MacroTargets } from "@fitsy/shared";

/** Shuffle uses the existing close-fit policy without widening targets or the search area. */
export function macroQualificationSql(targets: MacroTargets): Prisma.Sql {
  const conditions = MACRO_DIMENSIONS.map(key => {
    const column = Prisma.raw(`m."${key}"`), target = targets[key];
    return activeTarget(target)
      ? Prisma.sql`${column} BETWEEN ${target! * (1 - GOAL_MATCH_TOLERANCE)}::double precision AND ${target! * (1 + GOAL_MATCH_TOLERANCE)}::double precision`
      : Prisma.sql`${column} >= 0 AND ${column} < 'Infinity'::double precision`;
  });
  return Prisma.sql`(${Prisma.join(conditions, ' AND ')})`;
}
/** SQL and JS use the same active dimensions and normalization. Integration tests compare both. */
export function macroScoreSumSql(targets: MacroTargets, alias = "m"): Prisma.Sql {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid SQL alias");
  const terms = MACRO_DIMENSIONS.filter(k => activeTarget(targets[k])).map(k => {
    const column = Prisma.raw(`${alias}."${k}"`), target = targets[k]!;
    return Prisma.sql`power((${column} - ${target}::double precision) / ${target}::double precision, 2)`;
  });
  return terms.length ? Prisma.sql`(${Prisma.join(terms, " + ")})` : Prisma.sql`0::double precision`;
}
