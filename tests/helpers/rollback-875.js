'use strict';
// (v9.7.875) THE B-2 STEP 2 ROLLBACK, FOR THE SUITES THAT TEST THE PROBE MACHINERY. Build 875 ships the three fact probes, the
// v9.7.559 commit observer and the verbal-commitment pattern switched off (one reader per fact). Each switch is the rollback, and
// these suites keep proving that the machinery behind it still works: they read the build with the switches turned back to their
// pre-875 values, which is the build exactly as it was before 875 for everything they assert. The shipped values are asserted
// separately in tests/b2-hours-875.test.js. On a build before 875 every replacement is a no-op.
module.exports = function rollback875(src) {
  return String(src)
    .replace('var LEADPRO_COMMIT_COMPREHENSION = false;', 'var LEADPRO_COMMIT_COMPREHENSION = true;')
    .replace(/var LEADPRO_(VERBALCOMMIT|DAYLOCK|OFFFRANCHISE)_COMPREHENSION(\s*)= false;/g, 'var LEADPRO_$1_COMPREHENSION$2= true;')
    .replace('var LEADPRO_VERBALCOMMIT_REGEX = false;', 'var LEADPRO_VERBALCOMMIT_REGEX = true;');
};
