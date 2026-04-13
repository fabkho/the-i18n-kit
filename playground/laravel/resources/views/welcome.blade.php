<div class="container">
    <h1>{{ __('common.messages.success') }}</h1>

    <form method="POST" action="/login">
        <label>{{ __('auth.login') }}</label>
        <input type="email" placeholder="{{ __('auth.password') }}">

        <button type="submit">{{ __('common.actions.save') }}</button>
        <a href="/back">{{ __('common.actions.back') }}</a>
    </form>

    <p>{{ trans_choice('common.terms.booking', 2) }}</p>
    <p>{{ trans('common.messages.loading') }}</p>

    @lang('auth.forgot_password')

    <div>
        {{ __('common.actions.edit') }}
        {{ __('common.actions.delete') }}
        {{ __('common.messages.confirm_delete') }}
    </div>
</div>
