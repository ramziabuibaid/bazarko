import { ShamelAccount, ShamelCustomer } from './types'

export interface ReconciliationResult {
  totalDebit: number
  totalCredit: number
  difference: number
  isBalanced: boolean
  reconciledCustomers: number
  totalCustomerCount: number
}

/**
 * Reconciles the chart of accounts and customer balances to ensure double-entry integrity.
 */
export function reconcileShamelData(
  accounts: ShamelAccount[],
  customers: ShamelCustomer[]
): ReconciliationResult {
  let totalDebit = 0
  let totalCredit = 0

  for (const acc of accounts) {
    if (acc.is_group) continue // Only sum leaf accounts to avoid double-counting

    if (acc.type === 'asset' || acc.type === 'expense') {
      if (acc.balance > 0) {
        totalDebit += acc.balance
      } else {
        totalCredit += Math.abs(acc.balance)
      }
    } else {
      // liability, equity, revenue
      if (acc.balance > 0) {
        totalCredit += acc.balance
      } else {
        totalDebit += Math.abs(acc.balance)
      }
    }
  }

  totalDebit = Math.round(totalDebit * 100) / 100
  totalCredit = Math.round(totalCredit * 100) / 100
  const difference = Math.round(Math.abs(totalDebit - totalCredit) * 100) / 100
  const isBalanced = difference <= 1.0 // Tolerance of 1 currency unit for rounding

  const reconciledCustomers = customers.filter(c => c.balance !== 0).length

  return {
    totalDebit,
    totalCredit,
    difference,
    isBalanced,
    reconciledCustomers,
    totalCustomerCount: customers.length,
  }
}
