# RU payment worker (Robokassa)

Минимальный российский платёжный контур для production-версии Архиватора ChatGPT.

## Что делает

- открывает Robokassa checkout для monthly, annual, lifetime;
- использует SHA-256 подписи Robokassa;
- принимает ResultURL, проверяет подпись Паролем #2 и сумму заказа;
- только после подтверждённого ResultURL выпускает ECDSA P-256 license token;
- возвращает OK{InvId} Robokassa;
- на success-странице показывает готовый ключ покупателю;
- не получает содержимое чатов и не требует пользовательского аккаунта.

Тарифы: 249 ₽ / 30 дней, 1 790 ₽ / 365 дней, 3 490 ₽ / бессрочно.

## Cloudflare Worker

Создайте KV namespace и привяжите его как PAYMENTS.

Secrets:
- ROBOKASSA_MERCHANT_LOGIN
- ROBOKASSA_PASSWORD1
- ROBOKASSA_PASSWORD2
- LICENSE_PRIVATE_KEY_JWK — приватный P-256 JWK, соответствующий публичному ключу в lib/entitlement.mjs

Для тестового режима:
- ROBOKASSA_TEST_MODE=1
- ROBOKASSA_TEST_PASSWORD1
- ROBOKASSA_TEST_PASSWORD2

Приватный ключ и пароли Robokassa не коммитить.

## Настройки магазина Robokassa

В технических настройках магазина:
- алгоритм хэша: SHA256;
- Result URL: https://<worker>/robokassa/result, метод POST;
- Success URL: https://<worker>/payment/success, метод GET;
- Fail URL: https://<worker>/payment/fail, метод GET.

Robokassa требует проверять подпись ResultURL и отвечать OK{InvId}. Worker это делает.

## URL покупки

- https://<worker>/checkout?plan=monthly
- https://<worker>/checkout?plan=annual
- https://<worker>/checkout?plan=lifetime

## Робочеки СМЗ

Для самозанятого подключите в кабинете Robokassa Робочеки СМЗ и дайте сервису доступ к «Моему налогу». По публичной документации Robokassa сервис автоматически регистрирует доход, формирует чек и отправляет его покупателю и в ФНС.

Перед боевым платежом отдельно проверьте в кабинете Robokassa, какая номенклатура должна быть настроена для лицензии на программу. Worker намеренно не придумывает Receipt для НПД, пока это не подтверждено настройками конкретного магазина.

## Проверка

1. Развернуть Worker с тестовыми секретами.
2. Настроить тестовые Result/Success/Fail URL.
3. Сделать тестовый платёж.
4. Убедиться, что ResultURL вернул OK{InvId}.
5. Скопировать license token со страницы успеха и активировать его в production extension.
6. Проверить monthly, annual, lifetime и повреждённую подпись.
7. Только после этого переключить Worker и магазин в боевой режим.
