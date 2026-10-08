import { DerivationPath, type DerivationPathString, type Xpub } from '@hoseki/packages/bitcoin'
import { Err, Ok } from '@hoseki/packages/result'
import { Slip132 } from '@hoseki/packages/wallet'
import { HardwareDeviceError } from '@hoseki/packages/wallet/errors'
import { describe, expect, it, vi } from 'vitest'
import { getXpubFrom } from './keystore'

describe('getXpubFrom', () => {
  const xpub1 = Slip132.getXpubFromString(
    'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
  ).expect('Failed to create xpub1')
  const xpub2 = Slip132.getXpubFromString(
    'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz',
  ).expect('Failed to create xpub2')
  const xpub3 = Slip132.getXpubFromString(
    'xpub6ASuArnXKPbfEwhqN6e3mwBcDTgzisQN1wXN9BJcM47sSikHjJf3UFHKkNAWbWMiGj7Wf5uMash7SyYq527Hqck2AxYysAA7xmALppuCkwQ',
  ).expect('Failed to create xpub3')

  // All hardened paths
  const derivationPath1 = DerivationPath.fromString("m/48'/0'/0'/2'").expect('valid')
  const derivationPath2 = DerivationPath.fromString("m/48'/0'/1'/2'").expect('valid')

  // Mixed hardened/unhardened paths
  const derivationPath3 = DerivationPath.fromString("m/48'/0'/0'/2'/0/0").expect('valid')

  const mockKeystoreDto1 = {
    derivationPath: derivationPath1.toString(),
    xpub: xpub1,
    isIdentified: true,
  }

  const mockKeystoreDto2 = {
    derivationPath: derivationPath2.toString(),
    xpub: xpub2,
  }

  type Keystore = {
    derivationPath: DerivationPathString | null
    xpub: Xpub
  }

  type ClaimWithKeystores = { keystores: Keystore[] }

  const mockClaimDto: ClaimWithKeystores = {
    keystores: [mockKeystoreDto1, mockKeystoreDto2],
  } as const

  it('should return the xpub when device returns matching xpub for first keystore', async () => {
    const getXpubFromDevice = vi.fn().mockResolvedValue(Ok(xpub1))

    const result = await getXpubFrom({
      claim: mockClaimDto,
      getXpubFromDevice,
      deviceType: 'ledger',
    })

    expect(result.isOk()).toBe(true)
    expect(result.expect('Expected successful result').toString()).toBe(xpub1.toString())
    expect(getXpubFromDevice).toHaveBeenCalledTimes(1)
    // Should be called with hardened-only path (which is the same as derivationPath1 since it's all hardened)
    expect(getXpubFromDevice).toHaveBeenCalledWith(derivationPath1)
  })

  it('should return the xpub when device returns matching xpub for second keystore', async () => {
    const getXpubFromDevice = vi
      .fn()
      .mockResolvedValueOnce(Ok(xpub3)) // First keystore doesn't match
      .mockResolvedValueOnce(Ok(xpub2)) // Second keystore matches

    const result = await getXpubFrom({
      claim: mockClaimDto,
      getXpubFromDevice,
      deviceType: 'trezor',
    })

    expect(result.isOk()).toBe(true)
    expect(result.expect('Expected successful result').toString()).toBe(xpub2.toString())
    expect(getXpubFromDevice).toHaveBeenCalledTimes(2)
    expect(getXpubFromDevice).toHaveBeenNthCalledWith(1, derivationPath1)
    expect(getXpubFromDevice).toHaveBeenNthCalledWith(2, derivationPath2)
  })

  it('should return error when no keystore xpub matches device xpub', async () => {
    const getXpubFromDevice = vi.fn().mockResolvedValue(Ok(xpub3))

    const result = await getXpubFrom({
      claim: mockClaimDto,
      getXpubFromDevice,
      deviceType: 'coldcard',
    })

    expect(result.isErr()).toBe(true)
    expect(result.expectErr('Expected failed result').message).toBe(
      'No coldcard account found matching any keystore xpub',
    )
    expect(getXpubFromDevice).toHaveBeenCalledTimes(2)
  })

  it('should skip keystores without derivation path', async () => {
    const keystoreWithoutPath: Keystore = {
      derivationPath: null,
      xpub: xpub1,
    }

    const claimWithMissingPath: ClaimWithKeystores = {
      keystores: [keystoreWithoutPath, mockKeystoreDto2],
    }

    const getXpubFromDevice = vi.fn().mockResolvedValue(Ok(xpub2))

    const result = await getXpubFrom({
      claim: claimWithMissingPath,
      getXpubFromDevice,
      deviceType: 'trezor',
    })

    expect(result.isOk()).toBe(true)
    expect(result.expect('Expected successful result').toString()).toBe(xpub2.toString())
    expect(getXpubFromDevice).toHaveBeenCalledTimes(1) // Only called once, skipped first keystore
    expect(getXpubFromDevice).toHaveBeenCalledWith(derivationPath2)
  })

  it('should return error when all keystores lack derivation paths', async () => {
    const claimWithNoPaths: ClaimWithKeystores = {
      keystores: [
        { ...mockKeystoreDto1, derivationPath: null },
        { ...mockKeystoreDto2, derivationPath: null },
      ],
    }

    const getXpubFromDevice = vi.fn()

    const result = await getXpubFrom({
      claim: claimWithNoPaths,
      getXpubFromDevice,
      deviceType: 'coldcard',
    })

    expect(result.isErr()).toBe(true)
    expect(result.expectErr('Expected failed result').message).toBe(
      'No coldcard account found matching any keystore xpub',
    )
    expect(getXpubFromDevice).not.toHaveBeenCalled()
  })

  it('should stop searching after device error on first keystore', async () => {
    const getXpubFromDevice = vi
      .fn()
      .mockResolvedValueOnce(Err(new HardwareDeviceError('User cancelled', 'trezor', 'User cancelled')))

    const result = await getXpubFrom({
      claim: mockClaimDto,
      getXpubFromDevice,
      deviceType: 'trezor',
    })

    expect(result.isOk()).toBe(false)
    expect(getXpubFromDevice).toHaveBeenCalledTimes(1)
  })

  it('should return first matching xpub when multiple keystores could match', async () => {
    const claimWithDuplicates: ClaimWithKeystores = {
      keystores: [mockKeystoreDto1, { ...mockKeystoreDto2, xpub: mockKeystoreDto1.xpub }],
    }

    const getXpubFromDevice = vi.fn().mockResolvedValue(Ok(xpub1))

    const result = await getXpubFrom({
      claim: claimWithDuplicates,
      getXpubFromDevice,
      deviceType: 'ledger',
    })

    expect(result.isOk()).toBe(true)
    expect(result.expect('Expected successful result').toString()).toBe(xpub1.toString())
    expect(getXpubFromDevice).toHaveBeenCalledTimes(1) // Should return on first match
  })

  it('should handle empty keystores array', async () => {
    const claimWithNoKeystores: ClaimWithKeystores = {
      keystores: [],
    }

    const getXpubFromDevice = vi.fn()

    const result = await getXpubFrom({
      claim: claimWithNoKeystores,
      getXpubFromDevice,
      deviceType: 'ledger',
    })

    expect(result.isErr()).toBe(true)
    expect(result.expectErr('Expected failed result').message).toBe(
      'No ledger account found matching any keystore xpub',
    )
    expect(getXpubFromDevice).not.toHaveBeenCalled()
  })

  it('should return error when derived unhardened xpub does not match', async () => {
    const hardenedXpub = xpub1
    const wrongDerivedXpub = xpub3 // Different xpub

    const keystoreWithMixedPath: Keystore = {
      derivationPath: derivationPath3.toString(), // m/48'/0'/0'/2'/0/0
      xpub: wrongDerivedXpub, // This won't match the derived result
    }

    const claim: ClaimWithKeystores = {
      keystores: [keystoreWithMixedPath],
    }

    const getXpubFromDevice = vi.fn().mockResolvedValue(Ok(hardenedXpub))

    const result = await getXpubFrom({
      claim,
      getXpubFromDevice,
      deviceType: 'ledger',
    })

    expect(result.isErr()).toBe(true)
    expect(result.expectErr('Expected failed result').message).toBe(
      'No ledger account found matching any keystore xpub',
    )
    expect(getXpubFromDevice).toHaveBeenCalledTimes(1)
  })
})
