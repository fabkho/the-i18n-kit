import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractKeys, scanSourceFiles } from '../../src/scanner/code-scanner.js'
import { LARAVEL_PATTERNS, getPatternSet } from '../../src/scanner/patterns.js'

const tmpDir = join(dirname(fileURLToPath(import.meta.url)), '../../.tmp-test/laravel-scanner')

function extract(content: string, filePath = 'test.blade.php') {
  return extractKeys(content, filePath, LARAVEL_PATTERNS)
}

describe('Laravel extractKeys', () => {
  describe('static key extraction', () => {
    it('extracts __() with single quotes', () => {
      const { usages } = extract(`<?php echo __('messages.welcome'); ?>`)
      expect(usages).toHaveLength(1)
      expect(usages[0]).toMatchObject({ key: 'messages.welcome', callee: '__', line: 1 })
    })

    it('extracts __() with double quotes', () => {
      const { usages } = extract(`<?php echo __("messages.welcome"); ?>`)
      expect(usages).toHaveLength(1)
      expect(usages[0]).toMatchObject({ key: 'messages.welcome', callee: '__' })
    })

    it('extracts trans() with single quotes', () => {
      const { usages } = extract(`{{ trans('auth.failed') }}`)
      expect(usages).toHaveLength(1)
      expect(usages[0]).toMatchObject({ key: 'auth.failed', callee: 'trans', line: 1 })
    })

    it('extracts trans() with double quotes', () => {
      const { usages } = extract(`{{ trans("auth.failed") }}`)
      expect(usages).toHaveLength(1)
      expect(usages[0]).toMatchObject({ key: 'auth.failed', callee: 'trans' })
    })

    it('extracts trans_choice()', () => {
      const { usages } = extract(`{{ trans_choice('messages.apples', 10) }}`)
      expect(usages).toHaveLength(1)
      expect(usages[0]).toMatchObject({ key: 'messages.apples', callee: 'trans_choice' })
    })

    it('extracts Lang::get()', () => {
      const { usages } = extract(`<?php Lang::get('messages.welcome'); ?>`)
      expect(usages).toHaveLength(1)
      expect(usages[0]).toMatchObject({ key: 'messages.welcome', callee: 'Lang::get' })
    })

    it('extracts @lang() Blade directive', () => {
      const { usages } = extract(`@lang('messages.welcome')`)
      expect(usages).toHaveLength(1)
      expect(usages[0]).toMatchObject({ key: 'messages.welcome', callee: '@lang' })
    })

    it('extracts keys without dots (no bare-callee filter for Laravel)', () => {
      const { usages } = extract(`__('welcome')`)
      expect(usages).toHaveLength(1)
      expect(usages[0]).toMatchObject({ key: 'welcome', callee: '__' })
    })

    it('extracts multiple keys from the same line', () => {
      const { usages } = extract(`<p>{{ __('auth.login') }} | {{ __('auth.register') }}</p>`)
      expect(usages).toHaveLength(2)
      expect(usages[0].key).toBe('auth.login')
      expect(usages[1].key).toBe('auth.register')
    })

    it('extracts keys across multiple lines with correct line numbers', () => {
      const content = [
        '<h1>{{ __("pages.title") }}</h1>',
        '',
        '<p>{{ trans("pages.body") }}</p>',
      ].join('\n')
      const { usages } = extract(content)
      expect(usages).toHaveLength(2)
      expect(usages[0]).toMatchObject({ key: 'pages.title', line: 1 })
      expect(usages[1]).toMatchObject({ key: 'pages.body', line: 3 })
    })

    it('extracts keys with spaces around parentheses', () => {
      const { usages } = extract(`__(  'spaced.key'  )`)
      expect(usages).toHaveLength(1)
      expect(usages[0].key).toBe('spaced.key')
    })

    it('extracts keys with nested dots', () => {
      const { usages } = extract(`__('admin.users.permissions.edit')`)
      expect(usages).toHaveLength(1)
      expect(usages[0].key).toBe('admin.users.permissions.edit')
    })

    it('does not match __() preceded by a word character', () => {
      const { usages } = extract(`foo__('not.a.key')`)
      expect(usages).toHaveLength(0)
    })

    it('does not match trans preceded by a word character', () => {
      const { usages } = extract(`detrans('not.a.key')`)
      expect(usages).toHaveLength(0)
    })

    it('extracts from Blade echo and raw echo', () => {
      const content = [
        '{{ __("escaped.key") }}',
        '{!! __("raw.key") !!}',
      ].join('\n')
      const { usages } = extract(content)
      expect(usages).toHaveLength(2)
      expect(usages[0].key).toBe('escaped.key')
      expect(usages[1].key).toBe('raw.key')
    })

    it('extracts from PHP controller code', () => {
      const content = [
        '<?php',
        'class UserController extends Controller {',
        '    public function store() {',
        '        return redirect()->with("status", __("users.created"));',
        '    }',
        '}',
      ].join('\n')
      const { usages } = extract(content, 'UserController.php')
      expect(usages).toHaveLength(1)
      expect(usages[0]).toMatchObject({ key: 'users.created', callee: '__', line: 4 })
    })

    it('extracts from validation messages array', () => {
      const content = [
        "'email.required' => __('validation.email_required'),",
        "'name.max' => trans('validation.name_too_long'),",
      ].join('\n')
      const { usages } = extract(content, 'validation.php')
      expect(usages).toHaveLength(2)
      expect(usages[0].key).toBe('validation.email_required')
      expect(usages[1].key).toBe('validation.name_too_long')
    })
  })

  describe('dynamic key extraction', () => {
    it('detects PHP variable interpolation in double-quoted strings', () => {
      const { dynamicKeys } = extract(`__("messages.{$type}.title")`)
      expect(dynamicKeys).toHaveLength(1)
      expect(dynamicKeys[0].expression).toContain('messages.')
      expect(dynamicKeys[0].expression).toContain('.title')
      expect(dynamicKeys[0].callee).toBe('__')
    })

    it('ignores static double-quoted strings (no interpolation)', () => {
      const { dynamicKeys, usages } = extract(`__("messages.welcome")`)
      expect(dynamicKeys).toHaveLength(0)
      expect(usages).toHaveLength(1)
    })

    it('detects $var interpolation (without braces)', () => {
      const content = `__("messages.$type.title")`
      const { dynamicKeys } = extract(content)
      expect(dynamicKeys).toHaveLength(1)
      expect(dynamicKeys[0].expression).toBe('`messages.${_}.title`')
      expect(dynamicKeys[0].callee).toBe('__')
    })

    it('detects $this->property interpolation', () => {
      const content = `__("exceptions.$this->code.message")`
      const { dynamicKeys } = extract(content)
      expect(dynamicKeys).toHaveLength(1)
      expect(dynamicKeys[0].expression).toBe('`exceptions.${_}.message`')
    })

    it('detects multiple bare $var interpolations', () => {
      const content = `__("connected_persons.$scope.$translationKey")`
      const { dynamicKeys } = extract(content)
      expect(dynamicKeys).toHaveLength(1)
      expect(dynamicKeys[0].expression).toBe('`connected_persons.${_}.${_}`')
    })
  })

  describe('concatenation-based dynamic keys', () => {
    it('detects PHP dot concatenation with single quotes', () => {
      const { dynamicKeys } = extract(`__('messages.' . $type)`)
      expect(dynamicKeys).toHaveLength(1)
      expect(dynamicKeys[0].expression).toBe('`messages.${_}`')
      expect(dynamicKeys[0].callee).toBe('__')
    })

    it('detects PHP dot concatenation with double quotes', () => {
      const { dynamicKeys } = extract(`__("prefix." . $var)`)
      expect(dynamicKeys).toHaveLength(1)
      expect(dynamicKeys[0].expression).toBe('`prefix.${_}`')
    })

    it('detects trans() concatenation', () => {
      const { dynamicKeys } = extract(`trans('pages.' . $page)`)
      expect(dynamicKeys).toHaveLength(1)
      expect(dynamicKeys[0].callee).toBe('trans')
    })

    it('detects @lang concatenation', () => {
      const { dynamicKeys } = extract(`@lang('section.' . $name)`)
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
})
