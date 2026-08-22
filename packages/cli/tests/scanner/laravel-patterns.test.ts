import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDynamicKeyRegexes, extractKeys, findOrphanKeysForConfig, scanSourceFiles } from '../../src/scanner/code-scanner.js'
import { LARAVEL_PATTERNS, getPatternSet } from '../../src/scanner/patterns.js'
import { createPhpFrontend } from '../../src/scanner/frontends/php/index.js'
import { createBladeFrontend } from '../../src/scanner/frontends/php/blade.js'
import { interpret, ambiguousCalleeNeedsDot } from '../../src/scanner/rules.js'

const tmpDir = join(dirname(fileURLToPath(import.meta.url)), '../../.tmp-test/laravel-scanner')

/**
 * The shared contract (#332): the same expectations run against the pattern
 * set and the syntax frontends. A test passing for one and failing for the
 * other is either a regression or an expectation that encoded a heuristic.
 */
const MODES = ['patterns', 'syntax'] as const

async function extractVia(mode: (typeof MODES)[number], content: string, filePath = 'test.blade.php') {
  if (mode === 'patterns') return extractKeys(content, filePath, LARAVEL_PATTERNS)
  const frontend = filePath.endsWith('.blade.php') ? createBladeFrontend() : createPhpFrontend()
  const sites = await frontend.read(content, filePath)
  if (!sites) throw new Error(`${frontend.name} declined ${filePath}`)
  return interpret(sites, { filePath, ambiguousCalleeNeedsDot })
}

