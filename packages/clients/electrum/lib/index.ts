export { ElectrumClient, type ElectrumClientConfig } from './client'
export { ElectrumTransport, type ElectrumConnectionConfig, type SocksProxyConfig } from './protocol'
export {
  type ElectrumTxInput,
  type ElectrumTxOutput,
  type ElectrumVerboseTransaction,
  ElectrumVerboseTransactionSchema,
  type HeaderNotification,
  HeaderNotificationSchema,
  type ScripthashBalance,
  ScripthashBalanceSchema,
  type ScripthashHistory,
  ScripthashHistorySchema,
  type ScripthashHistoryEntry,
  type ScripthashUnspent,
  ScripthashUnspentSchema,
  type ScripthashUnspentEntry,
  type ServerVersion,
} from './schemas'
