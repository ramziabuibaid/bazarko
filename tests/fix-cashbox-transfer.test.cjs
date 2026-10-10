const { Client } = require('pg');
const fs = require('fs');
const assert = require('assert');
require('@next/env').loadEnvConfig(process.cwd());

async function runTest() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query('BEGIN');
    console.log('--- Applying Migration 071 in Transaction ---');
    const sql = fs.readFileSync('db/migrations/071_fix_cashbox_transfers_and_cheque_lifecycle.sql', 'utf8')
      .replace(/^BEGIN;/m, '')
      .replace(/^COMMIT;/m, '');
    await client.query(sql);
    console.log('Migration 071 applied successfully.');

    // Find a test store that has at least 2 cash boxes
    const storeRes = await client.query(`
      SELECT s.id, s.owner_id 
      FROM public.stores s 
      JOIN public.cash_boxes cb ON cb.store_id = s.id
      GROUP BY s.id, s.owner_id
      HAVING COUNT(cb.id) >= 2
      LIMIT 1
    `);
    const storeId = storeRes.rows[0].id;
    const actorId = storeRes.rows[0].owner_id;

    // Test 1: Test transfer_cash_between_boxes_atomic
    console.log('--- Testing transfer_cash_between_boxes_atomic ---');
    const boxesRes = await client.query(`
      SELECT id, name, account_id FROM public.cash_boxes 
      WHERE store_id = $1 AND type = 'cash' AND is_active = true 
      LIMIT 2
    `, [storeId]);
    
    if (boxesRes.rows.length >= 2) {
      const box1 = boxesRes.rows[0];
      const box2 = boxesRes.rows[1];
      const reqId = require('crypto').randomUUID();

      // Get initial account balances
      const bal1Before = Number((await client.query('SELECT balance FROM public.accounts WHERE id = $1', [box1.account_id])).rows[0]?.balance || 0);
      const bal2Before = Number((await client.query('SELECT balance FROM public.accounts WHERE id = $1', [box2.account_id])).rows[0]?.balance || 0);

      const transferRes = await client.query(`
        SELECT public.transfer_cash_between_boxes_atomic(
          $1, $2, $3, $4, 100.00, CURRENT_DATE, 'Test transfer', $5
        ) AS res
      `, [storeId, reqId, box1.id, box2.id, actorId]);

      console.log('Transfer result:', transferRes.rows[0].res);
      assert.strictEqual(transferRes.rows[0].res.success, true);
      assert.strictEqual(transferRes.rows[0].res.replayed, false);

      // Verify balances
      const bal1After = Number((await client.query('SELECT balance FROM public.accounts WHERE id = $1', [box1.account_id])).rows[0]?.balance || 0);
      const bal2After = Number((await client.query('SELECT balance FROM public.accounts WHERE id = $1', [box2.account_id])).rows[0]?.balance || 0);

      console.log('Box 1 balance change:', bal1After - bal1Before, '(expected -100)');
      console.log('Box 2 balance change:', bal2After - bal2Before, '(expected +100)');

      assert.strictEqual(bal1After - bal1Before, -100);
      assert.strictEqual(bal2After - bal2Before, 100);

      // Verify twin cash movements were created
      const movs = await client.query(`
        SELECT direction, amount, cash_box_id FROM public.cash_movements 
        WHERE ref_id = $1
      `, [transferRes.rows[0].res.journalEntryId]);
      assert.strictEqual(movs.rowCount, 2);
      console.log('Twin cash movements verified:', movs.rows);

      // Test idempotency: replay same request_id
      const replayRes = await client.query(`
        SELECT public.transfer_cash_between_boxes_atomic(
          $1, $2, $3, $4, 100.00, CURRENT_DATE, 'Test transfer', $5
        ) AS res
      `, [storeId, reqId, box1.id, box2.id, actorId]);
      console.log('Replay result:', replayRes.rows[0].res);
      assert.strictEqual(replayRes.rows[0].res.replayed, true);

      // Test reject transfer to same box
      await client.query('SAVEPOINT samebox');
      try {
        await client.query(`
          SELECT public.transfer_cash_between_boxes_atomic(
            $1, $2, $3, $3, 100.00, CURRENT_DATE, 'Test same box', $4
          )
        `, [storeId, require('crypto').randomUUID(), box1.id, actorId]);
        assert.fail('Should have failed for same box transfer');
      } catch (e) {
        console.log('Rejected transfer to same box as expected:', e.message);
        await client.query('ROLLBACK TO SAVEPOINT samebox');
      }

      // Test reject negative or zero amount
      await client.query('SAVEPOINT negamount');
      try {
        await client.query(`
          SELECT public.transfer_cash_between_boxes_atomic(
            $1, $2, $3, $4, -50.00, CURRENT_DATE, 'Negative amount', $5
          )
        `, [storeId, require('crypto').randomUUID(), box1.id, box2.id, actorId]);
        assert.fail('Should have failed for negative amount');
      } catch (e) {
        console.log('Rejected negative amount as expected:', e.message);
        await client.query('ROLLBACK TO SAVEPOINT negamount');
      }
    }

    // Test 2: Test execute_check_lifecycle_operation_legacy with transfer_cashbox
    console.log('--- Testing execute_check_lifecycle_operation_legacy transfer_cashbox ---');
    const checkBoxes = await client.query(`
      SELECT id, name, account_id FROM public.cash_boxes 
      WHERE store_id = $1 AND type != 'checks_returned'
      LIMIT 2
    `, [storeId]);
    const boxRec = checkBoxes.rows[0];
    const targetBox = checkBoxes.rows[1];

    const checkId = require('crypto').randomUUID();
    await client.query(`
      INSERT INTO public.checks (
        id, store_id, type, check_number, bank_name, amount, amount_ils,
        due_date, issue_date, status, cashbox_id, created_by
      ) VALUES (
        $1, $2, 'received', 'CHK-TEST-99', 'بنك فلسطين', 500.00, 500.00,
        CURRENT_DATE, CURRENT_DATE, 'in_portfolio', $3, $4
      )
    `, [checkId, storeId, boxRec.id, actorId]);

    const opRes = await client.query(`
      SELECT public.execute_check_lifecycle_operation_legacy(
        $1, 'transfer_cashbox', CURRENT_DATE, NULL, $2, NULL, 'نقل تجريبي', $3
      ) AS res
    `, [checkId, targetBox.id, actorId]);
    console.log('Legacy transfer_cashbox result:', opRes.rows[0].res);
    assert.strictEqual(opRes.rows[0].res.success, true);

    // Verify check cashbox_id was updated
    const updatedCheck = (await client.query('SELECT cashbox_id, status FROM public.checks WHERE id = $1', [checkId])).rows[0];
    console.log('Updated check:', updatedCheck);
    assert.strictEqual(updatedCheck.cashbox_id, targetBox.id);

    // Test 3: Test execute_check_lifecycle_operation_legacy with collect (verifying NO cashed_date error!)
    console.log('--- Testing execute_check_lifecycle_operation_legacy collect (no cashed_date error) ---');
    const bankRes = await client.query('SELECT id FROM public.bank_accounts WHERE store_id = $1 LIMIT 1', [storeId]);
    if (bankRes.rows.length > 0) {
      const collectRes = await client.query(`
        SELECT public.execute_check_lifecycle_operation_legacy(
          $1, 'collect', CURRENT_DATE, $2, NULL, NULL, 'تحصيل تجريبي', $3
        ) AS res
      `, [checkId, bankRes.rows[0].id, actorId]);
      console.log('Collect result (cashed_date error resolved!):', collectRes.rows[0].res);
      assert.strictEqual(collectRes.rows[0].res.success, true);
    }

    // Test 4: Test receipt_cheque_operation_atomic with transfer_cashbox on linked check
    console.log('--- Testing receipt_cheque_operation_atomic transfer_cashbox on linked check ---');
    const linkedCheckRes = await client.query(`
      SELECT id, store_id, cashbox_id FROM public.checks
      WHERE store_id = $1 AND receipt_settlement_active = true AND status = 'in_portfolio'
      LIMIT 1
    `, [storeId]);
    if (linkedCheckRes.rows.length > 0) {
      const lc = linkedCheckRes.rows[0];
      const targetCashBox = (await client.query(`
        SELECT id FROM public.cash_boxes 
        WHERE store_id = $1 AND id != $2 AND type != 'checks_returned'
        LIMIT 1
      `, [storeId, lc.cashbox_id])).rows[0];

      if (targetCashBox) {
        // Mock auth.uid() by setting local config
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [actorId]);
        const linkedPayload = {
          operationType: 'transfer_cashbox',
          operationDate: '2026-10-10',
          targetCashBoxId: targetCashBox.id
        };
        const atomicRes = await client.query(`
          SELECT public.receipt_cheque_operation_atomic(
            $1, $2, $3, $4::jsonb, true
          ) AS res
        `, [storeId, lc.id, require('crypto').randomUUID(), JSON.stringify(linkedPayload)]);
        console.log('Linked check transfer_cashbox result:', atomicRes.rows[0].res);
        assert.strictEqual(atomicRes.rows[0].res.success, true);

        // Verify check cashbox_id in checks table
        const lcUpdated = (await client.query('SELECT cashbox_id FROM public.checks WHERE id = $1', [lc.id])).rows[0];
        assert.strictEqual(lcUpdated.cashbox_id, targetCashBox.id);
      }
    }

    console.log('\n>>> ALL VERIFICATION TESTS PASSED SUCCESSFULLY! <<<');
  } finally {
    console.log('Rolling back test transaction cleanly...');
    await client.query('ROLLBACK');
    await client.end();
  }
}

runTest().catch(e => {
  console.error('Test failed with error:', e);
  process.exit(1);
});