describe.each(MODES)('Laravel extraction via %s', (mode) => {
  const extract = (content: string, filePath = 'test.blade.php') => extractVia(mode, content, filePath)

  describe('static key extraction', () => {
    it('extracts __() with single quotes', async () => {
      const { usages } = await extract(`<?php echo __('messages.welcome'); ?>`)
      expect(usages).toHaveLength(1)
      expect(usages[0]).toMatchObject({ key: 'messages.welcome', callee: '__', line: 1 })
    })

    it('extracts __() with double quotes', async () => {
      const { usages } = await extract(`<?php echo __("messages.welcome"); ?>`)
      expect(usages).toHaveLength(1)
      expect(usages[0]).toMatchObject({ key: 'messages.welcome', callee: '__' })
    })

    it('extracts trans() with single quotes', async () => {
      const { usages } = await extract(`{{ trans('auth.failed') }}`)
      expect(usages).toHaveLength(1)
      expect(usages[0]).toMatchObject({ key: 'auth.failed', callee: 'trans', line: 1 })
    })

    it('extracts trans() with double quotes', async () => {
      const { usages } = await extract(`{{ trans("auth.failed") }}`)
      expect(usages).toHaveLength(1)
      expect(usages[0]).toMatchObject({ key: 'auth.failed', callee: 'trans' })
    })

    it('extracts trans_choice()', async () => {
      const { usages } = await extract(`{{ trans_choice('messages.apples', 10) }}`)
      expect(usages).toHaveLength(1)
      expect(usages[0]).toMatchObject({ key: 'messages.apples', callee: 'trans_choice' })
    })

    it('extracts Lang::get()', async () => {
      const { usages } = await extract(`<?php Lang::get('messages.welcome'); ?>`)
      expect(usages).toHaveLength(1)
      expect(usages[0]).toMatchObject({ key: 'messages.welcome', callee: 'Lang::get' })
    })

    it('extracts @lang() Blade directive', async () => {
      const { usages } = await extract(`@lang('messages.welcome')`)
      expect(usages).toHaveLength(1)
      expect(usages[0]).toMatchObject({ key: 'messages.welcome', callee: '@lang' })
    })

    it('extracts keys without dots (no bare-callee filter for Laravel)', async () => {
      const { usages } = await extract(`{{ __('welcome') }}`)
      expect(usages).toHaveLength(1)
      expect(usages[0]).toMatchObject({ key: 'welcome', callee: '__' })
    })

    it('extracts multiple keys from the same line', async () => {
      const { usages } = await extract(`<p>{{ __('auth.login') }} | {{ __('auth.register') }}</p>`)
      expect(usages).toHaveLength(2)
      expect(usages[0].key).toBe('auth.login')
      expect(usages[1].key).toBe('auth.register')
    })

    it('extracts keys across multiple lines with correct line numbers', async () => {
      const content = [
        '<h1>{{ __("pages.title") }}</h1>',
        '',
        '<p>{{ trans("pages.body") }}</p>',
      ].join('\n')
      const { usages } = await extract(content)
      expect(usages).toHaveLength(2)
      expect(usages[0]).toMatchObject({ key: 'pages.title', line: 1 })
      expect(usages[1]).toMatchObject({ key: 'pages.body', line: 3 })
    })

    it('extracts keys with spaces around parentheses', async () => {
      const { usages } = await extract(`{{ __(  'spaced.key'  ) }}`)
      expect(usages).toHaveLength(1)
      expect(usages[0].key).toBe('spaced.key')
    })

    it('extracts keys with nested dots', async () => {
      const { usages } = await extract(`{{ __('admin.users.permissions.edit') }}`)
      expect(usages).toHaveLength(1)
      expect(usages[0].key).toBe('admin.users.permissions.edit')
    })

    it('does not match __() preceded by a word character', async () => {
      const { usages } = await extract(`foo__('not.a.key')`)
      expect(usages).toHaveLength(0)
    })

    it('does not match trans preceded by a word character', async () => {
      const { usages } = await extract(`detrans('not.a.key')`)
      expect(usages).toHaveLength(0)
    })

    it('extracts from Blade echo and raw echo', async () => {
      const content = [
        '{{ __("escaped.key") }}',
        '{!! __("raw.key") !!}',
      ].join('\n')
      const { usages } = await extract(content)
      expect(usages).toHaveLength(2)
      expect(usages[0].key).toBe('escaped.key')
      expect(usages[1].key).toBe('raw.key')
    })

    it('extracts from PHP controller code', async () => {
      const content = [
        '<?php',
        'class UserController extends Controller {',
        '    public function store() {',
        '        return redirect()->with("status", __("users.created"));',
        '    }',
        '}',
      ].join('\n')
      const { usages } = await extract(content, 'UserController.php')
      expect(usages).toHaveLength(1)
      expect(usages[0]).toMatchObject({ key: 'users.created', callee: '__', line: 4 })
    })

    it('extracts from validation messages array', async () => {
      const content = [
        '<?php return [',
        "'email.required' => __('validation.email_required'),",
        "'name.max' => trans('validation.name_too_long'),",
        '];',
      ].join('\n')
      const { usages } = await extract(content, 'validation.php')
      expect(usages).toHaveLength(2)
      expect(usages[0].key).toBe('validation.email_required')
      expect(usages[1].key).toBe('validation.name_too_long')
    })
  })

  describe('dynamic key extraction', () => {
    it('detects PHP variable interpolation in double-quoted strings', async () => {
      const { dynamicKeys } = await extract(`{{ __("messages.{$type}.title") }}`)
      expect(dynamicKeys).toHaveLength(1)
      expect(dynamicKeys[0].expression).toContain('messages.')
      expect(dynamicKeys[0].expression).toContain('.title')
      expect(dynamicKeys[0].callee).toBe('__')
    })

    it('ignores static double-quoted strings (no interpolation)', async () => {
      const { dynamicKeys, usages } = await extract(`{{ __("messages.welcome") }}`)
      expect(dynamicKeys).toHaveLength(0)
      expect(usages).toHaveLength(1)
    })

    it('detects $var interpolation (without braces)', async () => {
      const content = `{{ __("messages.$type.title") }}`
      const { dynamicKeys } = await extract(content)
      expect(dynamicKeys).toHaveLength(1)
      expect(dynamicKeys[0].expression).toBe('`messages.${_}.title`')
      expect(dynamicKeys[0].callee).toBe('__')
    })

    it('detects $this->property interpolation', async () => {
      const content = `{{ __("exceptions.$this->code.message") }}`
      const { dynamicKeys } = await extract(content)
      expect(dynamicKeys).toHaveLength(1)
      expect(dynamicKeys[0].expression).toBe('`exceptions.${_}.message`')
    })

    it('detects multiple bare $var interpolations', async () => {
      const content = `{{ __("connected_persons.$scope.$translationKey") }}`
      const { dynamicKeys } = await extract(content)
      expect(dynamicKeys).toHaveLength(1)
      expect(dynamicKeys[0].expression).toBe('`connected_persons.${_}.${_}`')
    })
  })

  describe('concatenation-based dynamic keys', () => {
    it('detects PHP dot concatenation with single quotes', async () => {
      const { dynamicKeys } = await extract(`{{ __('messages.' . $type) }}`)
      expect(dynamicKeys).toHaveLength(1)
      expect(dynamicKeys[0].expression).toBe('`messages.${_}`')
      expect(dynamicKeys[0].callee).toBe('__')
    })

    it('detects PHP dot concatenation with double quotes', async () => {
      const { dynamicKeys } = await extract(`{{ __("prefix." . $var) }}`)
      expect(dynamicKeys).toHaveLength(1)
      expect(dynamicKeys[0].expression).toBe('`prefix.${_}`')
    })

    it('detects trans() concatenation', async () => {
      const { dynamicKeys } = await extract(`{{ trans('pages.' . $page) }}`)
      expect(dynamicKeys).toHaveLength(1)
      expect(dynamicKeys[0].callee).toBe('trans')
    })

    it('detects @lang concatenation', async () => {
      const { dynamicKeys } = await extract(`@lang('section.' . $name)`)
      expect(dynamicKeys).toHaveLength(1)
      expect(dynamicKeys[0].callee).toBe('@lang')
    })
  })
})

