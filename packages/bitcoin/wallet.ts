import { type Result } from '@patina/core'
import {
  type MultiSigAccountScriptType,
  type SingleSigAccountScriptType,
  checkMultisigAccountProps,
} from './account_props'
import { DerivationPath } from './derivation-path'
import {
  MultisigDescriptorParser,
  type MultisigProps,
  SinglesigDescriptorParser,
  type SinglesigProps,
} from './descriptor_parsers'
import { KeyExpression, KeyOrigin } from './key-expression'
import { Xpub } from './xpub'

export namespace Wallet {
  export type Policy = 'singlesig' | 'multisig'

  interface Common {
    policy: Policy
  }

  export class Singlesig implements Common {
    public static from(props: SinglesigProps): Singlesig {
      return new Singlesig(props)
    }

    public static fromDescriptor(desc: string): Result<Singlesig, Error> {
      return SinglesigDescriptorParser.parse(desc).map((props) => new Singlesig(props))
    }

    public readonly policy = 'singlesig' as const
    public readonly scriptType: SingleSigAccountScriptType
    public readonly keyExpression: KeyExpression

    private constructor(props: SinglesigProps) {
      this.scriptType = props.scriptType
      this.keyExpression = props.keyExpression
    }

    public toJSON(): {
      scriptType: SingleSigAccountScriptType
      keyExpression: ReturnType<typeof KeyExpression.prototype.toJSON>
    } {
      return {
        scriptType: this.scriptType,
        keyExpression: this.keyExpression.toJSON(),
      }
    }
  }

  export class Multisig implements Common {
    public static from(props: MultisigProps): Result<Multisig, Error> {
      return checkMultisigAccountProps({
        isSorted: props.isSorted,
        scriptType: props.scriptType,
        threshold: props.threshold,
        xpubs: props.keyExpressions.map((ke) => ke.xpub),
      }).map(() => new Multisig(props))
    }

    public static fromDescriptor(desc: string): Result<Multisig, Error> {
      return MultisigDescriptorParser.parse(desc).andThen((props) => Multisig.from(props))
    }

    public static fromJSON(json: ReturnType<typeof Multisig.prototype.toJSON>): Result<Multisig, Error> {
      const keyExpressions: KeyExpression[] = []
      for (const ke of json.keyExpressions) {
        const xpub = Xpub.fromCheckedString(ke.xpub)
        const keyOrigin = ke.keyOrigin
          ? KeyOrigin.from(
              ke.keyOrigin.fingerprint,
              ke.keyOrigin.derivationPath ? DerivationPath.from(ke.keyOrigin.derivationPath) : null,
            )
          : null
        keyExpressions.push(KeyExpression.from(xpub, keyOrigin))
      }
      return Multisig.from({
        scriptType: json.scriptType,
        threshold: json.threshold,
        isSorted: json.isSorted,
        keyExpressions,
      })
    }

    public readonly policy = 'multisig' as const
    public readonly scriptType: MultiSigAccountScriptType
    public readonly threshold: number
    public readonly isSorted: boolean
    public readonly keyExpressions: KeyExpression[]

    private constructor(props: MultisigProps) {
      this.scriptType = props.scriptType
      this.threshold = props.threshold
      this.isSorted = props.isSorted
      this.keyExpressions = props.keyExpressions
    }

    public toJSON(): {
      scriptType: MultiSigAccountScriptType
      threshold: number
      isSorted: boolean
      keyExpressions: ReturnType<typeof KeyExpression.prototype.toJSON>[]
    } {
      return {
        scriptType: this.scriptType,
        threshold: this.threshold,
        isSorted: this.isSorted,
        keyExpressions: this.keyExpressions.map((ke) => ke.toJSON()),
      }
    }
  }
}

export type Wallet = Wallet.Singlesig | Wallet.Multisig
