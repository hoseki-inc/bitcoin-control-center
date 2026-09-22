import type { z } from 'zod'
import { Id } from '../id/id.ts'

// 21 chars, similar collision probability as UUIDv4
export const HOSID_SIZE_WITHOUT_PREFIX = Id.SIZE

// nanoid uses a-zA-Z0-9_- by default, but we want to avoid dashes and underscores
export const HOSID_ALPHABET = Id.ALPHABET

const prefixes = [
  // Internal
  '_ctx',

  // API
  // These are generic prefix for API keys, we've given out some of these to early users so we cannot change them
  'ak_live',
  'ak_test',

  // Connect
  // Prefixes for Hoseki Connect, this was the first product we launched so we do not have a namespace for these
  'ah',
  'sn',
  'cs',
  'acc',
  'rec',
  'ig',
  'cred',
  'tx',

  // Verified
  // May be renamed soon to "Proof of Reserves", but we cannot change the prefixes anymore
  'v_inst',
  'v_acc',
  'v_cust',
  'v_rep_btc',
  'v_ver_btc',
  'v_ver_snap',
  'v_rep_btc_link',

  // Portal
  // Mainly auth related, could be subject to change with Auth updates with Verify, we could change these since Portal or Prove is not used in prod yet
  'pt_user',
  'pt_sssn',
  'pt_veri',

  // Registry
  're_asst',
  're_clmx',
  're_chal',
  're_mesg',
  're_mtdt',
  're_ks',
  're_cbs', // claim balance snapshot

  // Statements
  'st_stmt',

  // Verify
  'vy_areq',
  'vy_clac',
  'vy_stmt',

  // Webhooks
  'wh_sub',
  'wh_sev',

  // Payment
  'py_pro',
  'py_sub',
  'py_usg',
  'py_inv',
  'py_ini',
  'py_ctx',
  'py_tx',

  // Events
  'evt',
  'evtd',
] as const

export type Prefix = (typeof prefixes)[number]
export type Hosid<T extends Prefix> = Id<T>

export function hosid<T extends Prefix>(prefix: T): Hosid<T> {
  return Id.gen(prefix)
}

hosid.withPrefix = <T extends Prefix>(prefix: T): (() => Hosid<T>) => Id.factory(prefix)

export function createHosidSchema<T extends Prefix>(prefix: T): z.ZodType<Hosid<T>, z.ZodTypeDef, string> {
  return Id.schema(prefix)
}

export function removeHosidPrefix(prefixedId: Hosid<Prefix>): string {
  return Id.strip(prefixedId)
}

export const AccessRequestIdSchema = createHosidSchema('vy_areq')
export type AccessRequestId = Hosid<'vy_areq'>

export const ClaimAccessIdSchema = createHosidSchema('vy_clac')
export type ClaimAccessId = Hosid<'vy_clac'>

export const SubscriptionIdSchema = createHosidSchema('wh_sub')
export type SubscriptionId = Hosid<'wh_sub'>

export const SubscriptionEventIdSchema = createHosidSchema('wh_sev')
export type SubscriptionEventId = Hosid<'wh_sev'>

export const IntegratorStatementIdSchema = createHosidSchema('vy_stmt')
export type IntegratorStatementId = Hosid<'vy_stmt'>

export const IntegratorIdSchema = createHosidSchema('ig')
export type IntegratorId = Hosid<'ig'>

export const PaymentProductIdSchema = createHosidSchema('py_pro')
export type PaymentProductId = Hosid<'py_pro'>

export const PaymentSubscriptionIdSchema = createHosidSchema('py_sub')
export type PaymentSubscriptionId = Hosid<'py_sub'>

export const PaymentUsageRecordIdSchema = createHosidSchema('py_usg')
export type PaymentUsageRecordId = Hosid<'py_usg'>

export const KeystoreIdSchema = createHosidSchema('re_ks')
export type KeystoreId = Hosid<'re_ks'>

export const PaymentInvoiceIdSchema = createHosidSchema('py_inv')
export type PaymentInvoiceId = Hosid<'py_inv'>

export const PaymentInvoiceItemIdSchema = createHosidSchema('py_ini')
export type PaymentInvoiceItemId = Hosid<'py_ini'>

export const PaymentCreditTransactionIdSchema = createHosidSchema('py_ctx')
export type PaymentCreditTransactionId = Hosid<'py_ctx'>

export const PaymentTransactionIdSchema = createHosidSchema('py_tx')
export type PaymentTransactionId = Hosid<'py_tx'>

export const EventIdSchema = createHosidSchema('evt')
export type EventId = Hosid<'evt'>

export const EventDeliveryIdSchema = createHosidSchema('evtd')
export type EventDeliveryId = Hosid<'evtd'>

export const PaymentWebhookSubscriptionIdSchema = createHosidSchema('wh_sub')
export type PaymentWebhookSubscriptionId = Hosid<'wh_sub'>
