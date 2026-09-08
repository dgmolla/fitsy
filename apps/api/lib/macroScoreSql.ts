import { Prisma } from "@prisma/client";
import { MACRO_DIMENSIONS, activeTarget, type MacroTargets } from "@fitsy/shared";
/** SQL and JS use the same active dimensions and normalization. Integration tests compare both. */
export function macroScoreSumSql(targets: MacroTargets, alias = "m"): Prisma.Sql {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid SQL alias");
  const terms = MACRO_DIMENSIONS.filter(k => activeTarget(targets[k])).map(k => {
    const column = Prisma.raw(`${alias}."${k}"`), target = targets[k]!;
    return Prisma.sql`power((${column} - ${target}::double precision) / ${target}::double precision, 2)`;
  });
  return terms.length ? Prisma.sql`(${Prisma.join(terms, " + ")})` : Prisma.sql`0::double precision`;
}
