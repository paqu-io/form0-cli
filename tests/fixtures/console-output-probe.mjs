import test from 'node:test';
import assert from 'node:assert/strict';

console.log('🦙 console fixture import');
process.once('exit', () => console.log('🦙 console fixture exit'));

test('console output fixture retains assertions', () => {
  console.log('🦙 log %s', 'formatted');
  console.info('🦙 info');
  console.debug('🦙 debug');
  console.dir({ text: '🦙 dir' });
  console.table([{ text: '🦙 table' }]);
  console.group('🦙 group');
  console.log('🦙 grouped log');
  console.groupEnd();
  console.count('🦙 count');
  console.time('🦙 timer');
  console.timeEnd('🦙 timer');
  if (process.env.FORM0_TEST_CONSOLE_FAIL === '1') assert.fail('expected console fixture failure');
});
