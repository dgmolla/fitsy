// Keep regex escaping outside ${...}: Maestro skips inline expressions with extra $ signs.
// Live restaurant and dish names must match literally, including regex punctuation.
output.restaurant = output.restaurant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
output.dish = output.dish.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// iOS groups the dish name, match score, price and macros into one menu button label.
output.menuDish = '[\\s\\S]*' + output.dish + '[\\s\\S]*';
