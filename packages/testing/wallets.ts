import { Address, MultiSigAccount, SingleSigAccount } from '../bitcoin'
import * as Slip132 from '../wallet/slip-132'

export class Wallets {
  public static satoshiAddress = Address.fromString('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa').expect('should be valid')

  public static legacyXpub = Slip132.getXpubFromString(
    'xpub6BqN8FZQhMmbuUehywWNTkRjMAYpTNhqvu6fMiYx4dw9Bagf8218mXwD8QGMswfcAAiqxfUoiHiGcV1iE3oDG9rFBoyDBw1a6FJAFVQhc1j',
  ).expect('valid xpub')
  public static nestedSegwitXpub = Slip132.getXpubFromString(
    'xpub6CQrPd5mpXz9HHdoKXJDjoGUhjBpfhvT63HEVKHr8C2cSeyX7wiKmLJCew6kDRg9rt8Pe7jAP5x3h9MW8cGCxYdEgEWQegv9knmqGSaeCoP',
  ).expect('valid xpub')

  public static nativeSegwitXpub = Slip132.getXpubFromString(
    'xpub6CpHLzJqtsCcXdxt9QkUbnzoVsQ4kueZWrmbkrXZPm8QdwvGj2s8YNsQkCQfZwVsgQRWdcSrfMjwC18wpHjaSGTPbvqT4Q5zk57XcfhkSQG',
  ).expect('valid xpub')
  public static taproot = Slip132.getXpubFromString(
    'xpub6BoeXcVW9AbyxC4mYs5p2fXVacZEo5H1BtQzZvyxTJh6EfS3kXUV9CzaJJYqan13AGbLchRtozs3iobpkx2cjVQdLDjunMCuji6DrzEo14r',
  ).expect('valid xpub')

  public static singlesigLegacyAccount = new SingleSigAccount('p2pkh', Wallets.legacyXpub)
  public static singlesigNestedSegwitAccount = new SingleSigAccount('p2sh-p2wpkh', Wallets.nestedSegwitXpub)
  public static singlesigNativeSegwitAccount = new SingleSigAccount('p2wpkh', Wallets.nativeSegwitXpub)
  public static singlesigTaprootAccount = new SingleSigAccount('p2tr', Wallets.taproot)

  public static multisigLegacyAccount = MultiSigAccount.fromDescriptor(
    'sh(sortedmulti(2,[b56a9fea/45h]xpub69DqY6pjjvKo7ZSUDfEzauFcy8yZZYrACehG8mrRmECFEDZrtaKgmDnejGbAj4YCsQQqwwQ88RvakYcYkAY7hYqPrbAhWW5tJkgZVGmAGCs/<0;1>/*,[79ece09d/45h]xpub68nUZGDdeH1Q1ZPuujruMdsnnVLFAog1Bpg4VanrdugPEvqAU2RFZ17zad3z49NDsYaAmwNsUuttkBFjwibmbx5iDAFPtmeQ5VjY4VWGsKv/<0;1>/*,[a57e5a20/45h]xpub6973psqDCnnAm6XeTxSV7fXs2anZs1xkVqeYgXC174dAQTShn6srD4i9xtWRy4qdLytKBASv8xAQtTF9iriwqgYbJwkQyHPDCSbKLDgkikk/<0;1>/*))#am05e8w7',
  ).expect('valid multisig')
  public static multisigNestedSegwitAccount = MultiSigAccount.fromDescriptor(
    'sh(wsh(sortedmulti(2,[b521a37f/48h/0h/0h/1h]xpub6DwY3DW2ZxQrSRxo7pHpqkxggXfBWV8L6wUAynrA4nwgmjS2pm1yAL6tX8B3uqBqvggG4ZTo9kMf2tpS1CZuGcrV1KVMCxsPFkXVNxrrnyK/<0;1>/*,[1812f5e7/48h/0h/0h/1h]xpub6EZpyNm8H9FbG7xFLaFRdhdkKfFnYTMRbEqHQBWMysF7oGqSYe7waycpEAJwF4uvyWhsU2Sz1iv4dDUf93iG64LctyUNm2ros7BHAGF2c2E/<0;1>/*,[da2d2498/48h/0h/0h/1h]xpub6E6jeQ7CUNNxYzvG7Qz3cmi4jLziAJQsWsUSDkEbwYu5CJ9cjrUC2gSj4Gyfn7nJyr78wCqzgHLFiTfDGEsZt8tBGX8NmeLE9nC9XgvZw3B/<0;1>/*)))#cl5k36j4',
  ).expect('valid multisig')
  public static multisigNativeSegwitAccount = MultiSigAccount.fromDescriptor(
    'wsh(sortedmulti(2,[98950b2a/48h/0h/0h/2h]xpub6FF4wJMrZjWwm8PpJhJJcD3uircG7QKMaijiZhiFmBoaNX2MJiyqZmQ1aYAu59VawDppV25P7PVwtFsnynPjMFq8DNwo1sPyNdher6jFEug/<0;1>/*,[1d25c06f/48h/0h/0h/2h]xpub6DfQuReLSBLxpNjNJsTFDKsA3FpoiRVuymrkmKYG7j7sFxdJdnC3DWZg9bahkxQoNqzq6CmYDZPeQhgpL63sBhMFZPvH2CuR6mnaaSiseNJ/<0;1>/*,[1d177351/48h/0h/0h/2h]xpub6F5dv5ncJreUTNJ89xwAfuzLGJ17CfuQeo9jPwQ5CLqyGoAnkN6QZMWtoMi73MREyJbWh4o521Ye3DFuRDhkigf8ocJtW4DadaSszNieAgr/<0;1>/*))#asdthwfj',
  ).expect('valid multisig')