describe('getPatternSet', () => {
  it('returns Laravel patterns for php-array format', () => {
    const patterns = getPatternSet('php-array')
    expect(patterns.label).toBe('Laravel')
    expect(patterns.filePatterns).toContain('**/*.blade.php')
    expect(patterns.filePatterns).toContain('**/*.php')
  })

  it('returns Vue/Nuxt patterns for json format', () => {
    const patterns = getPatternSet('json')
    expect(patterns.label).toBe('Vue / Nuxt')
    expect(patterns.filePatterns).toContain('**/*.vue')
  })

  it('returns Vue/Nuxt patterns for undefined format', () => {
    const patterns = getPatternSet(undefined)
    expect(patterns.label).toBe('Vue / Nuxt')
  })
})

describe('Laravel scanSourceFiles', () => {
  beforeAll(async () => {
    await mkdir(tmpDir, { recursive: true })
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
    await mkdir(tmpDir, { recursive: true })
  })

  it('scans .blade.php files', async () => {
    await writeFile(join(tmpDir, 'welcome.blade.php'), [
      '<h1>{{ __("pages.welcome.title") }}</h1>',
      '<p>@lang("pages.welcome.body")</p>',
    ].join('\n'))

    const result = await scanSourceFiles(tmpDir, undefined, LARAVEL_PATTERNS)
    expect(result.filesScanned).toBe(1)
    expect(result.uniqueKeys.size).toBe(2)
    expect(result.uniqueKeys.has('pages.welcome.title')).toBe(true)
    expect(result.uniqueKeys.has('pages.welcome.body')).toBe(true)
  })

  it('scans .php files', async () => {
    await writeFile(join(tmpDir, 'UserController.php'), [
      '<?php',
      'return __("users.created");',
    ].join('\n'))

    const result = await scanSourceFiles(tmpDir, undefined, LARAVEL_PATTERNS)
    expect(result.filesScanned).toBe(1)
    expect(result.uniqueKeys.has('users.created')).toBe(true)
  })

  it('scans nested directories', async () => {
    await mkdir(join(tmpDir, 'views/partials'), { recursive: true })
    await writeFile(join(tmpDir, 'views/partials/header.blade.php'), `{{ __('layout.header') }}`)

    const result = await scanSourceFiles(tmpDir, undefined, LARAVEL_PATTERNS)
    expect(result.filesScanned).toBe(1)
    expect(result.uniqueKeys.has('layout.header')).toBe(true)
  })

  it('skips vendor directory', async () => {
    await mkdir(join(tmpDir, 'vendor/laravel'), { recursive: true })
    await writeFile(join(tmpDir, 'vendor/laravel/helpers.php'), `__('vendor.key')`)
    await writeFile(join(tmpDir, 'app.blade.php'), `{{ __('app.key') }}`)

    const result = await scanSourceFiles(tmpDir, undefined, LARAVEL_PATTERNS)
    expect(result.filesScanned).toBe(1)
    expect(result.uniqueKeys.has('vendor.key')).toBe(false)
    expect(result.uniqueKeys.has('app.key')).toBe(true)
  })

  it('skips storage directory', async () => {
    await mkdir(join(tmpDir, 'storage/logs'), { recursive: true })
    await writeFile(join(tmpDir, 'storage/logs/compiled.php'), `__('cached.key')`)

    const result = await scanSourceFiles(tmpDir, undefined, LARAVEL_PATTERNS)
    expect(result.filesScanned).toBe(0)
  })

  it('does not scan .vue or .ts files with Laravel patterns', async () => {
    await writeFile(join(tmpDir, 'Component.vue'), `{{ $t('vue.key') }}`)
    await writeFile(join(tmpDir, 'utils.ts'), `t('ts.key')`)
    await writeFile(join(tmpDir, 'page.blade.php'), `{{ __('blade.key') }}`)

    const result = await scanSourceFiles(tmpDir, undefined, LARAVEL_PATTERNS)
    expect(result.filesScanned).toBe(1)
    expect(result.uniqueKeys.has('vue.key')).toBe(false)
    expect(result.uniqueKeys.has('ts.key')).toBe(false)
    expect(result.uniqueKeys.has('blade.key')).toBe(true)
  })

  it('respects custom excludeDirs', async () => {
    await mkdir(join(tmpDir, 'tests'), { recursive: true })
    await writeFile(join(tmpDir, 'tests/Feature.php'), `__('test.key')`)
    await writeFile(join(tmpDir, 'app.php'), `__('app.key')`)

    const result = await scanSourceFiles(tmpDir, ['tests'], LARAVEL_PATTERNS)
    expect(result.filesScanned).toBe(1)
    expect(result.uniqueKeys.has('test.key')).toBe(false)
    expect(result.uniqueKeys.has('app.key')).toBe(true)
  })

  it('handles empty directory gracefully', async () => {
    const result = await scanSourceFiles(tmpDir, undefined, LARAVEL_PATTERNS)
    expect(result.filesScanned).toBe(0)
    expect(result.uniqueKeys.size).toBe(0)
  })

  it('reports dynamic keys from scanned files', async () => {
    await writeFile(join(tmpDir, 'dynamic.blade.php'), [
      '{{ __("status.{$type}.label") }}',
      '{{ __("static.key") }}',
    ].join('\n'))

    const result = await scanSourceFiles(tmpDir, undefined, LARAVEL_PATTERNS)
    expect(result.usages).toHaveLength(1)
    expect(result.usages[0].key).toBe('static.key')
    expect(result.dynamicKeys).toHaveLength(1)
    expect(result.dynamicKeys[0].expression).toContain('status.')
  })

  it('deduplicates keys in uniqueKeys set', async () => {
    await writeFile(join(tmpDir, 'a.blade.php'), `{{ __('shared.key') }}`)
    await writeFile(join(tmpDir, 'b.blade.php'), `{{ __('shared.key') }}`)

    const result = await scanSourceFiles(tmpDir, undefined, LARAVEL_PATTERNS)
    expect(result.filesScanned).toBe(2)
    expect(result.usages).toHaveLength(2)
    expect(result.uniqueKeys.size).toBe(1)
  })

  // #262 — keys constructed away from the translation call must still become
  // bare dynamic candidates, or a remove-orphans run deletes live keys.
  describe('indirectly-constructed key candidates (#262)', () => {
    it('collects variable-assigned interpolated strings amid $-heavy PHP code', async () => {
      // Mimics bookings-api FormatsBookingChanges.php: the interpolated key is
      // assigned to a variable first; surrounding code is full of $vars and
      // other double-quoted strings that must not shift quote parity past it.
      await writeFile(join(tmpDir, 'FormatsBookingChanges.php'), [
        '<?php',
        'foreach ($changedAttributes as $key => $value) {',
        '    $original = isset($originalAttributes[$key]) ? $originalAttributes[$key] : null;',
        '    $transKey = "api.bookings.attributes.{$key}";',
        '    $translatedAttribute = Lang::has($transKey) ? Lang::get($transKey) : $key;',
        '    $list .= "<li>" . $translatedAttribute . "</li>";',
        '}',
      ].join('\n'))

      const result = await scanSourceFiles(tmpDir, undefined, LARAVEL_PATTERNS)
      expect(result.bareDynamicCandidates.has('`api.bookings.attributes.${_}`')).toBe(true)
      const regexes = buildDynamicKeyRegexes([...result.bareDynamicCandidates].map(e => ({ expression: e })))
      expect(regexes.some(re => re.test('api.bookings.attributes.start_date'))).toBe(true)
    })

    it('collects prefix-shaped string literals passed as plain arguments', async () => {
      // Mimics bookings-api OrdersExport.php: the prefix is a builder argument,
      // concatenated inside a helper (__("{$this->translationPrefix}$value")).
      await writeFile(join(tmpDir, 'OrdersExport.php'), [
        '<?php',
        "TranslatedColumn::make('status', __('exports.orders.status'), 'status')",
        "    ->translationPrefix('api.orders.status.'),",
      ].join('\n'))

      const result = await scanSourceFiles(tmpDir, undefined, LARAVEL_PATTERNS)
      expect(result.bareDynamicCandidates.has('`api.orders.status.${_}`')).toBe(true)
    })

    it('does not build candidates from interpolation-only or dotless strings', async () => {
      await writeFile(join(tmpDir, 'Helper.php'), [
        '<?php',
        'return $value ? __("{$this->translationPrefix}$value") : $this->defaultValue;',
        '$greeting = "hello_$name";',
      ].join('\n'))

      const result = await scanSourceFiles(tmpDir, undefined, LARAVEL_PATTERNS)
      expect(result.bareDynamicCandidates.size).toBe(0)
    })

    it('ground truth: indirectly-consumed keys are never safe orphans', async () => {
      await writeFile(join(tmpDir, 'FormatsBookingChanges.php'), [
        '<?php',
        '$transKey = "api.bookings.attributes.{$key}";',
        '$label = Lang::has($transKey) ? Lang::get($transKey) : $key;',
      ].join('\n'))
      await writeFile(join(tmpDir, 'InvoiceItemsExport.php'), [
        '<?php',
        "TranslatedColumn::make('invoice.status', __('exports.invoices.status'), 'document.status')",
        "    ->translationPrefix('api.invoices.status.'),",
      ].join('\n'))

      const result = await findOrphanKeysForConfig({
        keysByLayer: new Map([['root', {
          keys: ['api.bookings.attributes.start_date', 'api.invoices.status.paid', 'api.truly.unused'],
          localeDir: { layer: 'root' },
        }]]),
        resolveIgnorePatterns: () => undefined,
        patterns: LARAVEL_PATTERNS,
        scanDirs: [tmpDir],
      })

      expect(result.orphansByLayer.root ?? []).toEqual(['api.truly.unused'])
      expect(result.dynamicMatchedCount).toBe(2)
    })
  })

  // #288 — shape gating must not regress PHP collection, and the JS-only
  // shapes (backtick templates, `+`-concat) must not run on PHP files where
  // they can only misfire (shell-exec backticks, `+`-adjacent decimals).
  describe('bare-shape language gating (#288)', () => {
    it('PHP interpolated strings still produce their candidate', async () => {
      await writeFile(join(tmpDir, 'Resource.php'), [
        '<?php',
        '$title = "api.{$var}.title";',
      ].join('\n'))

      const result = await scanSourceFiles(tmpDir, undefined, LARAVEL_PATTERNS)
      expect(result.bareDynamicCandidates.has('`api.${_}.title`')).toBe(true)
    })

    it('JS-only shapes do not run on PHP files', async () => {
      await writeFile(join(tmpDir, 'Shell.php'), [
        '<?php',
        '$path = `${CACHE_DIR}.tmp`;',
        '$total = $count + ".5";',
      ].join('\n'))

      const result = await scanSourceFiles(tmpDir, undefined, LARAVEL_PATTERNS)
      expect(result.bareDynamicCandidates.size).toBe(0)
    })
  })
})
