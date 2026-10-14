import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { onTestFinished, test } from 'vitest'

const script = fileURLToPath(new URL('../actions/sign-startos-package/sign.sh', import.meta.url))
const publicKey = 'ab'.repeat(32)
const privateKey = 'synthetic-permanent-private-key'
const manifest = { id: 'hoseki-sentinel', version: '0.2.3:1', images: { main: { arch: ['aarch64', 'x86_64'] } } }

// The CLI fixture checks the subprocess contract, without parsing any real private keys or
// pretending to verify signatures. CI separately rehearses the action with the pinned native CLI.
const cliFixture = `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const fault = process.env.SIGNING_TEST_FAULT
const publicKey = Buffer.from(process.env.SIGNING_TEST_PUBLIC_KEY, 'hex')
const log = (event) => appendFileSync(process.env.SIGNING_TEST_LOG,
  [event.operation, event.target ?? '', event.keyPath ?? '', event.permissions ?? ''].join('\\t') + '\\n')
const fail = () => process.exit(23)
if (args[0] === '--id-key-path') {
  const [, keyPath, operation] = args
  log({ operation, keyPath })
  if (fault === operation) fail()
  if (operation === 'init-key') {
    writeFileSync(keyPath, 'synthetic-cli-generated-private-key', { mode: 0o600 })
  } else if (operation === 'pubkey') {
    if (!existsSync(keyPath)) fail()
    const bytes = fault === 'short-public-key' ? Buffer.alloc(8) : Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'), publicKey,
    ])
    console.log('-----BEGIN PUBLIC KEY-----\\n' + bytes.toString('base64') + '\\n-----END PUBLIC KEY-----')
  } else fail()
} else if (args[0] === 's9pk' && args[1] === 'inspect') {
  const [, , path, field] = args
  const target = path === process.env.UNSIGNED ? 'unsigned' : 'signed'
  log({ operation: field, target })
  if (fault === target + '-' + field) fail()
  const bytes = readFileSync(path)
  if (field === 'commitment') {
    console.log('synthetic-verified-commitment')
  } else if (field === 'manifest') {
    if (fault === 'malformed-manifest' && target === 'signed') console.log('invalid json')
    else console.log(JSON.stringify(JSON.parse(bytes.subarray(35).toString()).manifest))
  } else fail()
} else if (args[0] === 's9pk' && args[1] === 'edit') {
  const [, , path, field, expression] = args
  const keyPath = join(process.cwd(), '.startos', 'build.key.pem')
  if (path !== process.env.SIGNED || field !== 'manifest' || expression !== '.' || !existsSync(keyPath)) fail()
  const key = readFileSync(keyPath, 'utf8')
  if (key !== 'synthetic-cli-generated-private-key' && key !== process.env.STARTOS_DEV_KEY) fail()
  log({ operation: 'edit', keyPath, permissions: statSync(keyPath).mode & 0o777 })
  if (fault === 'edit') fail()
  const bytes = readFileSync(path)
  const body = JSON.parse(bytes.subarray(35).toString())
  if (fault === 'changed-manifest') body.manifest.version = '9.9.9:9'
  if (fault === 'reordered-manifest') body.manifest = Object.fromEntries(Object.entries(body.manifest).reverse())
  const signer = fault === 'wrong-signer' ? Buffer.alloc(32, 0xef) : publicKey
  writeFileSync(path, Buffer.concat([bytes.subarray(0, 3), signer, Buffer.from(JSON.stringify(body))]))
} else fail()
`

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bcc-sign-package-'))
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  const bin = join(root, 'bin')
  const temporary = join(root, 'temporary')
  const unsigned = join(root, 'unsigned.s9pk')
  const signed = join(root, 'output', 'signed.s9pk')
  const output = join(root, 'outputs')
  const log = join(root, 'calls.tsv')
  mkdirSync(bin)
  mkdirSync(temporary)
  writeFileSync(join(bin, 'start-cli'), cliFixture, { mode: 0o755 })
  writeFileSync(
    unsigned,
    Buffer.concat([Buffer.from([0x53, 0x39, 1]), Buffer.alloc(32, 0xcd), Buffer.from(JSON.stringify({ manifest }))]),
  )
  writeFileSync(output, '')
  writeFileSync(log, '')

  /** @param {{ permanent?: boolean, publicKey?: string, privateKey?: string, fault?: string }} options */
  const run = (options = {}) => {
    const result = spawnSync('bash', [script], {
      cwd: root,
      encoding: 'utf8',
      timeout: 20_000,
      env: {
        ...process.env,
        PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
        UNSIGNED: unsigned,
        SIGNED: signed,
        RUNNER_TEMP: temporary,
        GITHUB_OUTPUT: output,
        STARTOS_DEV_KEY: options.privateKey ?? (options.permanent === true ? privateKey : ''),
        STARTOS_SIGNER_PUBKEY: options.publicKey ?? (options.permanent === true ? publicKey : ''),
        SIGNING_TEST_PUBLIC_KEY: publicKey,
        SIGNING_TEST_FAULT: options.fault ?? '',
        SIGNING_TEST_LOG: log,
      },
    })
    assert.ifError(result.error)
    const calls = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [operation = '', target = '', keyPath = '', permissions = ''] = line.split('\t')
        return {
          operation,
          keyPath: keyPath === '' ? undefined : keyPath,
          target: target === '' ? undefined : target,
          permissions: permissions === '' ? undefined : Number(permissions),
        }
      })
    assert.deepEqual(readdirSync(temporary), [], 'The private-key workspace must always be removed')
    for (const call of calls) {
      if (call.keyPath !== undefined) {
        assert.equal(existsSync(call.keyPath), false)
      }
    }
    assert.equal(`${result.stdout}${result.stderr}`.includes(privateKey), false)
    return { ...result, calls, outputs: readFileSync(output, 'utf8') }
  }
  return { run, signed }
}

