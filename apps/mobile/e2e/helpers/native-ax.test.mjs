import test from 'node:test';
import assert from 'node:assert/strict';
import { isNativeFocused, assertNativeValue } from './native-ax.mjs';

const legend = 'One element per line: @ref Type value= id= at=x,y size=WxH [focused]';
const field = '@e31 TextField label="Search" value="pizza" id="discovery-search" at=50,288 size=282x24';

test('the accessibility legend never proves focus', () => {
  assert.equal(isNativeFocused(`${legend}\n${field}`, 'discovery-search'), false);
});
test('focus on another element does not prove search focus', () => {
  assert.equal(isNativeFocused(`${field}\n@e32 TextField id="other" at=0,0 size=100x24 focused`, 'discovery-search'), false);
});
test('only the exact selector with a focused state passes', () => {
  assert.equal(isNativeFocused(`${legend}\n${field} focused`, 'discovery-search'), true);
  assert.equal(isNativeFocused(`${field.replace('discovery-search', 'discovery-search-other')} focused`, 'discovery-search'), false);
});
test('focused label text and ambiguous duplicate selectors fail closed', () => {
  assert.equal(isNativeFocused(field.replace('label="Search"', 'label="at=0,0 size=1x1 focused extra"'), 'discovery-search'), false);
  assert.equal(isNativeFocused(`${field} focused\n${field}`, 'discovery-search'), false);
});
test('assertion reads the actual exact value, not a label or substring', () => {
  assert.doesNotThrow(() => assertNativeValue(field, 'discovery-search', 'pizza'));
  assert.throws(() => assertNativeValue(field, 'discovery-search', 'pizz'), /value mismatch/);
  assert.throws(() => assertNativeValue(field.replace('value="pizza" ', ''), 'discovery-search', 'pizza'), /value mismatch/);
  assert.throws(() => assertNativeValue(field.replace('value="pizza"', 'value="sushi" label="pizza"'), 'discovery-search', 'pizza'), /value mismatch/);
});
