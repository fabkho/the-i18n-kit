import { describe, it, expect } from 'vitest'
import { validatePlaceholders, failReasonForIssue } from '../../src/core/translate/placeholders.js'
import type { LocaleFileFormat } from '../../src/adapters/types.js'

/**
 * ICU MessageFormat parity. A model that drops the `other` arm, renames an
 * argument or loses `#` produces a message that throws at runtime in
 * next-intl / react-intl / formatjs, so the value must never reach a locale
 * file. What must NOT fail is a target language with different plural
 * categories — English one|other legitimately becomes Polish
 * one|few|many|other or Japanese other.
 */

function validate(source: string, target: string, format?: LocaleFileFormat) {
  return validatePlaceholders('key', source, [{ locale: 'de', value: target }], format)
}

/** The fail reason the translate run would record for this pair. */
function reasonFor(source: string, target: string, format?: LocaleFileFormat) {
  const issue = validate(source, target, format).errors[0]
  return issue ? failReasonForIssue(issue) : undefined
}

const EN_FILES = '{count, plural, one {# file} other {# files}}'

describe('ICU plural arms', () => {
  it('accepts a target language with different plural categories', () => {
    expect(validate(EN_FILES, '{count, plural, one {# Datei} other {# Dateien}}').ok).toBe(true)
    // Polish adds categories the source never had.
    expect(validate(EN_FILES, '{count, plural, one {# plik} few {# pliki} many {# plików} other {# pliku}}').ok).toBe(true)
    // Japanese has only `other`.
    expect(validate(EN_FILES, '{count, plural, other {#件}}').ok).toBe(true)
  })

  it('reports a dropped other arm as a plural mismatch', () => {
    const result = validate(EN_FILES, '{count, plural, one {# Datei}}')

    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatchObject({
      locale: 'de',
      key: 'key',
      kind: 'plural-count',
      missing: ['{count, plural, other}'],
    })
    expect(reasonFor(EN_FILES, '{count, plural, one {# Datei}}')).toBe('plural-mismatch')
  })

  it('reports a plural flattened to a bare argument as a plural mismatch', () => {
    expect(reasonFor(EN_FILES, '{count} Dateien')).toBe('plural-mismatch')
  })

  it('requires the explicit =N arms of the source', () => {
    const source = '{count, plural, =0 {No files} one {# file} other {# files}}'

    expect(validate(source, '{count, plural, =0 {Keine Dateien} one {# Datei} other {# Dateien}}').ok).toBe(true)

    const result = validate(source, '{count, plural, one {# Datei} other {# Dateien}}')
    expect(result.errors[0]).toMatchObject({ kind: 'plural-count', missing: ['{count, plural, =0}'] })
    expect(reasonFor(source, '{count, plural, one {# Datei} other {# Dateien}}')).toBe('plural-mismatch')
  })

  it('reads plural parameters such as offset: as parameters, not arms', () => {
    const source = '{count, plural, offset:1 =0 {nobody} one {you and # other} other {you and # others}}'

    expect(validate(source, '{count, plural, offset:1 =0 {niemand} other {du und # andere}}').ok).toBe(true)
    expect(reasonFor(source, '{count, plural, offset:1 other {du und # andere}}')).toBe('plural-mismatch')
  })

  it('applies the same rules to selectordinal', () => {
    const source = '{place, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}'

    expect(validate(source, '{place, selectordinal, other {#.}}').ok).toBe(true)
    expect(validate(source, '{place, selectordinal, one {#.}}').errors[0]).toMatchObject({
      missing: ['{place, selectordinal, other}'],
    })
  })

  it('reports a lost number interpolation', () => {
    const result = validate(EN_FILES, '{count, plural, one {eine Datei} other {mehrere Dateien}}')

    expect(result.errors[0]).toMatchObject({ kind: 'placeholder', missing: ['{count, plural, #}'] })
    expect(failReasonForIssue(result.errors[0]!)).toBe('placeholder-mismatch')
  })

  it('accepts {count} in place of # — the same interpolation', () => {
    expect(validate(EN_FILES, '{count, plural, one {eine Datei} other {{count} Dateien}}').ok).toBe(true)
  })
})

