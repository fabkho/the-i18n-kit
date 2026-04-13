<template>
  <div>
    <h1>{{ $t('common.navigation.home') }}</h1>
    <p>{{ $t('common.messages.noData') }}</p>
    <button>{{ $t('common.actions.save') }}</button>
    <button>{{ $t('common.actions.cancel') }}</button>

    <hr />
    <h2>Admin Section</h2>
    <p>{{ $t('admin.dashboard.title') }}</p>
    <p>{{ $t('admin.dashboard.welcome', { name: 'User' }) }}</p>
  </div>
</template>
