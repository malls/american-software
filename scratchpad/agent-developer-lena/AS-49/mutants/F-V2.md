# F-V2
scratch /tmp/as49-mut/F-V2, project asc-impl-as49-mut-fv2
before: anchor count 1 (expected 1)
after: "'e2e-loop.test.js'" = 0 (expected 0)
after: "found.length, 19" = 1 (expected 1)
after: "found.length, 20" = 0 (expected 0)

## diff
--- test/harness.test.js (tip)
+++ test/harness.test.js (F-V2)
@@ -69,7 +69,6 @@
   'db.test.js',
   'dependency-policy.test.js',
   'deploy-shape.test.js',
-  'e2e-loop.test.js',
   'harness.test.js',
   'health.test.js',
   'invoice-screen.test.js',
@@ -85,7 +84,7 @@
 test('V2: the suite is exactly the files it is supposed to be', () => {
   const found = discoverTestFiles();
   // Cardinality FIRST, against a committed number — never `length > 0`.
-  assert.equal(found.length, 20, `expected exactly 20 test files, found ${found.length}: ${found.join(', ')}`);
+  assert.equal(found.length, 19, `expected exactly 19 test files, found ${found.length}: ${found.join(', ')}`);
   assert.deepEqual(found, EXPECTED_TEST_FILES);
 });
 


## test: exit 1; Image asc-impl-as49-mut-fv2-test Built; ℹ tests 458 ℹ pass 438 ℹ fail 1 ℹ skipped 19
red set (1):
  ✖ V2: the suite is exactly the files it is supposed to be
messages:
  AssertionError [ERR_ASSERTION]: expected exactly 19 test files, found 20: assets.test.js, auth.test.js, clients.test.js, config.test.js, connect.test.js, contracts.test.js, db.test.js, dependency-policy.test.js, deploy-shape.test.js, e2e-loop.test.js, harness.test.js, health.test.js, invoice-screen.test.js, invoices.test.js, repositories.test.js, route-surface.test.js, screens.test.js, stripe-client.test.js, stripe-mock.test.js, webhooks.test.js
  actual: 20,
  expected: 19,
down exit 0
