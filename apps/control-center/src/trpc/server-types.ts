import type { RouterInput, RouterOutput } from './index'

export type ClaimDto = RouterOutput['portalProve']['accounts']['list'][number]
export type KeystoreDto = ClaimDto['keystores'][number]

export type ChallengeDto = RouterOutput['portalProve']['registry']['challenges']['create']
export type ChallengeMessageDto = RouterOutput['portalProve']['registry']['challengeMessages']['create']

export type StatementDto = RouterOutput['portalProve']['statements']['retrieve']

export type CreateSingleSigClaimInput = RouterInput['portalProve']['accounts']['create']['singlesig']
export type CreateMultisigClaimInput = RouterInput['portalProve']['accounts']['create']['multisig']
export type CreateMultisigKeystoreInput = CreateMultisigClaimInput['keystores'][number]
export type UpdateKeystoreInput = RouterInput['portalProve']['accounts']['updateKeystore']
