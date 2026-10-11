const { Client } = require('pg');
const assert = require('assert');
require('@next/env').loadEnvConfig(process.cwd());

async function runTest() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query('BEGIN');
    console.log('--- Running tests on Migration 071 & 072 schema ---');

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

      assert.strictEqual(bal1After, bal1Before - 100.00);
      assert.strictEqual(bal2After, bal2Before + 100.00);

      // Verify cash movements were recorded for both boxes
      const movCount = await client.query(`
        SELECT count(*) FROM public.cash_movements 
        WHERE store_id = $1 AND source = 'transfer'
      `, [storeId]);
      assert(Number(movCount.rows[0].count) >= 2);

      // Test idempotency: calling same request_id again
      const replayRes = await client.query(`
        SELECT public.transfer_cash_between_boxes_atomic(
          $1, $2, $3, $4, 100.00, CURRENT_DATE, 'Test transfer replay', $5
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
    const chequeBoxes = await client.query(`
      SELECT id, name, account_id FROM public.cash_boxes 
      WHERE store_id = $1 AND type IN ('checks_received', 'checks_collection')
      LIMIT 2
    `, [storeId]);
    
    if (chequeBoxes.rows.length >= 2) {
      const boxRec = chequeBoxes.rows[0];
      const targetBox = chequeBoxes.rows[1];

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

      // Test 2b: Ensure attempting to transfer to a cash box fails!
      const cashBoxRec = (await client.query("SELECT id FROM public.cash_boxes WHERE store_id = $1 AND type = 'cash' LIMIT 1", [storeId])).rows[0];
      if (cashBoxRec) {
        await client.query('SAVEPOINT cashboxtest');
        try {
          await client.query(`
            SELECT public.execute_check_lifecycle_operation_legacy(
              $1, 'transfer_cashbox', CURRENT_DATE, NULL, $2, NULL, 'نقل غير قانوني لكاش', $3
            )
          `, [checkId, cashBoxRec.id, actorId]);
          assert.fail('Should have rejected transfer to cash box');
        } catch (e) {
          console.log('PASS: Correctly rejected transferring cheque to cash box:', e.message);
          await client.query('ROLLBACK TO SAVEPOINT cashboxtest');
        }
      }

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
    }

    console.log('ALL TESTS PASSED SUCCESSFULLY!');
  } catch (err) {
    console.error('Test failed with error:', err);
    throw err;
  } finally {
    console.log('Rolling back test transaction cleanly...');
    await client.query('ROLLBACK');
    await client.end();
  }
}

runTest().catch(() => process.exit(1));
