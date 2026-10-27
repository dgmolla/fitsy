// Keep regex escaping outside ${...}: Maestro skips inline expressions with extra $ signs.
// Live restaurant and dish names must match literally, including regex punctuation.
output.restaurant = output.restaurant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
output.dish = output.dish.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
