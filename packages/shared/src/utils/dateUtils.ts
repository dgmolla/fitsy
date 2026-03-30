/**
 * Compute age in whole years from a birthday.
 * Age increments on the birthday itself (not the day before).
 */
export function calculateAge(birthday: Date | string): number {
  const birth = typeof birthday === "string" ? new Date(birthday) : birthday;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birth.getDate())
  ) {
    age--;
  }
  return age;
}
