# Створ на телефоне

Отдельные страницы открывают онбординг, сканер, ввод кода, добавление спортсмена и детали попытки. На вложенной странице есть кнопка возврата. История браузера восстанавливает фокус и позицию списка. На главной последняя попытка расположена над действиями нового замера.

## Сверка с Nike Training Club на iOS

| Компонент | Что видно на скриншоте Nike | Что применили в Створе |
| --- | --- | --- |
| История и навигация | Activity вынесена в самостоятельный раздел нижней навигации. Списки Workout используют короткое название, приглушённые метаданные и видимое действие фильтра. [Activity](https://mobbin.com/screens/d921995e-5680-4b3a-995e-187fea253728), [All workouts](https://mobbin.com/screens/fdb16706-6071-4548-8df0-3dda05a7777b) | «Замер» и «Спортсмены» в нижней навигации корневых экранов. У попытки дистанция и дата на разных строках, время справа. |
| Фильтры | Группы Focus, Intensity и Format отделены друг от друга. [Filters](https://mobbin.com/screens/f7957fc5-3563-480b-904d-73e634fcd5b3) | У дистанции и порядка отдельные подписи. Два системных селектора помещаются над списком. Лучшие и худшие сравниваются внутри дистанции. |
| Детали | Brilliant Speed открывается на отдельном экране с крупным медиа и характеристиками ниже. [Brilliant Speed](https://mobbin.com/screens/124e00db-1806-448a-8d21-5044c2091936) | У попытки собственная страница. Время сразу под заголовком, затем видео и кадры, ниже режим старта, дистанция, дата и интервал кадров. |
| Фон и действия | Категория HIIT выделяет заголовок на фото и отделяет его от списка. [HIIT](https://mobbin.com/screens/a1232919-bb1d-4d7d-a385-869e6e08655b) | Фото дорожки стало фоном заголовка «Замер». «Создать старт» выделено заливкой, «Подключить финиш» имеет светлую поверхность и QR-иконку. |

## Почему форма открывается страницей

В Jomo список выбора находится в высокой панели, в Attio форма добавления записи тоже открывается снизу. Apple допускает панель для короткой связанной задачи. У Створа уже есть переход по «+», одна форма и отдельный экран нового спортсмена, поэтому полный экран сохраняет место под клавиатуру и даёт прямой возврат в список. [Jomo](https://mobbin.com/screens/1514b6c2-a95d-4246-b14e-32754b7daef0), [Attio](https://mobbin.com/screens/ef3d8aa0-92b0-4947-9b4c-1bf55c252947), [Apple HIG · Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)

Из готовых панелей для React рассмотрел Base UI Drawer с поддержкой виртуальной клавиатуры, жестов и точек остановки, а также Vaul. Для веб-компонента Ionic поддерживает останавливающуюся при свайпе sheet-панель, но её модальная семантика зависит от конфигурации. Створ использует обычный HTML и системные поля. [Base UI Drawer](https://base-ui.com/react/components/drawer), [Vaul](https://github.com/emilkowalski/vaul), [Ionic Sheet Modals](https://ionicframework.com/docs/api/modal#sheet-modals)

## Камера и доступность

- QR-сканер занимает весь экран. Декодер проверяет видимую часть потока. Камера выключается после чтения QR или при уходе со страницы. Отдельная страница ручного ввода доступна и при отказе в доступе к камере. Рассмотрел альтернативу с Worker и нативным BarcodeDetector, в этом выпуске использован уже проверенный jsQR. [Nimiq QR Scanner](https://github.com/nimiq/qr-scanner)
- У полей остаются подписи и видимый фокус. Фокус после перехода к форме находится на заголовке, следующее нажатие Tab ведёт на поле. Переход с камеры к вводу кода сразу ставит фокус на поле.
- Основные области нажатия от 44 × 44 CSS px. Удержание показывает уменьшение и затемнение. При Reduce Motion эффект применяется без анимации, переход между страницами тоже отключается. [Apple HIG · Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)

`verify-mobile.mjs` проверяет QR, вход по коду, фокус при возврате, нажатие пальцем, сортировку и видео после перезагрузки. Скриншоты снимаются на ширинах 320, 390 и 430 CSS px. Для прогона нужны Playwright с Chromium и Y4M, где бегун пересекает линию справа налево. В `STVOR_PLAYWRIGHT` и `STVOR_CHROME` можно указать пути к установленным модулю и браузеру. Без `STVOR_URL` используется локальный сервер.

```bash
heavy-build --memory 2G -- env STVOR_CAMERA=/path/to/pass.y4m STVOR_SCREENSHOTS=/path/to/screenshots node sprint-timer/verify-mobile.mjs
```

## Фото онбординга

Созданы встроенным инструментом ImageGen. В приложении лежат версии WebP шириной 960 px. Общий запрос и продолжения для трёх сцен приведены ниже.

### start.webp

> Photorealistic natural editorial sports photography, for an onboarding hero of an independent sprint timer. 4:3 landscape composition, camera subjects stay within central 70% so it also crops to a wide center frame. An outdoor community athletics track with muted brick red rubber, pale lane paint, soft late-afternoon sunlight, subtle grain, real surface texture, understated neutral clothing, editorial sports campaign energy. Entire frame is a photo. No image panels, graphics, logo, caption, watermark, text, brand marks, or phone UI mockup. From ground level just behind the side of starting blocks, a sprinter in dark charcoal training kit crouches with both hands just behind the white starting line, before the start. A small black smartphone on a compact ground tripod sits in the adjacent lane foreground, rear of phone visible, naturally placed and secondary to the athlete. Clear, normal anatomy and realistic track layout.

### connect.webp

> Photorealistic natural editorial sports photography, for an onboarding hero of an independent sprint timer. 4:3 landscape composition, camera subjects stay within central 70% so it also crops to a wide center frame. An outdoor community athletics track with muted brick red rubber, pale lane paint, soft late-afternoon sunlight, subtle grain, real surface texture, understated neutral clothing, editorial sports campaign energy. Entire frame is a photo. No image panels, graphics, logo, caption, watermark, text, brand marks, or phone UI mockup. Over-the-shoulder close framing, with two distinct black smartphones in a real athletic track setting, illustrating pairing a finish camera. A runner's hand is holding the near phone upright from behind, pointing its rear camera toward the second upright phone on a low tripod. Second phone has a small isolated simple dark square QR pattern on a white screen, decorative and no readable text. The phones should look separated by a practical scanning distance and be naturally positioned.

### finish.webp

> Photorealistic natural editorial sports photography, for an onboarding hero of an independent sprint timer. 4:3 landscape composition, camera subjects stay within central 70% so it also crops to a wide center frame. An outdoor community athletics track with muted brick red rubber, pale lane paint, soft late-afternoon sunlight, subtle grain, real surface texture, understated neutral clothing, editorial sports campaign energy. Entire frame is a photo. No image panels, graphics, logo, caption, watermark, text, brand marks, or phone UI mockup. Side-on sports documentary photo of a single sprinter in charcoal kit sprinting across a clearly visible white finish stripe. A small phone on a waist-high tripod stands off the track to the side aligned with the stripe, aimed at the runner, and no equipment blocks the lanes. Strong natural running form, face kept in profile, slight realistic background motion blur, no stadium crowd.
