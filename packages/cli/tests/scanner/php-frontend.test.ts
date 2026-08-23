import { describe, it, expect } from 'vitest'
import { mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'

import { createPhpFrontend, resetPhpParserCacheForTests } from '../../src/scanner/frontends/php/index.js'
import { interpret, ambiguousCalleeNeedsDot } from '../../src/scanner/rules.js'

/**
 * The PHP frontend (#403): Laravel translation helpers read as syntax, through
 * the same rules as every other language. Tests assert what the scanner
 * concludes, never which parser node produced it.
 */

const frontend = createPhpFrontend()

async function scan(source: string, filePath = 'app/Http/Thing.php') {
  const sites = await frontend.read(source, filePath)
  if (!sites) return null
  return interpret(sites, { filePath, ambiguousCalleeNeedsDot })
}

describe('recognising the Laravel helpers', () => {
  it('reads __, trans, trans_choice and Lang::get as translations', async () => {
    const evidence = await scan([
      `<?php`,
      `$a = __('validation.required');`,
      `$b = trans('auth.failed');`,
      `$c = trans_choice('messages.apples', 2);`,
      `$d = Lang::get('passwords.reset');`,
    ].join('\n'))

    expect(evidence?.usages.map(u => u.key)).toEqual([
      'validation.required',
      'auth.failed',
      'messages.apples',
      'passwords.reset',
    ])
  })

  it('reports the line each key was used on', async () => {
    const evidence = await scan(`<?php\n\n$x = __('a.b');`)

    expect(evidence?.usages[0]).toMatchObject({ key: 'a.b', line: 3, callee: '__' })
  })

  it('ignores calls that are not translations, whatever their argument', async () => {
    const evidence = await scan([
      `<?php`,
      `config('app.name');`,
      `$client->get('api.v1.bookings');`,
      `$x?->t('not.i18n');`,
    ].join('\n'))

    expect(evidence?.usages).toEqual([])
  })

  it('reads a literal-sentence key, dots or no dots', async () => {
    // Laravel JSON catalogues key by the source sentence itself.
    const evidence = await scan(`<?php echo __('Something went wrong');`)

    expect(evidence?.usages.map(u => u.key)).toEqual(['Something went wrong'])
  })
})

describe('dynamic arguments', () => {
  it('reports double-quoted interpolation as a dynamic key, slots normalised', async () => {
    const evidence = await scan(`<?php echo __("statuses.{$status}.label");`)

    expect(evidence?.usages).toEqual([])
    expect(evidence?.dynamicKeys[0]?.expression).toBe('`statuses.${_}.label`')
  })

  it('normalises bare and object-property interpolation alike', async () => {
    const evidence = await scan([
      `<?php`,
      `__("a.$kind");`,
      `__("b.{$booking->status}.label");`,
    ].join('\n'))

    expect(evidence?.dynamicKeys.map(d => d.expression)).toEqual(['`a.${_}`', '`b.${_}.label`'])
  })

  it('bounds a dot-concatenation by its literal prefix', async () => {
    const evidence = await scan(`<?php echo trans('orders.status.' . $status);`)

    expect(evidence?.dynamicKeys[0]?.expression).toBe('`orders.status.${_}`')
  })

  it('reports nothing readable for a plain variable argument', async () => {
    const evidence = await scan(`<?php echo __($key);`)

    expect(evidence?.usages).toEqual([])
    expect(evidence?.dynamicKeys).toEqual([])
  })

  it('reads an uninterpolated heredoc as the plain string it is', async () => {
    const evidence = await scan(`<?php echo __(<<<'EOT'\nmail.subject.welcome\nEOT);`)

    expect(evidence?.usages.map(u => u.key)).toEqual(['mail.subject.welcome'])
  })
})

describe('parity with the Laravel pattern suite, in plain PHP', () => {
  // The semantic cases the pattern tests assert on Blade fragments, restated
  // as the PHP the frontend reads today. #404 lifts Blade onto this same path
  // and parameterises the full Laravel suite.
  it('keys without dots count — no bare-callee filter for Laravel helpers', async () => {
    const evidence = await scan(`<?php __('welcome');`)

    expect(evidence?.usages.map(u => u.key)).toEqual(['welcome'])
  })

  it('reads several calls on one line, each once', async () => {
    const evidence = await scan(`<?php echo __('a.b') . trans("c.d") . __('a.b');`)

    expect(evidence?.usages.map(u => u.key)).toEqual(['a.b', 'c.d', 'a.b'])
  })

  it('single quotes never interpolate', async () => {
    const evidence = await scan(`<?php __('statuses.$status.label');`)

    expect(evidence?.usages.map(u => u.key)).toEqual(['statuses.$status.label'])
    expect(evidence?.dynamicKeys).toEqual([])
  })
})

describe('resolving the parser from the scanned project (#403)', () => {
  it('finds php-parser installed beside the scanned file, not the CLI', async () => {
    // A project outside this repo's node_modules chain, with its own
    // php-parser install — the npx situation.
    const project = join(tmpdir(), `i18n-php-peer-${process.pid}`)
    await rm(project, { recursive: true, force: true })
    await mkdir(join(project, 'node_modules'), { recursive: true })
    const ownPhpParser = createRequire(import.meta.url).resolve('php-parser/package.json')
    await symlink(join(ownPhpParser, '../..', 'php-parser'), join(project, 'node_modules/php-parser')).catch(async () => {
      await symlink(join(ownPhpParser, '..'), join(project, 'node_modules/php-parser'))
    })
    const file = join(project, 'app.php')
    await writeFile(file, `<?php echo __('from.project.resolution');`)

    resetPhpParserCacheForTests()
    try {
      const sites = await frontend.read(`<?php echo __('from.project.resolution');`, file)
      expect(sites?.map(s => s.argument)).toEqual([{ kind: 'static', value: 'from.project.resolution' }])
    } finally {
      resetPhpParserCacheForTests()
      await rm(project, { recursive: true, force: true })
    }
  })
})

describe('declining', () => {
  it('declines a file the parser cannot read', async () => {
    const sites = await frontend.read(`<?php class { !! broken`, 'broken.php')

    expect(sites).toBeNull()
  })

  it('reads plain PHP only — Blade belongs to its own frontend', () => {
    expect(frontend.handles('app/Model.php')).toBe(true)
    expect(frontend.handles('resources/views/mail.blade.php')).toBe(false)
    expect(frontend.handles('component.vue')).toBe(false)
  })
})
