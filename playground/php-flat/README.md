# Flat PHP playground

A PHP project that is **not Laravel**: one file per locale, `lang/en.php`, rather
than Laravel's `lang/<locale>/<namespace>.php`.

```bash
the-i18n-cli status --projectDir playground/php-flat
```

## What it is here to prove

`php-array` used to mean Laravel's directory-per-locale layout everywhere, so this
project could not be resolved at all — format detection only looked for `.php`
inside per-locale directories, and a flat layout read as an empty directory
(#308).

Detecting it was not enough on its own. The write path assumed the same layout,
so a project like this one would have been read from `lang/de.php` and written
back to `lang/de/<namespace>.php` — restructuring someone's locale files instead
of editing them. The layout is now decided by what is on disk, and this project
is what keeps that true.

`playground/laravel` covers the namespaced layout. Both exist because the format
alone cannot tell them apart.

## Layout

| Path | Why |
|---|---|
| `lang/{en,de,fr}.php` | Flat array files — the layout under test |
| `src/BookingController.php` | `__()` and `trans()` call sites for the scanner |
| `i18n-kit.config.ts` | Declares `localeDirs` and `defaultLocale`; there is nothing here to detect |

`de.php` is deliberately missing `greeting`, and `legacy_banner` is referenced by
nothing, so `missing` and `remove-orphans` each have exactly one thing to report:

```
$ the-i18n-cli missing --projectDir playground/php-flat
{"missing":{"de":{"default":["greeting"]}},"total":1}

$ the-i18n-cli remove-orphans --projectDir playground/php-flat
{"orphans":{"default":["legacy_banner"]},"count":1}
```
