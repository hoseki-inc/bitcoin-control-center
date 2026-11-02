import type { RouterInput, RouterOutput } from './index'

export type ClaimDto = RouterOutput['portalProve']['registry']['claims']['list'][number]
export type KeystoreDto = ClaimDto['keystores'][number]

export type ChallengeDto = RouterOutput['portalProve']['registry']['challenges']['create']
export type ChallengeMessageDto = RouterOutput['portalProve']['registry']['challengeMessages']['create']

export type StatementDto = RouterOutput['portalProve']['statement']['retrieve']

export type CreateSingleSigClaimInput = RouterInput['portalProve']['registry']['claims']['create']['singlesig']
export type CreateMultisigClaimInput = RouterInput['portalProve']['registry']['claims']['create']['multisig']
export type CreateMultisigKeystoreInput = CreateMultisigClaimInput['keystores'][number]
export type UpdateKeystoreInput = RouterInput['portalProve']['registry']['claims']['updateKeystore']