describe('ICU argument names', () => {
  it('reports a renamed argument as a placeholder mismatch', () => {
    const result = validate(EN_FILES, '{anzahl, plural, one {# Datei} other {# Dateien}}')

    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatchObject({
      kind: 'placeholder',
      missing: ['{count}'],
      extra: ['{anzahl}'],
    })
    expect(failReasonForIssue(result.errors[0]!)).toBe('placeholder-mismatch')
  })

  it('compares names case-sensitively', () => {
    expect(reasonFor(EN_FILES, '{Count, plural, one {# Datei} other {# Dateien}}')).toBe('placeholder-mismatch')
  })

  it('reports the ICU argument names it validated', () => {
    expect(validate('{count, plural, other {# of {total}}}', '{count, plural, other {# von {total}}}').placeholders)
      .toEqual(['{count}', '{total}'])
  })

  it('still checks vue-i18n linked messages in an ICU source', () => {
    const source = '@:app.name — {count, plural, other {# files}}'

    expect(validate(source, '@:app.name — {count, plural, other {# Dateien}}').ok).toBe(true)
    expect(reasonFor(source, '{count, plural, other {# Dateien}}')).toBe('placeholder-mismatch')
  })
})

describe('ICU nesting', () => {
  const source = '{count, plural,'
    + ' one {{gender, select, male {He has # book} female {She has # book} other {They have # book}}}'
    + ' other {{gender, select, male {He has # books} female {She has # books} other {They have # books}}}}'

  it('accepts a nested select in a plural when both levels survive', () => {
    const target = '{count, plural,'
      + ' one {{gender, select, male {Er hat # Buch} female {Sie hat # Buch} other {Sie haben # Buch}}}'
      + ' other {{gender, select, male {Er hat # Bücher} female {Sie hat # Bücher} other {Sie haben # Bücher}}}}'

    expect(validate(source, target).ok).toBe(true)
  })

  it('accepts a language that keeps only the other arm around the nested select', () => {
    const target = '{count, plural,'
      + ' other {{gender, select, male {彼は#冊} female {彼女は#冊} other {#冊}}}}'

    expect(validate(source, target).ok).toBe(true)
  })

  it('reports a nested select arm renamed at any level', () => {
    const target = '{count, plural,'
      + ' other {{gender, select, mann {Er hat # Bücher} female {Sie hat # Bücher} other {Sie haben # Bücher}}}}'

    const result = validate(source, target)
    expect(result.errors[0]).toMatchObject({
      kind: 'plural-count',
      missing: ['{gender, select, male}'],
      extra: ['{gender, select, mann}'],
    })
    expect(reasonFor(source, target)).toBe('plural-mismatch')
  })

  it('reports a nested argument dropped entirely', () => {
    const target = '{count, plural, other {Sie haben # Bücher}}'

    expect(validate(source, target).errors[0]).toMatchObject({ kind: 'placeholder', missing: ['{gender}'] })
    expect(reasonFor(source, target)).toBe('placeholder-mismatch')
  })
})

describe('ICU select', () => {
  const source = '{gender, select, male {He replied} female {She replied} other {They replied}}'

  it('accepts a translation that keeps every arm', () => {
    expect(validate(source, '{gender, select, male {Er antwortete} female {Sie antwortete} other {Sie antworteten}}').ok).toBe(true)
  })

  it('reports a missing select arm — select keys are not language-dependent', () => {
    const target = '{gender, select, male {Er antwortete} other {Sie antworteten}}'
    const result = validate(source, target)

    expect(result.errors[0]).toMatchObject({
      kind: 'plural-count',
      missing: ['{gender, select, female}'],
      extra: [],
      sourceVariants: 3,
      targetVariants: 2,
    })
    expect(reasonFor(source, target)).toBe('plural-mismatch')
  })

  it('reports an added select arm', () => {
    const target = '{gender, select, male {Er} female {Sie} divers {Sie} other {Sie}}'

    expect(validate(source, target).errors[0]).toMatchObject({ extra: ['{gender, select, divers}'] })
  })
})

describe('ICU quoting and literals', () => {
  it("treats '' as a literal apostrophe", () => {
    const source = "It''s {n, plural, one {# day} other {# days}}"

    expect(validate(source, "Es ist''s {n, plural, one {# Tag} other {# Tage}}").ok).toBe(true)
    expect(reasonFor(source, "Es ist''s {n, plural, one {# Tag}}")).toBe('plural-mismatch')
  })

  it("treats a lone apostrophe as text — It's needs no escaping", () => {
    const source = "It's {n, plural, one {# day} other {# days}}"

    expect(validate(source, "Es ist's {n, plural, other {# Tage}}").ok).toBe(true)
  })

  it("does not read a quoted '{' as an argument", () => {
    const source = "'{'literal'}' {n, plural, one {# day} other {# days}}"

    expect(validate(source, "'{'wörtlich'}' {n, plural, other {# Tage}}").ok).toBe(true)
    expect(validate(source, "{n, plural, other {# Tage}}").ok).toBe(true)
  })

  it('treats # outside a plural arm as literal text', () => {
    const source = 'Order #{id}: {count, plural, one {# item} other {# items}}'

    // The literal "#" before {id} may go; the "#" inside the arms may not.
    expect(validate(source, 'Bestellung Nr. {id}: {count, plural, other {# Artikel}}').ok).toBe(true)
    expect(reasonFor(source, 'Bestellung Nr. {id}: {count, plural, other {mehrere Artikel}}')).toBe('placeholder-mismatch')
  })

  it('does not split an ICU source on the vue-i18n pipe', () => {
    const source = '{count, plural, one {# unread} other {# unread}} | Inbox'
    // Three pipe segments against two would be a plural-count error on the
    // vue-i18n path; in an ICU message the pipe is plain text.
    expect(validate(source, '{count, plural, other {# ungelesen}} | Posteingang | Mehr').ok).toBe(true)
  })
})

