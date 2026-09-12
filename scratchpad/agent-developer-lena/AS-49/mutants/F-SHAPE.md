# F-SHAPE
scratch /tmp/as49-mut/F-SHAPE, project asc-impl-as49-mut-fshape
before: anchor count 1 (expected 1)
after: "invented_key: 1," = 1 (expected 1)

## diff
--- test/helpers/stripe-double.js (tip)
+++ test/helpers/stripe-double.js (F-SHAPE)
@@ -126,6 +126,7 @@
     const invoice = {
       id: nextId('in'),
       object: 'invoice',
+      invented_key: 1,
       status: 'draft',
       customer: params.get('customer'),
       currency: params.get('currency'),


## test: exit 0; Image asc-impl-as49-mut-fshape-test Built; ℹ tests 458 ℹ pass 439 ℹ fail 0 ℹ skipped 19
red set (0):
messages:
down exit 0

## contract: exit 1; Image asc-impl-as49-mut-fshape-contract Built; ℹ tests 458 ℹ pass 457 ℹ fail 1 ℹ skipped 0
red set (1):
  ✖ E5 (STRIPE DOUBLE vs STRIPE-MOCK): every object the double emits is a key-subset of the mock's spec-derived fixture
messages:
  AssertionError [ERR_ASSERTION]: invoice (draft): the double emits keys the mock's fixture lacks — invented_key
  actual: [ 'invented_key' ],
  expected: [],
down exit 0
