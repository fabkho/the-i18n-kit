<?php

class BookingController
{
    public function confirm(): string
    {
        return __('confirm_booking');
    }

    public function greet(string $name): string
    {
        return __('greeting', ['name' => $name]);
    }

    public function actions(): array
    {
        return [
            'primary' => __('save'),
            'secondary' => trans('cancel'),
        ];
    }
}