  /** Keys of the Bitkey app's sample descriptor export (ExportWatchingDescriptorServiceMock), in app, hardware, server order. */
  public static bitkeyKeys = [
    "[a0a76f7a/84'/0'/0']xpub6CeEJqRzUbpUHsEkbz65NLzHYzrT5TpngE2pmuikVFJgSwU7hjEVpjeroQkdbGKLksMDnXPRxvif9jM2jBGxBXKdZYXNBLwG23tEqkAneEn",
    "[18240e16/84'/0'/0']xpub6CF6yNxSPoNFJESR4xoxzTGKF6GZad5zdB14waPanqnkFWsNAuYNzq2y7nZk5TGiPcGjY8P3ZwrdixbsSp9uVMZ4QtRkMdUNHUsabMnPbKD",
    "[afc9474a/84'/0'/0']xpub6CHktMjw1eKdvXgiYdzHVr58KfKnoZpZHqDmTD8MMPJA5vom1sd1TdrNnNESvrxXgZDUMeyBjg2wQYnmMXB767nwh5Z8eNDeFmdPrDdmKaq",
  ] as const
  /** What Bitkey's Settings → Exports → Current wallet descriptor shares. */
  public static bitkeyExport = `External: wsh(sortedmulti(2,${Wallets.bitkeyKeys.map((key) => `${key}/0/*`).join(',')})) 

Internal: wsh(sortedmulti(2,${Wallets.bitkeyKeys.map((key) => `${key}/1/*`).join(',')}))`

  public static legacyAddress = Wallets.singlesigLegacyAccount.address(0, 0)
  public static scriptAddress = Wallets.singlesigNestedSegwitAccount.address(0, 0)
  public static segwitAddress = Wallets.singlesigNativeSegwitAccount.address(0, 0)
  public static taprootAddress = Wallets.singlesigTaprootAccount.address(0, 0)

  public static allAddressTypes = [
    Wallets.legacyAddress,
    Wallets.scriptAddress,
    Wallets.segwitAddress,
    Wallets.taprootAddress,
  ]

  public static allSinglesigAccounts = [
    Wallets.singlesigLegacyAccount,
    Wallets.singlesigNestedSegwitAccount,
    Wallets.singlesigNativeSegwitAccount,
    Wallets.singlesigTaprootAccount,
  ] as const

  public static allMultisigAccounts = [
    Wallets.multisigLegacyAccount,
    Wallets.multisigNestedSegwitAccount,
    Wallets.multisigNativeSegwitAccount,
  ] as const

  public static allSingleAndMultiSigAccounts = [
    ...Wallets.allSinglesigAccounts,
    ...Wallets.allMultisigAccounts,
  ] as const
}