test.each([false, true])('re-signs and verifies the package before reporting success, permanent: %s', (permanent) => {
  const f = fixture()
  const result = f.run({ permanent })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.outputs, `mode=${permanent ? 'permanent signing key' : 'temporary clean-install key'}\n`)
  assert.equal(
    result.calls.some((call) => call.operation === 'init-key'),
    !permanent,
  )
  assert.deepEqual(
    result.calls.filter((call) => call.operation === 'commitment').map((call) => call.target),
    ['unsigned', 'signed'],
  )
  assert.deepEqual(
    result.calls.filter((call) => call.operation === 'manifest').map((call) => call.target),
    ['unsigned', 'signed'],
  )
  assert.equal(result.calls.find((call) => call.operation === 'edit')?.permissions, 0o600)
  assert.equal(readFileSync(f.signed).subarray(3, 35).toString('hex'), publicKey)
})

test('accepts uppercase public-key hex and unchanged manifests with reordered object keys', () => {
  const result = fixture().run({ permanent: true, publicKey: publicKey.toUpperCase(), fault: 'reordered-manifest' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.outputs, 'mode=permanent signing key\n')
})

test.each([
  { name: 'public key without a private key', publicKey, privateKey: '' },
  { name: 'private key without a public key', publicKey: '', privateKey },
  { name: 'invalid public-key hex', publicKey: 'xy'.repeat(32), privateKey },
  { name: 'short public-key hex', publicKey: 'ab'.repeat(31), privateKey },
  { name: 'a different expected signer', publicKey: 'ef'.repeat(32), privateKey },
])(
  'rejects $name without signing or reporting success',
  ({ publicKey: configuredPublicKey, privateKey: configuredPrivateKey }) => {
    const result = fixture().run({ publicKey: configuredPublicKey, privateKey: configuredPrivateKey })
    assert.notEqual(result.status, 0)
    assert.equal(result.outputs, '')
    assert.equal(
      result.calls.some((call) => call.operation === 'edit'),
      false,
    )
  },
)

test.each([false, true])('rejects a package signed by a different key, permanent: %s', (permanent) => {
  const result = fixture().run({ permanent, fault: 'wrong-signer' })
  assert.notEqual(result.status, 0)
  assert.match(result.stdout, /not signed by the selected StartOS key/)
  assert.equal(result.outputs, '')
})

test.each([
  'unsigned-commitment',
  'unsigned-manifest',
  'init-key',
  'pubkey',
  'short-public-key',
  'edit',
  'signed-commitment',
  'signed-manifest',
  'malformed-manifest',
  'changed-manifest',
])('fails closed and removes private keys after %s fails', (fault) => {
  const result = fixture().run({ fault })
  assert.notEqual(result.status, 0)
  assert.equal(result.outputs, '')
})
