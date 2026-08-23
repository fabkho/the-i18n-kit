import { describe, it, expect } from 'vitest'

import { createBladeFrontend } from '../../src/scanner/frontends/php/blade.js'
import { interpret, ambiguousCalleeNeedsDot } from '../../src/scanner/rules.js'

/**
 * Blade by lifting (#404): directives and echoes reduced to the PHP
 * expressions they wrap, parsed by the same engine as plain PHP. The lexical
 * pass frames text; it never decides what a key is.
 */

const frontend = createBladeFrontend()

async function scan(source: string, filePath = 'resources/views/page.blade.php') {
  const sites = await frontend.read(source, filePath)
  if (!sites) return null
  return interpret(sites, { filePath, ambiguousCalleeNeedsDot })
}

async function scanKeys(...lines: string[]) {
  const evidence = await scan(lines.join('\n'))
  return evidence?.usages.map(u => u.key)
}

describe('lifting', () => {
  it('reads echoes, raw echoes, directives and php blocks alike', async () => {
    const evidence = await scan([
      `<h1>{{ __('pages.home.title') }}</h1>`,
      `<div>{!! trans('pages.home.body') !!}</div>`,
      `<p>@lang('pages.home.footer')</p>`,
      `<span>@choice('pages.home.visits', $count)</span>`,
      `@php $label = __('pages.home.aside'); @endphp`,
      `<?php echo __('pages.home.meta'); ?>`,
    ].join('\n'))

    expect(evidence?.usages.map(u => u.key)).toEqual([
      'pages.home.title',
      'pages.home.body',
      'pages.home.footer',
      'pages.home.visits',
      'pages.home.aside',
      'pages.home.meta',
    ])
  })

  it('reports directives under their own names, as the reports always have', async () => {
    const evidence = await scan(`@lang('a.b') @choice('c.d', 2)`)

    expect(evidence?.usages.map(u => u.callee)).toEqual(['@lang', '@choice'])
  })

  it('reports template line numbers, not lifted-chunk lines', async () => {
    const evidence = await scan(`<div>\n  <p>\n    {{ __('deep.key') }}\n  </p>\n</div>`)

    expect(evidence?.usages[0]).toMatchObject({ key: 'deep.key', line: 3 })
  })

  it('does not read comments, whatever they contain', async () => {
    const evidence = await scan(`{{-- {{ __('commented.out') }} @lang('also.out') --}}`)

    expect(evidence?.usages).toEqual([])
  })

  it('carries interpolation and concatenation through the lift', async () => {
    const evidence = await scan([
      `{{ __("statuses.{$status}.label") }}`,
      `@lang('orders.' . $type)`,
    ].join('\n'))

    expect(evidence?.dynamicKeys.map(d => d.expression)).toEqual([
      '`statuses.${_}.label`',
      '`orders.${_}`',
    ])
  })

  it("reads translation calls inside any directive's arguments", async () => {
    // Laravel's own error pages: @section('title', __('Forbidden')).
    const keys = await scanKeys(
      `@extends('errors.layout')`,
      `@section('title', ($e instanceof \\App\\X) ? $e->getTitle() : __('Forbidden'))`,
      `@if($booking->isPast()) {{ __('bookings.past.notice') }} @endif`,
    )

    expect(keys).toContain('Forbidden')
    expect(keys).toContain('bookings.past.notice')
  })

  it('skips control-flow directive grammar without declining the file', async () => {
    const keys = await scanKeys(
      `@foreach($items as $item)`,
      `  {{ __('list.item.label') }}`,
      `@endforeach`,
    )

    expect(keys).toEqual(['list.item.label'])
  })

  it('reads the inline @php form, and blocks do not swallow past it', async () => {
    const evidence = await scan([
      `@php($label = __('nav.home'))`,
      `<p>{{ __('nav.about') }}</p>`,
      `@php $x = __('nav.footer'); @endphp`,
    ].join('\n'))

    expect(evidence?.usages.map(u => u.key)).toEqual(['nav.home', 'nav.about', 'nav.footer'])
  })

  it('reads bound component attributes', async () => {
    const evidence = await scan([
      `<x-alert :message="__('alerts.saved')" />`,
      `<x-button :label='trans("actions.retry")' ::class="plain.vue.stuff" />`,
    ].join('\n'))

    expect(evidence?.usages.map(u => u.key)).toEqual(['alerts.saved', 'actions.retry'])
  })

  it('template text outside any construct is text, not code', async () => {
    const evidence = await scan(`__('just.text.in.the.page')`)

    expect(evidence?.usages).toEqual([])
  })
})

describe('declining', () => {
  it('declines the whole file when a lifted chunk cannot be parsed', async () => {
    const sites = await frontend.read(`{{ __('fine.key') }}\n{{ class ! broken }}`, 'x.blade.php')

    expect(sites).toBeNull()
  })

  it('reads only Blade', () => {
    expect(frontend.handles('a.blade.php')).toBe(true)
    expect(frontend.handles('a.php')).toBe(false)
  })
})