describe('ICU braces', () => {
  it('reports an unclosed brace in the candidate', () => {
    const result = validate(EN_FILES, '{count, plural, one {# Datei} other {# Dateien}')

    expect(result.errors[0]).toMatchObject({ kind: 'placeholder', missing: ['unbalanced ICU braces'] })
    expect(reasonFor(EN_FILES, '{count, plural, one {# Datei} other {# Dateien}')).toBe('placeholder-mismatch')
  })

  it('reports a stray closing brace in the candidate', () => {
    expect(validate(EN_FILES, '{count, plural, other {# Dateien}}}').errors[0])
      .toMatchObject({ kind: 'placeholder', missing: ['unbalanced ICU braces'] })
    expect(reasonFor(EN_FILES, '{count, plural, other {# Dateien}}}')).toBe('placeholder-mismatch')
  })

  it('falls back to the plain path when the source itself is unbalanced', () => {
    // An unparsable source would otherwise fail every translation of it.
    expect(validate('{count, plural, one {# file} other {# files}', 'irgendwas').ok).toBe(true)
  })
})

describe('ICU number, date and time arguments', () => {
  const source = '{count, number} files on {when, date, short}'

  it('accepts a different style for the same format', () => {
    expect(validate(source, '{count, number} Dateien am {when, date, medium}').ok).toBe(true)
    expect(validate('{amount, number, ::currency/EUR}', '{amount, number, ::currency/EUR} netto').ok).toBe(true)
  })

  it('reports a dropped format', () => {
    const result = validate(source, '{count} Dateien am {when, date, short}')

    expect(result.errors[0]).toMatchObject({
      kind: 'placeholder',
      missing: ['{count, number}'],
      extra: ['{count}'],
    })
    expect(reasonFor(source, '{count} Dateien am {when, date, short}')).toBe('placeholder-mismatch')
  })

  it('reports a dropped date argument', () => {
    expect(reasonFor(source, '{count, number} Dateien')).toBe('placeholder-mismatch')
  })

  it('validates time arguments too', () => {
    expect(validate('{at, time, short}', '{at, time, short} Uhr').ok).toBe(true)
    expect(reasonFor('{at, time, short}', '{at} Uhr')).toBe('placeholder-mismatch')
  })
})

describe('non-ICU sources keep the existing behaviour', () => {
  it('validates a plain {name} string exactly as before', () => {
    expect(validate('Hello {name}', 'Hallo {name}')).toEqual({
      ok: true,
      placeholders: ['{name}'],
      errors: [],
    })
    expect(validate('Hello {name}', 'Hallo')).toEqual({
      ok: false,
      placeholders: ['{name}'],
      errors: [{ locale: 'de', key: 'key', missing: ['{name}'], extra: [], kind: 'placeholder' }],
    })
  })

  it('still counts vue-i18n pipe variants', () => {
    const result = validate('{count} item | {count} items', '{count} Artikel')

    expect(result.errors[0]).toMatchObject({ kind: 'plural-count', sourceVariants: 2, targetVariants: 1 })
    expect(reasonFor('{count} item | {count} items', '{count} Artikel')).toBe('plural-mismatch')
  })

  it('still validates vue-i18n linked messages', () => {
    expect(validate('See @:common.help', 'Siehe @:common.help').ok).toBe(true)
    expect(reasonFor('See @:common.help', 'Siehe die Hilfe')).toBe('placeholder-mismatch')
  })

  it('leaves php-array sources on the Laravel path', () => {
    expect(validate('Hi :name', 'Hallo :name', 'php-array').ok).toBe(true)
    expect(reasonFor('Hi :name', 'Hallo', 'php-array')).toBe('placeholder-mismatch')
    // ICU syntax in a Laravel file is not ICU — :param is the only convention.
    expect(validate('{count, plural, one {# file} other {# files}}', 'Dateien', 'php-array').ok).toBe(true)
  })

  it('leaves a text argument that only looks typed on the plain path', () => {
    // "{name, dear}" has no ICU type keyword, so nothing changes for it.
    expect(validate('Hello {name}, {other}', 'Hallo {name}, {other}').ok).toBe(true)
  })
})
